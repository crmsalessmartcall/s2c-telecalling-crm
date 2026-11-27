import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { normalizeAndValidatePhone } from "@/lib/ingestHelpers";

function getSupabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function extractPhoneFromText(text) {
  const matches = String(text || "").match(/(?:\+?\d[\d\s\-()]{8,14}\d)/g) || [];
  for (const m of matches) {
    const check = normalizeAndValidatePhone(m);
    if (check.valid) return check.normalized;
  }
  return "";
}

function extractEmailAddress(raw) {
  const match = String(raw || "").match(/[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+/);
  return match ? match[0].trim() : null;
}

export async function POST(req) {
  try {
    const supabase = getSupabaseServer();
    if (!supabase) {
      return NextResponse.json({ error: "Supabase server client not configured." }, { status: 500 });
    }

    const body = await req.json();
    const textBlob = `${body?.subject || ""} ${body?.text || body?.body || ""}`;
    const phone =
      normalizeAndValidatePhone(body?.phone).normalized || extractPhoneFromText(textBlob);

    if (!phone) {
      return NextResponse.json(
        { error: "Could not extract a valid 10-digit phone number from inbound email." },
        { status: 400 }
      );
    }

    const senderEmail = extractEmailAddress(body?.email || body?.from || "");
    const senderName =
      String(body?.name || "").trim() ||
      String(body?.from || "")
        .replace(/<[^>]+>/g, "")
        .split("@")[0]
        .trim() ||
      `Email Lead ${phone.slice(-4)}`;

    let projectId = body?.project_id || body?.campaign_id || null;
    let tenantId = body?.tenant_id || null;

    if (!projectId && body?.to) {
      const toEmail = extractEmailAddress(body.to);
      if (toEmail) {
        const { data: proj } = await supabase
          .from("projects")
          .select("id, tenant_id")
          .ilike("inbound_email", toEmail)
          .maybeSingle();
        if (proj) {
          projectId = proj.id;
          tenantId = tenantId || proj.tenant_id;
        }
      }
    }

    const notes = [
      body?.subject ? `Subject: ${body.subject}` : "",
      body?.text || body?.body ? String(body.text || body.body).trim() : "",
    ]
      .filter(Boolean)
      .join("\n");

    const { data: lead, error } = await supabase
      .from("leads")
      .insert({
        name: senderName,
        phone,
        email: senderEmail,
        notes: notes || "Inbound email inquiry",
        status: "new",
        source: "email",
        custom_fields: body?.custom_fields && typeof body.custom_fields === "object" ? body.custom_fields : {},
        ...(projectId ? { project_id: projectId } : {}),
        ...(tenantId ? { tenant_id: tenantId } : {}),
      })
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, source: "email", lead }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err?.message || "Failed to process inbound email." }, { status: 500 });
  }
}
