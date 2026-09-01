/**
 * Shared (browser + server) import normalization. The authoritative bounded
 * parser lives in `lib/imports/csv-parser.ts` (server-only); this module
 * holds the pure value normalizers both sides agree on.
 */

/** Deterministic normalization for import values. */
export function normalizeImportValue(kind: "email" | "phone" | "name" | "relationship" | "text", raw: string): string {
  const value = raw.trim();
  switch (kind) {
    case "email":
      return value.toLowerCase();
    case "phone": {
      const digits = value.replace(/[^0-9+]/g, "");
      if (digits.startsWith("+91")) return digits;
      if (digits.startsWith("91") && digits.length === 12) return `+${digits}`;
      if (digits.startsWith("0") && digits.length === 11) return `+91${digits.slice(1)}`;
      if (digits.length === 10) return `+91${digits}`;
      return digits.startsWith("+") ? digits : `+${digits}`;
    }
    case "name":
      return value.replace(/\s+/g, " ").trim();
    case "relationship": {
      const lowered = value.toLowerCase();
      if (["father", "mother", "legal guardian", "guardian", "parent", "other"].includes(lowered)) {
        return lowered === "parent" ? "Parent" : lowered.charAt(0).toUpperCase() + lowered.slice(1);
      }
      return value;
    }
    default:
      return value;
  }
}
