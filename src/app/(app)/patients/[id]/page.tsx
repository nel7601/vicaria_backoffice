import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, CardTitle } from "@/components/ui/card";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { formatCents } from "@/lib/domain/money";
import { getPatient360 } from "@/lib/db/queries/patients";
import { getPrimaryOrganization } from "@/lib/db/queries/organization";
import { recordAccess } from "@/lib/audit/record";

export default async function Patient360Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!can(user.roles, "patients_demographic", "read")) {
    return (
      <Card>
        <CardTitle>Patient</CardTitle>
        <p className="mt-2 text-sm text-muted">Your role cannot view patients.</p>
      </Card>
    );
  }

  const canFinancial = can(user.roles, "invoices_payments", "read");
  const canClinical = can(user.roles, "clinical_notes", "read");

  let data: Awaited<ReturnType<typeof getPatient360>> = null;
  let dbError: string | null = null;
  try {
    const org = await getPrimaryOrganization();
    if (org) {
      data = await getPatient360(org.id, id);
      if (data) {
        // §12.2: log access to a patient record.
        await recordAccess({
          organizationId: org.id,
          actorUserId: user.authId,
          patientId: id,
          action: "view",
          route: `/patients/${id}`,
        }).catch(() => {});
      }
    }
  } catch (e) {
    dbError = "Database not reachable.";
    console.error("Patient 360 load failed:", e);
  }

  if (dbError) {
    return (
      <Card>
        <p className="text-sm text-warning">{dbError}</p>
      </Card>
    );
  }
  if (!data) notFound();

  const { patient, appointments, invoices, consents } = data;
  const balance = invoices.reduce((s, i) => s + (i.balanceCents ?? 0), 0);
  const nextAppt = [...appointments]
    .filter((a) => new Date(a.startAt) >= new Date())
    .sort((a, b) => +new Date(a.startAt) - +new Date(b.startAt))[0];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/patients" className="text-sm text-primary hover:underline">
            ← Patients
          </Link>
          <h1 className="mt-1 text-xl font-semibold">
            {patient.preferredName || patient.legalFirstName}{" "}
            {patient.legalLastName}
          </h1>
          <p className="text-sm text-muted">
            {patient.patientNumber} · {patient.preferredLanguage.toUpperCase()}
            {patient.dateOfBirth ? ` · DOB ${patient.dateOfBirth}` : ""} ·{" "}
            {patient.status}
          </p>
          <p className="text-sm text-muted">
            {[patient.email, patient.phoneE164].filter(Boolean).join(" · ") || "—"}
          </p>
        </div>
      </div>

      {/* Overview */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardTitle>Next appointment</CardTitle>
          <div className="mt-2 text-sm">
            {nextAppt
              ? new Date(nextAppt.startAt).toLocaleString("en-CA", {
                  timeZone: "America/Toronto",
                })
              : "None scheduled"}
          </div>
        </Card>
        <Card>
          <CardTitle>Balance</CardTitle>
          <div className="mt-2 text-2xl font-semibold tabular-nums">
            {canFinancial ? formatCents(balance) : "—"}
          </div>
        </Card>
        <Card>
          <CardTitle>Consents on file</CardTitle>
          <div className="mt-2 text-2xl font-semibold tabular-nums">
            {consents.length}
          </div>
        </Card>
      </div>

      {/* Appointments */}
      <Card>
        <CardTitle>Appointments</CardTitle>
        <ul className="mt-3 divide-y divide-border text-sm">
          {appointments.length === 0 && (
            <li className="py-2 text-muted">No appointments.</li>
          )}
          {appointments.map((a) => (
            <li key={a.id} className="flex justify-between py-2">
              <span>
                {new Date(a.startAt).toLocaleString("en-CA", {
                  timeZone: "America/Toronto",
                })}
              </span>
              <span className="text-muted">
                {a.modality} · {a.status}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      {/* Financial — gated */}
      {canFinancial && (
        <Card>
          <CardTitle>Financial</CardTitle>
          <ul className="mt-3 divide-y divide-border text-sm">
            {invoices.length === 0 && (
              <li className="py-2 text-muted">No invoices.</li>
            )}
            {invoices.map((i) => (
              <li key={i.id} className="flex justify-between py-2">
                <span className="font-mono text-xs">
                  {i.invoiceNumber ?? "(draft)"}
                </span>
                <span>
                  {i.status} · {formatCents(i.totalCents)} (bal{" "}
                  {formatCents(i.balanceCents)})
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Consents / Privacy */}
      <Card>
        <CardTitle>Consents</CardTitle>
        <ul className="mt-3 divide-y divide-border text-sm">
          {consents.length === 0 && (
            <li className="py-2 text-muted">No consents recorded.</li>
          )}
          {consents.map((c) => (
            <li key={c.id} className="flex justify-between py-2">
              <span>
                {c.consentType} · v{c.documentVersion}
              </span>
              <span className="text-muted">{c.status}</span>
            </li>
          ))}
        </ul>
      </Card>

      {/* Clinical — gated; full content ships in Phase 3 */}
      {canClinical && (
        <Card>
          <CardTitle>Clinical</CardTitle>
          <p className="mt-2 text-sm text-muted">
            Encounters, notes and measurements appear here (Phase 3).
          </p>
        </Card>
      )}
    </div>
  );
}
