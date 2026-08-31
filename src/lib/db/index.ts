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
  const client = postgres(connectionString, {
    // Required by Supabase's transaction-mode pooler: it hands each
    // transaction a different backend, so a prepared statement made on one is
    // not there on the next.
    prepare: false,

    /*
     * Keep connections from outliving their usefulness.
     *
     * A warm serverless function reuses its pool between invocations, and the
     * pooler closes connections that sit idle without telling us; inheriting
     * one of those is the "database not reachable" that a refresh clears. So
     * we retire idle and long-lived connections ourselves.
     *
     * The pool size stays at the library default. Pages load several queries
     * at once, and a pool smaller than that turns every page into a queue —
     * which is a worse problem than the one being solved. Dead sockets are
     * handled by retiring them here and by the retry in `./retry`, not by
     * starving the pool.
     */
    idle_timeout: 60,
    max_lifetime: 60 * 30,
  });
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
