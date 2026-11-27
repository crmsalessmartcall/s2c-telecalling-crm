import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function POST(req) {
  try {
    const supabase = getSupabaseServer();
    if (!supabase) {
      return NextResponse.json({ error: "Supabase server client not configured." }, { status: 500 });
    }

    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) {
      return NextResponse.json({ error: "Missing authorization token." }, { status: 401 });
    }

    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !authData?.user) {
      return NextResponse.json({ error: "Invalid or expired session." }, { status: 401 });
    }

    const { data: callerProfile } = await supabase
      .from("profiles")
      .select("id, role, tenant_id")
      .eq("id", authData.user.id)
      .maybeSingle();

    if (!callerProfile) {
      return NextResponse.json({ error: "Caller profile not found." }, { status: 403 });
    }

    const body = await req.json();
    const { campaign_id, user_id, action = "toggle", member_role = "agent", tenant_id } = body || {};

    if (!campaign_id || !user_id) {
      return NextResponse.json({ error: "campaign_id and user_id are required." }, { status: 400 });
    }

    const effectiveTenantId =
      callerProfile.role === "super_admin" ? tenant_id || callerProfile.tenant_id : callerProfile.tenant_id;

    const { data: existing, error: fetchErr } = await supabase
      .from("campaign_members")
      .select("id")
      .eq("campaign_id", campaign_id)
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
      return NextResponse.json({ ok: true, assigned: false, campaign_id, user_id });
    }

    const payload = {
      campaign_id,
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
    return NextResponse.json({ error: err?.message || "Failed to update campaign member." }, { status: 500 });
  }
}
