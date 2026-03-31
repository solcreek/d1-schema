import type { SchemaDefinition } from "./types.js";

/**
 * Compute a deterministic hash of a schema definition.
 * Used for fast skip when schema hasn't changed.
 */
export async function hashSchema(schema: SchemaDefinition): Promise<string> {
  // Stable JSON: sort keys to ensure determinism
  const sorted = Object.keys(schema)
    .sort()
    .reduce<Record<string, Record<string, string>>>((acc, table) => {
      const cols = schema[table];
      acc[table] = Object.keys(cols)
        .sort()
        .reduce<Record<string, string>>((colAcc, col) => {
          colAcc[col] = cols[col];
          return colAcc;
        }, {});
      return acc;
    }, {});

  const json = JSON.stringify(sorted);

  // Use Web Crypto API (available in Workers and Node 19+)
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const buf = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(json),
    );
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  // Fallback: simple string hash (for test environments without crypto.subtle)
  let hash = 0;
  for (let i = 0; i < json.length; i++) {
    const ch = json.charCodeAt(i);
    hash = ((hash << 5) - hash + ch) | 0;
  }
  return Math.abs(hash).toString(36);
}
