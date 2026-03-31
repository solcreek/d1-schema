# Changelog

## 0.4.0 (2026-03-31)

### Added
- **UNIQUE constraint drift detection**: warns when schema declares UNIQUE but DB doesn't have it, and vice versa — queries PRAGMA index_list + index_info
- **Index support**: `_indexes: ["author_id", "status, created_at"]` — auto-creates indexes with deterministic naming (`idx_{table}_{cols}`)
- **`snapshot()` function**: generates SQL migration file from schema definition — graduation path from `define()` to versioned migration files

### Stats
- 134 tests across 10 files

## 0.3.0 (2026-03-31)

### Added
- **Constraint drift detection**: warns when NOT NULL or DEFAULT values in the database differ from the schema definition
- **D1 batch optimization**: all PRAGMA table_info queries batched in a single D1 roundtrip — multi-table cold start reduced from ~3-5ms to ~1-2ms
- **Typed column helpers**: optional `column.text()`, `column.integer()`, `column.real()`, `column.blob()` helpers as alternative to raw strings — mixable with raw syntax

### Stats
- 116 tests across 8 files

## 0.2.0 (2026-03-31)

### Fixed
- **Concurrent race condition**: `ALTER TABLE ADD COLUMN` from multiple Workers no longer crashes — catches "duplicate column name" and "table already exists" errors
- **SQL injection**: all table/column names escaped via `escapeIdent()` (doubles internal `"` per SQL standard)

### Added
- **Column type drift detection**: warns when DB column type differs from schema (e.g., DB has INTEGER but schema says TEXT)
- **Multi-DB cache**: `WeakMap<D1Database, hash>` supports multiple databases in the same Worker isolate

### Changed
- **Eliminated per-request DB overhead**: removed `_d1_schema_meta` table entirely — cold path goes straight to PRAGMA diff, hot path is pure in-memory (~0.01ms, zero DB queries)
- **Removed `_resetCache()` export**: was a no-op, WeakMap auto-clears with GC

### Stats
- 102 tests across 7 files

## 0.1.3 (2026-03-31)

### Changed
- Split README into Creek (zero config) vs standalone (wrangler) paths
- Added concurrency safety note and Local Development section

## 0.1.2 (2026-03-31)

### Changed
- Added TypeScript function signature and error handling example to README
- Added wrangler.toml D1 binding setup documentation
- Added multi-table with foreign key relationships example
- Added explicit Limitations section
- Filled in "Works With ORMs" section with Drizzle and Prisma examples

## 0.1.1 (2026-03-31)

### Added
- README with full documentation

## 0.1.0 (2026-03-31)

### Added
- Initial release
- `define(db, schema)` — declarative D1 schema with auto-migration
- Column definition parser (SQL string → structured)
- DDL generator (CREATE TABLE IF NOT EXISTS, ALTER TABLE ADD COLUMN)
- Schema hash for fast skip on unchanged schemas
- Reconcile engine: additive-only, never drops columns or tables
- Three modes: `apply` (default), `warn` (dry-run), `off`
- `_d1_schema_log` table for schema change audit trail
- `D1SchemaError` with actionable fix suggestions
- Zero dependencies, Apache 2.0
- 33 tests
