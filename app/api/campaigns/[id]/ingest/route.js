import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabaseServer";

export async function POST(req, context) {
  try {
    const supabase = getServiceSupabase();
    const { id } = await context.params;
    const body = await req.json();

    if (!id) {
      return NextResponse.json({ error: "Missing campaign id" }, { status: 400 });
    }

    const phone = String(body?.phone || "").trim();
    const name = String(body?.name || "API Lead").trim();

    if (!phone) {
      return NextResponse.json({ error: "Phone is required" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("leads")
      .insert({
        project_id: id,
        name,
        phone,
        email: body?.email || null,
        source: "api",
        custom_fields: body?.serial_number
          ? { serial_number: String(body.serial_number) }
          : body?.custom_fields || {},
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ lead: data }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err?.message || "Failed to ingest lead" },
      { status: 500 }
    );
  }
}
