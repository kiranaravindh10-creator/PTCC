import { getTableName, sql, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

/**
 * `"table"."id"` of the outer query, for correlated subqueries in a select list:
 *
 *   activePeople: sql`(select count(*) from ${users} u where u.branch_id = ${outerId(branches)})`
 *
 * Needed because Drizzle drops table names from column references in the select list of a
 * single-table query — `${branches.id}` would render as `"id"` and silently bind to the
 * subquery's own `id` column.
 */
export function outerId(table: PgTable): SQL {
  return sql`${sql.identifier(getTableName(table))}.${sql.identifier("id")}`;
}
