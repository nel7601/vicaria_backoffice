import { describe, expect, it } from "vitest";
import { alreadyRegistered } from "@/lib/auth/provisioning";

/**
 * The invite path branches on this: recognised means "link the existing
 * account", unrecognised means "report a failure". Getting it wrong either
 * spams a second invitation or hides a real error.
 */
describe("alreadyRegistered", () => {
  it("recognises the wordings Supabase has used", () => {
    for (const message of [
      "A user with this email address has already been registered",
      "User already registered",
      "email_exists",
      "user already exists",
      "EMAIL_EXISTS",
    ]) {
      expect(alreadyRegistered(message), message).toBe(true);
    }
  });

  it("does not swallow unrelated failures", () => {
    for (const message of [
      "Error sending invite email",
      "rate limit exceeded",
      "Database error saving new user",
      "invalid email address",
      "",
    ]) {
      expect(alreadyRegistered(message), message).toBe(false);
    }
  });
});
