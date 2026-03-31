import { describe, it, expect } from "vitest";
import { computeOperations, D1SchemaError } from "../src/reconcile.js";
import { createMockD1 } from "./d1-mock.js";

describe("computeOperations", () => {
  it("returns CREATE_TABLE for new table", async () => {
    const db = createMockD1();
    const { operations } = await computeOperations(db, {
      todos: { id: "text primary key", text: "text not null" },
    });

    expect(operations).toHaveLength(1);
    expect(operations[0].action).toBe("CREATE_TABLE");
    expect(operations[0].table).toBe("todos");
    expect(operations[0].ddl).toContain("CREATE TABLE");
  });

  it("returns ADD_COLUMN for new column on existing table", async () => {
    const db = createMockD1();
    // Create table first
    await db.prepare('CREATE TABLE todos (id TEXT PRIMARY KEY, text TEXT NOT NULL)').run();

    const { operations } = await computeOperations(db, {
      todos: {
        id: "text primary key",
        text: "text not null",
        completed: "integer default 0",
      },
    });

    expect(operations).toHaveLength(1);
    expect(operations[0].action).toBe("ADD_COLUMN");
    expect(operations[0].ddl).toContain("completed");
  });

  it("returns empty operations when schema matches", async () => {
    const db = createMockD1();
    await db.prepare('CREATE TABLE todos (id TEXT PRIMARY KEY, text TEXT NOT NULL)').run();

    const { operations } = await computeOperations(db, {
      todos: { id: "text primary key", text: "text not null" },
    });

    expect(operations).toHaveLength(0);
  });

  it("warns about removed columns", async () => {
    const db = createMockD1();
    await db.prepare('CREATE TABLE todos (id TEXT PRIMARY KEY, text TEXT, old_col TEXT)').run();

    const { warnings } = await computeOperations(db, {
      todos: { id: "text primary key", text: "text" },
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("old_col");
    expect(warnings[0]).toContain("will not drop");
  });

  it("throws D1SchemaError for NOT NULL column without default", async () => {
    const db = createMockD1();
    await db.prepare('CREATE TABLE users (id TEXT PRIMARY KEY)').run();

    await expect(
      computeOperations(db, {
        users: { id: "text primary key", email: "text not null" },
      }),
    ).rejects.toThrow(D1SchemaError);
  });

  it("handles multiple new columns", async () => {
    const db = createMockD1();
    await db.prepare('CREATE TABLE users (id TEXT PRIMARY KEY)').run();

    const { operations } = await computeOperations(db, {
      users: {
        id: "text primary key",
        name: "text",
        bio: "text",
        age: "integer",
      },
    });

    expect(operations).toHaveLength(3);
    expect(operations.every(op => op.action === "ADD_COLUMN")).toBe(true);
  });

  it("handles multiple tables", async () => {
    const db = createMockD1();

    const { operations } = await computeOperations(db, {
      users: { id: "text primary key", name: "text" },
      posts: { id: "text primary key", title: "text" },
    });

    expect(operations).toHaveLength(2);
    expect(operations.every(op => op.action === "CREATE_TABLE")).toBe(true);
  });

  it("handles mix of new table and column addition", async () => {
    const db = createMockD1();
    await db.prepare('CREATE TABLE users (id TEXT PRIMARY KEY)').run();

    const { operations } = await computeOperations(db, {
      users: { id: "text primary key", name: "text" },
      posts: { id: "text primary key", title: "text" },
    });

    expect(operations).toHaveLength(2);
    expect(operations[0].action).toBe("ADD_COLUMN"); // users.name
    expect(operations[1].action).toBe("CREATE_TABLE"); // posts
  });
});
