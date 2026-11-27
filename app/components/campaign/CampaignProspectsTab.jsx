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

function maskPhone(phone) {
  const raw = String(phone || "");
  if (!raw) return "—";
  const digits = raw.replace(/\D/g, "");
  if (digits.length <= 4) return "****";
  return `${"*".repeat(Math.max(4, digits.length - 4))}${digits.slice(-4)}`;
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
  onPatchLeads,
  onDeleteLeads,
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

  // Draft filter inputs vs. Applied filter state (Apply button commits filters)
  const [draftFilters, setDraftFilters] = useState({
    status: "all",
    disposition: "all",
    assignedTo: "all",
    search: "",
  });
  const [appliedFilters, setAppliedFilters] = useState({
    status: "all",
    disposition: "all",
    assignedTo: "all",
    search: "",
  });

  // Bulk action state (Assign or Delete — applied via Apply button)
  const [selectedLeadIds, setSelectedLeadIds] = useState([]);
  const [bulkActionType, setBulkActionType] = useState("assign"); // "assign" | "delete"
  const [targetAssigneeId, setTargetAssigneeId] = useState("");
  const [applyingBulk, setApplyingBulk] = useState(false);

  useEffect(() => {
    setPage(1);
    setSelectedLeadIds([]);
  }, [campaign?.id, appliedFilters, browseMode, pageSize, prospectMode]);

  const userNameMap = useMemo(() => {
    const map = {};
    for (const u of teamUsers || []) {
      map[u.id] = u.full_name || u.email || u.id;
    }
    return map;
  }, [teamUsers]);

  // Only custom fields where Display is enabled appear on the prospect browse view
  const displayedCustomFields = useMemo(
    () => (callFields || []).filter((cf) => cf.is_displayed !== false),
    [callFields]
  );

  const filteredLeads = useMemo(() => {
    return (campaignLeads || []).filter((lead) => {
      if (appliedFilters.status !== "all" && (lead.status || "new") !== appliedFilters.status) {
        return false;
      }
      if (appliedFilters.disposition !== "all") {
        if (appliedFilters.disposition === "__none__" && lead.disposition) return false;
        if (
          appliedFilters.disposition !== "__none__" &&
          (lead.disposition || "") !== appliedFilters.disposition
        ) {
          return false;
        }
      }
      if (appliedFilters.assignedTo !== "all") {
        if (appliedFilters.assignedTo === "__unassigned__" && lead.assigned_to) return false;
        if (
          appliedFilters.assignedTo !== "__unassigned__" &&
          lead.assigned_to !== appliedFilters.assignedTo
        ) {
          return false;
        }
      }
      if (appliedFilters.search.trim()) {
        const q = appliedFilters.search.trim().toLowerCase();
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
  }, [campaignLeads, appliedFilters]);

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

  function handleApplyFilters() {
    setAppliedFilters({ ...draftFilters });
    setPage(1);
    onNotify?.("Applied prospect filters.");
  }

  function handleResetFilters() {
    const empty = { status: "all", disposition: "all", assignedTo: "all", search: "" };
    setDraftFilters(empty);
    setAppliedFilters(empty);
    setPage(1);
  }

  async function handleManualRefresh() {
    setRefreshing(true);
    try {
      await onReloadAll?.();
      onNotify?.(`Refreshed data for "${campaign.name}".`);
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

  // Apply button commits selected bulk action (Assign or Delete)
  async function handleApplyBulkAction() {
    if (selectedLeadIds.length === 0) {
      onNotify?.("Select at least one record first.");
      return;
    }
    setApplyingBulk(true);
    try {
      if (bulkActionType === "delete") {
        onDeleteLeads?.(selectedLeadIds);
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
        const count = selectedLeadIds.length;
        setSelectedLeadIds([]);
        onNotify?.(`Applied delete to ${count} selected record(s).`);
        await onReloadAll?.();
        return;
      }

      const chosenAssignee = targetAssigneeId || null;
      onPatchLeads?.(selectedLeadIds, { assigned_to: chosenAssignee });
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
      const count = selectedLeadIds.length;
      setSelectedLeadIds([]);
      onNotify?.(
        `Applied assignment for ${count} record(s) to ${
          chosenAssignee ? userNameMap[chosenAssignee] || "user" : "Unassigned"
        }.`
      );
      await onReloadAll?.();
    } finally {
      setApplyingBulk(false);
    }
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
      {/* Top Action Bar */}
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
            {/* Filter Controls + Apply Button */}
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
                  placeholder="Search name / phone / email..."
                  value={draftFilters.search}
                  onChange={(e) => setDraftFilters((f) => ({ ...f, search: e.target.value }))}
                  style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid #cbd5e1" }}
                />
                <select
                  value={draftFilters.status}
                  onChange={(e) => setDraftFilters((f) => ({ ...f, status: e.target.value }))}
                >
                  <option value="all">All Statuses</option>
                  <option value="new">new</option>
                  <option value="contacted">contacted</option>
                  <option value="follow_up">follow_up</option>
                  <option value="converted">converted</option>
                  <option value="closed">closed</option>
                </select>
                <select
                  value={draftFilters.disposition}
                  onChange={(e) => setDraftFilters((f) => ({ ...f, disposition: e.target.value }))}
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
                    value={draftFilters.assignedTo}
                    onChange={(e) => setDraftFilters((f) => ({ ...f, assignedTo: e.target.value }))}
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
                <button
                  type="button"
                  onClick={handleApplyFilters}
                  style={{
                    padding: "5px 12px",
                    borderRadius: 6,
                    border: "1px solid #047857",
                    background: "#059669",
                    color: "#ffffff",
                    fontWeight: 700,
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  Apply Filter
                </button>
                <button
                  type="button"
                  onClick={handleResetFilters}
                  style={{
                    padding: "5px 10px",
                    borderRadius: 6,
                    border: "1px solid #cbd5e1",
                    background: "#ffffff",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  Reset
                </button>
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

            {/* Bulk Assign / Delete Bar with Apply Button */}
            {!isAgent && canManageCampaign && (
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  flexWrap: "wrap",
                  alignItems: "center",
                  fontSize: 12,
                }}
              >
                <strong>Selected ({selectedLeadIds.length}):</strong>
                <select
                  value={bulkActionType}
                  onChange={(e) => setBulkActionType(e.target.value)}
                  style={{ padding: "5px 8px", borderRadius: 6 }}
                >
                  <option value="assign">Assign to User</option>
                  <option value="delete">Delete Selected</option>
                </select>

                {bulkActionType === "assign" && (
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
                )}

                <button
                  type="button"
                  disabled={applyingBulk || selectedLeadIds.length === 0}
                  onClick={handleApplyBulkAction}
                  style={{
                    padding: "5px 14px",
                    borderRadius: 6,
                    border: "1px solid #1d4ed8",
                    background: "#2563eb",
                    color: "#ffffff",
                    fontWeight: 700,
                    cursor: selectedLeadIds.length === 0 ? "not-allowed" : "pointer",
                  }}
                >
                  {applyingBulk ? "Applying..." : "Apply"}
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
                {displayedCustomFields.map((dcf) => (
                  <th key={dcf.id || dcf.field_key}>{dcf.label}</th>
                ))}
                {!isAgent && <th>Assigned To</th>}
                <th>Status</th>
                <th>Disposition</th>
                {onDialLead && <th>Call</th>}
              </tr>
            </thead>
            <tbody>
              {displayedLeads.map((l) => {
                const cf =
                  l.custom_fields && typeof l.custom_fields === "object" ? l.custom_fields : {};
                return (
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
                    <td>
                      <strong>
                        {campaign?.hide_phone_numbers ? maskPhone(l.phone) : l.phone}
                      </strong>
                    </td>
                    {displayedCustomFields.map((dcf) => (
                      <td key={dcf.id || dcf.field_key}>
                        {cf[dcf.field_key] ?? l[dcf.field_key] ?? "—"}
                      </td>
                    ))}
                    {!isAgent && <td>{userNameMap[l.assigned_to] || "Unassigned"}</td>}
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
                  </tr>
                );
              })}
              {displayedLeads.length === 0 && (
                <tr>
                  <td
                    colSpan={
                      (isAgent ? 4 : 6) +
                      displayedCustomFields.length +
                      (onDialLead ? 1 : 0)
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
