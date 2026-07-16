import Link from "next/link";
import { Card, CardTitle } from "@/components/ui/card";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { formatCents } from "@/lib/domain/money";
import { getPrimaryOrganization } from "@/lib/db/queries/organization";
import {
  listInvoices,
  listPayments,
  listUnverifiedEtransfers,
} from "@/lib/db/queries/billing";
import { listPatients } from "@/lib/db/queries/patients";
import { NewInvoiceForm } from "./new-invoice-form";
import { EtransferVerifyButton, RecordPaymentForm } from "./billing-widgets";

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-border text-muted",
  issued: "bg-primary/10 text-primary",
  partially_paid: "bg-warning/10 text-warning",
  paid: "bg-success/10 text-success",
  overdue: "bg-danger/10 text-danger",
  void: "bg-border text-muted line-through",
  refunded: "bg-border text-muted",
};

export default async function BillingPage() {
  const user = await getSessionUser();
  const roles = user?.roles ?? [];

  if (!can(roles, "invoices_payments", "read")) {
    return (
      <Card>
        <CardTitle>Billing</CardTitle>
        <p className="mt-2 text-sm text-muted">
          Your role cannot view billing.
        </p>
      </Card>
    );
  }

  const canCreate = can(roles, "invoices_payments", "create");
  const canUpdate = can(roles, "invoices_payments", "update");

  let invoices: Awaited<ReturnType<typeof listInvoices>> = [];
  let payments: Awaited<ReturnType<typeof listPayments>> = [];
  let etransfers: Awaited<ReturnType<typeof listUnverifiedEtransfers>> = [];
  let patients: { id: string; label: string }[] = [];
  let dbError: string | null = null;

  try {
    const org = await getPrimaryOrganization();
    if (org) {
      [invoices, payments, etransfers] = await Promise.all([
        listInvoices(org.id),
        listPayments(org.id),
        listUnverifiedEtransfers(org.id),
      ]);
      if (canCreate) {
        const pats = await listPatients({ organizationId: org.id, limit: 100 });
        patients = pats.map((p) => ({
          id: p.id,
          label: `${p.preferredName || p.legalFirstName} ${p.legalLastName} (${p.patientNumber})`,
        }));
      }
    }
  } catch (e) {
    dbError = "Database not reachable. Configure DATABASE_URL and run migrations.";
    console.error("Billing load failed:", e);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Billing</h1>
          <p className="text-sm text-muted">
            Invoices, payments, allocations, receipts and reconciliation.
          </p>
        </div>
        {canCreate && !dbError && <NewInvoiceForm patients={patients} />}
      </div>

      {canCreate && !dbError && <RecordPaymentForm patients={patients} />}

      {dbError && (
        <Card>
          <p className="text-sm text-warning">{dbError}</p>
        </Card>
      )}

      {/* E-transfer verification queue */}
      {canUpdate && etransfers.length > 0 && (
        <Card>
          <CardTitle>E-transfers awaiting verification</CardTitle>
          <ul className="mt-3 divide-y divide-border text-sm">
            {etransfers.map((e) => (
              <li key={e.id} className="flex items-center justify-between py-2">
                <span>
                  {e.patientFirst} {e.patientLast} · {formatCents(e.amountCents)}
                  {e.reference ? ` · ${e.reference}` : ""}
                </span>
                <EtransferVerifyButton paymentId={e.id} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Invoices */}
      <Card>
        <CardTitle>Invoices</CardTitle>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase text-muted">
                <th className="py-2 pr-4">Number</th>
                <th className="py-2 pr-4">Patient</th>
                <th className="py-2 pr-4">Total</th>
                <th className="py-2 pr-4">Balance</th>
                <th className="py-2 pr-4">Status</th>
              </tr>
            </thead>
            <tbody>
              {invoices.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-muted">
                    No invoices.
                  </td>
                </tr>
              )}
              {invoices.map((i) => (
                <tr key={i.id} className="border-b border-border/60">
                  <td className="py-2 pr-4 font-mono text-xs">
                    <Link href={`/billing/${i.id}`} className="text-primary hover:underline">
                      {i.invoiceNumber ?? "(draft)"}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">
                    {i.patientFirst} {i.patientLast}
                  </td>
                  <td className="py-2 pr-4 tabular-nums">{formatCents(i.totalCents)}</td>
                  <td className="py-2 pr-4 tabular-nums">{formatCents(i.balanceCents)}</td>
                  <td className="py-2 pr-4">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[i.status] ?? ""}`}>
                      {i.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Recent payments */}
      <Card>
        <CardTitle>Recent payments</CardTitle>
        <ul className="mt-3 divide-y divide-border text-sm">
          {payments.length === 0 && <li className="py-2 text-muted">No payments.</li>}
          {payments.map((p) => (
            <li key={p.id} className="flex justify-between py-2">
              <span>
                {p.patientFirst} {p.patientLast} · {p.method}
              </span>
              <span className="text-muted">
                {formatCents(p.amountCents)} · {p.status}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
