"use client";

import { useEffect, useState } from "react";
import { safeJsonFetch } from "@/lib/crmHelpers";

export default function CampaignSettingsTab({
  session,
  profile,
  selectedTenantScope,
  campaign,
  callFields = [],
  dispositions = [],
  canManageCampaign,
  onReloadAll,
  onNotify,
  onBackToList,
  onSelectProject,
}) {
  const [editingDetails, setEditingDetails] = useState(false);
  const [detailsForm, setDetailsForm] = useState({
    name: campaign?.name || "",
    description: campaign?.description || "",
    script: campaign?.script || "",
    hide_phone_numbers: Boolean(campaign?.hide_phone_numbers),
    auto_dial: Boolean(campaign?.auto_dial),
  });
  const [savingDetails, setSavingDetails] = useState(false);

  // Dispositions state (create + modify existing)
  const [dispositionForm, setDispositionForm] = useState({
    name: "",
    requires_followup: false,
  });
  const [editingDispId, setEditingDispId] = useState(null);
  const [editingDispForm, setEditingDispForm] = useState({
    name: "",
    requires_followup: false,
  });

  // Create Form (Quick Lead Form preview & submit)
  const [formPreviewValues, setFormPreviewValues] = useState({
    name: "",
    phone: "",
    email: "",
    notes: "",
    custom_fields: {},
  });

  // Field settings state (add field, toggle editable/read-only, delete field)
  const [fieldForm, setFieldForm] = useState({
    label: "",
    field_type: "text",
    is_editable: true,
  });
  const [editableOverrides, setEditableOverrides] = useState({});

  useEffect(() => {
    setDetailsForm({
      name: campaign?.name || "",
      description: campaign?.description || "",
      script: campaign?.script || "",
      hide_phone_numbers: Boolean(campaign?.hide_phone_numbers),
      auto_dial: Boolean(campaign?.auto_dial),
    });
    setEditingDetails(false);
  }, [campaign]);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const ingestEmail =
    campaign?.ingest_email ||
    (campaign?.id ? `${campaign.id.slice(0, 8)}.addprospect@s2c.local` : "—");
  const ingestEndpoint = campaign?.id ? `${origin}/api/campaigns/${campaign.id}/ingest` : "—";

  async function handleSaveDetails(e) {
    e.preventDefault();
    if (!session?.access_token || !campaign?.id) return;
    setSavingDetails(true);
    try {
      const res = await safeJsonFetch("/api/projects", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          id: campaign.id,
          project_id: campaign.id,
          ...detailsForm,
          tenant_id: profile?.role === "super_admin" ? selectedTenantScope || undefined : undefined,
        }),
      });
      if (!res.ok) {
        onNotify?.(res.data?.error || "Failed to update campaign details.");
        return;
      }
      setEditingDetails(false);
      onNotify?.("Campaign settings updated.");
      await onReloadAll?.();
    } finally {
      setSavingDetails(false);
    }
  }

  async function handleArchiveCampaign() {
    if (!session?.access_token || !campaign?.id) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm(`Archive campaign "${campaign.name}"?`)
    ) {
      return;
    }
    const res = await safeJsonFetch("/api/projects", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        id: campaign.id,
        project_id: campaign.id,
        status: "archived",
        tenant_id: profile?.role === "super_admin" ? selectedTenantScope || undefined : undefined,
      }),
    });
    if (!res.ok) {
      onNotify?.(res.data?.error || "Failed to archive campaign.");
      return;
    }
    onNotify?.(`Archived campaign "${campaign.name}".`);
    await onReloadAll?.();
    onBackToList?.();
  }

  async function handleCopyCampaign() {
    if (!session?.access_token || !campaign) return;
    const res = await safeJsonFetch("/api/projects", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        name: `${campaign.name} (Copy)`,
        description: campaign.description || "",
        status: "active",
        tenant_id: profile?.role === "super_admin" ? selectedTenantScope || undefined : undefined,
      }),
    });
    if (!res.ok) {
      onNotify?.(res.data?.error || "Failed to copy campaign.");
      return;
    }
    onNotify?.(`Created copy "${res.data.project?.name || `${campaign.name} (Copy)`}".`);
    await onReloadAll?.();
    if (res.data.project?.id) onSelectProject?.(res.data.project.id);
  }

  async function handleAddDisposition(e) {
    e.preventDefault();
    if (!session?.access_token || !dispositionForm.name.trim()) return;
    const res = await safeJsonFetch("/api/call-config", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        kind: "disposition",
        name: dispositionForm.name.trim(),
        requires_followup: dispositionForm.requires_followup,
        project_id: campaign.id,
        tenant_id: profile?.role === "super_admin" ? selectedTenantScope || undefined : undefined,
      }),
    });
    if (!res.ok) {
      onNotify?.(res.data?.error || "Failed to add disposition.");
      return;
    }
    setDispositionForm({ name: "", requires_followup: false });
    onNotify?.(`Added disposition "${res.data.disposition?.name || dispositionForm.name}".`);
    await onReloadAll?.();
  }

  async function handleSaveDispositionEdit(e, disp) {
    e.preventDefault();
    if (!session?.access_token || !disp?.id) return;
    const res = await safeJsonFetch("/api/call-config", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        kind: "disposition",
        id: disp.id,
        name: editingDispForm.name.trim(),
        requires_followup: editingDispForm.requires_followup,
        project_id: campaign.id,
      }),
    });
    if (!res.ok) {
      onNotify?.(res.data?.error || "Failed to modify disposition.");
      return;
    }
    setEditingDispId(null);
    onNotify?.("Disposition updated.");
    await onReloadAll?.();
  }

  async function handleCreateFormLead(e) {
    e.preventDefault();
    if (!session?.access_token || !campaign?.id) return;
    const res = await safeJsonFetch("/api/leads", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        name: formPreviewValues.name,
        phone: formPreviewValues.phone,
        email: formPreviewValues.email,
        notes: formPreviewValues.notes,
        custom_fields: formPreviewValues.custom_fields,
        source: "campaign_form",
        project_id: campaign.id,
        tenant_id: profile?.role === "super_admin" ? selectedTenantScope || undefined : undefined,
      }),
    });
    if (!res.ok) {
      onNotify?.(res.data?.error || "Failed to submit form lead.");
      return;
    }
    setFormPreviewValues({ name: "", phone: "", email: "", notes: "", custom_fields: {} });
    onNotify?.(`Lead "${res.data.lead?.name || formPreviewValues.name}" added via campaign form.`);
    await onReloadAll?.();
  }

  async function handleAddCallField(e) {
    e.preventDefault();
    if (!session?.access_token || !fieldForm.label.trim()) return;
    const res = await safeJsonFetch("/api/call-config", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        kind: "field",
        label: fieldForm.label.trim(),
        field_type: fieldForm.field_type,
        is_editable: fieldForm.is_editable,
        project_id: campaign.id,
        tenant_id: profile?.role === "super_admin" ? selectedTenantScope || undefined : undefined,
      }),
    });
    if (!res.ok) {
      onNotify?.(res.data?.error || "Failed to add field.");
      return;
    }
    setFieldForm({ label: "", field_type: "text", is_editable: true });
    onNotify?.(`Added field "${res.data.field?.label || fieldForm.label}".`);
    await onReloadAll?.();
  }

  async function handleToggleFieldEditable(field) {
    const currentVal =
      editableOverrides[field.id] !== undefined
        ? editableOverrides[field.id]
        : field.is_editable !== false;
    const nextVal = !currentVal;
    setEditableOverrides((prev) => ({ ...prev, [field.id]: nextVal }));

    if (session?.access_token) {
      await safeJsonFetch("/api/call-config", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          kind: "field",
          id: field.id,
          is_editable: nextVal,
          project_id: campaign.id,
        }),
      });
    }
    onNotify?.(`"${field.label}" set to ${nextVal ? "Editable" : "Read-Only"}.`);
  }

  async function handleDeleteField(field) {
    if (!session?.access_token || !field?.id) return;
    if (typeof window !== "undefined" && !window.confirm(`Delete field "${field.label}"?`)) {
      return;
    }
    const res = await safeJsonFetch(
      `/api/call-config?kind=field&id=${encodeURIComponent(field.id)}&project_id=${encodeURIComponent(campaign.id)}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}` },
      }
    );
    if (!res.ok) {
      onNotify?.(res.data?.error || "Failed to delete field.");
      return;
    }
    onNotify?.(`Deleted field "${field.label}".`);
    await onReloadAll?.();
  }

  return (
    <div style={{ display: "grid", gap: 18 }}>
      {/* Section 1: Campaign Details (Matches screenshot layout) */}
      <div
        style={{
          padding: 16,
          border: "1px solid #cbd5e1",
          borderRadius: 10,
          background: "#ffffff",
        }}
      >
        <h3 style={{ marginTop: 0, marginBottom: 14 }}>Details</h3>

        {!editingDetails ? (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "180px 1fr",
                rowGap: 10,
                columnGap: 16,
                fontSize: 13,
                marginBottom: 18,
              }}
            >
              <div style={{ fontWeight: 700, textAlign: "right", color: "#334155" }}>Script</div>
              <div>{campaign.script || <span style={{ color: "#94a3b8" }}>None</span>}</div>

              <div style={{ fontWeight: 700, textAlign: "right", color: "#334155" }}>
                Hide phone numbers
              </div>
              <div>{campaign.hide_phone_numbers ? "Enabled" : "Disabled"}</div>

              <div style={{ fontWeight: 700, textAlign: "right", color: "#334155" }}>Email</div>
              <div style={{ color: "#059669", fontWeight: 600 }}>{ingestEmail}</div>

              <div style={{ fontWeight: 700, textAlign: "right", color: "#334155" }}>
                API Endpoint
              </div>
              <div>
                <code>{ingestEndpoint}</code>
              </div>

              <div style={{ fontWeight: 700, textAlign: "right", color: "#334155" }}>Auto Dial</div>
              <div>{campaign.auto_dial ? "Enabled" : "Disabled"}</div>

              <div style={{ fontWeight: 700, textAlign: "right", color: "#334155" }}>Started At</div>
              <div>
                {campaign.created_at
                  ? new Date(campaign.created_at).toLocaleString()
                  : "Active Campaign"}
              </div>

              <div style={{ fontWeight: 700, textAlign: "right", color: "#334155" }}>Columns</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {["Name", "Phone", "Email", "Notes", ...(callFields || []).map((f) => f.label)].map(
                  (col) => (
                    <span key={col} style={{ fontSize: 12 }}>
                      {col} <sup style={{ color: "#64748b" }}>E</sup>
                    </span>
                  )
                )}
              </div>
            </div>

            {canManageCampaign && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => setEditingDetails(true)}
                  style={{
                    padding: "7px 14px",
                    borderRadius: 6,
                    border: "1px solid #047857",
                    background: "#059669",
                    color: "#ffffff",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={handleArchiveCampaign}
                  style={{
                    padding: "7px 14px",
                    borderRadius: 6,
                    border: "1px solid #dc2626",
                    background: "#ef4444",
                    color: "#ffffff",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Archive this Campaign
                </button>
                <button
                  type="button"
                  onClick={handleCopyCampaign}
                  style={{
                    padding: "7px 14px",
                    borderRadius: 6,
                    border: "1px solid #d97706",
                    background: "#f59e0b",
                    color: "#ffffff",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Copy
                </button>
              </div>
            )}
          </>
        ) : (
          <form onSubmit={handleSaveDetails} style={{ display: "grid", gap: 10, maxWidth: 540 }}>
            <label style={{ fontSize: 12, fontWeight: 600 }}>
              Campaign Name
              <input
                value={detailsForm.name}
                onChange={(e) => setDetailsForm((f) => ({ ...f, name: e.target.value }))}
                required
                style={{ width: "100%", padding: "6px 8px", marginTop: 4 }}
              />
            </label>
            <label style={{ fontSize: 12, fontWeight: 600 }}>
              Description
              <input
                value={detailsForm.description}
                onChange={(e) => setDetailsForm((f) => ({ ...f, description: e.target.value }))}
                style={{ width: "100%", padding: "6px 8px", marginTop: 4 }}
              />
            </label>
            <label style={{ fontSize: 12, fontWeight: 600 }}>
              Calling Script
              <textarea
                rows={3}
                value={detailsForm.script}
                onChange={(e) => setDetailsForm((f) => ({ ...f, script: e.target.value }))}
                placeholder="Enter call script or opening pitch..."
                style={{ width: "100%", padding: "6px 8px", marginTop: 4 }}
              />
            </label>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13 }}>
              <label>
                <input
                  type="checkbox"
                  checked={detailsForm.hide_phone_numbers}
                  onChange={(e) =>
                    setDetailsForm((f) => ({ ...f, hide_phone_numbers: e.target.checked }))
                  }
                />{" "}
                Hide phone numbers
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={detailsForm.auto_dial}
                  onChange={(e) =>
                    setDetailsForm((f) => ({ ...f, auto_dial: e.target.checked }))
                  }
                />{" "}
                Auto Dial
              </label>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="submit"
                disabled={savingDetails}
                style={{
                  padding: "7px 14px",
                  borderRadius: 6,
                  border: "1px solid #1d4ed8",
                  background: "#2563eb",
                  color: "#ffffff",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {savingDetails ? "Saving..." : "Save Details"}
              </button>
              <button
                type="button"
                onClick={() => setEditingDetails(false)}
                style={{ padding: "7px 12px", borderRadius: 6, cursor: "pointer" }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Section 2: Dispositions (Create & Modify Existing) */}
      <div
        style={{
          padding: 16,
          border: "1px solid #cbd5e1",
          borderRadius: 10,
          background: "#ffffff",
        }}
      >
        <h4 style={{ marginTop: 0 }}>🏷️ Dispositions ({dispositions.length})</h4>

        {canManageCampaign && (
          <form
            onSubmit={handleAddDisposition}
            style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}
          >
            <input
              placeholder="New disposition name (e.g. Interested, Call Back)"
              value={dispositionForm.name}
              onChange={(e) => setDispositionForm((f) => ({ ...f, name: e.target.value }))}
              required
              style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #cbd5e1", minWidth: 220 }}
            />
            <label style={{ fontSize: 12 }}>
              <input
                type="checkbox"
                checked={dispositionForm.requires_followup}
                onChange={(e) =>
                  setDispositionForm((f) => ({ ...f, requires_followup: e.target.checked }))
                }
              />{" "}
              Requires Follow-Up
            </label>
            <button
              type="submit"
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                border: "1px solid #1d4ed8",
                background: "#2563eb",
                color: "#ffffff",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              + Add Disposition
            </button>
          </form>
        )}

        <table border="1" cellPadding="8" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#f8fafc" }}>
              <th>Disposition Name</th>
              <th>Follow-Up Rule</th>
              {canManageCampaign && <th>Modify</th>}
            </tr>
          </thead>
          <tbody>
            {(dispositions || []).map((d) => {
              const isEditing = editingDispId === d.id;
              return (
                <tr key={d.id}>
                  <td>
                    {isEditing ? (
                      <input
                        value={editingDispForm.name}
                        onChange={(e) =>
                          setEditingDispForm((f) => ({ ...f, name: e.target.value }))
                        }
                        style={{ padding: "4px 8px" }}
                      />
                    ) : (
                      <strong>{d.name}</strong>
                    )}
                  </td>
                  <td>
                    {isEditing ? (
                      <label style={{ fontSize: 12 }}>
                        <input
                          type="checkbox"
                          checked={editingDispForm.requires_followup}
                          onChange={(e) =>
                            setEditingDispForm((f) => ({
                              ...f,
                              requires_followup: e.target.checked,
                            }))
                          }
                        />{" "}
                        Requires Follow-Up
                      </label>
                    ) : d.requires_followup ? (
                      "Follow-Up Required"
                    ) : (
                      "Standard"
                    )}
                  </td>
                  {canManageCampaign && (
                    <td>
                      {isEditing ? (
                        <div style={{ display: "flex", gap: 6 }}>
                          <button
                            type="button"
                            onClick={(e) => handleSaveDispositionEdit(e, d)}
                            style={{ padding: "4px 8px", cursor: "pointer" }}
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingDispId(null)}
                            style={{ padding: "4px 8px", cursor: "pointer" }}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingDispId(d.id);
                            setEditingDispForm({
                              name: d.name || "",
                              requires_followup: Boolean(d.requires_followup),
                            });
                          }}
                          style={{ padding: "4px 8px", cursor: "pointer" }}
                        >
                          Edit
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
            {(dispositions || []).length === 0 && (
              <tr>
                <td colSpan={canManageCampaign ? 3 : 2}>No dispositions configured yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Section 3: Campaign Fields (Editable vs Read-Only + Delete) */}
      <div
        style={{
          padding: 16,
          border: "1px solid #cbd5e1",
          borderRadius: 10,
          background: "#ffffff",
        }}
      >
        <h4 style={{ marginTop: 0 }}>🧩 Campaign Fields ({callFields.length})</h4>

        {canManageCampaign && (
          <form
            onSubmit={handleAddCallField}
            style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}
          >
            <input
              placeholder="Field label (e.g. City, Serial Number)"
              value={fieldForm.label}
              onChange={(e) => setFieldForm((f) => ({ ...f, label: e.target.value }))}
              required
              style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #cbd5e1", minWidth: 200 }}
            />
            <select
              value={fieldForm.field_type}
              onChange={(e) => setFieldForm((f) => ({ ...f, field_type: e.target.value }))}
              style={{ padding: "6px 8px", borderRadius: 6 }}
            >
              <option value="text">Text</option>
              <option value="number">Number</option>
              <option value="date">Date</option>
            </select>
            <label style={{ fontSize: 12 }}>
              <input
                type="checkbox"
                checked={fieldForm.is_editable}
                onChange={(e) => setFieldForm((f) => ({ ...f, is_editable: e.target.checked }))}
              />{" "}
              Editable
            </label>
            <button
              type="submit"
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                border: "1px solid #1d4ed8",
                background: "#2563eb",
                color: "#ffffff",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              + Add Field
            </button>
          </form>
        )}

        <table border="1" cellPadding="8" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#f8fafc" }}>
              <th>Field Label</th>
              <th>Key</th>
              <th>Type</th>
              <th>Editable Status</th>
              {canManageCampaign && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {(callFields || []).map((cf) => {
              const isEditable =
                editableOverrides[cf.id] !== undefined
                  ? editableOverrides[cf.id]
                  : cf.is_editable !== false;
              return (
                <tr key={cf.id}>
                  <td><strong>{cf.label}</strong></td>
                  <td><code>{cf.field_key}</code></td>
                  <td>{cf.field_type || "text"}</td>
                  <td>{isEditable ? "Editable" : "Read-Only"}</td>
                  {canManageCampaign && (
                    <td style={{ display: "flex", gap: 6 }}>
                      <button
                        type="button"
                        onClick={() => handleToggleFieldEditable(cf)}
                        style={{ padding: "4px 8px", cursor: "pointer" }}
                      >
                        {isEditable ? "Set Read-Only" : "Set Editable"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteField(cf)}
                        style={{ padding: "4px 8px", color: "#991b1b", cursor: "pointer" }}
                      >
                        Delete
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
            {(callFields || []).length === 0 && (
              <tr>
                <td colSpan={canManageCampaign ? 5 : 4}>No custom campaign fields added yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Section 4: Create Form (Campaign Lead Capture Form) */}
      <div
        style={{
          padding: 16,
          border: "1px solid #cbd5e1",
          borderRadius: 10,
          background: "#ffffff",
        }}
      >
        <h4 style={{ marginTop: 0 }}>📝 Create Form — {campaign.name}</h4>
        <form
          onSubmit={handleCreateFormLead}
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
            gap: 10,
          }}
        >
          <input
            placeholder="Prospect Name *"
            value={formPreviewValues.name}
            onChange={(e) => setFormPreviewValues((f) => ({ ...f, name: e.target.value }))}
            required
            style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1" }}
          />
          <input
            placeholder="Phone Number *"
            value={formPreviewValues.phone}
            onChange={(e) => setFormPreviewValues((f) => ({ ...f, phone: e.target.value }))}
            required
            style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1" }}
          />
          <input
            placeholder="Email"
            value={formPreviewValues.email}
            onChange={(e) => setFormPreviewValues((f) => ({ ...f, email: e.target.value }))}
            style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1" }}
          />
          {(callFields || []).map((cf) => {
            const isEditable =
              editableOverrides[cf.id] !== undefined
                ? editableOverrides[cf.id]
                : cf.is_editable !== false;
            return (
              <input
                key={cf.id}
                placeholder={cf.label}
                disabled={!isEditable}
                value={formPreviewValues.custom_fields[cf.field_key] || ""}
                onChange={(e) => {
                  const val = e.target.value;
                  setFormPreviewValues((f) => ({
                    ...f,
                    custom_fields: { ...f.custom_fields, [cf.field_key]: val },
                  }));
                }}
                style={{
                  padding: "7px 10px",
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
                  background: isEditable ? "#ffffff" : "#f1f5f9",
                }}
              />
            );
          })}
          <input
            placeholder="Notes"
            value={formPreviewValues.notes}
            onChange={(e) => setFormPreviewValues((f) => ({ ...f, notes: e.target.value }))}
            style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1" }}
          />
          <button
            type="submit"
            style={{
              padding: "7px 14px",
              borderRadius: 6,
              border: "1px solid #15803d",
              background: "#16a34a",
              color: "#ffffff",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Submit Form Lead
          </button>
        </form>
      </div>
    </div>
  );
}
