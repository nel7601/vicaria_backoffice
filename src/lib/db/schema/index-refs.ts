/**
 * Re-export of the tables the assistant schema references.
 *
 * Importing them from "./index" would close a cycle (index re-exports this
 * file), so the two foreign-key targets are pulled straight from their module.
 */
export { organizations } from "./organizations";
export { users } from "./users";
