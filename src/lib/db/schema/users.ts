import {
  boolean,
  jsonb,
  pgTable,
  text,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { primaryId, timestamps } from "./_shared";
import { preferredLanguageEnum, roleEnum } from "./enums";
import { locations, organizations } from "./organizations";

/**
 * users — authenticated identity. `auth_user_id` links to Supabase Auth
 * (auth.users). We keep a local mirror for RBAC joins, scopes and audit.
 */
export const users = pgTable("users", {
  id: primaryId(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  authUserId: uuid("auth_user_id").unique(),
  email: varchar("email", { length: 255 }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  mfaEnrolled: boolean("mfa_enrolled").notNull().default(false),
  ...timestamps,
});

/**
 * employees — labour profile attached to a user (§FR-ADM-002).
 * Signature is a private storage path, never a public URL.
 */
export const employees = pgTable("employees", {
  id: primaryId(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  firstName: varchar("first_name", { length: 120 }).notNull(),
  lastName: varchar("last_name", { length: 120 }).notNull(),
  title: varchar("title", { length: 120 }),
  photoStoragePath: text("photo_storage_path"),
  signatureStoragePath: text("signature_storage_path"),
  languages: jsonb("languages").notNull().default(["en"]),
  isPractitioner: boolean("is_practitioner").notNull().default(false),
  ...timestamps,
});

/**
 * user_roles — RBAC assignment with optional location scope (§4, FR-ADM-003).
 * A user may hold several roles; scopes narrow authorization per location.
 */
export const userRoles = pgTable("user_roles", {
  id: primaryId(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  role: roleEnum("role").notNull(),
  // null = all locations within the organization.
  locationId: uuid("location_id").references(() => locations.id),
  ...timestamps,
});

/** Convenience re-export used by relations elsewhere. */
export const languageEnumRef = preferredLanguageEnum;
