import { describe, it, expect, beforeEach } from "vitest";
import { define, column } from "../src/index.js";
import { createMockD1 } from "./d1-mock.js";

let db: D1Database;

beforeEach(() => {
  db = createMockD1();
});

describe("column helpers", () => {
  it("column.text() produces 'text'", () => {
    expect(column.text()).toBe("text");
  });

  it("column.text('not null') produces 'text not null'", () => {
    expect(column.text("not null")).toBe("text not null");
  });

  it("column.integer() produces 'integer'", () => {
    expect(column.integer()).toBe("integer");
  });

  it("column.integer('primary key') produces 'integer primary key'", () => {
    expect(column.integer("primary key")).toBe("integer primary key");
  });

  it("column.real('default 0') produces 'real default 0'", () => {
    expect(column.real("default 0")).toBe("real default 0");
  });

  it("column.blob() produces 'blob'", () => {
    expect(column.blob()).toBe("blob");
  });
});

describe("column helpers with define()", () => {
  it("creates table using column helpers", async () => {
    await define(db, {
      users: {
        id: column.text("primary key"),
        email: column.text("unique not null"),
        name: column.text("not null"),
        age: column.integer(),
        score: column.real("default 0"),
        data: column.blob(),
      },
    });

    await db.prepare("INSERT INTO users (id, email, name) VALUES ('1', 'a@b.com', 'Alice')").run();
    const row = await db.prepare("SELECT * FROM users WHERE id = '1'").first<any>();
    expect(row.email).toBe("a@b.com");
    expect(row.age).toBeNull();
    expect(row.score).toBe(0);
  });

  it("works mixed with raw strings", async () => {
    await define(db, {
      items: {
        id: column.text("primary key"),
        name: "text not null",              // raw string
        count: column.integer("default 0"), // typed helper
        note: "text",                       // raw string
      },
    });

    await db.prepare("INSERT INTO items (id, name) VALUES ('1', 'Widget')").run();
    const row = await db.prepare("SELECT * FROM items WHERE id = '1'").first<any>();
    expect(row.name).toBe("Widget");
    expect(row.count).toBe(0);
  });

  it("adds column using column helper on existing table", async () => {
    await define(db, { t: { id: column.text("primary key") } });

    await define(db, {
      t: {
        id: column.text("primary key"),
        status: column.text("default 'active'"),
      },
    });

    await db.prepare("INSERT INTO t (id) VALUES ('1')").run();
    const row = await db.prepare("SELECT status FROM t WHERE id = '1'").first<any>();
    expect(row.status).toBe("active");
  });
});
