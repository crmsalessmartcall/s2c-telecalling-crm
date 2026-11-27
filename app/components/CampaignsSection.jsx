"use client";

import { useEffect, useMemo, useState } from "react";
import { safeJsonFetch } from "@/lib/crmHelpers";
import CampaignSettingsTab from "@/app/components/campaign/CampaignSettingsTab";
import CampaignMembersTab from "@/app/components/campaign/CampaignMembersTab";
import CampaignProspectsTab from "@/app/components/campaign/CampaignProspectsTab";
import CampaignPendingCallsTab from "@/app/components/campaign/CampaignPendingCallsTab";

function isLeadClosed(lead) {
  if (lead?.is_closed === true) return true;
  const st = String(lead?.status || "").toLowerCase();
  return ["closed", "converted", "completed", "won", "lost"].includes(st);
}

export default function CampaignsSection({
  session,
  profile,
  tenants = [],
  teamUsers = [],
  campaignMembers = [],
  selectedTenantScope,
  onChangeTenantScope,
  activeProjects = [],
  selectedProjectId,
  onSelectProject,
  projectsCountAll = 0,
  callFields = [],
  dispositions = [],
  leads = [],
  initialSubTab = "calling_data",
  onReloadAll,
  onNotify,
  onDialLead,
}) {
  const isAgent = profile?.role === "agent";

  const canManageCampaign = [
    "super_admin",
    "admin",
    "manager",
    "tenant_admin",
    "supervisor",
    "team_leader",
  ].includes(profile?.role);

  const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(Boolean(selectedProjectId));
  const [activeCampaignTab, setActiveCampaignTab] = useState(
    isAgent ? "pending_calls" : initialSubTab === "settings" ? "campaign" : "prospects"
  );
  const [projectForm, setProjectForm] = useState({ name: "", description: "" });
  const [creatingCampaign, setCreatingCampaign] = useState(false);

  useEffect(() => {
    if (initialSubTab === "settings" && !isAgent && selectedProjectId) {
      setIsWorkspaceOpen(true);
      setActiveCampaignTab("campaign");
    }
  }, [initialSubTab, isAgent, selectedProjectId]);

  useEffect(() => {
    if (isAgent) {
      setActiveCampaignTab((prev) =>
        ["prospects", "pending_calls"].includes(prev) ? prev : "pending_calls"
      );
    }
  }, [isAgent]);

  const activeCampaign = useMemo(
    () => activeProjects.find((p) => p.id === selectedProjectId) || null,
    [activeProjects, selectedProjectId]
  );

  const campaignLeads = useMemo(() => {
    if (!selectedProjectId) return [];
    return (leads || []).filter((l) => l.project_id === selectedProjectId);
  }, [leads, selectedProjectId]);

  const assignedMemberIds = useMemo(() => {
    const set = new Set(
      (campaignMembers || [])
        .filter((m) => m.campaign_id === selectedProjectId)
        .map((m) => m.user_id)
    );
    for (const l of campaignLeads) {
      if (l.assigned_to) set.add(l.assigned_to);
    }
    return set;
  }, [campaignMembers, selectedProjectId, campaignLeads]);

  const pendingCallLeads = useMemo(
    () => campaignLeads.filter((l) => !isLeadClosed(l)),
    [campaignLeads]
  );

  function openCampaign(projectId) {
    onSelectProject?.(projectId);
    setIsWorkspaceOpen(true);
    setActiveCampaignTab(isAgent ? "pending_calls" : "prospects");
  }

  function backToCampaignList() {
    setIsWorkspaceOpen(false);
  }

  async function handleCreateCampaign(e) {
    e.preventDefault();
    if (!session?.access_token || !projectForm.name.trim()) return;
    setCreatingCampaign(true);
    try {
      const res = await safeJsonFetch("/api/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          name: projectForm.name.trim(),
          description: projectForm.description.trim(),
          status: "active",
          tenant_id: profile?.role === "super_admin" ? selectedTenantScope || undefined : undefined,
        }),
      });
      if (!res.ok) {
        onNotify?.(res.data?.error || "Failed to create campaign.");
        return;
      }
      const createdId = res.data.project?.id;
      const createdName = res.data.project?.name || projectForm.name.trim();
      setProjectForm({ name: "", description: "" });
      onNotify?.(`Created campaign "${createdName}".`);
      await onReloadAll?.();
      if (createdId) {
        onSelectProject?.(createdId);
        setIsWorkspaceOpen(true);
        setActiveCampaignTab(isAgent ? "pending_calls" : "campaign");
      }
    } finally {
      setCreatingCampaign(false);
    }
  }

  // 1. Campaign List View (Only campaign names first until clicked)
  if (!isWorkspaceOpen || !activeCampaign) {
    return (
      <section>
        <div
          style={{
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 14,
          }}
        >
          <h3 style={{ margin: 0 }}>
            📋 {isAgent ? "My Campaigns" : "Campaigns"} ({activeProjects.length} /{" "}
            {projectsCountAll})
          </h3>

          {profile?.role === "super_admin" && (tenants || []).length > 0 && (
            <label style={{ fontSize: 13 }}>
              Tenant:{" "}
              <select
                value={selectedTenantScope}
                onChange={(e) => {
                  setIsWorkspaceOpen(false);
                  onChangeTenantScope?.(e.target.value);
                }}
                style={{ padding: "6px 8px", borderRadius: 6 }}
              >
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    #{t.numeric_id} {t.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {canManageCampaign && (
          <div
            style={{
              marginBottom: 16,
              padding: 14,
              border: "1px solid #cbd5e1",
              borderRadius: 10,
              background: "#ffffff",
            }}
          >
            <h4 style={{ marginTop: 0 }}>➕ Create New Campaign</h4>
            <form
              onSubmit={handleCreateCampaign}
              style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
            >
              <input
                placeholder="Campaign Name *"
                value={projectForm.name}
                onChange={(e) => setProjectForm((f) => ({ ...f, name: e.target.value }))}
                required
                style={{
                  padding: "7px 10px",
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
                  minWidth: 220,
                }}
              />
              <input
                placeholder="Description / Requirement"
                value={projectForm.description}
                onChange={(e) =>
                  setProjectForm((f) => ({ ...f, description: e.target.value }))
                }
                style={{
                  padding: "7px 10px",
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
                  minWidth: 240,
                }}
              />
              <button
                type="submit"
                disabled={creatingCampaign}
                style={{
                  padding: "7px 14px",
                  borderRadius: 6,
                  border: "1px solid #1d4ed8",
                  background: "#2563eb",
                  color: "#ffffff",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {creatingCampaign ? "Creating..." : "Create Campaign"}
              </button>
            </form>
          </div>
        )}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: 12,
          }}
        >
          {activeProjects.map((proj) => (
            <button
              key={proj.id}
              type="button"
              onClick={() => openCampaign(proj.id)}
              style={{
                padding: "16px 18px",
                borderRadius: 10,
                border: "1px solid #cbd5e1",
                background: "#ffffff",
                textAlign: "left",
                cursor: "pointer",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 10,
              }}
            >
              <span style={{ fontSize: 16, fontWeight: 700, color: "#0f172a" }}>
                {proj.name}
              </span>
              <span style={{ fontSize: 12, color: "#2563eb", fontWeight: 700 }}>
                Open →
              </span>
            </button>
          ))}

          {activeProjects.length === 0 && (
            <div
              style={{
                gridColumn: "1 / -1",
                padding: 18,
                border: "1px dashed #94a3b8",
                borderRadius: 10,
                color: "#475569",
              }}
            >
              No active campaigns found in this scope.
            </div>
          )}
        </div>
      </section>
    );
  }

  // 2. Selected Campaign Detail View with 4 Tabs
  const tabs = isAgent
    ? [
        { id: "prospects", label: "Prospects", count: campaignLeads.length },
        { id: "pending_calls", label: "Pending Calls", count: pendingCallLeads.length, badge: true },
      ]
    : [
        { id: "campaign", label: "Campaign" },
        { id: "members", label: "Members", count: assignedMemberIds.size },
        { id: "prospects", label: "Prospects", count: campaignLeads.length },
        { id: "pending_calls", label: "Pending Calls", count: pendingCallLeads.length, badge: true },
      ];

  return (
    <section>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 10,
          marginBottom: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={backToCampaignList}
            style={{
              padding: "6px 10px",
              borderRadius: 6,
              border: "1px solid #cbd5e1",
              background: "#f8fafc",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            ← All Campaigns
          </button>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#0f172a" }}>
            {activeCampaign.name}
          </h2>
        </div>

        {activeProjects.length > 1 && (
          <label style={{ fontSize: 12, color: "#475569" }}>
            Switch Campaign:{" "}
            <select
              value={selectedProjectId}
              onChange={(e) => openCampaign(e.target.value)}
              style={{ padding: "5px 8px", borderRadius: 6 }}
            >
              {activeProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {/* 4 Sub-Tabs Bar */}
      <div
        role="tablist"
        style={{
          display: "flex",
          gap: 4,
          borderBottom: "1px solid #cbd5e1",
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        {tabs.map((tab) => {
          const isSelected = activeCampaignTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isSelected}
              onClick={() => setActiveCampaignTab(tab.id)}
              style={{
                padding: "9px 14px",
                borderTopLeftRadius: 8,
                borderTopRightRadius: 8,
                border: "1px solid",
                borderColor: isSelected ? "#cbd5e1 #cbd5e1 #ffffff" : "transparent",
                background: isSelected ? "#ffffff" : "transparent",
                color: isSelected ? "#0f172a" : "#334155",
                fontWeight: isSelected ? 700 : 500,
                fontSize: 13,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                marginBottom: -1,
              }}
            >
              <span>{tab.label}</span>
              {typeof tab.count === "number" && (
                <span
                  style={{
                    padding: "1px 7px",
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 700,
                    background: tab.badge ? "#dc2626" : "#e2e8f0",
                    color: tab.badge ? "#ffffff" : "#1e293b",
                  }}
                >
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {activeCampaignTab === "campaign" && !isAgent && (
        <CampaignSettingsTab
          session={session}
          profile={profile}
          selectedTenantScope={selectedTenantScope}
          campaign={activeCampaign}
          callFields={callFields}
          dispositions={dispositions}
          canManageCampaign={canManageCampaign}
          onReloadAll={onReloadAll}
          onNotify={onNotify}
          onBackToList={backToCampaignList}
          onSelectProject={onSelectProject}
        />
      )}

      {activeCampaignTab === "members" && !isAgent && (
        <CampaignMembersTab
          session={session}
          profile={profile}
          selectedTenantScope={selectedTenantScope}
          campaign={activeCampaign}
          teamUsers={teamUsers}
          assignedMemberIds={assignedMemberIds}
          campaignLeads={campaignLeads}
          pendingCallLeads={pendingCallLeads}
          canManageCampaign={canManageCampaign}
          onReloadAll={onReloadAll}
          onNotify={onNotify}
        />
      )}

      {activeCampaignTab === "prospects" && (
        <CampaignProspectsTab
          session={session}
          profile={profile}
          selectedTenantScope={selectedTenantScope}
          campaign={activeCampaign}
          teamUsers={teamUsers}
          assignedMemberIds={assignedMemberIds}
          callFields={callFields}
          dispositions={dispositions}
          campaignLeads={campaignLeads}
          pendingCallLeads={pendingCallLeads}
          isAgent={isAgent}
          canManageCampaign={canManageCampaign}
          onReloadAll={onReloadAll}
          onNotify={onNotify}
          onDialLead={onDialLead}
        />
      )}

      {activeCampaignTab === "pending_calls" && (
        <CampaignPendingCallsTab
          session={session}
          profile={profile}
          campaign={activeCampaign}
          callFields={callFields}
          dispositions={dispositions}
          pendingCallLeads={pendingCallLeads}
          isAgent={isAgent}
          onReloadAll={onReloadAll}
          onNotify={onNotify}
          onDialLead={onDialLead}
        />
      )}
    </section>
  );
}
