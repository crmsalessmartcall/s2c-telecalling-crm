import { NextResponse } from "next/server";
import { getServiceSupabase, getCallerProfile } from "@/lib/supabaseServer";

const STANDARD_KEYS = ["full_name", "phone", "email", "company", "city"];

export async function POST(req) {
  try {
    const supabase = getServiceSupabase();
    const caller = await getCallerProfile(req, supabase);
    if (caller.error) {
      return NextResponse.json({ error: caller.error }, { status: caller.status });
    }

    if (!["tenant_admin", "supervisor", "team_leader"].includes(caller.profile.role)) {
      return NextResponse.json({ error: "Insufficient permissions to upload leads" }, { status: 403 });
    }

    const { project_id, rows, mapping, default_assigned_to = null } = await req.json();

    if (!project_id || !Array.isArray(rows) || rows.length === 0 || !mapping) {
      return NextResponse.json(
        { error: "project_id, non-empty rows, and field mapping are required" },
        { status: 400 }
      );
    }

    const tenantId = caller.profile.tenant_id;
    const prepared = [];
    let skipped = 0;

    for (const row of rows) {
      const leadObj = {
        tenant_id: tenantId,
        project_id,
        full_name: "",
        phone: "",
        email: "",
        company: "",
        city: "",
        status: "new",
        assigned_to: default_assigned_to || null,
        custom_data: {},
      };

      for (const [csvHeader, targetField] of Object.entries(mapping)) {
        if (!targetField || targetField === "__ignore__") continue;
        const val = row[csvHeader] !== undefined && row[csvHeader] !== null ? String(row[csvHeader]).trim() : "";
        if (!val) continue;

        if (STANDARD_KEYS.includes(targetField)) {
          leadObj[targetField] = val;
        } else {
          leadObj.custom_data[targetField] = val;
        }
      }

      const cleanPhone = leadObj.phone.replace(/[^\d+]/g, "");
      if (!cleanPhone) {
        skipped++;
        continue;
      }
      leadObj.phone = cleanPhone;
      if (!leadObj.full_name) leadObj.full_name = "Unknown Lead";

      prepared.push(leadObj);
    }

    if (prepared.length === 0) {
      return NextResponse.json(
        { error: "No valid leads found. Make sure the Phone column is mapped and non-empty." },
        { status: 400 }
      );
    }

    const { data: inserted, error: insErr } = await supabase
      .from("leads")
      .insert(prepared)
      .select("id");

    if (insErr) {
      return NextResponse.json({ error: insErr.message }, { status: 400 });
    }

    return NextResponse.json(
      {
        uploaded_count: inserted.length,
        skipped_count: skipped,
      },
      { status: 201 }
    );
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
