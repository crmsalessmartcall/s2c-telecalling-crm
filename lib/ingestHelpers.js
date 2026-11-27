export function normalizeFieldKey(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Normalizes Indian / international phone digits and validates digit length.
 * Strips spaces, dashes, parentheses, leading '+', and leading '91' when 12 digits.
 */
export function normalizeAndValidatePhone(rawPhone) {
  const rawStr = String(rawPhone ?? "").trim();
  if (!rawStr) {
    return { valid: false, normalized: "", reason: "Missing phone number" };
  }

  let digits = rawStr.replace(/[^\d]/g, "");
  if (digits.length === 12 && digits.startsWith("91")) {
    digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith("0")) {
    digits = digits.slice(1);
  }

  if (!/^\d{10}$/.test(digits)) {
    return {
      valid: false,
      normalized: digits,
      reason: `Invalid phone length (${digits.length} digits): expected 10 digits`,
    };
  }

  return { valid: true, normalized: digits, reason: "" };
}

export function extractCustomFieldsFromRow(row, knownStdKeys = new Set()) {
  const custom =
    row?.custom_fields && typeof row.custom_fields === "object" && !Array.isArray(row.custom_fields)
      ? { ...row.custom_fields }
      : {};

  for (const [key, val] of Object.entries(row || {})) {
    if (key === "custom_fields" || knownStdKeys.has(key)) continue;
    if (val !== undefined && val !== null && String(val).trim() !== "") {
      custom[normalizeFieldKey(key) || key] = val;
    }
  }

  return custom;
}
