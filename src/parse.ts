import type { ParsedColumn } from "./types.js";

/**
 * Parse a SQL column definition string into structured parts.
 *
 * Examples:
 *   "text primary key"           → { type: "TEXT", primaryKey: true, ... }
 *   "integer not null default 0" → { type: "INTEGER", notNull: true, defaultValue: "0", ... }
 *   "text unique"                → { type: "TEXT", unique: true, ... }
 *   "text default (datetime('now'))" → { type: "TEXT", defaultValue: "(datetime('now'))", ... }
 */
export function parseColumnDef(name: string, def: string): ParsedColumn {
  const upper = def.toUpperCase();
  const normalized = def.replace(/\s+/g, " ").trim();

  // Extract type (first word)
  const typeMatch = normalized.match(/^(\w+)/);
  const type = typeMatch ? typeMatch[1].toUpperCase() : "TEXT";

  // Check constraints
  const primaryKey = upper.includes("PRIMARY KEY");
  const notNull = upper.includes("NOT NULL") || primaryKey; // PK implies NOT NULL
  const unique = upper.includes("UNIQUE") || primaryKey;

  // Extract default value — handles both simple and parenthesized defaults
  let defaultValue: string | undefined;
  const defaultMatch = normalized.match(/DEFAULT\s+(\([^)]+\)|'[^']*'|"[^"]*"|\S+)/i);
  if (defaultMatch) {
    defaultValue = defaultMatch[1];
  }

  return { name, type, notNull, unique, primaryKey, defaultValue };
}

/**
 * Parse all columns for a table definition.
 */
export function parseTableDef(
  columns: Record<string, string>,
): ParsedColumn[] {
  return Object.entries(columns).map(([name, def]) => parseColumnDef(name, def));
}
