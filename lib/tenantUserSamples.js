export function pickTenantSampleUserIds(tenantUsers = []) {
  const activeWithId = (tenantUsers || [])
    .filter((u) => u && u.is_active !== false && String(u.user_id || "").trim())
    .map((u) => String(u.user_id).trim());

  const allWithId = (tenantUsers || [])
    .map((u) => String(u?.user_id || "").trim())
    .filter(Boolean);

  const pool = activeWithId.length > 0 ? activeWithId : allWithId;
  return {
    firstUserId: pool[0] || "",
    secondUserId: pool[1] || pool[0] || "",
  };
}

export function buildSampleLeadsCsv(tenantUsers = []) {
  const { firstUserId, secondUserId } = pickTenantSampleUserIds(tenantUsers);

  const rows = [
    ["name", "phone", "email", "serial_number", "user_id"],
    ["Rahul Sharma", "9876543210", "rahul@example.com", "SN-1001", firstUserId],
    ["Priya Nair", "9876543211", "priya@example.com", "SN-1002", secondUserId],
  ];

  return rows
    .map((row) =>
      row.map((val) => `"${String(val ?? "").replace(/"/g, '""')}"`).join(",")
    )
    .join("\n");
}

export function downloadSampleLeadsCsv(tenantUsers = [], filename = "sample-leads.csv") {
  const csv = buildSampleLeadsCsv(tenantUsers);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function buildSampleIngestCurl(campaignId, tenantUsers = [], baseUrl = "") {
  const { firstUserId, secondUserId } = pickTenantSampleUserIds(tenantUsers);
  const origin = String(
    baseUrl ||
      (typeof window !== "undefined"
        ? window.location.origin
        : "https://s2c-telecalling-crm.vercel.app")
  ).replace(/\/$/, "");

  const payload = {
    leads: [
      {
        name: "Rahul Sharma",
        phone: "9876543210",
        email: "rahul@example.com",
        serial_number: "SN-1001",
        user_id: firstUserId,
      },
      {
        name: "Priya Nair",
        phone: "9876543211",
        email: "priya@example.com",
        serial_number: "SN-1002",
        user_id: secondUserId,
      },
    ],
  };

  return `curl --location --request POST '${origin}/api/campaigns/${campaignId}/ingest' \\
--header 'Content-Type: application/json' \\
--data-raw '${JSON.stringify(payload, null, 2)}'`;
}
