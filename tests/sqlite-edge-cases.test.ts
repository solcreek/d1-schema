import { describe, it, expect, beforeEach } from "vitest";
import { define, D1SchemaError, _resetCache } from "../src/index.js";
import { createMockD1 } from "./d1-mock.js";

/**
 * SQLite-specific edge cases that d1-schema must handle correctly.
 * These test real SQLite behavior via better-sqlite3.
 */

let db: D1Database;

beforeEach(() => {
  db = createMockD1();
  _resetCache();
});

async function getColumns(tableName: string) {
  const result = await db
    .prepare(`PRAGMA table_info("${tableName}")`)
    .all<{ name: string; type: string; notnull: number; dflt_value: string | null; pk: number }>();
  return result.results;
}

// ─── ADD COLUMN restrictions ──────────────────────────────────────────────────

describe("ADD COLUMN restrictions", () => {
  it("allows nullable column without default", async () => {
    await define(db, { t: { id: "text primary key" } });
    await define(db, { t: { id: "text primary key", name: "text" } });

    const cols = await getColumns("t");
    expect(cols.map((c) => c.name)).toContain("name");
  });

  it("allows column with constant string default", async () => {
    await define(db, { t: { id: "text primary key" } });
    await define(db, { t: { id: "text primary key", status: "text default 'active'" } });

    await db.prepare("INSERT INTO t (id) VALUES ('1')").run();
    const row = await db.prepare("SELECT status FROM t WHERE id = '1'").first<any>();
    expect(row.status).toBe("active");
  });

  it("allows column with constant integer default", async () => {
    await define(db, { t: { id: "text primary key" } });
    await define(db, { t: { id: "text primary key", count: "integer default 0" } });

    await db.prepare("INSERT INTO t (id) VALUES ('1')").run();
    const row = await db.prepare("SELECT count FROM t WHERE id = '1'").first<any>();
    expect(row.count).toBe(0);
  });

  it("rejects expression default (datetime) on ADD COLUMN", async () => {
    await define(db, { t: { id: "text primary key" } });

    await expect(
      define(db, { t: { id: "text primary key", ts: "text default (datetime('now'))" } }),
    ).rejects.toThrow(D1SchemaError);
  });

  it("rejects NOT NULL without default on ADD COLUMN", async () => {
    await define(db, { t: { id: "text primary key" } });

    await expect(
      define(db, { t: { id: "text primary key", name: "text not null" } }),
    ).rejects.toThrow(D1SchemaError);
  });

  it("allows NOT NULL with constant default on ADD COLUMN", async () => {
    await define(db, { t: { id: "text primary key" } });
    await define(db, { t: { id: "text primary key", role: "text not null default 'user'" } });

    const cols = await getColumns("t");
    const roleCol = cols.find((c) => c.name === "role");
    expect(roleCol?.notnull).toBe(1);
    expect(roleCol?.dflt_value).toBe("'user'");
  });
});

// ─── CREATE TABLE capabilities ──────────────────────────────────────────────

describe("CREATE TABLE capabilities (things only allowed on new tables)", () => {
  it("allows expression default on CREATE TABLE", async () => {
    await define(db, {
      events: {
        id: "text primary key",
        created_at: "text default (datetime('now'))",
      },
    });

    await db.prepare("INSERT INTO events (id) VALUES ('e1')").run();
    const row = await db.prepare("SELECT created_at FROM events WHERE id = 'e1'").first<any>();
    expect(row.created_at).toBeTruthy(); // datetime filled
  });

  it("allows NOT NULL without default on CREATE TABLE", async () => {
    await define(db, {
      items: {
        id: "text primary key",
        name: "text not null",
      },
    });

    const cols = await getColumns("items");
    expect(cols.find((c) => c.name === "name")?.notnull).toBe(1);
  });

  it("allows UNIQUE on CREATE TABLE", async () => {
    await define(db, {
      users: {
        id: "text primary key",
        email: "text unique not null",
      },
    });

    await db.prepare("INSERT INTO users (id, email) VALUES ('1', 'a@b.com')").run();

    // Duplicate should fail
    await expect(
      db.prepare("INSERT INTO users (id, email) VALUES ('2', 'a@b.com')").run(),
    ).rejects.toThrow();
  });
});

// ─── Column type affinity ──────────────────────────────────────────────────

describe("Column type affinity", () => {
  it("handles all SQLite types", async () => {
    await define(db, {
      data: {
        id: "integer primary key",
        label: "text",
        amount: "real",
        payload: "blob",
      },
    });

    const cols = await getColumns("data");
    expect(cols.find((c) => c.name === "id")?.type).toBe("INTEGER");
    expect(cols.find((c) => c.name === "label")?.type).toBe("TEXT");
    expect(cols.find((c) => c.name === "amount")?.type).toBe("REAL");
    expect(cols.find((c) => c.name === "payload")?.type).toBe("BLOB");
  });

  it("stores values regardless of declared type (loose typing)", async () => {
    await define(db, {
      loose: {
        id: "text primary key",
        num_col: "integer",
      },
    });

    // SQLite allows storing text in an integer column
    await db.prepare("INSERT INTO loose (id, num_col) VALUES ('1', 'not a number')").run();
    const row = await db.prepare("SELECT num_col FROM loose WHERE id = '1'").first<any>();
    expect(row.num_col).toBe("not a number");
  });
});

// ─── CREATE TABLE IF NOT EXISTS behavior ──────────────────────────────────

