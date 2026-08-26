"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { authorize } from "@/lib/auth/authorize";
import { recordAudit } from "@/lib/audit/record";
import { getDb } from "@/lib/db";
import {
  appointments,
  companySettings,
  employees,
  encounters,
  encounterTemplates,
  encounterTemplateVersions,
  invoiceItems,
  locations,
  organizations,
  serviceCategories,
  servicePrices,
  services,
  userRoles,
  users,
} from "@/lib/db/schema";
import { templateSchema } from "@/lib/schemas/template";
import { getPrimaryOrganization } from "@/lib/db/queries/organization";
import {
  companySettingsSchema,
  employeeSchema,
  locationSchema,
  serviceSchema,
  updateCategorySchema,
  updateEmployeeSchema,
  updateServiceSchema,
} from "@/lib/schemas/settings";
import { and, isNull } from "drizzle-orm";

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
        family: data.family,
        billingUnit: data.billingUnit,
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

/** Update a service; a price/tax change closes the current price row and
 * versions in a new one so issued invoices are never altered (FR-SVC-001). */
export async function updateServiceAction(
  serviceId: string,
  raw: unknown,
): Promise<ActionResult> {
  const user = await authorize("configuration", "update");
  const parsed = updateServiceSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const org = await getPrimaryOrganization();
  if (!org) return { ok: false, error: "Organization not found." };

  const data = parsed.data;
  const db = getDb();

  const [existing] = await db
    .select()
    .from(services)
    .where(and(eq(services.organizationId, org.id), eq(services.id, serviceId)))
    .limit(1);
  if (!existing) return { ok: false, error: "Service not found." };

  await db.transaction(async (tx) => {
    await tx
      .update(services)
      .set({
        nameEn: data.nameEn,
        nameEs: data.nameEs,
        category: blankToNull(data.category),
        family: data.family,
        billingUnit: data.billingUnit,
        defaultDurationMinutes: data.defaultDurationMinutes,
        isActive: data.isActive,
        updatedAt: new Date(),
      })
      .where(eq(services.id, serviceId));

    const [currentPrice] = await tx
      .select()
      .from(servicePrices)
      .where(
        and(
          eq(servicePrices.serviceId, serviceId),
          isNull(servicePrices.effectiveTo),
        ),
      )
      .limit(1);

    const priceChanged =
      !currentPrice ||
      currentPrice.priceCents !== data.priceCents ||
      currentPrice.taxRateBps !== data.taxRateBps;

    if (priceChanged) {
      const now = new Date();
      if (currentPrice) {
        await tx
          .update(servicePrices)
          .set({ effectiveTo: now, updatedAt: now })
          .where(eq(servicePrices.id, currentPrice.id));
      }
      await tx.insert(servicePrices).values({
        organizationId: org.id,
        serviceId,
        priceCents: data.priceCents,
        taxRateBps: data.taxRateBps,
        effectiveFrom: now,
      });
    }
  });

  await recordAudit({
    organizationId: org.id,
    actorUserId: user.authId,
    action: "update",
    entityType: "service",
    entityId: serviceId,
    before: { nameEn: existing.nameEn, isActive: existing.isActive },
    after: {
      nameEn: data.nameEn,
      isActive: data.isActive,
      priceCents: data.priceCents,
      taxRateBps: data.taxRateBps,
    },
  });

  revalidatePath("/settings");
  revalidatePath("/calendar");
  return { ok: true };
}

/** Update a category; renaming propagates to services using the old name. */
export async function updateCategoryAction(
  categoryId: string,
  raw: unknown,
): Promise<ActionResult> {
  const user = await authorize("configuration", "update");
  const parsed = updateCategorySchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const org = await getPrimaryOrganization();
  if (!org) return { ok: false, error: "Organization not found." };

  const db = getDb();
  const [existing] = await db
    .select()
    .from(serviceCategories)
    .where(
      and(
        eq(serviceCategories.organizationId, org.id),
        eq(serviceCategories.id, categoryId),
      ),
    )
    .limit(1);
  if (!existing) return { ok: false, error: "Category not found." };

  const data = parsed.data;
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(serviceCategories)
        .set({
          name: data.name,
          nameEs: blankToNull(data.nameEs),
          isActive: data.isActive,
          updatedAt: new Date(),
        })
        .where(eq(serviceCategories.id, categoryId));

      // Keep services consistent when the category is renamed.
      if (existing.name !== data.name) {
        await tx
          .update(services)
          .set({ category: data.name, updatedAt: new Date() })
          .where(
            and(
              eq(services.organizationId, org.id),
              eq(services.category, existing.name),
            ),
          );
      }
    });
  } catch (e) {
    const msg =
      e instanceof Error && e.message.includes("uq_service_category")
        ? "That category name already exists."
        : "Could not update category.";
    return { ok: false, error: msg };
  }

  await recordAudit({
    organizationId: org.id,
    actorUserId: user.authId,
    action: "update",
    entityType: "service_category",
    entityId: categoryId,
    before: { name: existing.name, isActive: existing.isActive },
    after: { name: data.name, isActive: data.isActive },
  });

  revalidatePath("/settings");
  return { ok: true };
}

