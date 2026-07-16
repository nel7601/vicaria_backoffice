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
