import { NextResponse } from "next/server";
import { getServiceSupabase, getCallerProfile } from "@/lib/supabaseServer";

function parseCsvRows(csvText) {
  const lines = String(csvText || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const nameIdx = headers.findIndex((h) => ["name", "full_name", "lead_name", "customer"].includes(h));
  const phoneIdx = headers.findIndex((h) => ["phone", "mobile", "phone_number", "contact"].includes(h));
  const emailIdx = headers.findIndex((h) => ["email", "email_address"].includes(h));

  return lines.slice(1).map((line) => {
    const cols = line.split(",").map((c) => c.trim());
    const customFields = {};
    headers.forEach((h, idx) => {
      if (![nameIdx, phoneIdx, emailIdx].includes(idx) && cols[idx] !== undefined) {
        customFields[h] = cols[idx];
      }
    });

    return {
      name: nameIdx >= 0 ? cols[nameIdx] : cols[0] || "",
      phone: phoneIdx >= 0 ? cols[phoneIdx] : cols[1] || "",
      email: emailIdx >= 0 ? cols[emailIdx] || null : null,
      custom_fields: customFields,
    };
  });
}

export async function POST(req) {
  try {
    const supabase = getServiceSupabase();
    const caller = await getCallerProfile(req, supabase);
    if (caller.error) {
      return NextResponse.json({ error: caller.error }, { status: caller.status });
    }

    const body = await req.json();
    const projectId = body.project_id || null;
    const tenantId =
      caller.profile.role === "super_admin" && body.tenant_id
        ? body.tenant_id
        : caller.profile.tenant_id;

    if (!tenantId) {
      return NextResponse.json({ error: "tenant_id is required" }, { status: 400 });
    }

    const rawRows = Array.isArray(body.leads)
      ? body.leads
      : parseCsvRows(body.csv_text || "");

    const validRows = rawRows
      .map((r) => ({
        tenant_id: tenantId,
        project_id: projectId,
        name: String(r.name || "").trim(),
        phone: String(r.phone || "").trim(),
        email: r.email ? String(r.email).trim() : null,
        status: "new",
        custom_fields: r.custom_fields || {},
        assigned_to: body.assigned_to || (caller.profile.role === "agent" ? caller.profile.id : null),
      }))
      .filter((r) => r.name && r.phone);

    if (validRows.length === 0) {
      return NextResponse.json(
        { error: "No valid leads found. Include CSV headers name,phone (plus optional email or custom columns)." },
        { status: 400 }
      );
    }

    const { data: inserted, error } = await supabase.from("leads").insert(validRows).select();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ uploaded_count: inserted?.length || 0, leads: inserted || [] }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
