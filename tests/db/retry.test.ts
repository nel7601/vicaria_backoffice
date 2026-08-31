import { describe, expect, it, vi } from "vitest";
import { isConnectionError, withDbRetry } from "@/lib/db/retry";

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
