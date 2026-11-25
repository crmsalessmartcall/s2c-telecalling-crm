"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

const ROLE_ACCESS = {
  super_admin: ["Tenants & Licenses", "Campaigns & Leads", "Follow-Ups", "Reports"],
  tenant_admin: ["Team & Licenses", "Campaigns & Leads", "Follow-Ups", "Reports"],
  supervisor: ["Campaigns & Leads", "Follow-Ups", "Reports"],
  team_leader: ["Campaigns & Leads", "Follow-Ups", "Reports"],
  agent: ["Campaigns & Leads", "Follow-Ups"],
};

export default function HomePage() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [activeTab, setActiveTab] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [tenants, setTenants] = useState([]);
  const [tenantName, setTenantName] = useState("");
  const [maxLicenses, setMaxLicenses] = useState(5);
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [telephonyProvider, setTelephonyProvider] = useState("smartcall");

  const [licenseInfo, setLicenseInfo] = useState({ used_licenses: 0, available_licenses: 0, max_licenses: 0 });
  const [teamUsers, setTeamUsers] = useState([]);
  const [memberName, setMemberName] = useState("");
  const [memberEmail, setMemberEmail] = useState("");
  const [memberPassword, setMemberPassword] = useState("");
  const [memberRole, setMemberRole] = useState("agent");

  async function loadUserContext(currentSession) {
    if (!currentSession?.user) {
      setProfile(null);
      setLoading(false);
      return;
    }

    const { data: prof } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", currentSession.user.id)
      .single();

    setProfile(prof || null);
    if (prof?.role) {
      const allowedTabs = ROLE_ACCESS[prof.role] || ["Campaigns & Leads"];
      setActiveTab((prev) => (allowedTabs.includes(prev) ? prev : allowedTabs[0]));
      if (prof.role === "super_admin") {
        await fetchTenants(currentSession.access_token);
      } else if (prof.tenant_id) {
        await fetchTeamUsers(currentSession.access_token);
      }
    }
    setLoading(false);
  }

  async function fetchTenants(token) {
    const res = await fetch("/api/admin/tenants", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (res.ok) setTenants(data.tenants || []);
  }

  async function fetchTeamUsers(token) {
    const res = await fetch("/api/tenant/users", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (res.ok) {
      setTeamUsers(data.users || []);
      setLicenseInfo({
        used_licenses: data.used_licenses,
        available_licenses: data.available_licenses,
        max_licenses: data.tenant?.max_licenses || 0,
      });
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      loadUserContext(data.session);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      loadUserContext(newSession);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  async function handleLogin(e) {
    e.preventDefault();
    setMessage("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setMessage(error.message);
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    setProfile(null);
    setMessage("");
  }

  async function handleCreateTenant(e) {
    e.preventDefault();
    setMessage("");
    const res = await fetch("/api/admin/tenants", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        tenant_name: tenantName,
        max_licenses: Number(maxLicenses),
        admin_name: adminName,
        admin_email: adminEmail,
        admin_password: adminPassword,
        telephony_config: { provider: telephonyProvider },
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error || "Failed to create tenant");
      return;
    }
    setMessage(`Tenant "${data.tenant.name}" and Admin "${data.admin.email}" created.`);
    setTenantName("");
    setAdminName("");
    setAdminEmail("");
    setAdminPassword("");
    await fetchTenants(session.access_token);
  }

  async function handleCreateTeamUser(e) {
    e.preventDefault();
    setMessage("");
    const res = await fetch("/api/tenant/users", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        full_name: memberName,
        email: memberEmail,
        password: memberPassword,
        role: memberRole,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error || "Failed to create user");
      return;
    }
    setMessage(`Created ${data.user.role}: ${data.user.email}`);
    setMemberName("");
    setMemberEmail("");
    setMemberPassword("");
    await fetchTeamUsers(session.access_token);
  }

  if (loading) return <div style={{ padding: 24 }}>Loading workspace...</div>;

  if (!session || !profile) {
    return (
      <div style={{ maxWidth: 400, margin: "60px auto", padding: 24, border: "1px solid #ddd", borderRadius: 8 }}>
        <h2>S2C Telecalling CRM — Login</h2>
        <form onSubmit={handleLogin} style={{ display: "grid", gap: 12 }}>
          <input
            type="email"
            placeholder="Email"
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
        {message && <p style={{ color: "crimson", marginTop: 12 }}>{message}</p>}
      </div>
    );
  }

  const tabs = ROLE_ACCESS[profile.role] || [];

  return (
    <div style={{ maxWidth: 1100, margin: "24px auto", padding: 16, fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <strong>{profile.full_name}</strong> — Role: <code>{profile.role}</code>
        </div>
        <button onClick={handleLogout}>Logout</button>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: "8px 14px",
              fontWeight: activeTab === tab ? "bold" : "normal",
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {message && <p style={{ padding: 10, background: "#f4f6f8", borderRadius: 6 }}>{message}</p>}

      {activeTab === "Tenants & Licenses" && profile.role === "super_admin" && (
        <div>
          <h3>Create Tenant & Tenant Admin</h3>
          <form onSubmit={handleCreateTenant} style={{ display: "grid", gap: 10, maxWidth: 480, marginBottom: 24 }}>
            <input placeholder="Tenant / Company Name" value={tenantName} onChange={(e) => setTenantName(e.target.value)} required />
            <input type="number" min="1" placeholder="License Count" value={maxLicenses} onChange={(e) => setMaxLicenses(e.target.value)} required />
            <input placeholder="Telephony Provider (e.g. smartcall)" value={telephonyProvider} onChange={(e) => setTelephonyProvider(e.target.value)} />
            <input placeholder="Tenant Admin Full Name" value={adminName} onChange={(e) => setAdminName(e.target.value)} required />
            <input type="email" placeholder="Tenant Admin Email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} required />
            <input type="password" placeholder="Tenant Admin Password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} required />
            <button type="submit">Create Tenant & Admin</button>
          </form>

          <h3>All Tenants</h3>
          <table border="1" cellPadding="8" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th>Tenant</th>
                <th>Status</th>
                <th>Used / Total Licenses</th>
                <th>Remaining</th>
                <th>Telephony</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td>{t.status}</td>
                  <td>{t.used_licenses} / {t.max_licenses}</td>
                  <td>{t.remaining_licenses}</td>
                  <td>{t.telephony_config?.provider || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "Team & Licenses" && profile.role === "tenant_admin" && (
        <div>
          <p>
            <strong>Licenses:</strong> Used {licenseInfo.used_licenses} / {licenseInfo.max_licenses} |{" "}
            <strong>Available:</strong> {licenseInfo.available_licenses}
          </p>

          <h3>Create Team User (Supervisor / Team Leader / Agent)</h3>
          <form onSubmit={handleCreateTeamUser} style={{ display: "grid", gap: 10, maxWidth: 420, marginBottom: 24 }}>
            <input placeholder="Full Name" value={memberName} onChange={(e) => setMemberName(e.target.value)} required />
            <input type="email" placeholder="User Email" value={memberEmail} onChange={(e) => setMemberEmail(e.target.value)} required />
            <input type="password" placeholder="Password" value={memberPassword} onChange={(e) => setMemberPassword(e.target.value)} required />
            <select value={memberRole} onChange={(e) => setMemberRole(e.target.value)}>
              <option value="supervisor">Supervisor</option>
              <option value="team_leader">Team Leader</option>
              <option value="agent">Agent</option>
            </select>
            <button type="submit" disabled={licenseInfo.available_licenses <= 0}>
              {licenseInfo.available_licenses > 0 ? "Create User" : "No Licenses Available"}
            </button>
          </form>

          <h3>Team Members</h3>
          <table border="1" cellPadding="8" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Active</th>
              </tr>
            </thead>
            <tbody>
              {teamUsers.map((u) => (
                <tr key={u.id}>
                  <td>{u.full_name}</td>
                  <td>{u.email}</td>
                  <td>{u.role}</td>
                  <td>{u.is_active ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab && !["Tenants & Licenses", "Team & Licenses"].includes(activeTab) && (
        <div style={{ padding: 16, border: "1px dashed #aaa", borderRadius: 6 }}>
          <strong>{activeTab}</strong> — Ready for our next build step.
        </div>
      )}
    </div>
  );
}
