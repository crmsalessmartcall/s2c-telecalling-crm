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
    const followupsOnly = searchParams.get("followups") === "true";
    const tenantId =
      caller.profile.role === "super_admin" && searchParams.get("tenant_id")
        ? searchParams.get("tenant_id")
        : caller.profile.tenant_id;

    let query = supabase.from("leads").select("*").order("created_at", { ascending: false });

    if (tenantId) {
      query = query.eq("tenant_id", tenantId);
    } else if (caller.profile.role !== "super_admin") {
      return NextResponse.json({ error: "No tenant assigned to user" }, { status: 400 });
    }

    if (projectId) {
      query = query.eq("project_id", projectId);
    }
    if (caller.profile.role === "agent") {
      query = query.eq("assigned_to", caller.profile.id);
    }
    if (followupsOnly) {
      query = query.not("follow_up_at", "is", null);
    }

    const { data: leads, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ leads: leads || [] });
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

    const body = await req.json();
    const name = String(body.name || "").trim();
    const phone = String(body.phone || "").trim();
    const projectId = body.project_id || null;
    const tenantId =
      caller.profile.role === "super_admin" && body.tenant_id
        ? body.tenant_id
        : caller.profile.tenant_id;

    if (!name || !phone) {
      return NextResponse.json({ error: "Lead name and phone are required" }, { status: 400 });
    }
    if (!tenantId) {
      return NextResponse.json({ error: "tenant_id is required" }, { status: 400 });
    }

    const { data: lead, error } = await supabase
      .from("leads")
      .insert({
        tenant_id: tenantId,
        project_id: projectId,
        name,
        phone,
        email: body.email ? String(body.email).trim() : null,
        status: body.status || "new",
        disposition: body.disposition || null,
        notes: body.notes || null,
        custom_fields: body.custom_fields || {},
        follow_up_at: body.follow_up_at ? new Date(body.follow_up_at).toISOString() : null,
        assigned_to: body.assigned_to || (caller.profile.role === "agent" ? caller.profile.id : null),
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ lead }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(req) {
  try {
    const supabase = getServiceSupabase();
    const caller = await getCallerProfile(req, supabase);
    if (caller.error) {
      return NextResponse.json({ error: caller.error }, { status: caller.status });
    }

    const body = await req.json();
    const leadId = body.lead_id;
    if (!leadId) {
      return NextResponse.json({ error: "lead_id is required" }, { status: 400 });
    }

    const updates = {};
    if (body.status !== undefined) updates.status = body.status;
    if (body.disposition !== undefined) updates.disposition = body.disposition;
    if (body.notes !== undefined) updates.notes = body.notes;
    if (body.assigned_to !== undefined) updates.assigned_to = body.assigned_to || null;
    if (body.follow_up_at !== undefined) {
      updates.follow_up_at = body.follow_up_at ? new Date(body.follow_up_at).toISOString() : null;
    }
    if (body.custom_fields !== undefined) updates.custom_fields = body.custom_fields;

    let query = supabase.from("leads").update(updates).eq("id", leadId);
    if (caller.profile.role !== "super_admin" && caller.profile.tenant_id) {
      query = query.eq("tenant_id", caller.profile.tenant_id);
    }

    const { data: lead, error } = await query.select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ lead });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
