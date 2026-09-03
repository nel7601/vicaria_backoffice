import Link from "next/link";
import { Card, CardTitle } from "@/components/ui/card";
import { RecordLink } from "@/components/ui/record-link";
import { getSessionUser } from "@/lib/auth/session";
import { dbFailureMessage } from "@/lib/db/retry";
import { can } from "@/lib/auth/rbac";
import { getPrimaryOrganization } from "@/lib/db/queries/organization";
import { listCareAgreements } from "@/lib/db/queries/care";
import { listPatients } from "@/lib/db/queries/patients";
import { formatMinutes } from "@/lib/domain/care";
import { formatCents } from "@/lib/domain/money";
import { NewAgreementForm } from "./new-agreement-form";

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-warm text-muted",
  active: "bg-success-soft text-success",
  paused: "bg-primary-soft text-primary-hover",
  ended: "bg-border/60 text-muted",
};

/** Vicaria Care — home-care agreements (weekly hours contracts). */
export default async function CarePage() {
  const user = await getSessionUser();
  const roles = user?.roles ?? [];

  if (!can(roles, "home_care", "read")) {
    return (
      <Card>
        <CardTitle>Home care</CardTitle>
        <p className="mt-2 text-sm text-muted">
          Your role cannot view home-care agreements.
        </p>
      </Card>
    );
  }

  const canCreate = can(roles, "home_care", "create");

  let agreements: Awaited<ReturnType<typeof listCareAgreements>> = [];
  let patients: { id: string; label: string }[] = [];
  let dbError: string | null = null;

  try {
    const org = await getPrimaryOrganization();
    if (org) {
      agreements = await listCareAgreements(org.id);
      if (canCreate) {
        const pats = await listPatients({ organizationId: org.id, limit: 200 });
        patients = pats.map((p) => ({
          id: p.id,
          label: `${p.preferredName || p.legalFirstName} ${p.legalLastName} (${p.patientNumber})`,
        }));
      }
    }
  } catch (e) {
    dbError = dbFailureMessage("home care", e);
    console.error("Care page load failed:", e);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Home care</h1>
          <p className="text-sm text-muted">
            Vicaria Care · in-home senior care agreements and shifts.
          </p>
        </div>
        {canCreate && !dbError && <NewAgreementForm patients={patients} />}
      </div>

      <Card>
        {dbError && <p className="text-sm text-warning">{dbError}</p>}
        {!dbError && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-border-strong text-left text-xs font-semibold uppercase tracking-wide text-muted">
                  <th className="py-2 pr-4">Client</th>
                  <th className="py-2 pr-4">Hours / week</th>
                  <th className="py-2 pr-4">Period</th>
                  <th className="py-2 pr-4">Rate</th>
                  <th className="py-2 pr-4">Status</th>
                </tr>
              </thead>
              <tbody>
                {agreements.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-muted">
                      No agreements yet. Create the first home-care agreement.
                    </td>
                  </tr>
                )}
                {agreements.map((a) => (
                  <tr key={a.id} className="border-b border-border/60 transition-colors hover:bg-surface-muted">
                    <td className="py-2.5 pr-4">
                      <span className="flex items-center gap-1.5">
                        <Link
                          href={`/care/${a.id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {a.patientFirst} {a.patientLast}
                        </Link>
                        <RecordLink patientId={a.patientId} />
                        <span className="text-xs text-muted">
                          {a.patientNumber}
                        </span>
                      </span>
                    </td>
                    <td className="py-2.5 pr-4">{formatMinutes(a.weeklyMinutes)}</td>
                    <td className="py-2.5 pr-4 text-muted">
                      {a.startDate} → {a.endDate ?? "open-ended"}
                    </td>
                    <td className="py-2.5 pr-4 tabular-nums">
                      {formatCents(a.hourlyRateCents)}/h
                    </td>
                    <td className="py-2.5 pr-4">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[a.status] ?? ""}`}
                      >
                        {a.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
