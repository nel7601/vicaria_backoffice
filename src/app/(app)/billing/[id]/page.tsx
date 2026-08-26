import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, CardTitle } from "@/components/ui/card";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { formatCents } from "@/lib/domain/money";
import {
  getInvoice,
  listAllocatablePayments,
  listPendingEtransfersForInvoice,
} from "@/lib/db/queries/billing";
import {
  getPrimaryOrganization,
  listServicesWithPrice,
} from "@/lib/db/queries/organization";
import { InvoiceActions } from "./invoice-actions";
import { DraftEditor, type DraftServiceOption } from "./draft-editor";

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!can(user.roles, "invoices_payments", "read")) {
    return (
      <Card>
        <CardTitle>Invoice</CardTitle>
        <p className="mt-2 text-sm text-muted">Your role cannot view billing.</p>
      </Card>
    );
  }

  let data: Awaited<ReturnType<typeof getInvoice>> = null;
  let allocatable: Awaited<ReturnType<typeof listAllocatablePayments>> = [];
  let pendingEtransfers: Awaited<
    ReturnType<typeof listPendingEtransfersForInvoice>
  > = [];
  let serviceOptions: DraftServiceOption[] = [];
  let dbError: string | null = null;
  try {
    const org = await getPrimaryOrganization();
    if (org) {
      data = await getInvoice(org.id, id);
      if (data) {
        [allocatable, pendingEtransfers] = await Promise.all([
          listAllocatablePayments(org.id, data.invoice.patientId),
          listPendingEtransfersForInvoice(org.id, id),
        ]);
        if (data.invoice.status === "draft") {
          serviceOptions = (await listServicesWithPrice(org.id))
            .filter((sv) => sv.isActive)
            .map((sv) => ({
              id: sv.id,
              label: sv.nameEn,
              priceCents: sv.priceCents ?? 0,
              taxRateBps: sv.taxRateBps ?? 0,
            }));
        }
      }
    }
  } catch (e) {
    dbError = "Database not reachable.";
    console.error("Invoice load failed:", e);
  }

  if (dbError) {
    return (
      <Card>
        <p className="text-sm text-warning">{dbError}</p>
      </Card>
    );
  }
  if (!data) notFound();

  const { invoice, items, allocations, patient } = data;
  const canUpdate = can(user.roles, "invoices_payments", "update");

  return (
    <div className="space-y-6">
      <div>
        <Link href="/billing" className="text-sm text-primary hover:underline">
          ← Billing
        </Link>
        <h1 className="mt-1 text-xl font-semibold">
          {invoice.invoiceNumber ?? "Pre-invoice (draft)"}
        </h1>
        <p className="text-sm text-muted">
          {patient
            ? `${patient.preferredName || patient.legalFirstName} ${patient.legalLastName}`
            : ""}{" "}
          · {invoice.status} · {invoice.language.toUpperCase()}
        </p>
      </div>

      <Card>
        <CardTitle>Line items</CardTitle>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase text-muted">
                <th className="py-2 pr-4">Description</th>
                <th className="py-2 pr-4">Qty</th>
                <th className="py-2 pr-4">Unit</th>
                <th className="py-2 pr-4">Line total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className="border-b border-border/60">
                  <td className="py-2 pr-4">{it.description}</td>
                  <td className="py-2 pr-4">{it.quantity}</td>
                  <td className="py-2 pr-4">{formatCents(it.unitPriceCents)}</td>
                  <td className="py-2 pr-4 tabular-nums">
                    {formatCents(it.lineTotalCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {invoice.notes && (
          <p className="mt-3 whitespace-pre-wrap rounded-md bg-warm/60 p-3 text-sm">
            {invoice.notes}
          </p>
        )}
        {canUpdate && invoice.status === "draft" && (
          <div className="mt-4">
            <DraftEditor
              invoiceId={invoice.id}
              language={invoice.language as "en" | "es"}
              notes={invoice.notes}
              items={items.map((it) => ({
                serviceId: it.serviceId,
                description: it.description,
                quantity: it.quantity,
                unitPriceCents: it.unitPriceCents,
                taxRateBps: it.taxRateBps,
              }))}
              services={serviceOptions}
            />
          </div>
        )}
        <div className="mt-4 space-y-1 text-right text-sm">
          <div>Subtotal: {formatCents(invoice.subtotalCents)}</div>
          <div>Discount: {formatCents(invoice.discountCents)}</div>
          <div>Tax: {formatCents(invoice.taxCents)}</div>
          <div className="text-base font-semibold">
            Total: {formatCents(invoice.totalCents)}
          </div>
          <div>Paid: {formatCents(invoice.paidCents)}</div>
          <div className="font-medium">
            Balance: {formatCents(invoice.balanceCents)}
          </div>
        </div>
      </Card>

      <Card>
        <CardTitle>Payments applied</CardTitle>
        <ul className="mt-3 divide-y divide-border text-sm">
          {allocations.length === 0 && (
            <li className="py-2 text-muted">No allocations yet.</li>
          )}
          {allocations.map((a) => (
            <li key={a.id} className="flex justify-between py-2">
              <span>
                {a.method} · {a.status}
              </span>
              <span className="tabular-nums">{formatCents(a.amountCents)}</span>
            </li>
          ))}
        </ul>
      </Card>

      {canUpdate && (
        <Card>
          <CardTitle>Actions</CardTitle>
          <div className="mt-4">
            <InvoiceActions
              invoiceId={invoice.id}
              status={invoice.status}
              balanceCents={invoice.balanceCents}
              allocatable={allocatable}
              pendingEtransfers={pendingEtransfers}
            />
          </div>
        </Card>
      )}
    </div>
  );
}
