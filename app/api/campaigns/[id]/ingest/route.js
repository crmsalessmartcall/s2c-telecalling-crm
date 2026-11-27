import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  extractCustomFieldsFromRow,
  normalizeAndValidatePhone,
} from "@/lib/ingestHelpers";

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

const STD_KEYS = new Set([
  "name",
  "customer_name",
  "phone",
  "customer_number",
  "email",
  "notes",
  "custom_fields",
]);

export async function POST(req, context) {
  try {
    const supabase = getSupabaseServer();
    if (!supabase) {
      return NextResponse.json(
        { error: "Supabase server client not configured." },
        { status: 500 }
      );
    }

    const params = await context.params;
    const campaignId = String(params?.id || "").trim();
    if (!campaignId) {
      return NextResponse.json({ error: "Campaign ID is required." }, { status: 400 });
    }

    let tenantId = null;
    try {
      const { data: campaign } = await supabase
        .from("projects")
        .select("id, tenant_id, ingest_token")
        .eq("id", campaignId)
        .maybeSingle();

      if (campaign) {
        tenantId = campaign.tenant_id || null;
        const urlToken = new URL(req.url).searchParams.get("token") || "";
        const headerToken =
          req.headers.get("x-ingest-token") ||
          (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
        const providedToken = headerToken || urlToken;

        if (campaign.ingest_token && providedToken !== campaign.ingest_token) {
          return NextResponse.json({ error: "Invalid campaign API token." }, { status: 401 });
        }
      }
    } catch {
      // Proceed with campaignId as project_id if optional columns/tables aren't present
    }

    const body = await req.json();
    const rawPhone = body?.phone ?? body?.customer_number ?? body?.mobile ?? "";
    const phoneCheck = normalizeAndValidatePhone(rawPhone);
    if (!phoneCheck.valid) {
      return NextResponse.json({ error: phoneCheck.reason }, { status: 400 });
    }

    const name =
      String(body?.name ?? body?.customer_name ?? "").trim() ||
      `API Lead ${phoneCheck.normalized.slice(-4)}`;
    const email = String(body?.email ?? "").trim() || null;
    const notes = String(body?.notes ?? "").trim() || "Ingested via Campaign API";
    const customFields = extractCustomFieldsFromRow(body, STD_KEYS);

    const { data: lead, error: insErr } = await supabase
      .from("leads")
      .insert({
        name,
        phone: phoneCheck.normalized,
        email,
        notes,
        status: "new",
        source: "api",
        custom_fields: customFields,
        project_id: campaignId,
        ...(tenantId ? { tenant_id: tenantId } : {}),
      })
      .select("*")
      .single();

    if (insErr) {
      return NextResponse.json({ error: insErr.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, source: "api", lead }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err?.message || "API lead ingestion failed." },
      { status: 500 }
    );
  }
}
