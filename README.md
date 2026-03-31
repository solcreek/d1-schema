# d1-schema

Declarative schema for Cloudflare D1.
Define tables in code. Auto-created on first use.
No migration files. No CLI. No config.

## Install

```bash
npm install d1-schema
```

## Usage

```ts
import { define } from "d1-schema";

export default {
  async fetch(request, env) {
    await define(env.DB, {
      todos: {
        id: "text primary key",
        text: "text not null",
        completed: "integer default 0",
        created_at: "text default (datetime('now'))",
      },
    });

    // Use standard D1 queries — nothing special
    const todos = await env.DB.prepare("SELECT * FROM todos").all();
    return Response.json(todos.results);
  },
};
```

That's it. No migration files. No CLI commands. No wrangler config. Tables are created on first request.

## How It Works

- **First request**: tables created automatically (`CREATE TABLE IF NOT EXISTS`)
- **Add a column**: add it to `define()`, deployed on next request (`ALTER TABLE ADD COLUMN`)
- **Remove a column**: warning logged, column kept in database (data safety)
- **Schema unchanged**: skipped in <0.5ms (hash comparison)

All operations are additive. `d1-schema` never drops columns or tables.

## Multi-Table

```ts
await define(env.DB, {
  users: {
    id: "text primary key",
    email: "text unique not null",
    name: "text not null",
    role: "text default 'member'",
  },
  posts: {
    id: "text primary key",
    author_id: "text not null",
    title: "text not null",
    body: "text",
    published: "integer default 0",
  },
  comments: {
    id: "text primary key",
    post_id: "text not null",
    user_id: "text not null",
    body: "text not null",
    created_at: "text default (datetime('now'))",
  },
});
```

## Schema Evolution

Add columns by adding them to `define()`. Existing data is preserved.

```ts
// v1: ship with basic schema
await define(env.DB, {
  users: {
    id: "text primary key",
    name: "text not null",
  },
});

// v2: add a column — just redeploy
await define(env.DB, {
  users: {
    id: "text primary key",
    name: "text not null",
    bio: "text",                          // new nullable column — auto-added
    role: "text not null default 'member'" // new NOT NULL with default — auto-added
  },
});
```

**Rules:**
- Nullable columns are added automatically
- NOT NULL columns require a default value
- Removed columns are warned about, never dropped
- Type changes are warned about, never altered

## Migration Modes

Control behavior via options or environment variable:

```ts
// Default: auto-apply
await define(env.DB, schema);

// Dry-run: log SQL that would run, don't execute
await define(env.DB, schema, { autoMigrate: "warn" });

// Off: no reconciliation
await define(env.DB, schema, { autoMigrate: "off" });
```

Or set `CREEK_AUTO_MIGRATE` environment variable: `apply`, `warn`, or `off`.

## Schema Change Log

`d1-schema` automatically records every schema change in a `_d1_schema_log` table:

```sql
SELECT * FROM _d1_schema_log ORDER BY created_at DESC;
```

| table_name | action | ddl | applied | created_at |
|-----------|--------|-----|---------|------------|
| users | ADD_COLUMN | ALTER TABLE "users" ADD COLUMN "bio" TEXT | 1 | 2026-03-31 ... |
| todos | CREATE_TABLE | CREATE TABLE IF NOT EXISTS "todos" (...) | 1 | 2026-03-31 ... |

## Column Definition Syntax

Column definitions are standard SQLite column constraint syntax:

```ts
{
  id:         "text primary key",
  email:      "text unique not null",
  name:       "text not null",
  count:      "integer default 0",
  price:      "real not null",
  data:       "blob",
  role:       "text not null default 'member'",
  created_at: "text default (datetime('now'))",
}
```

## Works With ORMs

`d1-schema` manages schema. Use any query tool you prefer:

```ts
// With Drizzle
import { drizzle } from "drizzle-orm/d1";
const orm = drizzle(env.DB);

// With raw D1
await env.DB.prepare("SELECT * FROM todos WHERE completed = ?").bind(0).all();

// With Creek
import { db } from "creek";
await db.query("SELECT * FROM todos");
```

## With Creek

When using [Creek](https://creek.dev), `d1-schema` is built in:

```ts
import { db } from "creek";

db.define({
  todos: {
    id: "text primary key",
    text: "text not null",
    completed: "integer default 0",
  },
});

await db.query("SELECT * FROM todos");
await db.mutate("INSERT INTO todos (id, text) VALUES (?, ?)", id, text);
```

## SQL Migration Files (Alternative)

If you prefer traditional migration files, `d1-schema` coexists with them. Use whichever approach fits your workflow:

```
migrations/
  0001_create_todos.sql
  0002_add_users.sql
```

Both approaches auto-apply on deploy. They don't conflict.

## License

Apache-2.0
