import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabaseServer";

export async function POST(req) {
  try {
    const expectedSecret = process.env.SMARTCALL_WEBHOOK_SECRET;
    if (expectedSecret) {
      const provided =
        req.headers.get("x-smartcall-secret") ||
        req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
      if (provided !== expectedSecret) {
        return NextResponse.json({ error: "Invalid webhook secret" }, { status: 401 });
      }
    }

    const body = await req.json();
    const tenantId = body.tenant_id;
    const phone = String(body.phone || body.customer_number || "").trim();

    if (!tenantId || !phone) {
      return NextResponse.json(
        { error: "tenant_id and phone (or customer_number) are required" },
        { status: 400 }
      );
    }

    const supabase = getServiceSupabase();
    const durationSeconds = Math.max(0, Number(body.duration_seconds ?? body.duration ?? 0));
    const status = String(body.status || body.event || "completed").trim();
    const disposition = body.disposition ? String(body.disposition).trim() : null;

    const { data: created, error } = await supabase
      .from("call_logs")
      .insert({
        tenant_id: tenantId,
        project_id: body.project_id || null,
        lead_id: body.lead_id || null,
        agent_id: body.agent_id || null,
        phone,
        provider: "smartcall",
        external_call_id: body.call_id || body.external_call_id || null,
        status,
        disposition,
        notes: body.notes || body.recording_url || null,
        custom_fields: body.custom_fields && typeof body.custom_fields === "object" ? body.custom_fields : {},
        duration_seconds: durationSeconds,
        started_at: body.started_at || new Date().toISOString(),
        ended_at: body.ended_at || new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (body.lead_id) {
      const patch = { last_called_at: new Date().toISOString() };
      if (disposition) patch.disposition = disposition;
      await supabase.from("leads").update(patch).eq("id", body.lead_id).eq("tenant_id", tenantId);
    }

    return NextResponse.json({ ok: true, call: created }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
