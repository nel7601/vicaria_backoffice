import { sql } from "drizzle-orm";
import { timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Shared column helpers.
 *
 * Spec §8.1 conventions:
 * - UUID primary keys.
 * - Timestamps stored in UTC (created_at, updated_at, deleted_at).
 * - Business tables carry organization_id (tenant boundary, §9.3).
 */

export const primaryId = () =>
  uuid("id").primaryKey().default(sql`gen_random_uuid()`);

export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
};

/** Only used on tables where soft delete is legally/operationally allowed (§8.1). */
export const softDelete = {
  deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
};
