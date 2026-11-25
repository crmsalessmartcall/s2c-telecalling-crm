import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabaseServer";

export async function GET() {
  return NextResponse.json({ ok: true, service: "s2c-telecalling-crm-webhook" });
}

export async function POST(req) {
  try {
    const payload = await req.json().catch(() => ({}));
    const callId = payload.call_id || payload.callId || payload.sid || null;
    const rawStatus = String(payload.status || payload.event || "").toLowerCase();

    const stateMap = {
      initiated: "initiated",
      ringing: "ringing",
      answered: "connected",
      connected: "connected",
      hold: "on_hold",
      on_hold: "on_hold",
      transferred: "transferred",
      completed: "ended",
      ended: "ended",
      failed: "failed",
      busy: "failed",
      no_answer: "failed",
    };

    const mappedState = stateMap[rawStatus];

    if (callId && mappedState) {
      const supabase = getServiceSupabase();
      const updatePayload = {
        call_state: mappedState,
        raw_webhook_payload: payload,
      };
      if (typeof payload.duration === "number") {
        updatePayload.duration_seconds = payload.duration;
      }
      if (payload.recording_url) {
        updatePayload.recording_url = payload.recording_url;
      }
      if (mappedState === "ended" || mappedState === "failed") {
        updatePayload.ended_at = new Date().toISOString();
      }

      await supabase
        .from("call_logs")
        .update(updatePayload)
        .eq("external_call_id", String(callId));
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
