export async function safeJsonFetch(url, options = {}) {
  const res = await fetch(url, options);
  const raw = await res.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = {
      error: res.ok ? "Invalid server response" : `Request failed (${res.status}) for ${url}`,
    };
  }
  return { ok: res.ok, status: res.status, data };
}

export function parseCsvRows(csvText) {
  const lines = String(csvText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) return { headers: [], rows: [] };

  const splitLine = (line) => {
    const out = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === "," && !inQuotes) {
        out.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur.trim());
    return out;
  };

  const headers = splitLine(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const vals = splitLine(line);
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = vals[idx] ?? "";
    });
    return obj;
  });

  return { headers, rows };
}

export function downloadSampleCsv(campaignName = "campaign", callFields = []) {
  const extraCols = (callFields || [])
    .map((f) => f.field_key)
    .filter((k) => k && !["name", "phone", "email", "notes", "follow_up_at"].includes(k));

  const headers = ["name", "phone", "email", "notes", "follow_up_at", ...extraCols];
  const sampleRow = [
    "Amit Verma",
    "9876543210",
    "amit@example.com",
    "Interested in callback",
    "",
    ...extraCols.map((col) => (col === "city" ? "Pune" : `sample_${col}`)),
  ];

  const csvContent = `${headers.join(",")}\n${sampleRow.join(",")}\n`;
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${String(campaignName || "campaign")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")}_sample_leads.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
