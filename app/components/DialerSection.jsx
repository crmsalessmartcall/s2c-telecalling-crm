"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { safeJsonFetch } from "@/lib/crmHelpers";
 
function getCustomFields(lead) {
  return lead?.custom_fields && typeof lead.custom_fields === "object" ? lead.custom_fields : {};
}

function formatLocalInput(isoVal) {
  if (!isoVal) return "";
  const d = new Date(isoVal);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function matchesFilter(lead, filter) {
  if (filter.status !== "all" && (lead.status || "new") !== filter.status) return false;

  if (filter.disposition !== "all") {
    if (filter.disposition === "__none__" && lead.disposition) return false;
    if (filter.disposition !== "__none__" && (lead.disposition || "") !== filter.disposition) {
      return false;
    }
  }

  const hasFollowUp = Boolean(lead.follow_up_at);
  const wasCalled = Boolean(lead.last_called_at) || (lead.status && lead.status !== "new");
  if (filter.callKind === "fresh" && (hasFollowUp || wasCalled)) return false;
  if (filter.callKind === "followup" && !hasFollowUp && (lead.status || "") !== "follow_up") {
    return false;
  }
  if (filter.callKind === "fresh_and_followup") {
    const isFresh = !hasFollowUp && !wasCalled;
    const isFollowup = hasFollowUp || (lead.status || "") === "follow_up";
    if (!isFresh && !isFollowup) return false;
  }

  if (filter.paramKey && filter.paramValue.trim()) {
    const needle = filter.paramValue.trim().toLowerCase();
    const cf = getCustomFields(lead);
    const val = cf[filter.paramKey] ?? lead[filter.paramKey] ?? "";
    if (!String(val).toLowerCase().includes(needle)) return false;
  }

  return true;
}

export default function DialerSection({
  session,
  profile,
  selectedTenantScope,
  activeProjects,
  selectedProjectId,
  leads,
  callFields,
  dispositions,
  callLogs,
  initialDialLead,
  onClearInitialDialLead,
  onReload,
  onNotify,
}) {
  const [filter, setFilter] = useState({
    project_id: selectedProjectId || "",
    status: "all",
    disposition: "all",
    callKind: "all",
    paramKey: "",
    paramValue: "",
  });

  useEffect(() => {
    if (selectedProjectId && !filter.project_id) {
      setFilter((prev) => ({ ...prev, project_id: selectedProjectId }));
    }
  }, [selectedProjectId, filter.project_id]);

  const [queueActive, setQueueActive] = useState(false);
  const [queueIndex, setQueueIndex] = useState(0);
  const [form, setForm] = useState({
    lead_id: "",
    phone: "",
    status: "connected",
    disposition: "",
    notes: "",
    duration_seconds: 0,
    follow_up_at: "",
    custom_fields: {},
    callStartedAt: null,
  });

  useEffect(() => {
    if (!initialDialLead) return;
    setQueueActive(false);
    setForm({
      lead_id: initialDialLead.id || "",
      phone: initialDialLead.phone || "",
      status: "connected",
      disposition: initialDialLead.disposition || "",
      notes: initialDialLead.notes || "",
      duration_seconds: 0,
      follow_up_at: initialDialLead.follow_up_at ? formatLocalInput(initialDialLead.follow_up_at) : "",
      custom_fields: { ...getCustomFields(initialDialLead) },
      callStartedAt: new Date().toISOString(),
    });
    onNotify(`Started call to ${initialDialLead.name} (${initialDialLead.phone}).`);
    onClearInitialDialLead?.();
  }, [initialDialLead, onClearInitialDialLead, onNotify]);

  const [callLogPage, setCallLogPage] = useState(1);
  const [expandedCallIds, setExpandedCallIds] = useState({});

  const paramOptions = useMemo(() => {
    const base = [{ key: "city", label: "City (city)" }];
    for (const cf of callFields || []) {
      if (cf.field_key && cf.field_key !== "city") {
        base.push({ key: cf.field_key, label: `${cf.label} (${cf.field_key})` });
      }
    }
    return base;
  }, [callFields]);

  const queueLeads = useMemo(() => {
    const pool = filter.project_id
      ? (leads || []).filter((l) => l.project_id === filter.project_id)
      : leads || [];
    return pool.filter((l) => matchesFilter(l, filter));
  }, [leads, filter]);

  const currentLead = useMemo(() => {
    if (queueActive && queueLeads.length > 0) {
      return queueLeads[Math.min(queueIndex, queueLeads.length - 1)] || null;
    }
    if (form.lead_id) {
      return (leads || []).find((l) => l.id === form.lead_id) || null;
    }
    return null;
  }, [queueActive, queueLeads, queueIndex, form.lead_id, leads]);

  const selectedDispositionObj = useMemo(
    () => (dispositions || []).find((d) => d.name === form.disposition) || null,
    [dispositions, form.disposition]
  );

  const CALLS_PER_PAGE = 10;
  const totalPages = Math.max(1, Math.ceil((callLogs || []).length / CALLS_PER_PAGE));
  const pageCalls = useMemo(() => {
    const start = (callLogPage - 1) * CALLS_PER_PAGE;
    return (callLogs || []).slice(start, start + CALLS_PER_PAGE);
  }, [callLogs, callLogPage]);

  function loadLeadIntoForm(lead) {
    if (!lead) return;
    setForm({
      lead_id: lead.id,
      phone: lead.phone || "",
      status: "connected",
      disposition: lead.disposition || "",
      notes: lead.notes || "",
      duration_seconds: 0,
      follow_up_at: lead.follow_up_at ? formatLocalInput(lead.follow_up_at) : "",
      custom_fields: { ...getCustomFields(lead) },
      callStartedAt: null,
    });
  }

  function handleDispositionChange(nextDispositionName) {
    const dispObj = (dispositions || []).find((d) => d.name === nextDispositionName);
    setForm((prev) => {
      const nextFollowUp =
        dispObj?.requires_followup && !prev.follow_up_at
          ? formatLocalInput(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString())
          : prev.follow_up_at;
      return {
        ...prev,
        disposition: nextDispositionName,
        follow_up_at: nextFollowUp,
      };
    });
  }

  function handleApplyQueue(e) {
    e.preventDefault();
    if (queueLeads.length === 0) {
      setQueueActive(false);
      setQueueIndex(0);
      onNotify("No leads match the selected dialer filter.");
      return;
    }
    setQueueActive(true);
    setQueueIndex(0);
    loadLeadIntoForm(queueLeads[0]);
    onNotify(`Loaded ${queueLeads.length} lead(s) into dialer queue (1 of ${queueLeads.length}).`);
  }

  function handleStartCall() {
    if (!form.phone.trim()) {
      onNotify("Select a lead or enter a phone number first.");
      return;
    }
    setForm((prev) => ({ ...prev, status: "connected", callStartedAt: new Date().toISOString() }));
    onNotify(`Call started for ${form.phone}.`);
  }

  function handleEndCall() {
    setForm((prev) => {
      const elapsed = prev.callStartedAt
        ? Math.max(1, Math.round((Date.now() - new Date(prev.callStartedAt).getTime()) / 1000))
        : prev.duration_seconds || 15;
      return { ...prev, duration_seconds: elapsed, callStartedAt: null };
    });
    onNotify("Call ended. Set disposition/follow-up and choose Save & Next or Save & Stop.");
  }

  function handleCancelCall() {
    setForm((prev) => ({ ...prev, callStartedAt: null, duration_seconds: 0, status: "no_answer" }));
    onNotify("Active call cancelled.");
  }

  async function saveCall({ moveToNext }) {
    if (!session?.access_token) return;
    if (!form.phone.trim()) {
      onNotify("Phone number is required to save call log.");
      return;
    }

    const duration = form.callStartedAt
      ? Math.max(1, Math.round((Date.now() - new Date(form.callStartedAt).getTime()) / 1000))
      : Number(form.duration_seconds || 0);

    const res = await safeJsonFetch("/api/calls", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        tenant_id: profile?.role === "super_admin" ? selectedTenantScope || undefined : undefined,
        project_id: filter.project_id || currentLead?.project_id || selectedProjectId || null,
        lead_id: form.lead_id || currentLead?.id || null,
        phone: form.phone.trim(),
        status: form.status,
        disposition: form.disposition || null,
        notes: form.notes || null,
        duration_seconds: duration,
        follow_up_at: form.follow_up_at ? new Date(form.follow_up_at).toISOString() : null,
        custom_fields: form.custom_fields,
      }),
    });

    if (!res.ok) {
      onNotify(res.data?.error || "Failed to save call log.");
      return;
    }

    await onReload();

    if (moveToNext && queueActive && queueLeads.length > 0) {
      const nextIdx = queueIndex + 1;
      if (nextIdx < queueLeads.length) {
        setQueueIndex(nextIdx);
        loadLeadIntoForm(queueLeads[nextIdx]);
        onNotify(`Saved call. Next lead (${nextIdx + 1} of ${queueLeads.length}): ${queueLeads[nextIdx].name}.`);
      } else {
        setQueueActive(false);
        setQueueIndex(0);
        onNotify("Saved call. End of filtered queue reached.");
      }
    } else {
      setQueueActive(false);
      setForm((prev) => ({ ...prev, callStartedAt: null, notes: "", follow_up_at: "" }));
      onNotify("Call saved and dialer stopped.");
    }
  }

  async function handleQuickFollowUp(leadId) {
    if (!session?.access_token || !leadId) return;
    const res = await safeJsonFetch("/api/leads", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        lead_id: leadId,
        status: "follow_up",
        follow_up_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      }),
    });
    if (!res.ok) {
      onNotify(res.data?.error || "Failed to schedule follow-up.");
      return;
    }
    onNotify("Scheduled +24h follow-up for lead.");
    await onReload();
  }

  return (
    <section>
      <h3>SmartCall Dialer Console</h3>

      <form
        onSubmit={handleApplyQueue}
        style={{
          padding: 12,
          border: "1px solid #cbd5e1",
          borderRadius: 8,
          background: "#f8fafc",
          marginBottom: 16,
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <select
          value={filter.project_id}
          onChange={(e) => setFilter((f) => ({ ...f, project_id: e.target.value }))}
        >
          <option value="">All Active Campaigns</option>
          {(activeProjects || []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <select
          value={filter.callKind}
          onChange={(e) => setFilter((f) => ({ ...f, callKind: e.target.value }))}
        >
          <option value="all">Fresh & Follow-Up</option>
          <option value="fresh">Only Fresh Call</option>
          <option value="followup">Only Follow-Up Call</option>
          <option value="fresh_and_followup">Fresh + Follow-Up Queue</option>
        </select>

        <select
          value={filter.status}
          onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value }))}
        >
          <option value="all">All Statuses</option>
          <option value="new">new</option>
          <option value="contacted">contacted</option>
          <option value="follow_up">follow_up</option>
          <option value="converted">converted</option>
          <option value="closed">closed</option>
        </select>

        <select
          value={filter.disposition}
          onChange={(e) => setFilter((f) => ({ ...f, disposition: e.target.value }))}
        >
          <option value="all">All Dispositions</option>
          <option value="__none__">No Disposition</option>
          {(dispositions || []).map((d) => (
            <option key={d.id} value={d.name}>
              {d.name}
            </option>
          ))}
        </select>

        <select
          value={filter.paramKey}
          onChange={(e) => setFilter((f) => ({ ...f, paramKey: e.target.value }))}
        >
          <option value="">Parameter Filter</option>
          {paramOptions.map((po) => (
            <option key={po.key} value={po.key}>
              {po.label}
            </option>
          ))}
        </select>

        <input
          placeholder="Filter value (e.g. Mumbai)"
          value={filter.paramValue}
          onChange={(e) => setFilter((f) => ({ ...f, paramValue: e.target.value }))}
          style={{ width: 150 }}
        />

        <button type="submit" style={{ fontWeight: "bold" }}>
          Apply Filter ({queueLeads.length})
        </button>
      </form>

      <div style={{ padding: 14, border: "1px solid #cbd5e1", borderRadius: 8, marginBottom: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <h4 style={{ margin: 0 }}>
            Calling Workspace{" "}
            {queueActive && queueLeads.length > 0
              ? `(${queueIndex + 1} of ${queueLeads.length})`
              : currentLead
              ? `(One-Click / Selected Lead: ${currentLead.name})`
              : "(Manual / Direct)"}
          </h4>
          {!queueActive && (
            <input
              placeholder="Phone number..."
              value={form.phone}
              onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
              style={{ width: 200 }}
            />
          )}
        </div>

        <div
          style={{
            padding: 10,
            background: "#f8fafc",
            border: "1px solid #e2e8f0",
            borderRadius: 6,
            marginBottom: 12,
            fontSize: 13,
          }}
        >
          <div>
            <strong>Lead:</strong> {currentLead?.name || "Direct Number"} | <strong>Phone:</strong>{" "}
            {form.phone || "-"} | <strong>Status:</strong> <code>{currentLead?.status || "new"}</code> |{" "}
            <strong>Last Disposition:</strong> {currentLead?.disposition || "-"}
          </div>
          <div style={{ marginTop: 4, fontSize: 12, color: "#475569" }}>
            <strong>Follow-Up:</strong>{" "}
            {currentLead?.follow_up_at ? new Date(currentLead.follow_up_at).toLocaleString() : "None"} |{" "}
            <strong>Parameters:</strong>{" "}
            {Object.entries(form.custom_fields || {})
              .filter(([, v]) => v !== "" && v != null)
              .map(([k, v]) => `${k}: ${v}`)
              .join(", ") || "None"}
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <button type="button" onClick={handleStartCall} disabled={Boolean(form.callStartedAt)}>
            Start Call
          </button>
          <button type="button" onClick={handleEndCall} disabled={!form.callStartedAt}>
            End Call
          </button>
          <button type="button" onClick={handleCancelCall} style={{ color: "#991b1b" }}>
            Cancel Call
          </button>
          <label style={{ fontSize: 12 }}>
            Status:{" "}
            <select
              value={form.status}
              onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))}
            >
              <option value="connected">connected</option>
              <option value="completed">completed</option>
              <option value="no_answer">no_answer</option>
              <option value="busy">busy</option>
            </select>
          </label>
          <label style={{ fontSize: 12 }}>
            Duration (s):{" "}
            <input
              type="number"
              min="0"
              value={form.duration_seconds}
              onChange={(e) => setForm((prev) => ({ ...prev, duration_seconds: e.target.value }))}
              style={{ width: 68 }}
            />
          </label>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: 8,
            marginBottom: 12,
          }}
        >
          <label style={{ fontSize: 12 }}>
            Disposition:
            <select
              value={form.disposition}
              onChange={(e) => handleDispositionChange(e.target.value)}
              style={{ width: "100%", marginTop: 2 }}
            >
              <option value="">-- Select --</option>
              {(dispositions || []).map((d) => (
                <option key={d.id} value={d.name}>
                  {d.name} {d.requires_followup ? "(Follow-Up)" : ""}
                </option>
              ))}
            </select>
          </label>

          <label style={{ fontSize: 12 }}>
            Follow-Up Time {selectedDispositionObj?.requires_followup ? "(Recommended)" : ""}:
            <input
              type="datetime-local"
              value={form.follow_up_at}
              onChange={(e) => setForm((prev) => ({ ...prev, follow_up_at: e.target.value }))}
              style={{ width: "100%", marginTop: 2 }}
            />
          </label>

          {(callFields || []).map((cf) => {
            const inputType =
              cf.field_type === "number" ? "number" : cf.field_type === "date" ? "date" : "text";
            return (
              <label key={cf.id} style={{ fontSize: 12 }}>
                {cf.label}:
                <input
                  type={inputType}
                  value={form.custom_fields[cf.field_key] || ""}
                  onChange={(e) => {
                    const val = e.target.value;
                    setForm((prev) => ({
                      ...prev,
                      custom_fields: { ...prev.custom_fields, [cf.field_key]: val },
                    }));
                  }}
                  style={{ width: "100%", marginTop: 2 }}
                />
              </label>
            );
          })}

          <label style={{ fontSize: 12 }}>
            Notes:
            <input
              value={form.notes}
              onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
              style={{ width: "100%", marginTop: 2 }}
            />
          </label>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={() => saveCall({ moveToNext: true })}
            style={{ fontWeight: "bold", padding: "6px 12px" }}
          >
            Save & Next
          </button>
          <button
            type="button"
            onClick={() => saveCall({ moveToNext: false })}
            style={{ padding: "6px 12px" }}
          >
            Save & Stop
          </button>
        </div>
      </div>

      <div style={{ padding: 14, border: "1px solid #cbd5e1", borderRadius: 8 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 8,
            marginBottom: 10,
          }}
        >
          <h4 style={{ margin: 0 }}>
            Call Logs ({(callLogs || []).length} total — Page {callLogPage} of {totalPages}, 10 per page)
          </h4>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button
              type="button"
              disabled={callLogPage <= 1}
              onClick={() => setCallLogPage((p) => Math.max(1, p - 1))}
            >
              Prev 10
            </button>
            <span style={{ fontSize: 12 }}>
              {callLogPage} / {totalPages}
            </span>
            <button
              type="button"
              disabled={callLogPage >= totalPages}
              onClick={() => setCallLogPage((p) => Math.min(totalPages, p + 1))}
            >
              Next 10
            </button>
          </div>
        </div>

        <table border="1" cellPadding="7" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr>
              <th>Details</th>
              <th>Time</th>
              <th>Phone</th>
              <th>Status</th>
              <th>Disposition</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            {pageCalls.map((c) => {
              const open = Boolean(expandedCallIds[c.id]);
              const cfEntries =
                c.custom_fields && typeof c.custom_fields === "object"
                  ? Object.entries(c.custom_fields)
                  : [];
              return (
                <Fragment key={c.id}>
                  <tr>
                    <td>
                      <button
                        type="button"
                        onClick={() => setExpandedCallIds((prev) => ({ ...prev, [c.id]: !prev[c.id] }))}
                      >
                        {open ? "Collapse" : "Expand"}
                      </button>
                    </td>
                    <td>{c.created_at ? new Date(c.created_at).toLocaleString() : "-"}</td>
                    <td>{c.phone}</td>
                    <td>{c.status}</td>
                    <td>{c.disposition || "-"}</td>
                    <td>{c.duration_seconds || 0}s</td>
                  </tr>
                  {open && (
                    <tr>
                      <td colSpan="6" style={{ background: "#f8fafc" }}>
                        <div style={{ marginBottom: 6 }}>
                          <strong>Provider:</strong> {c.provider || "smartcall"} |{" "}
                          <strong>Notes:</strong> {c.notes || "-"}
                        </div>
                        <div style={{ marginBottom: 8 }}>
                          <strong>Parameters:</strong>{" "}
                          {cfEntries.length > 0
                            ? cfEntries.map(([k, v]) => `${k}: ${String(v)}`).join(" | ")
                            : "None"}
                        </div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <button
                            type="button"
                            onClick={() => {
                              setQueueActive(false);
                              setForm((prev) => ({
                                ...prev,
                                lead_id: c.lead_id || "",
                                phone: c.phone || "",
                                status: "connected",
                                disposition: c.disposition || "",
                                notes: c.notes || "",
                                custom_fields:
                                  c.custom_fields && typeof c.custom_fields === "object"
                                    ? { ...c.custom_fields }
                                    : {},
                                callStartedAt: new Date().toISOString(),
                              }));
                              onNotify(`Calling back ${c.phone}.`);
                            }}
                          >
                            Call Back
                          </button>
                          {c.lead_id && (
                            <button type="button" onClick={() => handleQuickFollowUp(c.lead_id)}>
                              Schedule +24h Follow-Up
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {pageCalls.length === 0 && (
              <tr>
                <td colSpan="6">No call logs found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
