"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { safeJsonFetch } from "@/lib/crmHelpers";

function getCustomFields(lead) {
  return lead?.custom_fields && typeof lead.custom_fields === "object" ? lead.custom_fields : {};
}

function formatLocalInput(isoVal) {
  if (!isoVal) return "";
  const d = new Date(isoVal);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function matchesFilter(lead, filter) {
  if (filter.status !== "all" && (lead.status || "new") !== filter.status) return false;

  if (filter.disposition !== "all") {
    if (filter.disposition === "__none__" && lead.disposition) return false;
    if (filter.disposition !== "__none__" && (lead.disposition || "") !== filter.disposition) {
      return false;
    }
  }

  const hasFollowUp = Boolean(lead.follow_up_at);
  const wasCalled = Boolean(lead.last_called_at) || (lead.status && lead.status !== "new");
  if (filter.callKind === "fresh" && (hasFollowUp || wasCalled)) return false;
  if (filter.callKind === "followup" && !hasFollowUp && (lead.status || "") !== "follow_up") {
    return false;
  }
  if (filter.callKind === "fresh_and_followup") {
    const isFresh = !hasFollowUp && !wasCalled;
    const isFollowup = hasFollowUp || (lead.status || "") === "follow_up";
    if (!isFresh && !isFollowup) return false;
  }

  if (filter.paramKey && filter.paramValue.trim()) {
    const needle = filter.paramValue.trim().toLowerCase();
    const cf = getCustomFields(lead);
    const val = cf[filter.paramKey] ?? lead[filter.paramKey] ?? "";
    if (!String(val).toLowerCase().includes(needle)) return false;
  }

  return true;
}

export default function DialerSection({
  session,
  profile,
  selectedTenantScope,
  activeProjects,
  selectedProjectId,
  leads,
  callFields,
  dispositions,
  callLogs,
  initialDialLead,
  onClearInitialDialLead,
  onReload,
  onNotify,
}) {
  const [filter, setFilter] = useState({
    project_id: selectedProjectId || "",
    status: "all",
    disposition: "all",
    callKind: "all",
    paramKey: "",
    paramValue: "",
  });

  useEffect(() => {
    if (selectedProjectId && !filter.project_id) {
      setFilter((prev) => ({ ...prev, project_id: selectedProjectId }));
    }
  }, [selectedProjectId, filter.project_id]);

  const [queueActive, setQueueActive] = useState(false);
  const [queueIndex, setQueueIndex] = useState(0);
  const [form, setForm] = useState({
    lead_id: "",
    phone: "",
    status: "connected",
    disposition: "",
    notes: "",
    duration_seconds: 0,
    follow_up_at: "",
    custom_fields: {},
    callStartedAt: null,
  });

  useEffect(() => {
    if (!initialDialLead) return;
    setQueueActive(false);
    setForm({
      lead_id: initialDialLead.id || "",
      phone: initialDialLead.phone || "",
      status: "connected",
      disposition: initialDialLead.disposition || "",
      notes: initialDialLead.notes || "",
      duration_seconds: 0,
      follow_up_at: initialDialLead.follow_up_at ? formatLocalInput(initialDialLead.follow_up_at) : "",
      custom_fields: { ...getCustomFields(initialDialLead) },
      callStartedAt: new Date().toISOString(),
    });
    onNotify(`Started call to ${initialDialLead.name} (${initialDialLead.phone}).`);
    onClearInitialDialLead?.();
  }, [initialDialLead, onClearInitialDialLead, onNotify]);

  const [callLogPage, setCallLogPage] = useState(1);
  const [expandedCallIds, setExpandedCallIds] = useState({});

  const paramOptions = useMemo(() => {
    const base = [{ key: "city", label: "City (city)" }];
    for (const cf of callFields || []) {
      if (cf.field_key && cf.field_key !== "city") {
        base.push({ key: cf.field_key, label: `${cf.label} (${cf.field_key})` });
      }
    }
    return base;
  }, [callFields]);

  const queueLeads = useMemo(() => {
    const pool = filter.project_id
      ? (leads || []).filter((l) => l.project_id === filter.project_id)
      : leads || [];
    return pool.filter((l) => matchesFilter(l, filter));
  }, [leads, filter]);

  const currentLead = useMemo(() => {
    if (queueActive && queueLeads.length > 0) {
      return queueLeads[Math.min(queueIndex, queueLeads.length - 1)] || null;
    }
    if (form.lead_id) {
      return (leads || []).find((l) => l.id === form.lead_id) || null;
    }
    return null;
  }, [queueActive, queueLeads, queueIndex, form.lead_id, leads]);

  const selectedDispositionObj = useMemo(
    () => (dispositions || []).find((d) => d.name === form.disposition) || null,
    [dispositions, form.disposition]
  );

  const CALLS_PER_PAGE = 10;
  const totalPages = Math.max(1, Math.ceil((callLogs || []).length / CALLS_PER_PAGE));
  const pageCalls = useMemo(() => {
    const start = (callLogPage - 1) * CALLS_PER_PAGE;
    return (callLogs || []).slice(start, start + CALLS_PER_PAGE);
  }, [callLogs, callLogPage]);

  function loadLeadIntoForm(lead) {
    if (!lead) return;
    setForm({
      lead_id: lead.id,
      phone: lead.phone || "",
      status: "connected",
      disposition: lead.disposition || "",
      notes: lead.notes || "",
      duration_seconds: 0,
      follow_up_at: lead.follow_up_at ? formatLocalInput(lead.follow_up_at) : "",
      custom_fields: { ...getCustomFields(lead) },
      callStartedAt: null,
    });
  }

  function handleDispositionChange(nextDispositionName) {
    const dispObj = (dispositions || []).find((d) => d.name === nextDispositionName);
    setForm((prev) => {
      const nextFollowUp =
        dispObj?.requires_followup && !prev.follow_up_at
          ? formatLocalInput(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString())
          : prev.follow_up_at;
      return {
        ...prev,
        disposition: nextDispositionName,
        follow_up_at: nextFollowUp,
      };
    });
  }

  function handleApplyQueue(e) {
    e.preventDefault();
    if (queueLeads.length === 0) {
      setQueueActive(false);
      setQueueIndex(0);
      onNotify("No leads match the selected dialer filter.");
      return;
    }
    setQueueActive(true);
    setQueueIndex(0);
    loadLeadIntoForm(queueLeads[0]);
    onNotify(`Loaded ${queueLeads.length} lead(s) into dialer queue (1 of ${queueLeads.length}).`);
  }

  function handleStartCall() {
    if (!form.phone.trim()) {
      onNotify("Select a lead or enter a phone number first.");
      return;
    }
    setForm((prev) => ({ ...prev, status: "connected", callStartedAt: new Date().toISOString() }));
    onNotify(`Call started for ${form.phone}.`);
  }

  function handleEndCall() {
    setForm((prev) => {
      const elapsed = prev.callStartedAt
        ? Math.max(1, Math.round((Date.now() - new Date(prev.callStartedAt).getTime()) / 1000))
        : prev.duration_seconds || 15;
      return { ...prev, duration_seconds: elapsed, callStartedAt: null };
    });
    onNotify("Call ended. Set disposition/follow-up and choose Save & Next or Save & Stop.");
  }

  function handleCancelCall() {
    setForm((prev) => ({ ...prev, callStartedAt: null, duration_seconds: 0, status: "no_answer" }));
    onNotify("Active call cancelled.");
  }

  async function saveCall({ moveToNext }) {
    if (!session?.access_token) return;
    if (!form.phone.trim()) {
      onNotify("Phone number is required to save call log.");
      return;
    }

    const duration = form.callStartedAt
      ? Math.max(1, Math.round((Date.now() - new Date(form.callStartedAt).getTime()) / 1000))
      : Number(form.duration_seconds || 0);

    const res = await safeJsonFetch("/api/calls", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        tenant_id: profile?.role === "super_admin" ? selectedTenantScope || undefined : undefined,
        project_id: filter.project_id || currentLead?.project_id || selectedProjectId || null,
        lead_id: form.lead_id || currentLead?.id || null,
        phone: form.phone.trim(),
        status: form.status,
        disposition: form.disposition || null,
        notes: form.notes || null,
        duration_seconds: duration,
        follow_up_at: form.follow_up_at ? new Date(form.follow_up_at).toISOString() : null,
        custom_fields: form.custom_fields,
      }),
    });

    if (!res.ok) {
      onNotify(res.data?.error || "Failed to save call log.");
      return;
    }

    await onReload();

    if (moveToNext && queueActive && queueLeads.length > 0) {
      const nextIdx = queueIndex + 1;
      if (nextIdx < queueLeads.length) {
        setQueueIndex(nextIdx);
        loadLeadIntoForm(queueLeads[nextIdx]);
        onNotify(`Saved call. Next lead (${nextIdx + 1} of ${queueLeads.length}): ${queueLeads[nextIdx].name}.`);
      } else {
        setQueueActive(false);
        setQueueIndex(0);
        onNotify("Saved call. End of filtered queue reached.");
      }
    } else {
      setQueueActive(false);
      setForm((prev) => ({ ...prev, callStartedAt: null, notes: "", follow_up_at: "" }));
      onNotify("Call saved and dialer stopped.");
    }
  }

  async function handleQuickFollowUp(leadId) {
    if (!session?.access_token || !leadId) return;
    const res = await safeJsonFetch("/api/leads", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        lead_id: leadId,
        status: "follow_up",
        follow_up_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      }),
    });
    if (!res.ok) {
      onNotify(res.data?.error || "Failed to schedule follow-up.");
      return;
    }
    onNotify("Scheduled +24h follow-up for lead.");
    await onReload();
  }

  return (
    <section>
      <h3>SmartCall Dialer Console</h3>

      <form
        onSubmit={handleApplyQueue}
        style={{
          padding: 12,
          border: "1px solid #cbd5e1",
          borderRadius: 8,
          background: "#f8fafc",
          marginBottom: 16,
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <select
          value={filter.project_id}
          onChange={(e) => setFilter((f) => ({ ...f, project_id: e.target.value }))}
        >
