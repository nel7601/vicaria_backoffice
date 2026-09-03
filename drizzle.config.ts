import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

// Load .env.local first (Next.js convention), then .env.
config({ path: ".env.local" });
config({ path: ".env" });

export default defineConfig({
  schema: "./src/lib/db/schema/index.ts",
  out: "./supabase/migrations",
  dialect: "postgresql",
  dbCredentials: {
    /*
     * Migrations go through the SESSION-mode pooler (port 5432), not the
     * transaction-mode one the app uses. DDL, advisory locks and
     * CREATE INDEX CONCURRENTLY all need a connection that stays put for more
     * than one statement, and transaction mode hands each statement a
     * different backend.
     *
     * Falls back to DATABASE_URL so a machine with only that one still works.
     */
    url: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
