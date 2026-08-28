import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, CardTitle } from "@/components/ui/card";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import type { TemplateField } from "@/lib/domain/encounter";
import { getPrimaryOrganization } from "@/lib/db/queries/organization";
import { getPatientById } from "@/lib/db/queries/patients";
import { getPatientChart } from "@/lib/db/queries/clinical";
import { listTemplatesDetailed } from "@/lib/db/queries/encounters";
import { recordAccess } from "@/lib/audit/record";
import { clinicDateString } from "@/lib/domain/timezone";
import { AddNoteForm } from "./add-note-form";
import { AddFormPanel, type FormOption } from "./add-form-panel";
import { EditableFormEntry } from "./editable-form-entry";

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

/** One filled form or one visit's answers, shown inside a form tab. */
interface TabItem {
  key: string;
  at: Date;
  schema: unknown;
  answers: Record<string, unknown>;
  /** "encounter" items link to the visit; "form" items were filled directly. */
  kind: "encounter" | "form";
  encounterId?: string;
  formId?: string;
  status?: string;
  serviceName?: string | null;
  byLine: string;
}

/**
 * Clinical record — everything clinical about one patient in one place:
 * a tab per form with the answers captured each time it was filled (in a
 * visit or directly from here), and an Evolution tab merging encounters,
 * filled forms and clinician chart notes chronologically.
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

  const canAdd = can(roles, "clinical_notes", "create");
  const canUpdate = can(roles, "clinical_notes", "update");
  const [chart, templates] = await Promise.all([
    getPatientChart(org.id, id),
    canAdd ? listTemplatesDetailed(org.id) : Promise.resolve([]),
  ]);

  await recordAccess({
    organizationId: org.id,
    actorUserId: user.authId,
    patientId: id,
    action: "read",
    route: `/patients/${id}/record`,
    purpose: "clinical_record",
  });

  const formOptions: FormOption[] = templates
    .filter((t) => t.versionId && !t.archivedAt)
    .map((t) => ({
      templateId: t.templateId,
      versionId: t.versionId!,
      name: t.name,
      fields: extractFields(t.schema),
    }));

  // One tab per form used with this patient — from visits or filled directly.
  const formTabs = new Map<string, { name: string; items: TabItem[] }>();
  const tabFor = (templateId: string, name: string) => {
    const entry = formTabs.get(templateId) ?? { name, items: [] };
    formTabs.set(templateId, entry);
    return entry;
  };
  for (const e of chart.encounters) {
    if (!e.templateId || !e.templateName) continue;
    tabFor(e.templateId, e.templateName).items.push({
      key: `e-${e.id}`,
      at: e.startedAt ?? e.createdAt,
      schema: e.templateSchema,
      answers: (e.contentSnapshot ?? {}) as Record<string, unknown>,
      kind: "encounter",
      encounterId: e.id,
      status: e.status,
      serviceName: e.serviceName,
      byLine: `${e.practitionerFirst} ${e.practitionerLast}`,
    });
  }
  for (const f of chart.forms) {
    tabFor(f.templateId, f.templateName).items.push({
      key: `f-${f.id}`,
      at: f.filledAt,
      schema: f.templateSchema,
      answers: (f.answers ?? {}) as Record<string, unknown>,
      kind: "form",
      formId: f.id,
      byLine: f.filledByEmail ?? "—",
    });
  }
  for (const t of formTabs.values()) {
    t.items.sort((a, b) => b.at.getTime() - a.at.getTime());
  }

  const activeTab = tab && formTabs.has(tab) ? tab : "evolution";

  // Evolution: encounters + filled forms + chart notes merged, newest first.
  type EvolutionEntry =
    | { kind: "encounter"; at: Date; encounter: (typeof chart.encounters)[number] }
    | { kind: "form"; at: Date; form: (typeof chart.forms)[number] }
    | { kind: "note"; at: Date; note: (typeof chart.notes)[number] };
  const evolution: EvolutionEntry[] = [
    ...chart.encounters.map((e) => ({
      kind: "encounter" as const,
      at: e.startedAt ?? e.createdAt,
      encounter: e,
    })),
    ...chart.forms.map((f) => ({ kind: "form" as const, at: f.filledAt, form: f })),
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
          {chart.encounters.length === 1 ? "" : "s"} · {chart.forms.length} form
          {chart.forms.length === 1 ? "" : "s"} · {chart.notes.length} note
          {chart.notes.length === 1 ? "" : "s"}
        </p>
      </div>

      {/* Tabs: Evolution + one per form, and the Add form control */}
      <div className="flex flex-wrap items-start justify-between gap-3">
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
              <span className="ml-1.5 text-xs opacity-70">{t.items.length}</span>
            </Link>
          ))}
        </div>
      </div>

      {canAdd && (
        <AddFormPanel
          patientId={patient.id}
          forms={formOptions}
          today={clinicDateString(new Date())}
        />
      )}

      {/* Evolution tab */}
      {activeTab === "evolution" && (
        <Card>
          <CardTitle>Evolution</CardTitle>
          <p className="mt-1 text-sm text-muted">
            Visits, filled forms and progress notes in chronological order,
            newest first.
          </p>

          {canAdd && (
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
                No encounters, forms or notes yet.
              </li>
            )}
            {evolution.map((entry) => {
              if (entry.kind === "encounter") {
                const e = entry.encounter;
                return (
                  <li key={`e-${e.id}`} className="relative">
                    <span className="absolute -left-[21.5px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary" />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-medium">
                        {fmtDate(entry.at)} ·{" "}
                        <Link
                          href={`/encounters/${e.id}`}
                          className="text-primary hover:underline"
                        >
                          {e.serviceName ?? "Encounter"}
                        </Link>
                      </div>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${ENCOUNTER_STATUS_STYLE[e.status] ?? "bg-border text-muted"}`}
                      >
                        {e.status}
                      </span>
                    </div>
                    <div className="text-xs text-muted">
                      {e.practitionerFirst} {e.practitionerLast} ·{" "}
                      {e.modality.replace("_", " ")}
                    </div>
                    {e.summary && (
                      <p className="mt-1 whitespace-pre-wrap rounded-md bg-background p-2.5 text-sm">
                        {e.summary}
                      </p>
                    )}
                  </li>
                );
              }
              if (entry.kind === "form") {
                const f = entry.form;
                return (
                  <li key={`f-${f.id}`} className="relative">
                    <span className="absolute -left-[21.5px] top-1.5 h-2.5 w-2.5 rounded-full bg-warning" />
                    <div className="text-sm font-medium">
                      {fmtDate(entry.at)} ·{" "}
                      <Link
                        href={`/patients/${patient.id}/record?tab=${f.templateId}`}
                        className="text-primary hover:underline"
                      >
                        {f.templateName}
                      </Link>{" "}
                      <span className="font-normal text-muted">form</span>
                    </div>
                    <div className="text-xs text-muted">
                      Filled by {f.filledByEmail ?? "—"}
                    </div>
                  </li>
                );
              }
              const n = entry.note;
              return (
                <li key={`n-${n.id}`} className="relative">
                  <span className="absolute -left-[21.5px] top-1.5 h-2.5 w-2.5 rounded-full bg-success" />
                  <div className="text-sm font-medium">
                    {fmtDate(entry.at)} · Note
                  </div>
                  <div className="text-xs text-muted">
                    {n.authorEmail ?? "—"} · added {fmtDateTime(n.createdAt)}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap rounded-md bg-success-soft/60 p-2.5 text-sm">
                    {n.body}
                  </p>
                </li>
              );
            })}
          </ol>
        </Card>
      )}

      {/* Form tabs: every time this form was filled, newest first */}
      {activeTab !== "evolution" && formTabs.has(activeTab) && (
        <Card>
          <CardTitle>{formTabs.get(activeTab)!.name}</CardTitle>
          <p className="mt-1 text-sm text-muted">
            Information collected with this form, newest first.
          </p>
          <div className="mt-4 space-y-5">
            {formTabs.get(activeTab)!.items.map((item) => {
              const fields = extractFields(item.schema);
              if (item.kind === "form") {
                return (
                  <EditableFormEntry
                    key={item.key}
                    formId={item.formId!}
                    fields={fields}
                    answers={item.answers}
                    filledAt={clinicDateString(item.at)}
                    dateLabel={fmtDate(item.at)}
                    byLine={item.byLine}
                    today={clinicDateString(new Date())}
                    canEdit={canUpdate}
                  />
                );
              }
              return (
                <div key={item.key} className="rounded-2xl border border-border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-medium">
                      {fmtDate(item.at)}
                      {item.serviceName ? ` · ${item.serviceName}` : ""} ·{" "}
                      {item.byLine}
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${ENCOUNTER_STATUS_STYLE[item.status ?? ""] ?? "bg-border text-muted"}`}
                      >
                        {item.status}
                      </span>
                      <Link
                        href={`/encounters/${item.encounterId}`}
                        className="text-xs text-primary hover:underline"
                      >
                        Open encounter
                      </Link>
                    </div>
                  </div>
                  <dl className="mt-3 grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
                    {fields.map((f) =>
                      f.type === "heading" ? (
                        <div
                          key={f.key}
                          className="border-b border-border pb-1 pt-2 font-semibold sm:col-span-2"
                        >
                          {f.label}
                        </div>
                      ) : (
                        <div
                          key={f.key}
                          className="flex justify-between gap-4 sm:block"
                        >
                          <dt className="text-muted">{f.label}</dt>
                          <dd className="whitespace-pre-wrap">
                            {answerText(item.answers[f.key])}
                          </dd>
                        </div>
                      ),
                    )}
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
