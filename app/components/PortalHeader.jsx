"use client";

import { supabase } from "@/lib/supabaseClient";

export default function PortalHeader({
  profile,
  tabs = [],
  activeTab,
  onSelectTab,
  onSignedOut,
}) {
  async function handleLogout() {
    await supabase.auth.signOut();
    if (onSignedOut) {
      onSignedOut();
    } else if (typeof window !== "undefined") {
      window.location.reload();
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
        paddingBottom: 12,
        marginBottom: 18,
        borderBottom: "1px solid #cbd5e1",
      }}
    >
      <nav style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {tabs.map((tab) => {
          const isActive = activeTab === tab;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => onSelectTab(tab)}
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                border: "1px solid #94a3b8",
                cursor: "pointer",
                fontWeight: isActive ? "bold" : "normal",
                background: isActive ? "#e2e8f0" : "#ffffff",
                color: "#0f172a",
              }}
            >
              {tab}
            </button>
          );
        })}
      </nav>

      <div style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 13 }}>
        <span>
          <strong>{profile?.full_name || profile?.email || "User"}</strong>{" "}
          (<code>{profile?.role || "member"}</code>)
        </span>
        <button
          type="button"
          onClick={handleLogout}
          style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #94a3b8", cursor: "pointer" }}
        >
          Logout
        </button>
      </div>
    </header>
  );
}
