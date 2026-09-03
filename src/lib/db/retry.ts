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
 * Supavisor answers a full pool with a generic XX000 and the diagnosis in the
 * message text, so the code alone cannot tell it apart from any other internal
 * error. Matched on the message; only the canned description below is ever
 * shown.
 */
function poolerCeiling(error: unknown): "session" | "transaction" | null {
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  const message = (error as { message?: unknown }).message;
  if (code === "EMAXCONNSESSION") return "session";
  if (code === "EMAXCLIENTS") return "transaction";
  if (typeof message !== "string") return null;
  if (code !== "XX000") return null;
  if (!/max clients reached|max_clients|pool_size/i.test(message)) return null;
  // Session mode is the misconfiguration; transaction mode simply ran out of
  // room. Telling them apart is the difference between "fix the port" and
  // "there is too much traffic", and only the message says which.
  return /session mode/i.test(message) ? "session" : "transaction";
}

/**
 * True when trying again might work: the connection broke, the database was
 * restarting, the pool was momentarily full. False for anything structural —
 * a missing column, wrong credentials — where a refresh only wastes the
 * user's time and hides the fact that someone has to go and fix it.
 */
export function isTransientDbError(error: unknown): boolean {
  if (isConnectionError(error)) return true;
  if (poolerCeiling(error)) return true;
  const code =
    error && typeof error === "object"
      ? (error as { code?: unknown }).code
      : undefined;
  return code === "57P01" || code === "57P03" || code === "53300";
}

/**
 * A short, safe description of a database failure, for showing on screen.
 *
 * Postgres error codes and driver codes carry no patient data, and without
 * them a report is just "it broke": the difference between a dropped
 * connection, an exhausted pool and a missing table is the whole diagnosis.
 * The message text is deliberately not included — a query's error can echo the
 * parameters that caused it, and those are patient data. That is what logs are
 * for.
 */
export function dbErrorHint(error: unknown): string {
  // Checked before the code switch: the pooler's ceiling hides behind XX000.
  const ceiling = poolerCeiling(error);
  if (ceiling === "session") {
    return "the connection pooler is full in session mode (EMAXCONNSESSION): DATABASE_URL is on port 5432, and a serverless app needs the transaction-mode port 6543";
  }
  if (ceiling === "transaction") {
    return "the connection pooler is at its client limit (EMAXCLIENTS): too many requests at once, or too many connections per instance";
  }
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
    case "42703":
      // What a half-migrated deployment looks like: the code is ahead of the
      // schema. Distinct from 42P01 because the table is there and only a
      // column is missing, which points at the newest migration.
      return "a column is missing (42703) — the code is ahead of the schema, a migration has not been run";
    case "42883":
      return "a database function is missing (42883) — a migration has not been run";
    case "3D000":
      return "that database does not exist (3D000) — check DATABASE_URL";
    case "28P01":
      return "the database rejected the credentials (28P01)";
    case "28000":
      return "the database refused the connection role (28000) — check DATABASE_URL";
    case "42501":
      return "permission denied (42501) — check the role and its RLS policies";
    case "CONNECT_TIMEOUT":
      return "the database did not answer in time (CONNECT_TIMEOUT)";
    case "ENOTFOUND":
      return "the database host does not resolve (ENOTFOUND) — check DATABASE_URL uses the pooler";
    default:
      return isConnectionError(error)
        ? `the connection dropped (${code})`
        : `error ${code}`;
  }
}

/**
 * The whole sentence a page shows when a read fails, so the wording is written
 * once instead of on every page.
 *
 * `subject` names what failed to load, in lower case ("the patient", "this
 * invoice"): which page broke is the first thing anyone asks, and a screenshot
 * of a bare error code does not say.
 */
export function dbFailureMessage(subject: string, error: unknown): string {
  const closing = isTransientDbError(error)
    ? "Try again; if it repeats, send this line to support."
    : "This one needs an administrator: send them this line.";
  return `Could not load ${subject} — ${dbErrorHint(error)}. ${closing}`;
}
