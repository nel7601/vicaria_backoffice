import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { formatCents } from "@/lib/domain/money";
import { buildPrintableInvoice } from "@/lib/domain/print";
import { getInvoice } from "@/lib/db/queries/billing";
import {
  getCompanySettings,
  getPrimaryOrganization,
} from "@/lib/db/queries/organization";
import { recordAccess } from "@/lib/audit/record";
import { CLINIC_TZ } from "@/lib/domain/timezone";
import {
  DocumentHeader,
  DocumentSheet,
  PartyBlock,
  SignatureLine,
} from "@/components/print/document";
import { PrintToolbar } from "@/components/print/print-toolbar";

export const metadata: Metadata = { title: "Invoice — Vicaria Health" };

function fmtDate(d: Date | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-CA", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: CLINIC_TZ,
  });
}

const METHOD_LABELS: Record<string, string> = {
  cash: "Cash",
  e_transfer: "E-Transfer",
  square_card: "Credit card",
  square_invoice: "Square invoice",
  debit: "Debit",
  credit: "Credit",
  other: "Other",
};

/**
 * Printable invoice (§FR-INV-004). One click from here reaches the browser's
 * print dialog, whose "Save as PDF" destination produces the PDF — the same
 * document either way, with no second renderer to drift out of step.
 */
export default async function InvoicePrintPage({
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
    getInvoice(org.id, id),
    getCompanySettings(org.id),
  ]);
  if (!data) notFound();

  const { invoice, items, allocations, patient } = data;

  // §12.2: printing a document is a read of the patient's financial record.
  await recordAccess({
    organizationId: org.id,
    actorUserId: user.authId,
    patientId: invoice.patientId,
    action: "print",
    route: `/print/invoice/${id}`,
    purpose: "invoice_document",
  }).catch(() => {});

  const doc = buildPrintableInvoice({
    invoice,
    items: items.map((i) => ({
      description: i.description,
      quantity: i.quantity,
      unitPriceCents: i.unitPriceCents,
      lineTotalCents: i.lineTotalCents,
    })),
    company: {
      legalName: org.legalName,
      operatingName: org.operatingName,
      address: settings?.address ?? null,
      phone: settings?.phone ?? null,
      email: settings?.email ?? null,
      website: settings?.website ?? null,
    },
    patient: patient
      ? {
          name: `${patient.legalFirstName} ${patient.legalLastName}`,
          patientNumber: patient.patientNumber,
          address: patient.address,
          email: patient.email,
          phone: patient.phoneE164,
        }
      : null,
    legalFooter:
      (invoice.language === "es"
        ? settings?.legalFooterEs
        : settings?.legalFooterEn) ?? null,
  });

  const money = (cents: number) =>
    formatCents(cents, { currency: invoice.currency });
  const confirmed = allocations.filter((a) => a.status === "confirmed");

  return (
    <>
      <PrintToolbar backHref={`/billing/${id}`} backLabel="Back to invoice" />

      <DocumentSheet>
        <DocumentHeader
          company={doc.company}
          title={doc.isDraft ? "Pre-invoice" : "Invoice"}
          meta={[
            { label: "Number", value: invoice.invoiceNumber ?? "Not issued" },
            { label: "Issue date", value: fmtDate(invoice.issueDate) },
            ...(invoice.dueDate
              ? [{ label: "Due date", value: fmtDate(invoice.dueDate) }]
              : []),
            { label: "Status", value: invoice.status.replace(/_/g, " ") },
          ]}
        />

        {doc.isDraft && (
          <p className="mt-4 border border-black px-3 py-2 text-[11px] font-semibold uppercase tracking-widest">
            Draft — not a valid invoice until issued
          </p>
        )}

        <section className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2">
          <PartyBlock
            title="Bill to"
            lines={[
              doc.billTo?.name,
              doc.billTo?.patientNumber
                ? `Patient ${doc.billTo.patientNumber}`
                : null,
              doc.billTo?.address,
              doc.billTo?.email,
              doc.billTo?.phone,
            ]}
          />
          <PartyBlock
            title="Currency"
            lines={[
              invoice.currency,
              `Language: ${invoice.language.toUpperCase()}`,
            ]}
          />
        </section>

        <table className="mt-6 w-full border-collapse text-[12px]">
          <thead>
            <tr className="border-y border-black text-left">
              <th className="py-1.5 pr-3 font-semibold">Description</th>
              <th className="w-16 py-1.5 pr-3 text-right font-semibold">Qty</th>
              <th className="w-28 py-1.5 pr-3 text-right font-semibold">
                Unit price
              </th>
              <th className="w-28 py-1.5 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {doc.lines.length === 0 && (
              <tr>
                <td colSpan={4} className="py-3 text-neutral-600">
                  No line items.
                </td>
              </tr>
            )}
            {doc.lines.map((l, i) => (
              <tr key={i} className="border-b border-neutral-300 align-top">
                <td className="py-1.5 pr-3">{l.description}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">
                  {l.quantity}
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums">
                  {money(l.unitPriceCents)}
                </td>
                <td className="py-1.5 text-right tabular-nums">
                  {money(l.lineTotalCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <section className="print-keep-together mt-4 flex justify-end">
          <dl className="w-72 text-[12px]">
            <Row label="Subtotal" value={money(doc.subtotalCents)} />
            {doc.discountCents > 0 && (
              <Row label="Discount" value={`− ${money(doc.discountCents)}`} />
            )}
            <Row label="Tax" value={money(doc.taxCents)} />
            <Row label="Total" value={money(doc.totalCents)} strong />
            <Row label="Paid" value={money(doc.paidCents)} />
            <Row
              label="Balance due"
              value={money(doc.balanceCents)}
              strong
              ruled
            />
          </dl>
        </section>

        {confirmed.length > 0 && (
          <section className="print-keep-together mt-6">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-neutral-600">
              Payments received
            </div>
            <ul className="mt-1 text-[12px]">
              {confirmed.map((a) => (
                <li
                  key={a.id}
                  className="flex justify-between border-b border-neutral-200 py-1"
                >
                  <span>
                    {fmtDate(a.receivedAt)} · {METHOD_LABELS[a.method] ?? a.method}
                    {a.reference ? ` · ${a.reference}` : ""}
                  </span>
                  <span className="tabular-nums">{money(a.amountCents)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {invoice.notes && (
          <section className="print-keep-together mt-6">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-neutral-600">
              Notes
            </div>
            <p className="mt-1 whitespace-pre-wrap text-[12px]">
              {invoice.notes}
            </p>
          </section>
        )}

        <footer className="print-keep-together mt-10 border-t border-neutral-300 pt-4 text-[11px] text-neutral-700">
          {doc.legalFooter && (
            <p className="whitespace-pre-wrap">{doc.legalFooter}</p>
          )}
          <p className="mt-2">
            Thank you for choosing {doc.company.operatingName || doc.company.legalName}.
          </p>
          <div className="mt-2 max-w-xs">
            <SignatureLine
              label="Authorized signature"
              hint={`${doc.company.operatingName || doc.company.legalName} representative`}
            />
          </div>
        </footer>
      </DocumentSheet>
    </>
  );
}

function Row({
  label,
  value,
  strong = false,
  ruled = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
  ruled?: boolean;
}) {
  return (
    <div
      className={`flex justify-between py-1 ${ruled ? "border-t border-black" : ""} ${
        strong ? "font-semibold" : ""
      }`}
    >
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
