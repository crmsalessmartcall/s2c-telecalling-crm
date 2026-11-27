"use client";

import { useMemo, useState } from "react";
import { safeJsonFetch } from "@/lib/crmHelpers";

export default function CampaignMembersTab({
  session,
  profile,
  selectedTenantScope,
  campaign,
  teamUsers = [],
  assignedMemberIds = new Set(),
  pendingCallLeads = [],
  canManageCampaign,
  onReloadAll,
  onNotify,
  onLocalMemberChange,
}) {
  const [search, setSearch] = useState("");
  const [savingUserId, setSavingUserId] = useState(null);
  const [distributing, setDistributing] = useState(false);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = Array.isArray(teamUsers) ? teamUsers : [];
    if (!q) return list;
    return list.filter(
      (u) =>
        String(u.full_name || "").toLowerCase().includes(q) ||
        String(u.email || "").toLowerCase().includes(q) ||
        String(u.role || "").toLowerCase().includes(q)
    );
  }, [teamUsers, search]);

  async function handleToggleMember(user, currentlyAssigned) {
    if (!campaign?.id || !user?.id) return;
    setSavingUserId(user.id);
    const nextAssigned = !currentlyAssigned;
    try {
      if (session?.access_token) {
        await safeJsonFetch("/api/campaigns/members", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            campaign_id: campaign.id,
            user_id: user.id,
            action: nextAssigned ? "add" : "remove",
            tenant_id: profile?.role === "super_admin" ? selectedTenantScope || undefined : undefined,
          }),
        });
      }

      onLocalMemberChange?.(user.id, nextAssigned);
      onNotify?.(
        nextAssigned
          ? `Added ${user.full_name || user.email} to "${campaign.name}".`
          : `Removed ${user.full_name || user.email} from "${campaign.name}".`
      );
      await onReloadAll?.();
    } finally {
      setSavingUserId(null);
    }
  }

  async function handleDistributeLeads() {
    if (!session?.access_token || !campaign?.id) return;
    const memberIds = Array.from(assignedMemberIds);
    if (memberIds.length === 0) {
      onNotify?.("Select at least one member for this campaign first.");
      return;
    }
    if (pendingCallLeads.length === 0) {
      onNotify?.("No pending leads in this campaign to distribute.");
      return;
    }

    setDistributing(true);
    try {
      let count = 0;
      for (let i = 0; i < pendingCallLeads.length; i += 1) {
        const assigneeId = memberIds[i % memberIds.length];
        const res = await safeJsonFetch("/api/leads", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            lead_id: pendingCallLeads[i].id,
            assigned_to: assigneeId,
          }),
        });
        if (res.ok) count += 1;
      }
      onNotify?.(`Allocated ${count} pending lead(s) across ${memberIds.length} member(s).`);
      await onReloadAll?.();
    } finally {
      setDistributing(false);
    }
  }

  return (
    <div
      style={{
        padding: 16,
        border: "1px solid #cbd5e1",
        borderRadius: 10,
        background: "#ffffff",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 10,
          marginBottom: 14,
        }}
      >
        <div>
          <h4 style={{ margin: 0 }}>
            Members ({assignedMemberIds.size} of {(teamUsers || []).length} users mapped to{" "}
            {campaign.name})
          </h4>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
            Search and map specific team members into this campaign.
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            placeholder="Search name, email, role..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              padding: "6px 10px",
              borderRadius: 6,
              border: "1px solid #cbd5e1",
              minWidth: 220,
            }}
          />
          {canManageCampaign && (
            <button
              type="button"
              disabled={distributing || assignedMemberIds.size === 0}
              onClick={handleDistributeLeads}
              style={{ padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontWeight: 600 }}
            >
              {distributing ? "Allocating..." : "Distribute Pending Leads"}
            </button>
          )}
        </div>
      </div>

      <table border="1" cellPadding="8" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: "#f8fafc" }}>
            <th>User</th>
            <th>Email</th>
            <th>Role</th>
            <th>Status</th>
            <th>Map to Campaign</th>
          </tr>
        </thead>
        <tbody>
          {filteredUsers.map((u) => {
            const isAssigned = assignedMemberIds.has(u.id);
            return (
              <tr key={u.id} style={{ background: isAssigned ? "#f0fdf4" : "#ffffff" }}>
                <td><strong>{u.full_name || u.email}</strong></td>
                <td>{u.email}</td>
                <td><code>{u.role}</code></td>
                <td>{isAssigned ? "In Campaign" : "Not Assigned"}</td>
                <td>
                  <button
                    type="button"
                    disabled={!canManageCampaign || savingUserId === u.id}
                    onClick={() => handleToggleMember(u, isAssigned)}
                    style={{
                      padding: "5px 10px",
                      borderRadius: 6,
                      border: "1px solid #cbd5e1",
                      background: isAssigned ? "#ffffff" : "#2563eb",
                      color: isAssigned ? "#0f172a" : "#ffffff",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {savingUserId === u.id
                      ? "Saving..."
                      : isAssigned
                      ? "Remove"
                      : "+ Add to Campaign"}
                  </button>
                </td>
              </tr>
            );
          })}
          {filteredUsers.length === 0 && (
            <tr>
              <td colSpan="5">No users match your search.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
