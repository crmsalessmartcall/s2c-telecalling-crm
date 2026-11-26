import { NextResponse } from "next/server";
import { getServiceSupabase, getCallerProfile } from "@/lib/supabaseServer";

function isPeriodActiveAt(period, nowMs = Date.now()) {
  const startMs = period.starts_at ? new Date(period.starts_at).getTime() : -Infinity;
  const endMs = period.ends_at ? new Date(period.ends_at).getTime() : Infinity;
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return false;
  return startMs <= nowMs && nowMs < endMs;
}

export async function computeActiveSeats(supabase, tenantId) {
  const { data: periods, error } = await supabase
    .from("license_periods")
    .select("id, seat_count, starts_at, ends_at")
    .eq("tenant_id", tenantId);

  if (error || !periods || periods.length === 0) {
    const { data: t } = await supabase
      .from("tenants")
      .select("max_licenses")
      .eq("id", tenantId)
      .maybeSingle();
    return Number(t?.max_licenses ?? 0);
  }

  const nowMs = Date.now();
  const activeSum = periods
    .filter((p) => isPeriodActiveAt(p, nowMs))
    .reduce((sum, p) => sum + Math.max(0, Number(p.seat_count || 0)), 0);

  return activeSum;
}

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

    const nowMs = Date.now();
    const profileMap = new Map((profiles || []).map((pr) => [pr.id, pr]));

    const enriched = (tenants || []).map((t) => {
      const members = (profiles || []).filter((p) => p.tenant_id === t.id);
      const activeUsersCount = members.filter((p) => p.is_active).length;

      const history = lpErr
        ? []
        : (periods || [])
            .filter((lp) => lp.tenant_id === t.id)
            .map((lp) => {
              const actor = profileMap.get(lp.changed_by);
              const isActiveNow = isPeriodActiveAt(lp, nowMs);
              return {
                ...lp,
                is_active_now: isActiveNow,
                changed_by_name: actor?.full_name || null,
                changed_by_email: actor?.email || null,
              };
            });

      const activeSeats =
        !lpErr && history.length > 0
          ? history
              .filter((h) => h.is_active_now)
              .reduce((sum, h) => sum + Math.max(0, Number(h.seat_count || 0)), 0)
          : Number(t.max_licenses || 0);

      const overCapacity = Math.max(0, activeUsersCount - activeSeats);

      return {
        ...t,
        max_licenses: activeSeats,
        active_seats: activeSeats,
        used_licenses: activeUsersCount,
        remaining_licenses: Math.max(0, activeSeats - activeUsersCount),
        over_capacity: overCapacity,
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
      license_starts_at = null,
      license_ends_at = null,
      reason = "Initial seat block",
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
      .ilike("email", cleanEmail)
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

    const startsAtIso = license_starts_at
      ? new Date(license_starts_at).toISOString()
      : new Date().toISOString();
    const endsAtIso = license_ends_at ? new Date(license_ends_at).toISOString() : null;

    await supabase.from("license_periods").insert({
      tenant_id: tenant.id,
      seat_count: seats,
      starts_at: startsAtIso,
      ends_at: endsAtIso,
      reason: String(reason || "Initial seat block").trim(),
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
    const action = body.action || "add_block";
    const tenantId = body.tenant_id;

    if (!tenantId) {
      return NextResponse.json({ error: "tenant_id is required" }, { status: 400 });
    }

    // Option A: End an existing seat block early
    if (action === "end_block") {
      if (!body.period_id) {
        return NextResponse.json({ error: "period_id is required to end a block" }, { status: 400 });
      }
      const endIso = body.ends_at ? new Date(body.ends_at).toISOString() : new Date().toISOString();
      const { error: updErr } = await supabase
        .from("license_periods")
        .update({ ends_at: endIso })
        .eq("id", body.period_id)
        .eq("tenant_id", tenantId);

      if (updErr) return NextResponse.json({ error: updErr.message }, { status: 400 });

      const activeSeats = await computeActiveSeats(supabase, tenantId);
      await supabase.from("tenants").update({ max_licenses: activeSeats }).eq("id", tenantId);

      return NextResponse.json({ ok: true, active_seats: activeSeats, changed_by: caller.profile.id });
    }

    // Option B: Add a new time-bound seat block (e.g. +3 seats for 1 month, +2 seats for 6 months)
    const seatCount = Number(body.seat_count ?? body.max_licenses);
    if (Number.isNaN(seatCount) || seatCount <= 0) {
      return NextResponse.json(
        { error: "seat_count must be a positive number (e.g. 3 for 1 month, 2 for 6 months)" },
        { status: 400 }
      );
    }

    const startsAt = body.starts_at ? new Date(body.starts_at).toISOString() : new Date().toISOString();
    let endsAt = null;
    if (body.ends_at) {
      endsAt = new Date(body.ends_at).toISOString();
    } else if (body.duration_months && Number(body.duration_months) > 0) {
      const d = new Date(startsAt);
      d.setMonth(d.getMonth() + Number(body.duration_months));
      endsAt = d.toISOString();
    }

    const reason = String(body.reason || "").trim() || "Seat block added";

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

    const activeSeats = await computeActiveSeats(supabase, tenantId);

    const { data: updatedTenant, error: tErr } = await supabase
      .from("tenants")
      .update({
        max_licenses: activeSeats,
        ...(body.status ? { status: body.status } : {}),
      })
      .eq("id", tenantId)
      .select()
      .single();

    if (tErr) return NextResponse.json({ error: tErr.message }, { status: 400 });

    return NextResponse.json({
      tenant: updatedTenant,
      active_seats: activeSeats,
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
