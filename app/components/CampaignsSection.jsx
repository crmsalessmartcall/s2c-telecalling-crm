"use client";

import { useEffect, useMemo, useState } from "react";
import { downloadSampleCsv, parseCsvRows, safeJsonFetch } from "@/lib/crmHelpers";

function toKey(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function isLeadClosed(lead) {
  if (lead?.is_closed === true) return true;
  const st = String(lead?.status || "").toLowerCase();
  return ["closed", "converted", "completed", "won", "lost"].includes(st);
}

export default function CampaignsSection({
  session,
  profile,
  tenants,
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
  const [subTab, setSubTab] = useState(initialSubTab);
  const [campaignView, setCampaignView] = useState("prospects"); // "members" | "prospects" | "pending_calls"
  const [ingestChannel, setIngestChannel] = useState("csv"); // "single" | "csv" | "api"

  const [projectForm, setProjectForm] = useState({ name: "", description: "" });
  const [fieldForm, setFieldForm] = useState({ label: "", field_type: "text" });
  const [dispositionForm, setDispositionForm] = useState({ name: "", requires_followup: false });
  const [memberSearch, setMemberSearch] = useState("");
  const [savingMemberId, setSavingMemberId] = useState(null);
  const [distributingLeads, setDistributingLeads] = useState(false);

  const [leadForm, setLeadForm] = useState({
    name: "",
    phone: "",
    serial_number: "",
    email: "",
    notes: "",
    follow_up_at: "",
    assigned_to: "",
    custom_fields: {},
  });

  const [csvHeaders, setCsvHeaders] = useState([]);
  const [csvRawRows, setCsvRawRows] = useState([]);
  const [columnMapping, setColumnMapping] = useState({});
  const [importingRows, setImportingRows] = useState(false);

  const [importSummary, setImportSummary] = useState(null);
  const [showErrorTable, setShowErrorTable] = useState(false);

  const [apiTestPayload, setApiTestPayload] = useState(
    '{\n  "name": "Rahul Sharma",\n  "phone": "9876543210",\n  "email": "rahul@example.com",\n  "serial_number": "SN-1001"\n}'
  );

  const [filters, setFilters] = useState({
    status: "all",
    disposition: "all",
    callKind: "all",
    assignedTo: "all",
    source: "all",
    paramKey: "",
    paramValue: "",
    search: "",
  });

  const [selectedLeadIds, setSelectedLeadIds] = useState([]);
  const [targetAssigneeId, setTargetAssigneeId] = useState("");
  const [allocatingLeads, setAllocatingLeads] = useState(false);
  const [bulkFollowUpAt, setBulkFollowUpAt] = useState("");

  useEffect(() => {
    if (initialSubTab) {
      setSubTab(initialSubTab);
    }
  }, [initialSubTab]);

  useEffect(() => {
    setSelectedLeadIds([]);
  }, [selectedProjectId, campaignView]);

  const activeCampaign = useMemo(
    () => activeProjects.find((p) => p.id === selectedProjectId) || null,
    [activeProjects, selectedProjectId]
  );

  const campaignLeads = useMemo(() => {
    if (!selectedProjectId) return leads || [];
    return (leads || []).filter((l) => !l.project_id || l.project_id === selectedProjectId);
  }, [leads, selectedProjectId]);

  const unassignedCount = useMemo(
    () => campaignLeads.filter((l) => !l.assigned_to).length,
    [campaignLeads]
  );

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

  const userNameMap = useMemo(() => {
    const map = {};
    for (const u of teamUsers || []) {
      map[u.id] = u.full_name || u.email || u.id;
    }
    return map;
  }, [teamUsers]);

  const paramOptions = useMemo(() => {
    const opts = [
      { key: "serial_number", label: "Serial Number (serial_number)" },
      { key: "city", label: "City (city)" },
    ];
    for (const cf of callFields || []) {
      if (cf.field_key && !["serial_number", "city"].includes(cf.field_key)) {
        opts.push({ key: cf.field_key, label: `${cf.label} (${cf.field_key})` });
      }
    }
    return opts;
  }, [callFields]);

  const filteredLeads = useMemo(() => {
    const baseList = campaignView === "pending_calls" ? pendingCallLeads : campaignLeads;
    return baseList.filter((lead) => {
      if (filters.status !== "all" && (lead.status || "new") !== filters.status) return false;
      if (filters.source !== "all" && (lead.source || "manual") !== filters.source) return false;

      if (filters.assignedTo !== "all") {
        if (filters.assignedTo === "__unassigned__" && lead.assigned_to) return false;
        if (filters.assignedTo !== "__unassigned__" && lead.assigned_to !== filters.assignedTo) {
          return false;
        }
      }

      if (filters.disposition !== "all") {
        if (filters.disposition === "__none__" && lead.disposition) return false;
        if (filters.disposition !== "__none__" && (lead.disposition || "") !== filters.disposition) {
          return false;
        }
      }

      const hasFollowUp = Boolean(lead.follow_up_at);
      const wasCalled = Boolean(lead.last_called_at) || (lead.status && lead.status !== "new");
      if (filters.callKind === "fresh" && (hasFollowUp || wasCalled)) return false;
      if (filters.callKind === "followup" && !hasFollowUp && (lead.status || "") !== "follow_up") {
        return false;
      }
      if (filters.callKind === "fresh_and_followup") {
        const isFresh = !hasFollowUp && !wasCalled;
        const isFollowup = hasFollowUp || (lead.status || "") === "follow_up";
        if (!isFresh && !isFollowup) return false;
      }

      if (filters.paramKey && filters.paramValue.trim()) {
        const needle = filters.paramValue.trim().toLowerCase();
        const cf = lead.custom_fields && typeof lead.custom_fields === "object" ? lead.custom_fields : {};
        const val = cf[filters.paramKey] ?? lead[filters.paramKey] ?? "";
        if (!String(val).toLowerCase().includes(needle)) return false;
      }

      if (filters.search.trim()) {
        const q = filters.search.trim().toLowerCase();
        const cf = lead.custom_fields && typeof lead.custom_fields === "object" ? lead.custom_fields : {};
        const cfStr = Object.values(cf).join(" ").toLowerCase();
        const match =
          String(lead.name || "").toLowerCase().includes(q) ||
          String(lead.phone || "").toLowerCase().includes(q) ||
          String(lead.disposition || "").toLowerCase().includes(q) ||
          String(lead.status || "").toLowerCase().includes(q) ||
          cfStr.includes(q);
        if (!match) return false;
      }

      return true;
    });
  }, [campaignView, pendingCallLeads, campaignLeads, filters]);

  const selectedIdSet = useMemo(() => new Set(selectedLeadIds), [selectedLeadIds]);

  const visibleSelectedIds = useMemo(
    () => filteredLeads.map((l) => l.id).filter((id) => selectedIdSet.has(id)),
    [filteredLeads, selectedIdSet]
  );

  const allFilteredSelected =
    filteredLeads.length > 0 && visibleSelectedIds.length === filteredLeads.length;

  const filteredMembersCandidates = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    const list = teamUsers && teamUsers.length > 0 ? teamUsers : [];
    if (!q) return list;
    return list.filter(
      (u) =>
        String(u.full_name || "").toLowerCase().includes(q) ||
        String(u.email || "").toLowerCase().includes(q) ||
        String(u.role || "").toLowerCase().includes(q)
    );
  }, [teamUsers, memberSearch]);

  function toggleRowSelection(leadId) {
    setSelectedLeadIds((prev) =>
      prev.includes(leadId) ? prev.filter((id) => id !== leadId) : [...prev, leadId]
    );
  }

  function toggleSelectAllFiltered() {
    if (allFilteredSelected) {
      const visibleSet = new Set(filteredLeads.map((l) => l.id));
      setSelectedLeadIds((prev) => prev.filter((id) => !visibleSet.has(id)));
    } else {
      const merged = new Set([...selectedLeadIds, ...filteredLeads.map((l) => l.id)]);
      setSelectedLeadIds(Array.from(merged));
    }
  }

  function selectUnassignedInFiltered() {
    const unassignedIds = filteredLeads.filter((l) => !l.assigned_to).map((l) => l.id);
    setSelectedLeadIds(unassignedIds);
    onNotify(`Selected ${unassignedIds.length} unassigned lead(s) in current filter.`);
  }

  async function applyAssigneeToLeads(ids, assigneeId, labelContext) {
    if (!session?.access_token) return;
    if (!Array.isArray(ids) || ids.length === 0) {
      onNotify("Select at least one lead first.");
      return;
    }

    setAllocatingLeads(true);
    try {
      const res = await safeJsonFetch("/api/leads", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          lead_ids: ids,
          assigned_to: assigneeId || null,
          tenant_id: profile?.role === "super_admin" ? selectedTenantScope || undefined : undefined,
        }),
      });

      if (!res.ok) {
        onNotify(res.data?.error || "Failed to allocate/transfer leads.");
        return;
      }

      const targetLabel = assigneeId
        ? userNameMap[assigneeId] || "selected agent"
        : "Unassigned Pool";
      setSelectedLeadIds((prev) => prev.filter((id) => !ids.includes(id)));
      onNotify(`${labelContext}: assigned ${ids.length} lead(s) to ${targetLabel}.`);
      await onReloadAll();
    } finally {
      setAllocatingLeads(false);
    }
  }

  function applyAutoMapping(headers) {
    const stdMap = {
      name: "std:name",
      customer_name: "std:name",
      full_name: "std:name",
      phone: "std:phone",
      customer_number: "std:phone",
      mobile: "std:phone",
      email: "std:email",
      serial_number: "std:serial_number",
      notes: "std:notes",
      follow_up_at: "std:follow_up_at",
    };
    const projectFieldKeys = new Set((callFields || []).map((f) => f.field_key));

    const nextMap = {};
    for (const h of headers) {
      const norm = toKey(h);
      if (stdMap[norm]) {
        nextMap[h] = { target: stdMap[norm], newFieldName: h };
      } else if (projectFieldKeys.has(norm)) {
        nextMap[h] = { target: `custom:${norm}`, newFieldName: h };
      } else {
        nextMap[h] = { target: "new_field", newFieldName: h };
      }
    }
    setColumnMapping(nextMap);
  }

  function handleCsvFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportSummary(null);
    setShowErrorTable(false);

    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseCsvRows(String(reader.result || ""));
      setCsvHeaders(parsed.headers);
      setCsvRawRows(parsed.rows);
      applyAutoMapping(parsed.headers);
      onNotify(`Loaded ${parsed.rows.length} CSV row(s) from "${file.name}". Map columns and import.`);
    };
    reader.readAsText(file);
  }

  async function handleImportMappedRows(e) {
    e.preventDefault();
    if (!session?.access_token || csvRawRows.length === 0) return;

    setImportingRows(true);
    try {
      const newFields = [];
      for (const h of csvHeaders) {
        const mapEntry = columnMapping[h];
        if (mapEntry?.target === "new_field") {
          const cleanKey = toKey(mapEntry.newFieldName || h);
          if (cleanKey) {
            newFields.push({
              field_key: cleanKey,
              label: String(mapEntry.newFieldName || h).trim(),
              field_type: "text",
            });
          }
        }
      }

      const mappedRows = csvRawRows.map((rawRow, index) => {
        const rowObj = { _row_number: index + 2, custom_fields: {} };
        for (const h of csvHeaders) {
          const val = rawRow[h];
          const mapEntry = columnMapping[h] || { target: "ignore" };
          if (mapEntry.target === "ignore") continue;

          if (mapEntry.target.startsWith("std:")) {
            const stdKey = mapEntry.target.replace("std:", "");
            if (stdKey === "serial_number") {
              if (val !== "") rowObj.custom_fields.serial_number = val;
            } else {
              rowObj[stdKey] = val;
            }
          } else if (mapEntry.target.startsWith("custom:")) {
            const cKey = mapEntry.target.replace("custom:", "");
            if (val !== "") rowObj.custom_fields[cKey] = val;
          } else if (mapEntry.target === "new_field") {
            const nKey = toKey(mapEntry.newFieldName || h);
            if (nKey && val !== "") rowObj.custom_fields[nKey] = val;
          }
        }
        return rowObj;
      });

      const res = await safeJsonFetch("/api/leads/upload", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          project_id: selectedProjectId || null,
          tenant_id: profile?.role === "super_admin" ? selectedTenantScope || undefined : undefined,
          new_fields: newFields,
          rows: mappedRows,
        }),
      });

      if (!res.ok) {
        onNotify(res.data?.error || "Failed to import mapped leads.");
        return;
      }

      const created = res.data.created_count ?? res.data.uploaded_count ?? 0;
      const updated = res.data.updated_count ?? 0;
      const errs = Array.isArray(res.data.errors) ? res.data.errors : [];

      setImportSummary({
        created,
        updated,
        errors: errs,
      });
      setShowErrorTable(errs.length > 0);
      setCsvHeaders([]);
      setCsvRawRows([]);
      setColumnMapping({});

      onNotify(
        `Import finished — Created: ${created}, Updated: ${updated}, Errors: ${errs.length}.`
      );
      await onReloadAll();
    } finally {
      setImportingRows(false);
    }
  }

  async function handleTestApiIngest(e) {
    e.preventDefault();
    if (!selectedProjectId) return;
    let parsed = {};
    try {
      parsed = JSON.parse(apiTestPayload);
    } catch {
      onNotify("Invalid JSON payload for API-to-Lead test.");
      return;
    }

    const res = await safeJsonFetch(`/api/campaigns/${encodeURIComponent(selectedProjectId)}/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed),
    });
    if (!res.ok) {
      onNotify(res.data?.error || "API-to-Lead request failed.");
      return;
    }
    onNotify(`API lead created: "${res.data.lead?.name}" (${res.data.lead?.phone}).`);
    await onReloadAll();
  }

  async function handleToggleCampaignMember(userId, currentlyAssigned) {
    if (!session?.access_token || !selectedProjectId || !userId) return;
    setSavingMemberId(userId);
    try {
      const res = await safeJsonFetch("/api/campaigns/members", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          campaign_id: selectedProjectId,
          user_id: userId,
          action: currentlyAssigned ? "remove" : "add",
          tenant_id: profile?.role === "super_admin" ? selectedTenantScope || undefined : undefined,
        }),
      });
      if (!res.ok) {
        onNotify(res.data?.error || "Failed to update campaign member.");
        return;
      }
      onNotify(
        currentlyAssigned
          ? `Removed ${userNameMap[userId] || "member"} from campaign.`
          : `Assigned ${userNameMap[userId] || "member"} to campaign.`
      );
      await onReloadAll();
    } finally {
      setSavingMemberId(null);
    }
  }

  async function handleDistributePendingLeadsEvenly() {
    if (!session?.access_token || !selectedProjectId) return;
    const memberIds = Array.from(assignedMemberIds);
    if (memberIds.length === 0) {
      onNotify("Assign at least one member to this campaign before distributing leads.");
      return;
    }
    const targetLeads =
      selectedLeadIds.length > 0
        ? campaignLeads.filter((l) => selectedIdSet.has(l.id))
        : pendingCallLeads.length > 0
        ? pendingCallLeads
        : campaignLeads;

    if (targetLeads.length === 0) {
      onNotify("No leads available in this campaign to distribute.");
      return;
    }

    setDistributingLeads(true);
    try {
      let updatedCount = 0;
      for (let i = 0; i < targetLeads.length; i += 1) {
        const assigneeId = memberIds[i % memberIds.length];
        const res = await safeJsonFetch("/api/leads", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ lead_id: targetLeads[i].id, assigned_to: assigneeId }),
        });
        if (res.ok) updatedCount += 1;
      }
      setSelectedLeadIds([]);
      onNotify(`Distributed ${updatedCount} lead(s) across ${memberIds.length} campaign member(s).`);
      await onReloadAll();
    } finally {
      setDistributingLeads(false);
    }
  }

  async function handleCreateCampaign(e) {
    e.preventDefault();
    if (!session?.access_token) return;
    const res = await safeJsonFetch("/api/projects", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        name: projectForm.name,
        description: projectForm.description,
        status: "active",
        tenant_id: profile?.role === "super_admin" ? selectedTenantScope || undefined : undefined,
      }),
    });
    if (!res.ok) {
      onNotify(res.data?.error || "Failed to create campaign.");
      return;
    }
    setProjectForm({ name: "", description: "" });
    onNotify(`Created active campaign "${res.data.project?.name}".`);
    if (res.data.project?.id) onSelectProject(res.data.project.id);
    await onReloadAll();
  }

  async function handleAddDisposition(e) {
    e.preventDefault();
    if (!session?.access_token) return;
    const res = await safeJsonFetch("/api/call-config", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        kind: "disposition",
        name: dispositionForm.name,
        requires_followup: dispositionForm.requires_followup,
        project_id: selectedProjectId || null,
        tenant_id: profile?.role === "super_admin" ? selectedTenantScope || undefined : undefined,
      }),
    });
    if (!res.ok) {
      onNotify(res.data?.error || "Failed to add disposition.");
      return;
    }
    setDispositionForm({ name: "", requires_followup: false });
    onNotify(`Added disposition "${res.data.disposition?.name}".`);
    await onReloadAll();
  }

  async function handleAddCallField(e) {
    e.preventDefault();
    if (!session?.access_token) return;
    const res = await safeJsonFetch("/api/call-config", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        kind: "field",
        label: fieldForm.label,
        field_type: fieldForm.field_type,
        project_id: selectedProjectId || null,
        tenant_id: profile?.role === "super_admin" ? selectedTenantScope || undefined : undefined,
      }),
    });
    if (!res.ok) {
      onNotify(res.data?.error || "Failed to add call field.");
      return;
    }
    setFieldForm({ label: "", field_type: "text" });
    onNotify(`Added call field "${res.data.field?.label}".`);
    await onReloadAll();
  }

  async function handleAddSingleLead(e) {
    e.preventDefault();
    if (!session?.access_token) return;
    const mergedCustom = { ...leadForm.custom_fields };
    if (leadForm.serial_number.trim()) {
      mergedCustom.serial_number = leadForm.serial_number.trim();
    }

    const res = await safeJsonFetch("/api/leads", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        name: leadForm.name,
        phone: leadForm.phone,
        email: leadForm.email,
        notes: leadForm.notes,
        follow_up_at: leadForm.follow_up_at || null,
        assigned_to: leadForm.assigned_to || null,
        source: "manual",
        custom_fields: mergedCustom,
        project_id: selectedProjectId || null,
        tenant_id: profile?.role === "super_admin" ? selectedTenantScope || undefined : undefined,
      }),
    });
    if (!res.ok) {
      onNotify(res.data?.error || "Failed to add lead.");
      return;
    }
    setLeadForm({
      name: "",
      phone: "",
      serial_number: "",
      email: "",
      notes: "",
      follow_up_at: "",
      assigned_to: "",
      custom_fields: {},
    });
    onNotify(`Added prospect "${res.data.lead?.name}".`);
    await onReloadAll();
  }

  async function handleUpdateLead(leadId, patch) {
    if (!session?.access_token) return;
    const res = await safeJsonFetch("/api/leads", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ lead_id: leadId, ...patch }),
    });
    if (!res.ok) {
      onNotify(res.data?.error || "Failed to update lead.");
      return;
    }
    onNotify("Lead updated.");
    await onReloadAll();
  }

  async function handleBulkSetFollowUp() {
    if (!session?.access_token || !bulkFollowUpAt) return;
    const ids =
      selectedLeadIds.length > 0
        ? filteredLeads.map((l) => l.id).filter((id) => selectedIdSet.has(id))
        : filteredLeads.map((l) => l.id);
    if (ids.length === 0) return;

    const res = await safeJsonFetch("/api/leads", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        lead_ids: ids,
        follow_up_at: new Date(bulkFollowUpAt).toISOString(),
        status: "follow_up",
        tenant_id: profile?.role === "super_admin" ? selectedTenantScope || undefined : undefined,
      }),
    });
    if (!res.ok) {
      onNotify(res.data?.error || "Failed to set bulk follow-up.");
      return;
    }
    onNotify(`Follow-up scheduled for ${ids.length} lead(s).`);
    await onReloadAll();
  }

  async function handleBulkDeleteFiltered() {
    if (!session?.access_token) return;
    const ids =
      selectedLeadIds.length > 0
        ? filteredLeads.map((l) => l.id).filter((id) => selectedIdSet.has(id))
        : filteredLeads.map((l) => l.id);
    if (ids.length === 0) return;

    const count = ids.length;
    if (typeof window !== "undefined" && !window.confirm(`Delete ${count} lead(s)?`)) return;
    const res = await safeJsonFetch("/api/leads", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        lead_ids: ids,
        tenant_id: profile?.role === "super_admin" ? selectedTenantScope || undefined : undefined,
      }),
    });
    if (!res.ok) {
      onNotify(res.data?.error || "Failed to delete leads.");
      return;
    }
    setSelectedLeadIds((prev) => prev.filter((id) => !ids.includes(id)));
    onNotify(`Deleted ${count} lead(s).`);
    await onReloadAll();
  }

  const canManageCampaign = [
    "super_admin",
    "admin",
    "manager",
    "tenant_admin",
    "supervisor",
    "team_leader",
  ].includes(profile?.role);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const campaignIngestUrl = selectedProjectId
    ? `${origin}/api/campaigns/${selectedProjectId}/ingest`
    : "/api/campaigns/<campaign_id>/ingest";

  const activeSelectionIds =
    visibleSelectedIds.length > 0 ? visibleSelectedIds : selectedLeadIds;

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
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>
            Campaigns ({activeProjects.length} / {projectsCountAll})
          </h3>

          {profile?.role === "super_admin" && tenants.length > 0 && (
            <label style={{ fontSize: 13 }}>
              Tenant:{" "}
              <select
                value={selectedTenantScope}
                onChange={(e) => onChangeTenantScope(e.target.value)}
              >
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    #{t.numeric_id} {t.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label style={{ fontSize: 13 }}>
            Active Campaign:{" "}
            <select
              value={selectedProjectId}
              onChange={(e) => onSelectProject(e.target.value)}
            >
              <option value="">-- Select Active Campaign --</option>
              {activeProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {selectedProjectId && (
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              onClick={() => setSubTab("calling_data")}
              style={{ fontWeight: subTab === "calling_data" ? "bold" : "normal" }}
            >
              Campaign Workspace
            </button>
            <button
              type="button"
              onClick={() => setSubTab("settings")}
              style={{ fontWeight: subTab === "settings" ? "bold" : "normal" }}
            >
              Settings / Rules
            </button>
          </div>
        )}
      </div>

      {canManageCampaign && (
        <div style={{ marginBottom: 16, padding: 12, border: "1px solid #cbd5e1", borderRadius: 8 }}>
          <h4 style={{ marginTop: 0 }}>Create New Campaign</h4>
          <form onSubmit={handleCreateCampaign} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              placeholder="Campaign Name"
              value={projectForm.name}
              onChange={(e) => setProjectForm((f) => ({ ...f, name: e.target.value }))}
              required
            />
            <input
              placeholder="Description / Requirement"
              value={projectForm.description}
              onChange={(e) => setProjectForm((f) => ({ ...f, description: e.target.value }))}
            />
            <button type="submit">Create New Campaign</button>
          </form>
        </div>
      )}

      {!selectedProjectId ? (
        <div style={{ padding: 16, border: "1px dashed #94a3b8", borderRadius: 8, color: "#475569" }}>
          Select an active campaign above to view <strong>Members</strong>, <strong>Prospects</strong>, and{" "}
          <strong>Pending Calls</strong>.
        </div>
      ) : subTab === "settings" ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
            gap: 14,
          }}
        >
          <div style={{ padding: 14, border: "1px solid #cbd5e1", borderRadius: 8 }}>
            <h4 style={{ marginTop: 0 }}>
              Dispositions — {activeCampaign?.name} ({dispositions.length})
            </h4>
            <form onSubmit={handleAddDisposition} style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
              <input
                placeholder="Disposition name"
                value={dispositionForm.name}
                onChange={(e) => setDispositionForm((f) => ({ ...f, name: e.target.value }))}
                required
              />
              <label style={{ fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={dispositionForm.requires_followup}
                  onChange={(e) =>
                    setDispositionForm((f) => ({ ...f, requires_followup: e.target.checked }))
                  }
                />{" "}
                Follow-up
              </label>
              <button type="submit">Add</button>
            </form>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
              {dispositions.map((d) => (
                <li key={d.id}>
                  {d.name} {d.requires_followup ? "(Follow-Up)" : ""}
                </li>
              ))}
            </ul>
          </div>

          <div style={{ padding: 14, border: "1px solid #cbd5e1", borderRadius: 8 }}>
            <h4 style={{ marginTop: 0 }}>
              Project Call Fields — {activeCampaign?.name} ({callFields.length})
            </h4>
            <form onSubmit={handleAddCallField} style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
              <input
                placeholder="Field label (e.g. City)"
                value={fieldForm.label}
                onChange={(e) => setFieldForm((f) => ({ ...f, label: e.target.value }))}
                required
              />
              <select
                value={fieldForm.field_type}
                onChange={(e) => setFieldForm((f) => ({ ...f, field_type: e.target.value }))}
              >
                <option value="text">Text</option>
                <option value="number">Number</option>
                <option value="date">Date</option>
              </select>
              <button type="submit">Add</button>
            </form>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
              {callFields.map((cf) => (
                <li key={cf.id}>
                  {cf.label} <code>({cf.field_key})</code>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(160px, 1fr))",
              gap: 10,
              marginBottom: 14,
            }}
          >
            <button
              type="button"
              onClick={() => setCampaignView("members")}
              style={{
                padding: 12,
                textAlign: "left",
                borderRadius: 8,
                border: campaignView === "members" ? "2px solid #0f172a" : "1px solid #cbd5e1",
                background: campaignView === "members" ? "#f1f5f9" : "#ffffff",
                cursor: "pointer",
              }}
            >
              <div style={{ fontSize: 12, color: "#475569" }}>Members</div>
              <div style={{ fontSize: 20, fontWeight: "bold" }}>{assignedMemberIds.size}</div>
            </button>

            <button
              type="button"
              onClick={() => setCampaignView("prospects")}
              style={{
                padding: 12,
                textAlign: "left",
                borderRadius: 8,
                border: campaignView === "prospects" ? "2px solid #0f172a" : "1px solid #cbd5e1",
                background: campaignView === "prospects" ? "#f1f5f9" : "#ffffff",
                cursor: "pointer",
              }}
            >
              <div style={{ fontSize: 12, color: "#475569" }}>
                Prospects ({unassignedCount} unassigned)
              </div>
              <div style={{ fontSize: 20, fontWeight: "bold" }}>{campaignLeads.length}</div>
            </button>

            <button
              type="button"
              onClick={() => setCampaignView("pending_calls")}
              style={{
                padding: 12,
                textAlign: "left",
                borderRadius: 8,
                border: campaignView === "pending_calls" ? "2px solid #0f172a" : "1px solid #cbd5e1",
                background: campaignView === "pending_calls" ? "#f1f5f9" : "#ffffff",
                cursor: "pointer",
              }}
            >
              <div style={{ fontSize: 12, color: "#475569" }}>Pending Calls</div>
              <div style={{ fontSize: 20, fontWeight: "bold" }}>{pendingCallLeads.length}</div>
            </button>
          </div>

          {campaignView === "members" ? (
            <div style={{ padding: 14, border: "1px solid #cbd5e1", borderRadius: 8, marginBottom: 16 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 10,
                  flexWrap: "wrap",
                  marginBottom: 12,
                }}
              >
                <div>
                  <h4 style={{ margin: 0 }}>
                    Campaign Members — {activeCampaign?.name} ({assignedMemberIds.size} assigned)
                  </h4>
                  <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                    Toggle users to assign or remove access to this campaign without leaving the page.
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <input
                    placeholder="Search user by name, email, role..."
                    value={memberSearch}
                    onChange={(e) => setMemberSearch(e.target.value)}
                  />
                  {canManageCampaign && (
                    <button
                      type="button"
                      onClick={handleDistributePendingLeadsEvenly}
                      disabled={distributingLeads || assignedMemberIds.size === 0}
                    >
                      {distributingLeads ? "Distributing..." : "Distribute Pending Leads"}
                    </button>
                  )}
                </div>
              </div>

              <table border="1" cellPadding="8" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Assignment</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMembersCandidates.map((u) => {
                    const isAssigned = assignedMemberIds.has(u.id);
                    return (
                      <tr key={u.id}>
                        <td>
                          <strong>{u.full_name || u.email}</strong>
                        </td>
                        <td>{u.email}</td>
                        <td>
                          <code>{u.role}</code>
                        </td>
                        <td>{isAssigned ? "Assigned Member" : "Not Assigned"}</td>
                        <td>
                          <button
                            type="button"
                            disabled={!canManageCampaign || savingMemberId === u.id}
                            onClick={() => handleToggleCampaignMember(u.id, isAssigned)}
                          >
                            {savingMemberId === u.id
                              ? "Saving..."
                              : isAssigned
                              ? "Remove Member"
                              : "Add Member"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredMembersCandidates.length === 0 && (
                    <tr>
                      <td colSpan="5">No team members found for current scope.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div>
              {campaignView === "prospects" && (
                <div style={{ padding: 14, border: "1px solid #cbd5e1", borderRadius: 8, marginBottom: 16 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      flexWrap: "wrap",
                      gap: 8,
                      marginBottom: 12,
                    }}
                  >
                    <h4 style={{ margin: 0 }}>Add Prospects — {activeCampaign?.name}</h4>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        onClick={() => setIngestChannel("single")}
                        style={{ fontWeight: ingestChannel === "single" ? "bold" : "normal" }}
                      >
                        1. Single Entry (Add New)
                      </button>
                      <button
                        type="button"
                        onClick={() => setIngestChannel("csv")}
                        style={{ fontWeight: ingestChannel === "csv" ? "bold" : "normal" }}
                      >
                        2. CSV Import
                      </button>
                      <button
                        type="button"
                        onClick={() => setIngestChannel("api")}
                        style={{ fontWeight: ingestChannel === "api" ? "bold" : "normal" }}
                      >
                        3. API-to-Lead
                      </button>
                    </div>
                  </div>

                  {ingestChannel === "single" && (
                    <form
                      onSubmit={handleAddSingleLead}
                      style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 8 }}
                    >
                      <input
                        placeholder="Customer Name *"
                        value={leadForm.name}
                        onChange={(e) => setLeadForm((f) => ({ ...f, name: e.target.value }))}
                        required
                      />
                      <input
                        placeholder="Customer Number (Phone) *"
                        value={leadForm.phone}
                        onChange={(e) => setLeadForm((f) => ({ ...f, phone: e.target.value }))}
                        required
                      />
                      <input
                        placeholder="Serial Number"
                        value={leadForm.serial_number}
                        onChange={(e) => setLeadForm((f) => ({ ...f, serial_number: e.target.value }))}
                      />
                      <input
                        placeholder="Email"
                        value={leadForm.email}
                        onChange={(e) => setLeadForm((f) => ({ ...f, email: e.target.value }))}
                      />
                      {teamUsers.length > 0 && (
                        <select
                          value={leadForm.assigned_to}
                          onChange={(e) => setLeadForm((f) => ({ ...f, assigned_to: e.target.value }))}
                        >
                          <option value="">Unassigned Pool</option>
                          {teamUsers.map((u) => (
                            <option key={u.id} value={u.id}>
                              Assign: {u.full_name || u.email} ({u.role})
                            </option>
                          ))}
                        </select>
                      )}
                      {callFields.map((cf) => (
                        <input
                          key={cf.id}
                          placeholder={`${cf.label} (${cf.field_key})`}
                          value={leadForm.custom_fields[cf.field_key] || ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            setLeadForm((f) => ({
                              ...f,
                              custom_fields: { ...f.custom_fields, [cf.field_key]: val },
                            }));
                          }}
                        />
                      ))}
                      <input
                        placeholder="Notes"
                        value={leadForm.notes}
                        onChange={(e) => setLeadForm((f) => ({ ...f, notes: e.target.value }))}
                      />
                      <button type="submit" style={{ fontWeight: "bold" }}>
                        Save Prospect
                      </button>
                    </form>
                  )}

                  {ingestChannel === "csv" && (
                    <div>
                      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                        <input
                          type="file"
                          accept=".csv,text/csv"
                          onChange={handleCsvFileChange}
                        />
                        <button
                          type="button"
                          onClick={() => downloadSampleCsv(activeCampaign?.name, callFields)}
                        >
                          Download Sample CSV
                        </button>
                      </div>

                      {csvHeaders.length > 0 && (
                        <form onSubmit={handleImportMappedRows} style={{ marginTop: 12, display: "grid", gap: 8 }}>
                          <div style={{ fontSize: 13, fontWeight: "bold" }}>
                            Step 2 — Map Columns ({csvRawRows.length} rows ready; deduplicates by phone in campaign):
                          </div>
                          {csvHeaders.map((h) => {
                            const entry = columnMapping[h] || { target: "ignore", newFieldName: h };
                            return (
                              <div key={h} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 12 }}>
                                <code style={{ minWidth: 120 }}>{h}</code>
                                <select
                                  value={entry.target}
                                  onChange={(e) =>
                                    setColumnMapping((prev) => ({
                                      ...prev,
                                      [h]: { ...entry, target: e.target.value },
                                    }))
                                  }
                                >
                                  <option value="std:name">Customer Name</option>
                                  <option value="std:phone">Customer Number (Phone)</option>
                                  <option value="std:serial_number">Serial Number</option>
                                  <option value="std:email">Email</option>
                                  <option value="std:notes">Notes</option>
                                  <option value="std:follow_up_at">Follow-Up</option>
                                  {callFields.map((cf) => (
                                    <option key={cf.id} value={`custom:${cf.field_key}`}>
                                      Field: {cf.label} ({cf.field_key})
                                    </option>
                                  ))}
                                  <option value="new_field">Other / Create New Field</option>
                                  <option value="ignore">Ignore Column</option>
                                </select>
                                {entry.target === "new_field" && (
                                  <input
                                    placeholder="New field name (e.g. Serial Number)"
                                    value={entry.newFieldName}
                                    onChange={(e) =>
                                      setColumnMapping((prev) => ({
                                        ...prev,
                                        [h]: { ...entry, newFieldName: e.target.value },
                                      }))
                                    }
                                    style={{ width: 180 }}
                                  />
                                )}
                              </div>
                            );
                          })}
                          <div>
                            <button type="submit" disabled={importingRows} style={{ fontWeight: "bold", padding: "6px 14px" }}>
                              {importingRows ? "Importing..." : "Run Import & Deduplicate"}
                            </button>
                          </div>
                        </form>
                      )}

                      {importSummary && (
                        <div style={{ marginTop: 14 }}>
                          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                            <span style={{ padding: "4px 10px", borderRadius: 999, background: "#dcfce7", color: "#166534", fontSize: 12, fontWeight: "bold" }}>
                              Created ({importSummary.created})
                            </span>
                            <span style={{ padding: "4px 10px", borderRadius: 999, background: "#dbeafe", color: "#1e40af", fontSize: 12, fontWeight: "bold" }}>
                              Updated ({importSummary.updated})
                            </span>
                            <button
                              type="button"
                              onClick={() => setShowErrorTable((v) => !v)}
                              style={{
                                padding: "4px 10px",
                                borderRadius: 999,
                                background: "#fee2e2",
                                color: "#991b1b",
                                border: "1px solid #fca5a5",
                                fontSize: 12,
                                fontWeight: "bold",
                                cursor: "pointer",
                              }}
                            >
                              Errors ({importSummary.errors.length}) {showErrorTable ? "▲" : "▼"}
                            </button>
                          </div>

                          {showErrorTable && importSummary.errors.length > 0 && (
                            <table border="1" cellPadding="6" style={{ width: "100%", borderCollapse: "collapse", marginTop: 10, fontSize: 12 }}>
                              <thead>
                                <tr>
                                  <th>Row</th>
                                  <th>Raw Phone / Data</th>
                                  <th>Validation / Error Reason</th>
                                </tr>
                              </thead>
                              <tbody>
                                {importSummary.errors.map((err, i) => (
                                  <tr key={i}>
                                    <td>#{err.row_number}</td>
                                    <td><code>{err.raw}</code></td>
                                    <td style={{ color: "#991b1b" }}>{err.reason}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {ingestChannel === "api" && (
                    <form onSubmit={handleTestApiIngest} style={{ display: "grid", gap: 8, maxWidth: 620 }}>
                      <div style={{ fontSize: 12, color: "#475569" }}>
                        Campaign REST Endpoint: <code>POST {campaignIngestUrl}</code>
                      </div>
                      <textarea
                        rows={5}
                        value={apiTestPayload}
                        onChange={(e) => setApiTestPayload(e.target.value)}
                      />
                      <button type="submit" style={{ width: "fit-content" }}>
                        Send Test Lead to Campaign API
                      </button>
                    </form>
                  )}
                </div>
              )}

              {campaignView === "pending_calls" && (
                <div
                  style={{
                    padding: 12,
                    border: "1px solid #cbd5e1",
                    borderRadius: 8,
                    marginBottom: 12,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 10,
                  }}
                >
                  <div>
                    <strong>Pending Calls Queue — {activeCampaign?.name}</strong>{" "}
                    <span style={{ fontSize: 13, color: "#475569" }}>
                      ({filteredLeads.length} matching of {pendingCallLeads.length} pending)
                    </span>
                  </div>
                  {onDialLead && filteredLeads.length > 0 && (
                    <button
                      type="button"
                      onClick={() => onDialLead(filteredLeads[0])}
                      style={{
                        padding: "7px 14px",
                        fontWeight: "bold",
                        background: "#166534",
                        color: "#ffffff",
                        border: "none",
                        borderRadius: 6,
                        cursor: "pointer",
                      }}
                    >
                      Start Calling ({filteredLeads[0].name})
                    </button>
                  )}
                </div>
              )}

              <div
                style={{
                  padding: 10,
                  border: "1px solid #cbd5e1",
                  borderRadius: 8,
                  background: "#f8fafc",
                  marginBottom: 12,
                  display: "grid",
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <select
                    value={filters.status}
                    onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
                  >
                    <option value="all">All Statuses</option>
                    <option value="new">new</option>
                    <option value="contacted">contacted</option>
                    <option value="follow_up">follow_up</option>
                    <option value="converted">converted</option>
                    <option value="closed">closed</option>
                  </select>

                  <select
                    value={filters.source}
                    onChange={(e) => setFilters((f) => ({ ...f, source: e.target.value }))}
                  >
                    <option value="all">All Sources</option>
                    <option value="manual">manual</option>
                    <option value="csv_import">csv_import</option>
                    <option value="api">api</option>
                  </select>

                  {teamUsers.length > 0 && (
                    <select
                      value={filters.assignedTo}
                      onChange={(e) => setFilters((f) => ({ ...f, assignedTo: e.target.value }))}
                    >
                      <option value="all">All Assignees</option>
                      <option value="__unassigned__">Unassigned Pool</option>
                      {teamUsers.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.full_name || u.email} ({u.role})
                        </option>
                      ))}
                    </select>
                  )}

                  <select
                    value={filters.callKind}
                    onChange={(e) => setFilters((f) => ({ ...f, callKind: e.target.value }))}
                  >
                    <option value="all">All Leads</option>
                    <option value="fresh">Only Fresh Call</option>
                    <option value="followup">Only Follow-Up Call</option>
                    <option value="fresh_and_followup">Fresh & Follow-Up Call</option>
                  </select>

                  <select
                    value={filters.disposition}
                    onChange={(e) => setFilters((f) => ({ ...f, disposition: e.target.value }))}
                  >
                    <option value="all">All Dispositions</option>
                    <option value="__none__">No Disposition</option>
                    {dispositions.map((d) => (
                      <option key={d.id} value={d.name}>
                        {d.name}
                      </option>
                    ))}
                  </select>

                  <select
                    value={filters.paramKey}
                    onChange={(e) => setFilters((f) => ({ ...f, paramKey: e.target.value }))}
                  >
                    <option value="">Parameter Filter</option>
                    {paramOptions.map((po) => (
                      <option key={po.key} value={po.key}>
                        {po.label}
                      </option>
                    ))}
                  </select>

                  <input
                    placeholder="Parameter value"
                    value={filters.paramValue}
                    onChange={(e) => setFilters((f) => ({ ...f, paramValue: e.target.value }))}
                    style={{ width: 140 }}
                  />

                  <input
                    placeholder="Search name / phone..."
                    value={filters.search}
                    onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
                    style={{ width: 170 }}
                  />
                </div>

                {/* Lead Allocation / Transfer Bar (Selected Checkboxes + Bulk Filtered) */}
                {canManageCampaign && teamUsers.length > 0 && (
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      flexWrap: "wrap",
                      alignItems: "center",
                      paddingTop: 6,
                      borderTop: "1px dashed #cbd5e1",
                    }}
                  >
                    <span style={{ fontSize: 12, fontWeight: "bold" }}>
                      Allocate / Transfer ({activeSelectionIds.length} selected / {filteredLeads.length} filtered):
                    </span>

                    <button
                      type="button"
                      onClick={selectUnassignedInFiltered}
                      disabled={filteredLeads.length === 0}
                    >
                      Select Unassigned
                    </button>

                    {activeSelectionIds.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setSelectedLeadIds([])}
                      >
                        Clear Selection
                      </button>
                    )}

                    <select
                      value={targetAssigneeId}
                      onChange={(e) => setTargetAssigneeId(e.target.value)}
                    >
                      <option value="">-- Unassign (Return to Pool) --</option>
                      {teamUsers.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.full_name || u.email} ({u.role})
                        </option>
                      ))}
                    </select>

                    <button
                      type="button"
                      disabled={allocatingLeads || activeSelectionIds.length === 0}
                      onClick={() =>
                        applyAssigneeToLeads(
                          activeSelectionIds,
                          targetAssigneeId || null,
                          "Selected allocation"
                        )
                      }
                      style={{ fontWeight: "bold" }}
                    >
                      {allocatingLeads
                        ? "Allocating..."
                        : `Allocate Selected (${activeSelectionIds.length})`}
                    </button>

                    <button
                      type="button"
                      disabled={allocatingLeads || filteredLeads.length === 0}
                      onClick={() =>
                        applyAssigneeToLeads(
                          filteredLeads.map((l) => l.id),
                          targetAssigneeId || null,
                          "Bulk filtered allocation"
                        )
                      }
                    >
                      Allocate All Filtered ({filteredLeads.length})
                    </button>

                    <button
                      type="button"
                      disabled={distributingLeads || assignedMemberIds.size === 0}
                      onClick={handleDistributePendingLeadsEvenly}
                    >
                      {distributingLeads
                        ? "Distributing..."
                        : activeSelectionIds.length > 0
                        ? `Split Selected (${activeSelectionIds.length}) Evenly`
                        : "Split Queue Evenly"}
                    </button>
                  </div>
                )}

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ fontSize: 12, fontWeight: "bold" }}>
                    Bulk ({activeSelectionIds.length > 0 ? `${activeSelectionIds.length} selected` : `${filteredLeads.length} filtered`}):
                  </span>
                  <input
                    type="datetime-local"
                    value={bulkFollowUpAt}
                    onChange={(e) => setBulkFollowUpAt(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={handleBulkSetFollowUp}
                    disabled={!bulkFollowUpAt || (activeSelectionIds.length === 0 && filteredLeads.length === 0)}
                  >
                    Bulk Set Follow-Up
                  </button>
                  <button
                    type="button"
                    onClick={handleBulkDeleteFiltered}
                    disabled={activeSelectionIds.length === 0 && filteredLeads.length === 0}
                    style={{ color: "#991b1b" }}
                  >
                    {activeSelectionIds.length > 0
                      ? `Delete Selected (${activeSelectionIds.length})`
                      : `Delete Filtered (${filteredLeads.length})`}
                  </button>
                </div>
              </div>

              <table border="1" cellPadding="8" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={{ width: 34, textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={allFilteredSelected}
                        onChange={toggleSelectAllFiltered}
                        aria-label="Select all filtered leads"
                      />
                    </th>
                    <th>Customer</th>
                    <th>Phone</th>
                    <th>Source</th>
                    <th>Assigned To</th>
                    <th>Parameters</th>
                    <th>Status</th>
                    <th>Last Disposition</th>
                    <th>Follow-Up</th>
                    {onDialLead && <th>Call</th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredLeads.map((l) => {
                    const cf = l.custom_fields && typeof l.custom_fields === "object" ? l.custom_fields : {};
                    const entries = Object.entries(cf).filter(([, v]) => v !== "" && v != null);
                    const isChecked = selectedIdSet.has(l.id);
                    return (
                      <tr key={l.id} style={{ background: isChecked ? "#f0f9ff" : "transparent" }}>
                        <td style={{ textAlign: "center" }}>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleRowSelection(l.id)}
                            aria-label={`Select ${l.name}`}
                          />
                        </td>
                        <td>
                          <strong>{l.name}</strong>
                          {l.email && <div style={{ fontSize: 11, color: "#64748b" }}>{l.email}</div>}
                        </td>
                        <td>{l.phone}</td>
                        <td><code>{l.source || "manual"}</code></td>
                        <td>
                          {teamUsers.length > 0 ? (
                            <select
                              value={l.assigned_to || ""}
                              onChange={(e) =>
                                handleUpdateLead(l.id, { assigned_to: e.target.value || null })
                              }
                            >
                              <option value="">Unassigned</option>
                              {teamUsers.map((u) => (
                                <option key={u.id} value={u.id}>
                                  {u.full_name || u.email} ({u.role})
                                </option>
                              ))}
                            </select>
                          ) : (
                            userNameMap[l.assigned_to] || "Unassigned"
                          )}
                        </td>
                        <td>
                          {entries.length > 0
                            ? entries.map(([k, v]) => (
                                <div key={k} style={{ fontSize: 12 }}>
                                  <code>{k}</code>: <strong>{String(v)}</strong>
                                </div>
                              ))
                            : "-"}
                        </td>
                        <td>
                          <select
                            value={l.status || "new"}
                            onChange={(e) => handleUpdateLead(l.id, { status: e.target.value })}
                          >
                            <option value="new">new</option>
                            <option value="contacted">contacted</option>
                            <option value="follow_up">follow_up</option>
                            <option value="converted">converted</option>
                            <option value="closed">closed</option>
                          </select>
                        </td>
                        <td>
                          <select
                            value={l.disposition || ""}
                            onChange={(e) => handleUpdateLead(l.id, { disposition: e.target.value || null })}
                          >
                            <option value="">-- None --</option>
                            {dispositions.map((d) => (
                              <option key={d.id} value={d.name}>
                                {d.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            type="datetime-local"
                            value={l.follow_up_at ? String(l.follow_up_at).slice(0, 16) : ""}
                            onChange={(e) =>
                              handleUpdateLead(l.id, {
                                follow_up_at: e.target.value ? new Date(e.target.value).toISOString() : null,
                              })
                            }
                          />
                        </td>
                        {onDialLead && (
                          <td>
                            <button
                              type="button"
                              onClick={() => onDialLead(l)}
                              style={{
                                padding: "5px 10px",
                                background: "#166534",
                                color: "#ffffff",
                                border: "none",
                                borderRadius: 4,
                                cursor: "pointer",
                              }}
                            >
                              Call
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {filteredLeads.length === 0 && (
                    <tr>
                      <td colSpan={onDialLead ? "10" : "9"}>No leads match the selected filters.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
