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
  forms = [],
  canManageCampaign,
  onReloadAll,
  onNotify,
  onPatchCampaign,
  onUpdateCampaignConfig,
}) {
  // Details & Edit mode selector: "" | "disposition" | "form_field" | "custom_field"
  const [editingDetails, setEditingDetails] = useState(false);
  const [editTargetSection, setEditTargetSection] = useState("");
  const [detailsForm, setDetailsForm] = useState({
    name: campaign?.name || "",
    description: campaign?.description || "",
    hide_phone_numbers: Boolean(campaign?.hide_phone_numbers),
    auto_dial: Boolean(campaign?.auto_dial),
  });
  const [savingDetails, setSavingDetails] = useState(false);

  // Two-layer disposition state: Primary + Secondary sub-dispositions
  const [primaryDispName, setPrimaryDispName] = useState("");
  const [secondaryDispInput, setSecondaryDispInput] = useState("");
  const [requiresFollowup, setRequiresFollowup] = useState(false);
  const [editingDispId, setEditingDispId] = useState(null);
  const [editingDispForm, setEditingDispForm] = useState({
    name: "",
    secondaryText: "",
    requires_followup: false,
  });

  // Campaign Field state (Text, Number, Dropdown, Radio, Date + Editable & Display toggles + Apply)
  const [fieldForm, setFieldForm] = useState({
    label: "",
    field_type: "text",
    optionsText: "",
    is_editable: true,
    is_displayed: true,
  });
  const [fieldDraftFlags, setFieldDraftFlags] = useState({});

  // Create Form state (Form Name + Dynamic Fields + Link to 1 or multiple dispositions)
  const [formName, setFormName] = useState("");
  const [linkedDispositions, setLinkedDispositions] = useState([]);
  const [newFormField, setNewFormField] = useState({
    label: "",
    field_type: "number",
    optionsText: "Mumbai, Pune, Bangalore",
  });
  const [draftFormFields, setDraftFormFields] = useState([]);

  // Active form submission preview when a mapped disposition is selected
  const [selectedTestDisposition, setSelectedTestDisposition] = useState("");
  const [formValues, setFormValues] = useState({
    customer_name: "",
    phone: "",
    dynamic: {},
  });

  useEffect(() => {
    setDetailsForm({
      name: campaign?.name || "",
      description: campaign?.description || "",
      hide_phone_numbers: Boolean(campaign?.hide_phone_numbers),
      auto_dial: Boolean(campaign?.auto_dial),
    });
    setEditingDetails(false);
    setEditTargetSection("");
  }, [campaign]);

  useEffect(() => {
    const nextFlags = {};
    for (const cf of callFields || []) {
      nextFlags[cf.id] = {
        is_editable: cf.is_editable !== false,
        is_displayed: cf.is_displayed !== false,
      };
    }
    setFieldDraftFlags(nextFlags);
  }, [callFields]);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const ingestEndpoint = campaign?.id ? `${origin}/api/campaigns/${campaign.id}/ingest` : "—";

  const visibleFormsForDisposition = (forms || []).filter((fm) => {
    if (!selectedTestDisposition) return false;
    const linked = Array.isArray(fm.linked_dispositions) ? fm.linked_dispositions : [];
    return linked.includes(selectedTestDisposition);
  });

  async function handleSaveDetails(e) {
    e.preventDefault();
    if (!campaign?.id) return;
    setSavingDetails(true);
    try {
      const nextPatch = {
        name: detailsForm.name.trim() || campaign.name,
        description: detailsForm.description,
        hide_phone_numbers: Boolean(detailsForm.hide_phone_numbers),
        auto_dial: Boolean(detailsForm.auto_dial),
      };

      onPatchCampaign?.(nextPatch);

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
            ...nextPatch,
            tenant_id: profile?.role === "super_admin" ? selectedTenantScope || undefined : undefined,
          }),
        });
      }

      setEditingDetails(false);
      onNotify?.(
        `Updated campaign settings (Hide phone numbers: ${
          nextPatch.hide_phone_numbers ? "Enabled" : "Disabled"
        }).`
      );
      await onReloadAll?.();
    } finally {
      setSavingDetails(false);
    }
  }

  async function handleAddDisposition(e) {
    e.preventDefault();
    if (!primaryDispName.trim()) return;
    const cleanPrimary = primaryDispName.trim();
    const secondaryList = secondaryDispInput
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const createdDisp = {
      id: `disp-${Date.now()}`,
      name: cleanPrimary,
      secondary_options: secondaryList,
      requires_followup: requiresFollowup,
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
          name: cleanPrimary,
          secondary_options: secondaryList,
          requires_followup: requiresFollowup,
          project_id: campaign.id,
          tenant_id: profile?.role === "super_admin" ? selectedTenantScope || undefined : undefined,
        }),
      });
    }

    onUpdateCampaignConfig?.((cur) => ({
      ...cur,
      dispositions: [...(cur.dispositions || dispositions || []), createdDisp],
    }));
    setPrimaryDispName("");
    setSecondaryDispInput("");
    setRequiresFollowup(false);
    onNotify?.(`Added primary disposition "${cleanPrimary}".`);
    await onReloadAll?.();
  }

  async function handleSaveDispositionEdit(e, disp) {
    e.preventDefault();
    if (!disp?.id || !editingDispForm.name.trim()) return;
    const updatedName = editingDispForm.name.trim();
    const updatedSecondary = editingDispForm.secondaryText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

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
          secondary_options: updatedSecondary,
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
              secondary_options: updatedSecondary,
              requires_followup: editingDispForm.requires_followup,
            }
          : item
      ),
    }));
    setEditingDispId(null);
    onNotify?.("Disposition updated.");
    await onReloadAll?.();
  }

  async function handleAddCampaignField(e) {
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
      is_editable: Boolean(fieldForm.is_editable),
      is_displayed: Boolean(fieldForm.is_displayed),
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
          is_editable: createdField.is_editable,
          is_displayed: createdField.is_displayed,
          project_id: campaign.id,
          tenant_id: profile?.role === "super_admin" ? selectedTenantScope || undefined : undefined,
        }),
      });
    }

    onUpdateCampaignConfig?.((cur) => ({
      ...cur,
      fields: [...(cur.fields || callFields || []), createdField],
    }));
    setFieldForm({
      label: "",
      field_type: "text",
      optionsText: "",
      is_editable: true,
      is_displayed: true,
    });
    onNotify?.(`Added campaign field "${label}".`);
    await onReloadAll?.();
  }

  async function handleApplyFieldFlags() {
    const updatedFields = (callFields || []).map((cf) => {
      const draft = fieldDraftFlags[cf.id] || {
        is_editable: cf.is_editable !== false,
        is_displayed: cf.is_displayed !== false,
      };
      return {
        ...cf,
        is_editable: Boolean(draft.is_editable),
        is_displayed: Boolean(draft.is_displayed),
      };
    });

    onUpdateCampaignConfig?.((cur) => ({
      ...cur,
      fields: updatedFields,
    }));

    if (session?.access_token) {
      for (const uf of updatedFields) {
        await safeJsonFetch("/api/call-config", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            kind: "field",
            id: uf.id,
            is_editable: uf.is_editable,
            is_displayed: uf.is_displayed,
            project_id: campaign.id,
          }),
        });
      }
    }

    onNotify?.("Applied Editable & Display field settings.");
  }

  async function handleDeleteCampaignField(field) {
    if (!field?.id) return;
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

  function handleAddFieldToFormDraft(e) {
    e.preventDefault();
    if (!newFormField.label.trim()) return;
    const label = newFormField.label.trim();
    const key = toKey(label) || `form_field_${Date.now()}`;
    const opts = newFormField.optionsText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    setDraftFormFields((prev) => [
      ...prev,
      {
        key,
        label,
        field_type: newFormField.field_type,
        options: ["select", "radio"].includes(newFormField.field_type) ? opts : [],
      },
    ]);
    setNewFormField({
      label: "",
      field_type: "select",
      optionsText: "Mumbai, Pune, Bangalore",
    });
  }

  function toggleLinkedDisposition(dispName) {
    setLinkedDispositions((prev) =>
      prev.includes(dispName) ? prev.filter((d) => d !== dispName) : [...prev, dispName]
    );
  }

  function handleSaveCreatedForm(e) {
    e.preventDefault();
    if (!formName.trim()) return;
    const createdForm = {
      id: `form-${Date.now()}`,
      name: formName.trim(),
      linked_dispositions: [...linkedDispositions],
      fields: [...draftFormFields],
    };

    onUpdateCampaignConfig?.((cur) => ({
      ...cur,
      forms: [...(cur.forms || forms || []), createdForm],
    }));

    setFormName("");
    setLinkedDispositions([]);
    setDraftFormFields([]);
    onNotify?.(`Saved form "${createdForm.name}" with ${createdForm.fields.length} field(s).`);
  }

  async function handleSubmitLinkedForm(e, activeForm) {
    e.preventDefault();
    if (!campaign?.id) return;

    if (session?.access_token) {
      await safeJsonFetch("/api/leads", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          name: formValues.customer_name,
          phone: formValues.phone,
          disposition: selectedTestDisposition || null,
          custom_fields: {
            form_name: activeForm.name,
            ...(formValues.dynamic || {}),
          },
          source: "linked_campaign_form",
          project_id: campaign.id,
          tenant_id: profile?.role === "super_admin" ? selectedTenantScope || undefined : undefined,
        }),
      });
    }

    setFormValues({ customer_name: "", phone: "", dynamic: {} });
    onNotify?.(`Saved "${activeForm.name}" submission under disposition "${selectedTestDisposition}".`);
    await onReloadAll?.();
  }

  const showDispositionSection = !editTargetSection || editTargetSection === "disposition";
  const showCustomFieldSection = !editTargetSection || editTargetSection === "custom_field";
  const showFormFieldSection = !editTargetSection || editTargetSection === "form_field";

  return (
    <div style={{ display: "grid", gap: 18 }}>
      {/* Campaign Details (No Email row; Hide phone numbers toggle works on Edit) */}
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
          <h3 style={{ margin: 0 }}>Details</h3>

          {canManageCampaign && (
            <label style={{ fontSize: 12, fontWeight: 700 }}>
              Edit Section:{" "}
              <select
                value={editTargetSection}
                onChange={(e) => setEditTargetSection(e.target.value)}
                style={{ padding: "5px 9px", borderRadius: 7, background: "#f8fafc" }}
              >
                <option value="">Show All</option>
                <option value="disposition">Disposition</option>
                <option value="form_field">Form Field</option>
                <option value="custom_field">Custom Field</option>
              </select>
            </label>
          )}
        </div>

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
              <div>
                <strong>{campaign.hide_phone_numbers ? "Enabled" : "Disabled"}</strong>
              </div>

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
            </div>

            {canManageCampaign && (
              <button
                type="button"
                onClick={() => {
                  setDetailsForm({
                    name: campaign?.name || "",
                    description: campaign?.description || "",
                    hide_phone_numbers: Boolean(campaign?.hide_phone_numbers),
                    auto_dial: Boolean(campaign?.auto_dial),
                  });
                  setEditingDetails(true);
                }}
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
              <label style={{ fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={Boolean(detailsForm.hide_phone_numbers)}
                  onChange={(e) =>
                    setDetailsForm((f) => ({ ...f, hide_phone_numbers: e.target.checked }))
                  }
                />{" "}
                Hide phone numbers (mask customer numbers)
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={Boolean(detailsForm.auto_dial)}
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

      {/* 1. Two-Layer Dispositions (Primary + Secondary) */}
      {showDispositionSection && (
        <div
          style={{
            padding: 16,
            border: "1px solid #cbd5e1",
            borderRadius: 10,
            background: "#ffffff",
          }}
        >
          <h4 style={{ marginTop: 0 }}>Disposition (Primary & Secondary — {dispositions.length})</h4>

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
                placeholder="Primary disposition (e.g. Interested)"
                value={primaryDispName}
                onChange={(e) => setPrimaryDispName(e.target.value)}
                required
                style={{
                  padding: "6px 10px",
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
                  minWidth: 190,
                }}
              />
              <input
                placeholder="Secondary dispositions (comma separated)"
                value={secondaryDispInput}
                onChange={(e) => setSecondaryDispInput(e.target.value)}
                style={{
                  padding: "6px 10px",
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
                  minWidth: 230,
                }}
              />
              <label style={{ fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={requiresFollowup}
                  onChange={(e) => setRequiresFollowup(e.target.checked)}
                />{" "}
                Follow-Up
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
                <th>Primary Disposition</th>
                <th>Secondary Dispositions</th>
                <th>Follow-Up</th>
                {canManageCampaign && <th>Modify</th>}
              </tr>
            </thead>
            <tbody>
              {(dispositions || []).map((d) => {
                const isEditing = editingDispId === d.id;
                const secList = Array.isArray(d.secondary_options) ? d.secondary_options : [];
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
                        <input
                          placeholder="Sub1, Sub2"
                          value={editingDispForm.secondaryText}
                          onChange={(e) =>
                            setEditingDispForm((f) => ({ ...f, secondaryText: e.target.value }))
                          }
                          style={{ padding: "4px 8px", width: "100%" }}
                        />
                      ) : secList.length > 0 ? (
                        secList.join(", ")
                      ) : (
                        "—"
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
                          Follow-Up
                        </label>
                      ) : d.requires_followup ? (
                        "Required"
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
                                secondaryText: secList.join(", "),
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
                  <td colSpan={canManageCampaign ? 4 : 3}>No dispositions added yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* 2. Campaign Fields (Text, Number, Dropdown, Radio, Date + Editable & Display + Apply) */}
      {showCustomFieldSection && (
        <div
          style={{
            padding: 16,
            border: "1px solid #cbd5e1",
            borderRadius: 10,
            background: "#ffffff",
            display: "grid",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <h4 style={{ margin: 0 }}>Campaign Field ({callFields.length})</h4>
            {canManageCampaign && (callFields || []).length > 0 && (
              <button
                type="button"
                onClick={handleApplyFieldFlags}
                style={{
                  padding: "6px 14px",
                  borderRadius: 6,
                  border: "1px solid #1d4ed8",
                  background: "#2563eb",
                  color: "#ffffff",
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                Apply Field Settings
              </button>
            )}
          </div>

          {canManageCampaign && (
            <form
              onSubmit={handleAddCampaignField}
              style={{
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <input
                placeholder="Field label"
                value={fieldForm.label}
                onChange={(e) => setFieldForm((f) => ({ ...f, label: e.target.value }))}
                required
                style={{
                  padding: "6px 10px",
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
                  minWidth: 180,
                }}
              />
              <select
                value={fieldForm.field_type}
                onChange={(e) => setFieldForm((f) => ({ ...f, field_type: e.target.value }))}
                style={{ padding: "6px 8px", borderRadius: 6 }}
              >
                <option value="text">Text</option>
                <option value="number">Number</option>
                <option value="select">Dropdown</option>
                <option value="radio">Radio</option>
                <option value="date">Date</option>
              </select>
              {["select", "radio"].includes(fieldForm.field_type) && (
                <input
                  placeholder="Options (comma separated)"
                  value={fieldForm.optionsText}
                  onChange={(e) => setFieldForm((f) => ({ ...f, optionsText: e.target.value }))}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 6,
                    border: "1px solid #cbd5e1",
                    minWidth: 200,
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
              <label style={{ fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={fieldForm.is_displayed}
                  onChange={(e) => setFieldForm((f) => ({ ...f, is_displayed: e.target.checked }))}
                />{" "}
                Display
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
                <th>Type</th>
                <th>Editable</th>
                <th>Display</th>
                {canManageCampaign && <th>Delete</th>}
              </tr>
            </thead>
            <tbody>
              {(callFields || []).map((cf) => {
                const draft = fieldDraftFlags[cf.id] || {
                  is_editable: cf.is_editable !== false,
                  is_displayed: cf.is_displayed !== false,
                };
                return (
                  <tr key={cf.id}>
                    <td><strong>{cf.label}</strong></td>
                    <td><code>{cf.field_type || "text"}</code></td>
                    <td>
                      <label style={{ fontSize: 12 }}>
                        <input
                          type="checkbox"
                          disabled={!canManageCampaign}
                          checked={Boolean(draft.is_editable)}
                          onChange={(e) =>
                            setFieldDraftFlags((prev) => ({
                              ...prev,
                              [cf.id]: { ...draft, is_editable: e.target.checked },
                            }))
                          }
                        />{" "}
                        {draft.is_editable ? "Editable" : "Read-Only"}
                      </label>
                    </td>
                    <td>
                      <label style={{ fontSize: 12 }}>
                        <input
                          type="checkbox"
                          disabled={!canManageCampaign}
                          checked={Boolean(draft.is_displayed)}
                          onChange={(e) =>
                            setFieldDraftFlags((prev) => ({
                              ...prev,
                              [cf.id]: { ...draft, is_displayed: e.target.checked },
                            }))
                          }
                        />{" "}
                        {draft.is_displayed ? "Display" : "Hidden"}
                      </label>
                    </td>
                    {canManageCampaign && (
                      <td>
                        <button
                          type="button"
                          onClick={() => handleDeleteCampaignField(cf)}
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
                  <td colSpan={canManageCampaign ? 5 : 4}>No campaign fields added yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* 3. Create Form (Form Name + Multiple Fields + Link to Specific or Multiple Dispositions) */}
      {showFormFieldSection && (
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
          <h4 style={{ margin: 0 }}>Create Form ({forms.length})</h4>

          {canManageCampaign && (
            <form onSubmit={handleSaveCreatedForm} style={{ display: "grid", gap: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 700, maxWidth: 360 }}>
                Form Name *
                <input
                  required
                  placeholder="e.g. Inventory Detail"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "7px 10px",
                    borderRadius: 6,
                    border: "1px solid #cbd5e1",
                    marginTop: 4,
                  }}
                />
              </label>

              {/* Link Form to One or Multiple Dispositions */}
              <div style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700 }}>
                  Link Form to Disposition(s) (form shows only when a linked disposition is selected):
                </span>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 12 }}>
                  {(dispositions || []).map((d) => (
                    <label key={d.id} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <input
                        type="checkbox"
                        checked={linkedDispositions.includes(d.name)}
                        onChange={() => toggleLinkedDisposition(d.name)}
                      />
                      {d.name}
                    </label>
                  ))}
                  {(dispositions || []).length === 0 && (
                    <span style={{ color: "#64748b" }}>
                      Add dispositions above first to link them to this form.
                    </span>
                  )}
                </div>
              </div>

              {/* Add Fields Inside This Form */}
              <div
                style={{
                  padding: 10,
                  borderRadius: 8,
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  display: "grid",
                  gap: 8,
                }}
              >
                <strong style={{ fontSize: 12 }}>Add Field to "{formName || "Form"}"</strong>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <input
                    placeholder="Field label (e.g. Quantity, City)"
                    value={newFormField.label}
                    onChange={(e) =>
                      setNewFormField((f) => ({ ...f, label: e.target.value }))
                    }
                    style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #cbd5e1" }}
                  />
                  <select
                    value={newFormField.field_type}
                    onChange={(e) =>
                      setNewFormField((f) => ({ ...f, field_type: e.target.value }))
                    }
                    style={{ padding: "6px 8px", borderRadius: 6 }}
                  >
                    <option value="number">Number</option>
                    <option value="select">Dropdown</option>
                    <option value="radio">Radio</option>
                    <option value="text">Text</option>
                    <option value="date">Date</option>
                  </select>
                  {["select", "radio"].includes(newFormField.field_type) && (
                    <input
                      placeholder="Options (e.g. Mumbai, Pune, Bangalore)"
                      value={newFormField.optionsText}
                      onChange={(e) =>
                        setNewFormField((f) => ({ ...f, optionsText: e.target.value }))
                      }
                      style={{
                        padding: "6px 8px",
                        borderRadius: 6,
                        border: "1px solid #cbd5e1",
                        minWidth: 220,
                      }}
                    />
                  )}
                  <button
                    type="button"
                    onClick={handleAddFieldToFormDraft}
                    style={{ padding: "6px 10px", borderRadius: 6, cursor: "pointer" }}
                  >
                    + Add Form Field
                  </button>
                </div>

                {draftFormFields.length > 0 && (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 12 }}>
                    {draftFormFields.map((df, i) => (
                      <span
                        key={`${df.key}-${i}`}
                        style={{
                          padding: "3px 8px",
                          borderRadius: 6,
                          background: "#ffffff",
                          border: "1px solid #cbd5e1",
                        }}
                      >
                        <strong>{df.label}</strong> ({df.field_type}
                        {df.options?.length ? `: ${df.options.join(", ")}` : ""})
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div>
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
                  Save Form
                </button>
              </div>
            </form>
          )}

          {/* Disposition Triggered Form Render (Hidden unless a linked disposition is selected) */}
          <div
            style={{
              paddingTop: 10,
              borderTop: "1px solid #e2e8f0",
              display: "grid",
              gap: 10,
            }}
          >
            <label style={{ fontSize: 12, fontWeight: 700 }}>
              Select Disposition to Fill Linked Form:{" "}
              <select
                value={selectedTestDisposition}
                onChange={(e) => setSelectedTestDisposition(e.target.value)}
                style={{ padding: "6px 10px", borderRadius: 6 }}
              >
                <option value="">-- Choose Disposition --</option>
                {(dispositions || []).map((d) => (
                  <option key={d.id} value={d.name}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>

            {visibleFormsForDisposition.map((activeForm) => (
              <form
                key={activeForm.id}
                onSubmit={(e) => handleSubmitLinkedForm(e, activeForm)}
                style={{
                  padding: 12,
                  borderRadius: 8,
                  border: "1px solid #cbd5e1",
                  background: "#f8fafc",
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                  gap: 10,
                }}
              >
                <div style={{ gridColumn: "1 / -1", fontWeight: 700, fontSize: 13 }}>
                  Form: {activeForm.name} (Disposition: {selectedTestDisposition})
                </div>
                <input
                  required
                  placeholder="Customer Name *"
                  value={formValues.customer_name}
                  onChange={(e) =>
                    setFormValues((f) => ({ ...f, customer_name: e.target.value }))
                  }
                />
                <input
                  required
                  placeholder="Phone *"
                  value={formValues.phone}
                  onChange={(e) => setFormValues((f) => ({ ...f, phone: e.target.value }))}
                />
                {(activeForm.fields || []).map((ff) => {
                  const val = formValues.dynamic[ff.key] ?? "";
                  if (ff.field_type === "select") {
                    return (
                      <select
                        key={ff.key}
                        value={val}
                        onChange={(e) =>
                          setFormValues((f) => ({
                            ...f,
                            dynamic: { ...f.dynamic, [ff.key]: e.target.value },
                          }))
                        }
                      >
                        <option value="">-- {ff.label} --</option>
                        {(ff.options || []).map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    );
                  }
                  if (ff.field_type === "radio") {
                    return (
                      <div key={ff.key} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
                        <strong>{ff.label}:</strong>
                        {(ff.options || []).map((opt) => (
                          <label key={opt}>
                            <input
                              type="radio"
                              name={`dyn_${activeForm.id}_${ff.key}`}
                              checked={val === opt}
                              onChange={() =>
                                setFormValues((f) => ({
                                  ...f,
                                  dynamic: { ...f.dynamic, [ff.key]: opt },
                                }))
                              }
                            />{" "}
                            {opt}
                          </label>
                        ))}
                      </div>
                    );
                  }
                  return (
                    <input
                      key={ff.key}
                      type={ff.field_type === "number" ? "number" : ff.field_type === "date" ? "date" : "text"}
                      placeholder={ff.label}
                      value={val}
                      onChange={(e) =>
                        setFormValues((f) => ({
                          ...f,
                          dynamic: { ...f.dynamic, [ff.key]: e.target.value },
                        }))
                      }
                    />
                  );
                })}
                <button
                  type="submit"
                  style={{
                    padding: "7px 12px",
                    borderRadius: 6,
                    border: "1px solid #15803d",
                    background: "#16a34a",
                    color: "#ffffff",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Submit {activeForm.name}
                </button>
              </form>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
