"use client";

import { useMemo, useState } from "react";
import { safeJsonFetch } from "@/lib/crmHelpers";

export default function CampaignPendingCallsTab({
  session,
  campaign,
  callFields = [],
  dispositions = [],
  pendingCallLeads = [],
  isAgent,
  onReloadAll,
  onNotify,
  onDialLead,
}) {
  const [callKind, setCallKind] = useState("all"); // "all" | "fresh" | "followup"
  const [paramKey, setParamKey] = useState("city");
  const [paramValue, setParamValue] = useState("");
  const [searchText, setSearchText] = useState("");
  const [sessionQueueIds, setSessionQueueIds] = useState(null);
  const [sessionIndex, setSessionIndex] = useState(0);

  const paramOptions = useMemo(() => {
    const opts = [
      { key: "city", label: "City (city)" },
      { key: "serial_number", label: "Serial Number (serial_number)" },
      { key: "phone", label: "Customer Number (phone)" },
      { key: "name", label: "Customer Name (name)" },
    ];
    for (const cf of callFields || []) {
      if (cf.field_key && !opts.some((o) => o.key === cf.field_key)) {
        opts.push({ key: cf.field_key, label: `${cf.label} (${cf.field_key})` });
      }
    }
    return opts;
  }, [callFields]);

  const filteredQueue = useMemo(() => {
    return (pendingCallLeads || []).filter((lead) => {
      const hasFollowUp = Boolean(lead.follow_up_at);
      const wasCalled = Boolean(lead.last_called_at) || (lead.status && lead.status !== "new");
      const isFollowup = hasFollowUp || (lead.status || "") === "follow_up";
      const isFresh = !hasFollowUp && !wasCalled;

      if (callKind === "fresh" && !isFresh) return false;
      if (callKind === "followup" && !isFollowup) return false;

      if (paramKey && paramValue.trim()) {
        const needle = paramValue.trim().toLowerCase();
        const cf =
          lead.custom_fields && typeof lead.custom_fields === "object" ? lead.custom_fields : {};
        const val = cf[paramKey] ?? lead[paramKey] ?? "";
        if (!String(val).toLowerCase().includes(needle)) return false;
      }

      if (searchText.trim()) {
        const q = searchText.trim().toLowerCase();
        const match =
          String(lead.name || "").toLowerCase().includes(q) ||
          String(lead.phone || "").toLowerCase().includes(q);
        if (!match) return false;
      }

      return true;
    });
  }, [pendingCallLeads, callKind, paramKey, paramValue, searchText]);

  const activeSequenceLeads = useMemo(() => {
    if (!Array.isArray(sessionQueueIds) || sessionQueueIds.length === 0) return filteredQueue;
    const byId = new Map(filteredQueue.map((l) => [l.id, l]));
    const ordered = sessionQueueIds.map((id) => byId.get(id)).filter(Boolean);
    return ordered.length > 0 ? ordered : filteredQueue;
  }, [sessionQueueIds, filteredQueue]);

  function startCallingSequence() {
    if (filteredQueue.length === 0) {
      onNotify?.("No pending leads match your current filter.");
      return;
    }
    const ids = filteredQueue.map((l) => l.id);
    setSessionQueueIds(ids);
    setSessionIndex(0);
    onDialLead?.(filteredQueue[0]);
  }

  function callNextInSequence() {
    if (activeSequenceLeads.length === 0) return;
    const nextIdx = (sessionIndex + 1) % activeSequenceLeads.length;
    setSessionIndex(nextIdx);
    onDialLead?.(activeSequenceLeads[nextIdx]);
  }

  async function handleQuickPatch(leadId, patch) {
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
      onNotify?.(res.data?.error || "Failed to update lead.");
      return;
    }
    onNotify?.("Updated lead.");
    await onReloadAll?.();
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {/* Queue Header & Start Calling Controls */}
      <div
        style={{
          padding: 14,
          border: "1px solid #cbd5e1",
          borderRadius: 10,
          background: "#f8fafc",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 10,
        }}
      >
        <div>
          <strong>
            📞 Pending Calls — {campaign.name} ({filteredQueue.length} of {pendingCallLeads.length})
          </strong>
          {sessionQueueIds && activeSequenceLeads.length > 0 && (
            <div style={{ fontSize: 12, color: "#1e40af", marginTop: 2 }}>
              Calling Queue Active: Lead #{sessionIndex + 1} of {activeSequenceLeads.length}
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={startCallingSequence}
            disabled={filteredQueue.length === 0 || !onDialLead}
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid #15803d",
              background: "#16a34a",
              color: "#ffffff",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            ▶ Start Calling ({filteredQueue.length})
          </button>

          {sessionQueueIds && activeSequenceLeads.length > 0 && onDialLead && (
            <button
              type="button"
              onClick={callNextInSequence}
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid #1d4ed8",
                background: "#2563eb",
                color: "#ffffff",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Next Customer →
            </button>
          )}
        </div>
      </div>

      {/* Filters: Fresh Call / Follow-Up / Parameter (City, Number, Character) */}
      <div
        style={{
          padding: 12,
          border: "1px solid #cbd5e1",
          borderRadius: 10,
          background: "#ffffff",
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <select value={callKind} onChange={(e) => setCallKind(e.target.value)}>
          <option value="all">All Pending Calls</option>
          <option value="fresh">Fresh Call</option>
          <option value="followup">Follow-Up Call</option>
        </select>

        <select value={paramKey} onChange={(e) => setParamKey(e.target.value)}>
          {paramOptions.map((po) => (
            <option key={po.key} value={po.key}>
              {po.label}
            </option>
          ))}
        </select>

        <input
          placeholder="Filter by city / number / character..."
          value={paramValue}
          onChange={(e) => setParamValue(e.target.value)}
          style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid #cbd5e1", minWidth: 210 }}
        />

        <input
          placeholder="Quick search name / phone..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid #cbd5e1", width: 170 }}
        />
      </div>

      {/* Pending Calls Table */}
      <table border="1" cellPadding="8" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: "#f1f5f9" }}>
            <th>#</th>
            <th>Customer</th>
            <th>Phone</th>
            <th>Type / Status</th>
            <th>Parameters</th>
            <th>Disposition</th>
            {onDialLead && <th>Call</th>}
          </tr>
        </thead>
        <tbody>
          {filteredQueue.map((lead, idx) => {
            const hasFollowUp = Boolean(lead.follow_up_at);
            const wasCalled =
              Boolean(lead.last_called_at) || (lead.status && lead.status !== "new");
            const isFollowup = hasFollowUp || (lead.status || "") === "follow_up";
            const callBadge = isFollowup
              ? "Follow-Up Call"
              : !wasCalled
              ? "Fresh Call"
              : lead.status || "Pending";

            const cf =
              lead.custom_fields && typeof lead.custom_fields === "object" ? lead.custom_fields : {};
            const cfEntries = Object.entries(cf).filter(([, v]) => v !== "" && v != null);

            return (
              <tr key={lead.id}>
                <td>{idx + 1}</td>
                <td><strong>{lead.name}</strong></td>
                <td><strong>{lead.phone}</strong></td>
                <td><code>{callBadge}</code></td>
                <td>
                  {cfEntries.length > 0
                    ? cfEntries.map(([k, v]) => (
                        <div key={k} style={{ fontSize: 12 }}>
                          <code>{k}</code>: <strong>{String(v)}</strong>
                        </div>
                      ))
                    : "-"}
                </td>
                <td>
                  <select
                    value={lead.disposition || ""}
                    onChange={(e) =>
                      handleQuickPatch(lead.id, { disposition: e.target.value || null })
                    }
                  >
                    <option value="">-- Select --</option>
                    {(dispositions || []).map((d) => (
                      <option key={d.id} value={d.name}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </td>
                {onDialLead && (
                  <td>
                    <button
                      type="button"
                      onClick={() => {
                        setSessionQueueIds(filteredQueue.map((item) => item.id));
                        setSessionIndex(idx);
                        onDialLead(lead);
                      }}
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
          {filteredQueue.length === 0 && (
            <tr>
              <td colSpan={onDialLead ? 7 : 6}>No pending calls match the selected filters.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
