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

    let query = supabase
      .from("call_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);

    if (tenantId) {
      query = query.eq("tenant_id", tenantId);
    }
    if (projectId) {
      query = query.eq("project_id", projectId);
    }
    if (caller.profile.role === "agent") {
      query = query.eq("agent_id", caller.profile.id);
    }

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ calls: data || [] });
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
    const tenantId =
      caller.profile.role === "super_admin" && body.tenant_id
        ? body.tenant_id
        : caller.profile.tenant_id;

    if (!tenantId) {
      return NextResponse.json({ error: "tenant_id is required" }, { status: 400 });
    }

    const phone = String(body.phone || "").trim();
    if (!phone) {
      return NextResponse.json({ error: "phone is required to log a call" }, { status: 400 });
    }

    const durationSeconds = Math.max(0, Number(body.duration_seconds || 0));
    const status = String(body.status || "completed").trim();
    const disposition = body.disposition ? String(body.disposition).trim() : null;
    const notes = body.notes ? String(body.notes).trim() : null;
    const customFields =
      body.custom_fields && typeof body.custom_fields === "object" ? body.custom_fields : {};
    const followUpAt = body.follow_up_at ? new Date(body.follow_up_at).toISOString() : null;

    const nowIso = new Date().toISOString();
    const startedAt = body.started_at
      ? new Date(body.started_at).toISOString()
      : new Date(Date.now() - durationSeconds * 1000).toISOString();

    const { data: callLog, error: callErr } = await supabase
      .from("call_logs")
      .insert({
        tenant_id: tenantId,
        project_id: body.project_id || null,
        lead_id: body.lead_id || null,
        agent_id: caller.profile.id,
        phone,
        provider: String(body.provider || "smartcall"),
        external_call_id: body.external_call_id || `sc_${Date.now()}`,
        status,
        disposition,
        notes,
        custom_fields: customFields,
        duration_seconds: durationSeconds,
        started_at: startedAt,
        ended_at: body.ended_at ? new Date(body.ended_at).toISOString() : nowIso,
      })
      .select()
      .single();

    if (callErr) {
      return NextResponse.json({ error: callErr.message }, { status: 400 });
    }

    if (body.lead_id) {
      const leadPatch = {
        last_called_at: nowIso,
      };
      if (disposition) leadPatch.disposition = disposition;
      if (followUpAt) {
        leadPatch.follow_up_at = followUpAt;
        leadPatch.status = "follow_up";
      } else if (body.lead_status) {
        leadPatch.status = body.lead_status;
      } else if (status === "connected" || status === "completed") {
        leadPatch.status = "contacted";
      }

      await supabase
        .from("leads")
        .update(leadPatch)
        .eq("id", body.lead_id)
        .eq("tenant_id", tenantId);
    }

    return NextResponse.json({ call: callLog }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
