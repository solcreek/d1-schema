# d1-schema

[![npm](https://img.shields.io/npm/v/d1-schema)](https://www.npmjs.com/package/d1-schema)
[![tests](https://img.shields.io/badge/tests-134%20passed-brightgreen)](https://github.com/solcreek/d1-schema)
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

type Schema = Record<string, Record<string, string> & { _indexes?: string[] }>;
type Options = { autoMigrate?: "apply" | "warn" | "off" };

function define(db: D1Database, schema: Schema, options?: Options): Promise<void>;
function snapshot(schema: Schema): string;
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
- **Schema unchanged**: ~0.01ms (in-memory hash, zero DB queries)
- **Concurrent requests**: all DDL is idempotent — multiple Workers calling `define()` simultaneously are safe
- **Drift detection**: warns on type, NOT NULL, DEFAULT, and UNIQUE mismatches between schema and DB

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

## Indexes

Declare indexes with the `_indexes` key — auto-created with deterministic naming:

```ts
await define(env.DB, {
  posts: {
    id: "text primary key",
    author_id: "text not null",
    status: "text default 'draft'",
    created_at: "text default (datetime('now'))",
    _indexes: [
      "author_id",              // → idx_posts_author_id
      "status, created_at",     // → idx_posts_status_created_at (composite)
    ],
  },
});
```

Indexes use `CREATE INDEX IF NOT EXISTS` — idempotent and safe to call repeatedly.

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

`column.text()`, `column.integer()`, `column.real()`, `column.blob()` produce the same strings — they just ensure valid SQLite types at compile time.

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
- Expression defaults (e.g. `datetime('now')`) only work on CREATE TABLE, not ALTER TABLE ADD COLUMN
- Removed columns are warned about, never dropped
- Type/constraint changes are warned about, never altered

## Drift Detection

`d1-schema` detects when the database schema drifts from your code:

- **Type mismatch**: `Column "users.count" type mismatch: DB has INTEGER, schema says TEXT`
- **NOT NULL mismatch**: `schema says NOT NULL but DB allows NULL`
- **DEFAULT mismatch**: `DB has 'active', schema says 'inactive'`
- **UNIQUE mismatch**: `schema says UNIQUE but DB has no unique constraint`

All drift is reported as warnings — `d1-schema` never alters existing columns.

## Migration Modes

```ts
await define(env.DB, schema);                          // auto-apply (default)
await define(env.DB, schema, { autoMigrate: "warn" }); // dry-run
await define(env.DB, schema, { autoMigrate: "off" });  // disabled
```

Or set `CREEK_AUTO_MIGRATE` environment variable: `apply`, `warn`, or `off`.

## Snapshot (Graduation Path)

When your team outgrows auto-migration, export your schema to a SQL migration file:

```ts
import { snapshot } from "d1-schema";

const sql = snapshot({
  users: {
    id: "text primary key",
    email: "text unique not null",
    name: "text not null",
    _indexes: ["email"],
  },
});

// sql contains:
// CREATE TABLE IF NOT EXISTS "users" (...)
// CREATE INDEX IF NOT EXISTS "idx_users_email" ON "users" ("email")
```

Save the output to `migrations/0001_initial.sql` and switch to versioned migrations.

## Schema Change Log

`d1-schema` records every schema change in a `_d1_schema_log` table:

```sql
SELECT * FROM _d1_schema_log ORDER BY created_at DESC;
```

| table_name | action | ddl | applied | created_at |
|-----------|--------|-----|---------|------------|
| posts | CREATE_INDEX | CREATE INDEX IF NOT EXISTS "idx_posts_author_id" ... | 1 | ... |
| users | ADD_COLUMN | ALTER TABLE "users" ADD COLUMN "bio" TEXT | 1 | ... |
| todos | CREATE_TABLE | CREATE TABLE IF NOT EXISTS "todos" (...) | 1 | ... |

## Works With ORMs

`d1-schema` manages schema creation. Use any query tool for reads/writes:

```ts
// Raw D1 (built-in, no extra dependency)
await env.DB.prepare("SELECT * FROM todos WHERE completed = ?").bind(0).all();

// Drizzle ORM
import { drizzle } from "drizzle-orm/d1";
const orm = drizzle(env.DB);

// Prisma
import { PrismaClient } from "@prisma/client";
import { PrismaD1 } from "@prisma/adapter-d1";
const prisma = new PrismaClient({ adapter: new PrismaD1(env.DB) });
```

## Local Development

**With Creek:**
```bash
creek dev    # D1 auto-provisioned locally, schema applied on first request
```

**Standalone:**
```bash
wrangler dev    # Uses local SQLite, schema applied on first request
```

Schema persists across restarts in both cases.

## Limitations

`d1-schema` is intentionally additive-only. It does **not** support:

- **Column drops** — warned, never dropped
- **Column renames** — requires manual SQL
- **Type changes** — warned, never altered
- **Down-migrations / rollback** — use `snapshot()` + manual SQL
- **Composite primary keys** — use single-column primary keys

For these operations, use raw SQL or a full migration tool like Drizzle Kit.

## License

Apache-2.0
