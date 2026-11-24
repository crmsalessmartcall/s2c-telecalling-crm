import { NextResponse } from "next/server";
import { getServiceSupabase, getCallerProfile } from "@/lib/supabaseServer";

export async function GET(req) {
  try {
    const supabase = getServiceSupabase();
    const caller = await getCallerProfile(req, supabase);
    if (caller.error) {
      return NextResponse.json({ error: caller.error }, { status: caller.status });
    }
    if (caller.profile.role !== "super_admin") {
      return NextResponse.json({ error: "Only super_admin can list all tenants" }, { status: 403 });
    }

    const { data: tenants, error: tErr } = await supabase
      .from("tenants")
      .select("*")
      .order("created_at", { ascending: false });

    if (tErr) return NextResponse.json({ error: tErr.message }, { status: 400 });

    const { data: profiles, error: pErr } = await supabase
      .from("profiles")
      .select("id, tenant_id, full_name, email, role, is_active");

    if (pErr) return NextResponse.json({ error: pErr.message }, { status: 400 });

    const enriched = tenants.map((t) => {
      const members = profiles.filter((p) => p.tenant_id === t.id);
      const activeCount = members.filter((p) => p.is_active).length;
      return {
        ...t,
        used_licenses: activeCount,
        remaining_licenses: Math.max(0, t.max_licenses - activeCount),
        users: members,
      };
    });

    return NextResponse.json({ tenants: enriched });
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
    if (caller.profile.role !== "super_admin") {
      return NextResponse.json({ error: "Only super_admin can create tenants" }, { status: 403 });
    }

    const body = await req.json();
    const {
      tenant_name,
      max_licenses = 5,
      admin_name,
      admin_email,
      admin_password,
      telephony_config = {},
    } = body;

    if (!tenant_name || !admin_name || !admin_email || !admin_password) {
      return NextResponse.json(
        { error: "tenant_name, admin_name, admin_email, and admin_password are required" },
        { status: 400 }
      );
    }

    // 1. Create tenant with license limit & telephony config
    const { data: tenant, error: tenantErr } = await supabase
      .from("tenants")
      .insert({
        name: tenant_name.trim(),
        max_licenses: Number(max_licenses),
        telephony_config,
        status: "active",
      })
      .select()
      .single();

    if (tenantErr) {
      return NextResponse.json({ error: tenantErr.message }, { status: 400 });
    }

    // 2. Create auth user for Tenant Admin
    const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
      email: admin_email.trim().toLowerCase(),
      password: admin_password,
      email_confirm: true,
    });

    if (authErr) {
      // Roll back tenant if auth creation fails
      await supabase.from("tenants").delete().eq("id", tenant.id);
      return NextResponse.json({ error: authErr.message }, { status: 400 });
    }

    // 3. Create profile with tenant_admin role
    const { data: profile, error: profErr } = await supabase
      .from("profiles")
      .insert({
        id: authUser.user.id,
        tenant_id: tenant.id,
        full_name: admin_name.trim(),
        email: admin_email.trim().toLowerCase(),
        role: "tenant_admin",
        is_active: true,
      })
      .select()
      .single();

    if (profErr) {
      await supabase.auth.admin.deleteUser(authUser.user.id);
      await supabase.from("tenants").delete().eq("id", tenant.id);
      return NextResponse.json({ error: profErr.message }, { status: 400 });
    }

    return NextResponse.json({ tenant, admin: profile }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
