import Link from "next/link";
import { Card, CardTitle } from "@/components/ui/card";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { getPrimaryOrganization } from "@/lib/db/queries/organization";
import {
  listActiveEmployees,
  listAppointments,
} from "@/lib/db/queries/appointments";
import { listPatients } from "@/lib/db/queries/patients";
import { listActiveServices } from "@/lib/db/queries/catalog";
import { MonthGrid } from "@/components/ui/month-grid";
import { NewAppointmentForm } from "./new-appointment-form";
import { AppointmentRow } from "./appointment-row";
import {
  clinicDateString,
  clinicDayWindow,
  clinicMonthWindow,
  shiftDay,
  shiftMonth,
} from "@/lib/domain/timezone";

const STATUS_DOT: Record<string, string> = {
  scheduled: "bg-primary",
  confirmed: "bg-primary",
  checked_in: "bg-warning",
  in_progress: "bg-warning",
  completed: "bg-success",
  cancelled: "bg-danger",
  no_show: "bg-danger",
  rescheduled: "bg-muted",
};

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
  const { from, to } = isDayView
    ? clinicDayWindow(dayStr)
    : clinicMonthWindow(monthStr);

  const canCreate = can(roles, "patients_demographic", "create");
  const empQuery = employee ? `&employee=${employee}` : "";

  let appts: Awaited<ReturnType<typeof listAppointments>> = [];
  let employees: { id: string; label: string }[] = [];
  let patients: { id: string; label: string }[] = [];
  let services: { id: string; label: string }[] = [];
  let dbError: string | null = null;

  try {
    const org = await getPrimaryOrganization();
    if (org) {
      appts = await listAppointments({
        organizationId: org.id,
        from,
        to,
        employeeId: employee,
      });
      const [emps, pats, svcs] = await Promise.all([
        listActiveEmployees(org.id),
        listPatients({ organizationId: org.id, limit: 100 }),
        listActiveServices(org.id),
      ]);
      employees = emps.map((e) => ({
        id: e.id,
        label: `${e.firstName} ${e.lastName}`,
      }));
      patients = pats.map((p) => ({
        id: p.id,
        label: `${p.preferredName || p.legalFirstName} ${p.legalLastName} (${p.patientNumber})`,
      }));
      services = svcs.map((s) => ({ id: s.id, label: s.nameEn }));
    }
  } catch (e) {
    dbError = "Database not reachable. Configure DATABASE_URL and run migrations.";
    console.error("Calendar load failed:", e);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Calendar</h1>
          <p className="text-sm text-muted">
            {isDayView ? `Day agenda · ${dayStr}` : monthLabel(monthStr)}
          </p>
        </div>
        {canCreate && !dbError && (
          <NewAppointmentForm
            patients={patients}
            employees={employees}
            services={services}
          />
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
              dotClass: STATUS_DOT[a.status] ?? "bg-muted",
              struck: ["cancelled", "no_show"].includes(a.status),
            }))}
          />
        )}

        {/* Day agenda */}
        {!dbError && isDayView && (
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
        )}
      </Card>
    </div>
  );
}
