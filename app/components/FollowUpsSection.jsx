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
        <h3 style={{ margin: 0 }}>Scheduled Follow-Ups ({scheduledFollowUps.length})</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => setTimingFilter(timingFilter === "overdue" ? "all" : "overdue")}
            style={{
              padding: "4px 10px",
              borderRadius: 6,
              border: timingFilter === "overdue" ? "2px solid #991b1b" : "1px solid #fca5a5",
              background: "#fef2f2",
              color: "#991b1b",
              fontSize: 12,
              fontWeight: "bold",
              cursor: "pointer",
            }}
          >
            Overdue: {timingCounts.overdue}
          </button>
          <button
            type="button"
            onClick={() => setTimingFilter(timingFilter === "today" ? "all" : "today")}
            style={{
              padding: "4px 10px",
              borderRadius: 6,
              border: timingFilter === "today" ? "2px solid #92400e" : "1px solid #fcd34d",
              background: "#fffbeb",
              color: "#92400e",
              fontSize: 12,
              fontWeight: "bold",
              cursor: "pointer",
            }}
          >
            Due Today: {timingCounts.today}
          </button>
          <button
            type="button"
            onClick={() => setTimingFilter(timingFilter === "upcoming" ? "all" : "upcoming")}
            style={{
              padding: "4px 10px",
              borderRadius: 6,
              border: timingFilter === "upcoming" ? "2px solid #166534" : "1px solid #86efac",
              background: "#f0fdf4",
              color: "#166534",
              fontSize: 12,
              fontWeight: "bold",
              cursor: "pointer",
            }}
          >
            Upcoming: {timingCounts.upcoming}
          </button>
        </div>
      </div>

      <div
        style={{
          padding: 10,
          border: "1px solid #cbd5e1",
          borderRadius: 8,
          background: "#f8fafc",
          marginBottom: 14,
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
          <option value="">All Active Campaigns</option>
          {(activeProjects || []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <select value={timingFilter} onChange={(e) => setTimingFilter(e.target.value)}>
          <option value="all">All Follow-Up Times</option>
          <option value="overdue">Overdue</option>
          <option value="today">Due Today</option>
          <option value="upcoming">Upcoming</option>
        </select>

        <select value={dispositionFilter} onChange={(e) => setDispositionFilter(e.target.value)}>
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
          style={{ width: 220, padding: 5 }}
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
          >
            Reset
          </button>
        )}
      </div>

      <table border="1" cellPadding="8" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
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

            return (
              <tr key={l.id}>
                <td>
                  <strong>{l.name}</strong>
                  {l.email && <div style={{ fontSize: 11, color: "#64748b" }}>{l.email}</div>}
                  {l.notes && <div style={{ fontSize: 11, color: "#475569" }}>{l.notes}</div>}
                </td>
                <td>{l.phone}</td>
                <td>{projectNameById[l.project_id] || "-"}</td>
                <td>{l.disposition || "-"}</td>
                <td>
                  <div
                    style={{
                      fontSize: 11,
                      marginBottom: 4,
                      color: isOverdue ? "#b91c1c" : "#166534",
                    }}
                  >
                    {new Date(l.follow_up_at).toLocaleString()} {isOverdue ? "(Overdue)" : ""}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    <input
                      type="datetime-local"
                      value={currentInputVal}
                      onChange={(e) =>
                        setDraftTimes((prev) => ({ ...prev, [l.id]: e.target.value }))
                      }
                    />
                    <button
                      type="button"
                      disabled={savingId === l.id}
                      onClick={() => handleSaveReschedule(l)}
                    >
                      {savingId === l.id ? "Saving..." : "Save Time"}
                    </button>
                    <button
                      type="button"
                      disabled={savingId === l.id}
                      onClick={() =>
                        handleSaveReschedule(l, new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString())
                      }
                    >
                      +24h
                    </button>
                  </div>
                </td>
                <td>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      style={{ fontWeight: "bold" }}
                      onClick={() => onDialLead?.(l)}
                    >
                      Dial Now
                    </button>
                    <button
                      type="button"
                      disabled={savingId === l.id}
                      onClick={() => handleCompleteFollowUp(l)}
                    >
                      Complete
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
