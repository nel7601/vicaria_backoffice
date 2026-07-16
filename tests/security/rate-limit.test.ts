import { describe, expect, it } from "vitest";
import { InMemoryRateLimiter, fixedWindow } from "@/lib/security/rate-limit";

describe("fixedWindow (SEC-07)", () => {
  it("allows up to the limit then blocks within the window", () => {
    let s = fixedWindow(undefined, 1000, 2, 1000);
    expect(s.decision.allowed).toBe(true);
    s = fixedWindow(s.state, 1100, 2, 1000);
    expect(s.decision.allowed).toBe(true);
    s = fixedWindow(s.state, 1200, 2, 1000);
    expect(s.decision.allowed).toBe(false);
    expect(s.decision.remaining).toBe(0);
  });

  it("resets after the window elapses", () => {
    let s = fixedWindow(undefined, 1000, 1, 1000);
    expect(s.decision.allowed).toBe(true);
    s = fixedWindow(s.state, 1500, 1, 1000);
    expect(s.decision.allowed).toBe(false);
    s = fixedWindow(s.state, 2001, 1, 1000);
    expect(s.decision.allowed).toBe(true);
  });
});

describe("InMemoryRateLimiter", () => {
  it("tracks separate keys with an injected clock", () => {
    let now = 0;
    const rl = new InMemoryRateLimiter(1, 1000, () => now);
    expect(rl.check("a").allowed).toBe(true);
    expect(rl.check("a").allowed).toBe(false);
    expect(rl.check("b").allowed).toBe(true);
    now = 1001;
    expect(rl.check("a").allowed).toBe(true);
  });
});
