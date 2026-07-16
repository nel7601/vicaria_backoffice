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

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; employee?: string }>;
}) {
  const { date, employee } = await searchParams;
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

  const dayStr = date ?? isoDate(new Date());
  const from = new Date(`${dayStr}T00:00:00`);
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
  const prevDay = isoDate(new Date(from.getTime() - 24 * 60 * 60 * 1000));
  const nextDay = isoDate(to);

  const canCreate = can(roles, "patients_demographic", "create");

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
          <p className="text-sm text-muted">Day agenda · {dayStr}</p>
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
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Link
              href={`/calendar?date=${prevDay}${employee ? `&employee=${employee}` : ""}`}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-background"
            >
              ← Prev
            </Link>
            <Link
              href={`/calendar?date=${nextDay}${employee ? `&employee=${employee}` : ""}`}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-background"
            >
              Next →
            </Link>
          </div>
          <form method="get" className="flex items-center gap-2">
            <input type="hidden" name="date" value={dayStr} />
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

        {!dbError && (
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
              />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
