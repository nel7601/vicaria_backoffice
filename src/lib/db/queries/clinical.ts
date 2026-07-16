import { and, count, desc, eq, lt, ne } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { encounters, followUpTasks, treatmentPlans } from "@/lib/db/schema";

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
