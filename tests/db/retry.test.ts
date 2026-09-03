import { describe, expect, it, vi } from "vitest";
import {
  dbErrorHint,
  dbFailureMessage,
  isConnectionError,
  isTransientDbError,
  withDbRetry,
} from "@/lib/db/retry";

const connErr = (code: string) => Object.assign(new Error(code), { code });

describe("isConnectionError", () => {
  it("recognises a dropped pooled connection", () => {
    expect(isConnectionError(connErr("CONNECTION_CLOSED"))).toBe(true);
    expect(isConnectionError(connErr("ECONNRESET"))).toBe(true);
  });

  it("does not mistake a query error for a connection error", () => {
    // A constraint violation must never be retried: it would fail identically
    // and hide the real cause behind a doubled attempt.
    expect(isConnectionError(connErr("23505"))).toBe(false);
    expect(isConnectionError(new Error("syntax error"))).toBe(false);
    expect(isConnectionError(null)).toBe(false);
  });
});

describe("withDbRetry", () => {
  it("returns the value when the read works", async () => {
    await expect(withDbRetry(async () => "ok")).resolves.toBe("ok");
  });

  it("retries once when the connection died, and succeeds", async () => {
    const read = vi
      .fn()
      .mockRejectedValueOnce(connErr("CONNECTION_CLOSED"))
      .mockResolvedValueOnce("ok");
    await expect(withDbRetry(read)).resolves.toBe("ok");
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("gives up after the second connection failure rather than looping", async () => {
    const read = vi.fn().mockRejectedValue(connErr("CONNECT_TIMEOUT"));
    await expect(withDbRetry(read)).rejects.toThrow("CONNECT_TIMEOUT");
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("rethrows a query error without retrying it", async () => {
    const read = vi.fn().mockRejectedValue(connErr("23505"));
    await expect(withDbRetry(read)).rejects.toThrow("23505");
    expect(read).toHaveBeenCalledTimes(1);
  });
});

/** Supavisor's real answer when the session-mode ceiling is reached. */
const poolerFull = Object.assign(
  new Error(
    "max clients reached in session mode - max clients are limited to pool_size: 15",
  ),
  { code: "XX000", severity: "FATAL" },
);

describe("dbErrorHint", () => {
  it("names the pooler ceiling, which hides behind a generic XX000", () => {
    // This is the failure that took production down on 2026-09-02 and read as
    // "Database not reachable" on every page. The code alone says nothing:
    // XX000 is Postgres's internal-error catch-all.
    const hint = dbErrorHint(poolerFull);
    expect(hint).toContain("full in session mode");
    expect(hint).toContain("6543");
  });

  it("recognizes the ceiling by driver code too", () => {
    expect(
      dbErrorHint(Object.assign(new Error("nope"), { code: "EMAXCONNSESSION" })),
    ).toContain("full in session mode");
  });

  it("does not blame the port when it is transaction mode that filled up", () => {
    // Same ceiling, different cause: on 6543 the port is already right and the
    // advice has to be about load, not configuration.
    const hint = dbErrorHint(
      Object.assign(new Error("max clients reached - in transaction mode"), {
        code: "XX000",
      }),
    );
    expect(hint).toContain("client limit");
    expect(hint).not.toContain("6543");
  });

  it("does not mistake every XX000 for a full pool", () => {
    expect(
      dbErrorHint(Object.assign(new Error("internal error"), { code: "XX000" })),
    ).toBe("error XX000");
  });

  it("tells a missing column from a missing table", () => {
    // A deployment whose code is ahead of its schema: the table is there, the
    // newest migration is not.
    expect(dbErrorHint(connErr("42703"))).toContain("column is missing");
    expect(dbErrorHint(connErr("42P01"))).toContain("table is missing");
  });

  it("never echoes the driver's message, which can carry query parameters", () => {
    const withPhi = Object.assign(
      new Error('duplicate key value violates unique constraint: "ana.ruiz@example.com"'),
      { code: "23505" },
    );
    const hint = dbErrorHint(withPhi);
    expect(hint).not.toContain("ana.ruiz@example.com");
    expect(hint).toBe("error 23505");
  });

  it("survives a thrown non-object", () => {
    expect(dbErrorHint("boom")).toBe("unknown error");
    expect(dbErrorHint(undefined)).toBe("unknown error");
  });
});

describe("isTransientDbError", () => {
  it("is true for the failures a refresh can clear", () => {
    expect(isTransientDbError(connErr("CONNECTION_CLOSED"))).toBe(true);
    expect(isTransientDbError(connErr("57P01"))).toBe(true);
    expect(isTransientDbError(poolerFull)).toBe(true);
  });

  it("is false for the structural ones, where refreshing only wastes time", () => {
    expect(isTransientDbError(connErr("42703"))).toBe(false);
    expect(isTransientDbError(connErr("42P01"))).toBe(false);
    expect(isTransientDbError(connErr("28P01"))).toBe(false);
  });
});

describe("dbFailureMessage", () => {
  it("says what failed to load and what to do about it", () => {
    const msg = dbFailureMessage("this invoice", poolerFull);
    expect(msg).toContain("Could not load this invoice");
    expect(msg).toContain("Try again");
  });

  it("sends a structural failure to an administrator instead of asking for a retry", () => {
    const msg = dbFailureMessage("settings", connErr("42703"));
    expect(msg).toContain("needs an administrator");
    expect(msg).not.toContain("Try again");
  });
});
