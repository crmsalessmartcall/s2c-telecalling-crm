"use client";

import { useMemo, useState } from "react";
import { downloadSampleCsv, parseCsvRows, safeJsonFetch } from "@/lib/crmHelpers";

function toKey(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export default function CampaignsSection({
  session,
  profile,
  tenants,
  selectedTenantScope,
  onChangeTenantScope,
  activeProjects,
  selectedProjectId,
  onSelectProject,
  projectsCountAll,
  callFields,
  dispositions,
  leads,
  onReloadAll,
  onNotify,
}) {
  const [subTab, setSubTab] = useState("calling_data");
  const [projectForm, setProjectForm] = useState({ name: "", description: "" });
  const [fieldForm, setFieldForm] = useState({ label: "", field_type: "text" });
  const [dispositionForm, setDispositionForm] = useState({ name: "", requires_followup: false });

  const [leadForm, setLeadForm] = useState({
    name: "",
    phone: "",
    email: "",
    notes: "",
    follow_up_at: "",
    custom_fields: {},
  });

  // CSV file + mapping state
  const [csvHeaders, setCsvHeaders] = useState([]);
  const [csvRawRows, setCsvRawRows] = useState([]);
  const [columnMapping, setColumnMapping] = useState({});

  // Lead filter & bulk action state
  const [filters, setFilters] = useState({
    status: "all",
    disposition: "all",
    callKind: "all",
    paramKey: "",
    paramValue: "",
    search: "",
  });
  const [bulkFollowUpAt, setBulkFollowUpAt] = useState("");

  const activeCampaign = useMemo(
    () => activeProjects.find((p) => p.id === selectedProjectId) || null,
    [activeProjects, selectedProjectId]
  );

  const paramOptions = useMemo(() => {
    const opts = [{ key: "city", label: "City (city)" }];
    for (const cf of callFields || []) {
      if (cf.field_key && cf.field_key !== "city") {
        opts.push({ key: cf.field_key, label: `${cf.label} (${cf.field_key})` });
      }
    }
    return opts;
  }, [callFields]);

  const filteredLeads = useMemo(() => {
    return (leads || []).filter((lead) => {
      if (filters.status !== "all" && (lead.status || "new") !== filters.status) return false;

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
  }, [leads, filters]);

  function handleCsvFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseCsvRows(String(reader.result || ""));
      setCsvHeaders(parsed.headers);
      setCsvRawRows(parsed.rows);

      const knownKeys = new Set(["name", "phone", "email", "notes", "follow_up_at"]);
      const projectFieldKeys = new Set((callFields || []).map((f) => f.field_key));

      const nextMap = {};
      for (const h of parsed.headers) {
        const norm = toKey(h);
        if (knownKeys.has(norm)) {
          nextMap[h] = { target: `std:${norm}`, newFieldName: h };
        } else if (projectFieldKeys.has(norm)) {
          nextMap[h] = { target: `custom:${norm}`, newFieldName: h };
        } else {
          nextMap[h] = { target: "new_field", newFieldName: h };
        }
      }
      setColumnMapping(nextMap);
      onNotify(`Loaded ${parsed.rows.length} CSV row(s) from "${file.name}". Map columns and import.`);
    };
    reader.readAsText(file);
  }

  async function handleImportMappedCsv(e) {
    e.preventDefault();
    if (!session?.access_token || csvRawRows.length === 0) return;

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

    const mappedRows = csvRawRows.map((rawRow) => {
      const rowObj = { custom_fields: {} };
      for (const h of csvHeaders) {
        const val = rawRow[h];
        const mapEntry = columnMapping[h] || { target: "ignore" };
        if (mapEntry.target === "ignore") continue;

        if (mapEntry.target.startsWith("std:")) {
          const stdKey = mapEntry.target.replace("std:", "");
          rowObj[stdKey] = val;
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
        tenant_id: profile.role === "super_admin" ? selectedTenantScope || undefined : undefined,
        new_fields: newFields,
        rows: mappedRows,
      }),
    });

    if (!res.ok) {
      onNotify(res.data.error || "Failed to upload mapped CSV leads.");
      return;
    }

    setCsvHeaders([]);
    setCsvRawRows([]);
    setColumnMapping({});
    onNotify(
      `Imported ${res.data.uploaded_count || 0} lead(s) and created ${res.data.created_fields_count || 0} new project field(s).`
    );
    await onReloadAll();
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
        tenant_id: profile.role === "super_admin" ? selectedTenantScope || undefined : undefined,
      }),
    });
    if (!res.ok) {
      onNotify(res.data.error || "Failed to create campaign.");
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
        tenant_id: profile.role === "super_admin" ? selectedTenantScope || undefined : undefined,
      }),
    });
    if (!res.ok) {
      onNotify(res.data.error || "Failed to add disposition.");
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
        tenant_id: profile.role === "super_admin" ? selectedTenantScope || undefined : undefined,
      }),
    });
    if (!res.ok) {
      onNotify(res.data.error || "Failed to add call field.");
      return;
    }
    setFieldForm({ label: "", field_type: "text" });
    onNotify(`Added call field "${res.data.field?.label}".`);
    await onReloadAll();
  }

  async function handleAddSingleLead(e) {
    e.preventDefault();
    if (!session?.access_token) return;
    const res = await safeJsonFetch("/api/leads", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        ...leadForm,
        project_id: selectedProjectId || null,
        tenant_id: profile.role === "super_admin" ? selectedTenantScope || undefined : undefined,
      }),
    });
    if (!res.ok) {
      onNotify(res.data.error || "Failed to add lead.");
      return;
    }
    setLeadForm({ name: "", phone: "", email: "", notes: "", follow_up_at: "", custom_fields: {} });
    onNotify(`Added lead "${res.data.lead?.name}".`);
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
      onNotify(res.data.error || "Failed to update lead.");
      return;
    }
    onNotify("Lead updated.");
    await onReloadAll();
  }

  async function handleBulkSetFollowUp() {
    if (!session?.access_token || !bulkFollowUpAt || filteredLeads.length === 0) return;
    const ids = filteredLeads.map((l) => l.id);
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
        tenant_id: profile.role === "super_admin" ? selectedTenantScope || undefined : undefined,
      }),
    });
    if (!res.ok) {
      onNotify(res.data.error || "Failed to set bulk follow-up.");
      return;
    }
    onNotify(`Follow-up scheduled for ${ids.length} filtered lead(s).`);
    await onReloadAll();
  }

  async function handleBulkDeleteFiltered() {
    if (!session?.access_token || filteredLeads.length === 0) return;
    const count = filteredLeads.length;
    if (typeof window !== "undefined" && !window.confirm(`Delete ${count} filtered lead(s)?`)) return;
    const ids = filteredLeads.map((l) => l.id);
    const res = await safeJsonFetch("/api/leads", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        lead_ids: ids,
        tenant_id: profile.role === "super_admin" ? selectedTenantScope || undefined : undefined,
      }),
    });
    if (!res.ok) {
      onNotify(res.data.error || "Failed to delete filtered leads.");
      return;
    }
    onNotify(`Deleted ${count} filtered lead(s).`);
    await onReloadAll();
  }

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
            Active Campaigns ({activeProjects.length} / {projectsCountAll})
          </h3>

          {profile.role === "super_admin" && tenants.length > 0 && (
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
              Calling Data
            </button>
            <button
              type="button"
              onClick={() => setSubTab("settings")}
              style={{ fontWeight: subTab === "settings" ? "bold" : "normal" }}
            >
              Settings
            </button>
          </div>
        )}
      </div>

      {["super_admin", "tenant_admin"].includes(profile.role) && (
        <div style={{ marginBottom: 16, padding: 12, border: "1px solid #cbd5e1", borderRadius: 8 }}>
          <h4 style={{ marginTop: 0 }}>Create Campaign</h4>
          <form onSubmit={handleCreateCampaign} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              placeholder="Campaign Name"
              value={projectForm.name}
              onChange={(e) => setProjectForm((f) => ({ ...f, name: e.target.value }))}
              required
            />
            <input
              placeholder="Description / Dates"
              value={projectForm.description}
              onChange={(e) => setProjectForm((f) => ({ ...f, description: e.target.value }))}
            />
            <button type="submit">Create Campaign</button>
          </form>
        </div>
      )}

      {!selectedProjectId ? (
        <div style={{ padding: 16, border: "1px dashed #94a3b8", borderRadius: 8, color: "#475569" }}>
          Select an active campaign above to access <strong>Calling Data</strong> and{" "}
          <strong>Settings</strong>.
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
              gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
              gap: 12,
              marginBottom: 16,
            }}
          >
            <div style={{ padding: 12, border: "1px solid #cbd5e1", borderRadius: 8 }}>
              <h4 style={{ marginTop: 0 }}>Add Lead — {activeCampaign?.name}</h4>
              <form onSubmit={handleAddSingleLead} style={{ display: "grid", gap: 8 }}>
                <input
                  placeholder="Customer Name"
                  value={leadForm.name}
                  onChange={(e) => setLeadForm((f) => ({ ...f, name: e.target.value }))}
                  required
                />
                <input
                  placeholder="Phone Number"
                  value={leadForm.phone}
                  onChange={(e) => setLeadForm((f) => ({ ...f, phone: e.target.value }))}
                  required
                />
                <input
                  placeholder="Email (optional)"
                  value={leadForm.email}
                  onChange={(e) => setLeadForm((f) => ({ ...f, email: e.target.value }))}
                />
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
                <button type="submit">Add Lead</button>
              </form>
            </div>

            <div style={{ padding: 12, border: "1px solid #cbd5e1", borderRadius: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <h4 style={{ margin: 0 }}>Bulk CSV Upload & Mapping</h4>
                <button
                  type="button"
                  onClick={() => downloadSampleCsv(activeCampaign?.name, callFields)}
                >
                  Download Sample CSV
                </button>
              </div>
              <input type="file" accept=".csv,text/csv" onChange={handleCsvFileChange} />

              {csvHeaders.length > 0 && (
                <form onSubmit={handleImportMappedCsv} style={{ marginTop: 10, display: "grid", gap: 6 }}>
                  <div style={{ fontSize: 12, fontWeight: "bold" }}>
                    Map CSV Columns ({csvRawRows.length} rows ready):
                  </div>
                  {csvHeaders.map((h) => {
                    const entry = columnMapping[h] || { target: "ignore", newFieldName: h };
                    return (
                      <div key={h} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
                        <code style={{ minWidth: 90 }}>{h}</code>
                        <select
                          value={entry.target}
                          onChange={(e) =>
                            setColumnMapping((prev) => ({
                              ...prev,
                              [h]: { ...entry, target: e.target.value },
                            }))
                          }
                        >
                          <option value="std:name">Name</option>
                          <option value="std:phone">Phone</option>
                          <option value="std:email">Email</option>
                          <option value="std:notes">Notes</option>
                          <option value="std:follow_up_at">Follow-Up</option>
                          {callFields.map((cf) => (
                            <option key={cf.id} value={`custom:${cf.field_key}`}>
                              Project Field: {cf.label} ({cf.field_key})
                            </option>
                          ))}
                          <option value="new_field">+ Create New Project Field</option>
                          <option value="ignore">Ignore</option>
                        </select>
                        {entry.target === "new_field" && (
                          <input
                            placeholder="New field name"
                            value={entry.newFieldName}
                            onChange={(e) =>
                              setColumnMapping((prev) => ({
                                ...prev,
                                [h]: { ...entry, newFieldName: e.target.value },
                              }))
                            }
                            style={{ width: 120 }}
                          />
                        )}
                      </div>
                    );
                  })}
                  <button type="submit" style={{ fontWeight: "bold", marginTop: 4 }}>
                    Import Mapped Leads
                  </button>
                </form>
              )}
            </div>
          </div>

          {/* Filter & Bulk Operations */}
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

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: 12, fontWeight: "bold" }}>
                Bulk ({filteredLeads.length} filtered):
              </span>
              <input
                type="datetime-local"
                value={bulkFollowUpAt}
                onChange={(e) => setBulkFollowUpAt(e.target.value)}
              />
              <button type="button" onClick={handleBulkSetFollowUp} disabled={!bulkFollowUpAt || filteredLeads.length === 0}>
                Bulk Set Follow-Up
              </button>
              <button
                type="button"
                onClick={handleBulkDeleteFiltered}
                disabled={filteredLeads.length === 0}
                style={{ color: "#991b1b" }}
              >
                Delete Filtered
              </button>
            </div>
          </div>

          <table border="1" cellPadding="8" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                <th>Customer</th>
                <th>Phone</th>
                <th>Parameters</th>
                <th>Status</th>
                <th>Last Disposition</th>
                <th>Follow-Up</th>
              </tr>
            </thead>
            <tbody>
              {filteredLeads.map((l) => {
                const cf = l.custom_fields && typeof l.custom_fields === "object" ? l.custom_fields : {};
                const entries = Object.entries(cf).filter(([, v]) => v !== "" && v != null);
                return (
                  <tr key={l.id}>
                    <td>
                      <strong>{l.name}</strong>
                      {l.email && <div style={{ fontSize: 11, color: "#64748b" }}>{l.email}</div>}
                    </td>
                    <td>{l.phone}</td>
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
                  </tr>
                );
              })}
              {filteredLeads.length === 0 && (
                <tr>
                  <td colSpan="6">No leads match the selected filters.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
