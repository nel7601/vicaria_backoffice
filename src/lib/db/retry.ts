/**
 * One retry for a read whose *connection* failed.
 *
 * Even with idle connections closed early, a pooled socket can still die
 * between being handed out and being used — the pooler restarts, the network
 * blips — and the request that finds it fails for a reason that has nothing to
 * do with the query. Users see "database not reachable" and a refresh fixes
 * it, which is the shape of a problem that should have been retried.
 *
 * Only connection-level failures are retried, and only for reads. Those happen
 * before the statement reaches the server, so running it again cannot repeat
 * work; a query that failed on its own merits is a real error and is rethrown
 * untouched.
 */

/** Errors that mean "the connection broke", not "the query was wrong". */
const CONNECTION_ERRORS = new Set([
  "CONNECTION_CLOSED",
  "CONNECTION_DESTROYED",
  "CONNECTION_ENDED",
  "CONNECT_TIMEOUT",
  "ECONNREFUSED",
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
]);

export function isConnectionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && CONNECTION_ERRORS.has(code);
}

/** Run a read, retrying once if the connection (not the query) failed. */
export async function withDbRetry<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (!isConnectionError(error)) throw error;
    // The broken socket has been dropped from the pool by now; the next
    // attempt opens a fresh one.
    return read();
  }
}

/**
 * A short, safe description of a database failure, for showing on screen.
 *
 * Postgres error codes and driver codes carry no patient data, and without
 * them a report is just "it broke": the difference between a dropped
 * connection, an exhausted pool and a missing table is the whole diagnosis.
 * The message text is deliberately not included — that is what logs are for.
 */
export function dbErrorHint(error: unknown): string {
  if (!error || typeof error !== "object") return "unknown error";
  const code = (error as { code?: unknown }).code;
  if (typeof code !== "string") return "unknown error";

  switch (code) {
    case "53300":
      return "too many connections (53300) — check DATABASE_URL uses the pooler on port 6543";
    case "57P01":
    case "57P03":
      return `the database was restarting (${code})`;
    case "42P01":
      return "a table is missing (42P01) — a migration has not been run";
    case "28P01":
      return "the database rejected the credentials (28P01)";
    case "CONNECT_TIMEOUT":
      return "the database did not answer in time (CONNECT_TIMEOUT)";
    default:
      return isConnectionError(error)
        ? `the connection dropped (${code})`
        : `error ${code}`;
  }
}
