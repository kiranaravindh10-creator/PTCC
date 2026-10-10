import { sql, type SQL } from "drizzle-orm";
import { timestamp, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";

/**
 * Shared column helpers. Column names are written in camelCase in TypeScript and
 * mapped to snake_case in SQL (`casing: "snake_case"` in drizzle config and client).
 */

export const id = () => uuid().primaryKey().defaultRandom();

export const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/**
 * `created_by` / `updated_by` audit columns referencing users. The reference is
 * passed lazily to avoid an import cycle with the users table.
 */
export const userRef = (users: () => AnyPgColumn) => uuid().references(users, { onDelete: "restrict" });

/** `column IN ('a', 'b', …)` for CHECK constraints built from the TypeScript constants. */
export function inList(column: AnyPgColumn, values: readonly string[]): SQL {
  const list = values.map((value) => `'${value.replaceAll("'", "''")}'`).join(", ");
  return sql`${column} in (${sql.raw(list)})`;
}
