import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, CardTitle } from "@/components/ui/card";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import type { TemplateField } from "@/lib/domain/encounter";
import { getEncounter } from "@/lib/db/queries/encounters";
import { getPatientById } from "@/lib/db/queries/patients";
import { getPrimaryOrganization } from "@/lib/db/queries/organization";
import { recordAccess } from "@/lib/audit/record";
import {
  EncounterWorkspace,
  type WorkspaceEncounter,
} from "./encounter-workspace";

function extractFields(schema: unknown): TemplateField[] {
  if (Array.isArray(schema)) return schema as TemplateField[];
  if (schema && typeof schema === "object" && "fields" in schema) {
    const f = (schema as { fields?: unknown }).fields;
    if (Array.isArray(f)) return f as TemplateField[];
  }
  return [];
}

export default async function EncounterPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!can(user.roles, "clinical_notes", "read")) {
    return (
      <Card>
        <CardTitle>Encounter</CardTitle>
        <p className="mt-2 text-sm text-muted">
          Your role cannot view clinical notes.
        </p>
      </Card>
    );
  }

  let data: Awaited<ReturnType<typeof getEncounter>> = null;
  let patientName = "";
  let dbError: string | null = null;
  try {
    const org = await getPrimaryOrganization();
    if (org) {
      data = await getEncounter(org.id, id);
      if (data) {
        const patient = await getPatientById(org.id, data.encounter.patientId);
        patientName = patient
          ? `${patient.preferredName || patient.legalFirstName} ${patient.legalLastName}`
          : "";
        await recordAccess({
          organizationId: org.id,
          actorUserId: user.authId,
          patientId: data.encounter.patientId,
          action: "view_encounter",
          route: `/encounters/${id}`,
        }).catch(() => {});
      }
    }
  } catch (e) {
    dbError = "Database not reachable.";
    console.error("Encounter load failed:", e);
  }

  if (dbError) {
    return (
      <Card>
        <p className="text-sm text-warning">{dbError}</p>
      </Card>
    );
  }
  if (!data) notFound();

  const { encounter, template, amendments, measurements } = data;
  const fields = extractFields(template?.schema);
  const canEdit = can(user.roles, "clinical_notes", "update");

  const ws: WorkspaceEncounter = {
    id: encounter.id,
    status: encounter.status,
    summary: encounter.summary,
    contentSnapshot: (encounter.contentSnapshot ?? {}) as Record<string, unknown>,
    contentHash: encounter.contentHash,
    signedAt: encounter.signedAt ? encounter.signedAt.toISOString() : null,
  };

  return (
    <div className="space-y-6">
      <div>
        <Link href="/encounters" className="text-sm text-primary hover:underline">
          ← Encounters
        </Link>
        <h1 className="mt-1 text-xl font-semibold">
          Encounter{patientName ? ` — ${patientName}` : ""}
        </h1>
        <p className="text-sm text-muted">
          {encounter.status}
          {template ? ` · template applied` : ""}
        </p>
      </div>

      <Card>
        {canEdit ? (
          <EncounterWorkspace
            encounter={ws}
            fields={fields}
            amendments={amendments.map((a) => ({
              id: a.id,
              body: a.body,
              authoredAt: a.authoredAt.toISOString(),
            }))}
            measurements={measurements.map((m) => ({
              id: m.id,
              observationType: m.observationType,
              valueNumeric: m.valueNumeric,
              valueText: m.valueText,
              unit: m.unit,
            }))}
          />
        ) : (
          <ReadOnlyView
            summary={encounter.summary}
            fields={fields}
            answers={(encounter.contentSnapshot ?? {}) as Record<string, unknown>}
          />
        )}
      </Card>
    </div>
  );
}

function ReadOnlyView({
  summary,
  fields,
  answers,
}: {
  summary: string | null;
  fields: TemplateField[];
  answers: Record<string, unknown>;
}) {
  return (
    <div className="space-y-3 text-sm">
      {fields.map((f) => (
        <div key={f.key}>
          <div className="font-medium">{f.label}</div>
          <div className="text-muted">{String(answers[f.key] ?? "—")}</div>
        </div>
      ))}
      <div>
        <div className="font-medium">Summary</div>
        <div className="text-muted">{summary || "—"}</div>
      </div>
    </div>
  );
}
