"use client";

import { Fragment, useState } from "react";
import { safeJsonFetch } from "@/lib/crmHelpers";

function LicensePeriodBadge({ period }) {
  const nowMs = Date.now();
  const startMs = period?.starts_at ? new Date(period.starts_at).getTime() : -Infinity;
  const endMs = period?.ends_at ? new Date(period.ends_at).getTime() : Infinity;

  const derivedState =
    !Number.isNaN(endMs) && endMs <= nowMs
      ? "expired"
      : !Number.isNaN(startMs) && startMs > nowMs
      ? "upcoming"
      : "active";

  const state = period?.period_state || derivedState;
  const label =
    period?.period_label ||
    (state === "active" ? "Active Now" : state === "upcoming" ? "Upcoming" : "Expired");

  const styles =
    state === "active"
      ? { background: "#dcfce7", color: "#166534", border: "1px solid #86efac" }
      : state === "upcoming"
      ? { background: "#dbeafe", color: "#1e40af", border: "1px solid #93c5fd" }
      : { background: "#fee2e2", color: "#991b1b", border: "1px solid #fca5a5" };

  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: "bold",
        ...styles,
      }}
    >
      {label}
    </span>
  );
}

export default function TenantsSection({ session, profile, tenants, onReload, onNotify }) {
  const [expandedTenantId, setExpandedTenantId] = useState(null);
  const [showCreateTenant, setShowCreateTenant] = useState(false);
  const [filterId, setFilterId] = useState("");
  const [filterName, setFilterName] = useState("");
  const [filterState, setFilterState] = useState("all");

  const [tenantForm, setTenantForm] = useState({
    tenant_name: "",
    max_licenses: 5,
    duration_months: 1,
    admin_name: "",
    admin_email: "",
    admin_password: "",
  });

  const [seatBlockTarget, setSeatBlockTarget] = useState(null);
  const [seatBlockForm, setSeatBlockForm] = useState({
    seat_count: 3,
    starts_at: "",
    ends_at: "",
    duration_months: 1,
    reason: "1-month seat block",
  });

  const filteredTenants = (tenants || []).filter((t) => {
    const cleanId = filterId.trim().replace(/^#/, "");
    if (cleanId && String(t.numeric_id) !== cleanId) return false;
    if (
      filterName.trim() &&
      !String(t.name || "").toLowerCase().includes(filterName.trim().toLowerCase())
    ) {
      return false;
    }
    const stateValue = t.effective_state || t.status || "active";
    if (filterState !== "all" && stateValue !== filterState) return false;
    return true;
  });

  async function handleCreateTenant(e) {
    e.preventDefault();
    if (!session?.access_token) return;

    const startsAt = new Date().toISOString();
    let endsAt = null;
    if (Number(tenantForm.duration_months) > 0) {
      const endDate = new Date(startsAt);
      endDate.setMonth(endDate.getMonth() + Number(tenantForm.duration_months));
      endsAt = endDate.toISOString();
    }

    const res = await safeJsonFetch("/api/admin/tenants", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        tenant_name: tenantForm.tenant_name,
        max_licenses: Number(tenantForm.max_licenses),
        license_starts_at: startsAt,
        license_ends_at: endsAt,
        reason: `Initial ${tenantForm.duration_months || "open"}-month seat block`,
        telephony_config: { provider: "smartcall" },
        admin_name: tenantForm.admin_name,
        admin_email: tenantForm.admin_email,
        admin_password: tenantForm.admin_password,
      }),
    });

    if (!res.ok) {
      onNotify(res.data.error || "Failed to create tenant.");
      return;
    }

    setTenantForm({
      tenant_name: "",
      max_licenses: 5,
      duration_months: 1,
      admin_name: "",
      admin_email: "",
      admin_password: "",
    });
    setShowCreateTenant(false);
    onNotify(`Created tenant "${res.data.tenant?.name || ""}".`);
    await onReload();
  }

  function openSeatBlockEditor(tenant) {
    setSeatBlockTarget(tenant);
    setSeatBlockForm({
      seat_count: 2,
      starts_at: "",
      ends_at: "",
      duration_months: 6,
      reason: "Additional seat block",
    });
  }

  async function handleAddSeatBlock(e) {
    e.preventDefault();
    if (!session?.access_token || !seatBlockTarget) return;

    const res = await safeJsonFetch("/api/admin/tenants", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        action: "add_block",
        tenant_id: seatBlockTarget.id,
        seat_count: Number(seatBlockForm.seat_count),
        starts_at: seatBlockForm.starts_at || undefined,
        ends_at: seatBlockForm.ends_at || undefined,
        duration_months: seatBlockForm.ends_at
          ? undefined
          : Number(seatBlockForm.duration_months) || 0,
        reason: seatBlockForm.reason,
      }),
    });

    if (!res.ok) {
      onNotify(res.data.error || "Failed to add seat block.");
      return;
    }

    onNotify(
      `Added ${seatBlockForm.seat_count} seat(s) to "${seatBlockTarget.name}". Active seats now: ${res.data.active_seats}.`
    );
    setSeatBlockTarget(null);
    await onReload();
  }

  async function handleEndSeatBlock(tenantId, periodId) {
    if (!session?.access_token) return;
    const res = await safeJsonFetch("/api/admin/tenants", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        action: "end_block",
        tenant_id: tenantId,
        period_id: periodId,
      }),
    });

    if (!res.ok) {
      onNotify(res.data.error || "Failed to end seat block.");
      return;
    }

    onNotify(`Seat block ended. Active seats now: ${res.data.active_seats}.`);
    await onReload();
  }

  async function handleToggleTenantState(tenant) {
    if (!session?.access_token) return;
    const nextState = tenant.effective_state === "disabled" ? "active" : "disabled";

    const res = await safeJsonFetch("/api/admin/tenants", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        action: "set_status",
        tenant_id: tenant.id,
        status: nextState,
      }),
    });

    if (!res.ok) {
      onNotify(res.data.error || "Failed to update tenant state.");
      return;
    }

    onNotify(`Tenant "${tenant.name}" (#${tenant.numeric_id}) is now ${nextState}.`);
    await onReload();
  }

  async function handleDeleteTenant(tenantId) {
    if (!session?.access_token) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm("Delete this tenant and its users permanently?")
    ) {
      return;
    }

    const res = await safeJsonFetch("/api/admin/tenants", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ tenant_id: tenantId }),
    });

    if (!res.ok) {
      onNotify(res.data.error || "Failed to delete tenant.");
      return;
    }

    onNotify("Tenant deleted.");
    await onReload();
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
          marginBottom: 16,
        }}
      >
        <h3 style={{ margin: 0 }}>
          Tenants & Licenses ({filteredTenants.length} of {(tenants || []).length})
        </h3>
        {profile?.role === "super_admin" && (
          <button
            type="button"
            onClick={() => setShowCreateTenant((prev) => !prev)}
            style={{ padding: "7px 12px", fontWeight: "bold", cursor: "pointer" }}
          >
            {showCreateTenant ? "Close Create Form" : "+ Create Tenant"}
          </button>
        )}
      </div>

      <div
        style={{
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "center",
          marginBottom: 16,
          padding: 10,
          background: "#f8fafc",
          border: "1px solid #cbd5e1",
          borderRadius: 6,
        }}
      >
        <input
          placeholder="Filter by ID (e.g. 1, 2)"
          value={filterId}
          onChange={(e) => setFilterId(e.target.value)}
          style={{ width: 150, padding: 6 }}
        />
        <input
          placeholder="Filter by tenant name..."
          value={filterName}
          onChange={(e) => setFilterName(e.target.value)}
          style={{ width: 220, padding: 6 }}
        />
        <select value={filterState} onChange={(e) => setFilterState(e.target.value)} style={{ padding: 6 }}>
          <option value="all">All States</option>
          <option value="active">Active</option>
          <option value="disabled">Disabled / Expired</option>
        </select>
        {(filterId || filterName || filterState !== "all") && (
          <button
            type="button"
            onClick={() => {
              setFilterId("");
              setFilterName("");
              setFilterState("all");
            }}
          >
            Clear Filters
          </button>
        )}
      </div>

      {profile?.role === "super_admin" && showCreateTenant && (
        <div style={{ marginBottom: 24, padding: 14, border: "1px solid #cbd5e1", borderRadius: 8 }}>
          <h4 style={{ marginTop: 0 }}>Create Customer Tenant & Initial Seat Block</h4>
          <form onSubmit={handleCreateTenant} style={{ display: "grid", gap: 8, maxWidth: 480 }}>
            <input
              placeholder="Company / Tenant Name"
              value={tenantForm.tenant_name}
              onChange={(e) => setTenantForm((f) => ({ ...f, tenant_name: e.target.value }))}
              required
            />
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="number"
                min="1"
                placeholder="Initial Seats (e.g. 3)"
                value={tenantForm.max_licenses}
                onChange={(e) => setTenantForm((f) => ({ ...f, max_licenses: e.target.value }))}
                required
                style={{ flex: 1 }}
              />
              <input
                type="number"
                min="0"
                placeholder="Duration Months (e.g. 1 or 6)"
                value={tenantForm.duration_months}
                onChange={(e) => setTenantForm((f) => ({ ...f, duration_months: e.target.value }))}
                style={{ flex: 1 }}
              />
            </div>
            <input
              placeholder="Tenant Admin Name"
              value={tenantForm.admin_name}
              onChange={(e) => setTenantForm((f) => ({ ...f, admin_name: e.target.value }))}
              required
            />
            <input
              type="email"
              placeholder="Tenant Admin Email"
              value={tenantForm.admin_email}
              onChange={(e) => setTenantForm((f) => ({ ...f, admin_email: e.target.value }))}
              required
            />
            <input
              type="password"
              placeholder="Temporary Password"
              value={tenantForm.admin_password}
              onChange={(e) => setTenantForm((f) => ({ ...f, admin_password: e.target.value }))}
              required
            />
            <button type="submit">Create Tenant & Admin</button>
          </form>
        </div>
      )}

      {seatBlockTarget && (
        <div
          style={{
            marginBottom: 24,
            padding: 14,
            border: "1px solid #334155",
            borderRadius: 8,
            background: "#f8fafc",
            maxWidth: 520,
          }}
        >
          <h4 style={{ marginTop: 0 }}>
            Add Time-Bound Seat Block — #{seatBlockTarget.numeric_id} {seatBlockTarget.name}
          </h4>
          <form onSubmit={handleAddSeatBlock} style={{ display: "grid", gap: 8 }}>
            <label style={{ fontSize: 12 }}>
              Additional Seats:
              <input
                type="number"
                min="1"
                value={seatBlockForm.seat_count}
                onChange={(e) => setSeatBlockForm((f) => ({ ...f, seat_count: e.target.value }))}
                required
                style={{ width: "100%", marginTop: 2 }}
              />
            </label>
            <label style={{ fontSize: 12 }}>
              Duration (Months, if End Date is left blank):
              <input
                type="number"
                min="0"
                value={seatBlockForm.duration_months}
                onChange={(e) => setSeatBlockForm((f) => ({ ...f, duration_months: e.target.value }))}
                style={{ width: "100%", marginTop: 2 }}
              />
            </label>
            <label style={{ fontSize: 12 }}>
              Custom Start Date/Time (optional):
              <input
                type="datetime-local"
                value={seatBlockForm.starts_at}
                onChange={(e) => setSeatBlockForm((f) => ({ ...f, starts_at: e.target.value }))}
                style={{ width: "100%", marginTop: 2 }}
              />
            </label>
            <label style={{ fontSize: 12 }}>
              Custom End Date/Time (optional):
              <input
                type="datetime-local"
                value={seatBlockForm.ends_at}
                onChange={(e) => setSeatBlockForm((f) => ({ ...f, ends_at: e.target.value }))}
                style={{ width: "100%", marginTop: 2 }}
              />
            </label>
            <label style={{ fontSize: 12 }}>
              Reason / Plan Note:
              <input
                value={seatBlockForm.reason}
                onChange={(e) => setSeatBlockForm((f) => ({ ...f, reason: e.target.value }))}
                style={{ width: "100%", marginTop: 2 }}
              />
            </label>
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <button type="submit">Save Seat Block</button>
              <button type="button" onClick={() => setSeatBlockTarget(null)}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <table border="1" cellPadding="8" style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th>ID</th>
            <th>Tenant</th>
            <th>State</th>
            <th>Active Users / Active Seats</th>
            <th>Available Seats</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {filteredTenants.map((t) => {
            const stateLabel = t.effective_state || t.status || "active";
            return (
              <Fragment key={t.id}>
                <tr>
                  <td>
                    <strong>#{t.numeric_id}</strong>
                  </td>
                  <td>
                    <div>
                      <strong>{t.name}</strong>
                    </div>
                    <code style={{ fontSize: 11, color: "#64748b" }}>{t.id}</code>
                  </td>
                  <td>
                    <strong>{stateLabel}</strong>
                    {t.license_expired && (
                      <div style={{ color: "#b91c1c", fontSize: 11 }}>
                        License finished / 0 active seats
                      </div>
                    )}
                    {t.over_capacity > 0 && (
                      <div style={{ color: "#b91c1c", fontSize: 11, fontWeight: "bold" }}>
                        Over seat limit by {t.over_capacity}
                      </div>
                    )}
                  </td>
                  <td>
                    {t.used_licenses} / {t.max_licenses}
                  </td>
                  <td>{t.remaining_licenses}</td>
                  <td>
                    <button
                      type="button"
                      onClick={() => openSeatBlockEditor(t)}
                      style={{ marginRight: 6 }}
                    >
                      + Add Seat Block
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleTenantState(t)}
                      style={{ marginRight: 6 }}
                    >
                      {stateLabel === "disabled" ? "Enable Tenant" : "Disable Tenant"}
                    </button>
                    {profile?.role === "super_admin" && (
                      <button
                        type="button"
                        onClick={() => handleDeleteTenant(t.id)}
                        style={{ marginRight: 6 }}
                      >
                        Delete
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setExpandedTenantId((cur) => (cur === t.id ? null : t.id))}
                    >
                      {expandedTenantId === t.id ? "Hide History" : "History"}
                    </button>
                  </td>
                </tr>
                {expandedTenantId === t.id && (
                  <tr>
                    <td colSpan="6" style={{ background: "#f8fafc" }}>
                      <strong>
                        License Blocks & History (ID #{t.numeric_id} — <code>{t.id}</code>)
                      </strong>
                      <table
                        border="1"
                        cellPadding="6"
                        style={{
                          width: "100%",
                          borderCollapse: "collapse",
                          marginTop: 8,
                          fontSize: 12,
                        }}
                      >
                        <thead>
                          <tr>
                            <th>Seats</th>
                            <th>License Label</th>
                            <th>Start Date</th>
                            <th>End Date</th>
                            <th>Changed By ID</th>
                            <th>Reason</th>
                            <th>Block Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(t.license_periods || []).map((lp) => (
                            <tr key={lp.id}>
                              <td>+{lp.seat_count}</td>
                              <td>
                                <LicensePeriodBadge period={lp} />
                              </td>
                              <td>{lp.starts_at ? new Date(lp.starts_at).toLocaleString() : "-"}</td>
                              <td>
                                {lp.ends_at ? new Date(lp.ends_at).toLocaleString() : "Open-ended"}
                              </td>
                              <td>
                                <code>{lp.changed_by || "-"}</code>{" "}
                                {lp.changed_by_name ? `(${lp.changed_by_name})` : ""}
                              </td>
                              <td>{lp.reason || "-"}</td>
                              <td>
                                {lp.is_active_now ? (
                                  <button
                                    type="button"
                                    onClick={() => handleEndSeatBlock(t.id, lp.id)}
                                  >
                                    End Now
                                  </button>
                                ) : (
                                  "-"
                                )}
                              </td>
                            </tr>
                          ))}
                          {(!t.license_periods || t.license_periods.length === 0) && (
                            <tr>
                              <td colSpan="7">No license blocks recorded yet.</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
          {filteredTenants.length === 0 && (
            <tr>
              <td colSpan="6">No tenants match your current filter.</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
