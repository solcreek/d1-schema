/**
 * d1-schema — Declarative schema for Cloudflare D1.
 *
 * Define tables in code. Auto-created on first use.
 * No migration files. No CLI. No config.
 *
 * @example
 * ```ts
 * import { define } from "d1-schema";
 *
 * await define(env.DB, {
 *   todos: {
 *     id: "text primary key",
 *     text: "text not null",
 *     completed: "integer default 0",
 *   },
 * });
 * ```
 */

import type { SchemaDefinition, DefineOptions } from "./types.js";
import { hashSchema } from "./hash.js";
import {
  computeOperations,
  applyOperations,
  logOperations,
  D1SchemaError,
} from "./reconcile.js";

// Internal table for schema change log (audit trail)
const ENSURE_LOG = `CREATE TABLE IF NOT EXISTS _d1_schema_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  action TEXT NOT NULL,
  ddl TEXT NOT NULL,
  applied INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
)`;

// In-memory cache: keyed by D1Database object → schema hash.
// Same isolate + same schema + same DB = zero DB queries (~0.01ms).
// New isolate after deploy = fresh cache, runs PRAGMA diff (~3-5ms).
// All DDL is idempotent, so redundant diffs are safe.
const _cache = new WeakMap<object, string>();

/**
 * Define your D1 database schema. Tables are auto-created or altered on first use.
 *
 * Performance:
 * - Same isolate, same schema: ~0.01ms (in-memory hash match, zero DB queries)
 * - New isolate or schema changed: ~3-5ms (PRAGMA diff + idempotent DDL)
 * - No per-request DB overhead — zero extra queries on the hot path
 *
 * @param db - D1Database binding from env
 * @param schema - Table definitions: { tableName: { columnName: "sql column def" } }
 * @param options - { autoMigrate: "apply" | "warn" | "off" }
 */
export async function define(
  db: D1Database,
  schema: SchemaDefinition,
  options?: DefineOptions,
): Promise<void> {
  const mode =
    options?.autoMigrate ??
    (typeof globalThis !== "undefined" &&
    "CREEK_AUTO_MIGRATE" in (globalThis as any)
      ? (globalThis as any).CREEK_AUTO_MIGRATE
      : "apply");

  if (mode === "off") return;

  // Fastest path: in-memory cache hit (same isolate, same schema, same DB)
  const currentHash = await hashSchema(schema);
  if (_cache.get(db) === currentHash) {
    return; // ~0.01ms — zero DB queries
  }

  // Cold path: compute diff via PRAGMA and apply idempotent DDL
  const { operations, warnings } = await computeOperations(db, schema);

  // Log warnings
  for (const w of warnings) {
    console.warn(`[d1-schema] ${w}`);
  }

  if (operations.length === 0) {
    // Schema already matches DB — cache and return
    _cache.set(db, currentHash);
    return;
  }

  if (mode === "warn") {
    // Dry-run: log what would happen
    await db.prepare(ENSURE_LOG).run();
    for (const op of operations) {
      console.warn(`[d1-schema] Would execute: ${op.ddl}`);
    }
    await logOperations(db, operations, false);
    return;
  }

  // Apply idempotent DDL
  await applyOperations(db, operations);

  // Log operations (best-effort — don't fail if log table can't be created)
  try {
    await db.prepare(ENSURE_LOG).run();
    await logOperations(db, operations, true);
  } catch {
    // Log table failure is non-fatal
  }

  _cache.set(db, currentHash);
}

export { D1SchemaError } from "./reconcile.js";
export type { SchemaDefinition, DefineOptions } from "./types.js";
