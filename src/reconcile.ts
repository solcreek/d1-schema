import type {
  SchemaDefinition,
  ParsedColumn,
  PragmaColumnInfo,
  DdlOperation,
} from "./types.js";
import { parseTableDef } from "./parse.js";
import { buildCreateTable, buildAddColumn, escapeIdent } from "./ddl.js";

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
      .prepare(`PRAGMA table_info(${escapeIdent(tableName)})`)
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

    // Check for type/constraint drift on existing columns
    for (const col of desired) {
      const ec = existingMap.get(col.name);
      if (!ec) continue;

      // Type mismatch
      if (ec.type.toUpperCase() !== col.type.toUpperCase()) {
        warnings.push(
          `Column "${tableName}.${col.name}" type mismatch: DB has ${ec.type}, schema says ${col.type}. ` +
            `d1-schema will not alter column types.`,
        );
      }

      // NOT NULL mismatch
      const dbNotNull = ec.notnull === 1 || ec.pk > 0;
      if (col.notNull && !dbNotNull) {
        warnings.push(
          `Column "${tableName}.${col.name}" constraint mismatch: schema says NOT NULL but DB allows NULL. ` +
            `d1-schema will not alter existing constraints.`,
        );
      } else if (!col.notNull && dbNotNull && ec.pk === 0) {
        warnings.push(
          `Column "${tableName}.${col.name}" constraint mismatch: DB has NOT NULL but schema allows NULL. ` +
            `d1-schema will not alter existing constraints.`,
        );
      }

      // Default mismatch (compare string representations)
      const dbDefault = ec.dflt_value;
      const schemaDefault = col.defaultValue ?? null;
      if (dbDefault !== schemaDefault && dbDefault !== null && schemaDefault !== undefined) {
        // Normalize: DB might store '0' while schema says 0
        const dbNorm = String(dbDefault).replace(/^'(.*)'$/, "$1");
        const schemaNorm = String(schemaDefault).replace(/^'(.*)'$/, "$1");
        if (dbNorm !== schemaNorm) {
          warnings.push(
            `Column "${tableName}.${col.name}" default mismatch: DB has ${dbDefault}, schema says ${schemaDefault}. ` +
              `d1-schema will not alter existing defaults.`,
          );
        }
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
 * Handles concurrent execution safely — if another Worker already applied
 * the same change, the "duplicate column name" or "table already exists"
 * error is caught and treated as success.
 */
export async function applyOperations(
  db: D1Database,
  operations: DdlOperation[],
): Promise<void> {
  for (const op of operations) {
    try {
      await db.prepare(op.ddl).run();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // Concurrent Worker already applied this — safe to ignore
      if (
        msg.includes("duplicate column name") ||
        msg.includes("table already exists") ||
        msg.includes("already exists")
      ) {
        continue;
      }
      throw err;
    }
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
