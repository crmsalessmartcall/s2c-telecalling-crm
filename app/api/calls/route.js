function toIsoOrNull(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// Inside POST:
const followUpAt = toIsoOrNull(body.follow_up_at);
const startedAt =
  toIsoOrNull(body.started_at) || new Date(Date.now() - durationSeconds * 1000).toISOString();
const endedAt = toIsoOrNull(body.ended_at) || nowIso;

// When updating the lead:
const requestedLeadStatus = String(body.lead_status || "").trim();
const isClosedLeadStatus = ["closed", "converted", "completed", "won", "lost"].includes(
  requestedLeadStatus.toLowerCase()
);

if (followUpAt) {
  leadPatch.follow_up_at = followUpAt;
  leadPatch.status = "follow_up";
  leadPatch.is_closed = false;
} else if (requestedLeadStatus) {
  leadPatch.status = requestedLeadStatus;
  if (isClosedLeadStatus) {
    leadPatch.is_closed = true;
    leadPatch.follow_up_at = null;
  }
} else if (status === "connected" || status === "completed") {
  leadPatch.status = "contacted";
}
