import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardTitle } from "@/components/ui/card";
import { RecordLink } from "@/components/ui/record-link";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { getPrimaryOrganization } from "@/lib/db/queries/organization";
import {
  getCareAgreement,
  listAgreementShifts,
  listCareContacts,
  listCaregivers,
} from "@/lib/db/queries/care";
import {
  formatMinutes,
  scheduledMinutesInWindow,
} from "@/lib/domain/care";
import { formatCents } from "@/lib/domain/money";
import {
  clinicDateString,
  clinicWeekWindow,
  shiftDay,
} from "@/lib/domain/timezone";
import { AgreementStatusControls } from "./status-controls";
import { GenerateInvoiceButton } from "./generate-invoice-button";
import { ContactsSection, type ContactRow } from "./contacts-section";
import { ShiftsSection, type ShiftRow } from "./shifts-section";

export default async function CareAgreementPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ week?: string }>;
}) {
  const { id } = await params;
  const { week } = await searchParams;
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

  const org = await getPrimaryOrganization();
  if (!org) notFound();

  const agreement = await getCareAgreement(org.id, id);
  if (!agreement) notFound();

  const anchor = week ?? clinicDateString(new Date());
  const { from, to, weekStart } = clinicWeekWindow(anchor);
  const weekEnd = shiftDay(weekStart, 6);

  const [shifts, contacts, caregivers] = await Promise.all([
    listAgreementShifts(org.id, id, from, to),
    listCareContacts(org.id, agreement.patientId),
    listCaregivers(org.id),
  ]);

  const scheduled = scheduledMinutesInWindow(
    shifts.map((s) => ({ ...s, status: s.status as string })),
    from,
    to,
  );
  const pct = agreement.weeklyMinutes
    ? Math.min(100, Math.round((scheduled / agreement.weeklyMinutes) * 100))
    : 0;

  const canEdit = can(roles, "home_care", "update");
  const canSchedule = can(roles, "home_care", "create");
  const canInvoice = can(roles, "invoices_payments", "create");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-sm">
            <Link href="/care" className="text-primary hover:underline">
              ← Home care
            </Link>
          </div>
          <h1 className="mt-1 flex items-center gap-2 text-xl font-semibold">
            {agreement.patientFirst} {agreement.patientLast}
            <RecordLink patientId={agreement.patientId} />
          </h1>
          <p className="text-sm text-muted">
            {agreement.patientNumber} · {formatMinutes(agreement.weeklyMinutes)}
            /week · {formatCents(agreement.hourlyRateCents)}/h ·{" "}
            {agreement.startDate} → {agreement.endDate ?? "open-ended"}
          </p>
        </div>
        <AgreementStatusControls
          agreementId={agreement.id}
          status={agreement.status}
          canEdit={canEdit}
        />
      </div>

      {(agreement.address || agreement.carePlan) && (
        <Card>
          <CardTitle>Care plan</CardTitle>
          {agreement.address && (
            <p className="mt-2 text-sm">
              <span className="text-muted">Address:</span> {agreement.address}
            </p>
          )}
          {agreement.carePlan && (
            <p className="mt-2 whitespace-pre-wrap text-sm">{agreement.carePlan}</p>
          )}
        </Card>
      )}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>
            Week {weekStart} → {weekEnd}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Link
              href={`/care/${id}?week=${shiftDay(weekStart, -7)}`}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-warm"
            >
              ← Prev week
            </Link>
            <Link
              href={`/care/${id}?week=${shiftDay(weekStart, 7)}`}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-warm"
            >
              Next week →
            </Link>
            <Link
              href={`/care/${id}`}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-primary hover:bg-warm"
            >
              This week
            </Link>
            {canInvoice && (
              <GenerateInvoiceButton agreementId={agreement.id} weekStart={weekStart} />
            )}
          </div>
        </div>

        {/* Contracted vs scheduled hours */}
        <div className="mt-4">
          <div className="flex items-baseline justify-between text-sm">
            <span>
              Scheduled <strong>{formatMinutes(scheduled)}</strong> of{" "}
              {formatMinutes(agreement.weeklyMinutes)} contracted
            </span>
            <span
              className={
                scheduled > agreement.weeklyMinutes
                  ? "text-warning"
                  : "text-muted"
              }
            >
              {pct}%{scheduled > agreement.weeklyMinutes ? " · over contract" : ""}
            </span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-warm">
            <div
              className={`h-full rounded-full ${scheduled > agreement.weeklyMinutes ? "bg-warning" : "bg-success"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        <div className="mt-5">
          <ShiftsSection
            agreementId={agreement.id}
            weekStart={weekStart}
            shifts={shifts.map(
              (s): ShiftRow => ({
                id: s.id,
                startAt: s.startAt.toISOString(),
                endAt: s.endAt.toISOString(),
                status: s.status,
                checkInAt: s.checkInAt?.toISOString() ?? null,
                checkOutAt: s.checkOutAt?.toISOString() ?? null,
                visitNotes: s.visitNotes,
                tasks: (s.tasks ?? []) as {
                  label: string;
                  status: string;
                  comment?: string;
                }[],
                approvedMinutes: s.approvedMinutes,
                caregiver: `${s.caregiverFirst} ${s.caregiverLast}`,
              }),
            )}
            caregivers={caregivers.map((c) => ({
              id: c.id,
              label: `${c.firstName} ${c.lastName}`,
            }))}
            canSchedule={canSchedule}
            canUpdate={canEdit}
            agreementStatus={agreement.status}
          />
        </div>
      </Card>

      <Card>
        <CardTitle>Family contacts</CardTitle>
        <div className="mt-4">
          <ContactsSection
            agreementId={agreement.id}
            contacts={contacts.map(
              (c): ContactRow => ({
                id: c.id,
                name: c.name,
                relationship: c.relationship,
                phone: c.phone,
                email: c.email,
                isPrimary: c.isPrimary,
                canApprove: c.canApprove,
              }),
            )}
            canEdit={canEdit}
          />
        </div>
      </Card>
    </div>
  );
}
