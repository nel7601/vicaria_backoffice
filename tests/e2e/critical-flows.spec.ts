import { test, expect } from "@playwright/test";

/**
 * Critical-flow E2E specs (spec §15.1). These require a seeded staging/preview
 * environment with test users per role. They self-skip until E2E_BASE_URL is
 * set, so CI stays green before infra is provisioned (S0-02/S0-03).
 *
 * Coverage maps to the §15.1 critical test cases:
 *  - Marketing cannot read clinical notes via UI/API.
 *  - A signed note rejects edits and only accepts an amendment.
 *  - A repeated Square webhook does not create a duplicate payment.
 *  - Concurrent allocations never exceed balance/available.
 *  - Two simultaneous issues never produce a duplicate number.
 *  - An expired signed URL cannot open a private document.
 *  - Deactivating an employee revokes access.
 *  - Void/refund preserves history and updates reports.
 *  - Changing a service price does not alter historic invoices.
 */

const configured = Boolean(process.env.E2E_BASE_URL);
test.skip(!configured, "Set E2E_BASE_URL and seed a staging env to run E2E.");

test("unauthenticated access redirects to login", async ({ page }) => {
  await page.goto("/patients");
  await expect(page).toHaveURL(/\/login/);
});

test("login page renders the sign-in form", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
});

test.describe("role matrix (§15.1)", () => {
  test.fixme(
    true,
    "Requires seeded per-role users; asserts Marketing cannot open a clinical note.",
  );
});

test.describe("revenue cycle (§15.1)", () => {
  test.fixme(
    true,
    "Requires seeded billing data; asserts signed note immutability, invoice numbering, allocation guards.",
  );
});
