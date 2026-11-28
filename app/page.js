"use client";
import {
  downloadLeadCsvSample,
  buildIngestCurlSample,
} from "@/lib/leadSampleHelpers";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { safeJsonFetch } from "@/lib/crmHelpers";
import PortalHeader from "@/app/components/PortalHeader";
import TenantsSection from "@/app/components/TenantsSection";
import TeamSection from "@/app/components/TeamSection";
import CampaignsSection from "@/app/components/CampaignsSection";
import FollowUpsSection from "@/app/components/FollowUpsSection";
import DialerSection from "@/app/components/DialerSection";
import ReportsSection from "@/app/components/ReportsSection";
import TeamLicensesSection from "@/components/TeamLicensesSection";

const ROLE_ACCESS = {
  super_admin: [
    "Tenants & Licenses",
    "Reports",
    "Campaigns",
    "Follow-Ups",
    "Settings / Rules",
    "Dialer",
  ],
  admin: [
    "Reports",
    "Campaigns",
    "Follow-Ups",
    "Settings / Rules",
    "Team & Licenses",
  ],
  manager: [
    "Reports",
    "Campaigns",
    "Follow-Ups",
    "Settings / Rules",
  ],
  platform_ops: ["Tenants & Licenses", "Reports"],
  tenant_admin: [
    "Team & Licenses",
    "Reports",
    "Campaigns",
    "Follow-Ups",
    "Settings / Rules",
    "Dialer",
  ],
  supervisor: [
    "Reports",
    "Campaigns",
    "Follow-Ups",
    "Settings / Rules",
    "Dialer",
  ],
  team_leader: [
    "Reports",
    "Campaigns",
    "Follow-Ups",
    "Settings / Rules",
    "Dialer",
  ],
  agent: ["Campaigns", "Dialer", "Follow-Ups"],
};

const DEFAULT_LANDING_TAB = {
  super_admin: "Tenants & Licenses",
  admin: "Reports",
  manager: "Reports",
  platform_ops: "Tenants & Licenses",
  tenant_admin: "Team & Licenses",
  supervisor: "Reports",
  team_leader: "Reports",
  agent: "Campaigns",
};

const ARCHIVED_STATUSES = ["inactive", "archived", "closed", "completed", "disabled"];

function isArchivedStatus(status) {
  return ARCHIVED_STATUSES.includes(String(status || "active").toLowerCase());
}

