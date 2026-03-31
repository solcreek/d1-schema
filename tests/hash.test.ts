import { describe, it, expect } from "vitest";
import { hashSchema } from "../src/hash.js";

describe("hashSchema", () => {
  it("produces a string hash", async () => {
    const hash = await hashSchema({ todos: { id: "text primary key" } });
    expect(typeof hash).toBe("string");
    expect(hash.length).toBeGreaterThan(0);
  });

  it("produces same hash for same schema", async () => {
    const schema = { todos: { id: "text primary key", text: "text not null" } };
    const a = await hashSchema(schema);
    const b = await hashSchema(schema);
    expect(a).toBe(b);
  });

  it("produces different hash for different schema", async () => {
    const a = await hashSchema({ todos: { id: "text primary key" } });
    const b = await hashSchema({ todos: { id: "text primary key", text: "text" } });
    expect(a).not.toBe(b);
  });

  it("is order-independent (sorted keys)", async () => {
    const a = await hashSchema({ todos: { id: "text primary key", text: "text" } });
    const b = await hashSchema({ todos: { text: "text", id: "text primary key" } });
    expect(a).toBe(b);
  });

  it("is table-order-independent", async () => {
    const a = await hashSchema({ users: { id: "text primary key" }, todos: { id: "text primary key" } });
    const b = await hashSchema({ todos: { id: "text primary key" }, users: { id: "text primary key" } });
    expect(a).toBe(b);
  });
});
