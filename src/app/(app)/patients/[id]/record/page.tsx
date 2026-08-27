import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, CardTitle } from "@/components/ui/card";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import type { TemplateField } from "@/lib/domain/encounter";
import { getPrimaryOrganization } from "@/lib/db/queries/organization";
import { getPatientById } from "@/lib/db/queries/patients";
import { getPatientChart } from "@/lib/db/queries/clinical";
import { recordAccess } from "@/lib/audit/record";
import { clinicDateString } from "@/lib/domain/timezone";
import { AddNoteForm } from "./add-note-form";

const TZ = "America/Toronto";

function fmtDate(d: Date) {
  return d.toLocaleDateString("en-CA", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: TZ,
  });
}

function fmtDateTime(d: Date) {
  return d.toLocaleString("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: TZ,
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

function answerText(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

const ENCOUNTER_STATUS_STYLE: Record<string, string> = {
  draft: "bg-warning/10 text-warning",
  signed: "bg-success/10 text-success",
  amended: "bg-primary/10 text-primary",
};

/**
 * Clinical record — everything clinical about one patient in one place:
 * a tab per form (template) with the answers captured in each visit, and an
 * Evolution tab merging encounters and clinician chart notes chronologically.
 */
export default async function ClinicalRecordPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const [{ id }, { tab }] = await Promise.all([params, searchParams]);
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const roles = user.roles;

  if (!can(roles, "clinical_notes", "read")) {
    return (
      <Card>
        <CardTitle>Clinical record</CardTitle>
        <p className="mt-2 text-sm text-muted">
          Your role cannot view clinical records.
        </p>
      </Card>
    );
  }

  const org = await getPrimaryOrganization();
  if (!org) notFound();

  const patient = await getPatientById(org.id, id);
  if (!patient) notFound();

  const chart = await getPatientChart(org.id, id);

  await recordAccess({
    organizationId: org.id,
    actorUserId: user.authId,
    patientId: id,
    action: "read",
    route: `/patients/${id}/record`,
    purpose: "clinical_record",
  });

  // One tab per form (template) actually used with this patient.
  const formTabs = new Map<
    string,
    { name: string; encounters: typeof chart.encounters }
  >();
  for (const e of chart.encounters) {
    if (!e.templateId || !e.templateName) continue;
    const entry = formTabs.get(e.templateId) ?? {
      name: e.templateName,
      encounters: [] as typeof chart.encounters,
    };
    entry.encounters.push(e);
    formTabs.set(e.templateId, entry);
  }

  const activeTab = tab && formTabs.has(tab) ? tab : "evolution";
  const canAddNote = can(roles, "clinical_notes", "create");

  // Evolution: encounters + chart notes merged, newest first.
  type EvolutionEntry =
    | { kind: "encounter"; at: Date; encounter: (typeof chart.encounters)[number] }
    | { kind: "note"; at: Date; note: (typeof chart.notes)[number] };
  const evolution: EvolutionEntry[] = [
    ...chart.encounters.map((e) => ({
      kind: "encounter" as const,
      at: e.startedAt ?? e.createdAt,
      encounter: e,
    })),
    ...chart.notes.map((n) => ({ kind: "note" as const, at: n.notedAt, note: n })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  const tabClass = (active: boolean) =>
    `rounded-full px-3 py-1.5 text-sm ${
      active
        ? "bg-primary text-white"
        : "border border-border text-muted hover:bg-warm hover:text-foreground"
    }`;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/patients/${patient.id}`}
          className="text-sm text-primary hover:underline"
        >
          ← Patient profile
        </Link>
        <h1 className="mt-1 text-xl font-semibold">
          Clinical record — {patient.preferredName || patient.legalFirstName}{" "}
          {patient.legalLastName}
        </h1>
        <p className="text-sm text-muted">
          {patient.patientNumber} · {chart.encounters.length} encounter
          {chart.encounters.length === 1 ? "" : "s"} · {chart.notes.length} note
          {chart.notes.length === 1 ? "" : "s"}
        </p>
      </div>

      {/* Tabs: Evolution + one per form */}
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/patients/${patient.id}/record`}
          className={tabClass(activeTab === "evolution")}
        >
          Evolution
        </Link>
        {[...formTabs.entries()].map(([templateId, t]) => (
          <Link
            key={templateId}
            href={`/patients/${patient.id}/record?tab=${templateId}`}
            className={tabClass(activeTab === templateId)}
          >
            {t.name}
            <span className="ml-1.5 text-xs opacity-70">
              {t.encounters.length}
            </span>
          </Link>
        ))}
      </div>

      {/* Evolution tab */}
      {activeTab === "evolution" && (
        <Card>
          <CardTitle>Evolution</CardTitle>
          <p className="mt-1 text-sm text-muted">
            Visits and progress notes in chronological order, newest first.
          </p>

          {canAddNote && (
            <div className="mt-4">
              <AddNoteForm
                patientId={patient.id}
                today={clinicDateString(new Date())}
              />
            </div>
          )}

          <ol className="mt-5 space-y-4 border-l border-border pl-4">
            {evolution.length === 0 && (
              <li className="text-sm text-muted">
                No encounters or notes yet.
              </li>
            )}
            {evolution.map((entry) =>
              entry.kind === "encounter" ? (
                <li key={`e-${entry.encounter.id}`} className="relative">
                  <span className="absolute -left-[21.5px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary" />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-medium">
                      {fmtDate(entry.at)} ·{" "}
                      <Link
                        href={`/encounters/${entry.encounter.id}`}
                        className="text-primary hover:underline"
                      >
                        {entry.encounter.serviceName ?? "Encounter"}
                      </Link>
                    </div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${ENCOUNTER_STATUS_STYLE[entry.encounter.status] ?? "bg-border text-muted"}`}
                    >
                      {entry.encounter.status}
                    </span>
                  </div>
                  <div className="text-xs text-muted">
                    {entry.encounter.practitionerFirst}{" "}
                    {entry.encounter.practitionerLast} ·{" "}
                    {entry.encounter.modality.replace("_", " ")}
                    {entry.encounter.templateName
                      ? ` · ${entry.encounter.templateName}`
                      : ""}
                  </div>
                  {entry.encounter.summary && (
                    <p className="mt-1 whitespace-pre-wrap rounded-md bg-background p-2.5 text-sm">
                      {entry.encounter.summary}
                    </p>
                  )}
                </li>
              ) : (
                <li key={`n-${entry.note.id}`} className="relative">
                  <span className="absolute -left-[21.5px] top-1.5 h-2.5 w-2.5 rounded-full bg-success" />
                  <div className="text-sm font-medium">
                    {fmtDate(entry.at)} · Note
                  </div>
                  <div className="text-xs text-muted">
                    {entry.note.authorEmail ?? "—"} · added{" "}
                    {fmtDateTime(entry.note.createdAt)}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap rounded-md bg-success-soft/60 p-2.5 text-sm">
                    {entry.note.body}
                  </p>
                </li>
              ),
            )}
          </ol>
        </Card>
      )}

      {/* Form tabs: answers captured with that template, visit by visit */}
      {activeTab !== "evolution" && formTabs.has(activeTab) && (
        <Card>
          <CardTitle>{formTabs.get(activeTab)!.name}</CardTitle>
          <p className="mt-1 text-sm text-muted">
            Information collected with this form, newest visit first.
          </p>
          <div className="mt-4 space-y-5">
            {formTabs.get(activeTab)!.encounters.map((e) => {
              const fields = extractFields(e.templateSchema);
              const answers = (e.contentSnapshot ?? {}) as Record<string, unknown>;
              return (
                <div
                  key={e.id}
                  className="rounded-2xl border border-border p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-medium">
                      {fmtDate(e.startedAt ?? e.createdAt)}
                      {e.serviceName ? ` · ${e.serviceName}` : ""} ·{" "}
                      {e.practitionerFirst} {e.practitionerLast}
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${ENCOUNTER_STATUS_STYLE[e.status] ?? "bg-border text-muted"}`}
                      >
                        {e.status}
                      </span>
                      <Link
                        href={`/encounters/${e.id}`}
                        className="text-xs text-primary hover:underline"
                      >
                        Open encounter
                      </Link>
                    </div>
                  </div>
                  <dl className="mt-3 grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
                    {fields.map((f) => (
                      <div key={f.key} className="flex justify-between gap-4 sm:block">
                        <dt className="text-muted">{f.label}</dt>
                        <dd className="whitespace-pre-wrap">
                          {answerText(answers[f.key])}
                        </dd>
                      </div>
                    ))}
                    {fields.length === 0 && (
                      <div className="text-muted">No fields in this version.</div>
                    )}
                  </dl>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
