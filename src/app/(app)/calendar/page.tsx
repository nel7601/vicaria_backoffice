import Link from "next/link";
import { Card, CardTitle } from "@/components/ui/card";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { getPrimaryOrganization } from "@/lib/db/queries/organization";
import {
  listActiveEmployees,
  listAppointments,
} from "@/lib/db/queries/appointments";
import { MonthGrid } from "@/components/ui/month-grid";
import { StatusLegend } from "@/components/ui/status-legend";
import {
  APPOINTMENT_LEGEND,
  appointmentStatusStyle,
} from "./status-display";
import { firstFreeSlot } from "@/lib/domain/availability";
import { NewAppointmentForm } from "./new-appointment-form";
import { AppointmentRow } from "./appointment-row";
import { dbErrorHint, withDbRetry } from "@/lib/db/retry";
import {
  clinicDateString,
  clinicDayWindow,
  clinicGridWindow,
  shiftDay,
  shiftMonth,
} from "@/lib/domain/timezone";


function monthLabel(monthStr: string): string {
  const [y, m] = monthStr.split("-").map(Number);
  return new Intl.DateTimeFormat("en-CA", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, 15)));
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; month?: string; employee?: string }>;
}) {
  const { date, month, employee } = await searchParams;
  const user = await getSessionUser();
  const roles = user?.roles ?? [];

  if (!can(roles, "patients_demographic", "read")) {
    return (
      <Card>
        <CardTitle>Calendar</CardTitle>
        <p className="mt-2 text-sm text-muted">Your role cannot view the calendar.</p>
      </Card>
    );
  }

  // Windows are computed in the clinic timezone (America/Toronto), not server
  // UTC, so evening appointments stay on the right day (A-05 / NFR-07).
  const isDayView = Boolean(date);
  const dayStr = date ?? clinicDateString(new Date());
  const monthStr = month ?? dayStr.slice(0, 7);
  // The month view queries the whole grid, not just the month: its first and
  // last rows show neighbouring days, and leaving those blank would read as
  // "nothing booked" instead of "not loaded".
  const { from, to } = isDayView
    ? clinicDayWindow(dayStr)
    : clinicGridWindow(monthStr);

  const canCreate = can(roles, "patients_demographic", "create");
  const empQuery = employee ? `&employee=${employee}` : "";

  let appts: Awaited<ReturnType<typeof listAppointments>> = [];
  let employees: { id: string; label: string }[] = [];
  let dbError: string | null = null;

  try {
    const org = await withDbRetry(() => getPrimaryOrganization());
    if (org) {
      appts = await withDbRetry(() =>
        listAppointments({
          organizationId: org.id,
          from,
          to,
          employeeId: employee,
        }),
      );
      // The practitioner filter is the only picker this view fills itself;
      // the booking form fetches its own options when it opens.
      const emps = await withDbRetry(() => listActiveEmployees(org.id));
      employees = emps.map((e) => ({
        id: e.id,
        label: `${e.firstName} ${e.lastName}`,
      }));
    }
  } catch (e) {
    // Name the failure on screen: "not reachable" sends everyone hunting in
    // the wrong place, and the code says which place is the right one.
    dbError = `Could not load the calendar — ${dbErrorHint(e)}. Try again; if it repeats, send this line to support.`;
    console.error("Calendar load failed:", e);
  }

  // In month view the grid also shows neighbouring days; the count is about
  // the month you opened, so it ignores them.
  const inScope = isDayView
    ? appts
    : appts.filter((a) => clinicDateString(a.startAt).startsWith(monthStr));
  const unconfirmed = inScope.filter((a) => a.status === "scheduled").length;

  // Booking from a day should not ask what day it is.
  const suggestedStart = isDayView
    ? `${dayStr}T${firstFreeSlot({ dayStr, busy: appts })}`
    : undefined;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Calendar</h1>
          <p className="text-sm text-muted">
            {isDayView ? `Day agenda · ${dayStr}` : monthLabel(monthStr)}
            {!isDayView && canCreate && (
              // Booking moved into the day, so say where it went.
              <span className="text-muted"> · open a day to book</span>
            )}
          </p>
        </div>
        {/* The count answers the question the month view is opened for:
            who still has to be called before the day arrives. */}
        {!dbError && unconfirmed > 0 && (
          <span className="rounded-full border-2 border-primary/40 px-3 py-1 text-sm text-primary-hover">
            {unconfirmed} awaiting confirmation
            <span className="text-muted">
              {isDayView ? " today" : " this month"}
            </span>
          </span>
        )}
      </div>

      <Card>
        {/* Toolbar */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {isDayView ? (
              <>
                <Link
                  href={`/calendar?month=${dayStr.slice(0, 7)}${empQuery}`}
                  className="rounded-md border border-border px-3 py-1.5 text-sm text-primary hover:bg-background"
                >
                  ⊞ Month
                </Link>
                <Link
                  href={`/calendar?date=${shiftDay(dayStr, -1)}${empQuery}`}
                  className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-background"
                >
                  ← Prev
                </Link>
                <Link
                  href={`/calendar?date=${shiftDay(dayStr, 1)}${empQuery}`}
                  className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-background"
                >
                  Next →
                </Link>
                <Link
                  href={`/calendar?date=${clinicDateString(new Date())}${empQuery}`}
                  className="rounded-md border border-border px-3 py-1.5 text-sm text-primary hover:bg-background"
                >
                  Today
                </Link>
              </>
            ) : (
              <>
                <Link
                  href={`/calendar?month=${shiftMonth(monthStr, -1)}${empQuery}`}
                  className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-background"
                >
                  ← {monthLabel(shiftMonth(monthStr, -1))}
                </Link>
                <Link
                  href={`/calendar?month=${shiftMonth(monthStr, 1)}${empQuery}`}
                  className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-background"
                >
                  {monthLabel(shiftMonth(monthStr, 1))} →
                </Link>
                <Link
                  href={`/calendar${employee ? `?employee=${employee}` : ""}`}
                  className="rounded-md border border-border px-3 py-1.5 text-sm text-primary hover:bg-background"
                >
                  Today
                </Link>
              </>
            )}
          </div>
          <form method="get" className="flex items-center gap-2">
            {isDayView ? (
              <input type="hidden" name="date" value={dayStr} />
            ) : (
              <input type="hidden" name="month" value={monthStr} />
            )}
            <select
              name="employee"
              defaultValue={employee ?? ""}
              className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm"
            >
              <option value="">All practitioners</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-background"
            >
              Filter
            </button>
          </form>
        </div>

        {dbError && <p className="text-sm text-warning">{dbError}</p>}

        {/* Month grid */}
        {!dbError && !isDayView && (
          <>
            <StatusLegend items={APPOINTMENT_LEGEND} />
            <MonthGrid
            monthStr={monthStr}
            todayStr={clinicDateString(new Date())}
            dayHref={(day) => `/calendar?date=${day}${empQuery}`}
            entries={appts.map((a) => ({
              id: a.id,
              day: clinicDateString(a.startAt),
              time: a.startAt.toLocaleTimeString("en-CA", {
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
                timeZone: "America/Toronto",
              }),
              label: `${a.patientFirst} ${a.patientLast}`,
              ...appointmentStatusStyle(a.status),
            }))}
            />
          </>
        )}

        {/* Day agenda */}
        {!dbError && isDayView && (
          <>
          <ul className="divide-y divide-border">
            {appts.length === 0 && (
              <li className="py-6 text-center text-sm text-muted">
                No appointments for this day.
              </li>
            )}
            {appts.map((a) => (
              <AppointmentRow
                key={a.id}
                id={a.id}
                startAt={a.startAt.toISOString()}
                endAt={a.endAt.toISOString()}
                status={a.status}
                modality={a.modality}
                patientName={`${a.patientFirst} ${a.patientLast}`}
                patientId={a.patientId}
                practitioner={`${a.employeeFirst} ${a.employeeLast}`}
                service={a.serviceNameEn}
                canUpdate={can(roles, "patients_demographic", "update")}
                canStartEncounter={can(roles, "clinical_notes", "create")}
              />
            ))}
          </ul>
          {/* Booking lives inside the day, where the date is already decided
              and the form can open on the first free hour. */}
          {canCreate && (
            <div className="mt-4 border-t border-border pt-4">
              <NewAppointmentForm defaultStart={suggestedStart} />
            </div>
          )}
          </>
        )}
      </Card>
    </div>
  );
}
