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
    if (!caller.profile.tenant_id) {
      return NextResponse.json({ error: "No tenant assigned to caller" }, { status: 400 });
    }

    const tenantId = caller.profile.tenant_id;
    const [{ data: tenant }, { data: users, error: uErr }] = await Promise.all([
      supabase.from("tenants").select("*").eq("id", tenantId).single(),
      supabase
        .from("profiles")
        .select("id, full_name, email, role, is_active, created_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: true }),
    ]);

    if (uErr) return NextResponse.json({ error: uErr.message }, { status: 400 });

    const activeSeats = await computeActiveSeats(supabase, tenantId);
    const list = users || [];
    const usedLicenses = list.filter((u) => u.is_active).length;

    return NextResponse.json({
      tenant: { ...tenant, max_licenses: activeSeats },
      active_seats: activeSeats,
      used_licenses: usedLicenses,
      remaining_licenses: Math.max(0, activeSeats - usedLicenses),
      over_capacity: Math.max(0, usedLicenses - activeSeats),
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

    if (!fullName || !email || !password) {
      return NextResponse.json(
        { error: "full_name, email, and password are required" },
        { status: 400 }
      );
    }
    if (!["supervisor", "team_leader", "agent"].includes(role)) {
      return NextResponse.json({ error: "Invalid user role" }, { status: 400 });
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
    const userId = body.user_id;
    if (!userId || typeof body.is_active !== "boolean") {
      return NextResponse.json({ error: "user_id and boolean is_active are required" }, { status: 400 });
    }

    const tenantId = caller.profile.tenant_id;
    const { data: target } = await supabase
      .from("profiles")
      .select("id, tenant_id, is_active, role")
      .eq("id", userId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (!target) {
      return NextResponse.json({ error: "User not found in your tenant" }, { status: 404 });
    }

    // If activating a previously disabled user, verify seat availability
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
      .eq("id", userId)
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
    const userId = body.user_id || new URL(req.url).searchParams.get("user_id");
    if (!userId) {
      return NextResponse.json({ error: "user_id is required" }, { status: 400 });
    }
    if (userId === caller.profile.id) {
      return NextResponse.json({ error: "You cannot delete your own admin account" }, { status: 400 });
    }

    const tenantId = caller.profile.tenant_id;
    const { data: target } = await supabase
      .from("profiles")
      .select("id, tenant_id")
      .eq("id", userId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (!target) {
      return NextResponse.json({ error: "User not found in your tenant" }, { status: 404 });
    }

    await supabase.from("profiles").delete().eq("id", userId).eq("tenant_id", tenantId);
    await supabase.auth.admin.deleteUser(userId).catch(() => {});

    return NextResponse.json({ ok: true, deleted_user_id: userId });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
