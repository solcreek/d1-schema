import { describe, it, expect, beforeEach } from "vitest";
import { define, D1SchemaError } from "../src/index.js";
import { createMockD1 } from "./d1-mock.js";

let db: D1Database;

beforeEach(() => {
  db = createMockD1();
});

describe("define() — table creation", () => {
  it("creates a table from schema", async () => {
    await define(db, {
      todos: {
        id: "text primary key",
        text: "text not null",
        completed: "integer default 0",
      },
    });

    const rows = await db.prepare("SELECT * FROM todos").all();
    expect(rows.results).toEqual([]);
  });

  it("creates multiple tables", async () => {
    await define(db, {
      users: {
        id: "text primary key",
        email: "text unique not null",
      },
      posts: {
        id: "text primary key",
        title: "text not null",
        author_id: "text not null",
      },
    });

    const users = await db.prepare("SELECT * FROM users").all();
    const posts = await db.prepare("SELECT * FROM posts").all();
    expect(users.results).toEqual([]);
    expect(posts.results).toEqual([]);
  });

  it("allows inserting data after define", async () => {
    await define(db, {
      todos: {
        id: "text primary key",
        text: "text not null",
      },
    });

    await db.prepare("INSERT INTO todos (id, text) VALUES (?, ?)").bind("1", "hello").run();
    const row = await db.prepare("SELECT * FROM todos WHERE id = ?").bind("1").first();
    expect(row).toEqual({ id: "1", text: "hello" });
  });

  it("applies default values", async () => {
    await define(db, {
      items: {
        id: "text primary key",
        status: "text default 'active'",
        count: "integer default 0",
      },
    });

    await db.prepare("INSERT INTO items (id) VALUES ('1')").run();
    const row = await db.prepare("SELECT * FROM items WHERE id = '1'").first<any>();
    expect(row.status).toBe("active");
    expect(row.count).toBe(0);
  });
});

describe("define() — schema evolution", () => {
  it("adds new columns to existing table", async () => {
    // Initial schema
    await define(db, {
      users: {
        id: "text primary key",
        name: "text not null",
      },
    });

    await db.prepare("INSERT INTO users (id, name) VALUES ('1', 'Alice')").run();

    // Add a column
    await define(db, {
      users: {
        id: "text primary key",
        name: "text not null",
        bio: "text",
      },
    });

    const row = await db.prepare("SELECT * FROM users WHERE id = '1'").first<any>();
    expect(row.name).toBe("Alice");
    expect(row.bio).toBeNull(); // New nullable column
  });

  it("adds NOT NULL column with default", async () => {
    await define(db, {
      users: { id: "text primary key" },
    });

    await db.prepare("INSERT INTO users (id) VALUES ('1')").run();

    await define(db, {
      users: {
        id: "text primary key",
        role: "text not null default 'member'",
      },
    });

    const row = await db.prepare("SELECT * FROM users WHERE id = '1'").first<any>();
    expect(row.role).toBe("member");
  });

  it("throws on NOT NULL column without default", async () => {
    await define(db, {
      users: { id: "text primary key" },
    });

    await expect(
      define(db, {
        users: {
          id: "text primary key",
          email: "text not null",
        },
      }),
    ).rejects.toThrow(D1SchemaError);
  });
});

describe("define() — fast skip", () => {
  it("skips reconciliation when schema unchanged", async () => {
    const schema = {
      todos: {
        id: "text primary key",
        text: "text not null",
      },
    };

    await define(db, schema);

    // Insert data to verify table exists
    await db.prepare("INSERT INTO todos (id, text) VALUES ('1', 'test')").run();

    // Re-define with same schema — should be fast (no DDL)
    await define(db, schema);

    // Data should still be there
    const row = await db.prepare("SELECT * FROM todos WHERE id = '1'").first<any>();
    expect(row.text).toBe("test");
  });
});

describe("define() — modes", () => {
  it("does nothing in off mode", async () => {
    await define(
      db,
      { todos: { id: "text primary key" } },
      { autoMigrate: "off" },
    );

    // Table should NOT exist
    await expect(
      db.prepare("SELECT * FROM todos").all(),
    ).rejects.toThrow();
  });

  it("warns but does not execute in warn mode", async () => {
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (msg: string) => warnings.push(msg);

    await define(
      db,
      { todos: { id: "text primary key", text: "text not null" } },
      { autoMigrate: "warn" },
    );

    console.warn = originalWarn;

    // Should have logged warnings
    expect(warnings.some((w) => w.includes("Would execute"))).toBe(true);

    // Table should NOT exist (warn mode doesn't apply)
    await expect(
      db.prepare("SELECT * FROM todos").all(),
    ).rejects.toThrow();
  });
});

describe("define() — schema log", () => {
  it("records operations in _d1_schema_log", async () => {
    await define(db, {
      todos: { id: "text primary key", text: "text not null" },
    });

    const logs = await db.prepare("SELECT * FROM _d1_schema_log").all<any>();
    expect(logs.results.length).toBeGreaterThan(0);
    expect(logs.results[0].action).toBe("CREATE_TABLE");
    expect(logs.results[0].applied).toBe(1);
  });
});

describe("define() — removed columns", () => {
  it("warns about columns in DB but not in schema", async () => {
    await define(db, {
      users: {
        id: "text primary key",
        name: "text not null",
        bio: "text",
      },
    });

    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (msg: string) => warnings.push(msg);

    // Remove 'bio' from schema
    await define(db, {
      users: {
        id: "text primary key",
        name: "text not null",
      },
    });

    console.warn = originalWarn;

    expect(warnings.some((w) => w.includes("bio"))).toBe(true);
    expect(warnings.some((w) => w.includes("will not drop"))).toBe(true);

    // Column should still exist
    const row = await db.prepare("SELECT bio FROM users LIMIT 1").all();
    expect(row.results).toBeDefined();
  });
});
