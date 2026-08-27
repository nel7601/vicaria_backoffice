import { and, count, desc, eq, lt, ne } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  employees,
  encounters,
  encounterTemplates,
  encounterTemplateVersions,
  followUpTasks,
  patientChartNotes,
  services,
  treatmentPlans,
  users,
} from "@/lib/db/schema";

/**
 * Everything the clinical-record view needs for one patient: encounters with
 * their template (name + field schema) and captured answers, plus the
 * clinician-added chart notes.
 */
export async function getPatientChart(organizationId: string, patientId: string) {
  const db = getDb();
  const scope = and(
    eq(encounters.organizationId, organizationId),
    eq(encounters.patientId, patientId),
  );

  const [rows, notes] = await Promise.all([
    db
      .select({
        id: encounters.id,
        status: encounters.status,
        startedAt: encounters.startedAt,
        endedAt: encounters.endedAt,
        createdAt: encounters.createdAt,
        signedAt: encounters.signedAt,
        modality: encounters.modality,
        summary: encounters.summary,
        contentSnapshot: encounters.contentSnapshot,
        serviceName: services.nameEn,
        practitionerFirst: employees.firstName,
        practitionerLast: employees.lastName,
        templateId: encounterTemplates.id,
        templateName: encounterTemplates.name,
        templateVersion: encounterTemplateVersions.version,
        templateSchema: encounterTemplateVersions.schema,
      })
      .from(encounters)
      .innerJoin(employees, eq(employees.id, encounters.practitionerId))
      .leftJoin(services, eq(services.id, encounters.serviceId))
      .leftJoin(
        encounterTemplateVersions,
        eq(encounterTemplateVersions.id, encounters.templateVersionId),
      )
      .leftJoin(
        encounterTemplates,
        eq(encounterTemplates.id, encounterTemplateVersions.templateId),
      )
      .where(scope)
      .orderBy(desc(encounters.startedAt), desc(encounters.createdAt)),
    db
      .select({
        id: patientChartNotes.id,
        notedAt: patientChartNotes.notedAt,
        body: patientChartNotes.body,
        createdAt: patientChartNotes.createdAt,
        authorEmail: users.email,
      })
      .from(patientChartNotes)
      .leftJoin(users, eq(users.id, patientChartNotes.authorUserId))
      .where(
        and(
          eq(patientChartNotes.organizationId, organizationId),
          eq(patientChartNotes.patientId, patientId),
        ),
      )
      .orderBy(desc(patientChartNotes.notedAt)),
  ]);

  return { encounters: rows, notes };
}

export async function listPlans(organizationId: string, patientId: string) {
  const db = getDb();
  return db
    .select()
    .from(treatmentPlans)
    .where(
      and(
        eq(treatmentPlans.organizationId, organizationId),
        eq(treatmentPlans.patientId, patientId),
      ),
    )
    .orderBy(desc(treatmentPlans.createdAt));
}

export async function listTasks(organizationId: string, patientId: string) {
  const db = getDb();
  return db
    .select()
    .from(followUpTasks)
    .where(
      and(
        eq(followUpTasks.organizationId, organizationId),
        eq(followUpTasks.patientId, patientId),
      ),
    )
    .orderBy(desc(followUpTasks.createdAt));
}

/** Dashboard counters (§7). */
export async function dashboardCounters(organizationId: string, now: Date) {
  const db = getDb();
  const [unsigned] = await db
    .select({ n: count() })
    .from(encounters)
    .where(
      and(
        eq(encounters.organizationId, organizationId),
        eq(encounters.status, "draft"),
      ),
    );
  const [overdue] = await db
    .select({ n: count() })
    .from(followUpTasks)
    .where(
      and(
        eq(followUpTasks.organizationId, organizationId),
        ne(followUpTasks.status, "completed"),
        ne(followUpTasks.status, "cancelled"),
        lt(followUpTasks.dueDate, now),
      ),
    );
  return {
    unsignedNotes: unsigned?.n ?? 0,
    overdueTasks: overdue?.n ?? 0,
  };
}
