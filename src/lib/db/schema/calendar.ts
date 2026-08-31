import { pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { primaryId, timestamps } from "./_shared";
import { organizations } from "./organizations";
import { employees } from "./users";

/**
 * calendar_feed_tokens — the secret URL that lets an employee subscribe to
 * their own schedule from Google, Apple, Outlook or Zoho.
 *
 * The token *is* the credential: a calendar client has no session and cannot
 * sign in, so the feed authorises on the token alone. That is why it is long,
 * scoped to one employee, revocable, and why what the events say about a
 * patient is capped by an organization-wide setting rather than left to
 * whoever holds the link.
 */
export const calendarFeedTokens = pgTable("calendar_feed_tokens", {
  id: primaryId(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  employeeId: uuid("employee_id")
    .notNull()
    .references(() => employees.id),
  token: varchar("token", { length: 64 }).notNull().unique(),
  /** Last time a calendar client fetched it; makes an unused link obvious. */
  lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "date" }),
  /** Set instead of deleting, so a leaked link stays dead and traceable. */
  revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
  ...timestamps,
});
