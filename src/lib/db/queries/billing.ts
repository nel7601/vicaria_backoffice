import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  invoiceItems,
  invoices,
  patients,
  paymentAllocations,
  payments,
  receipts,
  refunds,
} from "@/lib/db/schema";

export async function listInvoices(organizationId: string, limit = 50) {
  const db = getDb();
  return db
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      status: invoices.status,
      totalCents: invoices.totalCents,
      balanceCents: invoices.balanceCents,
      language: invoices.language,
      issueDate: invoices.issueDate,
      patientFirst: patients.legalFirstName,
      patientLast: patients.legalLastName,
      patientId: invoices.patientId,
    })
    .from(invoices)
    .innerJoin(patients, eq(patients.id, invoices.patientId))
    .where(eq(invoices.organizationId, organizationId))
    .orderBy(desc(invoices.createdAt))
    .limit(limit);
}

export async function getInvoice(organizationId: string, id: string) {
  const db = getDb();
  const [invoice] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.organizationId, organizationId), eq(invoices.id, id)))
    .limit(1);
  if (!invoice) return null;

  const [items, allocations, patient] = await Promise.all([
    db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, id)),
    db
      .select({
        id: paymentAllocations.id,
        amountCents: paymentAllocations.amountCents,
        paymentId: paymentAllocations.paymentId,
        method: payments.method,
        status: payments.status,
      })
      .from(paymentAllocations)
      .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
      .where(eq(paymentAllocations.invoiceId, id)),
    db
      .select()
      .from(patients)
      .where(eq(patients.id, invoice.patientId))
      .limit(1)
      .then((r) => r[0] ?? null),
  ]);

  return { invoice, items, allocations, patient };
}

/** Confirmed allocations total for an invoice (drives status). */
export async function confirmedAllocatedCents(
  invoiceId: string,
): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({
      total: sql<number>`coalesce(sum(${paymentAllocations.amountCents}), 0)::int`,
    })
    .from(paymentAllocations)
    .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
    .where(
      and(
        eq(paymentAllocations.invoiceId, invoiceId),
        eq(payments.status, "confirmed"),
      ),
    );
  return row?.total ?? 0;
}

/** Amount of a payment already allocated. */
export async function paymentAllocatedCents(paymentId: string): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({
      total: sql<number>`coalesce(sum(${paymentAllocations.amountCents}), 0)::int`,
    })
    .from(paymentAllocations)
    .where(eq(paymentAllocations.paymentId, paymentId));
  return row?.total ?? 0;
}

export async function paymentRefundedCents(paymentId: string): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({
      total: sql<number>`coalesce(sum(${refunds.amountCents}), 0)::int`,
    })
    .from(refunds)
    .where(eq(refunds.paymentId, paymentId));
  return row?.total ?? 0;
}

export async function listPayments(organizationId: string, limit = 50) {
  const db = getDb();
  return db
    .select({
      id: payments.id,
      method: payments.method,
      status: payments.status,
      amountCents: payments.amountCents,
      receivedAt: payments.receivedAt,
      reference: payments.reference,
      patientFirst: patients.legalFirstName,
      patientLast: patients.legalLastName,
    })
    .from(payments)
    .innerJoin(patients, eq(patients.id, payments.patientId))
    .where(eq(payments.organizationId, organizationId))
    .orderBy(desc(payments.receivedAt))
    .limit(limit);
}

/** Pending e-transfers awaiting verification (§FR-PAY-003). */
export async function listUnverifiedEtransfers(organizationId: string) {
  const db = getDb();
  return db
    .select({
      id: payments.id,
      amountCents: payments.amountCents,
      reference: payments.reference,
      senderName: payments.etransferSenderName,
      receivedAt: payments.receivedAt,
      patientFirst: patients.legalFirstName,
      patientLast: patients.legalLastName,
    })
    .from(payments)
    .innerJoin(patients, eq(patients.id, payments.patientId))
    .where(
      and(
        eq(payments.organizationId, organizationId),
        eq(payments.method, "e_transfer"),
        eq(payments.status, "pending"),
        isNull(payments.verifiedAt),
      ),
    );
}

export async function listReceiptsForInvoice(invoiceId: string) {
  const db = getDb();
  return db.select().from(receipts).where(eq(receipts.invoiceId, invoiceId));
}

/** Confirmed payments for a patient with any unallocated amount remaining. */
export async function listAllocatablePayments(
  organizationId: string,
  patientId: string,
) {
  const db = getDb();
  const rows = await db
    .select({
      id: payments.id,
      method: payments.method,
      amountCents: payments.amountCents,
      allocatedCents: sql<number>`coalesce((
        select sum(pa.amount_cents) from payment_allocations pa where pa.payment_id = ${payments.id}
      ), 0)::int`,
    })
    .from(payments)
    .where(
      and(
        eq(payments.organizationId, organizationId),
        eq(payments.patientId, patientId),
        eq(payments.status, "confirmed"),
      ),
    );
  return rows
    .map((r) => ({
      id: r.id,
      method: r.method,
      remainingCents: r.amountCents - r.allocatedCents,
    }))
    .filter((r) => r.remainingCents > 0);
}

/** Pending e-transfers taken via the invoice Pay flow, awaiting verification. */
export async function listPendingEtransfersForInvoice(
  organizationId: string,
  invoiceId: string,
) {
  const db = getDb();
  return db
    .select({
      id: payments.id,
      amountCents: payments.amountCents,
      etransferSenderName: payments.etransferSenderName,
      reference: payments.reference,
      receivedAt: payments.receivedAt,
    })
    .from(payments)
    .where(
      and(
        eq(payments.organizationId, organizationId),
        eq(payments.method, "e_transfer"),
        eq(payments.status, "pending"),
        sql`${payments.metadata} ->> 'intendedInvoiceId' = ${invoiceId}`,
      ),
    );
}
