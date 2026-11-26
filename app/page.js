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

  // Point 2: Tenants & License Periods state
  const [tenants, setTenants] = useState([]);
  const [expandedTenantId, setExpandedTenantId] = useState(null);
  const [tenantForm, setTenantForm] = useState({
    tenant_name: "",
    max_licenses: 10,
    admin_name: "",
    admin_email: "",
    admin_password: "",
  });

  // Placeholder state for upcoming points (Points 3-5)
  const [teamUsers, setTeamUsers] = useState([]);
  const [licenseInfo, setLicenseInfo] = useState({ used: 0, max: 0 });
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
        setTeamUsers(uRes.data.users || []);
        setLicenseInfo({
          used: uRes.data.used_licenses ?? 0,
          max: uRes.data.tenant?.max_licenses ?? 0,
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
      setSession(currentSession);

      if (!currentSession?.user) {
        setProfile(null);
        return;
      }

      const { data: prof, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", currentSession.user.id)
        .maybeSingle();

      if (error || !prof) {
        setProfile(null);
        setStatusMessage(error?.message || "Profile not found for authenticated user.");
        return;
      }

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
      setSession(nextSession || null);
      if (!nextSession?.user) {
        setProfile(null);
        setActiveTab("");
        setLoading(false);
      } else {
        hydrateSession();
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

    const res = await safeJsonFetch("/api/admin/tenants", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        tenant_name: tenantForm.tenant_name,
        max_licenses: Number(tenantForm.max_licenses),
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
      max_licenses: 10,
      admin_name: "",
      admin_email: "",
      admin_password: "",
    });
    setStatusMessage(`Created tenant "${res.data.tenant?.name || ""}" (ID: ${res.data.tenant?.id || ""}).`);
    await loadRoleData(session, profile);
  }

  async function handleEditSeats(tenant) {
    if (!session?.access_token) return;
    const nextSeats = window.prompt(
      `Seat count for ${tenant.name} (Tenant ID: ${tenant.id}):`,
      String(tenant.max_licenses ?? 0)
    );
    if (nextSeats === null) return;

    const startsAt = window.prompt("Start date/time (blank = now, e.g. 2026-12-01):", "") || "";
    const endsAt = window.prompt("End date/time (blank = open-ended, e.g. 2026-12-31):", "") || "";
    const reason = window.prompt("Reason / note:", "Seat license update") || "";

    setStatusMessage("");
    const res = await safeJsonFetch("/api/admin/tenants", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        tenant_id: tenant.id,
        max_licenses: Number(nextSeats),
        starts_at: startsAt || undefined,
        ends_at: endsAt || undefined,
        reason,
      }),
    });

    if (!res.ok) {
      setStatusMessage(res.data.error || "Failed to update seats.");
      return;
    }

    setStatusMessage(`Updated "${tenant.name}" to ${nextSeats} seats (Changed by: ${profile?.id}).`);
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
            {profile.role === "super_admin" && (
              <div style={{ marginBottom: 24, padding: 14, border: "1px solid #cbd5e1", borderRadius: 8 }}>
                <h3 style={{ marginTop: 0 }}>Create Customer Tenant</h3>
                <form onSubmit={handleCreateTenant} style={{ display: "grid", gap: 8, maxWidth: 480 }}>
                  <input
                    placeholder="Company / Tenant Name"
                    value={tenantForm.tenant_name}
                    onChange={(e) => setTenantForm((f) => ({ ...f, tenant_name: e.target.value }))}
                    required
                  />
                  <input
                    type="number"
                    min="1"
                    placeholder="Seat Licenses (e.g. 5, 10, 50)"
                    value={tenantForm.max_licenses}
                    onChange={(e) => setTenantForm((f) => ({ ...f, max_licenses: e.target.value }))}
                    required
                  />
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

            <h3>Tenants & Licenses ({tenants.length})</h3>
            <table border="1" cellPadding="8" style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th>Tenant & Unique ID</th>
                  <th>Status</th>
                  <th>Used / Seats</th>
                  <th>Available</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {tenants.map((t) => (
                  <Fragment key={t.id}>
                    <tr>
                      <td>
                        <div>
                          <strong>{t.name}</strong>
                        </div>
                        <code style={{ fontSize: 11 }}>{t.id}</code>
                      </td>
                      <td>{t.status}</td>
                      <td>
                        {t.used_licenses} / {t.max_licenses}
                      </td>
                      <td>{t.remaining_licenses}</td>
                      <td>
                        <button type="button" onClick={() => handleEditSeats(t)} style={{ marginRight: 6 }}>
                          Edit Seats
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
                        <td colSpan="5" style={{ background: "#f8fafc" }}>
                          <strong>
                            License Periods History (Tenant ID: <code>{t.id}</code>)
                          </strong>
                          <table
                            border="1"
                            cellPadding="6"
                            style={{ width: "100%", borderCollapse: "collapse", marginTop: 8, fontSize: 12 }}
                          >
                            <thead>
                              <tr>
                                <th>Seats</th>
                                <th>Start Date</th>
                                <th>End Date</th>
                                <th>Changed By ID</th>
                                <th>Reason</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(t.license_periods || []).map((lp) => (
                                <tr key={lp.id}>
                                  <td>{lp.seat_count}</td>
                                  <td>{lp.starts_at ? new Date(lp.starts_at).toLocaleString() : "-"}</td>
                                  <td>
                                    {lp.ends_at ? new Date(lp.ends_at).toLocaleString() : "Active / Open"}
                                  </td>
                                  <td>
                                    <code>{lp.changed_by || "-"}</code>{" "}
                                    {lp.changed_by_name ? `(${lp.changed_by_name})` : ""}
                                  </td>
                                  <td>{lp.reason || "-"}</td>
                                </tr>
                              ))}
                              {(!t.license_periods || t.license_periods.length === 0) && (
                                <tr>
                                  <td colSpan="5">No license periods recorded yet.</td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                {tenants.length === 0 && (
                  <tr>
                    <td colSpan="5">No tenants created yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        )}

      {activeTab === "Team & Licenses" && profile.role === "tenant_admin" && (
        <section>
          <h3>
            Team & Licenses — {licenseInfo.used} / {licenseInfo.max} seats used ({teamUsers.length} users)
          </h3>
          <p style={{ color: "#475569", fontSize: 13 }}>
            Dedicated team user and seat-release view (coming in Point 3).
          </p>
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
