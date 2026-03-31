import Database from "better-sqlite3";

/**
 * Minimal D1Database mock backed by better-sqlite3 (in-memory SQLite).
 * Implements only the subset used by d1-schema: prepare → bind → run/all/first.
 */
export function createMockD1(): D1Database {
  const sqlite = new Database(":memory:");

  function createStatement(sql: string): D1PreparedStatement {
    let boundValues: unknown[] = [];

    const stmt: D1PreparedStatement = {
      bind(...values: unknown[]) {
        boundValues = values;
        return stmt;
      },
      async run() {
        const s = sqlite.prepare(sql);
        if (boundValues.length > 0) {
          s.run(...boundValues);
        } else {
          s.run();
        }
        return { meta: { changes: sqlite.prepare("SELECT changes() as c").get() as any, last_row_id: 0, changed_db: false, size_after: 0, rows_read: 0, rows_written: 0, duration: 0 }, success: true, results: [] };
      },
      async all<T = Record<string, unknown>>() {
        const s = sqlite.prepare(sql);
        let rows: unknown[];
        if (boundValues.length > 0) {
          rows = s.all(...boundValues);
        } else {
          rows = s.all();
        }
        return { results: rows as T[], success: true, meta: { changes: 0, last_row_id: 0, changed_db: false, size_after: 0, rows_read: 0, rows_written: 0, duration: 0 } };
      },
      async first<T = Record<string, unknown>>(col?: string) {
        const s = sqlite.prepare(sql);
        let row: any;
        if (boundValues.length > 0) {
          row = s.get(...boundValues);
        } else {
          row = s.get();
        }
        if (!row) return null as T;
        if (col) return row[col] as T;
        return row as T;
      },
      async raw() {
        return [];
      },
    };

    return stmt;
  }

  return {
    prepare(sql: string) {
      return createStatement(sql);
    },
    async batch(stmts: D1PreparedStatement[]) {
      const results = [];
      for (const s of stmts) {
        results.push(await s.run());
      }
      return results;
    },
    async exec(sql: string) {
      sqlite.exec(sql);
      return { count: 1, duration: 0 };
    },
    async dump() {
      return new ArrayBuffer(0);
    },
  } as D1Database;
}
