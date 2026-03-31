import { describe, it, expect, beforeEach } from "vitest";
import { define, D1SchemaError, _resetCache } from "../src/index.js";
import { createMockD1 } from "./d1-mock.js";

/**
 * Comprehensive migration scenario tests.
 * Simulates real-world schema evolution over multiple deploys.
 */

let db: D1Database;

beforeEach(() => {
  db = createMockD1();
  _resetCache();
});

// Helper: get actual table columns from SQLite
async function getColumns(tableName: string) {
  const result = await db
    .prepare(`PRAGMA table_info("${tableName}")`)
    .all<{ name: string; type: string; notnull: number; dflt_value: string | null; pk: number }>();
  return result.results;
}

// Helper: get all tables
async function getTables() {
  const result = await db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_d1_%' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all<{ name: string }>();
  return result.results.map((r) => r.name);
}

// Helper: get schema log
async function getLog() {
  const result = await db
    .prepare("SELECT table_name, action, ddl FROM _d1_schema_log ORDER BY id")
    .all<{ table_name: string; action: string; ddl: string }>();
  return result.results;
}

// ─── Scenario 1: Fresh start ──────────────────────────────────────────────────

describe("Scenario: Fresh start (empty database)", () => {
  it("creates single table", async () => {
    await define(db, {
      todos: {
        id: "text primary key",
        text: "text not null",
      },
    });

    const tables = await getTables();
    expect(tables).toContain("todos");

    const cols = await getColumns("todos");
    expect(cols.map((c) => c.name)).toEqual(["id", "text"]);
  });

  it("creates multiple tables in one call", async () => {
    await define(db, {
      users: { id: "text primary key", email: "text unique not null" },
      posts: { id: "text primary key", title: "text not null" },
      tags: { id: "text primary key", name: "text unique not null" },
    });

    const tables = await getTables();
    expect(tables).toEqual(["posts", "tags", "users"]);
  });

  it("applies all column constraints", async () => {
    await define(db, {
      items: {
        id: "integer primary key",
        name: "text not null",
        price: "real default 0",
        data: "blob",
        code: "text unique",
        status: "text not null default 'active'",
      },
    });

    const cols = await getColumns("items");
    expect(cols.find((c) => c.name === "id")?.pk).toBe(1);
    expect(cols.find((c) => c.name === "name")?.notnull).toBe(1);
    expect(cols.find((c) => c.name === "price")?.dflt_value).toBe("0");
    expect(cols.find((c) => c.name === "status")?.dflt_value).toBe("'active'");
  });
});

// ─── Scenario 2: Add columns across deploys ──────────────────────────────────

describe("Scenario: Adding columns across multiple deploys", () => {
  it("deploy 1 → 2 → 3: progressively adding columns", async () => {
    // Deploy 1: basic schema
    await define(db, {
      users: {
        id: "text primary key",
        email: "text not null",
      },
    });

    await db.prepare("INSERT INTO users (id, email) VALUES ('u1', 'alice@test.com')").run();

    // Deploy 2: add name and role
    await define(db, {
      users: {
        id: "text primary key",
        email: "text not null",
        name: "text",
        role: "text default 'member'",
      },
    });

    const afterDeploy2 = await db.prepare("SELECT * FROM users WHERE id = 'u1'").first<any>();
    expect(afterDeploy2.email).toBe("alice@test.com");
    expect(afterDeploy2.name).toBeNull(); // new nullable column
    expect(afterDeploy2.role).toBe("member"); // default applied

    // Deploy 3: add bio and verified
    await define(db, {
      users: {
        id: "text primary key",
        email: "text not null",
        name: "text",
        role: "text default 'member'",
        bio: "text",
        verified: "integer default 0",
      },
    });

    const afterDeploy3 = await db.prepare("SELECT * FROM users WHERE id = 'u1'").first<any>();
    expect(afterDeploy3.email).toBe("alice@test.com");
    expect(afterDeploy3.role).toBe("member");
    expect(afterDeploy3.verified).toBe(0);

    // Verify log has all operations
    const log = await getLog();
    expect(log.filter((l) => l.table_name === "users")).toHaveLength(5);
    // 1 CREATE_TABLE + 2 ADD_COLUMN (deploy 2) + 2 ADD_COLUMN (deploy 3)
  });
});

// ─── Scenario 3: Add new tables across deploys ──────────────────────────────

