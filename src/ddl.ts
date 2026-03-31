import type { ParsedColumn } from "./types.js";

/**
 * Build a CREATE TABLE IF NOT EXISTS statement from parsed columns.
 */
export function buildCreateTable(
  tableName: string,
  columns: ParsedColumn[],
): string {
  const colDefs = columns.map((col) => {
    const parts = [`"${col.name}"`, col.type];
    if (col.primaryKey) parts.push("PRIMARY KEY");
    if (col.notNull && !col.primaryKey) parts.push("NOT NULL");
    if (col.unique && !col.primaryKey) parts.push("UNIQUE");
    if (col.defaultValue !== undefined) parts.push(`DEFAULT ${col.defaultValue}`);
    return "  " + parts.join(" ");
  });

  return `CREATE TABLE IF NOT EXISTS "${tableName}" (\n${colDefs.join(",\n")}\n)`;
}

/**
 * Build an ALTER TABLE ADD COLUMN statement.
 */
export function buildAddColumn(
  tableName: string,
  col: ParsedColumn,
): string {
  // SQLite ALTER TABLE ADD COLUMN restrictions:
  // - Cannot have PRIMARY KEY
  // - Cannot have UNIQUE (unless also has DEFAULT)
  // - NOT NULL requires DEFAULT
  const parts = [`"${col.name}"`, col.type];
  if (col.notNull) parts.push("NOT NULL");
  if (col.defaultValue !== undefined) parts.push(`DEFAULT ${col.defaultValue}`);
  // UNIQUE on ADD COLUMN is not supported by SQLite — skip silently

  return `ALTER TABLE "${tableName}" ADD COLUMN ${parts.join(" ")}`;
}
