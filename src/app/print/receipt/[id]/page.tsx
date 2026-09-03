import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { formatCents } from "@/lib/domain/money";
import { RECEIPT_METHOD_LABELS, receiptMethodLabel } from "@/lib/domain/print";
import { getReceipt } from "@/lib/db/queries/billing";
import {
  getCompanySettings,
  getPrimaryOrganization,
} from "@/lib/db/queries/organization";
import { recordAccess } from "@/lib/audit/record";
import { CLINIC_TZ } from "@/lib/domain/timezone";
import {
  DocumentHeader,
  DocumentSheet,
  FieldLine,
  SignatureLine,
  TickBox,
} from "@/components/print/document";
import { PrintToolbar } from "@/components/print/print-toolbar";

export const metadata: Metadata = { title: "Payment receipt — Vicaria Health" };

function fmtDate(d: Date | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-CA", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: CLINIC_TZ,
  });
}

/**
 * Printable payment receipt, laid out as the clinic's paper form
 * (forms/"Formato 1"): receipt number, patient, service, amount, the payment
 * method ticked, and whether it settled the invoice in full.
 */
export default async function ReceiptPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!can(user.roles, "invoices_payments", "read")) {
    return (
      <p className="mx-auto max-w-[210mm] text-sm text-muted">
        Your role cannot view billing.
      </p>
    );
  }

  const org = await getPrimaryOrganization();
  if (!org) notFound();

  const [data, settings] = await Promise.all([
    getReceipt(org.id, id),
    getCompanySettings(org.id),
  ]);
  if (!data) notFound();

  const { receipt, payment, invoice, patient, methods, items } = data;

  if (patient) {
    await recordAccess({
      organizationId: org.id,
      actorUserId: user.authId,
      patientId: patient.id,
      action: "print",
      route: `/print/receipt/${id}`,
      purpose: "receipt_document",
    }).catch(() => {});
  }

  const currency =
    (receipt.snapshot as { currency?: string } | null)?.currency ?? "CAD";
  const money = (cents: number) => formatCents(cents, { currency });

  // Which boxes to tick: a per-payment receipt has one method; an
  // invoice-level one may aggregate several.
  const usedLabels = new Set(methods.map((m) => receiptMethodLabel(m.method)));

  // "Paid in full" is a statement about the invoice, not about this receipt:
  // a deposit is a real receipt for a partly-paid invoice.
  const paidInFull = invoice ? invoice.balanceCents <= 0 : true;

  const services = items
    .map((i) => (i.quantity > 1 ? `${i.description} ×${i.quantity}` : i.description))
    .filter(Boolean);

  const companyName = org.operatingName || org.legalName;

  return (
    <>
      <PrintToolbar
        backHref={invoice ? `/billing/${invoice.id}` : "/billing"}
        backLabel={invoice ? "Back to invoice" : "Back to billing"}
      />

      <DocumentSheet>
        <DocumentHeader
          company={{
            legalName: org.legalName,
            operatingName: org.operatingName,
            address: settings?.address ?? null,
            phone: settings?.phone ?? null,
            email: settings?.email ?? null,
            website: settings?.website ?? null,
          }}
          title="Payment receipt"
          meta={[
            { label: "Receipt No.", value: receipt.receiptNumber ?? "—" },
            { label: "Date", value: fmtDate(receipt.issuedAt) },
            ...(invoice?.invoiceNumber
              ? [{ label: "Invoice", value: invoice.invoiceNumber }]
              : []),
          ]}
        />

        <section className="mt-6 text-[12px]">
          <FieldLine
            label="Patient name"
            value={
              patient
                ? `${patient.legalFirstName} ${patient.legalLastName}${
                    patient.patientNumber ? ` (${patient.patientNumber})` : ""
                  }`
                : "—"
            }
          />
          <FieldLine
            label="Service provided"
            value={services.length > 0 ? services.join(", ") : "—"}
          />
          <FieldLine label="Provider" value={companyName} />
          <FieldLine
            label="Amount paid"
            value={
              <span className="tabular-nums">
                {money(receipt.amountCents)} {currency}
              </span>
            }
          />
          {payment?.receivedAt && (
            <FieldLine
              label="Payment received"
              value={fmtDate(payment.receivedAt)}
            />
          )}
          {payment?.reference && (
            <FieldLine label="Reference" value={payment.reference} />
          )}
        </section>

        <section className="print-keep-together mt-5 space-y-2 text-[12px]">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            <span className="text-neutral-600">Payment method:</span>
            {RECEIPT_METHOD_LABELS.map((label) => (
              <TickBox key={label} checked={usedLabels.has(label)} label={label} />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            <span className="text-neutral-600">Payment status:</span>
            <TickBox checked={paidInFull} label="Paid in full" />
            <TickBox checked={!paidInFull} label="Partial payment" />
            {invoice && !paidInFull && (
              <span className="text-neutral-700">
                Balance remaining: {money(invoice.balanceCents)}
              </span>
            )}
          </div>
        </section>

        {items.length > 0 && (
          <section className="print-keep-together mt-5">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-neutral-600">
              Description of service
            </div>
            <ul className="mt-1 text-[12px]">
              {items.map((i, idx) => (
                <li
                  key={idx}
                  className="flex justify-between border-b border-neutral-200 py-1"
                >
                  <span>
                    {i.description}
                    {i.quantity > 1 ? ` ×${i.quantity}` : ""}
                  </span>
                  <span className="tabular-nums">{money(i.lineTotalCents)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <footer className="print-keep-together mt-10 border-t border-neutral-300 pt-4 text-[11px] text-neutral-700">
          <p className="font-medium">Thank you for choosing {companyName}.</p>
          <p className="mt-1">
            For questions regarding this receipt, please contact us
            {settings?.email ? ` — ${settings.email}` : ""}
            {settings?.website ? ` · ${settings.website}` : ""}
            {settings?.phone ? ` · ${settings.phone}` : ""}
          </p>
          <div className="mt-2 max-w-xs">
            <SignatureLine
              label="Authorized signature"
              hint={`${companyName} representative`}
            />
          </div>
        </footer>
      </DocumentSheet>
    </>
  );
}
