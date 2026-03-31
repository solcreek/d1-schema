# d1-schema

[![npm](https://img.shields.io/npm/v/d1-schema)](https://www.npmjs.com/package/d1-schema)
[![tests](https://img.shields.io/badge/tests-116%20passed-brightgreen)](https://github.com/solcreek/d1-schema)
[![license](https://img.shields.io/badge/license-Apache%202.0-blue)](LICENSE)
[![zero deps](https://img.shields.io/badge/dependencies-0-green)](package.json)

Declarative schema for Cloudflare D1.
Define tables in code. Auto-created on first use.
No migration files. No CLI. No schema config.

## Install

```bash
npm install d1-schema
```

## Quick Start

### With Creek (zero config)

```ts
import { db } from "creek";

db.define({
  todos: {
    id: "text primary key",
    text: "text not null",
    completed: "integer default 0",
    created_at: "text default (datetime('now'))",
  },
});

await db.query("SELECT * FROM todos");
await db.mutate("INSERT INTO todos (id, text) VALUES (?, ?)", id, text);
```

Creek handles everything — database provisioning, bindings, realtime sync. Just `creek deploy`.

### Standalone (any Cloudflare Worker)

```ts
import { define } from "d1-schema";

export default {
  async fetch(request: Request, env: Env) {
    await define(env.DB, {
      todos: {
        id: "text primary key",
        text: "text not null",
        completed: "integer default 0",
        created_at: "text default (datetime('now'))",
      },
    });

    const todos = await env.DB.prepare("SELECT * FROM todos").all();
    return Response.json(todos.results);
  },
};
```

Standalone usage requires a D1 binding in `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "my-db"
database_id = "<your-database-id>"  # from `wrangler d1 create my-db`
```

## TypeScript API

```ts
import type { D1Database } from "@cloudflare/workers-types";

type Schema = Record<string, Record<string, string>>;
type Options = { autoMigrate?: "apply" | "warn" | "off" };

function define(db: D1Database, schema: Schema, options?: Options): Promise<void>;
```

`define()` is async, returns `Promise<void>`, and throws `D1SchemaError` on validation failures (e.g., adding a NOT NULL column without a default).

```ts
import { define, D1SchemaError } from "d1-schema";

try {
  await define(env.DB, schema);
} catch (e) {
  if (e instanceof D1SchemaError) {
    console.error(e.message); // Clear message with fix suggestions
  }
}
```

## How It Works

- **First request**: tables created automatically (`CREATE TABLE IF NOT EXISTS`)
- **Add a column**: add it to `define()`, applied on next deploy (`ALTER TABLE ADD COLUMN`)
- **Remove a column**: warning logged, column kept in database (data safety)
- **Schema unchanged**: skipped in <0.5ms (hash comparison, no DB query)
- **Concurrent requests**: all DDL is idempotent — multiple Workers calling `define()` simultaneously are safe

All operations are additive. `d1-schema` never drops columns or tables.

## Multi-Table with Relationships

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
    author_id: "text not null references users(id)",
    title: "text not null",
    body: "text",
    published: "integer default 0",
    created_at: "text default (datetime('now'))",
  },
  comments: {
    id: "text primary key",
    post_id: "text not null references posts(id)",
    user_id: "text not null references users(id)",
    body: "text not null",
    created_at: "text default (datetime('now'))",
  },
});
```

Foreign keys (`references`) are passed through to SQLite as-is. D1 enforces them when `PRAGMA foreign_keys = ON`.

## Column Definition Syntax

Two equivalent syntaxes — use whichever you prefer, mix freely:

### Raw strings (zero abstraction)

```ts
{
  id:         "text primary key",
  count:      "integer default 0",
  price:      "real not null",
  data:       "blob",
  email:      "text unique not null",
  role:       "text not null default 'member'",
  created_at: "text default (datetime('now'))",
  user_id:    "text not null references users(id)",
}
```

### Typed helpers (optional, compile-time type checking)

```ts
import { column } from "d1-schema";

{
  id:         column.text("primary key"),
  count:      column.integer("default 0"),
  price:      column.real("not null"),
  data:       column.blob(),
  email:      column.text("unique not null"),
  role:       column.text("not null default 'member'"),
  created_at: column.text("default (datetime('now'))"),
  user_id:    column.text("not null references users(id)"),
}
```

`column.text()`, `column.integer()`, `column.real()`, `column.blob()` produce the same strings — they just ensure valid SQLite types at compile time. The constraint string is appended as-is.
```

## Schema Evolution

Add columns by adding them to `define()`. Existing data is preserved.

```ts
// v1: initial schema
await define(env.DB, {
  users: { id: "text primary key", name: "text not null" },
});

// v2: add columns — just redeploy
await define(env.DB, {
  users: {
    id: "text primary key",
    name: "text not null",
    bio: "text",                            // nullable column — auto-added
    role: "text not null default 'member'",  // NOT NULL with default — auto-added
  },
});
```

**Rules:**
- Nullable columns are added automatically
- NOT NULL columns require a default value (throws `D1SchemaError` otherwise)
- Removed columns are warned about, never dropped
- Type changes are warned about, never altered

## Migration Modes

Control behavior via options or environment variable:

```ts
// Default: auto-apply
await define(env.DB, schema);

// Dry-run: log SQL that would run, don't execute
await define(env.DB, schema, { autoMigrate: "warn" });

// Off: no reconciliation (use migration files instead)
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

## Works With ORMs

`d1-schema` manages schema creation. Use any query tool for reads/writes:

```ts
// Raw D1 (built-in, no extra dependency)
await env.DB.prepare("SELECT * FROM todos WHERE completed = ?").bind(0).all();
await env.DB.prepare("INSERT INTO todos (id, text) VALUES (?, ?)").bind(id, text).run();

// Drizzle ORM
import { drizzle } from "drizzle-orm/d1";
const orm = drizzle(env.DB);
await orm.select().from(todos);

// Prisma
import { PrismaClient } from "@prisma/client";
import { PrismaD1 } from "@prisma/adapter-d1";
const prisma = new PrismaClient({ adapter: new PrismaD1(env.DB) });
```

`d1-schema` and ORMs don't conflict. Use `define()` for table creation, your preferred ORM for queries.

## Local Development

**With Creek:**
```bash
creek dev    # D1 auto-provisioned locally via Miniflare, schema applied on first request
```

**Standalone:**
```bash
wrangler dev    # Uses local SQLite file, schema applied on first request
```

Schema persists across restarts in both cases (SQLite file in `.wrangler/` or `.creek/dev/`).

## Limitations

`d1-schema` is intentionally additive-only. It does **not** support:

- **Column drops** — removing a column from `define()` logs a warning, never drops
- **Column renames** — rename requires manual SQL
- **Type changes** — changing a column type logs a warning, never alters
- **Down-migrations / rollback** — no undo mechanism
- **Composite primary keys** — use single-column primary keys
- **Indexes** — use raw SQL `CREATE INDEX` for now

For these operations, use raw SQL via `env.DB.prepare()` or a full migration tool like Drizzle Kit.

## SQL Migration Files (Alternative)

If you prefer traditional migration files, both approaches coexist:

```
migrations/
  0001_create_todos.sql
  0002_add_users.sql
```

Use `define()` for rapid development, graduate to migration files when you need full control.

## License

Apache-2.0
