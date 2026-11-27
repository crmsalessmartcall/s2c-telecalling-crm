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

function escapeCsvCell(val) {
  const str = val === null || val === undefined ? "" : String(val);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export default function CampaignProspectsTab({
  session,
  profile,
  selectedTenantScope,
  campaign,
  teamUsers = [],
  callFields = [],
  dispositions = [],
  campaignLeads = [],
  callLogs = [],
  isAgent,
  canManageCampaign,
  onReloadAll,
  onNotify,
  onDialLead,
}) {
  const [prospectMode, setProspectMode] = useState("browse"); // "browse" | "add_new" | "upload_csv" | "api"
  const [browseMode, setBrowseMode] = useState("browse"); // "browse" | "all"
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [refreshing, setRefreshing] = useState(false);

  const [leadForm, setLeadForm] = useState({
    name: "",
    phone: "",
    email: "",
    notes: "",
    assigned_to: "",
    custom_fields: {},
  });

  const [csvHeaders, setCsvHeaders] = useState([]);
  const [csvRawRows, setCsvRawRows] = useState([]);
  const [columnMapping, setColumnMapping] = useState({});
  const [importingRows, setImportingRows] = useState(false);

  const [apiTestPayload, setApiTestPayload] = useState(
    '{\n  "name": "Rahul Sharma",\n  "phone": "9876543210",\n  "email": "rahul@example.com",\n  "serial_number": "SN-1001"\n}'
  );

  const [filters, setFilters] = useState({
    status: "all",
    disposition: "all",
    assignedTo: "all",
    search: "",
  });

  const [selectedLeadIds, setSelectedLeadIds] = useState([]);
  const [targetAssigneeId, setTargetAssigneeId] = useState("");
  const [allocating, setAllocating] = useState(false);
  const [localAssignmentById, setLocalAssignmentById] = useState({});
  const [localDeletedLeadIds, setLocalDeletedLeadIds] = useState([]);

  useEffect(() => {
    setPage(1);
    setSelectedLeadIds([]);
  }, [campaign?.id, filters, browseMode, pageSize, prospectMode]);

  const userNameMap = useMemo(() => {
    const map = {};
    for (const u of teamUsers || []) {
      map[u.id] = u.full_name || u.email || u.id;
    }
    return map;
  }, [teamUsers]);

  const enrichedLeads = useMemo(() => {
    const deletedSet = new Set(localDeletedLeadIds);
    return (campaignLeads || [])
      .filter((l) => !deletedSet.has(l.id))
      .map((l) => ({
        ...l,
        assigned_to:
          localAssignmentById[l.id] !== undefined ? localAssignmentById[l.id] : l.assigned_to,
      }));
  }, [campaignLeads, localAssignmentById, localDeletedLeadIds]);

  const filteredLeads = useMemo(() => {
    return enrichedLeads.filter((lead) => {
      if (filters.status !== "all" && (lead.status || "new") !== filters.status) return false;
      if (filters.disposition !== "all") {
        if (filters.disposition === "__none__" && lead.disposition) return false;
        if (filters.disposition !== "__none__" && (lead.disposition || "") !== filters.disposition) {
          return false;
        }
      }
      if (filters.assignedTo !== "all") {
        if (filters.assignedTo === "__unassigned__" && lead.assigned_to) return false;
        if (filters.assignedTo !== "__unassigned__" && lead.assigned_to !== filters.assignedTo) {
          return false;
        }
      }
      if (filters.search.trim()) {
        const q = filters.search.trim().toLowerCase();
        const cf =
          lead.custom_fields && typeof lead.custom_fields === "object" ? lead.custom_fields : {};
        const cfStr = Object.values(cf).join(" ").toLowerCase();
        const match =
          String(lead.name || "").toLowerCase().includes(q) ||
          String(lead.phone || "").toLowerCase().includes(q) ||
          String(lead.email || "").toLowerCase().includes(q) ||
          cfStr.includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [enrichedLeads, filters]);

  const totalPages = Math.max(1, Math.ceil(filteredLeads.length / pageSize));
  const safePage = Math.min(page, totalPages);

  const displayedLeads = useMemo(() => {
    if (browseMode === "all") return filteredLeads;
    const start = (safePage - 1) * pageSize;
    return filteredLeads.slice(start, start + pageSize);
  }, [browseMode, filteredLeads, safePage, pageSize]);

  const selectedSet = useMemo(() => new Set(selectedLeadIds), [selectedLeadIds]);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const campaignIngestUrl = campaign?.id
    ? `${origin}/api/campaigns/${campaign.id}/ingest`
    : "/api/campaigns/<campaign_id>/ingest";

  const curlCommand = useMemo(() => {
    let compact = apiTestPayload.replace(/\s+/g, " ").trim();
    try {
      compact = JSON.stringify(JSON.parse(apiTestPayload));
    } catch {
      // keep trimmed payload
    }
    return `curl --location --request POST '${campaignIngestUrl}' --header 'Content-Type: application/json' --data-raw '${compact}'`;
  }, [campaignIngestUrl, apiTestPayload]);

  async function handleManualRefresh() {
    setRefreshing(true);
    try {
      await onReloadAll?.();
      onNotify?.(`Refreshed live data for "${campaign.name}".`);
    } finally {
      setRefreshing(false);
    }
  }

  async function handleCopy(text, label) {
    try {
      await navigator.clipboard.writeText(text);
      onNotify?.(`Copied ${label}.`);
    } catch {
      onNotify?.(`Unable to copy ${label} automatically.`);
    }
  }

  async function handleAddSingle(e) {
    e.preventDefault();
    if (!session?.access_token || !campaign?.id) return;
    const res = await safeJsonFetch("/api/leads", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        ...leadForm,
        assigned_to: leadForm.assigned_to || null,
        source: "manual",
        project_id: campaign.id,
        tenant_id: profile?.role === "super_admin" ? selectedTenantScope || undefined : undefined,
      }),
    });
    if (!res.ok) {
      onNotify?.(res.data?.error || "Failed to add prospect.");
      return;
    }
    setLeadForm({ name: "", phone: "", email: "", notes: "", assigned_to: "", custom_fields: {} });
    setProspectMode("browse");
    onNotify?.(`Added prospect "${res.data.lead?.name || leadForm.name}".`);
    await onReloadAll?.();
  }

  function handleCsvFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseCsvRows(String(reader.result || ""));
      setCsvHeaders(parsed.headers);
      setCsvRawRows(parsed.rows);
      const stdMap = {
        name: "std:name",
        customer_name: "std:name",
        full_name: "std:name",
        phone: "std:phone",
        customer_number: "std:phone",
        mobile: "std:phone",
        email: "std:email",
        notes: "std:notes",
      };
      const fieldKeys = new Set((callFields || []).map((f) => f.field_key));
      const nextMap = {};
      for (const h of parsed.headers) {
        const k = toKey(h);
        if (stdMap[k]) nextMap[h] = { target: stdMap[k], newFieldName: h };
        else if (fieldKeys.has(k)) nextMap[h] = { target: `custom:${k}`, newFieldName: h };
        else nextMap[h] = { target: "new_field", newFieldName: h };
      }
      setColumnMapping(nextMap);
      onNotify?.(`Loaded ${parsed.rows.length} CSV row(s) from "${file.name}".`);
    };
    reader.readAsText(file);
  }

  async function handleImportCsv(e) {
    e.preventDefault();
    if (!session?.access_token || !campaign?.id || csvRawRows.length === 0) return;
    setImportingRows(true);
    try {
      const newFields = [];
      for (const h of csvHeaders) {
        const entry = columnMapping[h];
        if (entry?.target === "new_field") {
          const cleanKey = toKey(entry.newFieldName || h);
          if (cleanKey) {
            newFields.push({
              field_key: cleanKey,
              label: String(entry.newFieldName || h).trim(),
              field_type: "text",
            });
          }
        }
      }

      const mappedRows = csvRawRows.map((rawRow, idx) => {
        const rowObj = { _row_number: idx + 2, custom_fields: {} };
        for (const h of csvHeaders) {
          const val = rawRow[h];
          const entry = columnMapping[h] || { target: "ignore" };
          if (entry.target === "ignore") continue;
          if (entry.target.startsWith("std:")) {
            rowObj[entry.target.replace("std:", "")] = val;
          } else if (entry.target.startsWith("custom:")) {
            const cKey = entry.target.replace("custom:", "");
            if (val !== "") rowObj.custom_fields[cKey] = val;
          } else if (entry.target === "new_field") {
            const nKey = toKey(entry.newFieldName || h);
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
          project_id: campaign.id,
          tenant_id: profile?.role === "super_admin" ? selectedTenantScope || undefined : undefined,
          new_fields: newFields,
          rows: mappedRows,
        }),
      });
      if (!res.ok) {
        onNotify?.(res.data?.error || "CSV import failed.");
        return;
      }
      setCsvHeaders([]);
      setCsvRawRows([]);
      setColumnMapping({});
      setProspectMode("browse");
      onNotify?.(
        `Imported CSV — Created: ${res.data.created_count ?? res.data.uploaded_count ?? 0}, Updated: ${
          res.data.updated_count ?? 0
        }.`
      );
      await onReloadAll?.();
    } finally {
      setImportingRows(false);
    }
  }

  async function handleTestApi(e) {
    e.preventDefault();
    if (!campaign?.id) return;
    let body = {};
    try {
      body = JSON.parse(apiTestPayload);
    } catch {
      onNotify?.("Invalid JSON payload.");
      return;
    }
    const res = await safeJsonFetch(`/api/campaigns/${encodeURIComponent(campaign.id)}/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      onNotify?.(res.data?.error || "API ingest failed.");
      return;
    }
    onNotify?.(`Ingested lead "${res.data.lead?.name || ""}" into ${campaign.name}.`);
    await onReloadAll?.();
  }

  async function handleAllocateSelected() {
    if (selectedLeadIds.length === 0) return;
    setAllocating(true);
    const chosenAssignee = targetAssigneeId || null;
    try {
      if (session?.access_token) {
        await safeJsonFetch("/api/leads", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            lead_ids: selectedLeadIds,
            lead_id: selectedLeadIds.length === 1 ? selectedLeadIds[0] : undefined,
            assigned_to: chosenAssignee,
            tenant_id: profile?.role === "super_admin" ? selectedTenantScope || undefined : undefined,
          }),
        });
      }

      setLocalAssignmentById((prev) => {
        const next = { ...prev };
        for (const id of selectedLeadIds) {
          next[id] = chosenAssignee;
        }
        return next;
      });

      const count = selectedLeadIds.length;
      setSelectedLeadIds([]);
      onNotify?.(
        `Assigned ${count} lead(s) to ${
          chosenAssignee ? userNameMap[chosenAssignee] || "selected user" : "Unassigned"
        }.`
      );
      await onReloadAll?.();
    } finally {
      setAllocating(false);
    }
  }

  async function handleDeleteSelectedLeads() {
    if (selectedLeadIds.length === 0) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm(`Delete ${selectedLeadIds.length} selected lead(s)?`)
    ) {
      return;
    }
    if (session?.access_token) {
      await safeJsonFetch("/api/leads", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ lead_ids: selectedLeadIds }),
      });
    }
    setLocalDeletedLeadIds((prev) => Array.from(new Set([...prev, ...selectedLeadIds])));
    const count = selectedLeadIds.length;
    setSelectedLeadIds([]);
    onNotify?.(`Deleted ${count} lead(s).`);
    await onReloadAll?.();
  }

  async function handleDeleteSingleLead(lead) {
    if (!lead?.id) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm(`Delete lead "${lead.name || lead.phone}"?`)
    ) {
      return;
    }
    if (session?.access_token) {
      await safeJsonFetch(`/api/leads?lead_id=${encodeURIComponent(lead.id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
    }
    setLocalDeletedLeadIds((prev) => (prev.includes(lead.id) ? prev : [...prev, lead.id]));
    setSelectedLeadIds((prev) => prev.filter((id) => id !== lead.id));
    onNotify?.(`Deleted lead "${lead.name || lead.phone}".`);
    await onReloadAll?.();
  }

  async function handleRowAssigneeChange(leadId, assigneeVal) {
    const chosen = assigneeVal || null;
    setLocalAssignmentById((prev) => ({ ...prev, [leadId]: chosen }));
    if (session?.access_token) {
      await safeJsonFetch("/api/leads", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          lead_id: leadId,
          assigned_to: chosen,
        }),
      });
      await onReloadAll?.();
    }
    onNotify?.(`Lead assignment updated to ${chosen ? userNameMap[chosen] || "user" : "Unassigned"}.`);
  }

  function handleExportCombinedCsv() {
    const logsByLeadId = new Map();
    const logsByPhone = new Map();

    for (const log of callLogs || []) {
      if (log.lead_id) {
        const arr = logsByLeadId.get(log.lead_id) || [];
        arr.push(log);
        logsByLeadId.set(log.lead_id, arr);
      }
      const normPhone = String(log.phone || log.customer_phone || "").replace(/\D/g, "");
      if (normPhone) {
        const arr = logsByPhone.get(normPhone) || [];
        arr.push(log);
        logsByPhone.set(normPhone, arr);
      }
    }

    const customKeys = Array.from(
      new Set([
        ...(callFields || []).map((f) => f.field_key).filter(Boolean),
        ...filteredLeads.flatMap((l) =>
          l.custom_fields && typeof l.custom_fields === "object"
            ? Object.keys(l.custom_fields)
            : []
        ),
      ])
    );

    const headers = [
      "Campaign Name",
      "Lead ID",
      "Customer Name",
      "Phone",
      "Email",
      "Source",
      "Assigned To",
      "Lead Status",
      "Disposition",
      "Follow-Up At",
      "Lead Notes",
      ...customKeys.map((k) => `Lead Field: ${k}`),
      "Total Calls",
      "Last Call Status",
      "Last Call Duration (sec)",
      "Last Call Disposition",
      "Last Call Notes",
      "Last Called At",
    ];

    const rows = filteredLeads.map((l) => {
      const normPhone = String(l.phone || "").replace(/\D/g, "");
      const matchingCalls = [
        ...(logsByLeadId.get(l.id) || []),
        ...(normPhone ? logsByPhone.get(normPhone) || [] : []),
      ];
      const uniqueCalls = Array.from(
        new Map(matchingCalls.map((c, i) => [c.id || `c-${i}`, c])).values()
      ).sort(
        (a, b) =>
          new Date(b.created_at || b.called_at || 0).getTime() -
          new Date(a.created_at || a.called_at || 0).getTime()
      );

      const latestCall = uniqueCalls[0] || {};
      const cf = l.custom_fields && typeof l.custom_fields === "object" ? l.custom_fields : {};

      return [
        campaign?.name || "",
        l.id || "",
        l.name || "",
        l.phone || "",
        l.email || "",
        l.source || "manual",
        userNameMap[l.assigned_to] || "Unassigned",
        l.status || "new",
        l.disposition || "",
        l.follow_up_at || "",
        l.notes || "",
        ...customKeys.map((k) => cf[k] ?? l[k] ?? ""),
        uniqueCalls.length,
        latestCall.status || latestCall.call_status || "",
        latestCall.duration_seconds ?? latestCall.duration ?? "",
        latestCall.disposition || l.disposition || "",
        latestCall.notes || latestCall.call_notes || "",
        latestCall.created_at || latestCall.called_at || l.last_called_at || "",
      ];
    });

    const csvContent = [
      headers.map(escapeCsvCell).join(","),
      ...rows.map((r) => r.map(escapeCsvCell).join(",")),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const safeSlug = String(campaign?.name || "campaign")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_");
    link.download = `${safeSlug}_leads_and_calling_data.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    onNotify?.(`Exported ${rows.length} lead(s) with calling data into "${link.download}".`);
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {/* Prospect Action Bar (No extra campaign dropdown; already inside campaign.name) */}
      <div
        style={{
          padding: 12,
          border: "1px solid #cbd5e1",
          borderRadius: 10,
          background: "#ffffff",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 10,
        }}
      >
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ fontSize: 12, fontWeight: 700 }}>
            Prospects:{" "}
            <select
              value={prospectMode}
              onChange={(e) => setProspectMode(e.target.value)}
              style={{ padding: "6px 10px", borderRadius: 7, fontWeight: 600 }}
            >
              <option value="browse">Browse</option>
              <option value="add_new">Add New</option>
              <option value="upload_csv">Upload CSV</option>
              <option value="api">API</option>
            </select>
          </label>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            disabled={refreshing}
            onClick={handleManualRefresh}
            style={{
              padding: "6px 12px",
              borderRadius: 7,
              border: "1px solid #cbd5e1",
              background: "#f8fafc",
              fontWeight: 600,
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            {refreshing ? "Refreshing..." : "🔄 Refresh"}
          </button>

          <button
            type="button"
            onClick={handleExportCombinedCsv}
            style={{
              padding: "6px 12px",
              borderRadius: 7,
              border: "1px solid #047857",
              background: "#059669",
              color: "#ffffff",
              fontWeight: 700,
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            ⬇ Download Leads + Calling CSV
          </button>
        </div>
      </div>

      {/* Add New */}
      {prospectMode === "add_new" && !isAgent && (
        <div
          style={{
            padding: 14,
            border: "1px solid #cbd5e1",
            borderRadius: 10,
            background: "#ffffff",
          }}
        >
          <h4 style={{ marginTop: 0 }}>Add New Prospect — {campaign.name}</h4>
          <form
            onSubmit={handleAddSingle}
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: 8,
            }}
          >
            <input
              placeholder="Customer Name *"
              value={leadForm.name}
              onChange={(e) => setLeadForm((f) => ({ ...f, name: e.target.value }))}
              required
            />
            <input
              placeholder="Phone *"
              value={leadForm.phone}
              onChange={(e) => setLeadForm((f) => ({ ...f, phone: e.target.value }))}
              required
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
                    {u.full_name || u.email}
                  </option>
                ))}
              </select>
            )}
            {(callFields || []).map((cf) => (
              <input
                key={cf.id || cf.field_key}
                placeholder={cf.label}
                disabled={cf.is_editable === false}
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
            <button
              type="submit"
              style={{
                padding: "7px 12px",
                borderRadius: 6,
                border: "1px solid #15803d",
                background: "#16a34a",
                color: "#ffffff",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Save Prospect
            </button>
          </form>
        </div>
      )}

      {/* Upload CSV */}
      {prospectMode === "upload_csv" && !isAgent && (
        <div
          style={{
            padding: 14,
            border: "1px solid #cbd5e1",
            borderRadius: 10,
            background: "#ffffff",
          }}
        >
          <h4 style={{ marginTop: 0 }}>Upload CSV — {campaign.name}</h4>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <input type="file" accept=".csv,text/csv" onChange={handleCsvFileChange} />
            <button
              type="button"
              onClick={() => downloadSampleCsv(campaign.name, callFields)}
              style={{ padding: "6px 10px", borderRadius: 6, cursor: "pointer" }}
            >
              Download Sample CSV
            </button>
          </div>
          {csvHeaders.length > 0 && (
            <form onSubmit={handleImportCsv} style={{ marginTop: 12, display: "grid", gap: 8 }}>
              {csvHeaders.map((h) => {
                const entry = columnMapping[h] || { target: "ignore", newFieldName: h };
                return (
                  <div key={h} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
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
                      <option value="std:phone">Phone</option>
                      <option value="std:email">Email</option>
                      <option value="std:notes">Notes</option>
                      {(callFields || []).map((cf) => (
                        <option key={cf.id || cf.field_key} value={`custom:${cf.field_key}`}>
                          {cf.label} ({cf.field_key})
                        </option>
                      ))}
                      <option value="new_field">Create New Field</option>
                      <option value="ignore">Ignore</option>
                    </select>
                  </div>
                );
              })}
              <button
                type="submit"
                disabled={importingRows}
                style={{
                  width: "fit-content",
                  padding: "7px 14px",
                  borderRadius: 6,
                  border: "1px solid #15803d",
                  background: "#16a34a",
                  color: "#ffffff",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {importingRows ? "Importing..." : `Import ${csvRawRows.length} Rows`}
              </button>
            </form>
          )}
        </div>
      )}

      {/* API */}
      {prospectMode === "api" && !isAgent && (
        <div
          style={{
            padding: 14,
            border: "1px solid #cbd5e1",
            borderRadius: 10,
            background: "#ffffff",
            display: "grid",
            gap: 10,
            maxWidth: 680,
          }}
        >
          <h4 style={{ margin: 0 }}>API Ingest — {campaign.name}</h4>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", fontSize: 12 }}>
            <code>POST {campaignIngestUrl}</code>
            <button
              type="button"
              onClick={() => handleCopy(campaignIngestUrl, "campaign POST URL")}
              style={{ padding: "4px 8px", borderRadius: 6, cursor: "pointer" }}
            >
              📋 Copy URL
            </button>
            <button
              type="button"
              onClick={() => handleCopy(curlCommand, "POST cURL command")}
              style={{
                padding: "4px 10px",
                borderRadius: 6,
                border: "1px solid #1d4ed8",
                background: "#2563eb",
                color: "#ffffff",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              📋 Copy cURL (POST)
            </button>
          </div>
          <form onSubmit={handleTestApi} style={{ display: "grid", gap: 8 }}>
            <textarea
              rows={5}
              value={apiTestPayload}
              onChange={(e) => setApiTestPayload(e.target.value)}
              style={{
                padding: 8,
                borderRadius: 6,
                border: "1px solid #cbd5e1",
                fontFamily: "monospace",
                fontSize: 12,
              }}
            />
            <button
              type="submit"
              style={{
                width: "fit-content",
                padding: "6px 12px",
                borderRadius: 6,
                border: "1px solid #15803d",
                background: "#16a34a",
                color: "#ffffff",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              ▶ Send Test Lead
            </button>
          </form>
        </div>
      )}

      {/* Browse */}
      {prospectMode === "browse" && (
        <>
          <div
            style={{
              padding: 12,
              border: "1px solid #cbd5e1",
              borderRadius: 10,
              background: "#f8fafc",
              display: "grid",
              gap: 10,
            }}
          >
            <div
              style={{
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <input
                  placeholder="Filter name / phone / email..."
                  value={filters.search}
                  onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
                  style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid #cbd5e1" }}
                />
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
                  value={filters.disposition}
                  onChange={(e) => setFilters((f) => ({ ...f, disposition: e.target.value }))}
                >
                  <option value="all">All Dispositions</option>
                  <option value="__none__">No Disposition</option>
                  {(dispositions || []).map((d) => (
                    <option key={d.id} value={d.name}>
                      {d.name}
                    </option>
                  ))}
                </select>
                {!isAgent && teamUsers.length > 0 && (
                  <select
                    value={filters.assignedTo}
                    onChange={(e) => setFilters((f) => ({ ...f, assignedTo: e.target.value }))}
                  >
                    <option value="all">All Assignees</option>
                    <option value="__unassigned__">Unassigned</option>
                    {teamUsers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.full_name || u.email}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
                <button
                  type="button"
                  onClick={() => setBrowseMode("browse")}
                  style={{
                    fontWeight: browseMode === "browse" ? 700 : 500,
                    padding: "5px 9px",
                    borderRadius: 6,
                    cursor: "pointer",
                  }}
                >
                  Browse ({pageSize}/page)
                </button>
                <button
                  type="button"
                  onClick={() => setBrowseMode("all")}
                  style={{
                    fontWeight: browseMode === "all" ? 700 : 500,
                    padding: "5px 9px",
                    borderRadius: 6,
                    cursor: "pointer",
                  }}
                >
                  Display All ({filteredLeads.length})
                </button>
                {browseMode === "browse" && (
                  <select
                    value={pageSize}
                    onChange={(e) => setPageSize(Number(e.target.value))}
                    style={{ padding: "4px 6px", borderRadius: 6 }}
                  >
                    <option value={5}>5 / page</option>
                    <option value={10}>10 / page</option>
                    <option value={25}>25 / page</option>
                  </select>
                )}
              </div>
            </div>

            {!isAgent && canManageCampaign && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", fontSize: 12 }}>
                <strong>Assign to User ({selectedLeadIds.length} selected):</strong>
                <select
                  value={targetAssigneeId}
                  onChange={(e) => setTargetAssigneeId(e.target.value)}
                  style={{ padding: "5px 8px", borderRadius: 6 }}
                >
                  <option value="">-- Unassign --</option>
                  {teamUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.full_name || u.email}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={allocating || selectedLeadIds.length === 0}
                  onClick={handleAllocateSelected}
                  style={{
                    padding: "5px 12px",
                    borderRadius: 6,
                    border: "1px solid #1d4ed8",
                    background: "#2563eb",
                    color: "#ffffff",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  {allocating ? "Assigning..." : `Assign (${selectedLeadIds.length})`}
                </button>
                <button
                  type="button"
                  disabled={selectedLeadIds.length === 0}
                  onClick={handleDeleteSelectedLeads}
                  style={{
                    padding: "5px 12px",
                    borderRadius: 6,
                    border: "1px solid #fecaca",
                    background: "#fef2f2",
                    color: "#b91c1c",
                    fontWeight: 700,
                    cursor: selectedLeadIds.length === 0 ? "not-allowed" : "pointer",
                  }}
                >
                  Delete Selected ({selectedLeadIds.length})
                </button>
              </div>
            )}
          </div>

          <table border="1" cellPadding="8" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#f1f5f9" }}>
                {!isAgent && (
                  <th style={{ width: 32, textAlign: "center" }}>
                    <input
                      type="checkbox"
                      checked={
                        displayedLeads.length > 0 &&
                        displayedLeads.every((l) => selectedSet.has(l.id))
                      }
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedLeadIds(
                            Array.from(
                              new Set([...selectedLeadIds, ...displayedLeads.map((l) => l.id)])
                            )
                          );
                        } else {
                          const vis = new Set(displayedLeads.map((l) => l.id));
                          setSelectedLeadIds((prev) => prev.filter((id) => !vis.has(id)));
                        }
                      }}
                    />
                  </th>
                )}
                <th>Customer</th>
                <th>Phone</th>
                {!isAgent && <th>Assign To</th>}
                <th>Status</th>
                <th>Disposition</th>
                {onDialLead && <th>Call</th>}
                {!isAgent && canManageCampaign && <th>Delete</th>}
              </tr>
            </thead>
            <tbody>
              {displayedLeads.map((l) => (
                <tr key={l.id}>
                  {!isAgent && (
                    <td style={{ textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={selectedSet.has(l.id)}
                        onChange={() =>
                          setSelectedLeadIds((prev) =>
                            prev.includes(l.id) ? prev.filter((id) => id !== l.id) : [...prev, l.id]
                          )
                        }
                      />
                    </td>
                  )}
                  <td>
                    <strong>{l.name}</strong>
                    {l.email && <div style={{ fontSize: 11, color: "#64748b" }}>{l.email}</div>}
                  </td>
                  <td><strong>{l.phone}</strong></td>
                  {!isAgent && (
                    <td>
                      {teamUsers.length > 0 ? (
                        <select
                          value={l.assigned_to || ""}
                          onChange={(e) => handleRowAssigneeChange(l.id, e.target.value)}
                          style={{ padding: "4px 6px", borderRadius: 6 }}
                        >
                          <option value="">Unassigned</option>
                          {teamUsers.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.full_name || u.email}
                            </option>
                          ))}
                        </select>
                      ) : (
                        userNameMap[l.assigned_to] || "Unassigned"
                      )}
                    </td>
                  )}
                  <td><code>{l.status || "new"}</code></td>
                  <td>{l.disposition || "-"}</td>
                  {onDialLead && (
                    <td>
                      <button
                        type="button"
                        onClick={() => onDialLead(l)}
                        style={{
                          padding: "5px 10px",
                          borderRadius: 6,
                          border: "1px solid #15803d",
                          background: "#16a34a",
                          color: "#ffffff",
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        📞 Call
                      </button>
                    </td>
                  )}
                  {!isAgent && canManageCampaign && (
                    <td>
                      <button
                        type="button"
                        onClick={() => handleDeleteSingleLead(l)}
                        style={{
                          padding: "5px 9px",
                          borderRadius: 6,
                          border: "1px solid #fecaca",
                          background: "#fef2f2",
                          color: "#b91c1c",
                          fontWeight: 700,
                          fontSize: 12,
                          cursor: "pointer",
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {displayedLeads.length === 0 && (
                <tr>
                  <td
                    colSpan={
                      isAgent
                        ? onDialLead
                          ? 5
                          : 4
                        : canManageCampaign
                        ? onDialLead
                          ? 8
                          : 7
                        : onDialLead
                        ? 7
                        : 6
                    }
                  >
                    No prospects found in "{campaign.name}".
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {browseMode === "browse" && filteredLeads.length > 0 && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 10,
                fontSize: 13,
              }}
            >
              <span>
                Showing {(safePage - 1) * pageSize + 1}–
                {Math.min(safePage * pageSize, filteredLeads.length)} of {filteredLeads.length}
              </span>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  type="button"
                  disabled={safePage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  style={{ padding: "5px 10px", borderRadius: 6, cursor: "pointer" }}
                >
                  ← Prev
                </button>
                <span>
                  Page <strong>{safePage}</strong> of <strong>{totalPages}</strong>
                </span>
                <button
                  type="button"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  style={{ padding: "5px 10px", borderRadius: 6, cursor: "pointer" }}
                >
                  Next →
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
