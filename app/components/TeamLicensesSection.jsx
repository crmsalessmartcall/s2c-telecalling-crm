"use client";

import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { safeJsonFetch } from "@/lib/crmHelpers";

export default function TeamLicensesSection({
  session,
  profile,
  selectedTenantScope,
  teamUsers = [],
  licenseSummary = null,
  licenseHistory = [],
  onReload,
  onNotify,
  onUpdateUser,
  onResetPassword,
  onToggleUserActive,
  onDeleteUser,
}) {
  const [statusTab, setStatusTab] = useState("active"); // "active" | "disabled"
  const [showLicenseHistory, setShowLicenseHistory] = useState(false);

  const [editingUserId, setEditingUserId] = useState(null);
  const [editForm, setEditForm] = useState({
    full_name: "",
    user_id: "",
    email: "",
    role: "agent",
  });
  const [savingEdit, setSavingEdit] = useState(false);
  const [busyUserKey, setBusyUserKey] = useState(null);

  const activeUsers = useMemo(
    () => (teamUsers || []).filter((u) => u.is_active !== false),
    [teamUsers]
  );

  const disabledUsers = useMemo(
    () => (teamUsers || []).filter((u) => u.is_active === false),
    [teamUsers]
  );

  const visibleUsers = statusTab === "disabled" ? disabledUsers : activeUsers;

  const seatStats = useMemo(() => {
    const activeCount = activeUsers.length;
    const totalLicenses =
      Number(licenseSummary?.total_seats ?? licenseSummary?.totalLicenses ?? 0) ||
      Math.max(activeCount + 1, 4);
    const availableLicenses =
      licenseSummary?.available_seats !== undefined
        ? Number(licenseSummary.available_seats)
        : Math.max(0, totalLicenses - activeCount);
    const utilizationPct =
      totalLicenses > 0 ? Math.min(100, Math.round((activeCount / totalLicenses) * 100)) : 0;

    return {
      activeCount,
      totalLicenses,
      availableLicenses,
      utilizationPct,
    };
  }, [activeUsers.length, licenseSummary]);

  function startEditing(user) {
    setEditingUserId(user.id);
    setEditForm({
      full_name: user.full_name || "",
      user_id: user.user_id || "",
      email: user.email || "",
      role: user.role || "agent",
    });
  }

  function cancelEditing() {
    setEditingUserId(null);
  }

  async function patchUserFallback(user, fieldsToUpdate) {
    if (session?.access_token) {
      const res = await safeJsonFetch("/api/users", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          user_id_pk: user.id,
          ...fieldsToUpdate,
          ...(profile?.role === "super_admin" && selectedTenantScope
            ? { tenant_id: selectedTenantScope }
            : {}),
        }),
      });
      if (res.ok) return { ok: true };
      if (res.status !== 404 && res.status !== 405) {
        return { ok: false, error: res.data?.error || "Failed to update user." };
      }
    }

    if (!supabase) {
      return { ok: false, error: "Supabase client not initialized." };
    }

    const { error } = await supabase
      .from("profiles")
      .update(fieldsToUpdate)
      .eq("id", user.id);

    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  async function handleSaveEdit(e, user) {
    e.preventDefault();
    if (!user?.id) return;
    setSavingEdit(true);
    try {
      const payload = {
        full_name: editForm.full_name.trim(),
        user_id: editForm.user_id.trim(),
        email: editForm.email.trim(),
        role: editForm.role,
      };

      if (onUpdateUser) {
        await onUpdateUser(user, { user_id_pk: user.id, ...payload });
      } else {
        const result = await patchUserFallback(user, payload);
        if (!result.ok) {
          onNotify?.(result.error || "Failed to update user details.");
          return;
        }
      }

      setEditingUserId(null);
      onNotify?.(`Updated "${payload.full_name || payload.email}" (${payload.user_id || "—"}).`);
      await onReload?.();
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleToggleActive(user, nextActive) {
    if (!user?.id) return;
    const actionKey = `${user.id}:${nextActive ? "enable" : "disable"}`;
    setBusyUserKey(actionKey);
    try {
      if (onToggleUserActive) {
        await onToggleUserActive(user, nextActive);
      } else {
        const result = await patchUserFallback(user, { is_active: nextActive });
        if (!result.ok) {
          onNotify?.(result.error || "Failed to update user status.");
          return;
        }
      }

      if (!nextActive) {
        setStatusTab("disabled");
        onNotify?.(`Disabled "${user.full_name || user.email}". Switched to Disabled Users.`);
      } else {
        setStatusTab("active");
        onNotify?.(`Re-enabled "${user.full_name || user.email}". Switched to Active Users.`);
      }
      await onReload?.();
    } finally {
      setBusyUserKey(null);
    }
  }

  async function handlePasswordReset(user) {
    if (!user?.id) return;
    const actionKey = `${user.id}:reset`;
    setBusyUserKey(actionKey);
    try {
      if (onResetPassword) {
        await onResetPassword(user);
      } else if (session?.access_token) {
        const res = await safeJsonFetch("/api/users/reset-password", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            user_id_pk: user.id,
            email: user.email,
          }),
        });
        if (!res.ok) {
          if (res.status === 404 || res.status === 405) {
            if (!user.email) {
              onNotify?.("User has no email address for password reset.");
              return;
            }
            const { error } = await supabase.auth.resetPasswordForEmail(user.email);
            if (error) {
              onNotify?.(error.message);
              return;
            }
          } else {
            onNotify?.(res.data?.error || "Failed to send password reset.");
            return;
          }
        }
      } else if (user.email) {
        const { error } = await supabase.auth.resetPasswordForEmail(user.email);
        if (error) {
          onNotify?.(error.message);
          return;
        }
      }
      onNotify?.(`Password reset sent for ${user.email || user.full_name}.`);
    } finally {
      setBusyUserKey(null);
    }
  }

  async function handleDelete(user) {
    if (!user?.id) return;
    const actionKey = `${user.id}:delete`;
    setBusyUserKey(actionKey);
    try {
      if (onDeleteUser) {
        await onDeleteUser(user);
      } else if (session?.access_token) {
        const res = await safeJsonFetch("/api/users", {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ user_id_pk: user.id }),
        });
        if (!res.ok && res.status !== 404 && res.status !== 405) {
          onNotify?.(res.data?.error || "Failed to delete user.");
          return;
        }
      }
      onNotify?.(`Deleted user "${user.full_name || user.email}".`);
      await onReload?.();
    } finally {
      setBusyUserKey(null);
    }
  }

  const isNearCapacity = seatStats.availableLicenses === 0;

  return (
    <section style={{ display: "grid", gap: 16 }}>
      {/* Top License Availability Header + History Toggle */}
      <div
        style={{
          padding: "14px 16px",
          border: "1px solid #cbd5e1",
          borderRadius: 10,
          background: "#ffffff",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 14,
        }}
      >
        <div style={{ display: "grid", gap: 6, minWidth: 240 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h3 style={{ margin: 0, fontSize: 16 }}>Team &amp; Licenses</h3>
            <span
              style={{
                padding: "4px 10px",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 700,
                background: isNearCapacity ? "#fef2f2" : "#eff6ff",
                color: isNearCapacity ? "#991b1b" : "#1d4ed8",
                border: `1px solid ${isNearCapacity ? "#fecaca" : "#bfdbfe"}`,
              }}
            >
              {seatStats.availableLicenses} available of {seatStats.totalLicenses} licenses
            </span>
          </div>

          <div
            aria-hidden="true"
            style={{
              width: "100%",
              maxWidth: 280,
              height: 6,
              borderRadius: 999,
              background: "#e2e8f0",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${seatStats.utilizationPct}%`,
                height: "100%",
                background: isNearCapacity ? "#dc2626" : "#2563eb",
                transition: "width 160ms ease",
              }}
            />
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowLicenseHistory((prev) => !prev)}
          style={{
            padding: "7px 12px",
            borderRadius: 7,
            border: "1px solid #cbd5e1",
            background: showLicenseHistory ? "#eef2ff" : "#f8fafc",
            color: "#0f172a",
            fontWeight: 600,
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          {showLicenseHistory ? "Hide License History" : "License History"}
        </button>
      </div>

      {/* Collapsible Tenant License History (Shown only when clicked) */}
      {showLicenseHistory && (
        <div
          style={{
            padding: 16,
            border: "1px solid #cbd5e1",
            borderRadius: 10,
            background: "#ffffff",
            display: "grid",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h4 style={{ margin: 0, fontSize: 14 }}>Your Tenant License History</h4>
            <span style={{ fontSize: 12, color: "#64748b" }}>
              {(licenseHistory || []).length} record(s)
            </span>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table
              border="1"
              cellPadding="8"
              style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}
            >
              <thead>
                <tr style={{ background: "#f8fafc", textAlign: "left" }}>
                  <th>Seats</th>
                  <th>License Label</th>
                  <th>Start Date</th>
                  <th>End Date</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {(licenseHistory || []).map((row, idx) => (
                  <tr key={row.id || idx}>
                    <td><strong>{row.seats ?? "—"}</strong></td>
                    <td>{row.label || row.status || "—"}</td>
                    <td>{row.start_date ? new Date(row.start_date).toLocaleString() : "—"}</td>
                    <td>{row.end_date ? new Date(row.end_date).toLocaleString() : "—"}</td>
                    <td>{row.reason || "—"}</td>
                  </tr>
                ))}
                {(licenseHistory || []).length === 0 && (
                  <tr>
                    <td colSpan="5" style={{ color: "#64748b" }}>
                      No license history records found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* User Directory: Active vs. Disabled Tabs */}
      <div
        style={{
          padding: 16,
          border: "1px solid #cbd5e1",
          borderRadius: 10,
          background: "#ffffff",
          display: "grid",
          gap: 14,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div role="tablist" aria-label="User status filter" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              role="tab"
              aria-selected={statusTab === "active"}
              onClick={() => {
                setStatusTab("active");
                setEditingUserId(null);
              }}
              style={{
                padding: "7px 14px",
                borderRadius: 8,
                border: statusTab === "active" ? "1px solid #0f172a" : "1px solid #cbd5e1",
                background: statusTab === "active" ? "#0f172a" : "#f8fafc",
                color: statusTab === "active" ? "#ffffff" : "#0f172a",
                fontWeight: 700,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Active Users ({activeUsers.length})
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={statusTab === "disabled"}
              onClick={() => {
                setStatusTab("disabled");
                setEditingUserId(null);
              }}
              style={{
                padding: "7px 14px",
                borderRadius: 8,
                border: statusTab === "disabled" ? "1px solid #0f172a" : "1px solid #cbd5e1",
                background: statusTab === "disabled" ? "#0f172a" : "#f8fafc",
                color: statusTab === "disabled" ? "#ffffff" : "#0f172a",
                fontWeight: 700,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Disabled Users ({disabledUsers.length})
            </button>
          </div>

          {statusTab === "disabled" && (
            <div
              style={{
                padding: "6px 12px",
                borderRadius: 8,
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                fontSize: 12,
                color: "#334155",
                display: "flex",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <span>
                Total Licenses: <strong>{seatStats.totalLicenses}</strong>
              </span>
              <span>
                Available Licenses: <strong>{seatStats.availableLicenses}</strong>
              </span>
              <span>
                Disabled Users: <strong>{disabledUsers.length}</strong>
              </span>
            </div>
          )}
        </div>

        <div style={{ overflowX: "auto" }}>
          <table
            border="1"
            cellPadding="8"
            style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}
          >
            <thead>
              <tr style={{ background: "#f8fafc", textAlign: "left" }}>
                <th>User ID</th>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleUsers.map((u) => {
                const isEditing = editingUserId === u.id;
                const isDisabled = u.is_active === false;

                return (
                  <tr key={u.id} style={{ background: isEditing ? "#f8fafc" : "#ffffff" }}>
                    <td>
                      {isEditing ? (
                        <input
                          aria-label="User ID"
                          value={editForm.user_id}
                          onChange={(e) => setEditForm((f) => ({ ...f, user_id: e.target.value }))}
                          style={{
                            padding: "5px 7px",
                            borderRadius: 6,
                            border: "1px solid #94a3b8",
                            width: 125,
                          }}
                        />
                      ) : (
                        <code>{u.user_id || "—"}</code>
                      )}
                    </td>
                    <td>
                      {isEditing ? (
                        <input
                          aria-label="Full Name"
                          value={editForm.full_name}
                          onChange={(e) => setEditForm((f) => ({ ...f, full_name: e.target.value }))}
                          style={{
                            padding: "5px 7px",
                            borderRadius: 6,
                            border: "1px solid #94a3b8",
                            width: 155,
                          }}
                        />
                      ) : (
                        <strong>{u.full_name || "—"}</strong>
                      )}
                    </td>
                    <td>
                      {isEditing ? (
                        <input
                          type="email"
                          aria-label="Email"
                          value={editForm.email}
                          onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                          style={{
                            padding: "5px 7px",
                            borderRadius: 6,
                            border: "1px solid #94a3b8",
                            width: 195,
                          }}
                        />
                      ) : (
                        u.email || "—"
                      )}
                    </td>
                    <td>
                      {isEditing ? (
                        <select
                          aria-label="Role"
                          value={editForm.role}
                          onChange={(e) => setEditForm((f) => ({ ...f, role: e.target.value }))}
                          style={{
                            padding: "5px 7px",
                            borderRadius: 6,
                            border: "1px solid #94a3b8",
                          }}
                        >
                          <option value="agent">agent</option>
                          <option value="supervisor">supervisor</option>
                          <option value="tenant_admin">tenant_admin</option>
                        </select>
                      ) : (
                        <code>{u.role || "agent"}</code>
                      )}
                    </td>
                    <td>
                      <span
                        style={{
                          padding: "3px 9px",
                          borderRadius: 999,
                          fontSize: 11,
                          fontWeight: 700,
                          background: isDisabled ? "#fee2e2" : "#dcfce7",
                          color: isDisabled ? "#991b1b" : "#166534",
                        }}
                      >
                        {isDisabled ? "Disabled" : "Active"}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {isEditing ? (
                          <>
                            <button
                              type="button"
                              disabled={savingEdit}
                              onClick={(e) => handleSaveEdit(e, u)}
                              style={{
                                padding: "5px 10px",
                                borderRadius: 6,
                                border: "1px solid #15803d",
                                background: "#16a34a",
                                color: "#ffffff",
                                fontWeight: 700,
                                cursor: "pointer",
                              }}
                            >
                              {savingEdit ? "Saving..." : "Save"}
                            </button>
                            <button
                              type="button"
                              disabled={busyUserKey === `${u.id}:reset`}
                              onClick={() => handlePasswordReset(u)}
                              style={{ padding: "5px 9px", borderRadius: 6, cursor: "pointer" }}
                            >
                              Reset Password
                            </button>
                            <button
                              type="button"
                              onClick={cancelEditing}
                              style={{ padding: "5px 9px", borderRadius: 6, cursor: "pointer" }}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => startEditing(u)}
                              style={{
                                padding: "5px 10px",
                                borderRadius: 6,
                                border: "1px solid #1d4ed8",
                                background: "#2563eb",
                                color: "#ffffff",
                                fontWeight: 600,
                                cursor: "pointer",
                              }}
                            >
                              Edit
                            </button>

                            {!isDisabled ? (
                              u.role !== "tenant_admin" && (
                                <button
                                  type="button"
                                  disabled={busyUserKey === `${u.id}:disable`}
                                  onClick={() => handleToggleActive(u, false)}
                                  style={{ padding: "5px 9px", borderRadius: 6, cursor: "pointer" }}
                                >
                                  Disable
                                </button>
                              )
                            ) : (
                              <button
                                type="button"
                                disabled={busyUserKey === `${u.id}:enable`}
                                onClick={() => handleToggleActive(u, true)}
                                style={{
                                  padding: "5px 10px",
                                  borderRadius: 6,
                                  border: "1px solid #047857",
                                  background: "#059669",
                                  color: "#ffffff",
                                  fontWeight: 700,
                                  cursor: "pointer",
                                }}
                              >
                                Re-enable
                              </button>
                            )}

                            {u.role !== "tenant_admin" && (
                              <button
                                type="button"
                                disabled={busyUserKey === `${u.id}:delete`}
                                onClick={() => handleDelete(u)}
                                style={{ padding: "5px 9px", borderRadius: 6, cursor: "pointer" }}
                              >
                                Delete
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {visibleUsers.length === 0 && (
                <tr>
                  <td colSpan="6" style={{ color: "#64748b" }}>
                    {statusTab === "disabled"
                      ? "No disabled users."
                      : "No active users found."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
