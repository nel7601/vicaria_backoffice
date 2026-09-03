import { notFound, redirect } from "next/navigation";
import { BackLink } from "@/components/ui/back-link";
import { Card, CardTitle } from "@/components/ui/card";
import { RecordLink } from "@/components/ui/record-link";
import { getSessionUser } from "@/lib/auth/session";
import { dbFailureMessage } from "@/lib/db/retry";
import { can } from "@/lib/auth/rbac";
import { formatCents } from "@/lib/domain/money";
import type { TemplateField } from "@/lib/domain/encounter";
import { getPatient360 } from "@/lib/db/queries/patients";
import {
  getPrimaryOrganization,
  listAcquisitionSources,
} from "@/lib/db/queries/organization";
import {
  listPatientFileForms,
  listPlans,
  listTasks,
} from "@/lib/db/queries/clinical";
import { listTemplatesDetailed } from "@/lib/db/queries/encounters";
import { recordAccess } from "@/lib/audit/record";
import { CLINIC_TZ, clinicDateString } from "@/lib/domain/timezone";
import { PlansTasksPanel } from "./plans-tasks-panel";
import { EditPatientForm } from "./edit-patient-form";
import {
  PatientFileForms,
  type FileFormOption,
  type FiledForm,
} from "./patient-file-forms";

function fmtDate(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-CA", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: CLINIC_TZ,
  });
}

function extractFields(schema: unknown): TemplateField[] {
  if (Array.isArray(schema)) return schema as TemplateField[];
  if (schema && typeof schema === "object" && "fields" in schema) {
    const f = (schema as { fields?: unknown }).fields;
    if (Array.isArray(f)) return f as TemplateField[];
  }
  return [];
}

