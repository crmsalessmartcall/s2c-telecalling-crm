import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

export async function POST(req, { params }) {
  try {
    const supabase = getServiceSupabase();
    if (!supabase) {
      return NextResponse.json({ error: "Supabase server client not configured." }, { status: 500 });
    }

    const resolvedParams = await params;
    const campaignId =
      resolvedParams?.campaignId || resolvedParams?.id || resolvedParams?.projectId;

    if (!campaignId) {
      return NextResponse.json({ error: "Campaign ID is required in URL." }, { status: 400 });
    }

    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("id, tenant_id, status")
      .eq("id", campaignId)
      .maybeSingle();

    if (projErr) {
      return NextResponse.json({ error: projErr.message }, { status: 400 });
    }
    if (!project) {
      return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
    }

    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
    }

    const rawItems = Array.isArray(body)
      ? body
      : Array.isArray(body.leads)
        ? body.leads
        : [body];

    if (rawItems.length === 0) {
      return NextResponse.json({ error: "At least one lead is required." }, { status: 400 });
    }

    const { data: tenantProfiles } = await supabase
      .from("profiles")
      .select("id, user_id")
      .eq("tenant_id", project.tenant_id);

    const profilePkByUserId = {};
    for (const p of tenantProfiles || []) {
      if (p.user_id) {
        profilePkByUserId[String(p.user_id).trim().toLowerCase()] = p.id;
      }
    }
    const availableUserIds = Object.keys(profilePkByUserId);

    function resolveUserId(obj) {
      const rawId = obj?.user_id ?? obj?.assigned_to ?? obj?.agent_id;
      if (rawId === undefined || rawId === null || String(rawId).trim() === "") {
        return { userId: null, profilePk: null };
      }
      const cleanId = String(rawId).trim().toLowerCase();
      return {
        userId: cleanId,
        profilePk: profilePkByUserId[cleanId] || null,
      };
    }

    const topLevelAgent = !Array.isArray(body)
      ? resolveUserId(body)
      : { userId: null, profilePk: null };

    if (topLevelAgent.userId && !topLevelAgent.profilePk) {
      return NextResponse.json(
        {
          error: `Unknown user_id "${topLevelAgent.userId}" in this tenant. Available user_ids: ${
            availableUserIds.length ? availableUserIds.join(", ") : "none"
          }`,
        },
        { status: 400 }
      );
    }

    const rowsToInsert = [];
    const errors = [];

    rawItems.forEach((item, idx) => {
      const name = String(item?.name || "").trim();
      const phone = String(item?.phone || "").trim();

      if (!name || !phone) {
        errors.push({ index: idx, error: "Both name and phone are required." });
        return;
      }

      const itemAgent = resolveUserId(item);
      if (itemAgent.userId && !itemAgent.profilePk) {
        errors.push({
          index: idx,
          error: `Unknown user_id "${itemAgent.userId}" in this tenant. Available user_ids: ${
            availableUserIds.length ? availableUserIds.join(", ") : "none"
          }`,
        });
        return;
      }

      const assignedProfilePk = itemAgent.profilePk || topLevelAgent.profilePk || null;

      const customFields =
        item?.custom_fields && typeof item.custom_fields === "object"
          ? { ...item.custom_fields }
          : {};

      if (item?.serial_number !== undefined && item?.serial_number !== null) {
        customFields.serial_number = String(item.serial_number).trim();
      }

      rowsToInsert.push({
        tenant_id: project.tenant_id,
        project_id: project.id,
        name,
        phone,
        email: item?.email ? String(item.email).trim() : null,
        status: item?.status ? String(item.status).trim() : "new",
        notes: item?.notes ? String(item.notes).trim() : null,
        assigned_to: assignedProfilePk,
        custom_fields: customFields,
      });
    });

    if (rowsToInsert.length === 0) {
      return NextResponse.json(
        { error: "No valid leads found in payload.", details: errors },
        { status: 400 }
      );
    }

    const { data: inserted, error: insErr } = await supabase
      .from("leads")
      .insert(rowsToInsert)
      .select("*");

    if (insErr) {
      return NextResponse.json({ error: insErr.message }, { status: 400 });
    }

    return NextResponse.json(
      {
        ok: true,
        inserted_count: (inserted || []).length,
        skipped_count: errors.length,
        errors: errors.length > 0 ? errors : undefined,
        leads: inserted || [],
      },
      { status: 201 }
    );
  } catch (err) {
    return NextResponse.json({ error: err?.message || "Failed to ingest leads." }, { status: 500 });
  }
}
