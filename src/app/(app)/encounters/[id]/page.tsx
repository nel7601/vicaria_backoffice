import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BackLink } from "@/components/ui/back-link";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { RecordLink } from "@/components/ui/record-link";
import { getSessionUser } from "@/lib/auth/session";
import { dbFailureMessage } from "@/lib/db/retry";
import { can } from "@/lib/auth/rbac";
import { getEncounter, listEncounterLines } from "@/lib/db/queries/encounters";
import { listServicesWithPrice } from "@/lib/db/queries/organization";
import { getPatientById } from "@/lib/db/queries/patients";
import { getPrimaryOrganization } from "@/lib/db/queries/organization";
import { recordAccess } from "@/lib/audit/record";
import {
  ServicesPerformed,
  type LineRow,
  type ServiceOption,
} from "./services-performed";

/**
 * Encounter — the visit's billing/summary record: services actually
 * performed plus the doctor's free-text summary. Structured data collection
 * (forms) happens in the patient's clinical record.
 */
export default async function EncounterPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const [{ id }, { from }] = await Promise.all([params, searchParams]);
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
  let lines: LineRow[] = [];
  let serviceOptions: ServiceOption[] = [];
  let dbError: string | null = null;
  try {
    const org = await getPrimaryOrganization();
    if (org) {
      data = await getEncounter(org.id, id);
      lines = (await listEncounterLines(org.id, id)) as LineRow[];
      serviceOptions = (await listServicesWithPrice(org.id))
        .filter((s) => s.isActive)
        .map((s) => ({
          id: s.id,
          label: s.nameEn,
          priceCents: s.priceCents ?? 0,
          taxRateBps: s.taxRateBps ?? 0,
        }));
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
    dbError = dbFailureMessage("this encounter", e);
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

  const { encounter } = data;
  const canEdit = can(user.roles, "clinical_notes", "update");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <BackLink
            from={from}
            fallbackHref="/encounters"
            fallbackLabel="Encounters"
          />
          <h1 className="mt-1 flex items-center gap-2 text-xl font-semibold">
            Encounter{patientName ? ` — ${patientName}` : ""}
            <RecordLink patientId={encounter.patientId} />
          </h1>
          <p className="text-sm text-muted">
            {encounter.status} · structured forms live in the clinical record
          </p>
        </div>
        {/* Named link as well as the icon: filling a form mid-visit is a round
            trip, and the record sends you straight back here. */}
        <Link
          href={`/patients/${encounter.patientId}/record?from=${encodeURIComponent(`/encounters/${id}`)}`}
        >
          <Button variant="secondary">Open clinical record</Button>
        </Link>
      </div>

      <Card>
        <CardTitle>Services performed</CardTitle>
        <div className="mt-4">
          <ServicesPerformed
            encounterId={encounter.id}
            status={encounter.status}
            lines={lines}
            services={serviceOptions}
            canEditLines={canEdit && encounter.status === "draft"}
            canInvoice={can(user.roles, "invoices_payments", "create")}
            summary={encounter.summary}
            contentSnapshot={
              (encounter.contentSnapshot ?? {}) as Record<string, unknown>
            }
            contentHash={encounter.contentHash}
          />
        </div>
      </Card>
    </div>
  );
}
