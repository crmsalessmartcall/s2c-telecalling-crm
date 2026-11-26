"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function PortalHeader({
  profile,
  tabs,
  activeTab,
  onSelectTab,
  onSignedOut,
}) {
  const [signingOut, setSigningOut] = useState(false);

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
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
        paddingBottom: 14,
        marginBottom: 18,
        borderBottom: "1px solid #cbd5e1",
      }}
    >
      <div>
        <div style={{ fontSize: 16, fontWeight: "bold" }}>
          {profile?.full_name || profile?.email || "User"}{" "}
          <span style={{ fontWeight: "normal", color: "#475569" }}>— Role:</span>{" "}
          <code>{profile?.role || "agent"}</code>
        </div>
        {profile?.email && (
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
            {profile.email}
          </div>
        )}

        <nav style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          {(tabs || []).map((tab) => {
            const isActive = activeTab === tab;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => onSelectTab?.(tab)}
                style={{
                  padding: "6px 12px",
                  borderRadius: 6,
                  border: "1px solid #94a3b8",
                  background: isActive ? "#0f172a" : "#ffffff",
                  color: isActive ? "#ffffff" : "#0f172a",
                  fontWeight: isActive ? "bold" : "normal",
                  cursor: "pointer",
                }}
              >
                {tab}
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
          padding: "7px 14px",
          borderRadius: 6,
          border: "1px solid #cbd5e1",
          background: "#ffffff",
          cursor: "pointer",
        }}
      >
        {signingOut ? "Signing out..." : "Logout"}
      </button>
    </header>
  );
}
