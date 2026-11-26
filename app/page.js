"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { safeJsonFetch } from "@/lib/crmHelpers";
import PortalHeader from "@/app/components/PortalHeader";
import TenantsSection from "@/app/components/TenantsSection";
import TeamSection from "@/app/components/TeamSection";
import CampaignsSection from "@/app/components/CampaignsSection";
import FollowUpsSection from "@/app/components/FollowUpsSection";
import DialerSection from "@/app/components/DialerSection";
import ReportsSection from "@/app/components/ReportsSection";

const ROLE_ACCESS = {
  super_admin: ["Tenants & Licenses", "Campaigns & Leads", "Dialer", "Follow-Ups", "Reports"],
  platform_ops: ["Tenants & Licenses", "Reports"],
  tenant_admin: ["Team & Licenses", "Campaigns & Leads", "Dialer", "Follow-Ups", "Reports"],
  supervisor: ["Campaigns & Leads", "Dialer", "Follow-Ups", "Reports"],
  team_leader: ["Campaigns & Leads", "Dialer", "Follow-Ups", "Reports"],
  agent: ["Dialer", "Campaigns & Leads", "Follow-Ups"],
};

export default function HomePage() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");

  const [activeTab, setActiveTab] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [dialLeadRequest, setDialLeadRequest] = useState(null);

  const [tenants, setTenants] = useState([]);
  const [selectedTenantScope, setSelectedTenantScope] = useState("");

  const [teamUsers, setTeamUsers] = useState([]);
  const [tenantLicenseHistory, setTenantLicenseHistory] = useState([]);
  const [licenseInfo, setLicenseInfo] = useState({ used: 0, max: 0, remaining: 0, overCapacity: 0 });

  const [projects, setProjects] = useState([]);
  const [projectsCountAll, setProjectsCountAll] = useState(0);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [callFields, setCallFields] = useState([]);
  const [dispositions, setDispositions] = useState([]);
  const [leads, setLeads] = useState([]);
  const [callLogs, setCallLogs] = useState([]);

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

  const activeProjects = useMemo(
    () =>
      (projects || []).filter((p) => {
        const st = String(p.status || "active").toLowerCase();
        return !["inactive", "archived", "closed", "completed", "disabled"].includes(st);
      }),
    [projects]
  );

  async function loadCampaignAndLeadsData(token, currentProfile, projectId = "", tenantScope = "") {
    const params = new URLSearchParams();
    if (projectId) params.set("project_id", projectId);
    if (currentProfile.role === "super_admin" && tenantScope) {
      params.set("tenant_id", tenantScope);
    }
    const qs = params.toString() ? `?${params.toString()}` : "";

    const [cfgRes, leadsRes, callsRes, repRes] = await Promise.all([
      safeJsonFetch(`/api/call-config${qs}`, { headers: { Authorization: `Bearer ${token}` } }),
      safeJsonFetch(`/api/leads${qs}`, { headers: { Authorization: `Bearer ${token}` } }),
      safeJsonFetch(`/api/calls${qs}`, { headers: { Authorization: `Bearer ${token}` } }),
      safeJsonFetch(`/api/reports${qs}`, { headers: { Authorization: `Bearer ${token}` } }),
    ]);

    if (cfgRes.ok) {
      setCallFields(cfgRes.data.call_fields || []);
      setDispositions(cfgRes.data.dispositions || []);
    }
    if (leadsRes.ok) setLeads(leadsRes.data.leads || []);
    if (callsRes.ok) setCallLogs(callsRes.data.calls || []);
    if (repRes.ok) {
      setReportData({
        summary: repRes.data.summary || reportData.summary,
        dispositions: repRes.data.dispositions || {},
        lead_statuses: repRes.data.lead_statuses || {},
        recent_calls: repRes.data.recent_calls || [],
      });
    }
  }

  async function loadRoleData(currentSession, currentProfile, overrideTenantScope = null) {
    if (!currentSession?.access_token || !currentProfile?.role) return;
    const token = currentSession.access_token;
    const role = currentProfile.role;
    const tenantScope = overrideTenantScope !== null ? overrideTenantScope : selectedTenantScope;

    const tabs = ROLE_ACCESS[role] || ["Dialer"];
    setActiveTab((prev) => (tabs.includes(prev) ? prev : tabs[0]));

    if (["super_admin", "platform_ops"].includes(role)) {
      const tRes = await safeJsonFetch("/api/admin/tenants", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (tRes.ok) {
        const list = tRes.data.tenants || [];
        setTenants(list);
        if (role === "super_admin" && !tenantScope && list[0]?.id) {
          setSelectedTenantScope(list[0].id);
        }
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
      const effectiveScope = tenantScope || (role === "super_admin" ? tenants[0]?.id || "" : "");
      const pUrl =
        role === "super_admin" && effectiveScope
          ? `/api/projects?tenant_id=${encodeURIComponent(effectiveScope)}`
          : "/api/projects";
      const pRes = await safeJsonFetch(pUrl, { headers: { Authorization: `Bearer ${token}` } });
      if (pRes.ok) {
        const allProj = pRes.data.projects || [];
        setProjectsCountAll(allProj.length);
        const onlyActive = allProj.filter((p) => {
          const st = String(p.status || "active").toLowerCase();
          return !["inactive", "archived", "closed", "completed", "disabled"].includes(st);
        });
        setProjects(onlyActive);
        const activeProj =
          selectedProjectId && onlyActive.some((p) => p.id === selectedProjectId)
            ? selectedProjectId
            : onlyActive[0]?.id || "";
        setSelectedProjectId(activeProj);
        await loadCampaignAndLeadsData(
          token,
          currentProfile,
          activeProj,
          role === "super_admin" ? effectiveScope : ""
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
        setStatusMessage(error?.message || "Profile not found.");
        return;
      }

      const seatCheck = await safeJsonFetch("/api/auth/check-seat", {
        headers: { Authorization: `Bearer ${currentSession.access_token}` },
      });

      if (!seatCheck.ok || seatCheck.data?.allowed === false) {
        await supabase.auth.signOut();
        setSession(null);
        setProfile(null);
        setAuthError(seatCheck.data?.error || "Login blocked: no active seat license available.");
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
    return () => listener?.subscription?.unsubscribe();
  }, []);

  async function handleLogin(e) {
    e.preventDefault();
    setAuthError("");
    setStatusMessage("");
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      setAuthError(error.message);
      return;
    }
    await hydrateSession();
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
          <TenantsSection
            session={session}
            profile={profile}
            tenants={tenants}
            onReload={() => loadRoleData(session, profile)}
            onNotify={setStatusMessage}
          />
        )}

      {activeTab === "Team & Licenses" && profile.role === "tenant_admin" && (
        <TeamSection
          session={session}
          profile={profile}
          teamUsers={teamUsers}
          licenseInfo={licenseInfo}
          tenantLicenseHistory={tenantLicenseHistory}
          onReload={() => loadRoleData(session, profile)}
          onNotify={setStatusMessage}
        />
      )}

      {activeTab === "Campaigns & Leads" && (
        <CampaignsSection
          session={session}
          profile={profile}
          tenants={tenants}
          selectedTenantScope={selectedTenantScope}
          onChangeTenantScope={async (nextTenant) => {
            setSelectedTenantScope(nextTenant);
            await loadRoleData(session, profile, nextTenant);
          }}
          activeProjects={activeProjects}
          selectedProjectId={selectedProjectId}
          onSelectProject={async (nextProj) => {
            setSelectedProjectId(nextProj);
            await loadCampaignAndLeadsData(
              session.access_token,
              profile,
              nextProj,
              profile.role === "super_admin" ? selectedTenantScope : ""
            );
          }}
          projectsCountAll={projectsCountAll}
          callFields={callFields}
          dispositions={dispositions}
          leads={leads}
          onReloadAll={() => loadRoleData(session, profile)}
          onNotify={setStatusMessage}
        />
      )}

      {activeTab === "Follow-Ups" && (
        <FollowUpsSection
          session={session}
          profile={profile}
          selectedTenantScope={selectedTenantScope}
          activeProjects={activeProjects}
          leads={leads}
          dispositions={dispositions}
          onReload={() => loadRoleData(session, profile)}
          onNotify={setStatusMessage}
          onDialLead={(lead) => {
            setDialLeadRequest(lead);
            setActiveTab("Dialer");
          }}
        />
      )}

      {activeTab === "Dialer" && (
        <DialerSection
          session={session}
          profile={profile}
          selectedTenantScope={selectedTenantScope}
          activeProjects={activeProjects}
          selectedProjectId={selectedProjectId}
          leads={leads}
          callFields={callFields}
          dispositions={dispositions}
          callLogs={callLogs}
          initialDialLead={dialLeadRequest}
          onClearInitialDialLead={() => setDialLeadRequest(null)}
          onReload={() => loadRoleData(session, profile)}
          onNotify={setStatusMessage}
        />
      )}

      {activeTab === "Reports" && <ReportsSection reportData={reportData} />}
    </div>
  );
}
