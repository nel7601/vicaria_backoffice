import { describe, expect, it } from "vitest";
import {
  AssistantAuthError,
  bearerToken,
} from "@/lib/assistant/auth/request-identity";

/**
 * Token extraction and the 401/403 split. Signature verification itself is
 * Supabase's job and needs a live project, so it is covered by the integration
 * suite rather than here.
 */

function requestWith(authorization?: string): Request {
  return new Request("https://example.test/api/assistant/v1/me", {
    headers: authorization ? { authorization } : {},
  });
}

describe("bearerToken", () => {
  it("extracts the token from a well-formed header", () => {
    expect(bearerToken(requestWith("Bearer abc.def.ghi"))).toBe("abc.def.ghi");
  });

  it("accepts the scheme in any case, as RFC 7235 requires", () => {
    expect(bearerToken(requestWith("bearer abc.def.ghi"))).toBe("abc.def.ghi");
  });

  it("tolerates surrounding whitespace", () => {
    expect(bearerToken(requestWith("  Bearer   abc.def.ghi  "))).toBe(
      "abc.def.ghi",
    );
  });

  it("rejects a missing header", () => {
    expect(() => bearerToken(requestWith())).toThrow(AssistantAuthError);
  });

  it("rejects a non-Bearer scheme", () => {
    expect(() => bearerToken(requestWith("Basic dXNlcjpwYXNz"))).toThrow(
      AssistantAuthError,
    );
  });

  it("rejects an empty Bearer value", () => {
    expect(() => bearerToken(requestWith("Bearer   "))).toThrow(
      AssistantAuthError,
    );
  });
});

describe("AssistantAuthError status mapping", () => {
  it("answers 401 when the caller is not authenticated", () => {
    expect(new AssistantAuthError("missing_token", "x").status).toBe(401);
    expect(new AssistantAuthError("invalid_token", "x").status).toBe(401);
  });

  it("answers 403 when the caller is known but refused", () => {
    expect(new AssistantAuthError("no_tenant", "x").status).toBe(403);
    expect(new AssistantAuthError("inactive_user", "x").status).toBe(403);
    expect(new AssistantAuthError("mfa_required", "x").status).toBe(403);
  });

  it("answers 503, not 401, when the auth server cannot be reached", () => {
    // A 401 here would make the app discard a valid session during an outage.
    expect(new AssistantAuthError("auth_unavailable", "x").status).toBe(503);
  });
});
