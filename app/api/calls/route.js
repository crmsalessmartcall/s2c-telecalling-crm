import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { normalizeAndValidatePhone } from "@/lib/ingestHelpers";

const DEFAULT_SUPABASE_URL = "https://yabrgtrerjyzahmswbzw.supabase.co";

function getSupabaseServer() {
  const url =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    DEFAULT_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

async function authenticateRequest(req, supabase) {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    return { error: NextResponse.json({ error: "Missing authorization token." }, { status: 401 }) };
  }

  const { data: authData, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !authData?.user) {
    return { error: NextResponse.json({ error: "Invalid or expired session." }, { status: 401 }) };
  }

  const { data: profile, error: profErr } = await supabase
    .from("profiles")
    .select("id, role, tenant_id, is_active")
    .eq("id", authData.user.id)
    .maybeSingle();

  if (profErr || !profile) {
    return { error: NextResponse.json({ error: "User profile not found." }, { status: 403 }) };
  }

  if (profile.is_active === false) {
    return { error: NextResponse.json({ error: "User account is disabled." }, { status: 403 }) };
  }

  return { user: authData.user, profile };
}

function resolveTenantScope(profile, requestedTenantId) {
  if (profile.role === "super_admin") {
    return requestedTenantId || profile.tenant_id || null;
  }
  return profile.tenant_id || null;
}

export async function GET(req) {
  try {
    const supabase = getSupabaseServer();
    if (!supabase) {
      return NextResponse.json({ error: "Supabase server client not configured." }, { status: 500 });
    }

    const auth = await authenticateRequest(req, supabase);
    if (auth.error) return auth.error;
    const { profile } = auth;

    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("project_id") || "";
    const requestedTenantId = searchParams.get("tenant_id") || "";
    const tenantId = resolveTenantScope(profile, requestedTenantId);

    let query = supabase
      .from("call_logs")
      .select("*")
      .order("created_at", { ascending: false });

    if (tenantId) query = query.eq("tenant_id", tenantId);
    if (projectId) query = query.eq("project_id", projectId);

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, calls: data || [] });
  } catch (err) {
    return NextResponse.json({ error: err?.message || "Failed to load call logs." }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const supabase = getSupabaseServer();
    if (!supabase) {
      return NextResponse.json({ error: "Supabase server client not configured." }, { status: 500 });
    }

    const auth = await authenticateRequest(req, supabase);
    if (auth.error) return auth.error;
    const { user, profile } = auth;

    const body = await req.json();
    const tenantId = resolveTenantScope(profile, body?.tenant_id);
    const projectId = body?.project_id || null;
    const leadId = body?.lead_id || null;

    const rawPhone = body?.phone ?? "";
    const phoneCheck = normalizeAndValidatePhone(rawPhone);
    if (!phoneCheck.valid) {
      return NextResponse.json({ error: phoneCheck.reason }, { status: 400 });
    }

    const durationSeconds = Math.max(0, Number(body?.duration_seconds ?? 0) || 0);
    const callStatus = body?.status || "connected";
    const disposition = body?.disposition || null;
    const notes = body?.notes ?? null;
    const followUpAt = body?.follow_up_at || null;
    const customFields =
      body?.custom_fields && typeof body.custom_fields === "object" ? body.custom_fields : {};

    const callPayload = {
      phone: phoneCheck.normalized,
      status: callStatus,
      disposition,
      notes,
      duration_seconds: durationSeconds,
      custom_fields: customFields,
      provider: body?.provider || "smartcall",
      ...(projectId ? { project_id: projectId } : {}),
      ...(leadId ? { lead_id: leadId } : {}),
      ...(tenantId ? { tenant_id: tenantId } : {}),
      ...(user?.id ? { agent_id: user.id } : {}),
    };

    const { data: callLog, error: callErr } = await supabase
      .from("call_logs")
      .insert(callPayload)
      .select("*")
      .single();

    if (callErr) {
      return NextResponse.json({ error: callErr.message }, { status: 400 });
    }

    if (leadId) {
      const nextLeadStatus = followUpAt
        ? "follow_up"
        : callStatus === "completed" || callStatus === "connected"
        ? "contacted"
        : callStatus;

      const leadPatch = {
        last_called_at: new Date().toISOString(),
        status: nextLeadStatus,
        ...(disposition !== null ? { disposition } : {}),
        ...(notes !== null ? { notes } : {}),
        ...(followUpAt ? { follow_up_at: followUpAt } : {}),
        ...(Object.keys(customFields).length > 0 ? { custom_fields: customFields } : {}),
      };

      await supabase.from("leads").update(leadPatch).eq("id", leadId);
    }

    return NextResponse.json({ ok: true, call: callLog }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err?.message || "Failed to save call log." }, { status: 500 });
  }
}