describe("Scenario: Adding new tables across deploys", () => {
  it("deploy 1: users → deploy 2: users + posts → deploy 3: users + posts + comments", async () => {
    // Deploy 1
    await define(db, {
      users: { id: "text primary key", name: "text not null" },
    });
    await db.prepare("INSERT INTO users (id, name) VALUES ('u1', 'Alice')").run();

    // Deploy 2: add posts table
    await define(db, {
      users: { id: "text primary key", name: "text not null" },
      posts: {
        id: "text primary key",
        author_id: "text not null",
        title: "text not null",
      },
    });
    await db.prepare("INSERT INTO posts (id, author_id, title) VALUES ('p1', 'u1', 'Hello')").run();

    // Deploy 3: add comments table
    await define(db, {
      users: { id: "text primary key", name: "text not null" },
      posts: { id: "text primary key", author_id: "text not null", title: "text not null" },
      comments: {
        id: "text primary key",
        post_id: "text not null",
        body: "text not null",
      },
    });
    await db.prepare("INSERT INTO comments (id, post_id, body) VALUES ('c1', 'p1', 'Nice!')").run();

    // Verify all data intact
    const user = await db.prepare("SELECT * FROM users WHERE id = 'u1'").first<any>();
    const post = await db.prepare("SELECT * FROM posts WHERE id = 'p1'").first<any>();
    const comment = await db.prepare("SELECT * FROM comments WHERE id = 'c1'").first<any>();
    expect(user.name).toBe("Alice");
    expect(post.title).toBe("Hello");
    expect(comment.body).toBe("Nice!");
  });
});

// ─── Scenario 4: NOT NULL validation ──────────────────────────────────────────

describe("Scenario: NOT NULL column validation", () => {
  it("rejects NOT NULL without default on existing table", async () => {
    await define(db, { users: { id: "text primary key" } });
    await db.prepare("INSERT INTO users (id) VALUES ('u1')").run();

    await expect(
      define(db, {
        users: {
          id: "text primary key",
          email: "text not null", // no default!
        },
      }),
    ).rejects.toThrow(D1SchemaError);
    expect((await getColumns("users")).map((c) => c.name)).toEqual(["id"]);
  });

  it("allows NOT NULL with default on existing table", async () => {
    await define(db, { users: { id: "text primary key" } });

    await define(db, {
      users: {
        id: "text primary key",
        role: "text not null default 'user'",
      },
    });

    const cols = await getColumns("users");
    expect(cols.map((c) => c.name)).toContain("role");
  });

  it("allows NOT NULL without default on NEW table (no existing rows)", async () => {
    await define(db, {
      fresh: {
        id: "text primary key",
        email: "text not null", // OK — new table has no rows
      },
    });

    const cols = await getColumns("fresh");
    expect(cols.find((c) => c.name === "email")?.notnull).toBe(1);
  });
});

// ─── Scenario 5: Removed columns ──────────────────────────────────────────────

describe("Scenario: Columns removed from schema", () => {
  it("warns but keeps column data", async () => {
    await define(db, {
      users: {
        id: "text primary key",
        name: "text not null",
        legacy_field: "text",
      },
    });

    await db.prepare("INSERT INTO users (id, name, legacy_field) VALUES ('u1', 'Alice', 'old data')").run();

    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (msg: string) => warnings.push(msg);

    // Remove legacy_field from schema
    await define(db, {
      users: {
        id: "text primary key",
        name: "text not null",
      },
    });

    console.warn = origWarn;

    // Warning should mention the removed column
    expect(warnings.some((w) => w.includes("legacy_field"))).toBe(true);

    // Data should still be accessible
    const row = await db.prepare("SELECT legacy_field FROM users WHERE id = 'u1'").first<any>();
    expect(row.legacy_field).toBe("old data");
  });
});

// ─── Scenario 6: Idempotency ──────────────────────────────────────────────────

describe("Scenario: Idempotency (calling define multiple times)", () => {
  it("calling define 5 times with same schema produces 1 CREATE", async () => {
    const schema = {
      todos: { id: "text primary key", text: "text not null" },
    };

    await define(db, schema);
    await define(db, schema);
    await define(db, schema);
    await define(db, schema);
    await define(db, schema);

    const log = await getLog();
    // Only one CREATE_TABLE should be logged
    expect(log.filter((l) => l.action === "CREATE_TABLE")).toHaveLength(1);
  });

  it("calling define with evolving schema logs each change", async () => {
    await define(db, { t: { id: "text primary key" } });
    await define(db, { t: { id: "text primary key", a: "text" } });
    await define(db, { t: { id: "text primary key", a: "text", b: "text" } });
    await define(db, { t: { id: "text primary key", a: "text", b: "text", c: "text" } });

    const log = await getLog();
    expect(log).toHaveLength(4); // 1 CREATE + 3 ADD_COLUMN
  });
});

