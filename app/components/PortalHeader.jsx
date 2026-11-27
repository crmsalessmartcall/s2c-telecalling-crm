"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";

const ROLE_META = {
  super_admin: {
    label: "Super Admin",
    badgeBg: "#ede9fe",
    badgeColor: "#5b21b6",
    badgeBorder: "#c4b5fd",
    icon: "🛡️",
  },
  platform_ops: {
    label: "Platform Ops",
    badgeBg: "#e0f2fe",
    badgeColor: "#075985",
    badgeBorder: "#7dd3fc",
    icon: "⚙️",
  },
  admin: {
    label: "Admin",
    badgeBg: "#dbeafe",
    badgeColor: "#1e40af",
    badgeBorder: "#93c5fd",
    icon: "🧭",
  },
  tenant_admin: {
    label: "Tenant Admin",
    badgeBg: "#dbeafe",
    badgeColor: "#1e40af",
    badgeBorder: "#93c5fd",
    icon: "🏢",
  },
  manager: {
    label: "Manager",
    badgeBg: "#fef3c7",
    badgeColor: "#92400e",
    badgeBorder: "#fcd34d",
    icon: "📊",
  },
  supervisor: {
    label: "Supervisor",
    badgeBg: "#fef3c7",
    badgeColor: "#92400e",
    badgeBorder: "#fcd34d",
    icon: "👁️",
  },
  team_leader: {
    label: "Team Leader",
    badgeBg: "#fef3c7",
    badgeColor: "#92400e",
    badgeBorder: "#fcd34d",
    icon: "👥",
  },
  agent: {
    label: "Telecaller",
    badgeBg: "#dcfce7",
    badgeColor: "#166534",
    badgeBorder: "#86efac",
    icon: "🎧",
  },
};

const TAB_ICONS = {
  "Tenants & Licenses": "🏢",
  "Team & Licenses": "👥",
  Reports: "📈",
  Campaigns: "📋",
  "Follow-Ups": "⏰",
  "Settings / Rules": "🎛️",
  Dialer: "📞",
};

export default function PortalHeader({
  profile,
  tabs,
  activeTab,
  onSelectTab,
  onSignedOut,
}) {
  const [signingOut, setSigningOut] = useState(false);
  const roleKey = profile?.role || "agent";
  const meta = ROLE_META[roleKey] || ROLE_META.agent;

  async function handleLogout() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await supabase.auth.signOut();
      onSignedOut?.();
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <header
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        gap: 14,
        flexWrap: "wrap",
        padding: 16,
        marginBottom: 18,
        borderRadius: 12,
        background: "linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)",
        border: "1px solid #cbd5e1",
        boxShadow: "0 1px 3px rgba(15, 23, 42, 0.05)",
      }}
    >
      <div style={{ flex: "1 1 640px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 10px",
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 700,
              background: meta.badgeBg,
              color: meta.badgeColor,
              border: `1px solid ${meta.badgeBorder}`,
            }}
          >
            <span>{meta.icon}</span>
            <span>{meta.label}</span>
          </span>

          <span style={{ fontSize: 17, fontWeight: 700, color: "#0f172a" }}>
            {profile?.full_name || profile?.email || "User"}
          </span>

          {profile?.email && (
            <span style={{ fontSize: 12, color: "#64748b" }}>({profile.email})</span>
          )}
        </div>

        <nav style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          {(tabs || []).map((tab) => {
            const isActive = activeTab === tab;
            const icon = TAB_ICONS[tab] || "•";
            return (
              <button
                key={tab}
                type="button"
                onClick={() => onSelectTab?.(tab)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "8px 14px",
                  borderRadius: 8,
                  border: isActive ? "1px solid #0f172a" : "1px solid #cbd5e1",
                  background: isActive ? "#0f172a" : "#ffffff",
                  color: isActive ? "#ffffff" : "#1e293b",
                  fontWeight: isActive ? 700 : 500,
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                <span>{icon}</span>
                <span>{tab}</span>
              </button>
            );
          })}
        </nav>
      </div>

      <button
        type="button"
        onClick={handleLogout}
        disabled={signingOut}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "8px 14px",
          borderRadius: 8,
          border: "1px solid #fecaca",
          background: "#fff5f5",
          color: "#991b1b",
          fontWeight: 600,
          fontSize: 13,
          cursor: "pointer",
        }}
      >
        <span>🚪</span>
        <span>{signingOut ? "Signing out..." : "Logout"}</span>
      </button>
    </header>
  );
}
