import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  extractCustomFieldsFromRow,
  normalizeAndValidatePhone,
  normalizeFieldKey,
} from "@/lib/ingestHelpers";

const DEFAULT_SUPABASE_URL = "https://yabrgtrerjyzahmswbzw.supabase.co";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getSupabaseServer() {
  const url =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    DEFAULT_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

const STD_KEYS = new Set([
  "name",
  "customer_name",
  "phone",
  "customer_number",
  "email",
  "notes",
  "follow_up_at",
  "assigned_to",
  "user_id",
  "status",
  "disposition",
  "source",
]);

export async function POST(req) {
  try {
    const supabase = getSupabaseServer();
    if (!supabase) {
      return NextResponse.json({ error: "Supabase server client not configured." }, { status: 500 });
    }

    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) {
      return NextResponse.json({ error: "Missing authorization token." }, { status: 401 });
    }

    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !authData?.user) {
      return NextResponse.json({ error: "Invalid or expired session." }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("id, role, tenant_id")
      .eq("id", authData.user.id)
      .maybeSingle();

    if (!profile) {
      return NextResponse.json({ error: "User profile not found." }, { status: 403 });
    }

    const body = await req.json();
    const projectId = body?.project_id || null;
    const tenantId =
      profile.role === "super_admin"
        ? body?.tenant_id || profile.tenant_id || null
        : profile.tenant_id || null;

    const incomingRows = Array.isArray(body?.rows)
      ? body.rows
      : Array.isArray(body?.leads)
      ? body.leads
      : [];

    if (incomingRows.length === 0) {
      return NextResponse.json({ error: "No rows provided for import." }, { status: 400 });
    }

    // Load tenant profiles so row.user_id maps to profiles.id (leads.assigned_to)
    let profileQuery = supabase.from("profiles").select("id, user_id");
    if (tenantId) {
      profileQuery = profileQuery.eq("tenant_id", tenantId);
    }
    const { data: tenantProfiles = [] } = await profileQuery;

    const profilePkByUserId = {};
    const validProfilePks = new Set();
    for (const p of tenantProfiles || []) {
      if (p?.id) validProfilePks.add(p.id);
      if (p?.user_id) {
        profilePkByUserId[String(p.user_id).trim().toLowerCase()] = p.id;
      }
    }
    const availableUserIds = Object.keys(profilePkByUserId);

    function resolveRowAssignee(row) {
      const rawUserId = row?.user_id;
      const rawAssignedTo = row?.assigned_to;

      const candidate =
        rawUserId !== undefined && rawUserId !== null && String(rawUserId).trim() !== ""
          ? String(rawUserId).trim()
          : rawAssignedTo !== undefined && rawAssignedTo !== null && String(rawAssignedTo).trim() !== ""
          ? String(rawAssignedTo).trim()
          : "";

      if (!candidate) {
        return { assignedProfileId: null, error: null };
      }

      const lowerCode = candidate.toLowerCase();
      if (profilePkByUserId[lowerCode]) {
        return { assignedProfileId: profilePkByUserId[lowerCode], error: null };
      }

      if (UUID_REGEX.test(candidate) && validProfilePks.has(candidate)) {
        return { assignedProfileId: candidate, error: null };
      }

      return {
        assignedProfileId: null,
        error: `Unknown user_id "${candidate}" in this tenant. Available user_ids: ${
          availableUserIds.length ? availableUserIds.join(", ") : "none"
        }`,
      };
    }

    let createdFieldsCount = 0;
    const newFields = Array.isArray(body?.new_fields) ? body.new_fields : [];
    for (const nf of newFields) {
      const key = normalizeFieldKey(nf?.field_key || nf?.label);
      const label = String(nf?.label || nf?.field_key || "").trim();
      if (!key || !label) continue;

      try {
        await supabase.from("call_fields").insert({
          field_key: key,
          label,
          field_type: nf?.field_type || "text",
          ...(projectId ? { project_id: projectId } : {}),
          ...(tenantId ? { tenant_id: tenantId } : {}),
        });
        createdFieldsCount += 1;
      } catch {
        // Ignore if field already exists
      }
    }

    let existingQuery = supabase
      .from("leads")
      .select("id, name, phone, email, notes, assigned_to, custom_fields, project_id");
    if (projectId) {
      existingQuery = existingQuery.eq("project_id", projectId);
    } else if (tenantId) {
      existingQuery = existingQuery.eq("tenant_id", tenantId);
    }
    const { data: existingLeads = [] } = await existingQuery;

    const byNormalizedPhone = new Map();
    for (const lead of existingLeads || []) {
      const norm = normalizeAndValidatePhone(lead.phone);
      if (norm.normalized && !byNormalizedPhone.has(norm.normalized)) {
        byNormalizedPhone.set(norm.normalized, lead);
      }
    }

    let createdCount = 0;
    let updatedCount = 0;
    const errors = [];

    for (let idx = 0; idx < incomingRows.length; idx += 1) {
      const row = incomingRows[idx] || {};
      const rowNumber = row._row_number || idx + 2;

      const rawPhone = row.phone ?? row.customer_number ?? row.mobile ?? "";
      const phoneCheck = normalizeAndValidatePhone(rawPhone);
      if (!phoneCheck.valid) {
        errors.push({
          row_number: rowNumber,
          raw: rawPhone || JSON.stringify(row).slice(0, 120),
          reason: phoneCheck.reason,
        });
        continue;
      }

      const assigneeResult = resolveRowAssignee(row);
      if (assigneeResult.error) {
        errors.push({
          row_number: rowNumber,
          raw: row.user_id || row.assigned_to || rawPhone,
          reason: assigneeResult.error,
        });
        continue;
      }

      const cleanPhone = phoneCheck.normalized;
      const cleanName =
        String(row.name ?? row.customer_name ?? "").trim() || `Lead ${cleanPhone.slice(-4)}`;
      const cleanEmail = String(row.email ?? "").trim() || null;
      const cleanNotes = String(row.notes ?? "").trim() || null;
      const customFields = extractCustomFieldsFromRow(row, STD_KEYS);

      const hasExplicitAssignee =
        (row.user_id !== undefined && row.user_id !== null && String(row.user_id).trim() !== "") ||
        (row.assigned_to !== undefined &&
          row.assigned_to !== null &&
          String(row.assigned_to).trim() !== "");

      const existing = byNormalizedPhone.get(cleanPhone);
      if (existing) {
        const mergedCustom = {
          ...(existing.custom_fields && typeof existing.custom_fields === "object"
            ? existing.custom_fields
            : {}),
          ...customFields,
        };

        const updatePayload = {
          name: row.name || row.customer_name ? cleanName : existing.name,
          email: cleanEmail ?? existing.email,
          notes: cleanNotes ?? existing.notes,
          custom_fields: mergedCustom,
          ...(hasExplicitAssignee ? { assigned_to: assigneeResult.assignedProfileId } : {}),
        };

        const { data: updatedLead, error: updErr } = await supabase
          .from("leads")
          .update(updatePayload)
          .eq("id", existing.id)
          .select("*")
          .single();

        if (updErr) {
          errors.push({
            row_number: rowNumber,
            raw: cleanPhone,
            reason: updErr.message,
          });
        } else {
          updatedCount += 1;
          byNormalizedPhone.set(cleanPhone, updatedLead || { ...existing, ...updatePayload });
        }
      } else {
        const insertPayload = {
          name: cleanName,
          phone: cleanPhone,
          email: cleanEmail,
          notes: cleanNotes,
          status: row.status || "new",
          source: row.source || "csv_import",
          custom_fields: customFields,
          ...(projectId ? { project_id: projectId } : {}),
          ...(tenantId ? { tenant_id: tenantId } : {}),
          ...(assigneeResult.assignedProfileId ? { assigned_to: assigneeResult.assignedProfileId } : {}),
          ...(row.follow_up_at ? { follow_up_at: row.follow_up_at } : {}),
        };

        const { data: insertedLead, error: insErr } = await supabase
          .from("leads")
          .insert(insertPayload)
          .select("*")
          .single();

        if (insErr) {
          errors.push({
            row_number: rowNumber,
            raw: cleanPhone,
            reason: insErr.message,
          });
        } else {
          createdCount += 1;
          byNormalizedPhone.set(cleanPhone, insertedLead || insertPayload);
        }
      }
    }

    return NextResponse.json({
      ok: true,
      uploaded_count: createdCount + updatedCount,
      created_count: createdCount,
      updated_count: updatedCount,
      error_count: errors.length,
      errors,
      created_fields_count: createdFieldsCount,
    });
  } catch (err) {
    return NextResponse.json({ error: err?.message || "Bulk lead import failed." }, { status: 500 });
  }
}
