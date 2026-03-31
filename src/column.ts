/**
 * Optional typed column builder — compile-time validation for column definitions.
 *
 * @example
 * ```ts
 * import { column } from "d1-schema";
 *
 * const schema = {
 *   users: {
 *     id:    column.text("primary key"),
 *     email: column.text("unique not null"),
 *     name:  column.text("not null"),
 *     age:   column.integer(),
 *     score: column.real("default 0"),
 *     data:  column.blob(),
 *   },
 * };
 * ```
 *
 * Equivalent to writing raw strings but with type-checked SQLite types.
 * Both syntaxes work with define() — they produce the same strings.
 */

/** Create a TEXT column definition. */
function text(constraints?: string): string {
  return constraints ? `text ${constraints}` : "text";
}

/** Create an INTEGER column definition. */
function integer(constraints?: string): string {
  return constraints ? `integer ${constraints}` : "integer";
}

/** Create a REAL column definition. */
function real(constraints?: string): string {
  return constraints ? `real ${constraints}` : "real";
}

/** Create a BLOB column definition. */
function blob(constraints?: string): string {
  return constraints ? `blob ${constraints}` : "blob";
}

export const column = { text, integer, real, blob } as const;
