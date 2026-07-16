"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { authorize } from "@/lib/auth/authorize";
import { recordAudit } from "@/lib/audit/record";
import { getDb } from "@/lib/db";
import {
  companySettings,
  employees,
  locations,
  organizations,
  userRoles,
  users,
} from "@/lib/db/schema";
import { getPrimaryOrganization } from "@/lib/db/queries/organization";
import {
  companySettingsSchema,
  employeeSchema,
  locationSchema,
} from "@/lib/schemas/settings";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

function blankToNull(v: string | undefined): string | null {
  return v && v.length > 0 ? v : null;
}

/** FR-ADM-001: update company identity, numbering, taxes and legal texts. */
export async function updateCompanySettingsAction(
  raw: unknown,
): Promise<ActionResult> {
  const user = await authorize("configuration", "update");
  const parsed = companySettingsSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const org = await getPrimaryOrganization();
  if (!org) return { ok: false, error: "Organization not found." };

  const data = parsed.data;
  const db = getDb();

  const before = await db
    .select()
    .from(companySettings)
    .where(eq(companySettings.organizationId, org.id))
    .limit(1);

  await db
    .update(organizations)
    .set({
      legalName: data.legalName,
      operatingName: blankToNull(data.operatingName) ?? undefined,
      timezone: data.timezone,
      currency: data.currency,
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, org.id));

  await db
    .update(companySettings)
    .set({
      address: blankToNull(data.address),
      phone: blankToNull(data.phone),
      email: blankToNull(data.email),
      website: blankToNull(data.website),
      invoiceNumberPrefix: data.invoiceNumberPrefix,
      legalFooterEn: blankToNull(data.legalFooterEn),
      legalFooterEs: blankToNull(data.legalFooterEs),
      updatedAt: new Date(),
    })
    .where(eq(companySettings.organizationId, org.id));

  await recordAudit({
    organizationId: org.id,
    actorUserId: user.authId,
    action: "update",
    entityType: "company_settings",
    entityId: org.id,
    before: before[0] ?? null,
    after: { ...data },
  });

  revalidatePath("/settings");
  return { ok: true };
}

/** FR-ADM-001: add a location. */
export async function createLocationAction(raw: unknown): Promise<ActionResult> {
  const user = await authorize("configuration", "update");
  const parsed = locationSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const org = await getPrimaryOrganization();
  if (!org) return { ok: false, error: "Organization not found." };

  const db = getDb();
  const [created] = await db
    .insert(locations)
    .values({
      organizationId: org.id,
      name: parsed.data.name,
      address: blankToNull(parsed.data.address),
      phone: blankToNull(parsed.data.phone),
      timezone: parsed.data.timezone,
    })
    .returning();

  await recordAudit({
    organizationId: org.id,
    actorUserId: user.authId,
    action: "create",
    entityType: "location",
    entityId: created.id,
    after: created,
  });

  revalidatePath("/settings");
  return { ok: true };
}

/**
 * FR-ADM-002/003: create an employee record with a role assignment.
 *
 * Creates the local user/employee/role rows. Sending the Supabase auth invite
 * and setting the JWT role claim is done via the admin client in the invite
 * flow; here we provision the domain records so the org chart is complete.
 */
export async function createEmployeeAction(raw: unknown): Promise<ActionResult> {
  const user = await authorize("users_roles", "create");
  const parsed = employeeSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const org = await getPrimaryOrganization();
  if (!org) return { ok: false, error: "Organization not found." };

  const data = parsed.data;
  const db = getDb();

  const result = await db.transaction(async (tx) => {
    const [u] = await tx
      .insert(users)
      .values({ organizationId: org.id, email: data.email })
      .returning();
    const [e] = await tx
      .insert(employees)
      .values({
        organizationId: org.id,
        userId: u.id,
        firstName: data.firstName,
        lastName: data.lastName,
        title: blankToNull(data.title),
        isPractitioner: data.isPractitioner,
      })
      .returning();
    await tx.insert(userRoles).values({
      organizationId: org.id,
      userId: u.id,
      role: data.role,
    });
    return { userId: u.id, employeeId: e.id };
  });

  await recordAudit({
    organizationId: org.id,
    actorUserId: user.authId,
    action: "create",
    entityType: "employee",
    entityId: result.employeeId,
    after: {
      email: data.email,
      role: data.role,
      isPractitioner: data.isPractitioner,
    },
    reason: "Employee provisioned via Settings",
  });

  revalidatePath("/settings");
  return { ok: true };
}
