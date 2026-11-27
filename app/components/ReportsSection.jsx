"use client";

export default function ReportsSection({ reportData }) {
  const rawSummary = reportData?.summary || {};
  const summary = {
    total_calls: Number(rawSummary.total_calls ?? 0),
    connected_calls: Number(rawSummary.connected_calls ?? 0),
    avg_duration_seconds: Number(rawSummary.avg_duration_seconds ?? 0),
    total_leads: Number(rawSummary.total_leads ?? 0),
    scheduled_followups: Number(rawSummary.scheduled_followups ?? 0),
  };

  const dispositions =
    reportData?.dispositions && typeof reportData.dispositions === "object"
      ? reportData.dispositions
      : {};
  const leadStatuses =
    reportData?.lead_statuses && typeof reportData.lead_statuses === "object"
      ? reportData.lead_statuses
      : {};
  const recentCalls = Array.isArray(reportData?.recent_calls) ? reportData.recent_calls : [];

  const cards = [
    { label: "Total Calls", value: summary.total_calls, icon: "📞", bg: "#eff6ff", border: "#bfdbfe" },
    { label: "Connected Calls", value: summary.connected_calls, icon: "✅", bg: "#f0fdf4", border: "#bbf7d0" },
    { label: "Avg Duration", value: `${summary.avg_duration_seconds}s`, icon: "⏱️", bg: "#faf5ff", border: "#e9d5ff" },
    { label: "Total Leads", value: summary.total_leads, icon: "👥", bg: "#f8fafc", border: "#cbd5e1" },
    { label: "Follow-Ups Scheduled", value: summary.scheduled_followups, icon: "⏰", bg: "#fffbeb", border: "#fde68a" },
  ];

  return (
    <section>
      <h3 style={{ marginTop: 0 }}>📈 Call & Conversion Reports</h3>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(175px, 1fr))",
          gap: 12,
          marginBottom: 20,
        }}
      >
        {cards.map((c) => (
          <div
            key={c.label}
            style={{
              padding: 14,
              border: `1px solid ${c.border}`,
              borderRadius: 10,
              background: c.bg,
            }}
          >
            <div style={{ fontSize: 12, color: "#475569", fontWeight: 600 }}>
              {c.icon} {c.label}
            </div>
            <strong style={{ fontSize: 22, color: "#0f172a", display: "block", marginTop: 4 }}>
              {c.value}
            </strong>
          </div>
        ))}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <div style={{ padding: 14, border: "1px solid #cbd5e1", borderRadius: 10, background: "#ffffff" }}>
          <h4 style={{ marginTop: 0 }}>🏷️ Calls by Disposition</h4>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {Object.entries(dispositions).map(([k, v]) => (
              <li key={k}>
                {k}: <strong>{v}</strong>
              </li>
            ))}
            {Object.keys(dispositions).length === 0 && <li>No disposition data yet.</li>}
          </ul>
        </div>

        <div style={{ padding: 14, border: "1px solid #cbd5e1", borderRadius: 10, background: "#ffffff" }}>
          <h4 style={{ marginTop: 0 }}>📌 Leads by Status</h4>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {Object.entries(leadStatuses).map(([k, v]) => (
              <li key={k}>
                {k}: <strong>{v}</strong>
              </li>
            ))}
            {Object.keys(leadStatuses).length === 0 && <li>No lead status data yet.</li>}
          </ul>
        </div>
      </div>

      <h4>🕘 Recent Call Activity</h4>
      <table border="1" cellPadding="8" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: "#f1f5f9" }}>
            <th>Time</th>
            <th>Phone</th>
            <th>Provider</th>
            <th>Status</th>
            <th>Disposition</th>
            <th>Duration</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {recentCalls.map((c) => (
            <tr key={c.id}>
              <td>{c.created_at ? new Date(c.created_at).toLocaleString() : "-"}</td>
              <td><strong>{c.phone}</strong></td>
              <td>{c.provider || "smartcall"}</td>
              <td>{c.status}</td>
              <td>{c.disposition || "-"}</td>
              <td>{c.duration_seconds || 0}s</td>
              <td>{c.notes || "-"}</td>
            </tr>
          ))}
          {recentCalls.length === 0 && (
            <tr>
              <td colSpan="7">No call records available yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
