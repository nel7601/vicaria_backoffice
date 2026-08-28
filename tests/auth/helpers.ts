/** Shared fixtures for the authorization tests. */
export { can, readScopeFor, ROLES, RESOURCES } from "@/lib/auth/rbac";
export type { Action } from "@/lib/auth/rbac";

/** Every action in the matrix; kept explicit so a new one fails loudly here. */
export const ACTIONS_UNDER_TEST = [
  "create",
  "read",
  "update",
  "delete",
] as const;
