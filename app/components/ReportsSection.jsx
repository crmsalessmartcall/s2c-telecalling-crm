"use client";

export default function ReportsSection({ reportData }) {
  const summary = reportData?.summary || {
    total_calls: 0,
    connected_calls: 0,
    avg_duration_seconds: 0,
    total_leads: 0,
    scheduled_followups: 0,
  };
  const dispositions = reportData?.dispositions || {};
  const leadStatuses = reportData?.lead_statuses || {};
  const recentCalls = reportData?.recent_calls || [];

  return (
    <section>
      <h3>Call & Conversion Reports</h3>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <div style={{ padding: 12, border: "1px solid #cbd5e1", borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: "#64748b" }}>Total Calls</div>
          <strong style={{ fontSize: 20 }}>{summary.total_calls}</strong>
        </div>
        <div style={{ padding: 12, border: "1px solid #cbd5e1", borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: "#64748b" }}>Connected Calls</div>
          <strong style={{ fontSize: 20 }}>{summary.connected_calls}</strong>
        </div>
        <div style={{ padding: 12, border: "1px solid #cbd5e1", borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: "#64748b" }}>Avg Duration</div>
          <strong style={{ fontSize: 20 }}>{summary.avg_duration_seconds}s</strong>
        </div>
        <div style={{ padding: 12, border: "1px solid #cbd5e1", borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: "#64748b" }}>Total Leads</div>
          <strong style={{ fontSize: 20 }}>{summary.total_leads}</strong>
        </div>
        <div style={{ padding: 12, border: "1px solid #cbd5e1", borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: "#64748b" }}>Follow-Ups Scheduled</div>
          <strong style={{ fontSize: 20 }}>{summary.scheduled_followups}</strong>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <div style={{ padding: 12, border: "1px solid #cbd5e1", borderRadius: 8 }}>
          <h4 style={{ marginTop: 0 }}>Calls by Disposition</h4>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {Object.entries(dispositions).map(([k, v]) => (
              <li key={k}>
                {k}: <strong>{v}</strong>
              </li>
            ))}
            {Object.keys(dispositions).length === 0 && <li>No disposition data yet.</li>}
          </ul>
        </div>

        <div style={{ padding: 12, border: "1px solid #cbd5e1", borderRadius: 8 }}>
          <h4 style={{ marginTop: 0 }}>Leads by Status</h4>
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

      <h4>Recent Call Activity</h4>
      <table border="1" cellPadding="8" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
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
              <td>{c.phone}</td>
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
