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
  campaignLeads = [],
  pendingCallLeads = [],
  canManageCampaign,
  onReloadAll,
  onNotify,
  onLocalMemberChange,
  onPatchLeads,
}) {
  const [search, setSearch] = useState("");
  const [savingUserId, setSavingUserId] = useState(null);
  const [distributing, setDistributing] = useState(false);
  const [transferTargetByUser, setTransferTargetByUser] = useState({});

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

  async function handleRemoveOrToggleMember(user, currentlyAssigned) {
    if (!campaign?.id || !user?.id) return;

    if (currentlyAssigned) {
      const userAssignedLeads = (campaignLeads || []).filter((l) => l.assigned_to === user.id);
      const transferTo = transferTargetByUser[user.id] || "";

      if (userAssignedLeads.length > 0 && !transferTo) {
        onNotify?.(
          `Cannot remove ${user.full_name || user.email}: ${
            userAssignedLeads.length
          } lead(s) are assigned to them. Select another user to transfer leads to first.`
        );
        return;
      }

      if (userAssignedLeads.length > 0 && transferTo) {
        const leadIds = userAssignedLeads.map((l) => l.id);
        onPatchLeads?.(leadIds, { assigned_to: transferTo });
        if (session?.access_token) {
          await safeJsonFetch("/api/leads", {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              lead_ids: leadIds,
              assigned_to: transferTo,
            }),
          });
        }
      }
    }

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

  // Equal distribution of pending leads across selected campaign members (e.g., 10 leads / 2 users = 5 each)
  async function handleDistributePendingLeads() {
    const memberIds = Array.from(assignedMemberIds);
    if (memberIds.length === 0) {
      onNotify?.("Select at least one member in this campaign to distribute pending leads.");
      return;
    }
    if (pendingCallLeads.length === 0) {
      onNotify?.("No pending leads available to distribute.");
      return;
    }

    setDistributing(true);
    try {
      const perMemberCounts = new Map(memberIds.map((id) => [id, 0]));
      for (let i = 0; i < pendingCallLeads.length; i += 1) {
        const assigneeId = memberIds[i % memberIds.length];
        const lead = pendingCallLeads[i];
        perMemberCounts.set(assigneeId, (perMemberCounts.get(assigneeId) || 0) + 1);
        onPatchLeads?.(lead.id, { assigned_to: assigneeId });

        if (session?.access_token) {
          await safeJsonFetch("/api/leads", {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              lead_id: lead.id,
              assigned_to: assigneeId,
            }),
          });
        }
      }

      const breakdown = memberIds
        .map((id) => {
          const u = (teamUsers || []).find((x) => x.id === id);
          return `${u?.full_name || u?.email || id}: ${perMemberCounts.get(id) || 0}`;
        })
        .join(", ");

      onNotify?.(
        `Equally distributed ${pendingCallLeads.length} pending lead(s) (${breakdown}).`
      );
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
            Pending leads in campaign: <strong>{pendingCallLeads.length}</strong>. Transfer assigned
            leads before removing a member.
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            placeholder="Search user by name, email, role..."
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
              onClick={handleDistributePendingLeads}
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                border: "1px solid #047857",
                background: "#059669",
                color: "#ffffff",
                fontWeight: 700,
                cursor: assignedMemberIds.size === 0 ? "not-allowed" : "pointer",
              }}
            >
              {distributing
                ? "Distributing..."
                : `Distribute Pending Leads (${pendingCallLeads.length})`}
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
            <th>Assigned Leads</th>
            <th>Transfer Before Remove</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {filteredUsers.map((u) => {
            const isAssigned = assignedMemberIds.has(u.id);
            const userLeadCount = (campaignLeads || []).filter((l) => l.assigned_to === u.id).length;
            const otherMembers = (teamUsers || []).filter((other) => other.id !== u.id);

            return (
              <tr key={u.id} style={{ background: isAssigned ? "#f0fdf4" : "#ffffff" }}>
                <td><strong>{u.full_name || u.email}</strong></td>
                <td>{u.email}</td>
                <td><code>{u.role}</code></td>
                <td><strong>{userLeadCount}</strong></td>
                <td>
                  {isAssigned && userLeadCount > 0 ? (
                    <select
                      value={transferTargetByUser[u.id] || ""}
                      onChange={(e) =>
                        setTransferTargetByUser((prev) => ({
                          ...prev,
                          [u.id]: e.target.value,
                        }))
                      }
                      style={{ padding: "4px 6px", borderRadius: 6 }}
                    >
                      <option value="">-- Transfer to user --</option>
                      {otherMembers.map((om) => (
                        <option key={om.id} value={om.id}>
                          {om.full_name || om.email}
                        </option>
                      ))}
                    </select>
                  ) : (
                    "—"
                  )}
                </td>
                <td>
                  <button
                    type="button"
                    disabled={!canManageCampaign || savingUserId === u.id}
                    onClick={() => handleRemoveOrToggleMember(u, isAssigned)}
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
              <td colSpan="6">No users match your search.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