/**
 * Update an employee: profile fields, active flag and role set. Role changes
 * are audited as permission_change; deactivation best-effort revokes access by
 * banning the linked auth user (FR-AUTH-003).
 */
export async function updateEmployeeAction(
  employeeId: string,
  raw: unknown,
): Promise<ActionResult> {
  const user = await authorize("users_roles", "update");
  const parsed = updateEmployeeSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const org = await getPrimaryOrganization();
  if (!org) return { ok: false, error: "Organization not found." };

  const data = parsed.data;
  const db = getDb();

  const [emp] = await db
    .select({
      id: employees.id,
      userId: employees.userId,
    })
    .from(employees)
    .where(
      and(eq(employees.organizationId, org.id), eq(employees.id, employeeId)),
    )
    .limit(1);
  if (!emp) return { ok: false, error: "Employee not found." };

  const [target] = await db
    .select({ authUserId: users.authUserId, isActive: users.isActive })
    .from(users)
    .where(eq(users.id, emp.userId))
    .limit(1);

  const previousRoles = (
    await db
      .select({ role: userRoles.role })
      .from(userRoles)
      .where(eq(userRoles.userId, emp.userId))
  ).map((r) => r.role);

  await db.transaction(async (tx) => {
    await tx
      .update(employees)
      .set({
        firstName: data.firstName,
        lastName: data.lastName,
        title: blankToNull(data.title),
        isPractitioner: data.isPractitioner,
        isCaregiver: data.isCaregiver,
        updatedAt: new Date(),
      })
      .where(eq(employees.id, employeeId));

    await tx
      .update(users)
      .set({ isActive: data.isActive, updatedAt: new Date() })
      .where(eq(users.id, emp.userId));

    // Replace the role set.
    await tx.delete(userRoles).where(eq(userRoles.userId, emp.userId));
    for (const role of data.roles) {
      await tx.insert(userRoles).values({
        organizationId: org.id,
        userId: emp.userId,
        role,
      });
    }
  });

  // Best-effort: sync the auth account (JWT role claims + ban on deactivate).
  if (target?.authUserId) {
    try {
      const { createAdminClient } = await import("@/lib/supabase/admin");
      const admin = createAdminClient();
      await admin.auth.admin.updateUserById(target.authUserId, {
        app_metadata: { roles: data.roles, organization_id: org.id },
        ban_duration: data.isActive ? "none" : "876000h",
      });
    } catch (e) {
      console.error("Auth sync failed (roles/ban):", e);
    }
  }

  const rolesChanged =
    previousRoles.length !== data.roles.length ||
    previousRoles.some((r) => !(data.roles as string[]).includes(r));

  await recordAudit({
    organizationId: org.id,
    actorUserId: user.authId,
    action: rolesChanged ? "permission_change" : "update",
    entityType: "employee",
    entityId: employeeId,
    before: { roles: previousRoles, isActive: target?.isActive },
    after: { roles: data.roles, isActive: data.isActive },
    reason: rolesChanged ? "Roles updated via Settings" : undefined,
  });

  revalidatePath("/settings");
  return { ok: true };
}

function isFkViolation(e: unknown): boolean {
  return (
    e instanceof Error &&
    ("code" in e && (e as { code?: string }).code === "23503") ===
      true
  ) || (e instanceof Error && e.message.includes("violates foreign key"));
}

const IN_USE_MSG =
  "It has already been used elsewhere, so it cannot be deleted — archive it instead (set it inactive).";

async function countUsage(
  checks: Promise<{ n: number }[]>[],
): Promise<number> {
  const results = await Promise.all(checks);
  return results.reduce((sum, r) => sum + (r[0]?.n ?? 0), 0);
}

/** Delete an unused service; refuses when referenced (archive instead). */
export async function deleteServiceAction(serviceId: string): Promise<ActionResult> {
  const user = await authorize("configuration", "delete");
  const org = await getPrimaryOrganization();
  if (!org) return { ok: false, error: "Organization not found." };

  const db = getDb();
  const { count } = await import("drizzle-orm");
  const used = await countUsage([
    db.select({ n: count() }).from(appointments).where(eq(appointments.serviceId, serviceId)),
    db.select({ n: count() }).from(encounters).where(eq(encounters.serviceId, serviceId)),
    db.select({ n: count() }).from(invoiceItems).where(eq(invoiceItems.serviceId, serviceId)),
  ]);
  if (used > 0) return { ok: false, error: IN_USE_MSG };

  try {
    await db.transaction(async (tx) => {
      await tx.delete(servicePrices).where(eq(servicePrices.serviceId, serviceId));
      await tx
        .delete(services)
        .where(and(eq(services.organizationId, org.id), eq(services.id, serviceId)));
    });
  } catch (e) {
    if (isFkViolation(e)) return { ok: false, error: IN_USE_MSG };
    return { ok: false, error: "Could not delete service." };
  }

  await recordAudit({
    organizationId: org.id,
    actorUserId: user.authId,
    action: "delete",
    entityType: "service",
    entityId: serviceId,
    reason: "Deleted unused service via Settings",
  });

  revalidatePath("/settings");
  revalidatePath("/calendar");
  return { ok: true };
}

