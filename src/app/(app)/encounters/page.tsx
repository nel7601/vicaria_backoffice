import Link from "next/link";
import { Card, CardTitle } from "@/components/ui/card";
import { RecordLink } from "@/components/ui/record-link";
import { getSessionUser } from "@/lib/auth/session";
import { dbFailureMessage } from "@/lib/db/retry";
import { can } from "@/lib/auth/rbac";
import { getPrimaryOrganization } from "@/lib/db/queries/organization";
import { getEmployeeIdForAuthUser } from "@/lib/db/queries/employee";
import {
  listEncounters,
  listTemplates,
} from "@/lib/db/queries/encounters";
import { listPatients } from "@/lib/db/queries/patients";
import { NewEncounterForm } from "./new-encounter-form";

export default async function EncountersPage({
  searchParams,
}: {
  searchParams: Promise<{ unsigned?: string }>;
}) {
  const { unsigned } = await searchParams;
  const user = await getSessionUser();
  const roles = user?.roles ?? [];

  if (!can(roles, "clinical_notes", "read")) {
    return (
      <Card>
        <CardTitle>Encounters</CardTitle>
        <p className="mt-2 text-sm text-muted">
          Your role cannot view clinical notes.
        </p>
      </Card>
    );
  }

  const canCreate = can(roles, "clinical_notes", "create");
  const unsignedOnly = unsigned === "1";

  let rows: Awaited<ReturnType<typeof listEncounters>> = [];
  let patients: { id: string; label: string }[] = [];
  let templates: { id: string; label: string }[] = [];
  let dbError: string | null = null;

  try {
    const org = await getPrimaryOrganization();
    if (org && user) {
      // Practitioners see only their own notes (own scope).
      let practitionerId: string | undefined;
      if (roles.includes("practitioner") && !roles.includes("owner") && !roles.includes("administrator") && !roles.includes("auditor")) {
        practitionerId =
          (await getEmployeeIdForAuthUser(org.id, user.authId)) ??
          "00000000-0000-0000-0000-000000000000";
      }
      rows = await listEncounters({
        organizationId: org.id,
        practitionerId,
        unsignedOnly,
      });
      if (canCreate) {
        const [pats, tpls] = await Promise.all([
          listPatients({ organizationId: org.id, limit: 100 }),
          listTemplates(org.id),
        ]);
        patients = pats.map((p) => ({
          id: p.id,
          label: `${p.preferredName || p.legalFirstName} ${p.legalLastName} (${p.patientNumber})`,
        }));
        templates = tpls.map((t) => ({
          id: t.versionId,
          label: `${t.name} v${t.version}`,
        }));
      }
    }
  } catch (e) {
    dbError = dbFailureMessage("encounters", e);
    console.error("Encounters load failed:", e);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Encounters</h1>
          <p className="text-sm text-muted">
            Consultations, notes, signing and amendments (FR-ENC-*).
          </p>
        </div>
        {canCreate && !dbError && (
          <NewEncounterForm patients={patients} templates={templates} />
        )}
      </div>

      <Card>
        <div className="mb-4 flex gap-2 text-sm">
          <Link
            href="/encounters"
            className={`rounded-md border border-border px-3 py-1.5 ${!unsignedOnly ? "bg-primary/10 text-primary" : ""}`}
          >
            All
          </Link>
          <Link
            href="/encounters?unsigned=1"
            className={`rounded-md border border-border px-3 py-1.5 ${unsignedOnly ? "bg-primary/10 text-primary" : ""}`}
          >
            Unsigned drafts
          </Link>
        </div>

        {dbError && <p className="text-sm text-warning">{dbError}</p>}

        {!dbError && (
          <ul className="divide-y divide-border text-sm">
            {rows.length === 0 && (
              <li className="py-6 text-center text-muted">No encounters.</li>
            )}
            {rows.map((e) => (
              <li key={e.id} className="flex items-center justify-between py-3">
                <div>
                  <span className="flex items-center gap-1.5">
                    <Link
                      href={`/encounters/${e.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {e.patientFirst} {e.patientLast}
                    </Link>
                    <RecordLink patientId={e.patientId} />
                  </span>
                  <div className="text-xs text-muted">
                    {e.practitionerFirst} {e.practitionerLast}
                    {e.startedAt
                      ? ` · ${new Date(e.startedAt).toLocaleDateString("en-CA")}`
                      : ""}
                    {e.summary ? ` · ${e.summary.slice(0, 60)}` : ""}
                  </div>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    e.status === "draft"
                      ? "bg-warning/10 text-warning"
                      : "bg-success/10 text-success"
                  }`}
                >
                  {e.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
