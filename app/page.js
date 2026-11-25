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
  { key: "notes", label: "Notes" },
];

function parseCsvText(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return { headers: [], rows: [] };

  function splitLine(line) {
    const out = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === "," && !inQuotes) {
        out.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur.trim());
    return out;
  }

  const headers = splitLine(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const cols = splitLine(line);
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

  // Tenant Admin / Team state
  const [licenseInfo, setLicenseInfo] = useState({
    used_licenses: 0,
    available_licenses: 0,
    max_licenses: 0,
  });
  const [teamUsers, setTeamUsers] = useState([]);
  const [memberName, setMemberName] = useState("");
  const [memberEmail, setMemberEmail] = useState("");
  const [memberPassword, setMemberPassword] = useState("");
  const [memberRole, setMemberRole] = useState("agent");

  // Campaigns & Leads state
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

  // Step 5: Calling, Dispositions, Custom Call Fields & Follow-Ups
  const [dispositions, setDispositions] = useState([]);
  const [callFields, setCallFields] = useState([]);
  const [callLogs, setCallLogs] = useState([]);
  const [activeLeadId, setActiveLeadId] = useState("");
  const [activeCallId, setActiveCallId] = useState(null);
  const [callStatus, setCallStatus] = useState("idle"); // idle | dialing | connected | on_hold | ended
  const [isMuted, setIsMuted] = useState(false);
  const [callSeconds, setCallSeconds] = useState(0);
  const [selectedDispositionId, setSelectedDispositionId] = useState("");
  const [followUpAt, setFollowUpAt] = useState("");
  const [callNotes, setCallNotes] = useState("");
  const [customCallValues, setCustomCallValues] = useState({});
  const [savingCall, setSavingCall] = useState(false);

  // Quick config creators (Disposition + Custom Call Field)
  const [newDispLabel, setNewDispLabel] = useState("");
  const [newDispFollowup, setNewDispFollowup] = useState(false);
  const [newCallFieldLabel, setNewCallFieldLabel] = useState("");
  const [newCallFieldType, setNewCallFieldType] = useState("text");
  const [newCallFieldOptions, setNewCallFieldOptions] = useState("");

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
        await fetchCallConfigAndLogs(currentSession.access_token, prof.tenant_id);
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
      const rows = data.leads || [];
      setLeads(rows);
      setLeadTotalCount(data.total_count || rows.length);
      if (rows.length > 0 && !rows.some((r) => r.id === activeLeadId)) {
        setActiveLeadId(rows[0].id);
      }
    }
  }

  function getTenantHeader(explicitTenantId) {
    const tid = explicitTenantId || profile?.tenant_id || "";
    return tid ? { "x-tenant-id": tid } : {};
  }

  async function fetchCallConfigAndLogs(token, explicitTenantId) {
    const tid = explicitTenantId || profile?.tenant_id;
    if (!token || !tid) return;
    const headers = {
      Authorization: `Bearer ${token}`,
      ...getTenantHeader(tid),
    };
    const [cfgRes, logsRes] = await Promise.all([
      fetch(`/api/call-config?tenant_id=${encodeURIComponent(tid)}`, { headers }),
      fetch(`/api/calls?tenant_id=${encodeURIComponent(tid)}`, { headers }),
    ]);
    const cfgData = await cfgRes.json();
    const logsData = await logsRes.json();

    if (cfgRes.ok) {
      const list = cfgData.dispositions || [];
      setDispositions(list);
      setCallFields(cfgData.callFields || []);
      if (list.length > 0 && !selectedDispositionId) {
        setSelectedDispositionId(list[0].id);
      }
    }
    if (logsRes.ok) {
      setCallLogs(logsData.calls || []);
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

  useEffect(() => {
    if (!["dialing", "connected"].includes(callStatus)) return;
    const timer = setInterval(() => {
      setCallSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [callStatus]);

  useEffect(() => {
    if (leads.length > 0 && !activeLeadId) {
      setActiveLeadId(leads[0].id);
    }
  }, [leads, activeLeadId]);

  useEffect(() => {
    if (session?.access_token && profile?.tenant_id) {
      fetchCallConfigAndLogs(session.access_token, profile.tenant_id);
    }
  }, [session?.access_token, profile?.tenant_id]);

  function formatTimer(sec) {
    const mins = String(Math.floor(sec / 60)).padStart(2, "0");
    const rem = String(sec % 60).padStart(2, "0");
    return `${mins}:${rem}`;
  }

  function loadLeadIntoDialer(lead) {
    if (!lead) return;
    setActiveLeadId(lead.id);
    setCallStatus("idle");
    setIsMuted(false);
    setCallSeconds(0);
    setActiveCallId(null);
    setCallNotes(lead.notes || "");
    setFollowUpAt(lead.follow_up_at ? String(lead.follow_up_at).slice(0, 16) : "");
    const existingCustom =
      lead.custom_fields && typeof lead.custom_fields === "object"
        ? lead.custom_fields
        : lead.custom_data && typeof lead.custom_data === "object"
        ? lead.custom_data
        : {};
    setCustomCallValues(existingCustom);
  }

  async function handleStartCall(lead) {
    if (!lead || !session?.access_token) return;
    setMessage("");
    setActiveLeadId(lead.id);
    setCallSeconds(0);
    setIsMuted(false);
    setCallStatus("connected");

    if (lead.phone && typeof window !== "undefined") {
      const cleanPhone = String(lead.phone).replace(/[^+\d]/g, "");
      if (cleanPhone) {
        window.open(`tel:${cleanPhone}`, "_self");
      }
    }

    const tid = lead.tenant_id || profile?.tenant_id;
    const res = await fetch("/api/calls", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
        ...getTenantHeader(tid),
      },
      body: JSON.stringify({
        action: "start",
        tenant_id: tid,
        lead_id: lead.id,
        project_id: lead.project_id || selectedProjectId || null,
        phone: lead.phone,
        call_mode: "browser_tel",
      }),
    });
    const data = await res.json();
    if (res.ok && data.call) {
      setActiveCallId(data.call.id);
    } else if (!res.ok) {
      setMessage(data.error || "Could not log call start");
    }
  }

  function handleHangupCall() {
    setCallStatus("ended");
    setIsMuted(false);
  }

  function handleNextLead(currentLeadId) {
    if (leads.length === 0) return;
    const idx = leads.findIndex((l) => l.id === currentLeadId);
    const nextLead = leads[(idx + 1) % leads.length];
    loadLeadIntoDialer(nextLead);
  }

  async function handleSaveAndNextCall(e, currentLead) {
    e.preventDefault();
    if (!currentLead || !session?.access_token) return;
    setSavingCall(true);
    setMessage("");

    const dispObj = dispositions.find((d) => d.id === selectedDispositionId) || null;
    const tid = currentLead.tenant_id || profile?.tenant_id;

    const res = await fetch("/api/calls", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
        ...getTenantHeader(tid),
      },
      body: JSON.stringify({
        action: "complete",
        tenant_id: tid,
        call_id: activeCallId,
        lead_id: currentLead.id,
        project_id: currentLead.project_id || selectedProjectId || null,
        phone: currentLead.phone,
        call_mode: "browser_tel",
        duration_seconds: callSeconds,
        disposition_id: dispObj?.id || null,
        disposition_label: dispObj?.label || null,
        follow_up_at: followUpAt || null,
        notes: callNotes,
        custom_values: customCallValues,
      }),
    });
    const data = await res.json();
    setSavingCall(false);

    if (!res.ok) {
      setMessage(data.error || "Failed to save call disposition");
      return;
    }

    setMessage(
      `Saved call for ${currentLead.full_name || currentLead.phone} (${dispObj?.label || "Logged"}).`
    );
    await fetchLeads(session.access_token, selectedProjectId, leadStatusFilter);
    await fetchCallConfigAndLogs(session.access_token, tid);
    handleNextLead(currentLead.id);
  }

  async function handleCreateDisposition(e) {
    e.preventDefault();
    if (!newDispLabel.trim() || !session?.access_token) return;
    const tid = profile?.tenant_id;
    const res = await fetch("/api/call-config", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
        ...getTenantHeader(tid),
      },
      body: JSON.stringify({
        type: "disposition",
        tenant_id: tid,
        label: newDispLabel.trim(),
        requires_followup: newDispFollowup,
        is_connected: true,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      setNewDispLabel("");
      setNewDispFollowup(false);
      await fetchCallConfigAndLogs(session.access_token, tid);
      if (data.disposition?.id) setSelectedDispositionId(data.disposition.id);
    } else {
      setMessage(data.error || "Could not add disposition");
    }
  }

  async function handleCreateCallField(e) {
    e.preventDefault();
    if (!newCallFieldLabel.trim() || !session?.access_token) return;
    const tid = profile?.tenant_id;
    const res = await fetch("/api/call-config", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
        ...getTenantHeader(tid),
      },
      body: JSON.stringify({
        type: "field",
        tenant_id: tid,
        label: newCallFieldLabel.trim(),
        field_type: newCallFieldType,
        options: newCallFieldOptions,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      setNewCallFieldLabel("");
      setNewCallFieldOptions("");
      await fetchCallConfigAndLogs(session.access_token, tid);
    } else {
      setMessage(data.error || "Could not add custom call field");
    }
  }

  async function handleLogin(e) {
    e.preventDefault();
    setMessage("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setMessage(error.message);
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    setProfile(null);
    setActiveTab("");
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
        telephony_provider: telephonyProvider,
        admin_name: adminName,
        admin_email: adminEmail,
        admin_password: adminPassword,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error || "Failed to create tenant");
      return;
    }
    setMessage(`Tenant "${data.tenant.name}" created with admin ${data.admin.email}`);
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
      setMessage(data.error || "Failed to add user");
      return;
    }
    setMessage(`Added ${data.user.full_name} (${data.user.role})`);
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
      body: JSON.stringify({
        name: newProjectName,
        description: newProjectDesc,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error || "Failed to create campaign");
      return;
    }
    setMessage(`Campaign "${data.project.name}" created`);
    setNewProjectName("");
    setNewProjectDesc("");
    setSelectedProjectId(data.project.id);
    await fetchProjects(session.access_token);
    await fetchLeads(session.access_token, data.project.id, leadStatusFilter);
  }

  async function handleAddCustomField(e) {
    e.preventDefault();
    if (!selectedProjectId) return;
    setMessage("");
    const res = await fetch(`/api/projects/${selectedProjectId}/fields`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        field_name: newFieldName,
        field_type: newFieldType,
        options:
          newFieldType === "dropdown"
            ? newFieldOptions
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : [],
        scope: "lead",
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error || "Failed to add field");
      return;
    }
    setMessage(`Added field "${data.field.field_label}"`);
    setNewFieldName("");
    setNewFieldOptions("");
    await fetchProjects(session.access_token);
  }

  function handleCsvFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const parsed = parseCsvText(evt.target?.result || "");
      setCsvHeaders(parsed.headers);
      setCsvRows(parsed.rows);
      const autoMap = {};
      parsed.headers.forEach((h) => {
        const norm = h.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (norm.includes("name")) autoMap[h] = "full_name";
        else if (norm.includes("phone") || norm.includes("mobile")) autoMap[h] = "phone";
        else if (norm.includes("email")) autoMap[h] = "email";
        else if (norm.includes("company")) autoMap[h] = "company";
        else if (norm.includes("city")) autoMap[h] = "city";
        else autoMap[h] = "ignore";
      });
      setColumnMapping(autoMap);
    };
    reader.readAsText(file);
  }

  async function handleUploadMappedLeads(e) {
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
        column_mapping: columnMapping,
        assigned_to: assignToUserId || null,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error || "Upload failed");
      return;
    }
    setMessage(`Uploaded ${data.uploaded_count} leads (skipped ${data.skipped_count} without phone).`);
    setCsvHeaders([]);
    setCsvRows([]);
    setColumnMapping({});
    await fetchLeads(session.access_token, selectedProjectId, leadStatusFilter);
  }

  if (loading) {
    return <div style={{ padding: 24, fontFamily: "sans-serif" }}>Loading...</div>;
  }

  if (!session || !profile) {
    return (
      <div
        style={{
          maxWidth: 400,
          margin: "60px auto",
          padding: 24,
          border: "1px solid #ddd",
          borderRadius: 8,
          fontFamily: "sans-serif",
        }}
      >
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
  const selectedProject = projects.find((p) => p.id === selectedProjectId) || null;
  const projectCustomFields = (selectedProject?.fields || []).filter((f) => f.scope === "lead");
  const canManageCampaigns = ["tenant_admin", "supervisor", "team_leader"].includes(profile.role);

  const activeLead = leads.find((l) => l.id === activeLeadId) || leads[0] || null;
  const followUpLeads = leads.filter(
    (l) => Boolean(l.follow_up_at) || l.status === "follow_up"
  );

  return (
    <div style={{ maxWidth: 1180, margin: "24px auto", padding: 16, fontFamily: "sans-serif" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
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

      {message && (
        <p style={{ padding: 10, background: "#f4f6f8", borderRadius: 6 }}>{message}</p>
      )}

      {activeLead && (
        <div
          style={{
            border: "1px solid #cbd5e1",
            background: "#f8fafc",
            borderRadius: 8,
            padding: 12,
            marginBottom: 18,
          }}
        >
          {/* One-Line Icon Dialer Console */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span title="Active Lead">👤</span>
              <select
                value={activeLead.id}
                onChange={(e) => {
                  const found = leads.find((item) => item.id === e.target.value);
                  if (found) loadLeadIntoDialer(found);
                }}
                style={{ padding: "6px 8px", minWidth: 200 }}
              >
                {leads.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.full_name || "Lead"} ({l.phone})
                  </option>
                ))}
              </select>
              <strong>{activeLead.phone}</strong>
              <code>{callStatus}</code>
              <strong title="Call Duration">⏱ {formatTimer(callSeconds)}</strong>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button
                type="button"
                title="Dial Lead"
                onClick={() => handleStartCall(activeLead)}
                style={{ padding: "6px 12px", cursor: "pointer" }}
              >
                📞 Call
              </button>
              <button
                type="button"
                title={isMuted ? "Unmute Mic" : "Mute Mic"}
                onClick={() => setIsMuted((m) => !m)}
                style={{ padding: "6px 10px", cursor: "pointer" }}
              >
                {isMuted ? "🔇 Muted" : "🎙️ Mute"}
              </button>
              <button
                type="button"
                title={callStatus === "on_hold" ? "Resume Call" : "Hold Call"}
                onClick={() =>
                  setCallStatus((s) => (s === "on_hold" ? "connected" : "on_hold"))
                }
                style={{ padding: "6px 10px", cursor: "pointer" }}
              >
                {callStatus === "on_hold" ? "▶️ Resume" : "⏸️ Hold"}
              </button>
              <button
                type="button"
                title="Hangup Call"
                onClick={handleHangupCall}
                style={{ padding: "6px 10px", cursor: "pointer" }}
              >
                ☎️ Hangup
              </button>
              <button
                type="button"
                title="Next Lead"
                onClick={() => handleNextLead(activeLead.id)}
                style={{ padding: "6px 10px", cursor: "pointer" }}
              >
                ⏭️ Next
              </button>
            </div>
          </div>

          {/* Disposition + Dynamic Custom Call Capture Fields (Text, Dropdown, Number) */}
          <form
            onSubmit={(e) => handleSaveAndNextCall(e, activeLead)}
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
              gap: 10,
              marginTop: 12,
              paddingTop: 12,
              borderTop: "1px solid #e2e8f0",
            }}
          >
            <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
              <span>Disposition</span>
              <select
                value={selectedDispositionId}
                onChange={(e) => setSelectedDispositionId(e.target.value)}
                style={{ padding: 6 }}
              >
                <option value="">-- Select Disposition --</option>
                {dispositions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>

            {callFields.map((field) => {
              const val = customCallValues[field.field_key] ?? "";
              return (
                <label key={field.id} style={{ display: "grid", gap: 4, fontSize: 13 }}>
                  <span>{field.label}</span>
                  {field.field_type === "select" ? (
                    <select
                      value={val}
                      onChange={(e) =>
                        setCustomCallValues((prev) => ({
                          ...prev,
                          [field.field_key]: e.target.value,
                        }))
                      }
                      style={{ padding: 6 }}
                    >
                      <option value="">-- Select --</option>
                      {(Array.isArray(field.options) ? field.options : []).map((opt) => (
                        <option key={String(opt)} value={String(opt)}>
                          {String(opt)}
                        </option>
                      ))}
                    </select>
                  ) : field.field_type === "number" ? (
                    <input
                      type="number"
                      value={val}
                      onChange={(e) =>
                        setCustomCallValues((prev) => ({
                          ...prev,
                          [field.field_key]: e.target.value,
                        }))
                      }
                      style={{ padding: 6 }}
                    />
                  ) : (
                    <input
                      type="text"
                      value={val}
                      onChange={(e) =>
                        setCustomCallValues((prev) => ({
                          ...prev,
                          [field.field_key]: e.target.value,
                        }))
                      }
                      style={{ padding: 6 }}
                    />
                  )}
                </label>
              );
            })}

            <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
              <span>Follow-Up Date & Time</span>
              <input
                type="datetime-local"
                value={followUpAt}
                onChange={(e) => setFollowUpAt(e.target.value)}
                style={{ padding: 6 }}
              />
            </label>

            <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
              <span>Call Notes</span>
              <input
                type="text"
                placeholder="Quick summary..."
                value={callNotes}
                onChange={(e) => setCallNotes(e.target.value)}
                style={{ padding: 6 }}
              />
            </label>

            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <button
                type="submit"
                disabled={savingCall}
                style={{ padding: "8px 14px", width: "100%", fontWeight: "bold", cursor: "pointer" }}
              >
                {savingCall ? "Saving..." : "Save Call & Next"}
              </button>
            </div>
          </form>

          {/* Add Disposition or Custom Call Capture Field */}
          {canManageCampaigns && (
            <div
              style={{
                display: "flex",
                gap: 16,
                flexWrap: "wrap",
                marginTop: 12,
                paddingTop: 10,
                borderTop: "1px dashed #cbd5e1",
                fontSize: 12,
              }}
            >
              <form
                onSubmit={handleCreateDisposition}
                style={{ display: "flex", gap: 6, alignItems: "center" }}
              >
                <input
                  type="text"
                  placeholder="New Disposition label"
                  value={newDispLabel}
                  onChange={(e) => setNewDispLabel(e.target.value)}
                  style={{ padding: 5 }}
                />
                <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <input
                    type="checkbox"
                    checked={newDispFollowup}
                    onChange={(e) => setNewDispFollowup(e.target.checked)}
                  />
                  Follow-up
                </label>
                <button type="submit" style={{ padding: "5px 10px" }}>
                  + Disposition
                </button>
              </form>

              <form
                onSubmit={handleCreateCallField}
                style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}
              >
                <input
                  type="text"
                  placeholder="New Call Field label"
                  value={newCallFieldLabel}
                  onChange={(e) => setNewCallFieldLabel(e.target.value)}
                  style={{ padding: 5 }}
                />
                <select
                  value={newCallFieldType}
                  onChange={(e) => setNewCallFieldType(e.target.value)}
                  style={{ padding: 5 }}
                >
                  <option value="text">Text</option>
                  <option value="select">Dropdown</option>
                  <option value="number">Number</option>
                </select>
                {newCallFieldType === "select" && (
                  <input
                    type="text"
                    placeholder="Options (comma separated)"
                    value={newCallFieldOptions}
                    onChange={(e) => setNewCallFieldOptions(e.target.value)}
                    style={{ padding: 5 }}
                  />
                )}
                <button type="submit" style={{ padding: "5px 10px" }}>
                  + Call Field
                </button>
              </form>
            </div>
          )}
        </div>
      )}

      {activeTab === "Tenants & Licenses" && profile.role === "super_admin" && (
        <div>
          <h3>Create Tenant & Tenant Admin</h3>
          <form
            onSubmit={handleCreateTenant}
            style={{ display: "grid", gap: 10, maxWidth: 480, marginBottom: 24 }}
          >
            <input
              placeholder="Tenant / Company Name"
              value={tenantName}
              onChange={(e) => setTenantName(e.target.value)}
              required
            />
            <input
              type="number"
              min="1"
              placeholder="License Count"
              value={maxLicenses}
              onChange={(e) => setMaxLicenses(e.target.value)}
              required
            />
            <input
              placeholder="Telephony Provider (e.g. smartcall)"
              value={telephonyProvider}
              onChange={(e) => setTelephonyProvider(e.target.value)}
            />
            <input
              placeholder="Tenant Admin Full Name"
              value={adminName}
              onChange={(e) => setAdminName(e.target.value)}
              required
            />
            <input
              type="email"
              placeholder="Tenant Admin Email"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              required
            />
            <input
              type="password"
              placeholder="Tenant Admin Password"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              required
            />
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
                  <td>
                    {t.used_licenses} / {t.max_licenses}
                  </td>
                  <td>{t.available_licenses}</td>
                  <td>{t.telephony_provider}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "Team & Licenses" && profile.role === "tenant_admin" && (
        <div>
          <p>
            <strong>License Usage:</strong> {licenseInfo.used_licenses} / {licenseInfo.max_licenses}{" "}
            used ({licenseInfo.available_licenses} remaining)
          </p>

          <h3>Add Team Member</h3>
          <form
            onSubmit={handleCreateTeamUser}
            style={{ display: "grid", gap: 10, maxWidth: 460, marginBottom: 24 }}
          >
            <input
              placeholder="Full Name"
              value={memberName}
              onChange={(e) => setMemberName(e.target.value)}
              required
            />
            <input
              type="email"
              placeholder="Email"
              value={memberEmail}
              onChange={(e) => setMemberEmail(e.target.value)}
              required
            />
            <input
              type="password"
              placeholder="Temporary Password"
              value={memberPassword}
              onChange={(e) => setMemberPassword(e.target.value)}
              required
            />
            <select value={memberRole} onChange={(e) => setMemberRole(e.target.value)}>
              <option value="agent">Agent</option>
              <option value="team_leader">Team Leader</option>
              <option value="supervisor">Supervisor</option>
            </select>
            <button type="submit" disabled={licenseInfo.available_licenses <= 0}>
              Add Team Member
            </button>
          </form>

          <h3>Team Users</h3>
          <table border="1" cellPadding="8" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {teamUsers.map((u) => (
                <tr key={u.id}>
                  <td>{u.full_name}</td>
                  <td>{u.email}</td>
                  <td>{u.role}</td>
                  <td>{u.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "Campaigns & Leads" && (
        <div>
          {canManageCampaigns && (
            <div style={{ marginBottom: 24 }}>
              <h3>Create Campaign</h3>
              <form
                onSubmit={handleCreateProject}
                style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
              >
                <input
                  placeholder="Campaign Name"
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
          )}

          <div style={{ marginBottom: 20 }}>
            <label>
              <strong>Select Campaign: </strong>
              <select
                value={selectedProjectId}
                onChange={(e) => {
                  const pid = e.target.value;
                  setSelectedProjectId(pid);
                  fetchLeads(session.access_token, pid, leadStatusFilter);
                }}
              >
                <option value="">-- Select Campaign --</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.lead_count ?? 0} leads)
                  </option>
                ))}
              </select>
            </label>
          </div>

          {selectedProject && (
            <div>
              <h3>
                {selectedProject.name} — Leads ({leadTotalCount})
              </h3>

              {canManageCampaigns && (
                <div
                  style={{
                    border: "1px solid #e2e2e2",
                    padding: 14,
                    borderRadius: 6,
                    marginBottom: 20,
                  }}
                >
                  <h4>Add Custom Lead Field</h4>
                  <form
                    onSubmit={handleAddCustomField}
                    style={{
                      display: "flex",
                      gap: 8,
                      flexWrap: "wrap",
                      marginBottom: 16,
                    }}
                  >
                    <input
                      placeholder="Field Label (e.g. Product Interest)"
                      value={newFieldName}
                      onChange={(e) => setNewFieldName(e.target.value)}
                      required
                    />
                    <select
                      value={newFieldType}
                      onChange={(e) => setNewFieldType(e.target.value)}
                    >
                      <option value="text">Text</option>
                      <option value="number">Number</option>
                      <option value="dropdown">Dropdown</option>
                    </select>
                    {newFieldType === "dropdown" && (
                      <input
                        placeholder="Options comma-separated (e.g. Hot,Warm,Cold)"
                        value={newFieldOptions}
                        onChange={(e) => setNewFieldOptions(e.target.value)}
                      />
                    )}
                    <button type="submit">Add Field</button>
                  </form>

                  <h4>Upload Leads CSV</h4>
                  <input type="file" accept=".csv,text/csv" onChange={handleCsvFileChange} />

                  {csvHeaders.length > 0 && (
                    <form onSubmit={handleUploadMappedLeads} style={{ marginTop: 12 }}>
                      <p>
                        <strong>Map CSV Columns ({csvRows.length} rows detected):</strong>
                      </p>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                          gap: 8,
                          marginBottom: 12,
                        }}
                      >
                        {csvHeaders.map((header) => (
                          <div
                            key={header}
                            style={{ border: "1px solid #ddd", padding: 8, borderRadius: 4 }}
                          >
                            <div style={{ fontSize: 12, marginBottom: 4 }}>
                              CSV: <strong>{header}</strong>
                            </div>
                            <select
                              value={columnMapping[header] || "ignore"}
                              onChange={(e) =>
                                setColumnMapping((prev) => ({
                                  ...prev,
                                  [header]: e.target.value,
                                }))
                              }
                              style={{ width: "100%" }}
                            >
                              <option value="ignore">-- Ignore --</option>
                              {STANDARD_LEAD_FIELDS.map((f) => (
                                <option key={f.key} value={f.key}>
                                  {f.label}
                                </option>
                              ))}
                              {projectCustomFields.map((cf) => (
                                <option key={cf.field_key} value={`custom:${cf.field_key}`}>
                                  Custom: {cf.field_label}
                                </option>
                              ))}
                            </select>
                          </div>
                        ))}
                      </div>

                      <div
                        style={{
                          display: "flex",
                          gap: 10,
                          alignItems: "center",
                          flexWrap: "wrap",
                        }}
                      >
                        <label>
                          Assign to Agent:{" "}
                          <select
                            value={assignToUserId}
                            onChange={(e) => setAssignToUserId(e.target.value)}
                          >
                            <option value="">Unassigned</option>
                            {teamUsers
                              .filter((u) => u.role === "agent")
                              .map((ag) => (
                                <option key={ag.id} value={ag.id}>
                                  {ag.full_name}
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

              <div style={{ marginBottom: 10 }}>
                <label>
                  Filter Status:{" "}
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
                </label>
              </div>

              <table border="1" cellPadding="8" style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Phone</th>
                    <th>Company / City</th>
                    <th>Status</th>
                    <th>Custom Fields</th>
                    <th>Dial</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((lead) => {
                    const mergedCustom = {
                      ...(lead.custom_data && typeof lead.custom_data === "object"
                        ? lead.custom_data
                        : {}),
                      ...(lead.custom_fields && typeof lead.custom_fields === "object"
                        ? lead.custom_fields
                        : {}),
                    };
                    return (
                      <tr key={lead.id}>
                        <td>{lead.full_name}</td>
                        <td>{lead.phone}</td>
                        <td>{[lead.company, lead.city].filter(Boolean).join(" / ") || "-"}</td>
                        <td>
                          <code>{lead.status}</code>
                          {lead.disposition ? ` (${lead.disposition})` : ""}
                        </td>
                        <td>
                          {Object.keys(mergedCustom).length > 0
                            ? Object.entries(mergedCustom)
                                .map(([k, v]) => `${k}: ${v}`)
                                .join(" | ")
                            : "-"}
                        </td>
                        <td>
                          <button
                            type="button"
                            onClick={() => {
                              loadLeadIntoDialer(lead);
                              handleStartCall(lead);
                            }}
                          >
                            📞 Call
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {leads.length === 0 && (
                    <tr>
                      <td colSpan="6">No leads found in this campaign.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === "Follow-Ups" && (
        <div>
          <h3>Follow-Up Queue ({followUpLeads.length})</h3>
          <table border="1" cellPadding="8" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th>Lead</th>
                <th>Phone</th>
                <th>Disposition</th>
                <th>Follow-Up Time</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {followUpLeads.map((item) => {
                const isDue = item.follow_up_at && new Date(item.follow_up_at) <= new Date();
                return (
                  <tr key={item.id}>
                    <td>{item.full_name || "Lead"}</td>
                    <td>{item.phone}</td>
                    <td>{item.disposition || item.status}</td>
                    <td>
                      {item.follow_up_at ? new Date(item.follow_up_at).toLocaleString() : "-"}{" "}
                      {isDue && <strong>[DUE]</strong>}
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => {
                          loadLeadIntoDialer(item);
                          handleStartCall(item);
                        }}
                      >
                        📞 Call Now
                      </button>
                    </td>
                  </tr>
                );
              })}
              {followUpLeads.length === 0 && (
                <tr>
                  <td colSpan="5">No scheduled follow-ups yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeTab &&
        !["Tenants & Licenses", "Team & Licenses", "Campaigns & Leads", "Follow-Ups"].includes(
          activeTab
        ) && (
          <div style={{ padding: 16, border: "1px dashed #aaa", borderRadius: 6 }}>
            <strong>{activeTab}</strong> — {callLogs.length} calls logged in current tenant.
          </div>
        )}
    </div>
  );
}