/** Delete an unused category; refuses when any service uses it. */
export async function deleteCategoryAction(categoryId: string): Promise<ActionResult> {
  const user = await authorize("configuration", "delete");
  const org = await getPrimaryOrganization();
  if (!org) return { ok: false, error: "Organization not found." };

  const db = getDb();
  const [cat] = await db
    .select()
    .from(serviceCategories)
    .where(
      and(
        eq(serviceCategories.organizationId, org.id),
        eq(serviceCategories.id, categoryId),
      ),
    )
    .limit(1);
  if (!cat) return { ok: false, error: "Category not found." };

  const { count } = await import("drizzle-orm");
  const used = await countUsage([
    db
      .select({ n: count() })
      .from(services)
      .where(
        and(eq(services.organizationId, org.id), eq(services.category, cat.name)),
      ),
  ]);
  if (used > 0) return { ok: false, error: IN_USE_MSG };

  await db.delete(serviceCategories).where(eq(serviceCategories.id, categoryId));

  await recordAudit({
    organizationId: org.id,
    actorUserId: user.authId,
    action: "delete",
    entityType: "service_category",
    entityId: categoryId,
    before: { name: cat.name },
    reason: "Deleted unused category via Settings",
  });

  revalidatePath("/settings");
  return { ok: true };
}

/**
 * Delete an employee with no history. Any reference (appointments, encounters,
 * payments, audit trail…) blocks deletion — deactivate instead. Relies on FK
 * integrity as the final guard.
 */
export async function deleteEmployeeAction(employeeId: string): Promise<ActionResult> {
  const user = await authorize("users_roles", "delete");
  const org = await getPrimaryOrganization();
  if (!org) return { ok: false, error: "Organization not found." };

  const db = getDb();
  const [emp] = await db
    .select({ id: employees.id, userId: employees.userId })
    .from(employees)
    .where(and(eq(employees.organizationId, org.id), eq(employees.id, employeeId)))
    .limit(1);
  if (!emp) return { ok: false, error: "Employee not found." };

  const [target] = await db
    .select({ authUserId: users.authUserId, email: users.email })
    .from(users)
    .where(eq(users.id, emp.userId))
    .limit(1);

  // Quick explicit checks for the common references (nicer error than FK).
  const { count } = await import("drizzle-orm");
  const { patients: patientsTable } = await import("@/lib/db/schema");
  const used = await countUsage([
    db.select({ n: count() }).from(appointments).where(eq(appointments.employeeId, employeeId)),
    db.select({ n: count() }).from(encounters).where(eq(encounters.practitionerId, employeeId)),
    db
      .select({ n: count() })
      .from(patientsTable)
      .where(eq(patientsTable.primaryPractitionerId, employeeId)),
  ]);
  if (used > 0) return { ok: false, error: IN_USE_MSG };

  try {
    await db.transaction(async (tx) => {
      await tx.delete(userRoles).where(eq(userRoles.userId, emp.userId));
      await tx.delete(employees).where(eq(employees.id, employeeId));
      // Audit/access logs and *_by columns reference users.id; if any exist
      // the FK violation below rejects the whole transaction.
      await tx.delete(users).where(eq(users.id, emp.userId));
    });
  } catch (e) {
    if (isFkViolation(e)) return { ok: false, error: IN_USE_MSG };
    return { ok: false, error: "Could not delete employee." };
  }

  // Best-effort: remove the linked auth account too.
  if (target?.authUserId) {
    try {
      const { createAdminClient } = await import("@/lib/supabase/admin");
      const admin = createAdminClient();
      await admin.auth.admin.deleteUser(target.authUserId);
    } catch (e) {
      console.error("Auth account delete failed:", e);
    }
  }

  await recordAudit({
    organizationId: org.id,
    actorUserId: user.authId,
    action: "delete",
    entityType: "employee",
    entityId: employeeId,
    before: { email: target?.email },
    reason: "Deleted unused employee via Settings",
  });

  revalidatePath("/settings");
  return { ok: true };
}

