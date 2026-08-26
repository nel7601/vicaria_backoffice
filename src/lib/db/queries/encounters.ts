import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  encounterAmendments,
  encounters,
  encounterTemplates,
  encounterTemplateVersions,
  observations,
  patients,
  employees,
} from "@/lib/db/schema";

export interface ListEncountersParams {
  organizationId: string;
  patientId?: string;
  practitionerId?: string;
  unsignedOnly?: boolean;
  limit?: number;
}

export async function listEncounters(params: ListEncountersParams) {
  const db = getDb();
  const conditions = [eq(encounters.organizationId, params.organizationId)];
  if (params.patientId) conditions.push(eq(encounters.patientId, params.patientId));
  if (params.practitionerId)
    conditions.push(eq(encounters.practitionerId, params.practitionerId));
  if (params.unsignedOnly) conditions.push(eq(encounters.status, "draft"));

  return db
    .select({
      id: encounters.id,
      status: encounters.status,
      startedAt: encounters.startedAt,
      summary: encounters.summary,
      patientId: encounters.patientId,
      patientFirst: patients.legalFirstName,
      patientLast: patients.legalLastName,
      practitionerFirst: employees.firstName,
      practitionerLast: employees.lastName,
    })
    .from(encounters)
    .innerJoin(patients, eq(patients.id, encounters.patientId))
    .innerJoin(employees, eq(employees.id, encounters.practitionerId))
    .where(and(...conditions))
    .orderBy(desc(encounters.createdAt))
    .limit(params.limit ?? 50);
}

export async function getEncounter(organizationId: string, id: string) {
  const db = getDb();
  const [encounter] = await db
    .select()
    .from(encounters)
    .where(
      and(eq(encounters.organizationId, organizationId), eq(encounters.id, id)),
    )
    .limit(1);
  if (!encounter) return null;

  const [template, amendments, measurements] = await Promise.all([
    encounter.templateVersionId
      ? db
          .select()
          .from(encounterTemplateVersions)
          .where(eq(encounterTemplateVersions.id, encounter.templateVersionId))
          .limit(1)
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
    db
      .select()
      .from(encounterAmendments)
      .where(eq(encounterAmendments.encounterId, id))
      .orderBy(encounterAmendments.authoredAt),
    db
      .select()
      .from(observations)
      .where(eq(observations.encounterId, id))
      .orderBy(desc(observations.observedAt)),
  ]);

  return { encounter, template, amendments, measurements };
}

export async function listTemplates(organizationId: string) {
  const db = getDb();
  return db
    .select({
      templateId: encounterTemplates.id,
      name: encounterTemplates.name,
      versionId: encounterTemplateVersions.id,
      version: encounterTemplateVersions.version,
    })
    .from(encounterTemplateVersions)
    .innerJoin(
      encounterTemplates,
      eq(encounterTemplates.id, encounterTemplateVersions.templateId),
    )
    .where(eq(encounterTemplates.organizationId, organizationId));
}

/**
 * Latest published version per template, with linked service and usage count.
 * Backs the Settings → Templates manager.
 */
export async function listTemplatesDetailed(organizationId: string) {
  const db = getDb();
  const { services } = await import("@/lib/db/schema");
  const { desc, sql } = await import("drizzle-orm");

  const rows = await db
    .select({
      templateId: encounterTemplates.id,
      name: encounterTemplates.name,
      serviceId: encounterTemplates.serviceId,
      serviceName: services.nameEn,
      versionId: encounterTemplateVersions.id,
      version: encounterTemplateVersions.version,
      schema: encounterTemplateVersions.schema,
      usageCount: sql<number>`(
        select count(*)::int from encounters e
        join encounter_template_versions v2 on v2.id = e.template_version_id
        where v2.template_id = ${encounterTemplates.id}
      )`,
    })
    .from(encounterTemplates)
    .leftJoin(services, eq(services.id, encounterTemplates.serviceId))
    .leftJoin(
      encounterTemplateVersions,
      eq(encounterTemplateVersions.templateId, encounterTemplates.id),
    )
    .where(eq(encounterTemplates.organizationId, organizationId))
    .orderBy(desc(encounterTemplateVersions.version));

  // Keep only the highest version per template.
  const seen = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    if (!seen.has(r.templateId)) seen.set(r.templateId, r);
  }
  return [...seen.values()];
}

/**
 * Resolve the template version to auto-attach when starting an encounter
 * (FR-ENC-002): the service-linked template's latest published version, or —
 * when the org has exactly one template — that one. Null otherwise.
 */
export async function resolveTemplateVersionForService(
  organizationId: string,
  serviceId: string | null,
): Promise<string | null> {
  const detailed = await listTemplatesDetailed(organizationId);
  const withVersion = detailed.filter((t) => t.versionId);
  if (serviceId) {
    const match = withVersion.find((t) => t.serviceId === serviceId);
    if (match) return match.versionId;
  }
  if (withVersion.length === 1) return withVersion[0].versionId;
  return null;
}

/** Performed-service lines of an encounter (spec §7.1/§8). */
export async function listEncounterLines(
  organizationId: string,
  encounterId: string,
) {
  const db = getDb();
  const { encounterLines } = await import("@/lib/db/schema");
  return db
    .select()
    .from(encounterLines)
    .where(
      and(
        eq(encounterLines.organizationId, organizationId),
        eq(encounterLines.encounterId, encounterId),
      ),
    )
    .orderBy(encounterLines.createdAt);
}