// ─── Scenario 7: Hash-based fast skip ──────────────────────────────────────────

describe("Scenario: Hash-based fast skip performance", () => {
  it("second call with same schema does no PRAGMA queries", async () => {
    const schema = {
      users: { id: "text primary key", name: "text not null" },
      posts: { id: "text primary key", title: "text not null" },
    };

    await define(db, schema);

    // Get log count after first define
    const logAfterFirst = await getLog();
    const countAfterFirst = logAfterFirst.length;

    // Second define — should skip entirely (hash match)
    await define(db, schema);

    // No new log entries
    const logAfterSecond = await getLog();
    expect(logAfterSecond.length).toBe(countAfterFirst);
  });
});

// ─── Scenario 8: warn mode ──────────────────────────────────────────────────

describe("Scenario: warn mode (dry-run)", () => {
  it("logs DDL but does not execute", async () => {
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (msg: string) => warnings.push(msg);

    await define(
      db,
      { todos: { id: "text primary key", text: "text not null" } },
      { autoMigrate: "warn" },
    );

    console.warn = origWarn;

    // Should have logged the DDL
    expect(warnings.some((w) => w.includes("Would execute"))).toBe(true);
    expect(warnings.some((w) => w.includes("CREATE TABLE"))).toBe(true);

    // Table should NOT exist
    await expect(db.prepare("SELECT * FROM todos").all()).rejects.toThrow();

    // Log should record with applied=0
    const log = await getLog();
    expect(log.length).toBeGreaterThan(0);
    const fullLog = await db.prepare("SELECT * FROM _d1_schema_log").all<any>();
    expect(fullLog.results[0].applied).toBe(0);
  });
});

// ─── Scenario 9: Expression default on ALTER TABLE ──────────────────────────

describe("Scenario: Expression default on ALTER TABLE", () => {
  it("allows expression default on CREATE TABLE (new table)", async () => {
    await define(db, {
      events: {
        id: "text primary key",
        name: "text not null",
        created_at: "text default (datetime('now'))",
      },
    });

    await db.prepare("INSERT INTO events (id, name) VALUES ('e1', 'click')").run();
    const row = await db.prepare("SELECT * FROM events WHERE id = 'e1'").first<any>();
    expect(row.created_at).toBeTruthy(); // datetime auto-filled
  });

  it("rejects expression default on ALTER TABLE ADD COLUMN", async () => {
    await define(db, { events: { id: "text primary key" } });

    await expect(
      define(db, {
        events: {
          id: "text primary key",
          created_at: "text default (datetime('now'))",
        },
      }),
    ).rejects.toThrow(D1SchemaError);
    expect((await getColumns("events")).map((c) => c.name)).toEqual(["id"]);
  });
});

// ─── Scenario 10: Foreign keys ──────────────────────────────────────────────

describe("Scenario: Foreign key references", () => {
  it("creates tables with foreign keys", async () => {
    await define(db, {
      users: { id: "text primary key", name: "text not null" },
      posts: {
        id: "text primary key",
        author_id: "text not null references users(id)",
        title: "text not null",
      },
    });

    await db.prepare("INSERT INTO users (id, name) VALUES ('u1', 'Alice')").run();
    await db.prepare("INSERT INTO posts (id, author_id, title) VALUES ('p1', 'u1', 'Hello')").run();

    const post = await db.prepare("SELECT * FROM posts WHERE id = 'p1'").first<any>();
    expect(post.author_id).toBe("u1");
  });
});

// ─── Scenario 11: Table not in define (existing table untouched) ────────────

describe("Scenario: Tables not in define() are untouched", () => {
  it("does not affect tables created outside define()", async () => {
    // Manually create a table
    await db.prepare("CREATE TABLE manual (id TEXT PRIMARY KEY, data TEXT)").run();
    await db.prepare("INSERT INTO manual (id, data) VALUES ('m1', 'keep me')").run();

    // Run define with a different table
    await define(db, {
      managed: { id: "text primary key", name: "text not null" },
    });

    // Manual table should still exist with data
    const row = await db.prepare("SELECT * FROM manual WHERE id = 'm1'").first<any>();
    expect(row.data).toBe("keep me");
  });
});

// ─── Scenario 12: Empty schema ──────────────────────────────────────────────

