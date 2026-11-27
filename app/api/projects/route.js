import { NextResponse } from "next/server";
import { getServiceSupabase, getCallerProfile } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

export async function GET(req) {
  try {
    const supabase = getServiceSupabase();
    const caller = await getCallerProfile(req, supabase);
    if (caller.error) {
      return NextResponse.json({ error: caller.error }, { status: caller.status || 401 });
    }
    if (caller.profile.role === "platform_ops") {
      return NextResponse.json({ error: "Not authorized for campaigns" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const requestedTenantId = searchParams.get("tenant_id");
    const targetTenantId =
      caller.profile.role === "super_admin" && requestedTenantId
        ? requestedTenantId
        : caller.profile.tenant_id;

    let query = supabase.from("projects").select("*").order("created_at", { ascending: false });
    if (targetTenantId) {
      query = query.eq("tenant_id", targetTenantId);
    } else if (caller.profile.role !== "super_admin") {
      return NextResponse.json({ error: "No tenant assigned to user" }, { status: 400 });
    }

    const { data: projects, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ projects: projects || [] });
  } catch (err) {
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const supabase = getServiceSupabase();
    const caller = await getCallerProfile(req, supabase);
    if (caller.error) {
      return NextResponse.json({ error: caller.error }, { status: caller.status || 401 });
    }
    if (!["super_admin", "tenant_admin"].includes(caller.profile.role)) {
      return NextResponse.json({ error: "Only admin can create campaigns" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const name = String(body.name || "").trim();
    const description = String(body.description || "").trim();
    const tenantId =
      caller.profile.role === "super_admin" && body.tenant_id
        ? body.tenant_id
        : caller.profile.tenant_id;

    if (!name) {
      return NextResponse.json({ error: "Campaign name is required" }, { status: 400 });
    }
    if (!tenantId) {
      return NextResponse.json({ error: "tenant_id is required" }, { status: 400 });
    }

    const { data: project, error } = await supabase
      .from("projects")
      .insert({
        tenant_id: tenantId,
        name,
        description: description || null,
        status: "active",
        created_by: caller.profile.id,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ project }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}

export async function PATCH(req) {
  try {
    const supabase = getServiceSupabase();
    const caller = await getCallerProfile(req, supabase);
    if (caller.error) {
      return NextResponse.json({ error: caller.error }, { status: caller.status || 401 });
    }
    if (!["super_admin", "tenant_admin"].includes(caller.profile.role)) {
      return NextResponse.json({ error: "Only admin can update campaigns" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const body = await req.json().catch(() => ({}));
    const projectId =
      body.id ||
      body.project_id ||
      body.campaign_id ||
      searchParams.get("id") ||
      searchParams.get("project_id");

    if (!projectId) {
      return NextResponse.json({ error: "Campaign id is required" }, { status: 400 });
    }

    const { data: existing, error: fetchErr } = await supabase
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .maybeSingle();

    if (fetchErr) {
      return NextResponse.json({ error: fetchErr.message }, { status: 400 });
    }
    if (!existing) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    if (
      caller.profile.role !== "super_admin" &&
      existing.tenant_id !== caller.profile.tenant_id
    ) {
      return NextResponse.json({ error: "Not authorized for this campaign" }, { status: 403 });
    }

    const updates = {};
    if (typeof body.status === "string" && body.status.trim()) {
      updates.status = body.status.trim().toLowerCase();
    } else if (typeof body.archived === "boolean") {
      updates.status = body.archived ? "archived" : "active";
    } else if (typeof body.is_archived === "boolean") {
      updates.status = body.is_archived ? "archived" : "active";
    } else if (body.action === "archive" || body.mode === "archive") {
      updates.status = "archived";
    } else if (
      body.action === "unarchive" ||
      body.action === "activate" ||
      body.action === "restore"
    ) {
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

    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 400 });
    }

    return NextResponse.json({ project });
  } catch (err) {
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    const supabase = getServiceSupabase();
    const caller = await getCallerProfile(req, supabase);
    if (caller.error) {
      return NextResponse.json({ error: caller.error }, { status: caller.status || 401 });
    }
    if (!["super_admin", "tenant_admin"].includes(caller.profile.role)) {
      return NextResponse.json({ error: "Only admin can delete campaigns" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const body = await req.json().catch(() => ({}));
    const projectId =
      searchParams.get("id") ||
      searchParams.get("project_id") ||
      searchParams.get("campaign_id") ||
      body.id ||
      body.project_id ||
      body.campaign_id;

    if (!projectId) {
      return NextResponse.json({ error: "Campaign id is required" }, { status: 400 });
    }

    const { data: existing, error: fetchErr } = await supabase
      .from("projects")
      .select("id, tenant_id, status")
      .eq("id", projectId)
      .maybeSingle();

    if (fetchErr) {
      return NextResponse.json({ error: fetchErr.message }, { status: 400 });
    }
    if (!existing) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    if (
      caller.profile.role !== "super_admin" &&
      existing.tenant_id !== caller.profile.tenant_id
    ) {
      return NextResponse.json({ error: "Not authorized for this campaign" }, { status: 403 });
    }

    const { error: delErr } = await supabase
      .from("projects")
      .delete()
      .eq("id", projectId);

    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, deleted_id: projectId });
  } catch (err) {
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
