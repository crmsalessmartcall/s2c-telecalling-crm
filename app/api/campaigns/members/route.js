import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

async function authenticateRequest(req, supabase) {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) {
    return { error: "Missing authorization token.", status: 401 };
  }

  const { data: authData, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !authData?.user) {
    return { error: "Invalid or expired session.", status: 401 };
  }

  const { data: callerProfile, error: profErr } = await supabase
    .from("profiles")
    .select("id, role, tenant_id")
    .eq("id", authData.user.id)
    .maybeSingle();

  if (profErr || !callerProfile) {
    return { error: "Caller profile not found.", status: 403 };
  }

  return { callerProfile };
}

export async function GET(req) {
  try {
    const supabase = getServiceSupabase();
    if (!supabase) {
      return NextResponse.json({ error: "Supabase server client not configured." }, { status: 500 });
    }

    const auth = await authenticateRequest(req, supabase);
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const { callerProfile } = auth;

    const { searchParams } = new URL(req.url);
    const requestedTenantId = searchParams.get("tenant_id");
    const campaignId = searchParams.get("campaign_id") || searchParams.get("project_id");

    const effectiveTenantId =
      callerProfile.role === "super_admin"
        ? requestedTenantId || callerProfile.tenant_id
        : callerProfile.tenant_id;

    let query = supabase.from("campaign_members").select("*");
    if (effectiveTenantId) {
      query = query.eq("tenant_id", effectiveTenantId);
    } else if (callerProfile.role !== "super_admin") {
      return NextResponse.json({ error: "No tenant assigned to user." }, { status: 400 });
    }
    if (campaignId) {
      query = query.eq("campaign_id", campaignId);
    }

    const { data: members, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ members: members || [] });
  } catch (err) {
    return NextResponse.json({ error: err?.message || "Failed to load campaign members." }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const supabase = getServiceSupabase();
    if (!supabase) {
      return NextResponse.json({ error: "Supabase server client not configured." }, { status: 500 });
    }

    const auth = await authenticateRequest(req, supabase);
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const { callerProfile } = auth;

    const body = await req.json().catch(() => ({}));
    const {
      campaign_id,
      project_id,
      user_id,
      action = "toggle",
      member_role = "agent",
      tenant_id,
    } = body || {};

    const targetCampaignId = campaign_id || project_id;
    if (!targetCampaignId || !user_id) {
      return NextResponse.json({ error: "campaign_id and user_id are required." }, { status: 400 });
    }

    const effectiveTenantId =
      callerProfile.role === "super_admin"
        ? tenant_id || callerProfile.tenant_id
        : callerProfile.tenant_id;

    const { data: existing, error: fetchErr } = await supabase
      .from("campaign_members")
      .select("id")
      .eq("campaign_id", targetCampaignId)
      .eq("user_id", user_id)
      .maybeSingle();

    if (fetchErr) {
      return NextResponse.json({ error: fetchErr.message }, { status: 400 });
    }

    const shouldRemove = action === "remove" || (action === "toggle" && Boolean(existing));

    if (shouldRemove) {
      if (existing?.id) {
        const { error: delErr } = await supabase
          .from("campaign_members")
          .delete()
          .eq("id", existing.id);
        if (delErr) {
          return NextResponse.json({ error: delErr.message }, { status: 400 });
        }
      }
      return NextResponse.json({
        ok: true,
        assigned: false,
        campaign_id: targetCampaignId,
        user_id,
      });
    }

    const payload = {
      campaign_id: targetCampaignId,
      user_id,
      member_role,
      ...(effectiveTenantId ? { tenant_id: effectiveTenantId } : {}),
    };

    const { data: inserted, error: insErr } = await supabase
      .from("campaign_members")
      .upsert(payload, { onConflict: "campaign_id,user_id" })
      .select("*")
      .single();

    if (insErr) {
      return NextResponse.json({ error: insErr.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, assigned: true, member: inserted });
  } catch (err) {
    return NextResponse.json(
      { error: err?.message || "Failed to update campaign member." },
      { status: 500 }
    );
  }
}

export async function DELETE(req) {
  try {
    const supabase = getServiceSupabase();
    if (!supabase) {
      return NextResponse.json({ error: "Supabase server client not configured." }, { status: 500 });
    }

    const auth = await authenticateRequest(req, supabase);
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { searchParams } = new URL(req.url);
    const body = await req.json().catch(() => ({}));
    const campaignId =
      searchParams.get("campaign_id") ||
      searchParams.get("project_id") ||
      body.campaign_id ||
      body.project_id;
    const userId = searchParams.get("user_id") || body.user_id;

    if (!campaignId || !userId) {
      return NextResponse.json({ error: "campaign_id and user_id are required." }, { status: 400 });
    }

    const { error: delErr } = await supabase
      .from("campaign_members")
      .delete()
      .eq("campaign_id", campaignId)
      .eq("user_id", userId);

    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, assigned: false, campaign_id: campaignId, user_id: userId });
  } catch (err) {
    return NextResponse.json(
      { error: err?.message || "Failed to remove campaign member." },
      { status: 500 }
    );
  }
}
