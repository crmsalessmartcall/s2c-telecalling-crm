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

  // Tenant Admin Team & Licenses state
  const [teamUsers, setTeamUsers] = useState([]);
  const [tenantLicenseHistory, setTenantLicenseHistory] = useState([]);
  const [showAddUserForm, setShowAddUserForm] = useState(false);
  const [resetPasswordUserId, setResetPasswordUserId] = useState(null);
  const [resetPasswordValue, setResetPasswordValue] = useState("");
  const [licenseInfo, setLicenseInfo] = useState({ used: 0, max: 0, remaining: 0, overCapacity: 0 });
  const [newUserForm, setNewUserForm] = useState({
    full_name: "",
    email: "",
    password: "",
    role: "agent",
  });

  // Campaigns, Call Config, Leads & Follow-Ups state
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedTenantScope, setSelectedTenantScope] = useState("");
  const [projectForm, setProjectForm] = useState({ name: "", description: "" });

  const [callFields, setCallFields] = useState([]);
  const [dispositions, setDispositions] = useState([]);
  const [fieldForm, setFieldForm] = useState({ label: "", field_type: "text" });
  const [dispositionForm, setDispositionForm] = useState({ name: "", requires_followup: false });

  const [leads, setLeads] = useState([]);
  const [leadSearch, setLeadSearch] = useState("");
  const [leadForm, setLeadForm] = useState({
    name: "",
    phone: "",
    email: "",
    notes: "",
    follow_up_at: "",
  });
  const [csvText, setCsvText] = useState(
    "name,phone,email,city\nRahul Sharma,9876543210,rahul@example.com,Mumbai"
  );

  // Point 5: Dialer & Reports state
  const [callLogs, setCallLogs] = useState([]);
  const [dialerState, setDialerState] = useState({
    lead_id: "",
    phone: "",
    status: "connected",
    disposition: "",
    notes: "",
    duration_seconds: 45,
    follow_up_at: "",
    custom_fields: {},
    activeCallStartedAt: null,
  });
  const [reportData, setReportData] = useState({
    summary: {
      total_calls: 0,
      connected_calls: 0,
      avg_duration_seconds: 0,
      total_leads: 0,
      scheduled_followups: 0,
    },
    dispositions: {},
    lead_statuses: {},
    recent_calls: [],
  });

  const allowedTabs = profile?.role ? ROLE_ACCESS[profile.role] || ["Dialer"] : [];

  async function loadCampaignAndLeadsData(token, currentProfile, projectId = "", tenantScope = "") {
    const params = new URLSearchParams();
    if (projectId) params.set("project_id", projectId);
    if (currentProfile.role === "super_admin" && tenantScope) {
      params.set("tenant_id", tenantScope);
    }

    const qs = params.toString() ? `?${params.toString()}` : "";
    const [cfgRes, leadsRes, callsRes, repRes] = await Promise.all([
      safeJsonFetch(`/api/call-config${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      safeJsonFetch(`/api/leads${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      safeJsonFetch(`/api/calls${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      safeJsonFetch(`/api/reports${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    ]);

    if (cfgRes.ok) {
      setCallFields(cfgRes.data.call_fields || []);
      setDispositions(cfgRes.data.dispositions || []);
    }
    if (leadsRes.ok) {
      setLeads(leadsRes.data.leads || []);
    }
    if (callsRes.ok) {
      setCallLogs(callsRes.data.calls || []);
    }
    if (repRes.ok) {
      setReportData({
        summary: repRes.data.summary || {
          total_calls: 0,
          connected_calls: 0,
          avg_duration_seconds: 0,
          total_leads: 0,
          scheduled_followups: 0,
        },
        dispositions: repRes.data.dispositions || {},
        lead_statuses: repRes.data.lead_statuses || {},
        recent_calls: repRes.data.recent_calls || [],
      });
    }
  }

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
        const list = tRes.data.tenants || [];
        setTenants(list);
        if (role === "super_admin" && !selectedTenantScope && list[0]?.id) {
          setSelectedTenantScope(list[0].id);
        }
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
        setTenantLicenseHistory(uRes.data.license_periods || []);
        setLicenseInfo({
          used,
          max: activeSeats,
          remaining: Math.max(0, activeSeats - used),
          overCapacity: Math.max(0, used - activeSeats),
        });
      }
    }

    if (role !== "platform_ops") {
      const pUrl =
        role === "super_admin" && selectedTenantScope
          ? `/api/projects?tenant_id=${encodeURIComponent(selectedTenantScope)}`
          : "/api/projects";
      const pRes = await safeJsonFetch(pUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (pRes.ok) {
        const projList = pRes.data.projects || [];
        setProjects(projList);
        const activeProj =
          selectedProjectId && projList.some((p) => p.id === selectedProjectId)
            ? selectedProjectId
            : projList[0]?.id || "";
        setSelectedProjectId(activeProj);
        await loadCampaignAndLeadsData(
          token,
          currentProfile,
          activeProj,
          role === "super_admin" ? selectedTenantScope : ""
        );
      }
    } else {
      const repRes = await safeJsonFetch("/api/reports", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (repRes.ok) {
        setReportData({
          summary: repRes.data.summary || reportData.summary,
          dispositions: repRes.data.dispositions || {},
          lead_statuses: repRes.data.lead_statuses || {},
          recent_calls: repRes.data.recent_calls || [],
        });
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
    setShowAddUserForm(false);
    setStatusMessage(`Added user "${res.data.user?.full_name || res.data.user?.email}" with password set.`);
    await loadRoleData(session, profile);
  }

  async function handleResetUserPassword(e, targetUser) {
    e.preventDefault();
    if (!session?.access_token || !resetPasswordValue) return;
    setStatusMessage("");

    const res = await safeJsonFetch("/api/tenant/users", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        action: "reset_password",
        user_id: targetUser.id,
        password: resetPasswordValue,
      }),
    });

    if (!res.ok) {
      setStatusMessage(res.data.error || "Failed to reset password.");
      return;
    }

    setResetPasswordUserId(null);
    setResetPasswordValue("");
    setStatusMessage(`Password reset for ${targetUser.email}.`);
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

  async function handleCreateProject(e) {
    e.preventDefault();
    if (!session?.access_token) return;
    setStatusMessage("");

    const res = await safeJsonFetch("/api/projects", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        name: projectForm.name,
        description: projectForm.description,
        tenant_id: profile.role === "super_admin" ? selectedTenantScope || undefined : undefined,
      }),
    });

    if (!res.ok) {
      setStatusMessage(res.data.error || "Failed to create campaign.");
      return;
    }

    setProjectForm({ name: "", description: "" });
    setStatusMessage(`Created campaign "${res.data.project?.name}".`);
    if (res.data.project?.id) {
      setSelectedProjectId(res.data.project.id);
    }
    await loadRoleData(session, profile);
  }

  async function handleAddCallField(e) {
    e.preventDefault();
    if (!session?.access_token) return;
    setStatusMessage("");

    const res = await safeJsonFetch("/api/call-config", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        kind: "field",
        label: fieldForm.label,
        field_type: fieldForm.field_type,
        project_id: selectedProjectId || null,
        tenant_id: profile.role === "super_admin" ? selectedTenantScope || undefined : undefined,
      }),
    });

    if (!res.ok) {
      setStatusMessage(res.data.error || "Failed to add call field.");
      return;
    }

    setFieldForm({ label: "", field_type: "text" });
    setStatusMessage(`Added call field "${res.data.field?.label}" (key: ${res.data.field?.field_key}).`);
    await loadCampaignAndLeadsData(
      session.access_token,
      profile,
      selectedProjectId,
      profile.role === "super_admin" ? selectedTenantScope : ""
    );
  }

  async function handleAddDisposition(e) {
    e.preventDefault();
    if (!session?.access_token) return;
    setStatusMessage("");

    const res = await safeJsonFetch("/api/call-config", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        kind: "disposition",
        name: dispositionForm.name,
        requires_followup: dispositionForm.requires_followup,
        project_id: selectedProjectId || null,
        tenant_id: profile.role === "super_admin" ? selectedTenantScope || undefined : undefined,
      }),
    });

    if (!res.ok) {
      setStatusMessage(res.data.error || "Failed to add disposition.");
      return;
    }

    setDispositionForm({ name: "", requires_followup: false });
    setStatusMessage(`Added disposition "${res.data.disposition?.name}".`);
    await loadCampaignAndLeadsData(
      session.access_token,
      profile,
      selectedProjectId,
      profile.role === "super_admin" ? selectedTenantScope : ""
    );
  }

  async function handleAddSingleLead(e) {
    e.preventDefault();
    if (!session?.access_token) return;
    setStatusMessage("");

    const res = await safeJsonFetch("/api/leads", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        ...leadForm,
        project_id: selectedProjectId || null,
        tenant_id: profile.role === "super_admin" ? selectedTenantScope || undefined : undefined,
      }),
    });

    if (!res.ok) {
      setStatusMessage(res.data.error || "Failed to add lead.");
      return;
    }

    setLeadForm({ name: "", phone: "", email: "", notes: "", follow_up_at: "" });
    setStatusMessage(`Added lead "${res.data.lead?.name}".`);
    await loadCampaignAndLeadsData(
      session.access_token,
      profile,
      selectedProjectId,
      profile.role === "super_admin" ? selectedTenantScope : ""
    );
  }

  async function handleUploadCsv(e) {
    e.preventDefault();
    if (!session?.access_token) return;
    setStatusMessage("");

    const res = await safeJsonFetch("/api/leads/upload", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        csv_text: csvText,
        project_id: selectedProjectId || null,
        tenant_id: profile.role === "super_admin" ? selectedTenantScope || undefined : undefined,
      }),
    });

    if (!res.ok) {
      setStatusMessage(res.data.error || "Failed to upload CSV leads.");
      return;
    }

    setStatusMessage(`Uploaded ${res.data.uploaded_count || 0} lead(s).`);
    await loadCampaignAndLeadsData(
      session.access_token,
      profile,
      selectedProjectId,
      profile.role === "super_admin" ? selectedTenantScope : ""
    );
  }

  async function handleUpdateLead(leadId, patch) {
    if (!session?.access_token) return;
    setStatusMessage("");

    const res = await safeJsonFetch("/api/leads", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ lead_id: leadId, ...patch }),
    });

    if (!res.ok) {
      setStatusMessage(res.data.error || "Failed to update lead.");
      return;
    }

    setStatusMessage("Lead updated.");
    await loadCampaignAndLeadsData(
      session.access_token,
      profile,
      selectedProjectId,
      profile.role === "super_admin" ? selectedTenantScope : ""
    );
  }

  function handleStartSmartCall() {
    if (!dialerState.phone.trim()) {
      setStatusMessage("Select a lead or enter a phone number first.");
      return;
    }
    const startedAt = new Date().toISOString();
    setDialerState((prev) => ({
      ...prev,
      status: "connected",
      activeCallStartedAt: startedAt,
    }));
    setStatusMessage(`SmartCall session started for ${dialerState.phone}.`);
  }

  function handleEndSmartCall() {
    if (!dialerState.activeCallStartedAt) return;
    const elapsedSec = Math.max(
      1,
      Math.round((Date.now() - new Date(dialerState.activeCallStartedAt).getTime()) / 1000)
    );
    setDialerState((prev) => ({
      ...prev,
      duration_seconds: elapsedSec,
      activeCallStartedAt: null,
    }));
    setStatusMessage(`Call ended (${elapsedSec}s). Review disposition and click Log Call.`);
  }

  async function handleLogCall(e) {
    e.preventDefault();
    if (!session?.access_token) return;
    setStatusMessage("");

    const res = await safeJsonFetch("/api/calls", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        tenant_id: profile.role === "super_admin" ? selectedTenantScope || undefined : undefined,
        project_id: selectedProjectId || null,
        lead_id: dialerState.lead_id || null,
        phone: dialerState.phone,
        status: dialerState.status,
        disposition: dialerState.disposition || null,
        notes: dialerState.notes || null,
        duration_seconds: Number(dialerState.duration_seconds || 0),
        follow_up_at: dialerState.follow_up_at
          ? new Date(dialerState.follow_up_at).toISOString()
          : null,
        custom_fields: dialerState.custom_fields,
      }),
    });

    if (!res.ok) {
      setStatusMessage(res.data.error || "Failed to log call.");
      return;
    }

    setDialerState((prev) => ({
      ...prev,
      disposition: "",
      notes: "",
      follow_up_at: "",
      activeCallStartedAt: null,
    }));
    setStatusMessage(`Logged call to ${res.data.call?.phone} (${res.data.call?.duration_seconds}s).`);
    await loadCampaignAndLeadsData(
      session.access_token,
      profile,
      selectedProjectId,
      profile.role === "super_admin" ? selectedTenantScope : ""
    );
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

  const filteredLeads = leads.filter((l) => {
    if (!leadSearch.trim()) return true;
    const q = leadSearch.trim().toLowerCase();
    return (
      String(l.name || "").toLowerCase().includes(q) ||
      String(l.phone || "").toLowerCase().includes(q) ||
      String(l.disposition || "").toLowerCase().includes(q) ||
      String(l.status || "").toLowerCase().includes(q)
    );
  });

  const followupLeads = leads.filter((l) => Boolean(l.follow_up_at));

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
                    Custom Start Date/Time (optional—use a future date for Upcoming):
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
        )}

      {activeTab === "Team & Licenses" && profile.role === "tenant_admin" && (
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
            <h3 style={{ margin: 0 }}>
              Team & Licenses — {licenseInfo.used} / {licenseInfo.max} active seats used (
              {licenseInfo.remaining} available)
            </h3>
            <button
              type="button"
              onClick={() => setShowAddUserForm((prev) => !prev)}
              style={{ padding: "7px 12px", fontWeight: "bold", cursor: "pointer" }}
            >
              {showAddUserForm ? "Close Add Member" : "+ Add Team Member"}
            </button>
          </div>

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

          {showAddUserForm && (
            <div style={{ marginBottom: 20, padding: 14, border: "1px solid #cbd5e1", borderRadius: 8 }}>
              <h4 style={{ marginTop: 0 }}>Add Team Member & Set Password</h4>
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
                  placeholder="Set Initial Password (min 6 chars)"
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
                  {licenseInfo.remaining > 0 ? "Create Member (Uses 1 Seat)" : "No Seats Available"}
                </button>
              </form>
            </div>
          )}

          <table
            border="1"
            cellPadding="8"
            style={{ width: "100%", borderCollapse: "collapse", marginBottom: 24 }}
          >
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
                  <td>
                    <code>{u.role}</code>
                  </td>
                  <td>{u.is_active ? "Active (1 seat)" : "Disabled (seat free)"}</td>
                  <td>
                    <button
                      type="button"
                      onClick={() => {
                        setResetPasswordUserId((cur) => (cur === u.id ? null : u.id));
                        setResetPasswordValue("");
                      }}
                      style={{ marginRight: 6 }}
                    >
                      Reset Password
                    </button>

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

                    {resetPasswordUserId === u.id && (
                      <form
                        onSubmit={(e) => handleResetUserPassword(e, u)}
                        style={{ display: "flex", gap: 6, marginTop: 8 }}
                      >
                        <input
                          type="password"
                          placeholder="New password (min 6 chars)"
                          value={resetPasswordValue}
                          onChange={(e) => setResetPasswordValue(e.target.value)}
                          required
                          style={{ padding: 4 }}
                        />
                        <button type="submit">Save Password</button>
                        <button
                          type="button"
                          onClick={() => {
                            setResetPasswordUserId(null);
                            setResetPasswordValue("");
                          }}
                        >
                          Cancel
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <h4>Your Tenant License History</h4>
          <table border="1" cellPadding="6" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr>
                <th>Seats</th>
                <th>License Label</th>
                <th>Start Date</th>
                <th>End Date</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {tenantLicenseHistory.map((lp) => (
                <tr key={lp.id}>
                  <td>+{lp.seat_count}</td>
                  <td>
                    <LicensePeriodBadge period={lp} />
                  </td>
                  <td>{lp.starts_at ? new Date(lp.starts_at).toLocaleString() : "-"}</td>
                  <td>{lp.ends_at ? new Date(lp.ends_at).toLocaleString() : "Open-ended"}</td>
                  <td>{lp.reason || "-"}</td>
                </tr>
              ))}
              {tenantLicenseHistory.length === 0 && (
                <tr>
                  <td colSpan="5">No license periods recorded for your tenant yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {activeTab === "Campaigns & Leads" && (
        <section>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
            <h3 style={{ margin: 0 }}>Campaigns & Leads</h3>

            {profile.role === "super_admin" && tenants.length > 0 && (
              <label style={{ fontSize: 13 }}>
                Tenant:{" "}
                <select
                  value={selectedTenantScope}
                  onChange={async (e) => {
                    const nextTenant = e.target.value;
                    setSelectedTenantScope(nextTenant);
                    const pRes = await safeJsonFetch(
                      `/api/projects?tenant_id=${encodeURIComponent(nextTenant)}`,
                      { headers: { Authorization: `Bearer ${session.access_token}` } }
                    );
                    const list = pRes.ok ? pRes.data.projects || [] : [];
                    setProjects(list);
                    const firstProj = list[0]?.id || "";
                    setSelectedProjectId(firstProj);
                    await loadCampaignAndLeadsData(session.access_token, profile, firstProj, nextTenant);
                  }}
                >
                  {tenants.map((t) => (
                    <option key={t.id} value={t.id}>
                      #{t.numeric_id} {t.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label style={{ fontSize: 13 }}>
              Campaign:{" "}
              <select
                value={selectedProjectId}
                onChange={async (e) => {
                  const nextProj = e.target.value;
                  setSelectedProjectId(nextProj);
                  await loadCampaignAndLeadsData(
                    session.access_token,
                    profile,
                    nextProj,
                    profile.role === "super_admin" ? selectedTenantScope : ""
                  );
                }}
              >
                <option value="">All Campaigns ({projects.length})</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {["super_admin", "tenant_admin"].includes(profile.role) && (
            <div style={{ marginBottom: 20, padding: 12, border: "1px solid #cbd5e1", borderRadius: 8 }}>
              <h4 style={{ marginTop: 0 }}>Create Campaign</h4>
              <form onSubmit={handleCreateProject} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input
                  placeholder="Campaign Name"
                  value={projectForm.name}
                  onChange={(e) => setProjectForm((f) => ({ ...f, name: e.target.value }))}
                  required
                />
                <input
                  placeholder="Description (optional)"
                  value={projectForm.description}
                  onChange={(e) => setProjectForm((f) => ({ ...f, description: e.target.value }))}
                />
                <button type="submit">Create Campaign</button>
              </form>
            </div>
          )}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: 12,
              marginBottom: 20,
            }}
          >
            <div style={{ padding: 12, border: "1px solid #cbd5e1", borderRadius: 8 }}>
              <h4 style={{ marginTop: 0 }}>Call Fields ({callFields.length})</h4>
              {["super_admin", "tenant_admin", "supervisor"].includes(profile.role) && (
                <form onSubmit={handleAddCallField} style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                  <input
                    placeholder="Field label (e.g. City)"
                    value={fieldForm.label}
                    onChange={(e) => setFieldForm((f) => ({ ...f, label: e.target.value }))}
                    required
                  />
                  <select
                    value={fieldForm.field_type}
                    onChange={(e) => setFieldForm((f) => ({ ...f, field_type: e.target.value }))}
                  >
                    <option value="text">Text</option>
                    <option value="number">Number</option>
                    <option value="date">Date</option>
                  </select>
                  <button type="submit">Add</button>
                </form>
              )}
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                {callFields.map((cf) => (
                  <li key={cf.id}>
                    {cf.label} <code>({cf.field_key || cf.field_type})</code>
                  </li>
                ))}
                {callFields.length === 0 && <li>No custom fields yet.</li>}
              </ul>
            </div>

            <div style={{ padding: 12, border: "1px solid #cbd5e1", borderRadius: 8 }}>
              <h4 style={{ marginTop: 0 }}>Dispositions ({dispositions.length})</h4>
              {["super_admin", "tenant_admin", "supervisor"].includes(profile.role) && (
                <form
                  onSubmit={handleAddDisposition}
                  style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}
                >
                  <input
                    placeholder="Disposition (e.g. Interested)"
                    value={dispositionForm.name}
                    onChange={(e) => setDispositionForm((f) => ({ ...f, name: e.target.value }))}
                    required
                  />
                  <label style={{ fontSize: 12 }}>
                    <input
                      type="checkbox"
                      checked={dispositionForm.requires_followup}
                      onChange={(e) =>
                        setDispositionForm((f) => ({ ...f, requires_followup: e.target.checked }))
                      }
                    />{" "}
                    Follow-up
                  </label>
                  <button type="submit">Add</button>
                </form>
              )}
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                {dispositions.map((d) => (
                  <li key={d.id}>
                    {d.name} {d.requires_followup ? "(Follow-Up)" : ""}
                  </li>
                ))}
                {dispositions.length === 0 && <li>No dispositions configured yet.</li>}
              </ul>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
              gap: 12,
              marginBottom: 20,
            }}
          >
            <div style={{ padding: 12, border: "1px solid #cbd5e1", borderRadius: 8 }}>
              <h4 style={{ marginTop: 0 }}>Add Single Lead</h4>
              <form onSubmit={handleAddSingleLead} style={{ display: "grid", gap: 8 }}>
                <input
                  placeholder="Lead Name"
                  value={leadForm.name}
                  onChange={(e) => setLeadForm((f) => ({ ...f, name: e.target.value }))}
                  required
                />
                <input
                  placeholder="Phone Number"
                  value={leadForm.phone}
                  onChange={(e) => setLeadForm((f) => ({ ...f, phone: e.target.value }))}
                  required
                />
                <input
                  placeholder="Email (optional)"
                  value={leadForm.email}
                  onChange={(e) => setLeadForm((f) => ({ ...f, email: e.target.value }))}
                />
                <label style={{ fontSize: 12 }}>
                  Follow-Up Date/Time (optional):
                  <input
                    type="datetime-local"
                    value={leadForm.follow_up_at}
                    onChange={(e) => setLeadForm((f) => ({ ...f, follow_up_at: e.target.value }))}
                    style={{ width: "100%", marginTop: 2 }}
                  />
                </label>
                <button type="submit">Add Lead</button>
              </form>
            </div>

            <div style={{ padding: 12, border: "1px solid #cbd5e1", borderRadius: 8 }}>
              <h4 style={{ marginTop: 0 }}>Bulk CSV Lead Upload</h4>
              <form onSubmit={handleUploadCsv} style={{ display: "grid", gap: 8 }}>
                <textarea
                  rows={4}
                  value={csvText}
                  onChange={(e) => setCsvText(e.target.value)}
                  style={{ width: "100%", fontSize: 12 }}
                />
                <button type="submit">Upload CSV Leads</button>
              </form>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <h4 style={{ margin: 0 }}>Leads ({filteredLeads.length})</h4>
            <input
              placeholder="Search name, phone, status, disposition..."
              value={leadSearch}
              onChange={(e) => setLeadSearch(e.target.value)}
              style={{ width: 260, padding: 6 }}
            />
          </div>

          <table border="1" cellPadding="8" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th>Lead</th>
                <th>Phone</th>
                <th>Status</th>
                <th>Disposition</th>
                <th>Follow-Up</th>
              </tr>
            </thead>
            <tbody>
              {filteredLeads.map((l) => (
                <tr key={l.id}>
                  <td>
                    <strong>{l.name}</strong>
                    {l.email && <div style={{ fontSize: 11, color: "#64748b" }}>{l.email}</div>}
                  </td>
                  <td>{l.phone}</td>
                  <td>
                    <select
                      value={l.status || "new"}
                      onChange={(e) => handleUpdateLead(l.id, { status: e.target.value })}
                    >
                      <option value="new">new</option>
                      <option value="contacted">contacted</option>
                      <option value="follow_up">follow_up</option>
                      <option value="converted">converted</option>
                      <option value="closed">closed</option>
                    </select>
                  </td>
                  <td>
                    <select
                      value={l.disposition || ""}
                      onChange={(e) => handleUpdateLead(l.id, { disposition: e.target.value || null })}
                    >
                      <option value="">-- Select --</option>
                      {dispositions.map((d) => (
                        <option key={d.id} value={d.name}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      type="datetime-local"
                      value={l.follow_up_at ? String(l.follow_up_at).slice(0, 16) : ""}
                      onChange={(e) =>
                        handleUpdateLead(l.id, {
                          follow_up_at: e.target.value ? new Date(e.target.value).toISOString() : null,
                        })
                      }
                    />
                  </td>
                </tr>
              ))}
              {filteredLeads.length === 0 && (
                <tr>
                  <td colSpan="5">No leads found for this selection.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {activeTab === "Follow-Ups" && (
        <section>
          <h3>Scheduled Follow-Ups ({followupLeads.length})</h3>
          <table border="1" cellPadding="8" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th>Lead</th>
                <th>Phone</th>
                <th>Follow-Up Time</th>
                <th>Disposition</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {followupLeads.map((l) => (
                <tr key={l.id}>
                  <td>
                    <strong>{l.name}</strong>
                  </td>
                  <td>{l.phone}</td>
                  <td>{l.follow_up_at ? new Date(l.follow_up_at).toLocaleString() : "-"}</td>
                  <td>{l.disposition || "-"}</td>
                  <td>{l.status || "follow_up"}</td>
                </tr>
              ))}
              {followupLeads.length === 0 && (
                <tr>
                  <td colSpan="5">No scheduled follow-ups yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {activeTab === "Dialer" && (
        <section>
          <h3>SmartCall Dialer Console</h3>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
              gap: 16,
              marginBottom: 24,
            }}
          >
            <div style={{ padding: 14, border: "1px solid #cbd5e1", borderRadius: 8 }}>
              <h4 style={{ marginTop: 0 }}>Dial & Log Call</h4>
              <form onSubmit={handleLogCall} style={{ display: "grid", gap: 8 }}>
                <label style={{ fontSize: 12 }}>
                  Pick Lead (optional):
                  <select
                    value={dialerState.lead_id}
                    onChange={(e) => {
                      const pickedId = e.target.value;
                      const found = leads.find((item) => item.id === pickedId);
                      setDialerState((prev) => ({
                        ...prev,
                        lead_id: pickedId,
                        phone: found?.phone || prev.phone,
                      }));
                    }}
                    style={{ width: "100%", marginTop: 2 }}
                  >
                    <option value="">-- Manual Number --</option>
                    {leads.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name} ({l.phone})
                      </option>
                    ))}
                  </select>
                </label>

                <label style={{ fontSize: 12 }}>
                  Phone Number:
                  <input
                    placeholder="e.g. 9876543210"
                    value={dialerState.phone}
                    onChange={(e) => setDialerState((prev) => ({ ...prev, phone: e.target.value }))}
                    required
                    style={{ width: "100%", marginTop: 2 }}
                  />
                </label>

                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button type="button" onClick={handleStartSmartCall} disabled={Boolean(dialerState.activeCallStartedAt)}>
                    Start Call
                  </button>
                  <button type="button" onClick={handleEndSmartCall} disabled={!dialerState.activeCallStartedAt}>
                    End Call
                  </button>
                  {dialerState.activeCallStartedAt && (
                    <span style={{ fontSize: 12, color: "#166534", fontWeight: "bold", alignSelf: "center" }}>
                      Call in progress...
                    </span>
                  )}
                </div>

                <div style={{ display: "flex", gap: 8 }}>
                  <label style={{ fontSize: 12, flex: 1 }}>
                    Call Status:
                    <select
                      value={dialerState.status}
                      onChange={(e) => setDialerState((prev) => ({ ...prev, status: e.target.value }))}
                      style={{ width: "100%", marginTop: 2 }}
                    >
                      <option value="connected">connected</option>
                      <option value="completed">completed</option>
                      <option value="no_answer">no_answer</option>
                      <option value="busy">busy</option>
                    </select>
                  </label>
                  <label style={{ fontSize: 12, flex: 1 }}>
                    Duration (sec):
                    <input
                      type="number"
                      min="0"
                      value={dialerState.duration_seconds}
                      onChange={(e) =>
                        setDialerState((prev) => ({ ...prev, duration_seconds: e.target.value }))
                      }
                      style={{ width: "100%", marginTop: 2 }}
                    />
                  </label>
                </div>

                <label style={{ fontSize: 12 }}>
                  Disposition:
                  <select
                    value={dialerState.disposition}
                    onChange={(e) => setDialerState((prev) => ({ ...prev, disposition: e.target.value }))}
                    style={{ width: "100%", marginTop: 2 }}
                  >
                    <option value="">-- Select Disposition --</option>
                    {dispositions.map((d) => (
                      <option key={d.id} value={d.name}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </label>

                {callFields.map((cf) => (
                  <label key={cf.id} style={{ fontSize: 12 }}>
                    {cf.label}:
                    <input
                      type={cf.field_type === "number" ? "number" : cf.field_type === "date" ? "date" : "text"}
                      value={dialerState.custom_fields[cf.field_key] || ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        setDialerState((prev) => ({
                          ...prev,
                          custom_fields: {
                            ...prev.custom_fields,
                            [cf.field_key]: val,
                          },
                        }));
                      }}
                      style={{ width: "100%", marginTop: 2 }}
                    />
                  </label>
                ))}

                <label style={{ fontSize: 12 }}>
                  Schedule Follow-Up (optional):
                  <input
                    type="datetime-local"
                    value={dialerState.follow_up_at}
                    onChange={(e) => setDialerState((prev) => ({ ...prev, follow_up_at: e.target.value }))}
                    style={{ width: "100%", marginTop: 2 }}
                  />
                </label>

                <label style={{ fontSize: 12 }}>
                  Call Notes:
                  <textarea
                    rows={2}
                    value={dialerState.notes}
                    onChange={(e) => setDialerState((prev) => ({ ...prev, notes: e.target.value }))}
                    style={{ width: "100%", marginTop: 2 }}
                  />
                </label>

                <button type="submit">Log Call</button>
              </form>
            </div>

            <div style={{ padding: 14, border: "1px solid #cbd5e1", borderRadius: 8 }}>
              <h4 style={{ marginTop: 0 }}>Recent Call Logs ({callLogs.length})</h4>
              <table border="1" cellPadding="6" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr>
                    <th>Phone</th>
                    <th>Status</th>
                    <th>Disposition</th>
                    <th>Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {callLogs.slice(0, 15).map((c) => (
                    <tr key={c.id}>
                      <td>{c.phone}</td>
                      <td>{c.status}</td>
                      <td>{c.disposition || "-"}</td>
                      <td>{c.duration_seconds || 0}s</td>
                    </tr>
                  ))}
                  {callLogs.length === 0 && (
                    <tr>
                      <td colSpan="4">No calls logged yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {activeTab === "Reports" && (
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
              <strong style={{ fontSize: 20 }}>{reportData.summary.total_calls}</strong>
            </div>
            <div style={{ padding: 12, border: "1px solid #cbd5e1", borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: "#64748b" }}>Connected Calls</div>
              <strong style={{ fontSize: 20 }}>{reportData.summary.connected_calls}</strong>
            </div>
            <div style={{ padding: 12, border: "1px solid #cbd5e1", borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: "#64748b" }}>Avg Duration</div>
              <strong style={{ fontSize: 20 }}>{reportData.summary.avg_duration_seconds}s</strong>
            </div>
            <div style={{ padding: 12, border: "1px solid #cbd5e1", borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: "#64748b" }}>Total Leads</div>
              <strong style={{ fontSize: 20 }}>{reportData.summary.total_leads}</strong>
            </div>
            <div style={{ padding: 12, border: "1px solid #cbd5e1", borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: "#64748b" }}>Follow-Ups Scheduled</div>
              <strong style={{ fontSize: 20 }}>{reportData.summary.scheduled_followups}</strong>
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
                {Object.entries(reportData.dispositions || {}).map(([k, v]) => (
                  <li key={k}>
                    {k}: <strong>{v}</strong>
                  </li>
                ))}
                {Object.keys(reportData.dispositions || {}).length === 0 && <li>No disposition data yet.</li>}
              </ul>
            </div>

            <div style={{ padding: 12, border: "1px solid #cbd5e1", borderRadius: 8 }}>
              <h4 style={{ marginTop: 0 }}>Leads by Status</h4>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                {Object.entries(reportData.lead_statuses || {}).map(([k, v]) => (
                  <li key={k}>
                    {k}: <strong>{v}</strong>
                  </li>
                ))}
                {Object.keys(reportData.lead_statuses || {}).length === 0 && <li>No lead status data yet.</li>}
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
              {(reportData.recent_calls || []).map((c) => (
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
              {(!reportData.recent_calls || reportData.recent_calls.length === 0) && (
                <tr>
                  <td colSpan="7">No call records available yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