describe("Scenario: Edge cases", () => {
  it("handles empty schema", async () => {
    // Should not throw — no tables to create, no DDL to run
    await define(db, {});
  });

  it("handles table with single column (just PK)", async () => {
    await define(db, {
      counters: { id: "text primary key" },
    });

    await db.prepare("INSERT INTO counters (id) VALUES ('hits')").run();
    const row = await db.prepare("SELECT * FROM counters").first<any>();
    expect(row.id).toBe("hits");
  });

  it("handles column names with underscores and numbers", async () => {
    await define(db, {
      data: {
        id: "text primary key",
        field_1: "text",
        field_2_name: "text",
        _private: "text",
      },
    });

    const cols = await getColumns("data");
    expect(cols.map((c) => c.name)).toEqual(["id", "field_1", "field_2_name", "_private"]);
  });
});

// ─── Scenario 13: Real-world SaaS schema evolution ──────────────────────────

describe("Scenario: Real-world SaaS (6 deploys over time)", () => {
  it("evolves a SaaS schema across multiple releases", async () => {
    // v1.0: MVP — users + workspaces
    await define(db, {
      users: {
        id: "text primary key",
        email: "text unique not null",
        name: "text not null",
      },
      workspaces: {
        id: "text primary key",
        name: "text not null",
        owner_id: "text not null",
      },
    });
    await db.prepare("INSERT INTO users (id, email, name) VALUES ('u1', 'founder@startup.com', 'Founder')").run();
    await db.prepare("INSERT INTO workspaces (id, name, owner_id) VALUES ('w1', 'My Startup', 'u1')").run();

    // v1.1: Add user avatar and workspace plan
    await define(db, {
      users: {
        id: "text primary key",
        email: "text unique not null",
        name: "text not null",
        avatar_url: "text",
      },
      workspaces: {
        id: "text primary key",
        name: "text not null",
        owner_id: "text not null",
        plan: "text default 'free'",
      },
    });

    // v1.2: Add projects table
    await define(db, {
      users: {
        id: "text primary key",
        email: "text unique not null",
        name: "text not null",
        avatar_url: "text",
      },
      workspaces: {
        id: "text primary key",
        name: "text not null",
        owner_id: "text not null",
        plan: "text default 'free'",
      },
      projects: {
        id: "text primary key",
        workspace_id: "text not null",
        name: "text not null",
        status: "text default 'active'",
      },
    });
    await db.prepare("INSERT INTO projects (id, workspace_id, name) VALUES ('p1', 'w1', 'Website')").run();

    // v1.3: Add tasks table + project description
    await define(db, {
      users: {
        id: "text primary key",
        email: "text unique not null",
        name: "text not null",
        avatar_url: "text",
      },
      workspaces: {
        id: "text primary key",
        name: "text not null",
        owner_id: "text not null",
        plan: "text default 'free'",
      },
      projects: {
        id: "text primary key",
        workspace_id: "text not null",
        name: "text not null",
        status: "text default 'active'",
        description: "text",
      },
      tasks: {
        id: "text primary key",
        project_id: "text not null",
        title: "text not null",
        assignee_id: "text",
        status: "text default 'todo'",
        priority: "integer default 0",
      },
    });
    await db.prepare("INSERT INTO tasks (id, project_id, title) VALUES ('t1', 'p1', 'Launch website')").run();

    // Verify all data intact through all migrations
    const user = await db.prepare("SELECT * FROM users WHERE id = 'u1'").first<any>();
    expect(user.email).toBe("founder@startup.com");
    expect(user.avatar_url).toBeNull();

    const ws = await db.prepare("SELECT * FROM workspaces WHERE id = 'w1'").first<any>();
    expect(ws.plan).toBe("free");

    const project = await db.prepare("SELECT * FROM projects WHERE id = 'p1'").first<any>();
    expect(project.status).toBe("active");
    expect(project.description).toBeNull();

    const task = await db.prepare("SELECT * FROM tasks WHERE id = 't1'").first<any>();
    expect(task.status).toBe("todo");
    expect(task.priority).toBe(0);

    // Verify tables
    const tables = await getTables();
    expect(tables).toEqual(["projects", "tasks", "users", "workspaces"]);

    // Verify total columns
    const userCols = await getColumns("users");
    expect(userCols.map((c) => c.name)).toEqual(["id", "email", "name", "avatar_url"]);

    const wsCols = await getColumns("workspaces");
    expect(wsCols.map((c) => c.name)).toEqual(["id", "name", "owner_id", "plan"]);
  });
});
