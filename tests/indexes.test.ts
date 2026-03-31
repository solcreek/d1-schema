import { describe, it, expect, beforeEach } from "vitest";
import { define } from "../src/index.js";
import { createMockD1 } from "./d1-mock.js";
import { buildCreateIndex } from "../src/ddl.js";

let db: D1Database;

beforeEach(() => {
  db = createMockD1();
});

describe("buildCreateIndex", () => {
  it("builds single-column index", () => {
    const sql = buildCreateIndex("posts", "author_id");
    expect(sql).toBe('CREATE INDEX IF NOT EXISTS "idx_posts_author_id" ON "posts" ("author_id")');
  });

  it("builds multi-column index", () => {
    const sql = buildCreateIndex("posts", "status, created_at");
    expect(sql).toBe('CREATE INDEX IF NOT EXISTS "idx_posts_status_created_at" ON "posts" ("status", "created_at")');
  });
});

describe("define() with _indexes", () => {
  it("creates indexes on new table", async () => {
    await define(db, {
      posts: {
        id: "text primary key",
        author_id: "text not null",
        status: "text default 'draft'",
        _indexes: ["author_id", "status"],
      },
    });

    // Verify indexes exist by querying PRAGMA
    const indexes = await db.prepare("PRAGMA index_list(\"posts\")").all<any>();
    const indexNames = indexes.results.map((i: any) => i.name);
    expect(indexNames).toContain("idx_posts_author_id");
    expect(indexNames).toContain("idx_posts_status");
  });

  it("creates composite index", async () => {
    await define(db, {
      posts: {
        id: "text primary key",
        author_id: "text not null",
        status: "text default 'draft'",
        created_at: "text",
        _indexes: ["author_id", "status, created_at"],
      },
    });

    const indexes = await db.prepare("PRAGMA index_list(\"posts\")").all<any>();
    const indexNames = indexes.results.map((i: any) => i.name);
    expect(indexNames).toContain("idx_posts_status_created_at");
  });

  it("indexes are idempotent (IF NOT EXISTS)", async () => {
    const schema = {
      t: {
        id: "text primary key",
        name: "text",
        _indexes: ["name"],
      },
    } as any;

    await define(db, schema);
    await define(db, schema); // should not throw

    const indexes = await db.prepare("PRAGMA index_list(\"t\")").all<any>();
    const nameIndexes = indexes.results.filter((i: any) => i.name === "idx_t_name");
    expect(nameIndexes.length).toBe(1);
  });

  it("adds index to existing table", async () => {
    await define(db, { t: { id: "text primary key", name: "text" } });

    // Add index in next define
    await define(db, {
      t: {
        id: "text primary key",
        name: "text",
        _indexes: ["name"],
      },
    } as any);

    const indexes = await db.prepare("PRAGMA index_list(\"t\")").all<any>();
    expect(indexes.results.some((i: any) => i.name === "idx_t_name")).toBe(true);
  });

  it("schema without _indexes works normally", async () => {
    await define(db, {
      simple: { id: "text primary key", name: "text" },
    });

    await db.prepare("INSERT INTO simple (id, name) VALUES ('1', 'test')").run();
    const row = await db.prepare("SELECT * FROM simple WHERE id = '1'").first<any>();
    expect(row.name).toBe("test");
  });

  it("logs index creation in schema log", async () => {
    await define(db, {
      t: {
        id: "text primary key",
        name: "text",
        _indexes: ["name"],
      },
    } as any);

    const logs = await db.prepare("SELECT * FROM _d1_schema_log WHERE action = 'CREATE_INDEX'").all<any>();
    expect(logs.results.length).toBeGreaterThan(0);
    expect(logs.results[0].ddl).toContain("idx_t_name");
  });
});