function dedupeById(items = []) {
  const seen = new Set();
  const out = [];
  for (const item of items || []) {
    if (!item?.id || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

export default function HomePage() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [submittingLogin, setSubmittingLogin] = useState(false);

  const [activeTab, setActiveTab] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [dialLeadRequest, setDialLeadRequest] = useState(null);

  const [tenants, setTenants] = useState([]);
  const [selectedTenantScope, setSelectedTenantScope] = useState("");

  const [teamUsers, setTeamUsers] = useState([]);
  const [tenantLicenseHistory, setTenantLicenseHistory] = useState([]);
  const [licenseInfo, setLicenseInfo] = useState({
    used: 0,
    max: 0,
    remaining: 0,
    overCapacity: 0,
  });

  const [allProjects, setAllProjects] = useState([]);
  const [projectsCountAll, setProjectsCountAll] = useState(0);
  const [campaignMembers, setCampaignMembers] = useState([]);
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

  const selectedTenantScopeRef = useRef("");
  const selectedProjectIdRef = useRef("");
  const hydratedOnceRef = useRef(false);

  useEffect(() => {
    selectedTenantScopeRef.current = selectedTenantScope;
  }, [selectedTenantScope]);

  useEffect(() => {
    selectedProjectIdRef.current = selectedProjectId;
  }, [selectedProjectId]);

  const allowedTabs = useMemo(
    () =>
      profile?.role
        ? ROLE_ACCESS[profile.role] || ["Campaigns", "Dialer", "Follow-Ups"]
        : [],
    [profile?.role]
  );

  const assignedCampaignIdsForAgent = useMemo(() => {
    if (profile?.role !== "agent" || !profile?.id) return null;
    const ids = new Set(
      (campaignMembers || [])
        .filter((m) => m.user_id === profile.id)
        .map((m) => m.campaign_id)
    );
    for (const l of leads || []) {
      if (l.assigned_to === profile.id && l.project_id) {
        ids.add(l.project_id);
      }
    }
    return ids;
  }, [profile, campaignMembers, leads]);

  const activeProjects = useMemo(() => {
    const base = dedupeById(allProjects || []).filter((p) => !isArchivedStatus(p.status));

    if (profile?.role === "agent" && assignedCampaignIdsForAgent) {
      if (assignedCampaignIdsForAgent.size === 0 && (campaignMembers || []).length === 0) {
        return base;
      }
      return base.filter((p) => assignedCampaignIdsForAgent.has(p.id));
    }
    return base;
  }, [allProjects, profile, assignedCampaignIdsForAgent, campaignMembers]);

  const scopedLeads = useMemo(() => {
    const uniqueLeads = dedupeById(leads || []);
    if (profile?.role !== "agent" || !profile?.id) return uniqueLeads;
    const allowedIds = assignedCampaignIdsForAgent;
    return uniqueLeads.filter((l) => {
      if (l.assigned_to === profile.id) return true;
      if (allowedIds && allowedIds.size > 0 && l.project_id) {
        return allowedIds.has(l.project_id);
      }
      return true;
    });
  }, [leads, profile, assignedCampaignIdsForAgent]);

  const scopedCallLogs = useMemo(() => dedupeById(callLogs || []), [callLogs]);

  const licenseSummaryForSection = useMemo(
    () => ({
      total_seats: licenseInfo.max,
      used_seats: licenseInfo.used,
      available_seats: licenseInfo.remaining,
      over_capacity: licenseInfo.overCapacity,
    }),
    [licenseInfo]
  );

  const loadCampaignMembers = useCallback(async (token, currentProfile, tenantScope = "") => {
    if (!token) return;
    try {
      const params = new URLSearchParams();
      const targetTenant =
        currentProfile?.role === "super_admin" ? tenantScope : currentProfile?.tenant_id;
      if (targetTenant) params.set("tenant_id", targetTenant);
      const qs = params.toString() ? `?${params.toString()}` : "";

      const res = await safeJsonFetch(`/api/campaigns/members${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok && Array.isArray(res.data?.members)) {
        setCampaignMembers(dedupeById(res.data.members));
      }
    } catch {
      // Ignore if optional campaign_members endpoint is not present
    }
  }, []);

  const loadCampaignAndLeadsData = useCallback(
    async (token, currentProfile, projectId = "", tenantScope = "") => {
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
        setCallFields(dedupeById(cfgRes.data.call_fields || []));
        setDispositions(dedupeById(cfgRes.data.dispositions || []));
      }
      if (leadsRes.ok) setLeads(dedupeById(leadsRes.data.leads || []));
      if (callsRes.ok) setCallLogs(dedupeById(callsRes.data.calls || []));
      if (repRes.ok) {
        setReportData((prev) => ({
          summary: repRes.data.summary || prev.summary,
          dispositions: repRes.data.dispositions || {},
          lead_statuses: repRes.data.lead_statuses || {},
          recent_calls: dedupeById(repRes.data.recent_calls || []),
        }));
      }
    },
    []
  );

  const loadRoleData = useCallback(
    async (currentSession, currentProfile, overrideTenantScope = null, forceLandingTab = false) => {
      if (!currentSession?.access_token || !currentProfile?.role) return;
      const token = currentSession.access_token;
      const role = currentProfile.role;

      let tenantScope =
        overrideTenantScope !== null ? overrideTenantScope : selectedTenantScopeRef.current;

      const tabs = ROLE_ACCESS[role] || ["Campaigns", "Dialer", "Follow-Ups"];
      const landingTab = DEFAULT_LANDING_TAB[role] || tabs[0];
      setActiveTab((prev) =>
        !forceLandingTab && prev && tabs.includes(prev) ? prev : landingTab
      );

      let loadedTenants = [];
      if (["super_admin", "platform_ops"].includes(role)) {
        const tRes = await safeJsonFetch("/api/admin/tenants", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (tRes.ok) {
          loadedTenants = dedupeById(tRes.data.tenants || []);
          setTenants(loadedTenants);
          if (role === "super_admin" && !tenantScope && loadedTenants[0]?.id) {
            tenantScope = loadedTenants[0].id;
            selectedTenantScopeRef.current = tenantScope;
            setSelectedTenantScope(tenantScope);
          }
        }
      }

      await loadCampaignMembers(token, currentProfile, tenantScope);

      if (
        ["admin", "manager", "tenant_admin", "supervisor", "team_leader"].includes(role) &&
        currentProfile.tenant_id
      ) {
        const uRes = await safeJsonFetch("/api/tenant/users", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (uRes.ok) {
          const activeSeats = uRes.data.active_seats ?? uRes.data.tenant?.max_licenses ?? 0;
          const used = uRes.data.used_licenses ?? 0;
          setTeamUsers(dedupeById(uRes.data.users || []));
          setTenantLicenseHistory(dedupeById(uRes.data.license_periods || []));
          setLicenseInfo({
            used,
            max: activeSeats,
            remaining: Math.max(0, activeSeats - used),
            overCapacity: Math.max(0, used - activeSeats),
          });
        }
      }

      if (role !== "platform_ops") {
        const effectiveScope =
          tenantScope || (role === "super_admin" ? loadedTenants[0]?.id || "" : "");
        const pUrl =
          role === "super_admin" && effectiveScope
            ? `/api/projects?tenant_id=${encodeURIComponent(effectiveScope)}`
            : "/api/projects";
        const pRes = await safeJsonFetch(pUrl, { headers: { Authorization: `Bearer ${token}` } });
        if (pRes.ok) {
          const allProj = dedupeById(pRes.data.projects || []);
          setProjectsCountAll(allProj.length);
          setAllProjects(allProj);

          const onlyActive = allProj.filter((p) => !isArchivedStatus(p.status));
          const currentProj = selectedProjectIdRef.current;
          const activeProj =
            currentProj && allProj.some((p) => p.id === currentProj)
              ? currentProj
              : onlyActive[0]?.id || allProj[0]?.id || "";
          selectedProjectIdRef.current = activeProj;
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
          setReportData((prev) => ({
            summary: repRes.data.summary || prev.summary,
            dispositions: repRes.data.dispositions || {},
            lead_statuses: repRes.data.lead_statuses || {},
            recent_calls: dedupeById(repRes.data.recent_calls || []),
          }));
        }
      }
    },
    [loadCampaignAndLeadsData, loadCampaignMembers]
  );

  const hydrateSession = useCallback(
    async (forceLandingTab = false) => {
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
          setAuthError(
            seatCheck.data?.error || "Login blocked: no active seat license available."
          );
          return;
        }

        setSession(currentSession);
        setProfile(prof);
        await loadRoleData(currentSession, prof, null, forceLandingTab);
      } catch (err) {
        setStatusMessage(err?.message || "Failed to load session");
      } finally {
        setLoading(false);
      }
    },
    [loadRoleData]
  );

  useEffect(() => {
    if (!hydratedOnceRef.current) {
      hydratedOnceRef.current = true;
      hydrateSession(true);
    }

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!nextSession?.user) {
        hydratedOnceRef.current = false;
        setSession(null);
        setProfile(null);
        setActiveTab("");
        setLoading(false);
      }
    });
    return () => listener?.subscription?.unsubscribe();
  }, [hydrateSession]);

  async function handleLogin(e) {
    e.preventDefault();
    setAuthError("");
    setStatusMessage("");
    setSubmittingLogin(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) {
        setAuthError(error.message);
        return;
      }
      hydratedOnceRef.current = true;
      await hydrateSession(true);
    } finally {
      setSubmittingLogin(false);
    }
  }

  if (loading) {
    return (
      <div style={{ padding: 24, fontFamily: "system-ui, -apple-system, sans-serif" }}>
        Loading workspace...
      </div>
    );
  }

  if (!session || !profile) {
    return (
      <div
        style={{
          maxWidth: 400,
          margin: "64px auto",
          padding: 24,
          border: "1px solid #cbd5e1",
          borderRadius: 10,
          background: "#ffffff",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        <h2 style={{ marginTop: 0 }}>📞 S2C Telecalling CRM</h2>
        <form onSubmit={handleLogin} style={{ display: "grid", gap: 12 }}>
          <input
            type="email"
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid #cbd5e1" }}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid #cbd5e1" }}
          />
          <button
            type="submit"
            disabled={submittingLogin}
            style={{
              padding: "9px 14px",
              borderRadius: 6,
              border: "1px solid #1d4ed8",
              background: "#2563eb",
              color: "#ffffff",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {submittingLogin ? "Signing In..." : "Sign In"}
          </button>
        </form>
        {authError && <p style={{ color: "#b91c1c", marginTop: 12, fontSize: 13 }}>{authError}</p>}
        {statusMessage && (
          <p style={{ color: "#b91c1c", marginTop: 12, fontSize: 13 }}>{statusMessage}</p>
        )}
      </div>
    );
  }

  const isCampaignTab = ["Campaigns", "Settings / Rules"].includes(activeTab);
  const isDialerTab = activeTab === "Dialer";

  return (
    <div
      style={{
        maxWidth: 1240,
        margin: "24px auto",
        padding: 16,
        fontFamily: "system-ui, -apple-system, sans-serif",
        color: "#0f172a",
      }}
    >
      <PortalHeader
        profile={profile}
        tabs={allowedTabs}
        activeTab={activeTab}
        onSelectTab={(tab) => {
          setStatusMessage("");
          setActiveTab(tab);
        }}
        onSignedOut={() => {
          hydratedOnceRef.current = false;
          setSession(null);
          setProfile(null);
          setActiveTab("");
        }}
      />

      {statusMessage && (
        <div
          style={{
            padding: "10px 14px",
            marginBottom: 16,
            borderRadius: 8,
            background: "#f1f5f9",
            border: "1px solid #cbd5e1",
            fontSize: 13,
            fontWeight: 600,
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

      {activeTab === "Team & Licenses" &&
        ["admin", "tenant_admin"].includes(profile.role) && (
          <div style={{ display: "grid", gap: 16 }}>
            <TeamLicensesSection
              session={session}
              profile={profile}
              selectedTenantScope={selectedTenantScope}
              teamUsers={teamUsers}
              licenseSummary={licenseSummaryForSection}
              licenseHistory={tenantLicenseHistory}
              onReload={() => loadRoleData(session, profile)}
              onNotify={setStatusMessage}
            />
            <TeamSection
              session={session}
              profile={profile}
              teamUsers={teamUsers}
              licenseInfo={licenseInfo}
              tenantLicenseHistory={tenantLicenseHistory}
              onReload={() => loadRoleData(session, profile)}
              onNotify={setStatusMessage}
            />
          </div>
        )}

      {isCampaignTab && (
        <CampaignsSection
          session={session}
          profile={profile}
          tenants={tenants}
          teamUsers={teamUsers}
          campaignMembers={campaignMembers}
          selectedTenantScope={selectedTenantScope}
          onChangeTenantScope={async (nextTenant) => {
            selectedTenantScopeRef.current = nextTenant;
            setSelectedTenantScope(nextTenant);
            await loadRoleData(session, profile, nextTenant);
          }}
          activeProjects={activeProjects}
          allProjects={allProjects}
          selectedProjectId={selectedProjectId}
          onSelectProject={async (nextProj) => {
            selectedProjectIdRef.current = nextProj;
            setSelectedProjectId(nextProj);
            await loadCampaignAndLeadsData(
              session.access_token,
              profile,
              nextProj,
              profile.role === "super_admin" ? selectedTenantScopeRef.current : ""
            );
          }}
          projectsCountAll={projectsCountAll}
          callFields={callFields}
          dispositions={dispositions}
          leads={scopedLeads}
          callLogs={scopedCallLogs}
          onReloadAll={() => loadRoleData(session, profile)}
          onNotify={setStatusMessage}
          onDialLead={(lead) => {
            setDialLeadRequest(lead);
            setActiveTab("Dialer");
          }}
          downloadLeadCsvSample={downloadLeadCsvSample}
          buildIngestCurlSample={buildIngestCurlSample}
        />
      )}

      {activeTab === "Follow-Ups" && (
        <FollowUpsSection
          session={session}
          profile={profile}
          selectedTenantScope={selectedTenantScope}
          activeProjects={activeProjects}
          teamUsers={teamUsers}
          leads={scopedLeads}
          dispositions={dispositions}
          onReload={() => loadRoleData(session, profile)}
          onNotify={setStatusMessage}
          onDialLead={(lead) => {
            setDialLeadRequest(lead);
            setActiveTab("Dialer");
          }}
        />
      )}

      {isDialerTab && (
        <DialerSection
          session={session}
          profile={profile}
          selectedTenantScope={selectedTenantScope}
          activeProjects={activeProjects}
          selectedProjectId={selectedProjectId}
          teamUsers={teamUsers}
          leads={scopedLeads}
          callFields={callFields}
          dispositions={dispositions}
          callLogs={scopedCallLogs}
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
