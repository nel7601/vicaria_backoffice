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
import { NewAppointmentForm } from "./new-appointment-form";
import { AppointmentRow } from "./appointment-row";
import {
  clinicDateString,
  clinicDayWindow,
  clinicMonthWindow,
  monthGridDays,
  shiftDay,
  shiftMonth,
} from "@/lib/domain/timezone";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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
            empQuery={empQuery}
            appts={appts.map((a) => ({
              id: a.id,
              day: clinicDateString(a.startAt),
              time: a.startAt.toLocaleTimeString("en-CA", {
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
                timeZone: "America/Toronto",
              }),
              patient: `${a.patientFirst} ${a.patientLast}`,
              status: a.status,
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

interface MonthAppt {
  id: string;
  day: string;
  time: string;
  patient: string;
  status: string;
}

const MAX_CHIPS = 3;

function MonthGrid({
  monthStr,
  todayStr,
  empQuery,
  appts,
}: {
  monthStr: string;
  todayStr: string;
  empQuery: string;
  appts: MonthAppt[];
}) {
  const days = monthGridDays(monthStr);
  const byDay = new Map<string, MonthAppt[]>();
  for (const a of appts) {
    const list = byDay.get(a.day);
    if (list) list.push(a);
    else byDay.set(a.day, [a]);
  }

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[720px]">
        <div className="grid grid-cols-7 border-b border-border text-center text-xs font-medium uppercase text-muted">
          {WEEKDAYS.map((w) => (
            <div key={w} className="py-2">
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((day) => {
            const inMonth = day.startsWith(monthStr);
            const isToday = day === todayStr;
            const dayAppts = byDay.get(day) ?? [];
            const extra = dayAppts.length - MAX_CHIPS;
            return (
              <Link
                key={day}
                href={`/calendar?date=${day}${empQuery}`}
                className={`min-h-24 border-b border-r border-border/60 p-1.5 align-top transition hover:bg-background ${
                  inMonth ? "" : "bg-background/60 text-muted"
                }`}
              >
                <div
                  className={`mb-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                    isToday
                      ? "bg-primary font-semibold text-primary-foreground"
                      : inMonth
                        ? "font-medium"
                        : ""
                  }`}
                >
                  {Number(day.slice(8))}
                </div>
                <div className="space-y-0.5">
                  {dayAppts.slice(0, MAX_CHIPS).map((a) => (
                    <div
                      key={a.id}
                      className={`flex items-center gap-1 truncate rounded bg-primary/5 px-1 py-0.5 text-[11px] leading-tight ${
                        ["cancelled", "no_show"].includes(a.status)
                          ? "line-through opacity-50"
                          : ""
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[a.status] ?? "bg-muted"}`}
                      />
                      <span className="tabular-nums">{a.time}</span>
                      <span className="truncate">{a.patient}</span>
                    </div>
                  ))}
                  {extra > 0 && (
                    <div className="px-1 text-[11px] text-muted">+{extra} more</div>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