export default async function Patient360Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const [{ id }, { from }] = await Promise.all([params, searchParams]);
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
  const canEditPatient = can(user.roles, "patients_demographic", "update");
  // Filing a signed document is administrative for reception and clinical for
  // the practitioner who witnessed it; either right is enough.
  const canFileDocuments =
    canEditPatient || can(user.roles, "clinical_notes", "create");

  let data: Awaited<ReturnType<typeof getPatient360>> = null;
  let plans: Awaited<ReturnType<typeof listPlans>> = [];
  let tasks: Awaited<ReturnType<typeof listTasks>> = [];
  let fileForms: Awaited<ReturnType<typeof listPatientFileForms>> = [];
  let fileFormOptions: FileFormOption[] = [];
  let sources: string[] = [];
  let dbError: string | null = null;
  try {
    const org = await getPrimaryOrganization();
    if (org) {
      data = await getPatient360(org.id, id);
      if (data) {
        const [plansRows, tasksRows, filed, templates, sourceRows] =
          await Promise.all([
            listPlans(org.id, id),
            listTasks(org.id, id),
            listPatientFileForms(org.id, id),
            listTemplatesDetailed(org.id),
            listAcquisitionSources(org.id),
          ]);
        plans = plansRows;
        tasks = tasksRows;
        fileForms = filed;
        fileFormOptions = templates
          .filter(
            (t) => t.versionId && !t.archivedAt && t.scope === "administrative",
          )
          .map((t) => ({
            templateId: t.templateId,
            versionId: t.versionId!,
            name: t.name,
            fields: extractFields(t.schema),
          }));
        // The patient's own source stays selectable even if it was later
        // archived, so editing an address cannot silently blank it.
        const active = sourceRows.filter((s) => s.isActive).map((s) => s.name);
        const own = data.patient.acquisitionSource;
        sources =
          own && !active.includes(own) ? [...active, own].sort() : active;
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
    dbError = dbFailureMessage("this patient", e);
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
  const canManagePlans = can(user.roles, "clinical_notes", "create");
  const canManageTasks = canEditPatient;
  const balance = invoices.reduce((s, i) => s + (i.balanceCents ?? 0), 0);
  const nextAppt = [...appointments]
    .filter((a) => new Date(a.startAt) >= new Date())
    .sort((a, b) => +new Date(a.startAt) - +new Date(b.startAt))[0];

  const filed: FiledForm[] = fileForms.map((f) => ({
    id: f.id,
    templateName: f.templateName,
    filledAtLabel: fmtDate(f.filledAt),
    byLine: f.filledByEmail ?? "—",
    fields: extractFields(f.templateSchema),
    answers: (f.answers ?? {}) as Record<string, unknown>,
  }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <BackLink from={from} fallbackHref="/patients" fallbackLabel="Patients" />
          <h1 className="mt-1 flex items-center gap-2 text-xl font-semibold">
            {patient.preferredName || patient.legalFirstName}{" "}
            {patient.legalLastName}
            <RecordLink patientId={patient.id} />
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
                  timeZone: CLINIC_TZ,
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
          <CardTitle>Patient since</CardTitle>
          <div className="mt-2 text-sm">{fmtDate(patient.createdAt)}</div>
          <div className="text-xs text-muted">
            {consents.length} consent{consents.length === 1 ? "" : "s"} on file
          </div>
        </Card>
      </div>

      {/* Details — the editable record */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <CardTitle>Details</CardTitle>
          {canEditPatient && (
            <EditPatientForm
              patientId={patient.id}
              sources={sources}
              defaults={{
                legalFirstName: patient.legalFirstName,
                legalLastName: patient.legalLastName,
                preferredName: patient.preferredName ?? "",
                pronouns: patient.pronouns ?? "",
                dateOfBirth: patient.dateOfBirth ?? undefined,
                email: patient.email ?? "",
                phoneE164: patient.phoneE164 ?? "",
                address: patient.address ?? "",
                preferredLanguage: patient.preferredLanguage,
                status: patient.status,
                marketingOptIn: patient.marketingOptIn,
                emergencyContactName: patient.emergencyContactName ?? "",
                emergencyContactPhone: patient.emergencyContactPhone ?? "",
                acquisitionSource: patient.acquisitionSource ?? "",
              }}
            />
          )}
        </div>
        <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
          <Detail label="Legal name">
            {patient.legalFirstName} {patient.legalLastName}
          </Detail>
          <Detail label="Pronouns">{patient.pronouns || "—"}</Detail>
          <Detail label="Email">{patient.email || "—"}</Detail>
          <Detail label="Phone">{patient.phoneE164 || "—"}</Detail>
          <Detail label="Address">{patient.address || "—"}</Detail>
          <Detail label="Emergency contact">
            {[patient.emergencyContactName, patient.emergencyContactPhone]
              .filter(Boolean)
              .join(" · ") || "—"}
          </Detail>
          <Detail label="Acquisition source">
            {patient.acquisitionSource || "—"}
          </Detail>
          <Detail label="Marketing opt-in">
            {patient.marketingOptIn ? "Yes" : "No"}
          </Detail>
          <Detail label="Created">{fmtDate(patient.createdAt)}</Detail>
          <Detail label="Last updated">{fmtDate(patient.updatedAt)}</Detail>
        </dl>
      </Card>

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
                  timeZone: CLINIC_TZ,
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

      {/* Documents on file — signed, but not clinical history */}
      <Card>
        <CardTitle>Documents on file</CardTitle>
        <p className="mt-1 text-sm text-muted">
          Releases, authorizations and other signed forms kept with this
          patient. Clinical questionnaires live in the clinical record.
        </p>
        <div className="mt-4">
          <PatientFileForms
            patientId={patient.id}
            forms={fileFormOptions}
            filed={filed}
            today={clinicDateString(new Date())}
            canAdd={canFileDocuments}
          />
        </div>
      </Card>

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

      {/* Plans & follow-up tasks */}
      <Card>
        <CardTitle>Plans &amp; follow-up</CardTitle>
        <div className="mt-4">
          <PlansTasksPanel
            patientId={patient.id}
            plans={plans.map((p) => ({ id: p.id, title: p.title, status: p.status }))}
            tasks={tasks.map((t) => ({
              id: t.id,
              title: t.title,
              status: t.status,
              priority: t.priority,
              dueDate: t.dueDate ? t.dueDate.toISOString() : null,
            }))}
            canManagePlans={canManagePlans}
            canManageTasks={canManageTasks}
          />
        </div>
      </Card>

      {/* Clinical — gated; encounters live under /encounters */}
      {canClinical && (
        <Card>
          <CardTitle>Clinical</CardTitle>
          <p className="mt-2 text-sm text-muted">
            Signed notes and measurements are managed in the Encounters
            workspace.
          </p>
        </Card>
      )}
    </div>
  );
}

function Detail({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className="whitespace-pre-wrap">{children}</dd>
    </div>
  );
}
