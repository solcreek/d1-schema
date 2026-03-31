import { describe, it, expect } from "vitest";
import { parseColumnDef } from "../src/parse.js";

describe("parseColumnDef", () => {
  it("parses simple type", () => {
    const col = parseColumnDef("name", "text");
    expect(col.type).toBe("TEXT");
    expect(col.notNull).toBe(false);
    expect(col.primaryKey).toBe(false);
    expect(col.unique).toBe(false);
    expect(col.defaultValue).toBeUndefined();
  });

  it("parses primary key", () => {
    const col = parseColumnDef("id", "text primary key");
    expect(col.type).toBe("TEXT");
    expect(col.primaryKey).toBe(true);
    expect(col.notNull).toBe(true); // PK implies NOT NULL
    expect(col.unique).toBe(true); // PK implies UNIQUE
  });

  it("parses integer primary key", () => {
    const col = parseColumnDef("id", "integer primary key");
    expect(col.type).toBe("INTEGER");
    expect(col.primaryKey).toBe(true);
  });

  it("parses not null", () => {
    const col = parseColumnDef("email", "text not null");
    expect(col.notNull).toBe(true);
    expect(col.primaryKey).toBe(false);
  });

  it("parses unique", () => {
    const col = parseColumnDef("email", "text unique not null");
    expect(col.unique).toBe(true);
    expect(col.notNull).toBe(true);
  });

  it("parses simple default", () => {
    const col = parseColumnDef("completed", "integer default 0");
    expect(col.type).toBe("INTEGER");
    expect(col.defaultValue).toBe("0");
  });

  it("parses string default", () => {
    const col = parseColumnDef("role", "text default 'member'");
    expect(col.defaultValue).toBe("'member'");
  });

  it("parses parenthesized default", () => {
    const col = parseColumnDef("created_at", "text default (datetime('now'))");
    expect(col.defaultValue).toBe("(datetime('now'))");
  });

  it("parses not null with default", () => {
    const col = parseColumnDef("status", "text not null default 'active'");
    expect(col.notNull).toBe(true);
    expect(col.defaultValue).toBe("'active'");
  });

  it("is case insensitive", () => {
    const col = parseColumnDef("id", "TEXT PRIMARY KEY");
    expect(col.type).toBe("TEXT");
    expect(col.primaryKey).toBe(true);
  });

  it("handles real type", () => {
    const col = parseColumnDef("price", "real not null");
    expect(col.type).toBe("REAL");
    expect(col.notNull).toBe(true);
  });

  it("handles blob type", () => {
    const col = parseColumnDef("data", "blob");
    expect(col.type).toBe("BLOB");
  });

  it("handles extra whitespace", () => {
    const col = parseColumnDef("name", "  text   not   null  ");
    expect(col.type).toBe("TEXT");
    expect(col.notNull).toBe(true);
  });

  it("preserves column name", () => {
    const col = parseColumnDef("created_at", "text");
    expect(col.name).toBe("created_at");
  });
});
