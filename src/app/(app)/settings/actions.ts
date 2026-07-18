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
  serviceCategories,
  servicePrices,
  services,
  userRoles,
  users,
} from "@/lib/db/schema";
import { getPrimaryOrganization } from "@/lib/db/queries/organization";
import {
  companySettingsSchema,
  employeeSchema,
  locationSchema,
  serviceSchema,
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

/** Create a service category (controlled vocabulary for filters/reports). */
export async function createCategoryAction(raw: unknown): Promise<ActionResult> {
  const user = await authorize("configuration", "update");
  const name = typeof raw === "object" && raw !== null ? (raw as { name?: string }).name : undefined;
  const nameEs = typeof raw === "object" && raw !== null ? (raw as { nameEs?: string }).nameEs : undefined;
  const clean = (name ?? "").trim();
  if (!clean || clean.length > 80) {
    return { ok: false, error: "Category name is required (max 80 chars)." };
  }
  const org = await getPrimaryOrganization();
  if (!org) return { ok: false, error: "Organization not found." };

  const db = getDb();
  try {
    const [created] = await db
      .insert(serviceCategories)
      .values({
        organizationId: org.id,
        name: clean,
        nameEs: blankToNull((nameEs ?? "").trim()),
      })
      .returning();
    await recordAudit({
      organizationId: org.id,
      actorUserId: user.authId,
      action: "create",
      entityType: "service_category",
      entityId: created.id,
      after: { name: clean },
    });
  } catch (e) {
    const msg = e instanceof Error && e.message.includes("uq_service_category")
      ? "That category already exists."
      : "Could not create category.";
    return { ok: false, error: msg };
  }

  revalidatePath("/settings");
  return { ok: true };
}

/** FR-SVC-001: create a catalog service with its initial versioned price. */
export async function createServiceAction(raw: unknown): Promise<ActionResult> {
  const user = await authorize("configuration", "update");
  const parsed = serviceSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const org = await getPrimaryOrganization();
  if (!org) return { ok: false, error: "Organization not found." };

  const data = parsed.data;
  const db = getDb();

  const created = await db.transaction(async (tx) => {
    const [svc] = await tx
      .insert(services)
      .values({
        organizationId: org.id,
        nameEn: data.nameEn,
        nameEs: data.nameEs,
        category: blankToNull(data.category),
        defaultDurationMinutes: data.defaultDurationMinutes,
        isActive: true,
      })
      .returning();
    await tx.insert(servicePrices).values({
      organizationId: org.id,
      serviceId: svc.id,
      priceCents: data.priceCents,
      taxRateBps: data.taxRateBps,
    });
    return svc;
  });

  await recordAudit({
    organizationId: org.id,
    actorUserId: user.authId,
    action: "create",
    entityType: "service",
    entityId: created.id,
    after: {
      nameEn: data.nameEn,
      priceCents: data.priceCents,
      taxRateBps: data.taxRateBps,
    },
  });

  revalidatePath("/settings");
  revalidatePath("/calendar");
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
