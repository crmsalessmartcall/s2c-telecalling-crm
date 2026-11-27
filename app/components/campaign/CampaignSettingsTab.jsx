"use client";

import { useEffect, useState } from "react";
import { safeJsonFetch } from "@/lib/crmHelpers";

function toKey(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export default function CampaignSettingsTab({
  session,
  profile,
  selectedTenantScope,
  campaign,
  callFields = [],
  dispositions = [],
  formConfig = null,
  canManageCampaign,
  onReloadAll,
  onNotify,
  onUpdateCampaignConfig,
}) {
  const [settingsRuleMenu, setSettingsRuleMenu] = useState("");
  const [editingDetails, setEditingDetails] = useState(false);
  const [detailsForm, setDetailsForm] = useState({
    name: campaign?.name || "",
    description: campaign?.description || "",
    hide_phone_numbers: Boolean(campaign?.hide_phone_numbers),
    auto_dial: Boolean(campaign?.auto_dial),
  });
  const [savingDetails, setSavingDetails] = useState(false);

  // Disposition state
  const [dispositionForm, setDispositionForm] = useState({
    name: "",
    requires_followup: false,
  });
  const [editingDispId, setEditingDispId] = useState(null);
  const [editingDispForm, setEditingDispForm] = useState({
    name: "",
    requires_followup: false,
  });

  // Campaign Field state
  const [fieldForm, setFieldForm] = useState({
    label: "",
    field_type: "text",
    optionsText: "",
    is_editable: true,
  });
  const [editableOverrides, setEditableOverrides] = useState({});

  // Create Form state
  const [selectedDispositionForForm, setSelectedDispositionForForm] = useState("");
  const [formBuilderField, setFormBuilderField] = useState({
    label: "",
    field_type: "amount",
    optionsText: "Option A, Option B",
  });
  const [customFormFields, setCustomFormFields] = useState([]);
  const [formSubmission, setFormSubmission] = useState({
    name: "",
    phone: "",
    email: "",
    notes: "",
    gender: "Male",
    custom_values: {},
  });

  useEffect(() => {
    setDetailsForm({
      name: campaign?.name || "",
      description: campaign?.description || "",
      hide_phone_numbers: Boolean(campaign?.hide_phone_numbers),
      auto_dial: Boolean(campaign?.auto_dial),
    });
    setEditingDetails(false);
  }, [campaign]);

  useEffect(() => {
    if (formConfig?.fields && Array.isArray(formConfig.fields)) {
      setCustomFormFields(formConfig.fields);
    } else {
      setCustomFormFields([
        { key: "amount", label: "Amount", field_type: "number", options: [] },
        {
          key: "plan_tier",
          label: "Plan Selection",
          field_type: "select",
          options: ["Starter", "Growth", "Enterprise"],
        },
        { key: "gender", label: "Gender", field_type: "radio", options: ["Male", "Female"] },
      ]);
    }
    if (formConfig?.selectedDisposition) {
      setSelectedDispositionForForm(formConfig.selectedDisposition);
    }
  }, [formConfig, campaign?.id]);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const ingestEmail =
    campaign?.ingest_email ||
    (campaign?.id ? `${campaign.id.slice(0, 8)}.addprospect@s2c.local` : "—");
  const ingestEndpoint = campaign?.id ? `${origin}/api/campaigns/${campaign.id}/ingest` : "—";

  function syncFormConfig(nextFields, nextDisp = selectedDispositionForForm) {
    onUpdateCampaignConfig?.((cur) => ({
      ...cur,
      formConfig: {
        selectedDisposition: nextDisp,
        fields: nextFields,
      },
    }));
  }

  async function handleSaveDetails(e) {
    e.preventDefault();
    if (!campaign?.id) return;
    setSavingDetails(true);
    try {
      if (session?.access_token) {
        await safeJsonFetch("/api/projects", {
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
      }
      setEditingDetails(false);
      onNotify?.("Campaign details updated.");
      await onReloadAll?.();
    } finally {
      setSavingDetails(false);
    }
  }

  async function handleAddDisposition(e) {
    e.preventDefault();
    if (!dispositionForm.name.trim()) return;
    const cleanName = dispositionForm.name.trim();
    const newDisp = {
      id: `disp-${Date.now()}`,
      name: cleanName,
      requires_followup: dispositionForm.requires_followup,
      project_id: campaign.id,
    };

    if (session?.access_token) {
      await safeJsonFetch("/api/call-config", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          kind: "disposition",
          name: cleanName,
          requires_followup: dispositionForm.requires_followup,
          project_id: campaign.id,
          tenant_id: profile?.role === "super_admin" ? selectedTenantScope || undefined : undefined,
        }),
      });
    }

    onUpdateCampaignConfig?.((cur) => ({
      ...cur,
      dispositions: [...(cur.dispositions || dispositions || []), newDisp],
    }));
    setDispositionForm({ name: "", requires_followup: false });
    onNotify?.(`Added disposition "${cleanName}".`);
    await onReloadAll?.();
  }

  async function handleSaveDispositionEdit(e, disp) {
    e.preventDefault();
    if (!disp?.id || !editingDispForm.name.trim()) return;
    const updatedName = editingDispForm.name.trim();

    if (session?.access_token) {
      await safeJsonFetch("/api/call-config", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          kind: "disposition",
          id: disp.id,
          name: updatedName,
          requires_followup: editingDispForm.requires_followup,
          project_id: campaign.id,
        }),
      });
    }

    onUpdateCampaignConfig?.((cur) => ({
      ...cur,
      dispositions: (cur.dispositions || dispositions || []).map((item) =>
        item.id === disp.id
          ? {
              ...item,
              name: updatedName,
              requires_followup: editingDispForm.requires_followup,
            }
          : item
      ),
    }));
    setEditingDispId(null);
    onNotify?.("Disposition updated.");
    await onReloadAll?.();
  }

  async function handleAddCallField(e) {
    e.preventDefault();
    if (!fieldForm.label.trim()) return;
    const label = fieldForm.label.trim();
    const fieldKey = toKey(label) || `field_${Date.now()}`;
    const parsedOptions = fieldForm.optionsText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const createdField = {
      id: `fld-${Date.now()}`,
      label,
      field_key: fieldKey,
      field_type: fieldForm.field_type,
      options: parsedOptions,
      is_editable: fieldForm.is_editable,
      project_id: campaign.id,
    };

    if (session?.access_token) {
      await safeJsonFetch("/api/call-config", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          kind: "field",
          label,
          field_key: fieldKey,
          field_type: fieldForm.field_type,
          options: parsedOptions,
          is_editable: fieldForm.is_editable,
          project_id: campaign.id,
          tenant_id: profile?.role === "super_admin" ? selectedTenantScope || undefined : undefined,
        }),
      });
    }

    onUpdateCampaignConfig?.((cur) => ({
      ...cur,
      fields: [...(cur.fields || callFields || []), createdField],
    }));
    setFieldForm({ label: "", field_type: "text", optionsText: "", is_editable: true });
    onNotify?.(`Added field "${label}".`);
    await onReloadAll?.();
  }

  async function handleToggleFieldEditable(field) {
    const currentVal =
      editableOverrides[field.id] !== undefined
        ? editableOverrides[field.id]
        : field.is_editable !== false;
    const nextVal = !currentVal;
    setEditableOverrides((prev) => ({ ...prev, [field.id]: nextVal }));

    onUpdateCampaignConfig?.((cur) => ({
      ...cur,
      fields: (cur.fields || callFields || []).map((f) =>
        f.id === field.id ? { ...f, is_editable: nextVal } : f
      ),
    }));

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
    onNotify?.(`"${field.label}" is now ${nextVal ? "Editable" : "Read-Only"}.`);
  }

  async function handleDeleteField(field) {
    if (!field?.id) return;
    if (typeof window !== "undefined" && !window.confirm(`Delete field "${field.label}"?`)) {
      return;
    }

    if (session?.access_token) {
      await safeJsonFetch(
        `/api/call-config?kind=field&id=${encodeURIComponent(field.id)}&project_id=${encodeURIComponent(campaign.id)}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${session.access_token}` },
        }
      );
    }

    onUpdateCampaignConfig?.((cur) => ({
      ...cur,
      fields: (cur.fields || callFields || []).filter((f) => f.id !== field.id),
    }));
    onNotify?.(`Deleted field "${field.label}".`);
  }

  function handleAddFormBuilderField(e) {
    e.preventDefault();
    if (!formBuilderField.label.trim()) return;
    const label = formBuilderField.label.trim();
    const key = toKey(label) || `custom_${Date.now()}`;
    const opts = formBuilderField.optionsText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const nextFields = [
      ...customFormFields,
      {
        key,
        label,
        field_type: formBuilderField.field_type,
        options:
          ["select", "radio"].includes(formBuilderField.field_type)
            ? opts.length > 0
              ? opts
              : formBuilderField.field_type === "radio"
              ? ["Male", "Female"]
              : ["Option 1", "Option 2"]
            : [],
      },
    ];
    setCustomFormFields(nextFields);
    syncFormConfig(nextFields, selectedDispositionForForm);
    setFormBuilderField({ label: "", field_type: "amount", optionsText: "Option A, Option B" });
    onNotify?.(`Added "${label}" to campaign form.`);
  }

  async function handleSubmitCustomForm(e) {
    e.preventDefault();
    if (!campaign?.id) return;

    const mergedCustom = {
      ...(formSubmission.custom_values || {}),
      gender: formSubmission.gender,
    };

    if (session?.access_token) {
      await safeJsonFetch("/api/leads", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          name: formSubmission.name,
          phone: formSubmission.phone,
          email: formSubmission.email,
          notes: formSubmission.notes,
          disposition: selectedDispositionForForm || null,
          custom_fields: mergedCustom,
          source: "campaign_form",
          project_id: campaign.id,
          tenant_id: profile?.role === "super_admin" ? selectedTenantScope || undefined : undefined,
        }),
      });
    }

    setFormSubmission({
      name: "",
      phone: "",
      email: "",
      notes: "",
      gender: "Male",
      custom_values: {},
    });
    onNotify?.(`Captured form details for "${formSubmission.name}" under ${campaign.name}.`);
    await onReloadAll?.();
  }

  return (
    <div style={{ display: "grid", gap: 18 }}>
      {/* Settings / Rules Selector Bar inside Campaign Setting */}
      <div
        style={{
          padding: 12,
          border: "1px solid #cbd5e1",
          borderRadius: 10,
          background: "#f8fafc",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 10,
        }}
      >
        <strong style={{ fontSize: 13, color: "#0f172a" }}>
          Settings & Rules — {campaign.name}
        </strong>
        <label style={{ fontSize: 12, fontWeight: 700 }}>
          Jump to Section:{" "}
          <select
            value={settingsRuleMenu}
            onChange={(e) => {
              const target = e.target.value;
              setSettingsRuleMenu(target);
              if (target) {
                document.getElementById(`section-${target}`)?.scrollIntoView({ behavior: "smooth" });
              }
            }}
            style={{ padding: "5px 9px", borderRadius: 7, background: "#ffffff" }}
          >
            <option value="">All Sections</option>
            <option value="disposition">Disposition</option>
            <option value="campaign_field">Campaign Field</option>
            <option value="create_form">Create Form</option>
          </select>
        </label>
      </div>

      {/* Campaign Details (No Script row; Archive/Copy live on main campaign list) */}
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
                marginBottom: 16,
              }}
            >
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

      {/* 1. Disposition Section */}
      <div
        id="section-disposition"
        style={{
          padding: 16,
          border: "1px solid #cbd5e1",
          borderRadius: 10,
          background: "#ffffff",
        }}
      >
        <h4 style={{ marginTop: 0 }}>Disposition ({dispositions.length})</h4>

        {canManageCampaign && (
          <form
            onSubmit={handleAddDisposition}
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              alignItems: "center",
              marginBottom: 12,
            }}
          >
            <input
              placeholder="New disposition name"
              value={dispositionForm.name}
              onChange={(e) => setDispositionForm((f) => ({ ...f, name: e.target.value }))}
              required
              style={{
                padding: "6px 10px",
                borderRadius: 6,
                border: "1px solid #cbd5e1",
                minWidth: 220,
              }}
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

      {/* 2. Campaign Field Section */}
      <div
        id="section-campaign_field"
        style={{
          padding: 16,
          border: "1px solid #cbd5e1",
          borderRadius: 10,
          background: "#ffffff",
        }}
      >
        <h4 style={{ marginTop: 0 }}>Campaign Field ({callFields.length})</h4>

        {canManageCampaign && (
          <form
            onSubmit={handleAddCallField}
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              alignItems: "center",
              marginBottom: 12,
            }}
          >
            <input
              placeholder="Field label (e.g. City, Amount, Gender)"
              value={fieldForm.label}
              onChange={(e) => setFieldForm((f) => ({ ...f, label: e.target.value }))}
              required
              style={{
                padding: "6px 10px",
                borderRadius: 6,
                border: "1px solid #cbd5e1",
                minWidth: 200,
              }}
            />
            <select
              value={fieldForm.field_type}
              onChange={(e) => setFieldForm((f) => ({ ...f, field_type: e.target.value }))}
              style={{ padding: "6px 8px", borderRadius: 6 }}
            >
              <option value="text">Text</option>
              <option value="number">Number / Amount</option>
              <option value="select">Dropdown</option>
              <option value="radio">Radio (Male / Female)</option>
              <option value="date">Date</option>
            </select>
            {["select", "radio"].includes(fieldForm.field_type) && (
              <input
                placeholder="Options (comma separated, e.g. Male, Female)"
                value={fieldForm.optionsText}
                onChange={(e) => setFieldForm((f) => ({ ...f, optionsText: e.target.value }))}
                style={{
                  padding: "6px 10px",
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
                  minWidth: 210,
                }}
              />
            )}
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

      {/* 3. Create Form Section */}
      <div
        id="section-create_form"
        style={{
          padding: 16,
          border: "1px solid #cbd5e1",
          borderRadius: 10,
          background: "#ffffff",
          display: "grid",
          gap: 14,
        }}
      >
        <h4 style={{ margin: 0 }}>Create Form — {campaign.name}</h4>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ fontSize: 13, fontWeight: 600 }}>
            Disposition:{" "}
            <select
              value={selectedDispositionForForm}
              onChange={(e) => {
                const val = e.target.value;
                setSelectedDispositionForForm(val);
                syncFormConfig(customFormFields, val);
              }}
              style={{ padding: "6px 10px", borderRadius: 6 }}
            >
              <option value="">-- Select Disposition --</option>
              {(dispositions || []).map((d) => (
                <option key={d.id} value={d.name}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {canManageCampaign && (
          <form
            onSubmit={handleAddFormBuilderField}
            style={{
              padding: 10,
              borderRadius: 8,
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <strong style={{ fontSize: 12 }}>Add Form Field:</strong>
            <input
              placeholder="Field label (e.g. City, Amount)"
              value={formBuilderField.label}
              onChange={(e) => setFormBuilderField((f) => ({ ...f, label: e.target.value }))}
              style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid #cbd5e1" }}
            />
            <select
              value={formBuilderField.field_type}
              onChange={(e) => setFormBuilderField((f) => ({ ...f, field_type: e.target.value }))}
              style={{ padding: "5px 8px", borderRadius: 6 }}
            >
              <option value="amount">Amount / Number</option>
              <option value="select">Dropdown</option>
              <option value="radio">Radio (Male / Female)</option>
              <option value="text">Text</option>
            </select>
            {["select", "radio"].includes(formBuilderField.field_type) && (
              <input
                placeholder="Options (comma separated)"
                value={formBuilderField.optionsText}
                onChange={(e) => setFormBuilderField((f) => ({ ...f, optionsText: e.target.value }))}
                style={{
                  padding: "5px 8px",
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
                  minWidth: 180,
                }}
              />
            )}
            <button type="submit" style={{ padding: "5px 10px", borderRadius: 6, cursor: "pointer" }}>
              + Add to Form
            </button>
          </form>
        )}

        <form
          onSubmit={handleSubmitCustomForm}
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 12,
            paddingTop: 4,
          }}
        >
          <label style={{ fontSize: 12, fontWeight: 600 }}>
            Customer Name *
            <input
              required
              placeholder="Enter name"
              value={formSubmission.name}
              onChange={(e) => setFormSubmission((f) => ({ ...f, name: e.target.value }))}
              style={{
                width: "100%",
                padding: "7px 10px",
                borderRadius: 6,
                border: "1px solid #cbd5e1",
                marginTop: 4,
              }}
            />
          </label>

          <label style={{ fontSize: 12, fontWeight: 600 }}>
            Phone Number *
            <input
              required
              placeholder="Enter phone"
              value={formSubmission.phone}
              onChange={(e) => setFormSubmission((f) => ({ ...f, phone: e.target.value }))}
              style={{
                width: "100%",
                padding: "7px 10px",
                borderRadius: 6,
                border: "1px solid #cbd5e1",
                marginTop: 4,
              }}
            />
          </label>

          <label style={{ fontSize: 12, fontWeight: 600 }}>
            Gender (Radio)
            <div style={{ display: "flex", gap: 14, marginTop: 8, fontWeight: 400 }}>
              {["Male", "Female"].map((g) => (
                <label key={g} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <input
                    type="radio"
                    name="campaign_form_gender"
                    checked={formSubmission.gender === g}
                    onChange={() => setFormSubmission((f) => ({ ...f, gender: g }))}
                  />
                  {g}
                </label>
              ))}
            </div>
          </label>

          {customFormFields.map((ff) => {
            const val = formSubmission.custom_values[ff.key] ?? "";
            if (ff.field_type === "radio") {
              const opts = ff.options?.length ? ff.options : ["Male", "Female"];
              return (
                <label key={ff.key} style={{ fontSize: 12, fontWeight: 600 }}>
                  {ff.label}
                  <div
                    style={{
                      display: "flex",
                      gap: 12,
                      marginTop: 8,
                      fontWeight: 400,
                      flexWrap: "wrap",
                    }}
                  >
                    {opts.map((opt) => (
                      <label key={opt} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <input
                          type="radio"
                          name={`form_radio_${ff.key}`}
                          checked={val === opt}
                          onChange={() =>
                            setFormSubmission((f) => ({
                              ...f,
                              custom_values: { ...f.custom_values, [ff.key]: opt },
                            }))
                          }
                        />
                        {opt}
                      </label>
                    ))}
                  </div>
                </label>
              );
            }

            if (ff.field_type === "select") {
              const opts = ff.options?.length ? ff.options : ["Option 1", "Option 2"];
              return (
                <label key={ff.key} style={{ fontSize: 12, fontWeight: 600 }}>
                  {ff.label}
                  <select
                    value={val}
                    onChange={(e) =>
                      setFormSubmission((f) => ({
                        ...f,
                        custom_values: { ...f.custom_values, [ff.key]: e.target.value },
                      }))
                    }
                    style={{
                      width: "100%",
                      padding: "7px 10px",
                      borderRadius: 6,
                      border: "1px solid #cbd5e1",
                      marginTop: 4,
                    }}
                  >
                    <option value="">-- Select {ff.label} --</option>
                    {opts.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </label>
              );
            }

            return (
              <label key={ff.key} style={{ fontSize: 12, fontWeight: 600 }}>
                {ff.label}
                <input
                  type={
                    ff.field_type === "amount" || ff.field_type === "number" ? "number" : "text"
                  }
                  step={ff.field_type === "amount" ? "0.01" : undefined}
                  placeholder={`Enter ${ff.label}`}
                  value={val}
                  onChange={(e) =>
                    setFormSubmission((f) => ({
                      ...f,
                      custom_values: { ...f.custom_values, [ff.key]: e.target.value },
                    }))
                  }
                  style={{
                    width: "100%",
                    padding: "7px 10px",
                    borderRadius: 6,
                    border: "1px solid #cbd5e1",
                    marginTop: 4,
                  }}
                />
              </label>
            );
          })}

          <label style={{ fontSize: 12, fontWeight: 600 }}>
            Notes
            <input
              placeholder="Call / form notes"
              value={formSubmission.notes}
              onChange={(e) => setFormSubmission((f) => ({ ...f, notes: e.target.value }))}
              style={{
                width: "100%",
                padding: "7px 10px",
                borderRadius: 6,
                border: "1px solid #cbd5e1",
                marginTop: 4,
              }}
            />
          </label>

          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button
              type="submit"
              style={{
                padding: "8px 16px",
                borderRadius: 6,
                border: "1px solid #15803d",
                background: "#16a34a",
                color: "#ffffff",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Save Form Entry
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
