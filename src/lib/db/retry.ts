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
