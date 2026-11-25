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

const STANDARD_LEAD_FIELDS = [
  { key: "full_name", label: "Full Name" },
  { key: "phone", label: "Phone Number (Required)" },
  { key: "email", label: "Email" },
  { key: "company", label: "Company" },
  { key: "city", label: "City" },
];

function parseCSV(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return { headers: [], rows: [] };

  const headers = lines[0].split(",").map((h) => h.replace(/^"|"$/g, "").trim());
  const rows = lines.slice(1).map((line) => {
    const cols = line.split(",").map((c) => c.replace(/^"|"$/g, "").trim());
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = cols[i] ?? "";
    });
    return obj;
  });
  return { headers, rows };
}

export default function HomePage() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [activeTab, setActiveTab] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Super Admin state
  const [tenants, setTenants] = useState([]);
  const [tenantName, setTenantName] = useState("");
  const [maxLicenses, setMaxLicenses] = useState(5);
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [telephonyProvider, setTelephonyProvider] = useState("smartcall");

  // Tenant Admin state
  const [licenseInfo, setLicenseInfo] = useState({ used_licenses: 0, available_licenses: 0, max_licenses: 0 });
  const [teamUsers, setTeamUsers] = useState([]);
  const [memberName, setMemberName] = useState("");
  const [memberEmail, setMemberEmail] = useState("");
  const [memberPassword, setMemberPassword] = useState("");
  const [memberRole, setMemberRole] = useState("agent");

  // Step 4: Campaigns, Field Mapping, Custom Fields & Leads
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectDesc, setNewProjectDesc] = useState("");

  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldType, setNewFieldType] = useState("text");
  const [newFieldOptions, setNewFieldOptions] = useState("");

  const [csvHeaders, setCsvHeaders] = useState([]);
  const [csvRows, setCsvRows] = useState([]);
  const [columnMapping, setColumnMapping] = useState({});
  const [assignToUserId, setAssignToUserId] = useState("");

  const [leads, setLeads] = useState([]);
  const [leadTotalCount, setLeadTotalCount] = useState(0);
  const [leadStatusFilter, setLeadStatusFilter] = useState("all");

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
        if (["tenant_admin", "supervisor", "team_leader"].includes(prof.role)) {
          await fetchTeamUsers(currentSession.access_token);
        }
        await fetchProjects(currentSession.access_token);
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

  async function fetchProjects(token) {
    const res = await fetch("/api/projects", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (res.ok) {
      const list = data.projects || [];
      setProjects(list);
      if (list.length > 0 && !selectedProjectId) {
        setSelectedProjectId(list[0].id);
        await fetchLeads(token, list[0].id, leadStatusFilter);
      } else if (selectedProjectId) {
        await fetchLeads(token, selectedProjectId, leadStatusFilter);
      }
    }
  }

  async function fetchLeads(token, projectId, status = "all") {
    if (!projectId) return;
    const params = new URLSearchParams({ project_id: projectId, status });
    const res = await fetch(`/api/leads?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (res.ok) {
      setLeads(data.leads || []);
      setLeadTotalCount(data.total_count || 0);
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
    if (!res.ok) return setMessage(data.error || "Failed to create tenant");
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
    if (!res.ok) return setMessage(data.error || "Failed to create user");
    setMessage(`Created ${data.user.role}: ${data.user.email}`);
    setMemberName("");
    setMemberEmail("");
    setMemberPassword("");
    await fetchTeamUsers(session.access_token);
  }

  async function handleCreateProject(e) {
    e.preventDefault();
    setMessage("");
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ name: newProjectName, description: newProjectDesc }),
    });
    const data = await res.json();
    if (!res.ok) return setMessage(data.error || "Failed to create campaign");
    setMessage(`Campaign "${data.project.name}" created.`);
    setNewProjectName("");
    setNewProjectDesc("");
    setSelectedProjectId(data.project.id);
    await fetchProjects(session.access_token);
  }

  async function handleCreateCustomField(e) {
    e.preventDefault();
    if (!selectedProjectId) return setMessage("Select a campaign first.");
    setMessage("");
    const optionsArr =
      newFieldType === "dropdown"
        ? newFieldOptions.split(",").map((o) => o.trim()).filter(Boolean)
        : [];

    const res = await fetch("/api/projects", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        action: "add_field",
        project_id: selectedProjectId,
        field_name: newFieldName,
        field_type: newFieldType,
        options: optionsArr,
        scope: "lead",
      }),
    });
    const data = await res.json();
    if (!res.ok) return setMessage(data.error || "Failed to create custom field");
    setMessage(`Custom field "${data.field.field_label}" added.`);
    setNewFieldName("");
    setNewFieldOptions("");
    await fetchProjects(session.access_token);
  }

  function handleCsvFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const { headers, rows } = parseCSV(String(evt.target?.result || ""));
      setCsvHeaders(headers);
      setCsvRows(rows);
      const autoMap = {};
      headers.forEach((h) => {
        const norm = h.toLowerCase();
        if (norm.includes("name")) autoMap[h] = "full_name";
        else if (norm.includes("phone") || norm.includes("mobile") || norm.includes("number")) autoMap[h] = "phone";
        else if (norm.includes("email")) autoMap[h] = "email";
        else if (norm.includes("company")) autoMap[h] = "company";
        else if (norm.includes("city")) autoMap[h] = "city";
        else autoMap[h] = "__ignore__";
      });
      setColumnMapping(autoMap);
    };
    reader.readAsText(file);
  }

  async function handleUploadLeads(e) {
    e.preventDefault();
    if (!selectedProjectId || csvRows.length === 0) return;
    setMessage("");
    const res = await fetch("/api/leads/upload", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        project_id: selectedProjectId,
        rows: csvRows,
        mapping: columnMapping,
        default_assigned_to: assignToUserId || null,
      }),
    });
    const data = await res.json();
    if (!res.ok) return setMessage(data.error || "Lead upload failed");
    setMessage(`Uploaded ${data.uploaded_count} leads (skipped ${data.skipped_count} without phone).`);
    setCsvHeaders([]);
    setCsvRows([]);
    setColumnMapping({});
    await fetchProjects(session.access_token);
    await fetchLeads(session.access_token, selectedProjectId, leadStatusFilter);
  }

  if (loading) return <div style={{ padding: 24 }}>Loading workspace...</div>;

  if (!session || !profile) {
    return (
      <div style={{ maxWidth: 400, margin: "60px auto", padding: 24, border: "1px solid #ddd", borderRadius: 8 }}>
        <h2>S2C Telecalling CRM — Login</h2>
        <form onSubmit={handleLogin} style={{ display: "grid", gap: 12 }}>
          <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <button type="submit">Sign In</button>
        </form>
        {message && <p style={{ color: "crimson", marginTop: 12 }}>{message}</p>}
      </div>
    );
  }

  const tabs = ROLE_ACCESS[profile.role] || [];
  const selectedProject = projects.find((p) => p.id === selectedProjectId) || null;
  const projectCustomFields = (selectedProject?.fields || []).filter((f) => f.scope === "lead");
  const canManageCampaigns = ["tenant_admin", "supervisor", "team_leader"].includes(profile.role);

  return (
    <div style={{ maxWidth: 1180, margin: "24px auto", padding: 16, fontFamily: "sans-serif" }}>
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
            style={{ padding: "8px 14px", fontWeight: activeTab === tab ? "bold" : "normal" }}
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

      {activeTab === "Campaigns & Leads" && (
        <div>
          {canManageCampaigns && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
              <div style={{ padding: 14, border: "1px solid #ddd", borderRadius: 8 }}>
                <h3 style={{ marginTop: 0 }}>Create Campaign / Project</h3>
                <form onSubmit={handleCreateProject} style={{ display: "grid", gap: 8 }}>
                  <input
                    placeholder="Campaign Name (e.g., Q4 Renewal Drive)"
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    required
                  />
                  <input
                    placeholder="Description (optional)"
                    value={newProjectDesc}
                    onChange={(e) => setNewProjectDesc(e.target.value)}
                  />
                  <button type="submit">Create Campaign</button>
                </form>
              </div>

              <div style={{ padding: 14, border: "1px solid #ddd", borderRadius: 8 }}>
                <h3 style={{ marginTop: 0 }}>Add Custom Lead Field (Selected Campaign)</h3>
                <form onSubmit={handleCreateCustomField} style={{ display: "grid", gap: 8 }}>
                  <input
                    placeholder="Field Name (e.g., Budget, Course, Loan Amount)"
                    value={newFieldName}
                    onChange={(e) => setNewFieldName(e.target.value)}
                    required
                  />
                  <select value={newFieldType} onChange={(e) => setNewFieldType(e.target.value)}>
                    <option value="text">Text</option>
                    <option value="number">Number</option>
                    <option value="dropdown">Dropdown</option>
                  </select>
                  {newFieldType === "dropdown" && (
                    <input
                      placeholder="Dropdown options (comma separated)"
                      value={newFieldOptions}
                      onChange={(e) => setNewFieldOptions(e.target.value)}
                      required
                    />
                  )}
                  <button type="submit" disabled={!selectedProjectId}>
                    + Add Custom Field
                  </button>
                </form>
              </div>
            </div>
          )}

          <h3>Campaigns & Lead Counts</h3>
          <table border="1" cellPadding="8" style={{ width: "100%", borderCollapse: "collapse", marginBottom: 24 }}>
            <thead>
              <tr>
                <th>Select</th>
                <th>Campaign / Project</th>
                <th>Total Leads</th>
                <th>New</th>
                <th>Follow-Up</th>
                <th>Connected</th>
                <th>Closed</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr
                  key={p.id}
                  style={{ background: p.id === selectedProjectId ? "#eef6ff" : "transparent" }}
                >
                  <td>
                    <button
                      onClick={() => {
                        setSelectedProjectId(p.id);
                        fetchLeads(session.access_token, p.id, leadStatusFilter);
                      }}
                    >
                      {p.id === selectedProjectId ? "Selected" : "Open"}
                    </button>
                  </td>
                  <td><strong>{p.name}</strong></td>
                  <td><strong>{p.lead_counts?.total ?? 0}</strong></td>
                  <td>{p.lead_counts?.new ?? 0}</td>
                  <td>{p.lead_counts?.follow_up ?? 0}</td>
                  <td>{p.lead_counts?.connected ?? 0}</td>
                  <td>{p.lead_counts?.closed ?? 0}</td>
                </tr>
              ))}
              {projects.length === 0 && (
                <tr>
                  <td colSpan="7">No campaigns yet. Create your first campaign above.</td>
                </tr>
              )}
            </tbody>
          </table>

          {canManageCampaigns && selectedProject && (
            <div style={{ padding: 14, border: "1px solid #ddd", borderRadius: 8, marginBottom: 24 }}>
              <h3 style={{ marginTop: 0 }}>Upload CSV Leads to: {selectedProject.name}</h3>
              <input type="file" accept=".csv" onChange={handleCsvFileChange} />

              {csvHeaders.length > 0 && (
                <form onSubmit={handleUploadLeads} style={{ marginTop: 14 }}>
                  <p>
                    <strong>Detected {csvRows.length} rows.</strong> Map each CSV column to a standard or custom CRM field:
                  </p>
                  <table border="1" cellPadding="6" style={{ width: "100%", borderCollapse: "collapse", marginBottom: 12 }}>
                    <thead>
                      <tr>
                        <th>CSV Column</th>
                        <th>Sample Value</th>
                        <th>Map to CRM Field</th>
                      </tr>
                    </thead>
                    <tbody>
                      {csvHeaders.map((h) => (
                        <tr key={h}>
                          <td>{h}</td>
                          <td>{csvRows[0]?.[h] || "-"}</td>
                          <td>
                            <select
                              value={columnMapping[h] || "__ignore__"}
                              onChange={(e) => setColumnMapping({ ...columnMapping, [h]: e.target.value })}
                            >
                              <option value="__ignore__">-- Ignore Column --</option>
                              <optgroup label="Standard Lead Fields">
                                {STANDARD_LEAD_FIELDS.map((sf) => (
                                  <option key={sf.key} value={sf.key}>{sf.label}</option>
                                ))}
                              </optgroup>
                              {projectCustomFields.length > 0 && (
                                <optgroup label="Custom Project Fields">
                                  {projectCustomFields.map((cf) => (
                                    <option key={cf.field_key} value={cf.field_key}>
                                      {cf.field_label} ({cf.field_type})
                                    </option>
                                  ))}
                                </optgroup>
                              )}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                    <label>
                      Assign all uploaded leads to:{" "}
                      <select value={assignToUserId} onChange={(e) => setAssignToUserId(e.target.value)}>
                        <option value="">-- Unassigned --</option>
                        {teamUsers.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.full_name} ({u.role})
                          </option>
                        ))}
                      </select>
                    </label>
                    <button type="submit">Import {csvRows.length} Leads</button>
                  </div>
                </form>
              )}
            </div>
          )}

          {selectedProject && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <h3 style={{ margin: 0 }}>
                  Leads in {selectedProject.name} (Showing {leads.length} of {leadTotalCount})
                </h3>
                <select
                  value={leadStatusFilter}
                  onChange={(e) => {
                    setLeadStatusFilter(e.target.value);
                    fetchLeads(session.access_token, selectedProjectId, e.target.value);
                  }}
                >
                  <option value="all">All Statuses</option>
                  <option value="new">New</option>
                  <option value="follow_up">Follow-Up</option>
                  <option value="connected">Connected</option>
                  <option value="closed">Closed</option>
                </select>
              </div>

              <table border="1" cellPadding="8" style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Phone</th>
                    <th>Company / City</th>
                    <th>Status</th>
                    <th>Custom Fields</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((lead) => (
                    <tr key={lead.id}>
                      <td>{lead.full_name}</td>
                      <td>{lead.phone}</td>
                      <td>{[lead.company, lead.city].filter(Boolean).join(" / ") || "-"}</td>
                      <td><code>{lead.status}</code></td>
                      <td>
                        {lead.custom_data && Object.keys(lead.custom_data).length > 0
                          ? Object.entries(lead.custom_data)
                              .map(([k, v]) => `${k}: ${v}`)
                              .join(" | ")
                          : "-"}
                      </td>
                    </tr>
                  ))}
                  {leads.length === 0 && (
                    <tr>
                      <td colSpan="5">No leads found in this campaign.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab && !["Tenants & Licenses", "Team & Licenses", "Campaigns & Leads"].includes(activeTab) && (
        <div style={{ padding: 16, border: "1px dashed #aaa", borderRadius: 6 }}>
          <strong>{activeTab}</strong> — Ready for our next build step.
        </div>
      )}
    </div>
  );
}
