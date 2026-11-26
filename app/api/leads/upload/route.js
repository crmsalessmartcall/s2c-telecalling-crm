import { NextResponse } from "next/server";
import { getServiceSupabase, getCallerProfile } from "@/lib/supabaseServer";

function toKey(raw) {
  return (
    String(raw || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || `field_${Date.now()}`
  );
}

function toLabel(key) {
  return String(key || "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

export async function POST(req) {
  try {
    const supabase = getServiceSupabase();
    const caller = await getCallerProfile(req, supabase);
    if (caller.error) {
      return NextResponse.json({ error: caller.error }, { status: caller.status });
    }

    const body = await req.json();
    const tenantId =
      caller.profile.role === "super_admin" && body.tenant_id
        ? body.tenant_id
        : caller.profile.tenant_id;

    if (!tenantId) {
      return NextResponse.json({ error: "tenant_id is required" }, { status: 400 });
    }

    const projectId = body.project_id || null;
    const mappedRows = Array.isArray(body.rows) ? body.rows : [];
    const newFieldDefs = Array.isArray(body.new_fields) ? body.new_fields : [];

    // 1. Auto-create any new project call_fields requested from extra CSV columns
    const createdKeys = new Set();
    for (const nf of newFieldDefs) {
      const fieldKey = toKey(nf.field_key || nf.label);
      const label = String(nf.label || toLabel(fieldKey)).trim();
      const fieldType = String(nf.field_type || "text").trim();
      if (!fieldKey || createdKeys.has(fieldKey)) continue;
      createdKeys.add(fieldKey);

      let existingQ = supabase
        .from("call_fields")
        .select("id, field_key")
        .eq("tenant_id", tenantId)
        .eq("field_key", fieldKey);
      existingQ = projectId ? existingQ.eq("project_id", projectId) : existingQ.is("project_id", null);

      const { data: existingField } = await existingQ.maybeSingle();
      if (!existingField) {
        await supabase.from("call_fields").insert({
          tenant_id: tenantId,
          project_id: projectId,
          field_key: fieldKey,
          label,
          field_type: fieldType,
          is_required: false,
        });
      }
    }

    // 2. Build lead records
    const insertPayloads = mappedRows
      .map((r) => {
        const name = String(r.name || "").trim();
        const phone = String(r.phone || "").trim();
        if (!name && !phone) return null;

        return {
          tenant_id: tenantId,
          project_id: projectId,
          name: name || `Lead ${phone}`,
          phone: phone || "N/A",
          email: r.email ? String(r.email).trim() : null,
          notes: r.notes ? String(r.notes).trim() : null,
          status: r.follow_up_at ? "follow_up" : r.status || "new",
          follow_up_at: r.follow_up_at ? new Date(r.follow_up_at).toISOString() : null,
          custom_fields:
            r.custom_fields && typeof r.custom_fields === "object" ? r.custom_fields : {},
        };
      })
      .filter(Boolean);

    if (insertPayloads.length === 0) {
      return NextResponse.json(
        { error: "No valid leads found after mapping (name or phone is required)" },
        { status: 400 }
      );
    }

    const { data: inserted, error: insErr } = await supabase
      .from("leads")
      .insert(insertPayloads)
      .select();

    if (insErr) {
      return NextResponse.json({ error: insErr.message }, { status: 400 });
    }

    return NextResponse.json(
      {
        uploaded_count: (inserted || []).length,
        created_fields_count: createdKeys.size,
        leads: inserted || [],
      },
      { status: 201 }
    );
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
