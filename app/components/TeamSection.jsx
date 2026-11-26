"use client";

import { useState } from "react";
import { safeJsonFetch } from "@/lib/crmHelpers";

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

export default function TeamSection({
  session,
  profile,
  teamUsers,
  licenseInfo,
  tenantLicenseHistory,
  onReload,
  onNotify,
}) {
  const [showAddUserForm, setShowAddUserForm] = useState(false);
  const [resetPasswordUserId, setResetPasswordUserId] = useState(null);
  const [resetPasswordValue, setResetPasswordValue] = useState("");
  const [newUserForm, setNewUserForm] = useState({
    full_name: "",
    email: "",
    password: "",
    role: "agent",
  });

  async function handleAddTeamUser(e) {
    e.preventDefault();
    if (!session?.access_token) return;

    const res = await safeJsonFetch("/api/tenant/users", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(newUserForm),
    });

    if (!res.ok) {
      onNotify(res.data.error || "Failed to add user.");
      return;
    }

    setNewUserForm({ full_name: "", email: "", password: "", role: "agent" });
    setShowAddUserForm(false);
    onNotify(`Added user "${res.data.user?.full_name || res.data.user?.email}".`);
    await onReload();
  }

  async function handleResetUserPassword(e, targetUser) {
    e.preventDefault();
    if (!session?.access_token || !resetPasswordValue) return;

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
      onNotify(res.data.error || "Failed to reset password.");
      return;
    }

    setResetPasswordUserId(null);
    setResetPasswordValue("");
    onNotify(`Password reset for ${targetUser.email}.`);
  }

  async function handleToggleUserActive(user) {
    if (!session?.access_token) return;

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
      onNotify(res.data.error || "Failed to update user status.");
      return;
    }

    onNotify(`${user.email} is now ${!user.is_active ? "ACTIVE" : "DISABLED"}.`);
    await onReload();
  }

  async function handleDeleteTeamUser(user) {
    if (!session?.access_token) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm(`Delete user ${user.email} and free the seat?`)
    ) {
      return;
    }

    const res = await safeJsonFetch("/api/tenant/users", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ user_id: user.id }),
    });

    if (!res.ok) {
      onNotify(res.data.error || "Failed to delete user.");
      return;
    }

    onNotify(`Deleted ${user.email} and freed seat.`);
    await onReload();
  }

  return (
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
          delete users below or request more seats.
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
          {(teamUsers || []).map((u) => (
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
                {u.id !== profile?.id && (
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
          {(tenantLicenseHistory || []).map((lp) => (
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
          {(!tenantLicenseHistory || tenantLicenseHistory.length === 0) && (
            <tr>
              <td colSpan="5">No license periods recorded for your tenant yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
