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
    const statusFilter = searchParams.get("status");

    let query = supabase
      .from("leads")
      .select("*", { count: "exact" })
      .eq("tenant_id", caller.profile.tenant_id)
      .order("created_at", { ascending: false })
      .limit(200);

    if (projectId) query = query.eq("project_id", projectId);
    if (statusFilter && statusFilter !== "all") query = query.eq("status", statusFilter);
    if (caller.profile.role === "agent") {
      query = query.eq("assigned_to", caller.profile.id);
    }

    const { data: leads, count, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({
      total_count: count || 0,
      leads: leads || [],
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
