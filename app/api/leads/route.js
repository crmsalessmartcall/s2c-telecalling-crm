import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  extractCustomFieldsFromRow,
  normalizeAndValidatePhone,
} from "@/lib/ingestHelpers";

const DEFAULT_SUPABASE_URL = "https://yabrgtrerjyzahmswbzw.supabase.co";

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
  "status",
  "disposition",
  "source",
  "project_id",
  "tenant_id",
  "custom_fields",
]);

async function authenticateRequest(req, supabase) {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    return { error: NextResponse.json({ error: "Missing authorization token." }, { status: 401 }) };
  }

  const { data: authData, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !authData?.user) {
    return { error: NextResponse.json({ error: "Invalid or expired session." }, { status: 401 }) };
  }

  const { data: profile, error: profErr } = await supabase
    .from("profiles")
    .select("id, role, tenant_id, is_active")
    .eq("id", authData.user.id)
    .maybeSingle();

  if (profErr || !profile) {
    return { error: NextResponse.json({ error: "User profile not found." }, { status: 403 }) };
  }

  if (profile.is_active === false) {
    return { error: NextResponse.json({ error: "User account is disabled." }, { status: 403 }) };
  }

  return { user: authData.user, profile };
}

function resolveTenantScope(profile, requestedTenantId) {
  if (profile.role === "super_admin") {
    return requestedTenantId || profile.tenant_id || null;
  }
  return profile.tenant_id || null;
}

export async function GET(req) {
  try {
    const supabase = getSupabaseServer();
    if (!supabase) {
      return NextResponse.json({ error: "Supabase server client not configured." }, { status: 500 });
    }

    const auth = await authenticateRequest(req, supabase);
    if (auth.error) return auth.error;
    const { profile } = auth;

    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("project_id") || "";
    const requestedTenantId = searchParams.get("tenant_id") || "";
    const tenantId = resolveTenantScope(profile, requestedTenantId);

    let query = supabase
      .from("leads")
      .select("*")
      .order("created_at", { ascending: false });

    if (tenantId) {
      query = query.eq("tenant_id", tenantId);
    }
    if (projectId) {
      query = query.eq("project_id", projectId);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, leads: data || [] });
  } catch (err) {
    return NextResponse.json({ error: err?.message || "Failed to fetch leads." }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const supabase = getSupabaseServer();
    if (!supabase) {
      return NextResponse.json({ error: "Supabase server client not configured." }, { status: 500 });
    }

    const auth = await authenticateRequest(req, supabase);
    if (auth.error) return auth.error;
    const { profile } = auth;

    const body = await req.json();
    const tenantId = resolveTenantScope(profile, body?.tenant_id);
    const projectId = body?.project_id || null;

    const rawPhone = body?.phone ?? body?.customer_number ?? body?.mobile ?? "";
    const phoneCheck = normalizeAndValidatePhone(rawPhone);
    if (!phoneCheck.valid) {
      return NextResponse.json({ error: phoneCheck.reason }, { status: 400 });
    }

    const cleanPhone = phoneCheck.normalized;
    const cleanName =
      String(body?.name ?? body?.customer_name ?? "").trim() || `Lead ${cleanPhone.slice(-4)}`;
    const cleanEmail = String(body?.email ?? "").trim() || null;
    const cleanNotes = String(body?.notes ?? "").trim() || null;

    const providedCustom =
      body?.custom_fields && typeof body.custom_fields === "object" ? body.custom_fields : {};
    const extraCustom = extractCustomFieldsFromRow(body, STD_KEYS);
    const customFields = { ...extraCustom, ...providedCustom };

    const insertPayload = {
      name: cleanName,
      phone: cleanPhone,
      email: cleanEmail,
      notes: cleanNotes,
      status: body?.status || "new",
      disposition: body?.disposition || null,
      source: body?.source || "manual",
      assigned_to: body?.assigned_to || null,
      follow_up_at: body?.follow_up_at || null,
      custom_fields: customFields,
      ...(projectId ? { project_id: projectId } : {}),
      ...(tenantId ? { tenant_id: tenantId } : {}),
    };

    const { data: lead, error } = await supabase
      .from("leads")
      .insert(insertPayload)
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, lead }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err?.message || "Failed to create lead." }, { status: 500 });
  }
}

export async function PATCH(req) {
  try {
    const supabase = getSupabaseServer();
    if (!supabase) {
      return NextResponse.json({ error: "Supabase server client not configured." }, { status: 500 });
    }

    const auth = await authenticateRequest(req, supabase);
    if (auth.error) return auth.error;
    const { profile } = auth;

    const body = await req.json();
    const tenantId = resolveTenantScope(profile, body?.tenant_id);

    const targetIds = Array.isArray(body?.lead_ids) && body.lead_ids.length > 0
      ? body.lead_ids.filter(Boolean)
      : body?.lead_id
      ? [body.lead_id]
      : [];

    if (targetIds.length === 0) {
      return NextResponse.json(
        { error: "lead_id or lead_ids is required." },
        { status: 400 }
      );
    }

    const patch = {};
    if ("assigned_to" in body) patch.assigned_to = body.assigned_to || null;
    if ("status" in body) patch.status = body.status;
    if ("disposition" in body) patch.disposition = body.disposition || null;
    if ("follow_up_at" in body) patch.follow_up_at = body.follow_up_at || null;
    if ("notes" in body) patch.notes = body.notes;
    if ("name" in body && body.name) patch.name = String(body.name).trim();
    if ("email" in body) patch.email = body.email ? String(body.email).trim() : null;
    if ("project_id" in body) patch.project_id = body.project_id || null;
    if ("is_closed" in body) patch.is_closed = Boolean(body.is_closed);
    if (body?.custom_fields && typeof body.custom_fields === "object") {
      patch.custom_fields = body.custom_fields;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "No valid update fields provided." }, { status: 400 });
    }

    let query = supabase.from("leads").update(patch).in("id", targetIds);
    if (tenantId) {
      query = query.eq("tenant_id", tenantId);
    }

    const { data, error } = await query.select("*");
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      updated_count: Array.isArray(data) ? data.length : 0,
      leads: data || [],
      lead: Array.isArray(data) && data.length === 1 ? data[0] : undefined,
    });
  } catch (err) {
    return NextResponse.json({ error: err?.message || "Failed to update leads." }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    const supabase = getSupabaseServer();
    if (!supabase) {
      return NextResponse.json({ error: "Supabase server client not configured." }, { status: 500 });
    }

    const auth = await authenticateRequest(req, supabase);
    if (auth.error) return auth.error;
    const { profile } = auth;

    const { searchParams } = new URL(req.url);
    let body = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const tenantId = resolveTenantScope(profile, body?.tenant_id || searchParams.get("tenant_id") || "");
    const singleId = body?.lead_id || searchParams.get("lead_id") || "";
    const targetIds = Array.isArray(body?.lead_ids) && body.lead_ids.length > 0
      ? body.lead_ids.filter(Boolean)
      : singleId
      ? [singleId]
      : [];

    if (targetIds.length === 0) {
      return NextResponse.json(
        { error: "lead_id or lead_ids is required." },
        { status: 400 }
      );
    }

    let query = supabase.from("leads").delete().in("id", targetIds);
    if (tenantId) {
      query = query.eq("tenant_id", tenantId);
    }

    const { error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, deleted_count: targetIds.length });
  } catch (err) {
    return NextResponse.json({ error: err?.message || "Failed to delete leads." }, { status: 500 });
  }
}
