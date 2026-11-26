import { NextResponse } from "next/server";
import { getServiceSupabase, getCallerProfile } from "@/lib/supabaseServer";

export async function GET(req) {
  try {
    const supabase = getServiceSupabase();
    const caller = await getCallerProfile(req, supabase);
    if (caller.error) {
      return NextResponse.json({ error: caller.error }, { status: caller.status });
    }
    if (!["super_admin", "platform_ops"].includes(caller.profile.role)) {
      return NextResponse.json({ error: "Not authorized to view tenants" }, { status: 403 });
    }

    const [{ data: tenants, error: tErr }, { data: profiles, error: pErr }, { data: periods, error: lpErr }] =
      await Promise.all([
        supabase.from("tenants").select("*").order("created_at", { ascending: false }),
        supabase.from("profiles").select("id, tenant_id, full_name, email, role, is_active"),
        supabase
          .from("license_periods")
          .select("id, tenant_id, seat_count, starts_at, ends_at, reason, changed_by, created_at")
          .order("starts_at", { ascending: false }),
      ]);

    if (tErr) return NextResponse.json({ error: tErr.message }, { status: 400 });
    if (pErr) return NextResponse.json({ error: pErr.message }, { status: 400 });

    const profileMap = new Map((profiles || []).map((pr) => [pr.id, pr]));

    const enriched = (tenants || []).map((t) => {
      const members = (profiles || []).filter((p) => p.tenant_id === t.id);
      const activeCount = members.filter((p) => p.is_active).length;
      const history = lpErr
        ? []
        : (periods || [])
            .filter((lp) => lp.tenant_id === t.id)
            .map((lp) => {
              const actor = profileMap.get(lp.changed_by);
              return {
                ...lp,
                changed_by_name: actor?.full_name || null,
                changed_by_email: actor?.email || null,
              };
            });

      return {
        ...t,
        used_licenses: activeCount,
        remaining_licenses: Math.max(0, Number(t.max_licenses || 0) - activeCount),
        users: members,
        license_periods: history,
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
      license_ends_at = null,
    } = body;

    if (!tenant_name || !admin_name || !admin_email || !admin_password) {
      return NextResponse.json(
        { error: "tenant_name, admin_name, admin_email, and admin_password are required" },
        { status: 400 }
      );
    }

    const cleanEmail = admin_email.trim().toLowerCase();
    const seats = Math.max(1, Number(max_licenses) || 5);

    const { data: existingProfile } = await supabase
      .from("profiles")
      .select("id")
      .eq("email", cleanEmail)
      .maybeSingle();

    if (existingProfile) {
      return NextResponse.json(
        { error: "Email already exists. Please use a unique email ID." },
        { status: 409 }
      );
    }

    const { data: tenant, error: tenantErr } = await supabase
      .from("tenants")
      .insert({
        name: tenant_name.trim(),
        max_licenses: seats,
        telephony_config,
        status: "active",
      })
      .select()
      .single();

    if (tenantErr) {
      return NextResponse.json({ error: tenantErr.message }, { status: 400 });
    }

    const nowIso = new Date().toISOString();
    await supabase.from("license_periods").insert({
      tenant_id: tenant.id,
      seat_count: seats,
      starts_at: nowIso,
      ends_at: license_ends_at ? new Date(license_ends_at).toISOString() : null,
      reason: "Initial tenant provisioning",
      changed_by: caller.profile.id,
    });

    const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
      email: cleanEmail,
      password: admin_password,
      email_confirm: true,
    });

    if (authErr) {
      await supabase.from("license_periods").delete().eq("tenant_id", tenant.id);
      await supabase.from("tenants").delete().eq("id", tenant.id);
      return NextResponse.json({ error: authErr.message }, { status: 400 });
    }

    const { data: profile, error: profErr } = await supabase
      .from("profiles")
      .insert({
        id: authUser.user.id,
        tenant_id: tenant.id,
        full_name: admin_name.trim(),
        email: cleanEmail,
        role: "tenant_admin",
        is_active: true,
      })
      .select()
      .single();

    if (profErr) {
      await supabase.auth.admin.deleteUser(authUser.user.id).catch(() => {});
      await supabase.from("license_periods").delete().eq("tenant_id", tenant.id);
      await supabase.from("tenants").delete().eq("id", tenant.id);
      return NextResponse.json({ error: profErr.message }, { status: 400 });
    }

    return NextResponse.json({ tenant, admin: profile }, { status: 201 });
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
    if (!["super_admin", "platform_ops"].includes(caller.profile.role)) {
      return NextResponse.json({ error: "Not authorized to update tenant licenses" }, { status: 403 });
    }

    const body = await req.json();
    const tenantId = body.tenant_id;
    const seatCount = Number(body.max_licenses ?? body.seat_count);
    if (!tenantId || Number.isNaN(seatCount) || seatCount < 0) {
      return NextResponse.json(
        { error: "tenant_id and valid non-negative seat count are required" },
        { status: 400 }
      );
    }

    const startsAt = body.starts_at ? new Date(body.starts_at).toISOString() : new Date().toISOString();
    const endsAt = body.ends_at ? new Date(body.ends_at).toISOString() : null;
    const reason = String(body.reason || "").trim() || "Seat / license update";

    await supabase
      .from("license_periods")
      .update({ ends_at: startsAt })
      .eq("tenant_id", tenantId)
      .is("ends_at", null);

    const { data: period, error: lpErr } = await supabase
      .from("license_periods")
      .insert({
        tenant_id: tenantId,
        seat_count: seatCount,
        starts_at: startsAt,
        ends_at: endsAt,
        reason,
        changed_by: caller.profile.id,
      })
      .select()
      .single();

    if (lpErr) return NextResponse.json({ error: lpErr.message }, { status: 400 });

    const { data: updatedTenant, error: tErr } = await supabase
      .from("tenants")
      .update({
        max_licenses: seatCount,
        ...(body.status ? { status: body.status } : {}),
      })
      .eq("id", tenantId)
      .select()
      .single();

    if (tErr) return NextResponse.json({ error: tErr.message }, { status: 400 });

    return NextResponse.json({
      tenant: updatedTenant,
      license_period: period,
      changed_by: caller.profile.id,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    const supabase = getServiceSupabase();
    const caller = await getCallerProfile(req, supabase);
    if (caller.error) {
      return NextResponse.json({ error: caller.error }, { status: caller.status });
    }
    if (caller.profile.role !== "super_admin") {
      return NextResponse.json({ error: "Only super_admin can delete tenants" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const tenantId = body.tenant_id || new URL(req.url).searchParams.get("tenant_id");
    if (!tenantId) {
      return NextResponse.json({ error: "tenant_id is required" }, { status: 400 });
    }

    const { data: members } = await supabase
      .from("profiles")
      .select("id")
      .eq("tenant_id", tenantId);

    for (const m of members || []) {
      await supabase.auth.admin.deleteUser(m.id).catch(() => {});
    }

    const { error: delErr } = await supabase.from("tenants").delete().eq("id", tenantId);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 400 });

    return NextResponse.json({ ok: true, deleted_tenant_id: tenantId });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
