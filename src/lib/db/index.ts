import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Server-side Drizzle client.
 *
 * Uses the pooled Supabase connection string. RLS still applies at the
 * database layer; this client is for trusted server code paths that set the
 * appropriate role/claims. Never import this from client components.
 */
const connectionString = process.env.DATABASE_URL;

declare global {
  var __vicaria_db__: ReturnType<typeof createDb> | undefined;
}

function createDb() {
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and configure it.",
    );
  }
  const client = postgres(connectionString, { prepare: false });
  return drizzle(client, { schema });
}

/** Lazily instantiated to avoid connecting during build/import. */
export function getDb() {
  if (!globalThis.__vicaria_db__) {
    globalThis.__vicaria_db__ = createDb();
  }
  return globalThis.__vicaria_db__;
}

export { schema };
export type Database = ReturnType<typeof getDb>;