/** Create an encounter template with a published v1 (FR-ENC-002). */
export async function createTemplateAction(raw: unknown): Promise<ActionResult> {
  const user = await authorize("configuration", "update");
  const parsed = templateSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const org = await getPrimaryOrganization();
  if (!org) return { ok: false, error: "Organization not found." };

  const data = parsed.data;
  const db = getDb();
  const created = await db.transaction(async (tx) => {
    const [tpl] = await tx
      .insert(encounterTemplates)
      .values({
        organizationId: org.id,
        name: data.name,
        serviceId: data.serviceId || null,
      })
      .returning();
    await tx.insert(encounterTemplateVersions).values({
      organizationId: org.id,
      templateId: tpl.id,
      version: 1,
      schema: { fields: data.fields },
      publishedAt: new Date(),
      publishedBy: user.dbUserId,
    });
    return tpl;
  });

  await recordAudit({
    organizationId: org.id,
    actorUserId: user.authId,
    action: "create",
    entityType: "encounter_template",
    entityId: created.id,
    after: { name: data.name, fields: data.fields.length },
  });

  revalidatePath("/settings");
  revalidatePath("/encounters");
  return { ok: true };
}

/**
 * Edit a template by publishing a NEW version (FR-ENC-002: a published
 * version never changes retroactively — existing encounters keep theirs).
 */
export async function publishTemplateVersionAction(
  templateId: string,
  raw: unknown,
): Promise<ActionResult> {
  const user = await authorize("configuration", "update");
  const parsed = templateSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const org = await getPrimaryOrganization();
  if (!org) return { ok: false, error: "Organization not found." };

  const data = parsed.data;
  const db = getDb();

  const [tpl] = await db
    .select()
    .from(encounterTemplates)
    .where(
      and(
        eq(encounterTemplates.organizationId, org.id),
        eq(encounterTemplates.id, templateId),
      ),
    )
    .limit(1);
  if (!tpl) return { ok: false, error: "Template not found." };

  const { desc } = await import("drizzle-orm");
  const [latest] = await db
    .select({ version: encounterTemplateVersions.version })
    .from(encounterTemplateVersions)
    .where(eq(encounterTemplateVersions.templateId, templateId))
    .orderBy(desc(encounterTemplateVersions.version))
    .limit(1);
  const nextVersion = (latest?.version ?? 0) + 1;

  await db.transaction(async (tx) => {
    await tx
      .update(encounterTemplates)
      .set({
        name: data.name,
        serviceId: data.serviceId || null,
        updatedAt: new Date(),
      })
      .where(eq(encounterTemplates.id, templateId));
    await tx.insert(encounterTemplateVersions).values({
      organizationId: org.id,
      templateId,
      version: nextVersion,
      schema: { fields: data.fields },
      publishedAt: new Date(),
      publishedBy: user.dbUserId,
    });
  });

  await recordAudit({
    organizationId: org.id,
    actorUserId: user.authId,
    action: "update",
    entityType: "encounter_template",
    entityId: templateId,
    after: { name: data.name, version: nextVersion },
  });

  revalidatePath("/settings");
  revalidatePath("/encounters");
  return { ok: true };
}

/** Delete a template only when no encounter ever used any of its versions. */
export async function deleteTemplateAction(templateId: string): Promise<ActionResult> {
  const user = await authorize("configuration", "delete");
  const org = await getPrimaryOrganization();
  if (!org) return { ok: false, error: "Organization not found." };

  const db = getDb();
  const { count, inArray } = await import("drizzle-orm");

  const versionIds = (
    await db
      .select({ id: encounterTemplateVersions.id })
      .from(encounterTemplateVersions)
      .where(eq(encounterTemplateVersions.templateId, templateId))
  ).map((v) => v.id);

  if (versionIds.length > 0) {
    const [{ n }] = await db
      .select({ n: count() })
      .from(encounters)
      .where(inArray(encounters.templateVersionId, versionIds));
    if ((n ?? 0) > 0) return { ok: false, error: IN_USE_MSG };
  }

  try {
    await db.transaction(async (tx) => {
      await tx
        .delete(encounterTemplateVersions)
        .where(eq(encounterTemplateVersions.templateId, templateId));
      await tx
        .delete(encounterTemplates)
        .where(
          and(
            eq(encounterTemplates.organizationId, org.id),
            eq(encounterTemplates.id, templateId),
          ),
        );
    });
  } catch (e) {
    if (isFkViolation(e)) return { ok: false, error: IN_USE_MSG };
    return { ok: false, error: "Could not delete template." };
  }

  await recordAudit({
    organizationId: org.id,
    actorUserId: user.authId,
    action: "delete",
    entityType: "encounter_template",
    entityId: templateId,
    reason: "Deleted unused template via Settings",
  });

  revalidatePath("/settings");
  revalidatePath("/encounters");
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
        isCaregiver: data.isCaregiver,
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
