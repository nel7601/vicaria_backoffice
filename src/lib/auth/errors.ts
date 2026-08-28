import type { Action, Resource } from "./rbac";

/**
 * Authorization failures shared by every entry point (web Server Actions,
 * Route Handlers and the assistant API).
 *
 * They live in their own module so that `authorize.ts` (the web adapter) and
 * `authorize-principal.ts` (the transport-agnostic gate) can both raise them
 * without importing each other.
 */
export class AuthorizationError extends Error {
  constructor(
    public readonly resource: Resource,
    public readonly action: Action,
  ) {
    super(`Not authorized to ${action} ${resource}`);
    this.name = "AuthorizationError";
  }
}

export class AuthenticationError extends Error {
  constructor() {
    super("Authentication required");
    this.name = "AuthenticationError";
  }
}
