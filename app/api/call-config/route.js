import { NextResponse } from "next/server";
import { getServiceSupabase, getCallerProfile } from "@/lib/supabaseServer";

export async function GET(req) {
  try {
    const supabase = getServiceSupabase();
    const caller = await getCallerProfile(req, supabase);
    if (caller.error) {
      return NextResponse.json({ error: caller.error }, { status: caller.status });
    }

    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("project_id");
    const tenantId =
      caller.profile.role === "super_admin" && searchParams.get("tenant_id")
        ? searchParams.get("tenant_id")
        : caller.profile.tenant_id;

    let fieldsQuery = supabase.from("call_fields").select("*").order("created_at", { ascending: true });
    let dispQuery = supabase.from("dispositions").select("*").order("created_at", { ascending: true });

    if (tenantId) {
      fieldsQuery = fieldsQuery.eq("tenant_id", tenantId);
      dispQuery = dispQuery.eq("tenant_id", tenantId);
    }
    if (projectId) {
      fieldsQuery = fieldsQuery.eq("project_id", projectId);
      dispQuery = dispQuery.eq("project_id", projectId);
    }

    const [{ data: fields, error: fErr }, { data: dispositions, error: dErr }] = await Promise.all([
      fieldsQuery,
      dispQuery,
    ]);

    if (fErr) return NextResponse.json({ error: fErr.message }, { status: 400 });
    if (dErr) return NextResponse.json({ error: dErr.message }, { status: 400 });

    return NextResponse.json({
      call_fields: fields || [],
      dispositions: dispositions || [],
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const supabase = getServiceSupabase();
    const caller = await getCallerProfile(req, supabase);
    if (caller.error) {
      return NextResponse.json({ error: caller.error }, { status: caller.status });
    }
    if (!["super_admin", "tenant_admin", "supervisor"].includes(caller.profile.role)) {
      return NextResponse.json({ error: "Not authorized to configure call settings" }, { status: 403 });
    }

    const body = await req.json();
    const kind = body.kind; // "field" | "disposition"
    const tenantId =
      caller.profile.role === "super_admin" && body.tenant_id
        ? body.tenant_id
        : caller.profile.tenant_id;
    const projectId = body.project_id || null;

    if (!tenantId) {
      return NextResponse.json({ error: "tenant_id is required" }, { status: 400 });
    }

    if (kind === "field") {
      const label = String(body.label || body.field_name || "").trim();
      const fieldType = String(body.field_type || "text").trim();
      if (!label) {
        return NextResponse.json({ error: "Field label is required" }, { status: 400 });
      }

      const { data: created, error } = await supabase
        .from("call_fields")
        .insert({
          tenant_id: tenantId,
          project_id: projectId,
          label,
          field_type: fieldType,
          is_required: Boolean(body.is_required),
        })
        .select()
        .single();

      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ field: created }, { status: 201 });
    }

    if (kind === "disposition") {
      const name = String(body.name || "").trim();
      if (!name) {
        return NextResponse.json({ error: "Disposition name is required" }, { status: 400 });
      }

      const { data: created, error } = await supabase
        .from("dispositions")
        .insert({
          tenant_id: tenantId,
          project_id: projectId,
          name,
          requires_followup: Boolean(body.requires_followup),
        })
        .select()
        .single();

      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ disposition: created }, { status: 201 });
    }

    return NextResponse.json({ error: "kind must be 'field' or 'disposition'" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
