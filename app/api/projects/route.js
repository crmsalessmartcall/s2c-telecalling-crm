import { NextResponse } from "next/server";
import { getServiceSupabase, getCallerProfile } from "@/lib/supabaseServer";

export async function GET(req) {
  try {
    const supabase = getServiceSupabase();
    const caller = await getCallerProfile(req, supabase);
    if (caller.error) {
      return NextResponse.json({ error: caller.error }, { status: caller.status });
    }

    const tenantId = caller.profile.tenant_id;
    if (!tenantId) {
      return NextResponse.json({ projects: [] });
    }

    const { data: projects, error: pErr } = await supabase
      .from("projects")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });

    if (pErr) return NextResponse.json({ error: pErr.message }, { status: 400 });

    const { data: fields } = await supabase
      .from("project_fields")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true });

    let leadsQuery = supabase
      .from("leads")
      .select("id, project_id, status, assigned_to")
      .eq("tenant_id", tenantId);

    if (caller.profile.role === "agent") {
      leadsQuery = leadsQuery.eq("assigned_to", caller.profile.id);
    }

    const { data: leads } = await leadsQuery;

    const enriched = (projects || []).map((proj) => {
      const projLeads = (leads || []).filter((l) => l.project_id === proj.id);
      const projFields = (fields || []).filter((f) => f.project_id === proj.id);
      return {
        ...proj,
        fields: projFields,
        lead_counts: {
          total: projLeads.length,
          new: projLeads.filter((l) => l.status === "new").length,
          follow_up: projLeads.filter((l) => l.status === "follow_up").length,
          connected: projLeads.filter((l) => l.status === "connected").length,
          closed: projLeads.filter((l) => l.status === "closed").length,
        },
      };
    });

    return NextResponse.json({ projects: enriched });
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

    if (!["tenant_admin", "supervisor", "team_leader"].includes(caller.profile.role)) {
      return NextResponse.json({ error: "Insufficient permissions to create campaigns" }, { status: 403 });
    }

    const body = await req.json();

    // Action 1: Add a custom field to an existing project
    if (body.action === "add_field") {
      const { project_id, field_name, field_type = "text", options = [], scope = "lead" } = body;
      if (!project_id || !field_name) {
        return NextResponse.json({ error: "project_id and field_name are required" }, { status: 400 });
      }

      const fieldKey = field_name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "");

      const { data: field, error: fErr } = await supabase
        .from("project_fields")
        .insert({
          tenant_id: caller.profile.tenant_id,
          project_id,
          field_key: fieldKey,
          field_label: field_name.trim(),
          field_type,
          options: Array.isArray(options) ? options : [],
          scope,
        })
        .select()
        .single();

      if (fErr) return NextResponse.json({ error: fErr.message }, { status: 400 });
      return NextResponse.json({ field }, { status: 201 });
    }

    // Action 2: Create a new campaign / project
    const { name, description = "" } = body;
    if (!name || !name.trim()) {
      return NextResponse.json({ error: "Campaign/Project name is required" }, { status: 400 });
    }

    const { data: project, error: projErr } = await supabase
      .from("projects")
      .insert({
        tenant_id: caller.profile.tenant_id,
        name: name.trim(),
        description: description.trim(),
        status: "active",
        created_by: caller.profile.id,
      })
      .select()
      .single();

    if (projErr) return NextResponse.json({ error: projErr.message }, { status: 400 });

    return NextResponse.json({ project }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
