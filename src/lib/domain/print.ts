/**
 * What a printed invoice or receipt says (§FR-INV-004, §FR-REC-001).
 *
 * An issued invoice froze a snapshot of itself. Reprinting must read that
 * snapshot, not today's rows: the clinic's phone number, a patient's address
 * or a service's price can all change, and none of them may silently rewrite
 * a document the patient already holds. Live rows are the fallback for a
 * draft, which by definition has not been frozen yet.
 *
 * Pure: no database, no formatting — the page decides how to lay it out.
 */

export interface PrintableParty {
  name: string;
  patientNumber?: string | null;
  address?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface PrintableCompany {
  legalName: string;
  operatingName?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
}

export interface PrintableLine {
  description: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
}

export interface PrintableInvoice {
  company: PrintableCompany;
  billTo: PrintableParty | null;
  lines: PrintableLine[];
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  legalFooter: string | null;
  /** True while the invoice has no number: it is not a valid invoice yet. */
  isDraft: boolean;
  /** True when the figures came from the frozen snapshot. */
  fromSnapshot: boolean;
}

/** Shape of the jsonb frozen by issueInvoiceAction. Every field optional. */
interface InvoiceSnapshot {
  invoiceNumber?: string;
  issuedAt?: string;
  notes?: string | null;
  legalFooter?: string | null;
  company?: Partial<PrintableCompany> & { legalName?: string };
  billTo?: {
    patientNumber?: string | null;
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
  } | null;
  totals?: Partial<
    Pick<
      PrintableInvoice,
      "subtotalCents" | "discountCents" | "taxCents" | "totalCents"
    >
  >;
  items?: Partial<PrintableLine>[];
}

export interface BuildPrintableInvoiceInput {
  invoice: {
    invoiceNumber: string | null;
    status: string;
    subtotalCents: number;
    discountCents: number;
    taxCents: number;
    totalCents: number;
    paidCents: number;
    balanceCents: number;
    notes: string | null;
    snapshot: unknown;
  };
  items: PrintableLine[];
  /** Live identity, used for a draft or to fill a gap in an old snapshot. */
  company: PrintableCompany;
  patient: PrintableParty | null;
  legalFooter: string | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function buildPrintableInvoice(
  input: BuildPrintableInvoiceInput,
): PrintableInvoice {
  const { invoice } = input;
  const isDraft = invoice.invoiceNumber === null;
  const snap: InvoiceSnapshot = isRecord(invoice.snapshot)
    ? (invoice.snapshot as InvoiceSnapshot)
    : {};

  // Older snapshots carry only totals and items; anything they lack falls back
  // to the live row, which for a frozen document is unchanged anyway.
  const snapItems = Array.isArray(snap.items) ? snap.items : null;
  const usableItems =
    !isDraft && snapItems && snapItems.length > 0
      ? snapItems.map((i) => ({
          description: String(i.description ?? ""),
          quantity: Number(i.quantity ?? 1),
          unitPriceCents: Number(i.unitPriceCents ?? 0),
          lineTotalCents: Number(i.lineTotalCents ?? 0),
        }))
      : input.items;

  const totals = !isDraft && snap.totals ? snap.totals : null;

  const snapCompany = !isDraft && snap.company ? snap.company : null;
  const company: PrintableCompany = snapCompany
    ? {
        legalName: snapCompany.legalName ?? input.company.legalName,
        operatingName: snapCompany.operatingName ?? input.company.operatingName,
        address: snapCompany.address ?? input.company.address,
        phone: snapCompany.phone ?? input.company.phone,
        email: snapCompany.email ?? input.company.email,
        website: snapCompany.website ?? input.company.website,
      }
    : input.company;

  const snapBillTo = !isDraft && snap.billTo ? snap.billTo : null;
  const billTo: PrintableParty | null = snapBillTo?.name
    ? {
        name: snapBillTo.name,
        patientNumber: snapBillTo.patientNumber ?? null,
        address: snapBillTo.address ?? null,
        email: snapBillTo.email ?? null,
        phone: snapBillTo.phone ?? null,
      }
    : input.patient;

  return {
    company,
    billTo,
    lines: usableItems,
    subtotalCents: totals?.subtotalCents ?? invoice.subtotalCents,
    discountCents: totals?.discountCents ?? invoice.discountCents,
    taxCents: totals?.taxCents ?? invoice.taxCents,
    totalCents: totals?.totalCents ?? invoice.totalCents,
    // Paid and balance are deliberately live: they move with every payment
    // after the invoice was issued, and a reprint should show what is owed
    // today, not what was owed the day it was cut.
    paidCents: invoice.paidCents,
    balanceCents: invoice.balanceCents,
    legalFooter: snap.legalFooter ?? input.legalFooter,
    isDraft,
    fromSnapshot: Boolean(!isDraft && (totals || snapItems)),
  };
}

/** Human label for a payment method on a printed receipt. */
export const RECEIPT_METHOD_LABELS = [
  "Cash",
  "Debit",
  "Credit Card",
  "E-Transfer",
  "Other",
] as const;

export type ReceiptMethodLabel = (typeof RECEIPT_METHOD_LABELS)[number];

/** Map the stored payment_method enum onto the paper form's tick boxes. */
export function receiptMethodLabel(method: string): ReceiptMethodLabel {
  switch (method) {
    case "cash":
      return "Cash";
    case "debit":
      return "Debit";
    case "credit":
    case "square_card":
      return "Credit Card";
    case "e_transfer":
      return "E-Transfer";
    default:
      return "Other";
  }
}
