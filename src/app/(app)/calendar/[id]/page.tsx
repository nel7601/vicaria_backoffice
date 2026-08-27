import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, CardTitle } from "@/components/ui/card";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { getPrimaryOrganization } from "@/lib/db/queries/organization";
import {
  getAppointmentDetail,
  listActiveEmployees,
} from "@/lib/db/queries/appointments";
import { listActiveServices } from "@/lib/db/queries/catalog";
import { clinicDateString } from "@/lib/domain/timezone";
import { AppointmentStatusActions } from "./appointment-status-actions";
import { EditAppointmentForm } from "./edit-appointment-form";

const TZ = "America/Toronto";

function fmtDateTime(d: Date) {
  return d.toLocaleString("en-CA", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: TZ,
  });
}

/** Appointment detail: one card with everything captured at booking, the
 * available actions, inline editing while upcoming, and the status history. */
export default async function AppointmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const roles = user.roles;

  if (!can(roles, "patients_demographic", "read")) {
    return (
      <Card>
        <CardTitle>Appointment</CardTitle>
        <p className="mt-2 text-sm text-muted">
          Your role cannot view appointments.
        </p>
      </Card>
    );
  }

  const org = await getPrimaryOrganization();
  if (!org) notFound();

  const detail = await getAppointmentDetail(org.id, id);
  if (!detail) notFound();
  const { appointment: a, history } = detail;

  const canUpdate = can(roles, "patients_demographic", "update");
  const editable =
    canUpdate && ["scheduled", "confirmed", "checked_in"].includes(a.status);

  const [employees, services] = editable
    ? await Promise.all([listActiveEmployees(org.id), listActiveServices(org.id)])
    : [[], []];

  const durationMinutes = Math.round(
    (a.endAt.getTime() - a.startAt.getTime()) / 60000,
  );

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/calendar?date=${clinicDateString(a.startAt)}`}
          className="text-sm text-primary hover:underline"
        >
          ← Calendar
        </Link>
        <h1 className="mt-1 text-xl font-semibold">
          Appointment — {a.patientFirst} {a.patientLast}
        </h1>
        <p className="text-sm text-muted">
          {fmtDateTime(a.startAt)} · {durationMinutes} min
        </p>
      </div>

      <Card>
        {/* Header: title + status + quick actions */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <CardTitle>Appointment details</CardTitle>
          <AppointmentStatusActions
            id={a.id}
            status={a.status}
            canUpdate={canUpdate}
            canStartEncounter={can(roles, "clinical_notes", "create")}
          />
        </div>

        {/* Patient is not editable here; the remaining read-only fields are
            shown only when the edit form (which covers them) is hidden. */}
        <dl className="mt-3 grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-4 sm:block">
            <dt className="text-muted">Patient</dt>
            <dd>
              <Link
                href={`/patients/${a.patientId}`}
                className="font-medium text-primary hover:underline"
              >
                {a.patientFirst} {a.patientLast}
              </Link>{" "}
              <span className="text-xs text-muted">{a.patientNumber}</span>
            </dd>
          </div>
          {!editable && (
            <>
              <div className="flex justify-between gap-4 sm:block">
                <dt className="text-muted">Practitioner</dt>
                <dd>
                  {a.employeeFirst} {a.employeeLast}
                </dd>
              </div>
              <div className="flex justify-between gap-4 sm:block">
                <dt className="text-muted">Service</dt>
                <dd>{a.serviceNameEn ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-4 sm:block">
                <dt className="text-muted">Modality</dt>
                <dd>{a.modality.replace("_", " ")}</dd>
              </div>
            </>
          )}
        </dl>

        {a.cancellationReason && (
          <p className="mt-3 text-sm text-danger">
            Reason: {a.cancellationReason}
          </p>
        )}

        {/* Editable: the form shows and edits practitioner, service, time,
            modality and booking notes. Otherwise: read-only booking notes. */}
        {editable ? (
          <div className="mt-4 border-t border-border pt-4">
            <EditAppointmentForm
              appointmentId={a.id}
              defaults={{
                employeeId: a.employeeId,
                serviceId: a.serviceId ?? "",
                startAt: a.startAt.toISOString(),
                durationMinutes,
                modality: a.modality,
                notesAdmin: a.notesAdmin ?? "",
              }}
              employees={employees.map((e) => ({
                id: e.id,
                label: `${e.firstName} ${e.lastName}`,
              }))}
              services={services.map((s) => ({ id: s.id, label: s.nameEn }))}
            />
          </div>
        ) : (
          a.notesAdmin && (
            <div className="mt-4">
              <div className="text-xs font-medium uppercase text-muted">
                Booking notes
              </div>
              <p className="mt-1 whitespace-pre-wrap rounded-md bg-warm/60 p-3 text-sm">
                {a.notesAdmin}
              </p>
            </div>
          )
        )}

        {/* Status history */}
        <div className="mt-6 border-t border-border pt-4">
          <div className="text-xs font-medium uppercase text-muted">
            Status history
          </div>
          <ul className="mt-1 divide-y divide-border text-sm">
            {history.length === 0 && (
              <li className="py-2 text-muted">No history.</li>
            )}
            {history.map((h) => (
              <li
                key={h.id}
                className="flex flex-wrap justify-between gap-2 py-2"
              >
                <span>
                  {h.fromStatus ? `${h.fromStatus.replace("_", " ")} → ` : ""}
                  <span className="font-medium">
                    {h.toStatus.replace("_", " ")}
                  </span>
                  {h.reason ? (
                    <span className="text-muted"> · {h.reason}</span>
                  ) : null}
                </span>
                <span className="text-xs text-muted">
                  {h.changedAt.toLocaleString("en-CA", {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone: TZ,
                  })}
                  {h.changedByEmail ? ` · ${h.changedByEmail}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </Card>
    </div>
  );
}
