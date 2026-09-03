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
     */
    idle_timeout: 60,
    max_lifetime: 60 * 30,

    /*
     * Cap the pool per instance.
     *
     * The library default is 10, and the previous note here argued for leaving
     * it there so a page's parallel queries would not queue. That reasoning
     * only holds if the connections are cheap, and against Supavisor they are
     * not: the pooler has a fixed ceiling shared by every warm function, so
     * two instances at 10 exhaust it and the third gets EMAXCONNSESSION —
     * which the pages report as "Database not reachable", blaming the network
     * for what is really a budget we overspent. It happened in production on
     * 2026-09-02.
     *
     * Three is enough for the widest page (the patient profile runs five
     * queries in one Promise.all, so two of them wait a few milliseconds), and
     * it leaves room for several instances inside the same ceiling.
     */
    max: 3,
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
