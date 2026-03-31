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

// Internal tables for tracking schema state
const ENSURE_META = `CREATE TABLE IF NOT EXISTS _d1_schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`;
const ENSURE_LOG = `CREATE TABLE IF NOT EXISTS _d1_schema_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  action TEXT NOT NULL,
  ddl TEXT NOT NULL,
  applied INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
)`;

/**
 * Define your D1 database schema. Tables are auto-created or altered on first use.
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

  // Ensure internal tables exist
  await db.prepare(ENSURE_META).run();

  // Fast path: compare hash
  const currentHash = await hashSchema(schema);
  const stored = await db
    .prepare(`SELECT value FROM _d1_schema_meta WHERE key = 'schema_hash'`)
    .first<{ value: string }>();

  if (stored?.value === currentHash) {
    return; // Schema unchanged — skip reconciliation
  }

  // Ensure log table exists (only needed on schema change)
  await db.prepare(ENSURE_LOG).run();

  // Compute diff
  const { operations, warnings } = await computeOperations(db, schema);

  // Log warnings
  for (const w of warnings) {
    console.warn(`[d1-schema] ${w}`);
  }

  if (operations.length === 0) {
    // No DDL needed — just update hash
    await upsertHash(db, currentHash);
    return;
  }

  if (mode === "warn") {
    // Dry-run: log what would happen
    for (const op of operations) {
      console.warn(`[d1-schema] Would execute: ${op.ddl}`);
    }
    await logOperations(db, operations, false);
    return;
  }

  // Apply
  await applyOperations(db, operations);
  await logOperations(db, operations, true);
  await upsertHash(db, currentHash);
}

async function upsertHash(db: D1Database, hash: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO _d1_schema_meta (key, value) VALUES ('schema_hash', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .bind(hash)
    .run();
}

export { D1SchemaError } from "./reconcile.js";
export type { SchemaDefinition, DefineOptions } from "./types.js";
