"use client";

import { useEffect, useState } from "react";
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

  // Point 1 placeholder state for each isolated tab
  const [tenants, setTenants] = useState([]);
  const [teamUsers, setTeamUsers] = useState([]);
  const [licenseInfo, setLicenseInfo] = useState({ used: 0, max: 0 });
  const [projects, setProjects] = useState([]);

  const allowedTabs = profile?.role
    ? ROLE_ACCESS[profile.role] || ["Dialer"]
    : [];

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

  if (loading) {
    return (
      <div style={{ padding: 24, fontFamily: "sans-serif" }}>
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
            <h3>Tenants & Licenses ({tenants.length})</h3>
            <p style={{ color: "#475569", fontSize: 13 }}>
              Dedicated tenant, seat-window, and audit view (ready for Point 2).
            </p>
          </section>
        )}

      {activeTab === "Team & Licenses" && profile.role === "tenant_admin" && (
        <section>
          <h3>
            Team & Licenses — {licenseInfo.used} / {licenseInfo.max} seats used ({teamUsers.length} users)
          </h3>
          <p style={{ color: "#475569", fontSize: 13 }}>
            Dedicated team user and seat-release view (ready for Point 3).
          </p>
        </section>
      )}

      {activeTab === "Campaigns & Leads" && (
        <section>
          <h3>Campaigns & Leads ({projects.length} campaigns)</h3>
          <p style={{ color: "#475569", fontSize: 13 }}>
            Dedicated campaign and lead view (ready for Point 4).
          </p>
        </section>
      )}

      {activeTab === "Dialer" && (
        <section>
          <h3>Dialer Console</h3>
          <p style={{ color: "#475569", fontSize: 13 }}>
            Shown only on the Dialer tab—never across all tabs (ready for Point 5).
          </p>
        </section>
      )}

      {activeTab === "Follow-Ups" && (
        <section>
          <h3>Follow-Ups</h3>
          <p style={{ color: "#475569", fontSize: 13 }}>
            Scheduled callbacks and reminders view.
          </p>
        </section>
      )}

      {activeTab === "Reports" && (
        <section>
          <h3>Reports</h3>
          <p style={{ color: "#475569", fontSize: 13 }}>
            Call activity and performance reporting view.
          </p>
        </section>
      )}
    </div>
  );
}
