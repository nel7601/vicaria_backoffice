import { NextResponse } from "next/server";
import { and, eq, gte, lt, ne, sql } from "drizzle-orm";
import { requestPrincipal } from "@/lib/assistant/auth/request-identity";
import { assistantFlags } from "@/lib/assistant/flags";
import { assistantError, assistantErrorResponse } from "@/lib/assistant/http";
import { planRead } from "@/lib/assistant/policy/scope";
import { getDb } from "@/lib/db";
import { appointments, followUpTasks, invoices } from "@/lib/db/schema";
import { requireTenant } from "@/lib/auth/principal";
import { principalReadScope } from "@/lib/auth/authorize-principal";
import { CLINIC_TZ, clinicDayWindow, clinicDateString } from "@/lib/domain/timezone";

/**
 * GET /api/assistant/v1/briefing — what a good assistant says before being asked.
 *
 * Opening the app and being greeted with "four appointments today, first at
 * nine, and two invoices overdue" is a different product from a blank box
 * waiting for a question. It is also the cheapest way to be useful: the
 * answers are already there, nobody has to think of the question.
 *
 * Deliberately not a model call. It is the same numbers every time, it has to
 * be instant, and paying a provider to phrase a greeting would be absurd. The
 * client renders it; Viki only speaks when spoken to.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  if (!assistantFlags().assistantEnabled) {
    return assistantError("assistant_disabled", "The assistant is not enabled", 503);
  }

  try {
    const principal = requireTenant(await requestPrincipal(request));
    const db = getDb();
    const org = principal.organizationId;
    const now = new Date();
    const today = clinicDateString(now, CLINIC_TZ);
    const { from, to } = clinicDayWindow(today, CLINIC_TZ);

    const plan = planRead(principal, "patients_demographic");
    const mine = plan.mode === "own" ? principal.employeeId : undefined;
    // A practitioner with no employee record has no schedule to summarise.
    if (plan.mode === "own" && !mine) {
      return NextResponse.json({ today, greeting: greet(now, principal.displayName), items: [] });
    }

    const appointmentConditions = [
      eq(appointments.organizationId, org),
      gte(appointments.startAt, from),
      lt(appointments.startAt, to),
      ne(appointments.status, "cancelled"),
      ne(appointments.status, "no_show"),
      ne(appointments.status, "rescheduled"),
    ];
    if (mine) appointmentConditions.push(eq(appointments.employeeId, mine));

    const todays = plan.mode === "denied"
      ? []
      : await db
          .select({ startAt: appointments.startAt, status: appointments.status })
          .from(appointments)
          .where(and(...appointmentConditions))
          .orderBy(appointments.startAt);

    // Each section is skipped rather than zeroed when the role cannot see it:
    // "0 overdue invoices" is a different statement from "you cannot see
    // invoices", and only one of them is true.
    const canSeeMoney = principalReadScope(principal, "invoices_payments") !== "none";
    const overdue = canSeeMoney
      ? await db
          .select({
            count: sql<number>`count(*)::int`,
            owed: sql<number>`coalesce(sum(${invoices.balanceCents}), 0)::bigint`,
          })
          .from(invoices)
          .where(
            and(
              eq(invoices.organizationId, org),
              ne(invoices.status, "draft"),
              ne(invoices.status, "void"),
              ne(invoices.balanceCents, 0),
              lt(invoices.dueDate, now),
            ),
          )
      : [];

    const taskConditions = [
      eq(followUpTasks.organizationId, org),
      ne(followUpTasks.status, "completed"),
      ne(followUpTasks.status, "cancelled"),
      lt(followUpTasks.dueDate, to),
    ];
    if (principal.employeeId) {
      taskConditions.push(eq(followUpTasks.assignedTo, principal.employeeId));
    }
    const tasks = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(followUpTasks)
      .where(and(...taskConditions));

    const first = todays[0];
    const items: string[] = [];

    if (todays.length === 0) {
      items.push("No hay citas hoy.");
    } else {
      const hora = new Intl.DateTimeFormat("es-CA", {
        timeZone: CLINIC_TZ,
        hour: "2-digit",
        minute: "2-digit",
      }).format(first.startAt);
      items.push(
        todays.length === 1
          ? `Hay 1 cita hoy, a las ${hora}.`
          : `Hay ${todays.length} citas hoy, la primera a las ${hora}.`,
      );
    }

    const overdueCount = overdue[0]?.count ?? 0;
    if (overdueCount > 0) {
      const owed = Number(overdue[0]?.owed ?? 0) / 100;
      items.push(
        `${overdueCount} ${overdueCount === 1 ? "factura vencida" : "facturas vencidas"}, ` +
          `${owed.toFixed(2)} CAD sin cobrar.`,
      );
    }

    const taskCount = tasks[0]?.count ?? 0;
    if (taskCount > 0) {
      items.push(
        `${taskCount} ${taskCount === 1 ? "tarea pendiente" : "tareas pendientes"} para hoy.`,
      );
    }

    return NextResponse.json({
      today,
      greeting: greet(now, principal.displayName),
      items,
      appointmentsToday: todays.length,
      overdueInvoices: overdueCount,
      openTasks: taskCount,
    });
  } catch (error) {
    return assistantErrorResponse(error);
  }
}

/** Time of day in the clinic, not on the server or the phone. */
function greet(now: Date, name: string | null): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: CLINIC_TZ,
      hour: "2-digit",
      hour12: false,
    }).format(now),
  );
  const part =
    hour < 12 ? "Buenos días" : hour < 20 ? "Buenas tardes" : "Buenas noches";
  return name ? `${part}, ${name}.` : `${part}.`;
}
