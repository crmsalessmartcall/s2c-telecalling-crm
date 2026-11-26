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

    let callsQuery = supabase.from("call_logs").select("*").order("created_at", { ascending: false });
    let leadsQuery = supabase.from("leads").select("id, status, disposition, follow_up_at");

    if (tenantId) {
      callsQuery = callsQuery.eq("tenant_id", tenantId);
      leadsQuery = leadsQuery.eq("tenant_id", tenantId);
    }
    if (projectId) {
      callsQuery = callsQuery.eq("project_id", projectId);
      leadsQuery = leadsQuery.eq("project_id", projectId);
    }

    const [{ data: calls, error: cErr }, { data: leads, error: lErr }] = await Promise.all([
      callsQuery,
      leadsQuery,
    ]);

    if (cErr) return NextResponse.json({ error: cErr.message }, { status: 400 });
    if (lErr) return NextResponse.json({ error: lErr.message }, { status: 400 });

    const callList = calls || [];
    const leadList = leads || [];

    const totalCalls = callList.length;
    const connectedCalls = callList.filter((c) =>
      ["connected", "completed", "answered"].includes(String(c.status || "").toLowerCase())
    ).length;
    const totalDuration = callList.reduce((acc, c) => acc + Number(c.duration_seconds || 0), 0);
    const avgDurationSeconds = totalCalls > 0 ? Math.round(totalDuration / totalCalls) : 0;

    const dispositionCounts = {};
    for (const c of callList) {
      const key = c.disposition || "Unassigned";
      dispositionCounts[key] = (dispositionCounts[key] || 0) + 1;
    }

    const leadStatusCounts = {};
    for (const l of leadList) {
      const key = l.status || "new";
      leadStatusCounts[key] = (leadStatusCounts[key] || 0) + 1;
    }

    return NextResponse.json({
      summary: {
        total_calls: totalCalls,
        connected_calls: connectedCalls,
        avg_duration_seconds: avgDurationSeconds,
        total_leads: leadList.length,
        scheduled_followups: leadList.filter((l) => Boolean(l.follow_up_at)).length,
      },
      dispositions: dispositionCounts,
      lead_statuses: leadStatusCounts,
      recent_calls: callList.slice(0, 25),
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
