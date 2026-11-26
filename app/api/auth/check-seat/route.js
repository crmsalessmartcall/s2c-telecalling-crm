import { NextResponse } from "next/server";
import { getServiceSupabase, getCallerProfile } from "@/lib/supabaseServer";
import { computeActiveSeats } from "@/app/api/admin/tenants/route";

export async function GET(req) {
  try {
    const supabase = getServiceSupabase();
    const caller = await getCallerProfile(req, supabase);
    if (caller.error) {
      return NextResponse.json({ error: caller.error }, { status: caller.status });
    }

    const role = caller.profile.role;
    if (["super_admin", "platform_ops", "tenant_admin"].includes(role) || !caller.profile.tenant_id) {
      return NextResponse.json({ allowed: true });
    }

    const tenantId = caller.profile.tenant_id;
    const activeSeats = await computeActiveSeats(supabase, tenantId);

    const { data: members } = await supabase
      .from("profiles")
      .select("id, is_active, created_at")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("created_at", { ascending: true });

    const activeList = members || [];
    const seatIndex = activeList.findIndex((m) => m.id === caller.profile.id);

    if (activeSeats <= 0 || seatIndex === -1 || seatIndex >= activeSeats) {
      return NextResponse.json(
        {
          allowed: false,
          error: `No active seat license available for your tenant (${activeSeats} active seat(s) right now). Contact your Tenant Admin.`,
        },
        { status: 403 }
      );
    }

    return NextResponse.json({ allowed: true, active_seats: activeSeats });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
