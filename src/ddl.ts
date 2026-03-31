import type { ParsedColumn } from "./types.js";

/**
 * Escape a SQL identifier (table or column name) by doubling internal quotes.
 * Per SQL standard: "my""column" represents the identifier my"column.
 */
export function escapeIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Build a CREATE TABLE IF NOT EXISTS statement from parsed columns.
 */
export function buildCreateTable(
  tableName: string,
  columns: ParsedColumn[],
): string {
  const colDefs = columns.map((col) => {
    const parts = [escapeIdent(col.name), col.type];
    if (col.primaryKey) parts.push("PRIMARY KEY");
    if (col.notNull && !col.primaryKey) parts.push("NOT NULL");
    if (col.unique && !col.primaryKey) parts.push("UNIQUE");
    if (col.defaultValue !== undefined) parts.push(`DEFAULT ${col.defaultValue}`);
    return "  " + parts.join(" ");
  });

  return `CREATE TABLE IF NOT EXISTS ${escapeIdent(tableName)} (\n${colDefs.join(",\n")}\n)`;
}

/**
 * Build an ALTER TABLE ADD COLUMN statement.
 */
export function buildAddColumn(
  tableName: string,
  col: ParsedColumn,
): string {
  const parts = [escapeIdent(col.name), col.type];
  if (col.notNull) parts.push("NOT NULL");
  if (col.defaultValue !== undefined) parts.push(`DEFAULT ${col.defaultValue}`);

  return `ALTER TABLE ${escapeIdent(tableName)} ADD COLUMN ${parts.join(" ")}`;
}
