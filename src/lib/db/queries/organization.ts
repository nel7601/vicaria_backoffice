import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  companySettings,
  employees,
  locations,
  organizations,
  userRoles,
  users,
} from "@/lib/db/schema";

/**
 * Organization-scoped read queries for the Settings module.
 *
 * MVP note (ADR-002): a single organization exists in production. Until the
 * JWT carries organization_id, we resolve "the" org as the first row. Server
 * code always filters explicitly by organization_id.
 */
export async function getPrimaryOrganization() {
  const db = getDb();
  const [org] = await db.select().from(organizations).limit(1);
  return org ?? null;
}

export async function getCompanySettings(organizationId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(companySettings)
    .where(eq(companySettings.organizationId, organizationId))
    .limit(1);
  return row ?? null;
}

export async function listLocations(organizationId: string) {
  const db = getDb();
  return db
    .select()
    .from(locations)
    .where(eq(locations.organizationId, organizationId));
}

export async function listServicesWithPrice(organizationId: string) {
  const db = getDb();
  const { services, servicePrices } = await import("@/lib/db/schema");
  const { desc, isNull, and: andOp } = await import("drizzle-orm");
  const rows = await db
    .select({
      id: services.id,
      nameEn: services.nameEn,
      nameEs: services.nameEs,
      category: services.category,
      defaultDurationMinutes: services.defaultDurationMinutes,
      isActive: services.isActive,
      priceCents: servicePrices.priceCents,
      taxRateBps: servicePrices.taxRateBps,
    })
    .from(services)
    .leftJoin(
      servicePrices,
      andOp(
        eq(servicePrices.serviceId, services.id),
        isNull(servicePrices.effectiveTo),
      ),
    )
    .where(eq(services.organizationId, organizationId))
    .orderBy(desc(services.createdAt));
  return rows;
}

export async function listEmployees(organizationId: string) {
  const db = getDb();
  return db
    .select({
      id: employees.id,
      firstName: employees.firstName,
      lastName: employees.lastName,
      title: employees.title,
      isPractitioner: employees.isPractitioner,
      email: users.email,
      isActive: users.isActive,
      role: userRoles.role,
    })
    .from(employees)
    .innerJoin(users, eq(users.id, employees.userId))
    .leftJoin(userRoles, eq(userRoles.userId, users.id))
    .where(eq(employees.organizationId, organizationId));
}
