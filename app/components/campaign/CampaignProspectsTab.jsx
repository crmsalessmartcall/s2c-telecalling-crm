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

export default function CampaignProspectsTab({
  session,
  profile,
  selectedTenantScope,
  campaign,
  teamUsers = [],
  callFields = [],
  dispositions = [],
  campaignLeads = [],
  isAgent,
  canManageCampaign,
  onReloadAll,
  onNotify,
  onDialLead,
}) {
  const [ingestChannel, setIngestChannel] = useState("single");
  const [browseMode, setBrowseMode] = useState("all"); // "all" | "browse"
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

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

  useEffect(() => {
    setPage(1);
    setSelectedLeadIds([]);
  }, [campaign?.id, filters, browseMode, pageSize]);

  const userNameMap = useMemo(() => {
    const map = {};
    for (const u of teamUsers || []) {
      map[u.id] = u.full_name || u.email || u.id;
    }
    return map;
  }, [teamUsers]);

  const filteredLeads = useMemo(() => {
    return (campaignLeads || []).filter((lead) => {
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
  }, [campaignLeads, filters]);

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
      // keep trimmed text
    }
    return `curl --location --request POST '${campaignIngestUrl}' --header 'Content-Type: application/json' --data-raw '${compact}'`;
  }, [campaignIngestUrl, apiTestPayload]);

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
      onNotify?.(`Loaded ${parsed.rows.length} row(s) from "${file.name}".`);
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
    if (!session?.access_token || selectedLeadIds.length === 0) return;
    setAllocating(true);
    try {
      const res = await safeJsonFetch("/api/leads", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          lead_ids: selectedLeadIds,
          assigned_to: targetAssigneeId || null,
          tenant_id: profile?.role === "super_admin" ? selectedTenantScope || undefined : undefined,
        }),
      });
      if (!res.ok) {
        onNotify?.(res.data?.error || "Failed to allocate leads.");
        return;
      }
      setSelectedLeadIds([]);
      onNotify?.(`Allocated ${selectedLeadIds.length} lead(s).`);
      await onReloadAll?.();
    } finally {
      setAllocating(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* Add / Upload / API Box */}
      {!isAgent && (
        <div
          style={{
            padding: 14,
            border: "1px solid #cbd5e1",
            borderRadius: 10,
            background: "#ffffff",
          }}
        >
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
            <h4 style={{ margin: 0 }}>📥 Prospects — Add, Upload & API ({campaign.name})</h4>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                type="button"
                onClick={() => setIngestChannel("single")}
                style={{ fontWeight: ingestChannel === "single" ? 700 : 500, padding: "5px 10px", borderRadius: 6, cursor: "pointer" }}
              >
                Add Prospect
              </button>
              <button
                type="button"
                onClick={() => setIngestChannel("csv")}
                style={{ fontWeight: ingestChannel === "csv" ? 700 : 500, padding: "5px 10px", borderRadius: 6, cursor: "pointer" }}
              >
                Upload CSV
              </button>
              <button
                type="button"
                onClick={() => setIngestChannel("api")}
                style={{ fontWeight: ingestChannel === "api" ? 700 : 500, padding: "5px 10px", borderRadius: 6, cursor: "pointer" }}
              >
                API-to-Lead
              </button>
            </div>
          </div>

          {ingestChannel === "single" && (
            <form
              onSubmit={handleAddSingle}
              style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8 }}
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
          )}

          {ingestChannel === "csv" && (
            <div>
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
                          {callFields.map((cf) => (
                            <option key={cf.id} value={`custom:${cf.field_key}`}>
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

          {ingestChannel === "api" && (
            <div style={{ display: "grid", gap: 10, maxWidth: 680 }}>
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
                  style={{ padding: 8, borderRadius: 6, border: "1px solid #cbd5e1", fontFamily: "monospace", fontSize: 12 }}
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
        </div>
      )}

      {/* Filter Bar + Display All / Browse with Pagination */}
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
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
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
              {dispositions.map((d) => (
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
            <span>View:</span>
            <button
              type="button"
              onClick={() => setBrowseMode("all")}
              style={{ fontWeight: browseMode === "all" ? 700 : 500, padding: "5px 9px", borderRadius: 6, cursor: "pointer" }}
            >
              Display All ({filteredLeads.length})
            </button>
            <button
              type="button"
              onClick={() => setBrowseMode("browse")}
              style={{ fontWeight: browseMode === "browse" ? 700 : 500, padding: "5px 9px", borderRadius: 6, cursor: "pointer" }}
            >
              Browse (Paginated)
            </button>
            {browseMode === "browse" && (
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                style={{ padding: "4px 6px", borderRadius: 6 }}
              >
                <option value={10}>10 / page</option>
                <option value={15}>15 / page</option>
                <option value={25}>25 / page</option>
                <option value={50}>50 / page</option>
              </select>
            )}
          </div>
        </div>

        {!isAgent && canManageCampaign && selectedLeadIds.length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", fontSize: 12 }}>
            <strong>{selectedLeadIds.length} selected:</strong>
            <select value={targetAssigneeId} onChange={(e) => setTargetAssigneeId(e.target.value)}>
              <option value="">-- Unassign --</option>
              {teamUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name || u.email}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={allocating}
              onClick={handleAllocateSelected}
              style={{ padding: "5px 10px", borderRadius: 6, fontWeight: 700, cursor: "pointer" }}
            >
              {allocating ? "Allocating..." : "Allocate Selected"}
            </button>
          </div>
        )}
      </div>

      {/* Prospects Table */}
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
                        Array.from(new Set([...selectedLeadIds, ...displayedLeads.map((l) => l.id)]))
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
            {!isAgent && <th>Assigned To</th>}
            <th>Status</th>
            <th>Disposition</th>
            {onDialLead && <th>Call</th>}
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
          ))}
          {displayedLeads.length === 0 && (
            <tr>
              <td colSpan={isAgent ? (onDialLead ? 5 : 4) : onDialLead ? 7 : 6}>
                No prospects found.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Pagination Controls in Browse Mode */}
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
    </div>
  );
}
