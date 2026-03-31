import { describe, it, expect } from "vitest";
import { buildCreateTable, buildAddColumn } from "../src/ddl.js";
import { parseColumnDef } from "../src/parse.js";

describe("buildCreateTable", () => {
  it("builds basic CREATE TABLE", () => {
    const columns = [
      parseColumnDef("id", "text primary key"),
      parseColumnDef("name", "text not null"),
    ];
    const sql = buildCreateTable("users", columns);
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "users"');
    expect(sql).toContain('"id" TEXT PRIMARY KEY');
    expect(sql).toContain('"name" TEXT NOT NULL');
  });

  it("includes defaults", () => {
    const columns = [
      parseColumnDef("id", "text primary key"),
      parseColumnDef("role", "text default 'member'"),
    ];
    const sql = buildCreateTable("users", columns);
    expect(sql).toContain("DEFAULT 'member'");
  });

  it("includes unique constraint", () => {
    const columns = [
      parseColumnDef("id", "text primary key"),
      parseColumnDef("email", "text unique not null"),
    ];
    const sql = buildCreateTable("users", columns);
    expect(sql).toContain('"email" TEXT NOT NULL UNIQUE');
  });

  it("does not duplicate constraints on PK", () => {
    const columns = [parseColumnDef("id", "integer primary key")];
    const sql = buildCreateTable("items", columns);
    // Should have PRIMARY KEY but not redundant NOT NULL or UNIQUE
    expect(sql).toContain('"id" INTEGER PRIMARY KEY');
    const idLine = sql.split("\n").find((l) => l.includes('"id"'))!;
    expect((idLine.match(/NOT NULL/g) || []).length).toBe(0);
    expect((idLine.match(/UNIQUE/g) || []).length).toBe(0);
  });
});

describe("buildAddColumn", () => {
  it("builds ALTER TABLE ADD COLUMN", () => {
    const col = parseColumnDef("bio", "text");
    const sql = buildAddColumn("users", col);
    expect(sql).toBe('ALTER TABLE "users" ADD COLUMN "bio" TEXT');
  });

  it("includes NOT NULL and DEFAULT", () => {
    const col = parseColumnDef("role", "text not null default 'member'");
    const sql = buildAddColumn("users", col);
    expect(sql).toContain("NOT NULL");
    expect(sql).toContain("DEFAULT 'member'");
  });

  it("does not include UNIQUE (SQLite limitation)", () => {
    const col = parseColumnDef("email", "text unique");
    const sql = buildAddColumn("users", col);
    expect(sql).not.toContain("UNIQUE");
  });
});
