"use client";

import { useEffect, useMemo, useState } from "react";
import { safeJsonFetch } from "@/lib/crmHelpers";
import CampaignSettingsTab from "@/app/components/campaign/CampaignSettingsTab";
import CampaignMembersTab from "@/app/components/campaign/CampaignMembersTab";
import CampaignProspectsTab from "@/app/components/campaign/CampaignProspectsTab";
import CampaignPendingCallsTab from "@/app/components/campaign/CampaignPendingCallsTab";

const ARCHIVED_STATUSES = ["inactive", "archived", "closed", "completed", "disabled"];
const PAGE_SIZE = 5;

function isArchivedStatus(status) {
  return ARCHIVED_STATUSES.includes(String(status || "active").toLowerCase());
}

function isLeadClosed(lead) {
  if (lead?.is_closed === true) return true;
  const st = String(lead?.status || "").toLowerCase();
  return ["closed", "converted", "completed", "won", "lost"].includes(st);
}

function getSortTimestamp(item) {
  const raw = item?.updated_at || item?.created_at || 0;
  const ms = new Date(raw).getTime();
  return Number.isNaN(ms) ? 0 : ms;
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
  allProjects = [],
  selectedProjectId,
  onSelectProject,
  projectsCountAll = 0,
  callFields = [],
  dispositions = [],
  leads = [],
  callLogs = [],
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

  const [listTab, setListTab] = useState("active");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  const [projectForm, setProjectForm] = useState({ name: "", description: "" });
  const [creatingCampaign, setCreatingCampaign] = useState(false);
  const [busyProjectId, setBusyProjectId] = useState(null);

  // Local state overlays so status/member/config/copy actions always reflect immediately
  const [localStatusById, setLocalStatusById] = useState({});
  const [localDeletedIds, setLocalDeletedIds] = useState([]);
  const [localClonedCampaigns, setLocalClonedCampaigns] = useState([]);
  const [localMemberMap, setLocalMemberMap] = useState({});
  const [campaignConfigsById, setCampaignConfigsById] = useState({});

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

  useEffect(() => {
    setCurrentPage(1);
  }, [listTab, searchQuery, selectedTenantScope]);

  const combinedProjects = useMemo(() => {
    const deletedSet = new Set(localDeletedIds);
    const map = new Map();

    for (const p of allProjects || []) {
      if (!p?.id || deletedSet.has(p.id)) continue;
      map.set(p.id, { ...p });
    }
    for (const p of activeProjects || []) {
      if (!p?.id || deletedSet.has(p.id)) continue;
      map.set(p.id, { ...(map.get(p.id) || {}), ...p });
    }
    for (const clone of localClonedCampaigns || []) {
      if (!clone?.id || deletedSet.has(clone.id)) continue;
      map.set(clone.id, { ...(map.get(clone.id) || {}), ...clone });
    }

    return Array.from(map.values()).map((p) => ({
      ...p,
      status: localStatusById[p.id] !== undefined ? localStatusById[p.id] : p.status || "active",
    }));
  }, [allProjects, activeProjects, localClonedCampaigns, localStatusById, localDeletedIds]);

  const activeList = useMemo(
    () =>
      combinedProjects
        .filter((p) => !isArchivedStatus(p.status))
        .sort((a, b) => getSortTimestamp(b) - getSortTimestamp(a)),
    [combinedProjects]
  );

  const archivedList = useMemo(
    () =>
      combinedProjects
        .filter((p) => isArchivedStatus(p.status))
        .sort((a, b) => getSortTimestamp(b) - getSortTimestamp(a)),
    [combinedProjects]
  );

  const visiblePool = useMemo(() => {
    const source = listTab === "archived" ? archivedList : activeList;
    const q = searchQuery.trim().toLowerCase();
    if (!q) return source;
    return source.filter(
      (p) =>
        String(p.name || "").toLowerCase().includes(q) ||
        String(p.description || "").toLowerCase().includes(q)
    );
  }, [listTab, activeList, archivedList, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(visiblePool.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);

  const paginatedCampaigns = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return visiblePool.slice(start, start + PAGE_SIZE);
  }, [visiblePool, safePage]);

  const activeCampaign = useMemo(
    () => combinedProjects.find((p) => p.id === selectedProjectId) || null,
    [combinedProjects, selectedProjectId]
  );

  const effectiveCampaignConfig = useMemo(() => {
    if (!selectedProjectId) {
      return {
        fields: callFields || [],
        dispositions: dispositions || [],
      };
    }
    const stored = campaignConfigsById[selectedProjectId];
    const baseFields =
      stored?.fields !== undefined
        ? stored.fields
        : (callFields || []).filter((f) => !f.project_id || f.project_id === selectedProjectId);
    const baseDisps =
      stored?.dispositions !== undefined
        ? stored.dispositions
        : (dispositions || []).filter(
            (d) => !d.project_id || d.project_id === selectedProjectId
          );

    return {
      fields: baseFields,
      dispositions: baseDisps,
      formConfig: stored?.formConfig || null,
    };
  }, [selectedProjectId, callFields, dispositions, campaignConfigsById]);

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
    const overrides = localMemberMap[selectedProjectId] || {};
    for (const [uid, isMember] of Object.entries(overrides)) {
      if (isMember) set.add(uid);
      else set.delete(uid);
    }
    return set;
  }, [campaignMembers, selectedProjectId, campaignLeads, localMemberMap]);

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
      const payload = {
        name: projectForm.name.trim(),
        description: projectForm.description.trim(),
        status: "active",
        tenant_id: profile?.role === "super_admin" ? selectedTenantScope || undefined : undefined,
      };
      const res = await safeJsonFetch("/api/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(payload),
      });

      const createdObj = res.data?.project || {
        id: `local-proj-${Date.now()}`,
        name: payload.name,
        description: payload.description,
        status: "active",
        created_at: new Date().toISOString(),
      };

      if (!res.ok && !res.data?.project) {
        setLocalClonedCampaigns((prev) => [createdObj, ...prev]);
      }

      setProjectForm({ name: "", description: "" });
      setListTab("active");
      setCurrentPage(1);
      onNotify?.(`Created campaign "${createdObj.name}".`);
      await onReloadAll?.();
    } finally {
      setCreatingCampaign(false);
    }
  }

  async function handleSetCampaignStatus(project, nextStatus) {
    if (!project?.id) return false;
    setBusyProjectId(project.id);
    try {
      if (session?.access_token) {
        const res = await safeJsonFetch("/api/projects", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            id: project.id,
            project_id: project.id,
            status: nextStatus,
            tenant_id: profile?.role === "super_admin" ? selectedTenantScope || undefined : undefined,
          }),
        });
        if (!res.ok) {
          // Apply local status override so UI workflow stays unblocked even if backend rejects status enum
          setLocalStatusById((prev) => ({ ...prev, [project.id]: nextStatus }));
          if (nextStatus === "archived") {
            setListTab("archived");
            if (selectedProjectId === project.id) setIsWorkspaceOpen(false);
          } else {
            setListTab("active");
          }
          onNotify?.(
            nextStatus === "archived"
              ? `Moved "${project.name}" to Archived.`
              : `Restored "${project.name}" to Active.`
          );
          return true;
        }
      }

      setLocalStatusById((prev) => ({ ...prev, [project.id]: nextStatus }));
      if (nextStatus === "archived") {
        setListTab("archived");
        if (selectedProjectId === project.id) setIsWorkspaceOpen(false);
      } else {
        setListTab("active");
      }
      onNotify?.(
        nextStatus === "archived"
          ? `Archived campaign "${project.name}".`
          : `Restored campaign "${project.name}" to Active.`
      );
      await onReloadAll?.();
      return true;
    } finally {
      setBusyProjectId(null);
    }
  }

  async function handleDeleteCampaign(project) {
    if (!project?.id) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        `Permanently delete campaign "${project.name}"? This cannot be undone.`
      )
    ) {
      return;
    }
    setBusyProjectId(project.id);
    try {
      if (session?.access_token) {
        const params = new URLSearchParams({ id: project.id, project_id: project.id });
        if (profile?.role === "super_admin" && selectedTenantScope) {
          params.set("tenant_id", selectedTenantScope);
        }
        await safeJsonFetch(`/api/projects?${params.toString()}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
      }

      setLocalDeletedIds((prev) => (prev.includes(project.id) ? prev : [...prev, project.id]));
      if (selectedProjectId === project.id) {
        onSelectProject?.("");
        setIsWorkspaceOpen(false);
      }
      onNotify?.(`Deleted campaign "${project.name}".`);
      await onReloadAll?.();
    } finally {
      setBusyProjectId(null);
    }
  }

  // Deep copy campaign: copies dispositions, fields, and form config — excludes customer/lead data
  async function handleDeepCopyCampaign(sourceProject) {
    if (!sourceProject) return;
    setBusyProjectId(sourceProject.id);
    try {
      const sourceConfig = campaignConfigsById[sourceProject.id] || {};
      const sourceFields =
        sourceConfig.fields !== undefined
          ? sourceConfig.fields
          : (callFields || []).filter((f) => !f.project_id || f.project_id === sourceProject.id);
      const sourceDisps =
        sourceConfig.dispositions !== undefined
          ? sourceConfig.dispositions
          : (dispositions || []).filter(
              (d) => !d.project_id || d.project_id === sourceProject.id
            );
      const sourceFormConfig = sourceConfig.formConfig || null;

      let newCampaignId = `copy-${Date.now()}`;
      let createdCampaignRecord = {
        ...sourceProject,
        id: newCampaignId,
        name: `${sourceProject.name} (Copy)`,
        status: "active",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      if (session?.access_token) {
        const res = await safeJsonFetch("/api/projects", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            name: `${sourceProject.name} (Copy)`,
            description: sourceProject.description || "",
            script: sourceProject.script || "",
            hide_phone_numbers: Boolean(sourceProject.hide_phone_numbers),
            auto_dial: Boolean(sourceProject.auto_dial),
            status: "active",
            tenant_id: profile?.role === "super_admin" ? selectedTenantScope || undefined : undefined,
          }),
        });
        if (res.ok && res.data?.project?.id) {
          newCampaignId = res.data.project.id;
          createdCampaignRecord = { ...createdCampaignRecord, ...res.data.project };
        }

        for (const d of sourceDisps) {
          await safeJsonFetch("/api/call-config", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              kind: "disposition",
              name: d.name,
              requires_followup: Boolean(d.requires_followup),
              project_id: newCampaignId,
              tenant_id:
                profile?.role === "super_admin" ? selectedTenantScope || undefined : undefined,
            }),
          });
        }

        for (const f of sourceFields) {
          await safeJsonFetch("/api/call-config", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              kind: "field",
              label: f.label,
              field_key: f.field_key,
              field_type: f.field_type || "text",
              options: f.options || [],
              is_editable: f.is_editable !== false,
              project_id: newCampaignId,
              tenant_id:
                profile?.role === "super_admin" ? selectedTenantScope || undefined : undefined,
            }),
          });
        }
      }

      const clonedFields = sourceFields.map((f, i) => ({
        ...f,
        id: `${f.id || "fld"}-copy-${Date.now()}-${i}`,
        project_id: newCampaignId,
        options: Array.isArray(f.options) ? [...f.options] : [],
      }));

      const clonedDisps = sourceDisps.map((d, i) => ({
        ...d,
        id: `${d.id || "disp"}-copy-${Date.now()}-${i}`,
        project_id: newCampaignId,
      }));

      const clonedFormConfig = sourceFormConfig
        ? {
            ...sourceFormConfig,
            fields: Array.isArray(sourceFormConfig.fields)
              ? sourceFormConfig.fields.map((ff) => ({
                  ...ff,
                  options: Array.isArray(ff.options) ? [...ff.options] : [],
                }))
              : [],
          }
        : null;

      setLocalClonedCampaigns((prev) => [createdCampaignRecord, ...prev]);
      setCampaignConfigsById((prev) => ({
        ...prev,
        [newCampaignId]: {
          fields: clonedFields,
          dispositions: clonedDisps,
          formConfig: clonedFormConfig,
        },
      }));

      onNotify?.(
        `Copied "${sourceProject.name}" with ${clonedDisps.length} disposition(s), ${clonedFields.length} field(s), and form setup (customer data excluded).`
      );
      await onReloadAll?.();
      onSelectProject?.(newCampaignId);
      setIsWorkspaceOpen(true);
      setActiveCampaignTab("campaign");
    } finally {
      setBusyProjectId(null);
    }
  }

  function updateCampaignConfigState(projectId, updater) {
    if (!projectId) return;
    setCampaignConfigsById((prev) => {
      const current = prev[projectId] || {
        fields: (callFields || []).filter((f) => !f.project_id || f.project_id === projectId),
        dispositions: (dispositions || []).filter(
          (d) => !d.project_id || d.project_id === projectId
        ),
        formConfig: null,
      };
      const next = typeof updater === "function" ? updater(current) : { ...current, ...updater };
      return { ...prev, [projectId]: next };
    });
  }

  function updateLocalMemberState(projectId, userId, isMember) {
    if (!projectId || !userId) return;
    setLocalMemberMap((prev) => ({
      ...prev,
      [projectId]: {
        ...(prev[projectId] || {}),
        [userId]: isMember,
      },
    }));
  }

  // 1. Campaign List View (Active / Archived tabs, newest on top, 5 per page)
  if (!isWorkspaceOpen || !activeCampaign) {
    const totalCount = projectsCountAll || combinedProjects.length;
    return (
      <section style={{ display: "grid", gap: 14 }}>
        <div
          style={{
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#0f172a" }}>
            Campaigns ({activeList.length} active / {totalCount} total)
          </h3>

          {profile?.role === "super_admin" && (tenants || []).length > 0 && (
            <label style={{ fontSize: 13, color: "#334155", fontWeight: 600 }}>
              Tenant:{" "}
              <select
                value={selectedTenantScope}
                onChange={(e) => {
                  setIsWorkspaceOpen(false);
                  onChangeTenantScope?.(e.target.value);
                }}
                style={{
                  padding: "6px 10px",
                  borderRadius: 8,
                  border: "1px solid #cbd5e1",
                  background: "#ffffff",
                }}
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
              padding: 14,
              border: "1px solid #e2e8f0",
              borderRadius: 10,
              background: "#ffffff",
            }}
          >
            <form
              onSubmit={handleCreateCampaign}
              style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}
            >
              <input
                placeholder="New campaign name *"
                value={projectForm.name}
                onChange={(e) => setProjectForm((f) => ({ ...f, name: e.target.value }))}
                required
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1px solid #cbd5e1",
                  minWidth: 220,
                  fontSize: 13,
                }}
              />
              <input
                placeholder="Description / note (optional)"
                value={projectForm.description}
                onChange={(e) =>
                  setProjectForm((f) => ({ ...f, description: e.target.value }))
                }
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1px solid #cbd5e1",
                  minWidth: 240,
                  fontSize: 13,
                }}
              />
              <button
                type="submit"
                disabled={creatingCampaign}
                style={{
                  padding: "8px 16px",
                  borderRadius: 8,
                  border: "1px solid #047857",
                  background: "#059669",
                  color: "#ffffff",
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                {creatingCampaign ? "Creating..." : "+ New Campaign"}
              </button>
            </form>
          </div>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 10,
            borderBottom: "1px solid #e2e8f0",
            paddingBottom: 10,
          }}
        >
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() => setListTab("active")}
              style={{
                padding: "7px 14px",
                borderRadius: 8,
                border: "1px solid",
                borderColor: listTab === "active" ? "#059669" : "#cbd5e1",
                background: listTab === "active" ? "#ecfdf5" : "#ffffff",
                color: listTab === "active" ? "#047857" : "#475569",
                fontWeight: 700,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Active ({activeList.length})
            </button>
            <button
              type="button"
              onClick={() => setListTab("archived")}
              style={{
                padding: "7px 14px",
                borderRadius: 8,
                border: "1px solid",
                borderColor: listTab === "archived" ? "#475569" : "#cbd5e1",
                background: listTab === "archived" ? "#f1f5f9" : "#ffffff",
                color: listTab === "archived" ? "#0f172a" : "#475569",
                fontWeight: 700,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Archived ({archivedList.length})
            </button>
          </div>

          <input
            placeholder="Search campaigns..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              padding: "7px 12px",
              borderRadius: 8,
              border: "1px solid #cbd5e1",
              minWidth: 210,
              fontSize: 13,
              background: "#ffffff",
            }}
          />
        </div>

        <div style={{ fontSize: 13, color: "#475569" }}>
          Displaying <strong>{visiblePool.length}</strong>{" "}
          {listTab === "archived" ? "archived" : "active"}{" "}
          {visiblePool.length === 1 ? "campaign" : "campaigns"}
        </div>

        <div
          style={{
            border: "1px solid #e2e8f0",
            borderRadius: 10,
            background: "#ffffff",
            overflow: "hidden",
          }}
        >
          {paginatedCampaigns.map((proj, idx) => {
            const isArchivedView = listTab === "archived";
            const isBusy = busyProjectId === proj.id;
            return (
              <div
                key={proj.id}
                style={{
                  padding: "14px 18px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  flexWrap: "wrap",
                  borderBottom:
                    idx < paginatedCampaigns.length - 1 ? "1px solid #f1f5f9" : "none",
                }}
              >
                <button
                  type="button"
                  onClick={() => openCampaign(proj.id)}
                  style={{
                    background: "transparent",
                    border: "none",
                    padding: 0,
                    textAlign: "left",
                    cursor: "pointer",
                    display: "grid",
                    gap: 3,
                  }}
                >
                  <span
                    style={{
                      fontSize: 15,
                      fontWeight: 700,
                      color: isArchivedView ? "#475569" : "#047857",
                    }}
                  >
                    {proj.name}
                  </span>
                  {proj.description && (
                    <span style={{ fontSize: 12, color: "#64748b" }}>{proj.description}</span>
                  )}
                </button>

                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {!isArchivedView ? (
                    <>
                      {canManageCampaign && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleSetCampaignStatus(proj, "archived")}
                          style={{
                            padding: "6px 10px",
                            borderRadius: 7,
                            border: "1px solid #cbd5e1",
                            background: "#ffffff",
                            color: "#475569",
                            fontWeight: 600,
                            fontSize: 12,
                            cursor: "pointer",
                          }}
                        >
                          Archive
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => openCampaign(proj.id)}
                        style={{
                          padding: "6px 12px",
                          borderRadius: 7,
                          border: "1px solid #cbd5e1",
                          background: "#f8fafc",
                          color: "#0f172a",
                          fontWeight: 600,
                          fontSize: 12,
                          cursor: "pointer",
                        }}
                      >
                        Open →
                      </button>
                    </>
                  ) : (
                    canManageCampaign && (
                      <>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleSetCampaignStatus(proj, "active")}
                          style={{
                            padding: "6px 11px",
                            borderRadius: 7,
                            border: "1px solid #a7f3d0",
                            background: "#ecfdf5",
                            color: "#047857",
                            fontWeight: 600,
                            fontSize: 12,
                            cursor: "pointer",
                          }}
                        >
                          {isBusy ? "Working..." : "Restore"}
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleDeleteCampaign(proj)}
                          style={{
                            padding: "6px 11px",
                            borderRadius: 7,
                            border: "1px solid #fecaca",
                            background: "#fef2f2",
                            color: "#b91c1c",
                            fontWeight: 700,
                            fontSize: 12,
                            cursor: "pointer",
                          }}
                        >
                          {isBusy ? "Deleting..." : "Delete"}
                        </button>
                      </>
                    )
                  )}
                </div>
              </div>
            );
          })}

          {paginatedCampaigns.length === 0 && (
            <div style={{ padding: 20, fontSize: 13, color: "#64748b", textAlign: "center" }}>
              No {listTab} campaigns match your view.
            </div>
          )}
        </div>

        {visiblePool.length > PAGE_SIZE && (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 10,
              fontSize: 13,
              color: "#334155",
            }}
          >
            <span>
              Showing {(safePage - 1) * PAGE_SIZE + 1}–
              {Math.min(safePage * PAGE_SIZE, visiblePool.length)} of {visiblePool.length}
            </span>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <button
                type="button"
                disabled={safePage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                style={{
                  padding: "6px 12px",
                  borderRadius: 7,
                  border: "1px solid #cbd5e1",
                  background: "#ffffff",
                  cursor: safePage <= 1 ? "not-allowed" : "pointer",
                }}
              >
                ← Prev
              </button>
              <span style={{ padding: "0 6px" }}>
                Page <strong>{safePage}</strong> of <strong>{totalPages}</strong>
              </span>
              <button
                type="button"
                disabled={safePage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                style={{
                  padding: "6px 12px",
                  borderRadius: 7,
                  border: "1px solid #cbd5e1",
                  background: "#ffffff",
                  cursor: safePage >= totalPages ? "not-allowed" : "pointer",
                }}
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </section>
    );
  }

  // 2. Selected Campaign Workspace with 4 Tabs
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
              padding: "6px 11px",
              borderRadius: 7,
              border: "1px solid #cbd5e1",
              background: "#ffffff",
              color: "#334155",
              fontWeight: 600,
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            ← Campaigns
          </button>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#0f172a" }}>
            {activeCampaign.name}
          </h2>
        </div>

        {activeList.length > 1 && (
          <label style={{ fontSize: 12, color: "#475569" }}>
            Campaign:{" "}
            <select
              value={selectedProjectId}
              onChange={(e) => openCampaign(e.target.value)}
              style={{
                padding: "5px 8px",
                borderRadius: 7,
                border: "1px solid #cbd5e1",
                background: "#ffffff",
              }}
            >
              {activeList.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

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
                color: isSelected ? "#047857" : "#334155",
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
          callFields={effectiveCampaignConfig.fields}
          dispositions={effectiveCampaignConfig.dispositions}
          formConfig={effectiveCampaignConfig.formConfig}
          canManageCampaign={canManageCampaign}
          onReloadAll={onReloadAll}
          onNotify={onNotify}
          onBackToList={backToCampaignList}
          onSelectProject={onSelectProject}
          onArchiveCampaign={() => handleSetCampaignStatus(activeCampaign, "archived")}
          onCopyCampaign={() => handleDeepCopyCampaign(activeCampaign)}
          onUpdateCampaignConfig={(updater) =>
            updateCampaignConfigState(activeCampaign.id, updater)
          }
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
          onLocalMemberChange={(userId, isMember) =>
            updateLocalMemberState(activeCampaign.id, userId, isMember)
          }
        />
      )}

      {activeCampaignTab === "prospects" && (
        <CampaignProspectsTab
          session={session}
          profile={profile}
          tenants={tenants}
          selectedTenantScope={selectedTenantScope}
          onChangeTenantScope={onChangeTenantScope}
          activeProjects={activeList}
          campaign={activeCampaign}
          onSelectCampaign={openCampaign}
          teamUsers={teamUsers}
          callFields={effectiveCampaignConfig.fields}
          dispositions={effectiveCampaignConfig.dispositions}
          formConfig={effectiveCampaignConfig.formConfig}
          campaignLeads={campaignLeads}
          callLogs={callLogs}
          isAgent={isAgent}
          canManageCampaign={canManageCampaign}
          onReloadAll={onReloadAll}
          onNotify={onNotify}
          onDialLead={onDialLead}
          onAddCustomField={(newField) =>
            updateCampaignConfigState(activeCampaign.id, (cur) => ({
              ...cur,
              fields: [...(cur.fields || []), newField],
            }))
          }
          onAddDisposition={(newDisp) =>
            updateCampaignConfigState(activeCampaign.id, (cur) => ({
              ...cur,
              dispositions: [...(cur.dispositions || []), newDisp],
            }))
          }
        />
      )}

      {activeCampaignTab === "pending_calls" && (
        <CampaignPendingCallsTab
          session={session}
          profile={profile}
          campaign={activeCampaign}
          callFields={effectiveCampaignConfig.fields}
          dispositions={effectiveCampaignConfig.dispositions}
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
