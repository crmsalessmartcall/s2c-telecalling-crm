import { NextResponse } from "next/server";
import { getServiceSupabase, getCallerProfile } from "@/lib/supabaseServer";

export async function GET(req) {
  try {
    const supabase = getServiceSupabase();
    const caller = await getCallerProfile(req, supabase);
    if (caller.error) {
      return NextResponse.json({ error: caller.error }, { status: caller.status });
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
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ projects: projects || [] });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const supabase = getServiceSupabase();
    const caller = await getCallerProfile(req, supabase);
    if (caller.error) {
      return NextResponse.json({ error: caller.error }, { status: caller.status });
    }
    if (!["super_admin", "tenant_admin"].includes(caller.profile.role)) {
      return NextResponse.json({ error: "Only admin can create campaigns" }, { status: 403 });
    }

    const body = await req.json();
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

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ project }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
