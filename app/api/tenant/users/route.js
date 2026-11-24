import { NextResponse } from "next/server";
import { getServiceSupabase, getCallerProfile } from "@/lib/supabaseServer";

const ALLOWED_TEAM_ROLES = ["supervisor", "team_leader", "agent"];

export async function GET(req) {
  try {
    const supabase = getServiceSupabase();
    const caller = await getCallerProfile(req, supabase);
    if (caller.error) {
      return NextResponse.json({ error: caller.error }, { status: caller.status });
    }

    if (!["tenant_admin", "supervisor", "team_leader"].includes(caller.profile.role)) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }

    const { data: tenant, error: tErr } = await supabase
      .from("tenants")
      .select("id, name, max_licenses, status")
      .eq("id", caller.profile.tenant_id)
      .single();

    if (tErr) return NextResponse.json({ error: tErr.message }, { status: 400 });

    const { data: users, error: uErr } = await supabase
      .from("profiles")
      .select("id, full_name, email, role, is_active, created_at")
      .eq("tenant_id", caller.profile.tenant_id)
      .order("created_at", { ascending: false });

    if (uErr) return NextResponse.json({ error: uErr.message }, { status: 400 });

    const activeCount = users.filter((u) => u.is_active).length;

    return NextResponse.json({
      tenant,
      used_licenses: activeCount,
      available_licenses: Math.max(0, tenant.max_licenses - activeCount),
      users,
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

    if (caller.profile.role !== "tenant_admin") {
      return NextResponse.json({ error: "Only tenant_admin can create team users" }, { status: 403 });
    }

    const { full_name, email, password, role } = await req.json();

    if (!full_name || !email || !password || !ALLOWED_TEAM_ROLES.includes(role)) {
      return NextResponse.json(
        { error: "full_name, email, password, and valid role (supervisor, team_leader, agent) are required" },
        { status: 400 }
      );
    }

    const tenantId = caller.profile.tenant_id;

    // Check license capacity
    const { data: tenant, error: tErr } = await supabase
      .from("tenants")
      .select("max_licenses, status")
      .eq("id", tenantId)
      .single();

    if (tErr || !tenant) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }

    const { count, error: cErr } = await supabase
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("is_active", true);

    if (cErr) return NextResponse.json({ error: cErr.message }, { status: 400 });

    if ((count || 0) >= tenant.max_licenses) {
      return NextResponse.json(
        { error: `License limit reached (${tenant.max_licenses} licenses). Contact Super Admin to increase.` },
        { status: 400 }
      );
    }

    const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
      email: email.trim().toLowerCase(),
      password,
      email_confirm: true,
    });

    if (authErr) {
      return NextResponse.json({ error: authErr.message }, { status: 400 });
    }

    const { data: profile, error: profErr } = await supabase
      .from("profiles")
      .insert({
        id: authUser.user.id,
        tenant_id: tenantId,
        full_name: full_name.trim(),
        email: email.trim().toLowerCase(),
        role,
        is_active: true,
      })
      .select()
      .single();

    if (profErr) {
      await supabase.auth.admin.deleteUser(authUser.user.id);
      return NextResponse.json({ error: profErr.message }, { status: 400 });
    }

    return NextResponse.json({ user: profile }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
