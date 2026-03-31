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
  const normalized = def.replace(/\s+/g, " ").trim();
  const upper = normalized.toUpperCase();

  // Extract type (first word)
  const typeMatch = normalized.match(/^(\w+)/);
  const type = typeMatch ? typeMatch[1].toUpperCase() : "TEXT";

  // Check constraints
  const primaryKey = upper.includes("PRIMARY KEY");
  const notNull = upper.includes("NOT NULL") || primaryKey; // PK implies NOT NULL
  const unique = upper.includes("UNIQUE") || primaryKey;

  // Extract default value — handles nested parentheses, quoted strings, and simple values
  let defaultValue: string | undefined;
  const defaultIdx = upper.indexOf("DEFAULT ");
  if (defaultIdx !== -1) {
    const afterDefault = normalized.slice(defaultIdx + 8).trim();
    if (afterDefault.startsWith("(")) {
      // Parenthesized: find matching closing paren
      let depth = 0;
      let end = 0;
      for (let i = 0; i < afterDefault.length; i++) {
        if (afterDefault[i] === "(") depth++;
        if (afterDefault[i] === ")") depth--;
        if (depth === 0) { end = i + 1; break; }
      }
      defaultValue = afterDefault.slice(0, end);
    } else if (afterDefault.startsWith("'")) {
      const endQuote = afterDefault.indexOf("'", 1);
      defaultValue = afterDefault.slice(0, endQuote + 1);
    } else {
      const spaceIdx = afterDefault.indexOf(" ");
      defaultValue = spaceIdx === -1 ? afterDefault : afterDefault.slice(0, spaceIdx);
    }
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
