"use client";

import { Fragment, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import PortalHeader from "@/app/components/PortalHeader";

const ROLE_ACCESS = {
  super_admin: ["Tenants & Licenses", "Campaigns & Leads", "Dialer", "Follow-Ups", "Reports"],
  platform_ops: ["Tenants & Licenses", "Reports"],
  tenant_admin: ["Team & Licenses", "Campaigns & Leads", "Dialer", "Follow-Ups", "Reports"],
  supervisor: ["Campaigns & Leads", "Dialer", "Follow-Ups", "Reports"],
  team_leader: ["Campaigns & Leads", "Dialer", "Follow-Ups", "Reports"],
  agent: ["Dialer", "Campaigns & Leads", "Follow-Ups"],
};

async function safeJsonFetch(url, options = {}) {
  const res = await fetch(url, options);
  const raw = await res.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { error: res.ok ? "Invalid server response" : `Request failed (${res.status}) for ${url}` };
  }
  return { ok: res.ok, status: res.status, data };
}

export default function HomePage() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");

  const [activeTab, setActiveTab] = useState("");
  const [statusMessage, setStatusMessage] = useState("");

  // Tenants & License Blocks state
  const [tenants, setTenants] = useState([]);
  const [expandedTenantId, setExpandedTenantId] = useState(null);
  const [showCreateTenant, setShowCreateTenant] = useState(false);

  // Filters: Tenant ID (1, 2, 3...), Name, and State (all | active | disabled)
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

  // Add Seat Block panel state for Super Admin / Platform Ops
  const [seatBlockTarget, setSeatBlockTarget] = useState(null);
  const [seatBlockForm, setSeatBlockForm] = useState({
    seat_count: 3,
    starts_at: "",
    ends_at: "",
    duration_months: 1,
    reason: "1-month seat block",
  });

  // Tenant Admin Team & Licenses state
  const [teamUsers, setTeamUsers] = useState([]);
  const [licenseInfo, setLicenseInfo] = useState({ used: 0, max: 0, remaining: 0, overCapacity: 0 });
  const [newUserForm, setNewUserForm] = useState({
    full_name: "",
    email: "",
    password: "",
    role: "agent",
  });

  // Placeholder state for upcoming points (Points 4-5)
  const [projects, setProjects] = useState([]);

  const allowedTabs = profile?.role ? ROLE_ACCESS[profile.role] || ["Dialer"] : [];

  async function loadRoleData(currentSession, currentProfile) {
    if (!currentSession?.access_token || !currentProfile?.role) return;
    const token = currentSession.access_token;
    const role = currentProfile.role;

    const tabs = ROLE_ACCESS[role] || ["Dialer"];
    setActiveTab((prev) => (tabs.includes(prev) ? prev : tabs[0]));

    if (["super_admin", "platform_ops"].includes(role)) {
      const tRes = await safeJsonFetch("/api/admin/tenants", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (tRes.ok) {
        setTenants(tRes.data.tenants || []);
      } else {
        setStatusMessage(tRes.data.error || "Could not load tenants.");
      }
    }

    if (["tenant_admin", "supervisor", "team_leader"].includes(role) && currentProfile.tenant_id) {
      const uRes = await safeJsonFetch("/api/tenant/users", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (uRes.ok) {
        const activeSeats = uRes.data.active_seats ?? uRes.data.tenant?.max_licenses ?? 0;
        const used = uRes.data.used_licenses ?? 0;
        setTeamUsers(uRes.data.users || []);
        setLicenseInfo({
          used,
          max: activeSeats,
          remaining: Math.max(0, activeSeats - used),
          overCapacity: Math.max(0, used - activeSeats),
        });
      }
    }

    if (role !== "platform_ops") {
      const pRes = await safeJsonFetch("/api/projects", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (pRes.ok) {
        setProjects(pRes.data.projects || []);
      }
    }
  }

  async function hydrateSession() {
    setLoading(true);
    setStatusMessage("");
    try {
      const { data } = await supabase.auth.getSession();
      const currentSession = data?.session || null;

      if (!currentSession?.user) {
        setSession(null);
        setProfile(null);
        return;
      }

      const { data: prof, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", currentSession.user.id)
        .maybeSingle();

      if (error || !prof) {
        setSession(null);
        setProfile(null);
        setStatusMessage(error?.message || "Profile not found for authenticated user.");
        return;
      }

      const seatCheck = await safeJsonFetch("/api/auth/check-seat", {
        headers: { Authorization: `Bearer ${currentSession.access_token}` },
      });

      if (!seatCheck.ok || seatCheck.data?.allowed === false) {
        await supabase.auth.signOut();
        setSession(null);
        setProfile(null);
        setAuthError(
          seatCheck.data?.error ||
            "Login blocked: no active seat license available for this account."
        );
        return;
      }

      setSession(currentSession);
      setProfile(prof);
      await loadRoleData(currentSession, prof);
    } catch (err) {
      setStatusMessage(err?.message || "Failed to load session");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    hydrateSession();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!nextSession?.user) {
        setSession(null);
        setProfile(null);
        setActiveTab("");
        setLoading(false);
      }
    });

    return () => {
      listener?.subscription?.unsubscribe();
    };
  }, []);

  async function handleLogin(e) {
    e.preventDefault();
    setAuthError("");
    setStatusMessage("");

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      setAuthError(error.message);
      return;
    }

    await hydrateSession();
  }

  async function handleCreateTenant(e) {
    e.preventDefault();
    if (!session?.access_token) return;
    setStatusMessage("");

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
      setStatusMessage(res.data.error || "Failed to create tenant.");
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
    setStatusMessage(`Created tenant "${res.data.tenant?.name || ""}".`);
    await loadRoleData(session, profile);
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
    setStatusMessage("");

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
        duration_months: seatBlockForm.ends_at ? undefined : Number(seatBlockForm.duration_months) || 0,
        reason: seatBlockForm.reason,
      }),
    });

    if (!res.ok) {
      setStatusMessage(res.data.error || "Failed to add seat block.");
      return;
    }

    setStatusMessage(
      `Added ${seatBlockForm.seat_count} seat(s) to "${seatBlockTarget.name}". Active seats now: ${res.data.active_seats} (Changed by: ${profile?.id}).`
    );
    setSeatBlockTarget(null);
    await loadRoleData(session, profile);
  }

  async function handleEndSeatBlock(tenantId, periodId) {
    if (!session?.access_token) return;
    setStatusMessage("");

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
      setStatusMessage(res.data.error || "Failed to end seat block.");
      return;
    }

    setStatusMessage(
      `Seat block ended. Active seats now: ${res.data.active_seats} (Tenant state: ${res.data.status}).`
    );
    await loadRoleData(session, profile);
  }

  async function handleToggleTenantState(tenant) {
    if (!session?.access_token) return;
    const nextState = tenant.effective_state === "disabled" ? "active" : "disabled";
    setStatusMessage("");

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
      setStatusMessage(res.data.error || "Failed to update tenant state.");
      return;
    }

    setStatusMessage(`Tenant "${tenant.name}" (#${tenant.numeric_id}) is now ${nextState}.`);
    await loadRoleData(session, profile);
  }

  async function handleDeleteTenant(tenantId) {
    if (!session?.access_token) return;
    if (typeof window !== "undefined" && !window.confirm("Delete this tenant and its users permanently?")) {
      return;
    }

    setStatusMessage("");
    const res = await safeJsonFetch("/api/admin/tenants", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ tenant_id: tenantId }),
    });

    if (!res.ok) {
      setStatusMessage(res.data.error || "Failed to delete tenant.");
      return;
    }

    setStatusMessage("Tenant deleted.");
    await loadRoleData(session, profile);
  }

  async function handleAddTeamUser(e) {
    e.preventDefault();
    if (!session?.access_token) return;
    setStatusMessage("");

    const res = await safeJsonFetch("/api/tenant/users", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(newUserForm),
    });

    if (!res.ok) {
      setStatusMessage(res.data.error || "Failed to add user.");
      return;
    }

    setNewUserForm({ full_name: "", email: "", password: "", role: "agent" });
    setStatusMessage(`Added user "${res.data.user?.full_name || res.data.user?.email}".`);
    await loadRoleData(session, profile);
  }

  async function handleToggleUserActive(user) {
    if (!session?.access_token) return;
    setStatusMessage("");

    const res = await safeJsonFetch("/api/tenant/users", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        user_id: user.id,
        is_active: !user.is_active,
      }),
    });

    if (!res.ok) {
      setStatusMessage(res.data.error || "Failed to update user status.");
      return;
    }

    setStatusMessage(
      `${user.email} is now ${!user.is_active ? "ACTIVE (using 1 seat)" : "DISABLED (seat freed for others)"}.`
    );
    await loadRoleData(session, profile);
  }

  async function handleDeleteTeamUser(user) {
    if (!session?.access_token) return;
    if (typeof window !== "undefined" && !window.confirm(`Delete user ${user.email} and free the seat?`)) {
      return;
    }
    setStatusMessage("");

    const res = await safeJsonFetch("/api/tenant/users", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ user_id: user.id }),
    });

    if (!res.ok) {
      setStatusMessage(res.data.error || "Failed to delete user.");
      return;
    }

    setStatusMessage(`Deleted ${user.email} and freed seat.`);
    await loadRoleData(session, profile);
  }

  const filteredTenants = tenants.filter((t) => {
    const cleanId = filterId.trim().replace(/^#/, "");
    if (cleanId && String(t.numeric_id) !== cleanId) return false;
    if (filterName.trim() && !String(t.name || "").toLowerCase().includes(filterName.trim().toLowerCase())) {
      return false;
    }
    const stateValue = t.effective_state || t.status || "active";
    if (filterState !== "all" && stateValue !== filterState) return false;
    return true;
  });

  if (loading) {
    return <div style={{ padding: 24, fontFamily: "sans-serif" }}>Loading workspace...</div>;
  }

  if (!session || !profile) {
    return (
      <div
        style={{
          maxWidth: 400,
          margin: "64px auto",
          padding: 24,
          border: "1px solid #cbd5e1",
          borderRadius: 8,
          fontFamily: "sans-serif",
        }}
      >
        <h2 style={{ marginTop: 0 }}>S2C Telecalling CRM</h2>
        <form onSubmit={handleLogin} style={{ display: "grid", gap: 12 }}>
          <input
            type="email"
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button type="submit">Sign In</button>
        </form>
        {authError && <p style={{ color: "#b91c1c", marginTop: 12 }}>{authError}</p>}
        {statusMessage && <p style={{ color: "#b91c1c", marginTop: 12 }}>{statusMessage}</p>}
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1180, margin: "24px auto", padding: 16, fontFamily: "sans-serif" }}>
      <PortalHeader
        profile={profile}
        tabs={allowedTabs}
        activeTab={activeTab}
        onSelectTab={(tab) => {
          setStatusMessage("");
          setActiveTab(tab);
        }}
        onSignedOut={() => {
          setSession(null);
          setProfile(null);
          setActiveTab("");
        }}
      />

      {statusMessage && (
        <div
          style={{
            padding: 10,
            marginBottom: 16,
            borderRadius: 6,
            background: "#f1f5f9",
            border: "1px solid #cbd5e1",
          }}
        >
          {statusMessage}
        </div>
      )}

      {activeTab === "Tenants & Licenses" &&
        ["super_admin", "platform_ops"].includes(profile.role) && (
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
                Tenants & Licenses ({filteredTenants.length} of {tenants.length})
              </h3>
              {profile.role === "super_admin" && (
                <button
                  type="button"
                  onClick={() => setShowCreateTenant((prev) => !prev)}
                  style={{ padding: "7px 12px", fontWeight: "bold", cursor: "pointer" }}
                >
                  {showCreateTenant ? "Close Create Form" : "+ Create Tenant"}
                </button>
              )}
            </div>

            {/* Filter Controls: Tenant ID (1, 2, 3...), Tenant Name, State */}
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
              <select
                value={filterState}
                onChange={(e) => setFilterState(e.target.value)}
                style={{ padding: 6 }}
              >
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

            {profile.role === "super_admin" && showCreateTenant && (
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
                <p style={{ fontSize: 12, color: "#475569", marginTop: 0 }}>
                  Stacks with existing active blocks (e.g., +3 seats for 1 month and +2 seats for 6 months = 5 active seats).
                </p>
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
                    Custom End Date/Time (optional—overrides duration months):
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
                      placeholder="e.g. 1-month pack (3 users) or 6-month pack (2 users)"
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
                          {profile.role === "super_admin" && (
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
                              style={{ width: "100%", borderCollapse: "collapse", marginTop: 8, fontSize: 12 }}
                            >
                              <thead>
                                <tr>
                                  <th>Seats</th>
                                  <th>Period Status</th>
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
                                    <td>{lp.is_active_now ? "Active Now" : "Ended / Scheduled"}</td>
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
        )}

      {activeTab === "Team & Licenses" && profile.role === "tenant_admin" && (
        <section>
          <h3>
            Team & Licenses — {licenseInfo.used} / {licenseInfo.max} active seats used (
            {licenseInfo.remaining} available)
          </h3>

          {licenseInfo.overCapacity > 0 && (
            <div
              style={{
                padding: 10,
                marginBottom: 14,
                borderRadius: 6,
                background: "#fef2f2",
                border: "1px solid #fecaca",
                color: "#991b1b",
                fontSize: 13,
              }}
            >
              Active seats are exceeded by <strong>{licenseInfo.overCapacity}</strong> user(s). Disable or
              delete users below so remaining active team members can continue working, or request more seats.
            </div>
          )}

          <div style={{ marginBottom: 20, padding: 14, border: "1px solid #cbd5e1", borderRadius: 8 }}>
            <h4 style={{ marginTop: 0 }}>Add Team Member</h4>
            <form onSubmit={handleAddTeamUser} style={{ display: "grid", gap: 8, maxWidth: 460 }}>
              <input
                placeholder="Full Name"
                value={newUserForm.full_name}
                onChange={(e) => setNewUserForm((f) => ({ ...f, full_name: e.target.value }))}
                required
              />
              <input
                type="email"
                placeholder="Work Email"
                value={newUserForm.email}
                onChange={(e) => setNewUserForm((f) => ({ ...f, email: e.target.value }))}
                required
              />
              <input
                type="password"
                placeholder="Temporary Password"
                value={newUserForm.password}
                onChange={(e) => setNewUserForm((f) => ({ ...f, password: e.target.value }))}
                required
              />
              <select
                value={newUserForm.role}
                onChange={(e) => setNewUserForm((f) => ({ ...f, role: e.target.value }))}
              >
                <option value="agent">Agent</option>
                <option value="team_leader">Team Leader</option>
                <option value="supervisor">Supervisor</option>
              </select>
              <button type="submit" disabled={licenseInfo.remaining <= 0}>
                {licenseInfo.remaining > 0 ? "Add User (Uses 1 Seat)" : "No Seats Available"}
              </button>
            </form>
          </div>

          <table border="1" cellPadding="8" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Seat Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {teamUsers.map((u) => (
                <tr key={u.id}>
                  <td>{u.full_name}</td>
                  <td>{u.email}</td>
                  <td><code>{u.role}</code></td>
                  <td>{u.is_active ? "Active (1 seat)" : "Disabled (seat free)"}</td>
                  <td>
                    {u.id !== profile.id && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleToggleUserActive(u)}
                          style={{ marginRight: 6 }}
                        >
                          {u.is_active ? "Disable User" : "Enable User"}
                        </button>
                        <button type="button" onClick={() => handleDeleteTeamUser(u)}>
                          Delete User
                        </button>
                      </>
                    )}
                    {u.id === profile.id && <span>Current Admin</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {activeTab === "Campaigns & Leads" && (
        <section>
          <h3>Campaigns & Leads ({projects.length} campaigns)</h3>
          <p style={{ color: "#475569", fontSize: 13 }}>
            Dedicated campaign and lead view (coming in Point 4).
          </p>
        </section>
      )}

      {activeTab === "Dialer" && (
        <section>
          <h3>Dialer Console</h3>
          <p style={{ color: "#475569", fontSize: 13 }}>
            Shown only on the Dialer tab—never across all tabs (coming in Point 5).
          </p>
        </section>
      )}

      {activeTab === "Follow-Ups" && (
        <section>
          <h3>Follow-Ups</h3>
          <p style={{ color: "#475569", fontSize: 13 }}>Scheduled callbacks and reminders view.</p>
        </section>
      )}

      {activeTab === "Reports" && (
        <section>
          <h3>Reports</h3>
          <p style={{ color: "#475569", fontSize: 13 }}>Call activity and performance reporting view.</p>
        </section>
      )}
    </div>
  );
}
