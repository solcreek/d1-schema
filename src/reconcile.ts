import type {
  SchemaDefinition,
  ParsedColumn,
  PragmaColumnInfo,
  DdlOperation,
} from "./types.js";
import { parseTableDef } from "./parse.js";
import { buildCreateTable, buildAddColumn } from "./ddl.js";

/**
 * Compute the list of DDL operations needed to reconcile the desired schema
 * with the actual database state. Additive only — never drops columns or tables.
 */
export async function computeOperations(
  db: D1Database,
  schema: SchemaDefinition,
): Promise<{ operations: DdlOperation[]; warnings: string[] }> {
  const operations: DdlOperation[] = [];
  const warnings: string[] = [];

  for (const [tableName, columns] of Object.entries(schema)) {
    const desired = parseTableDef(columns);

    // Check if table exists
    const existing = await db
      .prepare(`PRAGMA table_info("${tableName}")`)
      .all<PragmaColumnInfo>();

    if (!existing.results || existing.results.length === 0) {
      // Table doesn't exist — CREATE
      operations.push({
        table: tableName,
        action: "CREATE_TABLE",
        ddl: buildCreateTable(tableName, desired),
      });
      continue;
    }

    // Table exists — diff columns
    const existingMap = new Map(
      existing.results.map((c) => [c.name, c]),
    );

    for (const col of desired) {
      if (!existingMap.has(col.name)) {
        // New column — validate and ADD
        if (col.notNull && col.defaultValue === undefined && !col.primaryKey) {
          throw new D1SchemaError(
            `Cannot add NOT NULL column "${col.name}" to existing table "${tableName}" without a default value.\n\n` +
              `  Two options:\n` +
              `  1. Add a default:  "${col.name}": "${col.type.toLowerCase()} not null default ''"\n` +
              `  2. Make it nullable first, backfill data, then add not null`,
          );
        }

        // SQLite ALTER TABLE ADD COLUMN only allows constant defaults.
        // Function expressions like datetime('now') are not allowed.
        if (col.defaultValue && col.defaultValue.startsWith("(")) {
          throw new D1SchemaError(
            `Cannot add column "${col.name}" to existing table "${tableName}" with expression default ${col.defaultValue}.\n\n` +
              `  SQLite does not allow ALTER TABLE ADD COLUMN with non-constant defaults.\n` +
              `  Options:\n` +
              `  1. Use a constant default instead:  "${col.name}": "${col.type.toLowerCase()} default ''"\n` +
              `  2. Make it nullable without default:  "${col.name}": "${col.type.toLowerCase()}"\n` +
              `  3. Include the column in the initial schema (CREATE TABLE supports expression defaults)`,
          );
        }

        operations.push({
          table: tableName,
          action: "ADD_COLUMN",
          ddl: buildAddColumn(tableName, col),
        });
      }
    }

    // Check for removed columns (warn, don't drop)
    const desiredNames = new Set(desired.map((c) => c.name));
    for (const [name] of existingMap) {
      if (!desiredNames.has(name)) {
        warnings.push(
          `Column "${tableName}.${name}" exists in database but not in schema. ` +
            `d1-schema will not drop it. Remove manually if intended.`,
        );
      }
    }
  }

  return { operations, warnings };
}

/**
 * Apply DDL operations to the database.
 */
export async function applyOperations(
  db: D1Database,
  operations: DdlOperation[],
): Promise<void> {
  for (const op of operations) {
    await db.prepare(op.ddl).run();
  }
}

/**
 * Log operations to the _d1_schema_log table.
 */
export async function logOperations(
  db: D1Database,
  operations: DdlOperation[],
  applied: boolean,
): Promise<void> {
  for (const op of operations) {
    await db
      .prepare(
        `INSERT INTO _d1_schema_log (table_name, action, ddl, applied) VALUES (?, ?, ?, ?)`,
      )
      .bind(op.table, op.action, op.ddl, applied ? 1 : 0)
      .run();
  }
}

export class D1SchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "D1SchemaError";
  }
}
