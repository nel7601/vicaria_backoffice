import { and, asc, desc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  appointments,
  encounters,
  employees,
  followUpTasks,
  invoices,
  packageEnrollments,
  packages,
  patients,
  payments,
} from "@/lib/db/schema";
import { formatCents } from "@/lib/domain/money";
import {
  AGING_BUCKETS,
  buildAging,
  suppressSmallGroups,
} from "@/lib/domain/reporting";

export interface ReportFilters {
  from?: Date;
  to?: Date;
}

export interface ReportResult {
  columns: string[];
  rows: (string | number)[][];
  notes?: string;
}

export async function runReport(
  code: string,
  organizationId: string,
  filters: ReportFilters,
): Promise<ReportResult> {
  const db = getDb();
  const from = filters.from ?? new Date("2000-01-01");
  const to = filters.to ?? new Date("2999-12-31");

  switch (code) {
    case "FIN-01": {
      const rows = await db
        .select({
          day: sql<string>`to_char(${payments.receivedAt}, 'YYYY-MM-DD')`,
          total: sql<number>`sum(${payments.amountCents})::int`,
        })
        .from(payments)
        .where(
          and(
            eq(payments.organizationId, organizationId),
            eq(payments.status, "confirmed"),
            gte(payments.receivedAt, from),
            lte(payments.receivedAt, to),
          ),
        )
        .groupBy(sql`1`)
        .orderBy(sql`1`);
      return {
        columns: ["Date", "Revenue"],
        rows: rows.map((r) => [r.day, formatCents(r.total ?? 0)]),
      };
    }

    case "FIN-02": {
      const open = await db
        .select({
          balanceCents: invoices.balanceCents,
          issueDate: invoices.issueDate,
          dueDate: invoices.dueDate,
        })
        .from(invoices)
        .where(
          and(
            eq(invoices.organizationId, organizationId),
            inArray(invoices.status, ["issued", "partially_paid", "overdue"]),
          ),
        );
      const totals = buildAging(
        open.map((o) => ({
          balanceCents: o.balanceCents,
          referenceDate: o.dueDate ?? o.issueDate ?? new Date(),
        })),
        new Date(),
      );
      return {
        columns: ["Bucket", "Outstanding"],
        rows: AGING_BUCKETS.map((b) => [b, formatCents(totals[b])]),
      };
    }

    case "FIN-03": {
      const rows = await db
        .select({
          method: payments.method,
          total: sql<number>`sum(${payments.amountCents})::int`,
        })
        .from(payments)
        .where(
          and(
            eq(payments.organizationId, organizationId),
            eq(payments.status, "confirmed"),
            gte(payments.receivedAt, from),
            lte(payments.receivedAt, to),
          ),
        )
        .groupBy(payments.method);
      return {
        columns: ["Method", "Total"],
        rows: rows.map((r) => [r.method, formatCents(r.total ?? 0)]),
      };
    }

    case "OPS-01": {
      const rows = await db
        .select({
          status: appointments.status,
          n: sql<number>`count(*)::int`,
        })
        .from(appointments)
        .where(
          and(
            eq(appointments.organizationId, organizationId),
            gte(appointments.startAt, from),
            lte(appointments.startAt, to),
          ),
        )
        .groupBy(appointments.status);
      return {
        columns: ["Status", "Count"],
        rows: rows.map((r) => [r.status, r.n ?? 0]),
      };
    }

    case "CLN-01": {
      const rows = await db
        .select({
          title: followUpTasks.title,
          dueDate: followUpTasks.dueDate,
          priority: followUpTasks.priority,
          first: patients.legalFirstName,
          last: patients.legalLastName,
        })
        .from(followUpTasks)
        .innerJoin(patients, eq(patients.id, followUpTasks.patientId))
        .where(
          and(
            eq(followUpTasks.organizationId, organizationId),
            ne(followUpTasks.status, "completed"),
            ne(followUpTasks.status, "cancelled"),
          ),
        )
        .orderBy(asc(followUpTasks.dueDate));
      return {
        columns: ["Patient", "Task", "Due", "Priority"],
        rows: rows.map((r) => [
          `${r.first} ${r.last}`,
          r.title,
          r.dueDate ? r.dueDate.toISOString().slice(0, 10) : "—",
          r.priority,
        ]),
      };
    }

    case "CLN-03": {
      const rows = await db
        .select({
          first: employees.firstName,
          last: employees.lastName,
          n: sql<number>`count(*)::int`,
        })
        .from(encounters)
        .innerJoin(employees, eq(employees.id, encounters.practitionerId))
        .where(
          and(
            eq(encounters.organizationId, organizationId),
            eq(encounters.status, "draft"),
          ),
        )
        .groupBy(employees.firstName, employees.lastName);
      return {
        columns: ["Practitioner", "Unsigned drafts"],
        rows: rows.map((r) => [`${r.first} ${r.last}`, r.n ?? 0]),
      };
    }

    case "PKG-01": {
      const rows = await db
        .select({
          name: packages.nameEn,
          total: packageEnrollments.totalSessions,
          used: packageEnrollments.sessionsUsed,
          status: packageEnrollments.status,
        })
        .from(packageEnrollments)
        .innerJoin(packages, eq(packages.id, packageEnrollments.packageId))
        .where(eq(packageEnrollments.organizationId, organizationId))
        .orderBy(desc(packageEnrollments.createdAt));
      return {
        columns: ["Package", "Sold", "Used", "Remaining", "Status"],
        rows: rows.map((r) => [
          r.name,
          r.total,
          r.used,
          r.total - r.used,
          r.status,
        ]),
      };
    }

    case "MKT-01": {
      const rows = await db
        .select({
          source: sql<string>`coalesce(${patients.acquisitionSource}, 'unknown')`,
          n: sql<number>`count(*)::int`,
        })
        .from(patients)
        .where(
          and(
            eq(patients.organizationId, organizationId),
            eq(patients.marketingOptIn, true),
          ),
        )
        .groupBy(sql`1`);
      // §11.1: suppress small groups to prevent re-identification.
      const { visible, suppressedGroups, suppressedCount } = suppressSmallGroups(
        rows.map((r) => ({ key: r.source, count: r.n ?? 0 })),
        5,
      );
      return {
        columns: ["Source", "New patients (opted-in)"],
        rows: visible.map((v) => [v.key, v.count]),
        notes:
          suppressedGroups > 0
            ? `${suppressedGroups} small group(s) totalling ${suppressedCount} suppressed for privacy (§11.1).`
            : "Aggregated over marketing-consented patients only (§11.1).",
      };
    }

    default:
      return { columns: ["Info"], rows: [["Report not implemented"]] };
  }
}
