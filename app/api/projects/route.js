export async function PATCH(req) {
  try {
    const supabase = getServiceSupabase();
    const caller = await getCallerProfile(req, supabase);
    if (caller.error) {
      return NextResponse.json({ error: caller.error }, { status: 401 });
    }
    if (!["super_admin", "tenant_admin"].includes(caller.profile.role)) {
      return NextResponse.json({ error: "Only admin can update campaigns" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const projectId = body.id || body.project_id || body.campaign_id;
    if (!projectId) {
      return NextResponse.json({ error: "Campaign id is required" }, { status: 400 });
    }

    const { data: existing, error: fetchErr } = await supabase
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .maybeSingle();

    if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 400 });
    if (!existing) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    if (
      caller.profile.role !== "super_admin" &&
      existing.tenant_id !== caller.profile.tenant_id
    ) {
      return NextResponse.json({ error: "Not authorized for this campaign" }, { status: 403 });
    }

    const updates = {};
    if (typeof body.status === "string" && body.status.trim()) {
      updates.status = body.status.trim();
    } else if (typeof body.archived === "boolean") {
      updates.status = body.archived ? "archived" : "active";
    } else if (body.action === "archive") {
      updates.status = "archived";
    } else if (body.action === "unarchive" || body.action === "activate") {
      updates.status = "active";
    }

    if (typeof body.name === "string" && body.name.trim()) {
      updates.name = body.name.trim();
    }
    if (body.description !== undefined) {
      updates.description = body.description === null ? null : String(body.description).trim();
    }
    if (typeof body.hide_phone_numbers === "boolean") {
      updates.hide_phone_numbers = body.hide_phone_numbers;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields provided to update" }, { status: 400 });
    }

    const { data: project, error: updErr } = await supabase
      .from("projects")
      .update(updates)
      .eq("id", projectId)
      .select()
      .single();

    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 400 });

    return NextResponse.json({ project });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
