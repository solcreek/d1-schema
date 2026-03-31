/** Schema definition: table name → column name → SQL column definition string. */
export type SchemaDefinition = Record<string, Record<string, string>>;

/** Options for define(). */
export interface DefineOptions {
  /**
   * Migration behavior:
   * - "apply" (default): auto-create/alter tables
   * - "warn": log DDL that would run, don't execute
   * - "off": no reconciliation
   */
  autoMigrate?: "apply" | "warn" | "off";
}

/** Parsed column definition. */
export interface ParsedColumn {
  name: string;
  type: string;
  notNull: boolean;
  unique: boolean;
  primaryKey: boolean;
  defaultValue: string | undefined;
}

/** Result from PRAGMA table_info(). */
export interface PragmaColumnInfo {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

/** Result from PRAGMA index_list(). */
export interface PragmaIndexInfo {
  seq: number;
  name: string;
  unique: number;
  origin: string; // "c" = CREATE INDEX, "u" = UNIQUE constraint, "pk" = PRIMARY KEY
  partial: number;
}

/** Result from PRAGMA index_info(). */
export interface PragmaIndexColumnInfo {
  seqno: number;
  cid: number;
  name: string;
}

/** A DDL operation to apply. */
export interface DdlOperation {
  table: string;
  action: "CREATE_TABLE" | "ADD_COLUMN" | "CREATE_INDEX";
  ddl: string;
}
