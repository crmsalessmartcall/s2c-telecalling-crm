import { NextResponse } from "next/server";
import { getServiceSupabase, getCallerProfile } from "@/lib/supabaseServer";
import { computeActiveSeats, getLicensePeriodState } from "@/app/api/admin/tenants/route";

function normalizeUserId(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function validateUserIdFormat(uid) {
  if (!uid) return "User ID is required.";
  if (uid.length > 20) return "User ID must be at most 20 characters.";
  if (!/^[a-z0-9._-]+$/.test(uid)) {
    return "User ID can only contain lowercase letters, numbers, dots (.), underscores (_), or hyphens (-).";
  }
  return null;
}

async function suggestNextUserId(supabase, desiredId) {
  const base = desiredId.replace(/\d+$/, "") || desiredId.slice(0, 17) || "user";
  const { data: similar } = await supabase
    .from("profiles")
    .select("user_id")
    .ilike("user_id", `${base}%`);

  const taken = new Set(
    (similar || []).map((r) => String(r.user_id || "").trim().toLowerCase())
  );

  if (!taken.has(desiredId)) return desiredId;

  for (let i = 1; i <= 9999; i += 1) {
    const suffix = String(i);
    const candidate = `${base.slice(0, 20 - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base.slice(0, 15)}${Date.now().toString().slice(-5)}`;
}

export async function GET(req) {
  try {
    const supabase = getServiceSupabase();
    const caller = await getCallerProfile(req, supabase);
    if (caller.error) {
      return NextResponse.json({ error: caller.error }, { status: caller.status });
    }
    if (!caller.profile.tenant_id) {
      return NextResponse.json({ error: "No tenant assigned to caller" }, { status: 400 });
    }

    const tenantId = caller.profile.tenant_id;
    const [{ data: tenant }, { data: users, error: uErr }, { data: periods, error: lpErr }] =
      await Promise.all([
        supabase.from("tenants").select("*").eq("id", tenantId).single(),
        supabase
          .from("profiles")
          .select("id, user_id, full_name, email, role, is_active, created_at")
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: true }),
        supabase
          .from("license_periods")
          .select("id, tenant_id, seat_count, starts_at, ends_at, reason, created_at")
          .eq("tenant_id", tenantId)
          .order("starts_at", { ascending: false }),
      ]);

    if (uErr) return NextResponse.json({ error: uErr.message }, { status: 400 });

    const activeSeats = await computeActiveSeats(supabase, tenantId);
    const list = users || [];
    const usedLicenses = list.filter((u) => u.is_active).length;
    const nowMs = Date.now();

    const licenseHistory = lpErr
      ? []
      : (periods || []).map((p) => {
          const statusInfo = getLicensePeriodState(p, nowMs);
          return {
            ...p,
            period_state: statusInfo.state,
            period_label: statusInfo.label,
            is_active_now: statusInfo.isActiveNow,
          };
        });

    return NextResponse.json({
      tenant: { ...tenant, max_licenses: activeSeats },
      active_seats: activeSeats,
      used_licenses: usedLicenses,
      remaining_licenses: Math.max(0, activeSeats - usedLicenses),
      over_capacity: Math.max(0, usedLicenses - activeSeats),
      license_periods: licenseHistory,
      users: list,
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
    if (caller.profile.role !== "tenant_admin" || !caller.profile.tenant_id) {
      return NextResponse.json({ error: "Only tenant_admin can add users" }, { status: 403 });
    }

    const body = await req.json();
    const fullName = String(body.full_name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const role = body.role || "agent";
    const humanUserId = normalizeUserId(body.user_id || body.username);

    if (!fullName || !email || !password || !humanUserId) {
      return NextResponse.json(
        { error: "user_id, full_name, email, and password are required" },
        { status: 400 }
      );
    }

    const idFormatErr = validateUserIdFormat(humanUserId);
    if (idFormatErr) {
      return NextResponse.json({ error: idFormatErr }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters" },
        { status: 400 }
      );
    }
    if (!["supervisor", "team_leader", "agent"].includes(role)) {
      return NextResponse.json({ error: "Invalid user role" }, { status: 400 });
    }

    // Check uniqueness of user_id and suggest e.g. sachin1 if taken
    const { data: dupUserId } = await supabase
      .from("profiles")
      .select("id")
      .ilike("user_id", humanUserId)
      .maybeSingle();

    if (dupUserId) {
      const suggestion = await suggestNextUserId(supabase, humanUserId);
      return NextResponse.json(
        {
          error: `User ID "${humanUserId}" is already in use. Suggested available User ID: "${suggestion}".`,
          suggestion,
        },
        { status: 409 }
      );
    }

    const tenantId = caller.profile.tenant_id;
    const activeSeats = await computeActiveSeats(supabase, tenantId);

    const { data: existingTenantUsers } = await supabase
      .from("profiles")
      .select("id, is_active")
      .eq("tenant_id", tenantId);

    const activeUsersCount = (existingTenantUsers || []).filter((u) => u.is_active).length;
    if (activeUsersCount >= activeSeats) {
      return NextResponse.json(
        {
          error: `Seat limit reached (${activeUsersCount}/${activeSeats} active seats). Disable or remove an active user, or ask Super Admin to add a license block.`,
        },
        { status: 409 }
      );
    }

    const { data: dupEmail } = await supabase
      .from("profiles")
      .select("id")
      .ilike("email", email)
      .maybeSingle();

    if (dupEmail) {
      return NextResponse.json(
        { error: "Email already exists. Please use a unique email ID." },
        { status: 409 }
      );
    }

    const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (authErr) {
      return NextResponse.json({ error: authErr.message }, { status: 400 });
    }

    const { data: created, error: insErr } = await supabase
      .from("profiles")
      .insert({
        id: authUser.user.id,
        tenant_id: tenantId,
        user_id: humanUserId,
        full_name: fullName,
        email,
        role,
        is_active: true,
      })
      .select()
      .single();

    if (insErr) {
      await supabase.auth.admin.deleteUser(authUser.user.id).catch(() => {});
      return NextResponse.json({ error: insErr.message }, { status: 400 });
    }

    return NextResponse.json({ user: created }, { status: 201 });
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
    if (caller.profile.role !== "tenant_admin" || !caller.profile.tenant_id) {
      return NextResponse.json({ error: "Only tenant_admin can update users" }, { status: 403 });
    }

    const body = await req.json();
    // Primary key UUID of the profile row (supports body.id or legacy body.profile_id)
    const profileRowId = body.id || body.profile_id || (typeof body.is_active === "boolean" || body.action === "reset_password" ? body.user_id : null);
    if (!profileRowId) {
      return NextResponse.json({ error: "Profile id is required" }, { status: 400 });
    }

    const tenantId = caller.profile.tenant_id;
    const { data: target } = await supabase
      .from("profiles")
      .select("id, tenant_id, user_id, email, is_active, role")
      .eq("id", profileRowId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (!target) {
      return NextResponse.json({ error: "User not found in your tenant" }, { status: 404 });
    }

    // Update human-readable user_id when body.id (or body.profile_id) and body.user_id are provided
    if ((body.id || body.profile_id) && typeof body.user_id === "string") {
      const nextUserId = normalizeUserId(body.user_id);
      const formatErr = validateUserIdFormat(nextUserId);
      if (formatErr) {
        return NextResponse.json({ error: formatErr }, { status: 400 });
      }

      const { data: conflict } = await supabase
        .from("profiles")
        .select("id")
        .ilike("user_id", nextUserId)
        .neq("id", profileRowId)
        .maybeSingle();

      if (conflict) {
        const suggestion = await suggestNextUserId(supabase, nextUserId);
        return NextResponse.json(
          {
            error: `User ID "${nextUserId}" is already in use. Suggested available User ID: "${suggestion}".`,
            suggestion,
          },
          { status: 409 }
        );
      }

      const { data: updatedUser, error: idErr } = await supabase
        .from("profiles")
        .update({ user_id: nextUserId })
        .eq("id", profileRowId)
        .eq("tenant_id", tenantId)
        .select()
        .single();

      if (idErr) return NextResponse.json({ error: idErr.message }, { status: 400 });
      return NextResponse.json({ user: updatedUser });
    }

    if (body.action === "reset_password" || typeof body.password === "string") {
      const nextPassword = String(body.password || "");
      if (nextPassword.length < 6) {
        return NextResponse.json(
          { error: "New password must be at least 6 characters" },
          { status: 400 }
        );
      }

      const { error: pwErr } = await supabase.auth.admin.updateUserById(profileRowId, {
        password: nextPassword,
      });

      if (pwErr) {
        return NextResponse.json({ error: pwErr.message }, { status: 400 });
      }

      return NextResponse.json({ ok: true, password_reset: true, id: profileRowId });
    }

    if (typeof body.is_active !== "boolean") {
      return NextResponse.json(
        { error: "Provide boolean is_active, user_id, or a new password" },
        { status: 400 }
      );
    }

    if (body.is_active && !target.is_active) {
      const activeSeats = await computeActiveSeats(supabase, tenantId);
      const { data: members } = await supabase
        .from("profiles")
        .select("id, is_active")
        .eq("tenant_id", tenantId);
      const activeUsersCount = (members || []).filter((m) => m.is_active).length;

      if (activeUsersCount >= activeSeats) {
        return NextResponse.json(
          {
            error: `Cannot activate user: all ${activeSeats} active seat(s) are currently in use. Disable another user first or request more seats.`,
          },
          { status: 409 }
        );
      }
    }

    const { data: updated, error: updErr } = await supabase
      .from("profiles")
      .update({ is_active: body.is_active })
      .eq("id", profileRowId)
      .eq("tenant_id", tenantId)
      .select()
      .single();

    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 400 });

    return NextResponse.json({ user: updated });
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
    if (caller.profile.role !== "tenant_admin" || !caller.profile.tenant_id) {
      return NextResponse.json({ error: "Only tenant_admin can delete users" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const profileRowId =
      body.id ||
      body.user_id ||
      new URL(req.url).searchParams.get("id") ||
      new URL(req.url).searchParams.get("user_id");

    if (!profileRowId) {
      return NextResponse.json({ error: "User id is required" }, { status: 400 });
    }
    if (profileRowId === caller.profile.id) {
      return NextResponse.json({ error: "You cannot delete your own admin account" }, { status: 400 });
    }

    const tenantId = caller.profile.tenant_id;
    const { data: target } = await supabase
      .from("profiles")
      .select("id, tenant_id")
      .eq("id", profileRowId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (!target) {
      return NextResponse.json({ error: "User not found in your tenant" }, { status: 404 });
    }

    await supabase.from("profiles").delete().eq("id", profileRowId).eq("tenant_id", tenantId);
    await supabase.auth.admin.deleteUser(profileRowId).catch(() => {});

    return NextResponse.json({ ok: true, deleted_id: profileRowId });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
