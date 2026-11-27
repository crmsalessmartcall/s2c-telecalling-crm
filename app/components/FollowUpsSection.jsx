"use client";

import { useMemo, useState } from "react";
import { safeJsonFetch } from "@/lib/crmHelpers";

function formatLocalInput(isoVal) {
  if (!isoVal) return "";
  const d = new Date(isoVal);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function maskPhone(phone) {
  const raw = String(phone || "");
  if (!raw) return "—";
  const digits = raw.replace(/\D/g, "");
  if (digits.length <= 4) return "****";
  return `${"*".repeat(Math.max(4, digits.length - 4))}${digits.slice(-4)}`;
}

export default function FollowUpsSection({
  session,
  profile,
  selectedTenantScope,
  activeProjects,
  leads,
  dispositions,
  onReload,
  onNotify,
  onDialLead,
}) {
  const [projectFilter, setProjectFilter] = useState("");
  const [timingFilter, setTimingFilter] = useState("all");
  const [dispositionFilter, setDispositionFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [draftTimes, setDraftTimes] = useState({});
  const [savingId, setSavingId] = useState(null);

  const projectById = useMemo(() => {
    const map = {};
    for (const p of activeProjects || []) {
      map[p.id] = p;
    }
    return map;
  }, [activeProjects]);

  const projectNameById = useMemo(() => {
    const map = {};
    for (const p of activeProjects || []) {
      map[p.id] = p.name;
    }
    return map;
  }, [activeProjects]);

  const baseFollowUps = useMemo(() => {
    return (leads || []).filter((l) => {
      if (!l.follow_up_at) return false;
      const st = String(l.status || "").toLowerCase();
      return !["closed", "completed", "converted", "won", "lost"].includes(st);
    });
  }, [leads]);

  const timingCounts = useMemo(() => {
    const now = new Date();
    const nowMs = now.getTime();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const endOfToday = startOfToday + 24 * 60 * 60 * 1000;

    let overdue = 0;
    let today = 0;
    let upcoming = 0;

    for (const l of baseFollowUps) {
      if (projectFilter && l.project_id !== projectFilter) continue;
      const fuMs = new Date(l.follow_up_at).getTime();
      if (Number.isNaN(fuMs)) continue;
      if (fuMs < nowMs) overdue += 1;
      if (fuMs >= startOfToday && fuMs < endOfToday) today += 1;
      if (fuMs >= nowMs) upcoming += 1;
    }

    return { overdue, today, upcoming };
  }, [baseFollowUps, projectFilter]);

  const scheduledFollowUps = useMemo(() => {
    const now = new Date();
    const nowMs = now.getTime();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const endOfToday = startOfToday + 24 * 60 * 60 * 1000;

    return baseFollowUps
      .filter((l) => {
        if (projectFilter && l.project_id !== projectFilter) return false;

        if (dispositionFilter !== "all") {
          if (dispositionFilter === "__none__" && l.disposition) return false;
          if (dispositionFilter !== "__none__" && (l.disposition || "") !== dispositionFilter) {
            return false;
          }
        }

        const fuMs = new Date(l.follow_up_at).getTime();
        if (!Number.isNaN(fuMs)) {
          if (timingFilter === "overdue" && fuMs >= nowMs) return false;
          if (timingFilter === "today" && (fuMs < startOfToday || fuMs >= endOfToday)) return false;
          if (timingFilter === "upcoming" && fuMs < nowMs) return false;
        }

        if (search.trim()) {
          const q = search.trim().toLowerCase();
          const hit =
            String(l.name || "").toLowerCase().includes(q) ||
            String(l.phone || "").toLowerCase().includes(q) ||
            String(l.email || "").toLowerCase().includes(q) ||
            String(l.disposition || "").toLowerCase().includes(q) ||
            String(l.notes || "").toLowerCase().includes(q);
          if (!hit) return false;
        }

        return true;
      })
      .sort((a, b) => new Date(a.follow_up_at).getTime() - new Date(b.follow_up_at).getTime());
  }, [baseFollowUps, projectFilter, timingFilter, dispositionFilter, search]);

  async function handleSaveReschedule(lead, overrideIso = null) {
    if (!session?.access_token) return;
    const rawVal = overrideIso
      ? formatLocalInput(overrideIso)
      : draftTimes[lead.id] !== undefined
        ? draftTimes[lead.id]
        : formatLocalInput(lead.follow_up_at);

    if (!rawVal) {
      onNotify("Choose a valid date and time before rescheduling.");
      return;
    }

    setSavingId(lead.id);
    try {
      const res = await safeJsonFetch("/api/leads", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          lead_id: lead.id,
          follow_up_at: new Date(rawVal).toISOString(),
          status: "follow_up",
          tenant_id: profile?.role === "super_admin" ? selectedTenantScope || undefined : undefined,
        }),
      });

      if (!res.ok) {
        onNotify(res.data?.error || "Failed to reschedule follow-up.");
        return;
      }

      setDraftTimes((prev) => {
        const next = { ...prev };
        delete next[lead.id];
        return next;
      });
      onNotify(`Rescheduled follow-up for ${lead.name}.`);
      await onReload();
    } finally {
      setSavingId(null);
    }
  }

  async function handleCompleteFollowUp(lead) {
    if (!session?.access_token) return;
    setSavingId(lead.id);
    try {
      const res = await safeJsonFetch("/api/leads", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          lead_id: lead.id,
          status: "completed",
          follow_up_at: null,
          tenant_id: profile?.role === "super_admin" ? selectedTenantScope || undefined : undefined,
        }),
      });

      if (!res.ok) {
        onNotify(res.data?.error || "Failed to mark follow-up completed.");
        return;
      }

      onNotify(`Marked follow-up completed for ${lead.name}.`);
      await onReload();
    } finally {
      setSavingId(null);
    }
  }

  return (
    <section>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 14,
        }}
      >
        <h3 style={{ margin: 0 }}>⏰ Scheduled Follow-Ups ({scheduledFollowUps.length})</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => setTimingFilter(timingFilter === "overdue" ? "all" : "overdue")}
            style={{
              padding: "5px 12px",
              borderRadius: 999,
              border: timingFilter === "overdue" ? "2px solid #991b1b" : "1px solid #fca5a5",
              background: "#fef2f2",
              color: "#991b1b",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            🚨 Overdue: {timingCounts.overdue}
          </button>
          <button
            type="button"
            onClick={() => setTimingFilter(timingFilter === "today" ? "all" : "today")}
            style={{
              padding: "5px 12px",
              borderRadius: 999,
              border: timingFilter === "today" ? "2px solid #92400e" : "1px solid #fcd34d",
              background: "#fffbeb",
              color: "#92400e",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            📅 Due Today: {timingCounts.today}
          </button>
          <button
            type="button"
            onClick={() => setTimingFilter(timingFilter === "upcoming" ? "all" : "upcoming")}
            style={{
              padding: "5px 12px",
              borderRadius: 999,
              border: timingFilter === "upcoming" ? "2px solid #166534" : "1px solid #86efac",
              background: "#f0fdf4",
              color: "#166534",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            🗓️ Upcoming: {timingCounts.upcoming}
          </button>
        </div>
      </div>

      <div
        style={{
          padding: 12,
          border: "1px solid #cbd5e1",
          borderRadius: 10,
          background: "#f8fafc",
          marginBottom: 14,
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <select
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          style={{ padding: "6px 8px", borderRadius: 6 }}
        >
          <option value="">All Active Campaigns</option>
          {(activeProjects || []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <select
          value={timingFilter}
          onChange={(e) => setTimingFilter(e.target.value)}
          style={{ padding: "6px 8px", borderRadius: 6 }}
        >
          <option value="all">All Follow-Up Times</option>
          <option value="overdue">Overdue</option>
          <option value="today">Due Today</option>
          <option value="upcoming">Upcoming</option>
        </select>

        <select
          value={dispositionFilter}
          onChange={(e) => setDispositionFilter(e.target.value)}
          style={{ padding: "6px 8px", borderRadius: 6 }}
        >
          <option value="all">All Dispositions</option>
          <option value="__none__">No Disposition</option>
          {(dispositions || []).map((d) => (
            <option key={d.id} value={d.name}>
              {d.name}
            </option>
          ))}
        </select>

        <input
          placeholder="Search name, phone, email, notes..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 220, padding: "6px 8px", borderRadius: 6, border: "1px solid #cbd5e1" }}
        />

        {(projectFilter || timingFilter !== "all" || dispositionFilter !== "all" || search) && (
          <button
            type="button"
            onClick={() => {
              setProjectFilter("");
              setTimingFilter("all");
              setDispositionFilter("all");
              setSearch("");
            }}
            style={{ padding: "6px 10px", borderRadius: 6, cursor: "pointer" }}
          >
            Reset
          </button>
        )}
      </div>

      <table border="1" cellPadding="8" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: "#f1f5f9" }}>
            <th>Lead</th>
            <th>Phone</th>
            <th>Campaign</th>
            <th>Disposition</th>
            <th>Reschedule Follow-Up</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {scheduledFollowUps.map((l) => {
            const fuMs = new Date(l.follow_up_at).getTime();
            const isOverdue = !Number.isNaN(fuMs) && fuMs < Date.now();
            const currentInputVal =
              draftTimes[l.id] !== undefined ? draftTimes[l.id] : formatLocalInput(l.follow_up_at);
            const hidePhone = Boolean(projectById[l.project_id]?.hide_phone_numbers);

            return (
              <tr key={l.id} style={{ background: isOverdue ? "#fffafa" : "#ffffff" }}>
                <td>
                  <strong>{l.name}</strong>
                  {l.email && <div style={{ fontSize: 11, color: "#64748b" }}>{l.email}</div>}
                  {l.notes && <div style={{ fontSize: 11, color: "#475569" }}>{l.notes}</div>}
                </td>
                <td>
                  <strong>{hidePhone ? maskPhone(l.phone) : l.phone}</strong>
                </td>
                <td>{projectNameById[l.project_id] || "-"}</td>
                <td>
                  <span
                    style={{
                      display: "inline-block",
                      padding: "2px 8px",
                      borderRadius: 999,
                      fontSize: 11,
                      fontWeight: 600,
                      background: "#eff6ff",
                      color: "#1e40af",
                      border: "1px solid #bfdbfe",
                    }}
                  >
                    {l.disposition || "No Disposition"}
                  </span>
                </td>
                <td>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      marginBottom: 4,
                      color: isOverdue ? "#b91c1c" : "#166534",
                    }}
                  >
                    {isOverdue ? "🚨 Overdue: " : "🕒 Scheduled: "}
                    {new Date(l.follow_up_at).toLocaleString()}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    <input
                      type="datetime-local"
                      value={currentInputVal}
                      onChange={(e) =>
                        setDraftTimes((prev) => ({ ...prev, [l.id]: e.target.value }))
                      }
                      style={{ padding: "4px 6px", borderRadius: 6 }}
                    />
                    <button
                      type="button"
                      disabled={savingId === l.id}
                      onClick={() => handleSaveReschedule(l)}
                      style={{ padding: "4px 8px", borderRadius: 6, cursor: "pointer" }}
                    >
                      {savingId === l.id ? "Saving..." : "Save Time"}
                    </button>
                    <button
                      type="button"
                      disabled={savingId === l.id}
                      onClick={() =>
                        handleSaveReschedule(l, new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString())
                      }
                      style={{ padding: "4px 8px", borderRadius: 6, cursor: "pointer" }}
                    >
                      +24h
                    </button>
                  </div>
                </td>
                <td>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      style={{
                        fontWeight: 700,
                        padding: "6px 10px",
                        borderRadius: 6,
                        border: "1px solid #15803d",
                        background: "#16a34a",
                        color: "#ffffff",
                        cursor: "pointer",
                      }}
                      onClick={() => onDialLead?.(l)}
                    >
                      📞 Dial Now
                    </button>
                    <button
                      type="button"
                      disabled={savingId === l.id}
                      onClick={() => handleCompleteFollowUp(l)}
                      style={{
                        padding: "6px 10px",
                        borderRadius: 6,
                        border: "1px solid #cbd5e1",
                        background: "#f8fafc",
                        color: "#0f172a",
                        cursor: "pointer",
                      }}
                    >
                      ✓ Complete
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
          {scheduledFollowUps.length === 0 && (
            <tr>
              <td colSpan="6">No follow-ups match the selected filters.</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
```[cite: 9]

---

### 2. Updated `DialerSection.jsx`

```jsx
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

function formatDurationClock(totalSeconds) {
  const sec = Math.max(0, Number(totalSeconds || 0));
  const mins = Math.floor(sec / 60);
  const rem = sec % 60;
  return `${String(mins).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
}

function maskPhone(phone) {
  const raw = String(phone || "");
  if (!raw) return "—";
  const digits = raw.replace(/\D/g, "");
  if (digits.length <= 4) return "****";
  return `${"*".repeat(Math.max(4, digits.length - 4))}${digits.slice(-4)}`;
}

function getStatusBadgeStyle(status) {
  const st = String(status || "new").toLowerCase();
  if (st === "converted" || st === "connected" || st === "completed") {
    return { bg: "#dcfce7", color: "#166534", border: "#86efac", label: `✓ ${st}` };
  }
  if (st === "follow_up") {
    return { bg: "#fef3c7", color: "#92400e", border: "#fcd34d", label: "⏰ Follow-Up" };
  }
  if (st === "closed" || st === "no_answer" || st === "busy") {
    return { bg: "#fee2e2", color: "#991b1b", border: "#fca5a5", label: `• ${st}` };
  }
  return { bg: "#dbeafe", color: "#1e40af", border: "#93c5fd", label: "✨ Fresh Lead" };
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
  const isAgent = profile?.role === "agent";

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
  const [liveSeconds, setLiveSeconds] = useState(0);

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
    if (!form.callStartedAt) {
      setLiveSeconds(0);
      return;
    }
    const tick = () => {
      const elapsed = Math.max(
        0,
        Math.round((Date.now() - new Date(form.callStartedAt).getTime()) / 1000)
      );
      setLiveSeconds(elapsed);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [form.callStartedAt]);

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

  const projectById = useMemo(() => {
    const map = {};
    for (const p of activeProjects || []) {
      map[p.id] = p;
    }
    return map;
  }, [activeProjects]);

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

  const activeCampaignId = filter.project_id || currentLead?.project_id || selectedProjectId || "";
  const hidePhone = Boolean(projectById[activeCampaignId]?.hide_phone_numbers);

  const selectedDispositionObj = useMemo(
    () => (dispositions || []).find((d) => d.name === form.disposition) || null,
    [dispositions, form.disposition]
  );

  const todayStats = useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayMs = startOfToday.getTime();
    const todayCalls = (callLogs || []).filter((c) => {
      const t = c.created_at ? new Date(c.created_at).getTime() : 0;
      return !Number.isNaN(t) && t >= todayMs;
    });
    const connected = todayCalls.filter((c) =>
      ["connected", "completed", "converted"].includes(String(c.status || "").toLowerCase())
    ).length;
    return {
      callsToday: todayCalls.length,
      connectedToday: connected,
      queueRemaining: queueActive ? Math.max(0, queueLeads.length - queueIndex) : queueLeads.length,
    };
  }, [callLogs, queueActive, queueLeads, queueIndex]);

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

  function applyQuickFollowUpOffset(hoursToAdd) {
    const targetIso = new Date(Date.now() + hoursToAdd * 60 * 60 * 1000).toISOString();
    setForm((prev) => ({
      ...prev,
      follow_up_at: formatLocalInput(targetIso),
    }));
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
    onNotify(`Call started for ${hidePhone ? maskPhone(form.phone) : form.phone}.`);
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
        project_id: activeCampaignId || null,
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

  const badge = getStatusBadgeStyle(currentLead?.status || form.status);

  return (
    <section>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 14,
        }}
      >
        <h3 style={{ margin: 0 }}>
          📞 {isAgent ? "My Calling Desk" : "SmartCall Dialer Console"}
        </h3>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <span
            style={{
              padding: "5px 10px",
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 700,
              background: "#eff6ff",
              color: "#1d4ed8",
              border: "1px solid #bfdbfe",
            }}
          >
            📊 Calls Today: {todayStats.callsToday}
          </span>
          <span
            style={{
              padding: "5px 10px",
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 700,
              background: "#f0fdf4",
              color: "#15803d",
              border: "1px solid #bbf7d0",
            }}
          >
            ✅ Connected: {todayStats.connectedToday}
          </span>
          <span
            style={{
              padding: "5px 10px",
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 700,
              background: "#fefce8",
              color: "#a16207",
              border: "1px solid #fef08a",
            }}
          >
            📋 Queue Ready: {todayStats.queueRemaining}
          </span>
        </div>
      </div>

      <form
        onSubmit={handleApplyQueue}
        style={{
          padding: 12,
          border: "1px solid #cbd5e1",
          borderRadius: 10,
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
          style={{ padding: "6px 8px", borderRadius: 6 }}
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
          style={{ padding: "6px 8px", borderRadius: 6 }}
        >
          <option value="all">Fresh & Follow-Up</option>
          <option value="fresh">Only Fresh Call</option>
          <option value="followup">Only Follow-Up Call</option>
          <option value="fresh_and_followup">Fresh + Follow-Up Queue</option>
        </select>

        <select
          value={filter.status}
          onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value }))}
          style={{ padding: "6px 8px", borderRadius: 6 }}
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
          style={{ padding: "6px 8px", borderRadius: 6 }}
        >
          <option value="all">All Dispositions</option>
          <option value="__none__">No Disposition</option>
          {(dispositions || []).map((d) => (
            <option key={d.id} value={d.name}>
              {d.name}
            </option>
          ))}
        </select>

        {!isAgent && (
          <>
            <select
              value={filter.paramKey}
              onChange={(e) => setFilter((f) => ({ ...f, paramKey: e.target.value }))}
              style={{ padding: "6px 8px", borderRadius: 6 }}
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
              style={{ width: 150, padding: "6px 8px", borderRadius: 6 }}
            />
          </>
        )}

        <button
          type="submit"
          style={{
            fontWeight: 700,
            padding: "7px 14px",
            borderRadius: 6,
            border: "1px solid #1d4ed8",
            background: "#2563eb",
            color: "#ffffff",
            cursor: "pointer",
          }}
        >
          ▶ Start / Load Queue ({queueLeads.length})
        </button>
      </form>

      <div
        style={{
          padding: 16,
          border: form.callStartedAt ? "2px solid #16a34a" : "1px solid #cbd5e1",
          borderRadius: 12,
          background: "#ffffff",
          marginBottom: 22,
          boxShadow: "0 1px 4px rgba(15, 23, 42, 0.05)",
        }}
      >
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
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h4 style={{ margin: 0, fontSize: 16 }}>
              Calling Workspace{" "}
              {queueActive && queueLeads.length > 0
                ? `(Lead ${queueIndex + 1} of ${queueLeads.length})`
                : currentLead
                ? `(${currentLead.name})`
                : "(Direct / Manual)"}
            </h4>

            <span
              style={{
                padding: "3px 10px",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 700,
                background: badge.bg,
                color: badge.color,
                border: `1px solid ${badge.border}`,
              }}
            >
              {badge.label}
            </span>

            {form.callStartedAt && (
              <span
                style={{
                  padding: "3px 10px",
                  borderRadius: 999,
                  fontSize: 12,
                  fontWeight: 700,
                  background: "#dcfce7",
                  color: "#166534",
                  border: "1px solid #4ade80",
                }}
              >
                ● Live Call: {formatDurationClock(liveSeconds)}
              </span>
            )}
          </div>

          {!queueActive && (
            <input
              placeholder="Phone number..."
              value={hidePhone ? maskPhone(form.phone) : form.phone}
              readOnly={hidePhone}
              onChange={(e) => {
                if (!hidePhone) {
                  setForm((prev) => ({ ...prev, phone: e.target.value }));
                }
              }}
              style={{ width: 210, padding: "7px 10px", borderRadius: 6, border: "1px solid #94a3b8" }}
            />
          )}
        </div>

        <div
          style={{
            padding: 12,
            background: "#f8fafc",
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            marginBottom: 14,
            fontSize: 13,
          }}
        >
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <div>
              <strong>👤 Prospect:</strong> {currentLead?.name || "Direct Number"}
            </div>
            <div>
              <strong>📱 Phone:</strong>{" "}
              <span style={{ fontWeight: 700, color: "#0f172a" }}>
                {form.phone ? (hidePhone ? maskPhone(form.phone) : form.phone) : "-"}
              </span>
            </div>
            <div>
              <strong>🏷️ Last Disposition:</strong> {currentLead?.disposition || "None"}
            </div>
          </div>
          <div style={{ marginTop: 6, fontSize: 12, color: "#475569" }}>
            <strong>⏰ Follow-Up:</strong>{" "}
            {currentLead?.follow_up_at ? new Date(currentLead.follow_up_at).toLocaleString() : "None"}{" "}
            | <strong>📝 Details:</strong>{" "}
            {Object.entries(form.custom_fields || {})
              .filter(([, v]) => v !== "" && v != null)
              .map(([k, v]) => `${k}: ${v}`)
              .join(", ") || "None"}
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
          <button
            type="button"
            onClick={handleStartCall}
            disabled={Boolean(form.callStartedAt)}
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid #15803d",
              background: form.callStartedAt ? "#dcfce7" : "#16a34a",
              color: form.callStartedAt ? "#166534" : "#ffffff",
              fontWeight: 700,
              cursor: form.callStartedAt ? "default" : "pointer",
            }}
          >
            📞 Start Call
          </button>

          <button
            type="button"
            onClick={handleEndCall}
            disabled={!form.callStartedAt}
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid #d97706",
              background: "#fef3c7",
              color: "#92400e",
              fontWeight: 700,
              cursor: !form.callStartedAt ? "not-allowed" : "pointer",
            }}
          >
            ⏹ End Call
          </button>

          <button
            type="button"
            onClick={handleCancelCall}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid #fca5a5",
              background: "#fef2f2",
              color: "#991b1b",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            ✕ Cancel Call
          </button>

          <label style={{ fontSize: 12, fontWeight: 600 }}>
            Call Status:{" "}
            <select
              value={form.status}
              onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))}
              style={{ padding: "6px 8px", borderRadius: 6 }}
            >
              <option value="connected">connected</option>
              <option value="completed">completed</option>
              <option value="no_answer">no_answer</option>
              <option value="busy">busy</option>
            </select>
          </label>

          <label style={{ fontSize: 12, fontWeight: 600 }}>
            Duration (s):{" "}
            <input
              type="number"
              min="0"
              value={form.callStartedAt ? liveSeconds : form.duration_seconds}
              onChange={(e) => setForm((prev) => ({ ...prev, duration_seconds: e.target.value }))}
              style={{ width: 72, padding: "6px 8px", borderRadius: 6 }}
            />
          </label>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
            gap: 10,
            marginBottom: 14,
          }}
        >
          <label style={{ fontSize: 12, fontWeight: 600 }}>
            Disposition:
            <select
              value={form.disposition}
              onChange={(e) => handleDispositionChange(e.target.value)}
              style={{ width: "100%", marginTop: 4, padding: "7px 8px", borderRadius: 6 }}
            >
              <option value="">-- Select Disposition --</option>
              {(dispositions || []).map((d) => (
                <option key={d.id} value={d.name}>
                  {d.name} {d.requires_followup ? "(Follow-Up)" : ""}
                </option>
              ))}
            </select>
          </label>

          <div style={{ fontSize: 12, fontWeight: 600 }}>
            <div>
              Follow-Up Time {selectedDispositionObj?.requires_followup ? "(Recommended)" : ""}:
            </div>
            <input
              type="datetime-local"
              value={form.follow_up_at}
              onChange={(e) => setForm((prev) => ({ ...prev, follow_up_at: e.target.value }))}
              style={{ width: "100%", marginTop: 4, padding: "6px 8px", borderRadius: 6 }}
            />
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
              <button type="button" onClick={() => applyQuickFollowUpOffset(1)} style={{ fontSize: 11, padding: "2px 6px" }}>
                +1h
              </button>
              <button type="button" onClick={() => applyQuickFollowUpOffset(3)} style={{ fontSize: 11, padding: "2px 6px" }}>
                +3h
              </button>
              <button type="button" onClick={() => applyQuickFollowUpOffset(24)} style={{ fontSize: 11, padding: "2px 6px" }}>
                +24h
              </button>
            </div>
          </div>

          {(callFields || []).map((cf) => {
            const inputType =
              cf.field_type === "number" ? "number" : cf.field_type === "date" ? "date" : "text";
            return (
              <label key={cf.id} style={{ fontSize: 12, fontWeight: 600 }}>
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
                  style={{ width: "100%", marginTop: 4, padding: "7px 8px", borderRadius: 6 }}
                />
              </label>
            );
          })}

          <label style={{ fontSize: 12, fontWeight: 600 }}>
            Call Notes:
            <input
              placeholder="Short summary of call..."
              value={form.notes}
              onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
              style={{ width: "100%", marginTop: 4, padding: "7px 8px", borderRadius: 6 }}
            />
          </label>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => saveCall({ moveToNext: true })}
            style={{
              fontWeight: 700,
              padding: "9px 16px",
              borderRadius: 8,
              border: "1px solid #15803d",
              background: "#16a34a",
              color: "#ffffff",
              cursor: "pointer",
            }}
          >
            💾 Save & Next Lead
          </button>
          <button
            type="button"
            onClick={() => saveCall({ moveToNext: false })}
            style={{
              fontWeight: 600,
              padding: "9px 16px",
              borderRadius: 8,
              border: "1px solid #64748b",
              background: "#f1f5f9",
              color: "#0f172a",
              cursor: "pointer",
            }}
          >
            ✓ Save & Stop
          </button>
        </div>
      </div>

      <div style={{ padding: 14, border: "1px solid #cbd5e1", borderRadius: 10, background: "#ffffff" }}>
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
            🕘 Call Logs ({(callLogs || []).length} total — Page {callLogPage} of {totalPages}, 10 per page)
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
              const rowHidePhone = Boolean(projectById[c.project_id]?.hide_phone_numbers);
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
                    <td>{rowHidePhone ? maskPhone(c.phone) : c.phone}</td>
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
                              onNotify(`Calling back ${rowHidePhone ? maskPhone(c.phone) : c.phone}.`);
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
