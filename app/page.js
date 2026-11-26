"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
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

function getLeadCustomFields(lead) {
  if (lead?.custom_fields && typeof lead.custom_fields === "object") {
    return lead.custom_fields;
  }
  return {};
}

function matchesLeadFilters(lead, filters) {
  if (filters.status && filters.status !== "all" && (lead.status || "new") !== filters.status) {
    return false;
  }

  if (filters.disposition && filters.disposition !== "all") {
    if (filters.disposition === "__none__") {
      if (lead.disposition) return false;
    } else if ((lead.disposition || "") !== filters.disposition) {
      return false;
    }
  }

  const hasFollowUp = Boolean(lead.follow_up_at);
  const wasCalled = Boolean(lead.last_called_at) || (lead.status && lead.status !== "new");
  if (filters.callKind === "fresh" && (hasFollowUp || wasCalled)) {
    return false;
  }
  if (filters.callKind === "followup" && !hasFollowUp && (lead.status || "") !== "follow_up") {
    return false;
  }
  if (filters.callKind === "fresh_and_followup") {
    const isFresh = !hasFollowUp && !wasCalled;
    const isFollowup = hasFollowUp || (lead.status || "") === "follow_up";
    if (!isFresh && !isFollowup) return false;
  }

  if (filters.paramKey && filters.paramValue.trim()) {
    const needle = filters.paramValue.trim().toLowerCase();
    const cf = getLeadCustomFields(lead);
    const val =
      filters.paramKey === "city"
        ? cf.city ?? lead.city ?? ""
        : cf[filters.paramKey] ?? lead[filters.paramKey] ?? "";
    if (!String(val).toLowerCase().includes(needle)) {
      return false;
    }
  }

  if (filters.search && filters.search.trim()) {
    const q = filters.search.trim().toLowerCase();
    const cfText = Object.values(getLeadCustomFields(lead)).join(" ").toLowerCase();
    const hit =
      String(lead.name || "").toLowerCase().includes(q) ||
      String(lead.phone || "").toLowerCase().includes(q) ||
      String(lead.disposition || "").toLowerCase().includes(q) ||
      String(lead.status || "").toLowerCase().includes(q) ||
      cfText.includes(q);
    if (!hit) return false;
  }

  return true;
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

  // Campaigns, Sub-Tabs ("calling_data" | "settings"), Call Config & Leads
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedTenantScope, setSelectedTenantScope] = useState("");
  const [campaignSubTab, setCampaignSubTab] = useState("calling_data");
  const [projectForm, setProjectForm] = useState({ name: "", description: "" });

  const [callFields, setCallFields] = useState([]);
  const [dispositions, setDispositions] = useState([]);
  const [fieldForm, setFieldForm] = useState({ label: "", field_type: "text" });
  const [dispositionForm, setDispositionForm] = useState({ name: "", requires_followup: false });

  const [leads, setLeads] = useState([]);
  const [leadFilter, setLeadFilter] = useState({
    status: "all",
    disposition: "all",
    callKind: "all",
    paramKey: "",
    paramValue: "",
    search: "",
  });
  const [bulkFollowUpAt, setBulkFollowUpAt] = useState("");
  const [leadForm, setLeadForm] = useState({
    name: "",
    phone: "",
    email: "",
    notes: "",
    follow_up_at: "",
    custom_fields: {},
  });
  const [csvText, setCsvText] = useState(
    "name,phone,email,city\nRahul Sharma,9876543210,rahul@example.com,Mumbai"
  );

  // Dialer Queue, Active Session & Paginated Expandable Call Logs
  const [callLogs, setCallLogs] = useState([]);
  const [callLogPage, setCallLogPage] = useState(1);
  const [expandedCallIds, setExpandedCallIds] = useState({});
  const [dialerFilter, setDialerFilter] = useState({
    project_id: "",
    status: "all",
    disposition: "all",
    callKind: "all",
    paramKey: "",
    paramValue: "",
  });
  const [queueActive, setQueueActive] = useState(false);
  const [queueIndex, setQueueIndex] = useState(0);
  const [dialerForm, setDialerForm] = useState({
    lead_id: "",
    phone: "",
    status: "connected",
    disposition: "",
    notes: "",
    duration_seconds: 0,
    follow_up_at: "",
    custom_fields: {},
    callStartedAt: null,
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

  // Only active campaigns are shown in campaign selectors and lists
  const activeProjects = useMemo(
    () =>
      (projects || []).filter((p) => {
        const st = String(p.status || "active").toLowerCase();
        return !["inactive", "archived", "closed", "completed", "disabled"].includes(st);
      }),
    [projects]
  );

  const activeCampaign = useMemo(
    () => activeProjects.find((p) => p.id === selectedProjectId) || null,
    [activeProjects, selectedProjectId]
  );

  const paramOptions = useMemo(() => {
    const base = [{ key: "city", label: "City (city)" }];
    for (const cf of callFields || []) {
      if (cf.field_key && cf.field_key !== "city") {
        base.push({ key: cf.field_key, label: `${cf.label} (${cf.field_key})` });
      }
    }
    return base;
  }, [callFields]);

  const filteredCallingLeads = useMemo(
    () => (leads || []).filter((l) => matchesLeadFilters(l, leadFilter)),
    [leads, leadFilter]
  );

  const dialerQueueLeads = useMemo(() => {
    const pool = dialerFilter.project_id
      ? (leads || []).filter((l) => l.project_id === dialerFilter.project_id)
      : leads || [];
    return pool.filter((l) => matchesLeadFilters(l, dialerFilter));
  }, [leads, dialerFilter]);

  const currentQueueLead = useMemo(() => {
    if (!queueActive || dialerQueueLeads.length === 0) return null;
    const safeIdx = Math.min(queueIndex, dialerQueueLeads.length - 1);
    return dialerQueueLeads[safeIdx] || null;
  }, [queueActive, dialerQueueLeads, queueIndex]);

  const CALLS_PER_PAGE = 10;
  const totalCallPages = Math.max(1, Math.ceil((callLogs || []).length / CALLS_PER_PAGE));
  const paginatedCallLogs = useMemo(() => {
    const start = (callLogPage - 1) * CALLS_PER_PAGE;
    return (callLogs || []).slice(start, start + CALLS_PER_PAGE);
  }, [callLogs, callLogPage]);

  function bindLeadToDialer(lead) {
    if (!lead) return;
    setDialerForm({
      lead_id: lead.id,
      phone: lead.phone || "",
      status: "connected",
      disposition: lead.disposition || "",
      notes: lead.notes || "",
      duration_seconds: 0,
      follow_up_at: lead.follow_up_at ? String(lead.follow_up_at).slice(0, 16) : "",
      custom_fields: { ...getLeadCustomFields(lead) },
      callStartedAt: null,
    });
  }

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
      setCallLogPage(1);
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
        const allProjects = pRes.data.projects || [];
        const onlyActive = allProjects.filter((p) => {
          const st = String(p.status || "active").toLowerCase();
          return !["inactive", "archived", "closed", "completed", "disabled"].includes(st);
        });
        setProjects(onlyActive);
        const activeProj =
          selectedProjectId && onlyActive.some((p) => p.id === selectedProjectId)
            ? selectedProjectId
            : onlyActive[0]?.id || "";
        setSelectedProjectId(activeProj);
        setDialerFilter((prev) => ({
          ...prev,
          project_id: prev.project_id || activeProj,
        }));
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
        status: "active",
        tenant_id: profile.role === "super_admin" ? selectedTenantScope || undefined : undefined,
      }),
    });

    if (!res.ok) {
      setStatusMessage(res.data.error || "Failed to create campaign.");
      return;
    }

    setProjectForm({ name: "", description: "" });
    setStatusMessage(`Created active campaign "${res.data.project?.name}".`);
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

    setLeadForm({ name: "", phone: "", email: "", notes: "", follow_up_at: "", custom_fields: {} });
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

  async function handleBulkSetFollowUp() {
    if (!session?.access_token || !bulkFollowUpAt || filteredCallingLeads.length === 0) return;
    setStatusMessage("");

    const ids = filteredCallingLeads.map((l) => l.id);
    const res = await safeJsonFetch("/api/leads", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        lead_ids: ids,
        follow_up_at: new Date(bulkFollowUpAt).toISOString(),
        status: "follow_up",
        tenant_id: profile.role === "super_admin" ? selectedTenantScope || undefined : undefined,
      }),
    });

    if (!res.ok) {
      setStatusMessage(res.data.error || "Failed to apply bulk follow-up.");
      return;
    }

    setStatusMessage(`Set follow-up on ${ids.length} filtered lead(s).`);
    await loadCampaignAndLeadsData(
      session.access_token,
      profile,
      selectedProjectId,
      profile.role === "super_admin" ? selectedTenantScope : ""
    );
  }

  async function handleBulkDeleteFilteredLeads() {
    if (!session?.access_token || filteredCallingLeads.length === 0) return;
    const count = filteredCallingLeads.length;
    if (typeof window !== "undefined" && !window.confirm(`Delete ${count} filtered lead(s)?`)) {
      return;
    }

    setStatusMessage("");
    const ids = filteredCallingLeads.map((l) => l.id);
    const res = await safeJsonFetch("/api/leads", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        lead_ids: ids,
        tenant_id: profile.role === "super_admin" ? selectedTenantScope || undefined : undefined,
      }),
    });

    if (!res.ok) {
      setStatusMessage(res.data.error || "Failed to delete filtered leads.");
      return;
    }

    setStatusMessage(`Deleted ${count} filtered lead(s).`);
    await loadCampaignAndLeadsData(
      session.access_token,
      profile,
      selectedProjectId,
      profile.role === "super_admin" ? selectedTenantScope : ""
    );
  }

  function handleApplyDialerQueue(e) {
    e?.preventDefault();
    if (dialerQueueLeads.length === 0) {
      setQueueActive(false);
      setQueueIndex(0);
      setStatusMessage("No leads match the selected dialer filters.");
      return;
    }
    setQueueActive(true);
    setQueueIndex(0);
    bindLeadToDialer(dialerQueueLeads[0]);
    setStatusMessage(
      `Dialer queue ready: ${dialerQueueLeads.length} lead(s) matched. Showing lead 1 of ${dialerQueueLeads.length}.`
    );
  }

  function handleStartCall() {
    if (!dialerForm.phone.trim()) {
      setStatusMessage("Enter or select a phone number before starting a call.");
      return;
    }
    setDialerForm((prev) => ({
      ...prev,
      status: "connected",
      callStartedAt: new Date().toISOString(),
    }));
    setStatusMessage(`Call started for ${dialerForm.phone}.`);
  }

  function handleEndCall() {
    setDialerForm((prev) => {
      const elapsed = prev.callStartedAt
        ? Math.max(1, Math.round((Date.now() - new Date(prev.callStartedAt).getTime()) / 1000))
        : prev.duration_seconds || 15;
      return {
        ...prev,
        duration_seconds: elapsed,
        callStartedAt: null,
      };
    });
    setStatusMessage("Call ended. Set disposition or follow-up, then click Save & Next or Save & Stop.");
  }

  function handleCancelCall() {
    setDialerForm((prev) => ({
      ...prev,
      callStartedAt: null,
      duration_seconds: 0,
      status: "no_answer",
    }));
    setStatusMessage("Active call cancelled (not saved).");
  }

  async function persistDialerCall({ moveToNext }) {
    if (!session?.access_token) return;
    if (!dialerForm.phone.trim()) {
      setStatusMessage("Phone number is required to save a call log.");
      return;
    }

    setStatusMessage("");
    const effectiveProjectId = dialerFilter.project_id || currentQueueLead?.project_id || selectedProjectId || null;

    const computedDuration = dialerForm.callStartedAt
      ? Math.max(1, Math.round((Date.now() - new Date(dialerForm.callStartedAt).getTime()) / 1000))
      : Number(dialerForm.duration_seconds || 0);

    const res = await safeJsonFetch("/api/calls", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        tenant_id: profile.role === "super_admin" ? selectedTenantScope || undefined : undefined,
        project_id: effectiveProjectId,
        lead_id: dialerForm.lead_id || currentQueueLead?.id || null,
        phone: dialerForm.phone.trim(),
        status: dialerForm.status,
        disposition: dialerForm.disposition || null,
        notes: dialerForm.notes || null,
        duration_seconds: computedDuration,
        follow_up_at: dialerForm.follow_up_at
          ? new Date(dialerForm.follow_up_at).toISOString()
          : null,
        custom_fields: dialerForm.custom_fields,
      }),
    });

    if (!res.ok) {
      setStatusMessage(res.data.error || "Failed to save call log.");
      return;
    }

    await loadCampaignAndLeadsData(
      session.access_token,
      profile,
      selectedProjectId,
      profile.role === "super_admin" ? selectedTenantScope : ""
    );

    if (moveToNext && queueActive && dialerQueueLeads.length > 0) {
      const nextIdx = queueIndex + 1;
      if (nextIdx < dialerQueueLeads.length) {
        setQueueIndex(nextIdx);
        bindLeadToDialer(dialerQueueLeads[nextIdx]);
        setStatusMessage(
          `Saved call & moved to next lead (${nextIdx + 1} of ${dialerQueueLeads.length}): ${dialerQueueLeads[nextIdx].name}.`
        );
      } else {
        setQueueActive(false);
        setQueueIndex(0);
        setStatusMessage("Saved call. You have reached the end of the filtered calling queue.");
      }
    } else {
      setQueueActive(false);
      setDialerForm((prev) => ({ ...prev, callStartedAt: null, notes: "", follow_up_at: "" }));
      setStatusMessage("Call saved and dialer stopped.");
    }
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
    <div style={{ maxWidth: 1220, margin: "24px auto", padding: 16, fontFamily: "sans-serif" }}>
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
          <div
            style={{
              display: "flex",
              gap: 12,
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 14,
            }}
          >
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>Active Campaigns ({activeProjects.length})</h3>

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
                      const list = pRes.ok
                        ? (pRes.data.projects || []).filter((p) => {
                            const st = String(p.status || "active").toLowerCase();
                            return !["inactive", "archived", "closed", "completed", "disabled"].includes(st);
                          })
                        : [];
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
                Select Active Campaign:{" "}
                <select
                  value={selectedProjectId}
                  onChange={async (e) => {
                    const nextProj = e.target.value;
                    setSelectedProjectId(nextProj);
                    setDialerFilter((prev) => ({ ...prev, project_id: nextProj }));
                    await loadCampaignAndLeadsData(
                      session.access_token,
                      profile,
                      nextProj,
                      profile.role === "super_admin" ? selectedTenantScope : ""
                    );
                  }}
                >
                  <option value="">-- Choose Active Campaign --</option>
                  {activeProjects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} (Active)
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {selectedProjectId && (
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  type="button"
                  onClick={() => setCampaignSubTab("calling_data")}
                  style={{
                    fontWeight: campaignSubTab === "calling_data" ? "bold" : "normal",
                    background: campaignSubTab === "calling_data" ? "#e2e8f0" : "#ffffff",
                  }}
                >
                  Calling Data
                </button>
                <button
                  type="button"
                  onClick={() => setCampaignSubTab("settings")}
                  style={{
                    fontWeight: campaignSubTab === "settings" ? "bold" : "normal",
                    background: campaignSubTab === "settings" ? "#e2e8f0" : "#ffffff",
                  }}
                >
                  Campaign Settings
                </button>
              </div>
            )}
          </div>

          {["super_admin", "tenant_admin"].includes(profile.role) && (
            <div style={{ marginBottom: 18, padding: 12, border: "1px solid #cbd5e1", borderRadius: 8 }}>
              <h4 style={{ marginTop: 0 }}>Create Active Campaign</h4>
              <form onSubmit={handleCreateProject} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input
                  placeholder="Campaign Name"
                  value={projectForm.name}
                  onChange={(e) => setProjectForm((f) => ({ ...f, name: e.target.value }))}
                  required
                />
                <input
                  placeholder="Description / Dates / Target"
                  value={projectForm.description}
                  onChange={(e) => setProjectForm((f) => ({ ...f, description: e.target.value }))}
                />
                <button type="submit">Create Campaign</button>
              </form>
            </div>
          )}

          {!selectedProjectId ? (
            <div style={{ padding: 16, border: "1px dashed #94a3b8", borderRadius: 8, color: "#475569" }}>
              Select an active campaign above to open its <strong>Calling Data</strong> and{" "}
              <strong>Campaign Settings</strong>.
            </div>
          ) : campaignSubTab === "settings" ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
                gap: 14,
              }}
            >
              <div style={{ padding: 14, border: "1px solid #cbd5e1", borderRadius: 8 }}>
                <h4 style={{ marginTop: 0 }}>
                  Project Dispositions — {activeCampaign?.name} ({dispositions.length})
                </h4>
                {["super_admin", "tenant_admin", "supervisor"].includes(profile.role) && (
                  <form
                    onSubmit={handleAddDisposition}
                    style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}
                  >
                    <input
                      placeholder="Disposition name (e.g. Interested)"
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
                    <button type="submit">Add Disposition</button>
                  </form>
                )}
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                  {dispositions.map((d) => (
                    <li key={d.id}>
                      <strong>{d.name}</strong> {d.requires_followup ? "(Requires Follow-Up)" : ""}
                    </li>
                  ))}
                  {dispositions.length === 0 && <li>No dispositions configured yet for this campaign.</li>}
                </ul>
              </div>

              <div style={{ padding: 14, border: "1px solid #cbd5e1", borderRadius: 8 }}>
                <h4 style={{ marginTop: 0 }}>
                  Project Call Fields / Parameters — {activeCampaign?.name} ({callFields.length})
                </h4>
                {["super_admin", "tenant_admin", "supervisor"].includes(profile.role) && (
                  <form
                    onSubmit={handleAddCallField}
                    style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}
                  >
                    <input
                      placeholder="Parameter label (e.g. City, Loan Type)"
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
                    <button type="submit">Add Field</button>
                  </form>
                )}
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                  {callFields.map((cf) => (
                    <li key={cf.id}>
                      <strong>{cf.label}</strong> <code>({cf.field_key})</code> — {cf.field_type}
                    </li>
                  ))}
                  {callFields.length === 0 && <li>No custom fields created yet for this campaign.</li>}
                </ul>
              </div>
            </div>
          ) : (
            <div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
                  gap: 12,
                  marginBottom: 18,
                }}
              >
                <div style={{ padding: 12, border: "1px solid #cbd5e1", borderRadius: 8 }}>
                  <h4 style={{ marginTop: 0 }}>Add Lead to {activeCampaign?.name}</h4>
                  <form onSubmit={handleAddSingleLead} style={{ display: "grid", gap: 8 }}>
                    <input
                      placeholder="Customer Name"
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
                    {callFields.map((cf) => (
                      <input
                        key={cf.id}
                        type={cf.field_type === "number" ? "number" : cf.field_type === "date" ? "date" : "text"}
                        placeholder={`${cf.label} (${cf.field_key})`}
                        value={leadForm.custom_fields[cf.field_key] || ""}
                        onChange={(e) => {
                          const val = e.target.value;
                          setLeadForm((f) => ({
                            ...f,
                            custom_fields: { ...f.custom_fields, [cf.field_key]: val },
                          }));
                        }}
                      />
                    ))}
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
                      rows={5}
                      value={csvText}
                      onChange={(e) => setCsvText(e.target.value)}
                      style={{ width: "100%", fontSize: 12 }}
                    />
                    <button type="submit">Upload CSV Leads</button>
                  </form>
                </div>
              </div>

              {/* Filter & Bulk Operations Bar */}
              <div
                style={{
                  padding: 12,
                  border: "1px solid #cbd5e1",
                  borderRadius: 8,
                  background: "#f8fafc",
                  marginBottom: 14,
                  display: "grid",
                  gap: 10,
                }}
              >
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <select
                    value={leadFilter.status}
                    onChange={(e) => setLeadFilter((f) => ({ ...f, status: e.target.value }))}
                  >
                    <option value="all">All Lead Statuses</option>
                    <option value="new">new</option>
                    <option value="contacted">contacted</option>
                    <option value="follow_up">follow_up</option>
                    <option value="converted">converted</option>
                    <option value="closed">closed</option>
                  </select>

                  <select
                    value={leadFilter.callKind}
                    onChange={(e) => setLeadFilter((f) => ({ ...f, callKind: e.target.value }))}
                  >
                    <option value="all">All Calls (Fresh + Follow-Up)</option>
                    <option value="fresh">Only Fresh Call</option>
                    <option value="followup">Only Follow-Up Call</option>
                    <option value="fresh_and_followup">Fresh & Follow-Up Call</option>
                  </select>

                  <select
                    value={leadFilter.disposition}
                    onChange={(e) => setLeadFilter((f) => ({ ...f, disposition: e.target.value }))}
                  >
                    <option value="all">All Dispositions</option>
                    <option value="__none__">No Disposition Yet</option>
                    {dispositions.map((d) => (
                      <option key={d.id} value={d.name}>
                        {d.name}
                      </option>
                    ))}
                  </select>

                  <select
                    value={leadFilter.paramKey}
                    onChange={(e) => setLeadFilter((f) => ({ ...f, paramKey: e.target.value }))}
                  >
                    <option value="">Parameter Filter (None)</option>
                    {paramOptions.map((po) => (
                      <option key={po.key} value={po.key}>
                        {po.label}
                      </option>
                    ))}
                  </select>

                  <input
                    placeholder="Parameter value (e.g. Mumbai)"
                    value={leadFilter.paramValue}
                    onChange={(e) => setLeadFilter((f) => ({ ...f, paramValue: e.target.value }))}
                    style={{ width: 170, padding: 5 }}
                  />

                  <input
                    placeholder="Search name, phone, notes..."
                    value={leadFilter.search}
                    onChange={(e) => setLeadFilter((f) => ({ ...f, search: e.target.value }))}
                    style={{ width: 190, padding: 5 }}
                  />
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ fontSize: 12, fontWeight: "bold" }}>
                    Bulk Actions on {filteredCallingLeads.length} filtered lead(s):
                  </span>
                  <input
                    type="datetime-local"
                    value={bulkFollowUpAt}
                    onChange={(e) => setBulkFollowUpAt(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={handleBulkSetFollowUp}
                    disabled={!bulkFollowUpAt || filteredCallingLeads.length === 0}
                  >
                    Bulk Set Follow-Up
                  </button>
                  <button
                    type="button"
                    onClick={handleBulkDeleteFilteredLeads}
                    disabled={filteredCallingLeads.length === 0}
                    style={{ color: "#991b1b" }}
                  >
                    Delete Filtered Leads
                  </button>
                </div>
              </div>

              <table border="1" cellPadding="8" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    <th>Customer Details</th>
                    <th>Phone</th>
                    <th>Project Parameters</th>
                    <th>Status</th>
                    <th>Last Disposition</th>
                    <th>Follow-Up</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCallingLeads.map((l) => {
                    const cf = getLeadCustomFields(l);
                    const paramEntries = Object.entries(cf).filter(([, v]) => v !== "" && v != null);
                    return (
                      <tr key={l.id}>
                        <td>
                          <strong>{l.name}</strong>
                          {l.email && <div style={{ fontSize: 11, color: "#64748b" }}>{l.email}</div>}
                          {l.notes && <div style={{ fontSize: 11, color: "#334155" }}>Note: {l.notes}</div>}
                        </td>
                        <td>{l.phone}</td>
                        <td>
                          {paramEntries.length > 0 ? (
                            paramEntries.map(([k, v]) => (
                              <div key={k} style={{ fontSize: 12 }}>
                                <code>{k}</code>: <strong>{String(v)}</strong>
                              </div>
                            ))
                          ) : (
                            <span style={{ color: "#94a3b8" }}>-</span>
                          )}
                        </td>
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
                            <option value="">-- None --</option>
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
                    );
                  })}
                  {filteredCallingLeads.length === 0 && (
                    <tr>
                      <td colSpan="6">No leads match the current filters.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
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

          {/* Step A: Calling Filter Bar */}
          <form
            onSubmit={handleApplyDialerQueue}
            style={{
              padding: 12,
              border: "1px solid #cbd5e1",
              borderRadius: 8,
              background: "#f8fafc",
              marginBottom: 16,
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <label style={{ fontSize: 12 }}>
              Campaign:{" "}
              <select
                value={dialerFilter.project_id}
                onChange={(e) => setDialerFilter((f) => ({ ...f, project_id: e.target.value }))}
              >
                <option value="">All Active Campaigns</option>
                {activeProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ fontSize: 12 }}>
              Call Queue:{" "}
              <select
                value={dialerFilter.callKind}
                onChange={(e) => setDialerFilter((f) => ({ ...f, callKind: e.target.value }))}
              >
                <option value="all">Fresh & Follow-Up</option>
                <option value="fresh">Only Fresh Call</option>
                <option value="followup">Only Follow-Up Call</option>
                <option value="fresh_and_followup">Fresh + Follow-Up Queue</option>
              </select>
            </label>

            <label style={{ fontSize: 12 }}>
              Lead Status:{" "}
              <select
                value={dialerFilter.status}
                onChange={(e) => setDialerFilter((f) => ({ ...f, status: e.target.value }))}
              >
                <option value="all">All Statuses</option>
                <option value="new">new</option>
                <option value="contacted">contacted</option>
                <option value="follow_up">follow_up</option>
                <option value="converted">converted</option>
                <option value="closed">closed</option>
              </select>
            </label>

            <label style={{ fontSize: 12 }}>
              Disposition:{" "}
              <select
                value={dialerFilter.disposition}
                onChange={(e) => setDialerFilter((f) => ({ ...f, disposition: e.target.value }))}
              >
                <option value="all">All Dispositions</option>
                <option value="__none__">No Disposition</option>
                {dispositions.map((d) => (
                  <option key={d.id} value={d.name}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>

            <select
              value={dialerFilter.paramKey}
              onChange={(e) => setDialerFilter((f) => ({ ...f, paramKey: e.target.value }))}
            >
              <option value="">Data Parameter Filter</option>
              {paramOptions.map((po) => (
                <option key={po.key} value={po.key}>
                  {po.label}
                </option>
              ))}
            </select>

            <input
              placeholder="Filter value (e.g. Mumbai)"
              value={dialerFilter.paramValue}
              onChange={(e) => setDialerFilter((f) => ({ ...f, paramValue: e.target.value }))}
              style={{ width: 150, padding: 5 }}
            />

            <button type="submit" style={{ fontWeight: "bold" }}>
              Apply Filter & Load Queue ({dialerQueueLeads.length})
            </button>
          </form>

          {/* Step B: Sequential Lead Card (Lead Info First -> Call Options -> Follow-Up & Fields -> Save & Next / Save & Stop / Cancel Call) */}
          <div style={{ padding: 14, border: "1px solid #cbd5e1", borderRadius: 8, marginBottom: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h4 style={{ margin: 0 }}>
                Active Calling Workspace{" "}
                {queueActive && dialerQueueLeads.length > 0
                  ? `(Lead ${queueIndex + 1} of ${dialerQueueLeads.length} in Queue)`
                  : "(Manual / Direct Call)"}
              </h4>
              {!queueActive && (
                <input
                  placeholder="Or type phone number directly..."
                  value={dialerForm.phone}
                  onChange={(e) => setDialerForm((prev) => ({ ...prev, phone: e.target.value }))}
                  style={{ width: 220, padding: 5 }}
                />
              )}
            </div>

            {/* 1. Lead Information First */}
            <div
              style={{
                padding: 10,
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: 6,
                marginBottom: 12,
                fontSize: 13,
              }}
            >
              <div>
                <strong>Lead:</strong> {currentQueueLead?.name || "Direct Number"}{" "}
                <span style={{ marginLeft: 12 }}>
                  <strong>Phone:</strong> {dialerForm.phone || "-"}
                </span>{" "}
                <span style={{ marginLeft: 12 }}>
                  <strong>Status:</strong> <code>{currentQueueLead?.status || "new"}</code>
                </span>{" "}
                <span style={{ marginLeft: 12 }}>
                  <strong>Last Disposition:</strong> {currentQueueLead?.disposition || "-"}
                </span>
              </div>
              <div style={{ marginTop: 4, fontSize: 12, color: "#475569" }}>
                <strong>Follow-Up:</strong>{" "}
                {currentQueueLead?.follow_up_at
                  ? new Date(currentQueueLead.follow_up_at).toLocaleString()
                  : "None"}{" "}
                |{" "}
                <strong>Parameters:</strong>{" "}
                {Object.entries(dialerForm.custom_fields || {})
                  .filter(([, v]) => v !== "" && v != null)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(", ") || "None"}
              </div>
            </div>

            {/* 2. Call Options */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
              <button type="button" onClick={handleStartCall} disabled={Boolean(dialerForm.callStartedAt)}>
                Start Call
              </button>
              <button type="button" onClick={handleEndCall} disabled={!dialerForm.callStartedAt}>
                End Call
              </button>
              <button type="button" onClick={handleCancelCall} style={{ color: "#991b1b" }}>
                Cancel Call
              </button>

              <label style={{ fontSize: 12, marginLeft: 8 }}>
                Call Status:{" "}
                <select
                  value={dialerForm.status}
                  onChange={(e) => setDialerForm((prev) => ({ ...prev, status: e.target.value }))}
                >
                  <option value="connected">connected</option>
                  <option value="completed">completed</option>
                  <option value="no_answer">no_answer</option>
                  <option value="busy">busy</option>
                </select>
              </label>

              <label style={{ fontSize: 12 }}>
                Duration (sec):{" "}
                <input
                  type="number"
                  min="0"
                  value={dialerForm.duration_seconds}
                  onChange={(e) => setDialerForm((prev) => ({ ...prev, duration_seconds: e.target.value }))}
                  style={{ width: 70 }}
                />
              </label>

              {dialerForm.callStartedAt && (
                <span style={{ fontSize: 12, color: "#166534", fontWeight: "bold" }}>
                  Call Active...
                </span>
              )}
            </div>

            {/* 3. Follow-Up, Disposition, Project Fields & Notes */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
                gap: 8,
                marginBottom: 14,
              }}
            >
              <label style={{ fontSize: 12 }}>
                Disposition:
                <select
                  value={dialerForm.disposition}
                  onChange={(e) => setDialerForm((prev) => ({ ...prev, disposition: e.target.value }))}
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

              <label style={{ fontSize: 12 }}>
                Follow-Up Date/Time:
                <input
                  type="datetime-local"
                  value={dialerForm.follow_up_at}
                  onChange={(e) => setDialerForm((prev) => ({ ...prev, follow_up_at: e.target.value }))}
                  style={{ width: "100%", marginTop: 2 }}
                />
              </label>

              {callFields.map((cf) => (
                <label key={cf.id} style={{ fontSize: 12 }}>
                  {cf.label}:
                  <input
                    type={cf.field_type === "number" ? "number" : cf.field_type === "date" ? "date" : "text"}
                    value={dialerForm.custom_fields[cf.field_key] || ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      setDialerForm((prev) => ({
                        ...prev,
                        custom_fields: { ...prev.custom_fields, [cf.field_key]: val },
                      }));
                    }}
                    style={{ width: "100%", marginTop: 2 }}
                  />
                </label>
              ))}

              <label style={{ fontSize: 12 }}>
                Call Notes:
                <input
                  placeholder="Summary or remarks"
                  value={dialerForm.notes}
                  onChange={(e) => setDialerForm((prev) => ({ ...prev, notes: e.target.value }))}
                  style={{ width: "100%", marginTop: 2 }}
                />
              </label>
            </div>

            {/* 4. Save & Next / Save & Stop */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => persistDialerCall({ moveToNext: true })}
                style={{ fontWeight: "bold", padding: "6px 12px" }}
              >
                Save & Next
              </button>
              <button
                type="button"
                onClick={() => persistDialerCall({ moveToNext: false })}
                style={{ padding: "6px 12px" }}
              >
                Save & Stop
              </button>
            </div>
          </div>

          {/* Step C: Paginated Call Logs (10 per page) with Expandable Row Details & Call Actions */}
          <div style={{ padding: 14, border: "1px solid #cbd5e1", borderRadius: 8 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 8,
                marginBottom: 10,
              }}
            >
              <h4 style={{ margin: 0 }}>
                Call Logs ({callLogs.length} total — Page {callLogPage} of {totalCallPages}, 10 per page)
              </h4>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <button
                  type="button"
                  disabled={callLogPage <= 1}
                  onClick={() => setCallLogPage((p) => Math.max(1, p - 1))}
                >
                  Prev 10
                </button>
                <span style={{ fontSize: 12 }}>
                  Page {callLogPage} / {totalCallPages}
                </span>
                <button
                  type="button"
                  disabled={callLogPage >= totalCallPages}
                  onClick={() => setCallLogPage((p) => Math.min(totalCallPages, p + 1))}
                >
                  Next 10
                </button>
              </div>
            </div>

            <table border="1" cellPadding="7" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr>
                  <th>Expand</th>
                  <th>Time</th>
                  <th>Phone</th>
                  <th>Status</th>
                  <th>Disposition</th>
                  <th>Duration</th>
                </tr>
              </thead>
              <tbody>
                {paginatedCallLogs.map((c) => {
                  const isOpen = Boolean(expandedCallIds[c.id]);
                  const cfEntries =
                    c.custom_fields && typeof c.custom_fields === "object"
                      ? Object.entries(c.custom_fields)
                      : [];
                  return (
                    <Fragment key={c.id}>
                      <tr>
                        <td>
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedCallIds((prev) => ({ ...prev, [c.id]: !prev[c.id] }))
                            }
                          >
                            {isOpen ? "Collapse" : "Expand"}
                          </button>
                        </td>
                        <td>{c.created_at ? new Date(c.created_at).toLocaleString() : "-"}</td>
                        <td>{c.phone}</td>
                        <td>{c.status}</td>
                        <td>{c.disposition || "-"}</td>
                        <td>{c.duration_seconds || 0}s</td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan="6" style={{ background: "#f8fafc" }}>
                            <div style={{ marginBottom: 6 }}>
                              <strong>Provider:</strong> {c.provider || "smartcall"} |{" "}
                              <strong>Call ID:</strong> <code>{c.external_call_id || c.id}</code> |{" "}
                              <strong>Notes:</strong> {c.notes || "-"}
                            </div>
                            <div style={{ marginBottom: 8 }}>
                              <strong>Custom Fields:</strong>{" "}
                              {cfEntries.length > 0
                                ? cfEntries.map(([k, v]) => `${k}: ${String(v)}`).join(" | ")
                                : "None"}
                            </div>
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              <button
                                type="button"
                                onClick={() => {
                                  setQueueActive(false);
                                  setDialerForm((prev) => ({
                                    ...prev,
                                    lead_id: c.lead_id || "",
                                    phone: c.phone || "",
                                    status: "connected",
                                    disposition: c.disposition || "",
                                    notes: c.notes || "",
                                    custom_fields:
                                      c.custom_fields && typeof c.custom_fields === "object"
                                        ? { ...c.custom_fields }
                                        : {},
                                    callStartedAt: new Date().toISOString(),
                                  }));
                                  setStatusMessage(`Started callback to ${c.phone}.`);
                                }}
                              >
                                Call Back Now
                              </button>
                              {c.lead_id && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleUpdateLead(c.lead_id, {
                                      status: "follow_up",
                                      follow_up_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                                    })
                                  }
                                >
                                  Schedule +24h Follow-Up
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {paginatedCallLogs.length === 0 && (
                  <tr>
                    <td colSpan="6">No call logs found.</td>
                  </tr>
                )}
              </tbody>
            </table>
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