describe("CREATE TABLE IF NOT EXISTS (silent mismatch)", () => {
  it("does not alter existing table even if schema differs", async () => {
    // Create table with 2 columns
    await db.prepare("CREATE TABLE manual (id TEXT PRIMARY KEY, old_col TEXT)").run();

    // define() with different columns — should ADD new columns, not recreate
    await define(db, {
      manual: {
        id: "text primary key",
        old_col: "text",
        new_col: "text",
      },
    });

    const cols = await getColumns("manual");
    expect(cols.map((c) => c.name)).toEqual(["id", "old_col", "new_col"]);
  });
});

// ─── Foreign keys ──────────────────────────────────────────────────────────

describe("Foreign keys", () => {
  it("creates FK references on CREATE TABLE", async () => {
    await define(db, {
      authors: { id: "text primary key", name: "text not null" },
      books: {
        id: "text primary key",
        author_id: "text references authors(id)",
        title: "text not null",
      },
    });

    await db.prepare("INSERT INTO authors (id, name) VALUES ('a1', 'Alice')").run();
    await db.prepare("INSERT INTO books (id, author_id, title) VALUES ('b1', 'a1', 'Book 1')").run();

    const book = await db.prepare("SELECT * FROM books WHERE id = 'b1'").first<any>();
    expect(book.author_id).toBe("a1");
  });

  it("allows nullable FK column via ADD COLUMN", async () => {
    await define(db, {
      categories: { id: "text primary key" },
      items: { id: "text primary key", name: "text not null" },
    });

    // Add FK column — nullable, so it's allowed
    await define(db, {
      categories: { id: "text primary key" },
      items: {
        id: "text primary key",
        name: "text not null",
        category_id: "text references categories(id)",
      },
    });

    const cols = await getColumns("items");
    expect(cols.map((c) => c.name)).toContain("category_id");
  });
});

// ─── Reserved/special column names ──────────────────────────────────────────

describe("Reserved and special column names", () => {
  it("handles SQL keyword as column name (quoted)", async () => {
    await define(db, {
      t: {
        id: "text primary key",
        order: "integer default 0",
        group: "text",
        select: "text",
      },
    });

    await db.prepare('INSERT INTO t (id, "order", "group", "select") VALUES (\'1\', 1, \'a\', \'b\')').run();
    const row = await db.prepare("SELECT * FROM t WHERE id = '1'").first<any>();
    expect(row.order).toBe(1);
    expect(row.group).toBe("a");
  });

  it("handles column names starting with underscore", async () => {
    await define(db, {
      t: {
        id: "text primary key",
        _internal: "text",
        __double: "text",
      },
    });

    const cols = await getColumns("t");
    expect(cols.map((c) => c.name)).toContain("_internal");
    expect(cols.map((c) => c.name)).toContain("__double");
  });
});

// ─── Multiple concurrent defines (idempotency) ──────────────────────────────

describe("Concurrent define() calls (idempotency)", () => {
  it("handles two defines adding the same column simultaneously", async () => {
    await define(db, { t: { id: "text primary key" } });

    // Simulate two Workers both seeing the old schema and trying to add the same column
    // First one succeeds, second should not fail
    await define(db, { t: { id: "text primary key", name: "text" } });
    await define(db, { t: { id: "text primary key", name: "text" } }); // idempotent

    const cols = await getColumns("t");
    const nameCount = cols.filter((c) => c.name === "name").length;
    expect(nameCount).toBe(1); // not duplicated
  });
});

// ─── Large schema ──────────────────────────────────────────────────────────

describe("Large schema", () => {
  it("handles table with many columns", async () => {
    const columns: Record<string, string> = { id: "text primary key" };
    for (let i = 0; i < 50; i++) {
      columns[`col_${i}`] = "text";
    }

    await define(db, { wide_table: columns });

    const cols = await getColumns("wide_table");
    expect(cols.length).toBe(51); // id + 50 columns
  });

  it("handles many tables", async () => {
    const schema: Record<string, Record<string, string>> = {};
    for (let i = 0; i < 20; i++) {
      schema[`table_${i}`] = {
        id: "text primary key",
        name: "text not null",
        value: "integer default 0",
      };
    }

    await define(db, schema);

    // Verify all tables exist
    for (let i = 0; i < 20; i++) {
      const cols = await getColumns(`table_${i}`);
      expect(cols.length).toBe(3);
    }
  });
});

// ─── Default value edge cases ──────────────────────────────────────────────

describe("Default value edge cases", () => {
  it("handles empty string default", async () => {
    await define(db, { t: { id: "text primary key", name: "text default ''" } });

    await db.prepare("INSERT INTO t (id) VALUES ('1')").run();
    const row = await db.prepare("SELECT name FROM t WHERE id = '1'").first<any>();
    expect(row.name).toBe("");
  });

  it("handles negative number default", async () => {
    await define(db, { t: { id: "text primary key", offset: "integer default -1" } });

    await db.prepare("INSERT INTO t (id) VALUES ('1')").run();
    const row = await db.prepare("SELECT offset FROM t WHERE id = '1'").first<any>();
    expect(row.offset).toBe(-1);
  });

  it("handles float default", async () => {
    await define(db, { t: { id: "text primary key", rate: "real default 0.5" } });

    await db.prepare("INSERT INTO t (id) VALUES ('1')").run();
    const row = await db.prepare("SELECT rate FROM t WHERE id = '1'").first<any>();
    expect(row.rate).toBe(0.5);
  });

  it("handles NULL as explicit default", async () => {
    await define(db, { t: { id: "text primary key", val: "text default null" } });

    await db.prepare("INSERT INTO t (id) VALUES ('1')").run();
    const row = await db.prepare("SELECT val FROM t WHERE id = '1'").first<any>();
    expect(row.val).toBeNull();
  });
});
