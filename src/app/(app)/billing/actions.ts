"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { authorize } from "@/lib/auth/authorize";
import { recordAudit } from "@/lib/audit/record";
import { getDb } from "@/lib/db";
import {
  companySettings,
  creditNotes,
  invoiceItems,
  invoices,
  patients,
  paymentAllocations,
  payments,
  receipts,
  refunds,
  squareTransactions,
} from "@/lib/db/schema";
import { getPrimaryOrganization } from "@/lib/db/queries/organization";
import {
  paymentAllocatedCents,
  paymentRefundedCents,
} from "@/lib/db/queries/billing";
import {
  allocateSchema,
  createInvoiceSchema,
  creditNoteSchema,
  recordPaymentSchema,
  refundSchema,
  updateInvoiceDraftSchema,
  voidInvoiceSchema,
} from "@/lib/schemas/billing";
import {
  balanceCents,
  canAllocate,
  canRefund,
  computeInvoiceTotals,
  deriveInvoiceStatus,
  derivePaymentStatus,
  formatInvoiceNumber,
  formatReceiptNumber,
  receiptableCents,
} from "@/lib/domain/invoice";
import { mapSquarePaymentStatus } from "@/lib/domain/square";
import {
  cancelTerminalCheckout,
  createSquarePayment,
  createSquareRefund,
  createTerminalCheckout,
  getSquareConfig,
  getTerminalCheckout,
} from "@/lib/square/client";
import {
  settleTerminalCheckout,
  type SquareSettleOutcome,
} from "@/lib/square/ledger";
import { squareCardPaymentSchema } from "@/lib/schemas/billing";

export interface BillingResult {
  ok: boolean;
  id?: string;
  error?: string;
}

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Recompute paid/balance/status of an invoice from confirmed allocations.
 * IMPORTANT: the allocation sum must run on the SAME executor (`db`) — when
 * called inside a transaction, a separate pooled connection cannot see the
 * uncommitted allocation rows and would compute a stale total.
 */
async function recomputeInvoice(
  db: Db | Tx,
  organizationId: string,
  invoiceId: string,
) {
  const [inv] = await db
    .select()
    .from(invoices)
    .where(
      and(eq(invoices.organizationId, organizationId), eq(invoices.id, invoiceId)),
    )
    .limit(1);
  if (!inv) return;

  const { sql } = await import("drizzle-orm");
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
  const allocated = Number(row?.total ?? 0);
  const status = deriveInvoiceStatus({
    issued: inv.invoiceNumber !== null,
    voided: inv.status === "void",
    fullyRefunded: false,
    totalCents: inv.totalCents,
    allocatedCents: allocated,
    dueDate: inv.dueDate,
  });
  await db
    .update(invoices)
    .set({
      paidCents: allocated,
      balanceCents: balanceCents(inv.totalCents, allocated),
      status,
      updatedAt: new Date(),
    })
    .where(eq(invoices.id, invoiceId));
}

/**
 * Next receipt number, taken under a row lock on company_settings so two
 * concurrent payments cannot be handed the same one. Must run inside the same
 * transaction as the receipt insert, or the number is reserved and lost.
 */
async function nextReceiptNumber(tx: Tx, organizationId: string): Promise<string> {
  const [settings] = await tx
    .select()
    .from(companySettings)
    .where(eq(companySettings.organizationId, organizationId))
    .for("update")
    .limit(1);
  if (!settings) throw new Error("Company settings not found.");

  const seq = settings.receiptNextSequence;
  await tx
    .update(companySettings)
    .set({ receiptNextSequence: seq + 1, updatedAt: new Date() })
    .where(eq(companySettings.organizationId, organizationId));
  return formatReceiptNumber(settings.receiptNumberPrefix ?? "REC-", seq);
}

/** FR-INV-001: create a draft invoice with frozen line totals. */
export async function createInvoiceAction(raw: unknown): Promise<BillingResult> {
  const user = await authorize("invoices_payments", "create");
  const parsed = createInvoiceSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const org = await getPrimaryOrganization();
  if (!org) return { ok: false, error: "Organization not found." };

  const totals = computeInvoiceTotals(parsed.data.items);
  const db = getDb();

  const created = await db.transaction(async (tx) => {
    const [inv] = await tx
      .insert(invoices)
      .values({
        organizationId: org.id,
        patientId: parsed.data.patientId,
        status: "draft",
        language: parsed.data.language,
        notes: parsed.data.notes || null,
        dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
        subtotalCents: totals.subtotalCents,
        discountCents: totals.discountCents,
        taxCents: totals.taxCents,
        totalCents: totals.totalCents,
        balanceCents: totals.totalCents,
        currency: org.currency,
      })
      .returning();
    for (const item of parsed.data.items) {
      const gross = item.quantity * item.unitPriceCents;
      const net = Math.max(0, gross - (item.discountCents ?? 0));
      const lineTotal = net + Math.round((net * (item.taxRateBps ?? 0)) / 10000);
      await tx.insert(invoiceItems).values({
        organizationId: org.id,
        invoiceId: inv.id,
        description: item.description,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        discountCents: item.discountCents ?? 0,
        taxRateBps: item.taxRateBps ?? 0,
        lineTotalCents: lineTotal,
        serviceId: item.serviceId ?? null,
      });
    }
    return inv;
  });

  await recordAudit({
    organizationId: org.id,
    actorUserId: user.authId,
    action: "create",
    entityType: "invoice",
    entityId: created.id,
    after: { status: "draft", total: totals.totalCents },
  });

  revalidatePath("/billing");
  return { ok: true, id: created.id };
}

/**
 * Edit a pre-invoice while it is still a draft (spec §7.1): rewrite the
 * lines, notes and language, recomputing the totals. Refused once issued —
 * corrections after issuing go through void / credit note.
 */
export async function updateInvoiceDraftAction(
  invoiceId: string,
  raw: unknown,
): Promise<BillingResult> {
  const user = await authorize("invoices_payments", "update");
  const parsed = updateInvoiceDraftSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const org = await getPrimaryOrganization();
  if (!org) return { ok: false, error: "Organization not found." };

  const db = getDb();
  const [inv] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.organizationId, org.id), eq(invoices.id, invoiceId)))
    .limit(1);
  if (!inv) return { ok: false, error: "Invoice not found." };
  if (inv.status !== "draft" || inv.invoiceNumber) {
    return { ok: false, error: "Only a draft pre-invoice can be edited." };
  }

  const totals = computeInvoiceTotals(parsed.data.items);

  await db.transaction(async (tx) => {
    await tx.delete(invoiceItems).where(eq(invoiceItems.invoiceId, invoiceId));
    for (const item of parsed.data.items) {
      const gross = item.quantity * item.unitPriceCents;
      const net = Math.max(0, gross - (item.discountCents ?? 0));
      const lineTotal = net + Math.round((net * (item.taxRateBps ?? 0)) / 10000);
      await tx.insert(invoiceItems).values({
        organizationId: org.id,
        invoiceId,
        description: item.description,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        discountCents: item.discountCents ?? 0,
        taxRateBps: item.taxRateBps ?? 0,
        lineTotalCents: lineTotal,
        serviceId: item.serviceId ?? null,
      });
    }
    await tx
      .update(invoices)
      .set({
        language: parsed.data.language,
        notes: parsed.data.notes || null,
        subtotalCents: totals.subtotalCents,
        discountCents: totals.discountCents,
        taxCents: totals.taxCents,
        totalCents: totals.totalCents,
        balanceCents: totals.totalCents,
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, invoiceId));
  });

  await recordAudit({
    organizationId: org.id,
    actorUserId: user.authId,
    action: "update",
    entityType: "invoice",
    entityId: invoiceId,
    before: { totalCents: inv.totalCents },
    after: { totalCents: totals.totalCents, items: parsed.data.items.length },
  });

  revalidatePath(`/billing/${invoiceId}`);
  revalidatePath("/billing");
  return { ok: true, id: invoiceId };
}

/** FR-INV-002: issue a draft — assign an immutable sequential number. */
export async function issueInvoiceAction(invoiceId: string): Promise<BillingResult> {
  const user = await authorize("invoices_payments", "update");
  const org = await getPrimaryOrganization();
  if (!org) return { ok: false, error: "Organization not found." };

  const db = getDb();
  let assignedNumber = "";
  try {
    await db.transaction(async (tx) => {
      const [inv] = await tx
        .select()
        .from(invoices)
        .where(
          and(eq(invoices.organizationId, org.id), eq(invoices.id, invoiceId)),
        )
        .limit(1);
      if (!inv) throw new Error("Invoice not found.");
      if (inv.status !== "draft" || inv.invoiceNumber) {
        throw new Error("Only a draft invoice can be issued.");
      }

      // Lock settings row to serialize numbering (no duplicates/gaps).
      const [settings] = await tx
        .select()
        .from(companySettings)
        .where(eq(companySettings.organizationId, org.id))
        .for("update")
        .limit(1);
      if (!settings) throw new Error("Company settings not found.");

      const seq = settings.invoiceNextSequence;
      assignedNumber = formatInvoiceNumber(
        settings.invoiceNumberPrefix ?? "INV-",
        seq,
      );

      const items = await tx
        .select()
        .from(invoiceItems)
        .where(eq(invoiceItems.invoiceId, invoiceId));

      // Freeze who this was billed to as well as what for: an address or a
      // company phone that changes next year must not rewrite a document the
      // patient already holds (§FR-INV-004).
      const [billTo] = await tx
        .select()
        .from(patients)
        .where(eq(patients.id, inv.patientId))
        .limit(1);

      const now = new Date();
      await tx
        .update(companySettings)
        .set({ invoiceNextSequence: seq + 1, updatedAt: now })
        .where(eq(companySettings.organizationId, org.id));

      await tx
        .update(invoices)
        .set({
          invoiceNumber: assignedNumber,
          status: "issued",
          issueDate: now,
          issuedAt: now,
          // Frozen printable snapshot (§FR-INV-004).
          snapshot: {
            invoiceNumber: assignedNumber,
            issuedAt: now.toISOString(),
            notes: inv.notes,
            company: {
              legalName: org.legalName,
              operatingName: org.operatingName,
              currency: org.currency,
              address: settings.address,
              phone: settings.phone,
              email: settings.email,
              website: settings.website,
            },
            billTo: billTo
              ? {
                  patientNumber: billTo.patientNumber,
                  name: `${billTo.legalFirstName} ${billTo.legalLastName}`,
                  email: billTo.email,
                  phone: billTo.phoneE164,
                  address: billTo.address,
                }
              : null,
            legalFooter:
              inv.language === "es"
                ? settings.legalFooterEs
                : settings.legalFooterEn,
            totals: {
              subtotalCents: inv.subtotalCents,
              discountCents: inv.discountCents,
              taxCents: inv.taxCents,
              totalCents: inv.totalCents,
            },
            items: items.map((i) => ({
              description: i.description,
              quantity: i.quantity,
              unitPriceCents: i.unitPriceCents,
              lineTotalCents: i.lineTotalCents,
            })),
          },
          updatedAt: now,
        })
        .where(eq(invoices.id, invoiceId));
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Issue failed." };
  }

  await recordAudit({
    organizationId: org.id,
    actorUserId: user.authId,
    action: "issue",
    entityType: "invoice",
    entityId: invoiceId,
    after: { invoiceNumber: assignedNumber, status: "issued" },
  });

  revalidatePath(`/billing/${invoiceId}`);
  return { ok: true, id: invoiceId };
}

/** FR-PAY-001: record a payment. E-transfers start pending until verified. */
export async function recordPaymentAction(raw: unknown): Promise<BillingResult> {
  const user = await authorize("invoices_payments", "create");
  const parsed = recordPaymentSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const org = await getPrimaryOrganization();
  if (!org) return { ok: false, error: "Organization not found." };

  const needsVerification = parsed.data.method === "e_transfer";
  const db = getDb();
  const [created] = await db
    .insert(payments)
    .values({
      organizationId: org.id,
      patientId: parsed.data.patientId,
      method: parsed.data.method,
      status: needsVerification ? "pending" : "confirmed",
      amountCents: parsed.data.amountCents,
      currency: org.currency,
      receivedBy: user.dbUserId,
      reference: parsed.data.reference ?? null,
      etransferSenderName: parsed.data.etransferSenderName ?? null,
      etransferSenderEmail: parsed.data.etransferSenderEmail || null,
    })
    .returning();

  await recordAudit({
    organizationId: org.id,
    actorUserId: user.authId,
    action: "payment",
    entityType: "payment",
    entityId: created.id,
    after: { method: created.method, amount: created.amountCents, status: created.status },
  });

  revalidatePath("/billing");
  return { ok: true, id: created.id };
}

/**
 * One-step "Pay" for the front desk (spec §13 usability rule): records the
 * payment for the invoice's open balance, and for instantly-confirmed methods
 * (cash) also applies it and issues the receipt in the same transaction.
 * E-transfers stay pending, remembering the target invoice; verifying them
 * auto-applies and receipts. `square_card` is reserved for the future Square
 * integration (webhook scaffolding already exists) and is rejected for now.
 */
export async function payInvoiceAction(
  invoiceId: string,
  raw: unknown,
): Promise<BillingResult> {
  const user = await authorize("invoices_payments", "create");
  const { z } = await import("zod");
  const schema = z.object({
    method: z.enum(["cash", "e_transfer", "square_card"]),
    etransferSenderName: z.string().trim().max(200).optional().or(z.literal("")),
    etransferSenderEmail: z
      .string()
      .trim()
      .email()
      .max(255)
      .optional()
      .or(z.literal("")),
    reference: z.string().trim().max(120).optional().or(z.literal("")),
  });
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  if (parsed.data.method === "square_card") {
    // Card payments need the tokenized card from the Web Payments SDK; the UI
    // calls paySquareCardAction with it instead of this generic action.
    return {
      ok: false,
      error: "Card payments must be taken through the card form.",
    };
  }
  const org = await getPrimaryOrganization();
  if (!org) return { ok: false, error: "Organization not found." };

  const db = getDb();
  const [invoice] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.organizationId, org.id), eq(invoices.id, invoiceId)))
    .limit(1);
  if (!invoice) return { ok: false, error: "Invoice not found." };
  if (!["issued", "partially_paid", "overdue"].includes(invoice.status)) {
    return { ok: false, error: "Only a confirmed (issued) invoice can be paid." };
  }
  if (invoice.balanceCents <= 0) {
    return { ok: false, error: "This invoice has no open balance." };
  }

  const amount = invoice.balanceCents;

  if (parsed.data.method === "e_transfer") {
    // Pending until someone verifies the transfer arrived at the bank.
    const [created] = await db
      .insert(payments)
      .values({
        organizationId: org.id,
        patientId: invoice.patientId,
        method: "e_transfer",
        status: "pending",
        amountCents: amount,
        currency: invoice.currency,
        receivedBy: user.dbUserId,
        reference: parsed.data.reference || null,
        etransferSenderName: parsed.data.etransferSenderName || null,
        etransferSenderEmail: parsed.data.etransferSenderEmail || null,
        // Remembered so verification can auto-apply to this invoice.
        metadata: { intendedInvoiceId: invoiceId },
      })
      .returning();
    await recordAudit({
      organizationId: org.id,
      actorUserId: user.authId,
      action: "payment",
      entityType: "payment",
      entityId: created.id,
      after: { method: "e_transfer", amount, status: "pending", invoiceId },
    });
    revalidatePath(`/billing/${invoiceId}`);
    revalidatePath("/billing");
    return { ok: true, id: created.id };
  }

  // Cash: confirm, apply and receipt atomically.
  const receiptId = await db.transaction(async (tx) => {
    const [payment] = await tx
      .insert(payments)
      .values({
        organizationId: org.id,
        patientId: invoice.patientId,
        method: "cash",
        status: "confirmed",
        amountCents: amount,
        currency: invoice.currency,
        receivedBy: user.dbUserId,
        reference: parsed.data.reference || null,
      })
      .returning();
    await tx.insert(paymentAllocations).values({
      organizationId: org.id,
      paymentId: payment.id,
      invoiceId,
      amountCents: amount,
    });
    await recomputeInvoice(tx, org.id, invoiceId);
    const [receipt] = await tx
      .insert(receipts)
      .values({
        organizationId: org.id,
        paymentId: payment.id,
        invoiceId,
        receiptNumber: await nextReceiptNumber(tx, org.id),
        amountCents: amount,
        language: invoice.language,
        snapshot: {
          invoiceNumber: invoice.invoiceNumber,
          amountCents: amount,
          currency: invoice.currency,
          method: "cash",
        },
      })
      .returning();
    return receipt.id;
  });

  await recordAudit({
    organizationId: org.id,
    actorUserId: user.authId,
    action: "payment",
    entityType: "payment",
    entityId: invoiceId,
    after: { method: "cash", amount, invoiceId, receiptId, applied: true },
  });

  revalidatePath(`/billing/${invoiceId}`);
  revalidatePath("/billing");
  return { ok: true, id: invoiceId };
}

/**
 * Card payment via Square (§10.1, FR-PAY-001). The browser tokenizes the card
 * with the Web Payments SDK and sends the one-time `sourceId`; this action
 * charges it for the invoice's open balance.
 *
 * Idempotency: the local pending payment row is created FIRST and its UUID is
 * the Square idempotency key — a retry after a crash or timeout can never
 * charge the card twice (NFR-11). If the charge succeeds but this process
 * dies before confirming locally, the webhook confirms and applies the
 * payment (it carries our invoice id in `reference_id`).
 */
export async function paySquareCardAction(
  invoiceId: string,
  raw: unknown,
): Promise<BillingResult> {
  const user = await authorize("invoices_payments", "create");
  const parsed = squareCardPaymentSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  if (!getSquareConfig()) {
    return { ok: false, error: "Square is not configured." };
  }
  const org = await getPrimaryOrganization();
  if (!org) return { ok: false, error: "Organization not found." };

  const db = getDb();
  const [invoice] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.organizationId, org.id), eq(invoices.id, invoiceId)))
    .limit(1);
  if (!invoice) return { ok: false, error: "Invoice not found." };
  if (!["issued", "partially_paid", "overdue"].includes(invoice.status)) {
    return { ok: false, error: "Only a confirmed (issued) invoice can be paid." };
  }
  if (invoice.balanceCents <= 0) {
    return { ok: false, error: "This invoice has no open balance." };
  }

  const amount = invoice.balanceCents;

  // 1. Pending row first — its id anchors idempotency for the charge below.
  const [payment] = await db
    .insert(payments)
    .values({
      organizationId: org.id,
      patientId: invoice.patientId,
      method: "square_card",
      status: "pending",
      amountCents: amount,
      currency: invoice.currency,
      receivedBy: user.dbUserId,
      externalProvider: "square",
      metadata: { intendedInvoiceId: invoiceId },
    })
    .returning();

  // 2. Charge the token.
  const charged = await createSquarePayment({
    sourceId: parsed.data.sourceId,
    amountCents: amount,
    currency: invoice.currency,
    idempotencyKey: payment.id,
    referenceId: invoiceId,
    note: invoice.invoiceNumber ?? undefined,
    verificationToken: parsed.data.verificationToken || undefined,
  });

  if (!charged.ok) {
    await db
      .update(payments)
      .set({
        status: "failed",
        metadata: { intendedInvoiceId: invoiceId, squareError: charged.error },
        updatedAt: new Date(),
      })
      .where(eq(payments.id, payment.id));
    await recordAudit({
      organizationId: org.id,
      actorUserId: user.authId,
      action: "payment",
      entityType: "payment",
      entityId: payment.id,
      after: { method: "square_card", amount, status: "failed", invoiceId },
    });
    revalidatePath(`/billing/${invoiceId}`);
    revalidatePath("/billing");
    return { ok: false, error: charged.error };
  }

  const sq = charged.value;
  const status = mapSquarePaymentStatus(sq.status);

  // 3. Record the outcome; when captured, apply + receipt atomically (as cash).
  await db.transaction(async (tx) => {
    await tx
      .update(payments)
      .set({ status, externalId: sq.squarePaymentId, updatedAt: new Date() })
      .where(eq(payments.id, payment.id));

    await tx
      .insert(squareTransactions)
      .values({
        organizationId: org.id,
        squarePaymentId: sq.squarePaymentId,
        squareOrderId: sq.squareOrderId,
        squareCustomerId: sq.squareCustomerId,
        status: sq.status,
        amountCents: sq.amountCents,
        tender: sq.sourceType,
        paymentId: payment.id,
        reconciled: status === "confirmed" && sq.amountCents === amount,
        raw: { source: "create_payment", payment: { ...sq } },
      })
      .onConflictDoUpdate({
        target: squareTransactions.squarePaymentId,
        set: {
          status: sq.status,
          paymentId: payment.id,
          reconciled: status === "confirmed" && sq.amountCents === amount,
          updatedAt: new Date(),
        },
      });

    if (status === "confirmed") {
      // Re-read inside the tx: the balance may have moved since step 1; any
      // surplus stays as an unapplied confirmed payment (manual allocation).
      const [inv] = await tx
        .select()
        .from(invoices)
        .where(
          and(eq(invoices.organizationId, org.id), eq(invoices.id, invoiceId)),
        )
        .limit(1);
      const applied = inv ? Math.min(amount, inv.balanceCents) : 0;
      if (inv && applied > 0) {
        await tx.insert(paymentAllocations).values({
          organizationId: org.id,
          paymentId: payment.id,
          invoiceId,
          amountCents: applied,
        });
        await recomputeInvoice(tx, org.id, invoiceId);
        await tx.insert(receipts).values({
          organizationId: org.id,
          paymentId: payment.id,
          invoiceId,
          receiptNumber: await nextReceiptNumber(tx, org.id),
          amountCents: applied,
          language: inv.language,
          snapshot: {
            invoiceNumber: inv.invoiceNumber,
            amountCents: applied,
            currency: inv.currency,
            method: "square_card",
            squarePaymentId: sq.squarePaymentId,
          },
        });
      }
    }
  });

  await recordAudit({
    organizationId: org.id,
    actorUserId: user.authId,
    action: "payment",
    entityType: "payment",
    entityId: payment.id,
    after: {
      method: "square_card",
      amount,
      status,
      invoiceId,
      squarePaymentId: sq.squarePaymentId,
    },
  });

  revalidatePath(`/billing/${invoiceId}`);
  revalidatePath("/billing");

  if (status === "failed" || status === "cancelled") {
    return { ok: false, error: "The card payment did not complete." };
  }
  return { ok: true, id: payment.id };
}

export interface TerminalPaymentResult {
  ok: boolean;
  /** Local payment id, for polling. */
  id?: string;
  /** Settled state of the terminal payment after this call. */
  status?: SquareSettleOutcome;
  error?: string;
}

/** Collapse a payment_status onto the settle outcomes the terminal UI shows. */
function toSettleOutcome(status: string): SquareSettleOutcome {
  if (status === "pending") return "pending";
  if (status === "cancelled") return "cancelled";
  if (status === "failed") return "failed";
  return "confirmed"; // confirmed and any refund state mean the charge stood
}

/**
 * Card-present payment on the Square Terminal (POS) (§10.1). Pushes a
 * checkout for the invoice's open balance to the paired device; the patient
 * pays there. Completion arrives via the terminal.checkout.updated webhook
 * and via checkTerminalPaymentAction polling — both settle idempotently.
 *
 * Idempotency mirrors the card flow: the local pending payment row goes
 * first and its UUID is the Square idempotency key; the returned checkout id
 * is anchored in payments.reference so webhook/polling can always match it.
 */
export async function payTerminalAction(
  invoiceId: string,
): Promise<TerminalPaymentResult> {
  const user = await authorize("invoices_payments", "create");
  const config = getSquareConfig();
  if (!config?.terminalDeviceId) {
    return { ok: false, error: "No Square Terminal is configured." };
  }
  const org = await getPrimaryOrganization();
  if (!org) return { ok: false, error: "Organization not found." };

  const db = getDb();
  const [invoice] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.organizationId, org.id), eq(invoices.id, invoiceId)))
    .limit(1);
  if (!invoice) return { ok: false, error: "Invoice not found." };
  if (!["issued", "partially_paid", "overdue"].includes(invoice.status)) {
    return { ok: false, error: "Only a confirmed (issued) invoice can be paid." };
  }
  if (invoice.balanceCents <= 0) {
    return { ok: false, error: "This invoice has no open balance." };
  }

  const amount = invoice.balanceCents;

  const [payment] = await db
    .insert(payments)
    .values({
      organizationId: org.id,
      patientId: invoice.patientId,
      method: "square_card",
      status: "pending",
      amountCents: amount,
      currency: invoice.currency,
      receivedBy: user.dbUserId,
      externalProvider: "square",
      metadata: { intendedInvoiceId: invoiceId, channel: "terminal" },
    })
    .returning();

  const pushed = await createTerminalCheckout({
    amountCents: amount,
    currency: invoice.currency,
    idempotencyKey: payment.id,
    referenceId: invoiceId,
    note: invoice.invoiceNumber ?? undefined,
  });

  if (!pushed.ok) {
    await db
      .update(payments)
      .set({
        status: "failed",
        metadata: {
          intendedInvoiceId: invoiceId,
          channel: "terminal",
          squareError: pushed.error,
        },
        updatedAt: new Date(),
      })
      .where(eq(payments.id, payment.id));
    return { ok: false, error: pushed.error };
  }

  // Anchor the checkout id so webhook and polling can match this payment.
  await db
    .update(payments)
    .set({ reference: pushed.value.checkoutId, updatedAt: new Date() })
    .where(eq(payments.id, payment.id));

  await recordAudit({
    organizationId: org.id,
    actorUserId: user.authId,
    action: "payment",
    entityType: "payment",
    entityId: payment.id,
    after: {
      method: "square_card",
      channel: "terminal",
      amount,
      status: "pending",
      invoiceId,
      terminalCheckoutId: pushed.value.checkoutId,
    },
  });

  revalidatePath(`/billing/${invoiceId}`);
  revalidatePath("/billing");
  return { ok: true, id: payment.id, status: "pending" };
}

/**
 * Poll a terminal payment: fetches the checkout from Square and settles the
 * local ledger (confirm + apply + receipt, or cancel). Safe to call
 * repeatedly and concurrently with the webhook — settlement is guarded.
 */
export async function checkTerminalPaymentAction(
  paymentId: string,
): Promise<TerminalPaymentResult> {
  await authorize("invoices_payments", "create");
  const org = await getPrimaryOrganization();
  if (!org) return { ok: false, error: "Organization not found." };

  const db = getDb();
  const [payment] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.organizationId, org.id), eq(payments.id, paymentId)))
    .limit(1);
  if (!payment || payment.externalProvider !== "square") {
    return { ok: false, error: "Terminal payment not found." };
  }
  if (payment.status !== "pending") {
    return { ok: true, id: payment.id, status: toSettleOutcome(payment.status) };
  }
  if (!payment.reference) {
    return { ok: false, error: "This payment has no terminal checkout." };
  }

  const fetched = await getTerminalCheckout(payment.reference);
  if (!fetched.ok) return { ok: false, error: fetched.error };

  const outcome = await db.transaction((tx) =>
    settleTerminalCheckout(tx, fetched.value),
  );
  if (outcome !== "pending") {
    const invoiceId =
      (payment.metadata as { intendedInvoiceId?: string } | null)
        ?.intendedInvoiceId ?? null;
    if (invoiceId) revalidatePath(`/billing/${invoiceId}`);
    revalidatePath("/billing");
  }
  return { ok: true, id: payment.id, status: outcome };
}

/**
 * Cancel an in-flight terminal checkout (e.g. the patient changed their
 * mind). If the device already completed it, the completion wins and this
 * settles the payment instead.
 */
export async function cancelTerminalPaymentAction(
  paymentId: string,
): Promise<TerminalPaymentResult> {
  const user = await authorize("invoices_payments", "create");
  const org = await getPrimaryOrganization();
  if (!org) return { ok: false, error: "Organization not found." };

  const db = getDb();
  const [payment] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.organizationId, org.id), eq(payments.id, paymentId)))
    .limit(1);
  if (!payment || payment.externalProvider !== "square" || !payment.reference) {
    return { ok: false, error: "Terminal payment not found." };
  }
  if (payment.status !== "pending") {
    return { ok: true, id: payment.id, status: toSettleOutcome(payment.status) };
  }

  const cancelled = await cancelTerminalCheckout(payment.reference);
  if (!cancelled.ok) {
    // Cancellation races completion — re-check and settle whatever Square says.
    return checkTerminalPaymentAction(paymentId);
  }

  const outcome = await db.transaction((tx) =>
    settleTerminalCheckout(tx, cancelled.value),
  );

  await recordAudit({
    organizationId: org.id,
    actorUserId: user.authId,
    action: "payment",
    entityType: "payment",
    entityId: payment.id,
    after: { method: "square_card", channel: "terminal", status: outcome },
  });

  const invoiceId =
    (payment.metadata as { intendedInvoiceId?: string } | null)
      ?.intendedInvoiceId ?? null;
  if (invoiceId) revalidatePath(`/billing/${invoiceId}`);
  revalidatePath("/billing");
  return { ok: true, id: payment.id, status: outcome };
}

/** FR-PAY-002: apply a payment to an invoice with guardrails. */
export async function allocatePaymentAction(raw: unknown): Promise<BillingResult> {
  const user = await authorize("invoices_payments", "update");
  const parsed = allocateSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const org = await getPrimaryOrganization();
  if (!org) return { ok: false, error: "Organization not found." };

  const db = getDb();
  const [payment] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.organizationId, org.id), eq(payments.id, parsed.data.paymentId)))
    .limit(1);
  if (!payment) return { ok: false, error: "Payment not found." };
  if (payment.status !== "confirmed") {
    return { ok: false, error: "Only confirmed payments can be allocated." };
  }
  const [invoice] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.organizationId, org.id), eq(invoices.id, parsed.data.invoiceId)))
    .limit(1);
  if (!invoice) return { ok: false, error: "Invoice not found." };

  const alreadyFromPayment = await paymentAllocatedCents(payment.id);
  const guard = canAllocate({
    proposedCents: parsed.data.amountCents,
    paymentAmountCents: payment.amountCents,
    alreadyAllocatedFromPaymentCents: alreadyFromPayment,
    invoiceBalanceCents: invoice.balanceCents,
  });
  if (!guard.ok) return { ok: false, error: guard.reason };

  await db.transaction(async (tx) => {
    await tx.insert(paymentAllocations).values({
      organizationId: org.id,
      paymentId: payment.id,
      invoiceId: invoice.id,
      amountCents: parsed.data.amountCents,
    });
    await recomputeInvoice(tx, org.id, invoice.id);
  });

  await recordAudit({
    organizationId: org.id,
    actorUserId: user.authId,
    action: "allocation",
    entityType: "payment_allocation",
    entityId: invoice.id,
    after: { paymentId: payment.id, amount: parsed.data.amountCents },
  });

  revalidatePath(`/billing/${invoice.id}`);
  return { ok: true, id: invoice.id };
}

/** FR-PAY-003: verify an e-transfer (records verifier + timestamp). */
export async function verifyEtransferAction(paymentId: string): Promise<BillingResult> {
  const user = await authorize("invoices_payments", "update");
  const org = await getPrimaryOrganization();
  if (!org) return { ok: false, error: "Organization not found." };

  const db = getDb();
  const [payment] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.organizationId, org.id), eq(payments.id, paymentId)))
    .limit(1);
  if (!payment) return { ok: false, error: "Payment not found." };
  if (payment.method !== "e_transfer" || payment.status !== "pending") {
    return { ok: false, error: "Only pending e-transfers can be verified." };
  }

  // Confirm, and when the payment was taken via the invoice Pay flow,
  // auto-apply it to that invoice and issue the receipt.
  const intendedInvoiceId =
    (payment.metadata as { intendedInvoiceId?: string } | null)
      ?.intendedInvoiceId ?? null;

  await db.transaction(async (tx) => {
    await tx
      .update(payments)
      .set({
        status: "confirmed",
        verifiedBy: user.dbUserId,
        verifiedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(payments.id, paymentId));

    if (intendedInvoiceId) {
      const [invoice] = await tx
        .select()
        .from(invoices)
        .where(
          and(
            eq(invoices.organizationId, org.id),
            eq(invoices.id, intendedInvoiceId),
          ),
        )
        .limit(1);
      if (invoice && invoice.balanceCents > 0) {
        const applied = Math.min(payment.amountCents, invoice.balanceCents);
        await tx.insert(paymentAllocations).values({
          organizationId: org.id,
          paymentId,
          invoiceId: intendedInvoiceId,
          amountCents: applied,
        });
        await recomputeInvoice(tx, org.id, intendedInvoiceId);
        await tx.insert(receipts).values({
          organizationId: org.id,
          paymentId,
          invoiceId: intendedInvoiceId,
          receiptNumber: await nextReceiptNumber(tx, org.id),
          amountCents: applied,
          language: invoice.language,
          snapshot: {
            invoiceNumber: invoice.invoiceNumber,
            amountCents: applied,
            currency: invoice.currency,
            method: "e_transfer",
          },
        });
      }
    }
  });

  await recordAudit({
    organizationId: org.id,
    actorUserId: user.authId,
    action: "payment",
    entityType: "payment",
    entityId: paymentId,
    before: { status: "pending" },
    after: {
      status: "confirmed",
      verified: true,
      autoAppliedTo: intendedInvoiceId,
    },
  });

  if (intendedInvoiceId) revalidatePath(`/billing/${intendedInvoiceId}`);
  revalidatePath("/billing");
  return { ok: true, id: paymentId };
}

/** FR-REC-001: generate a receipt for confirmed allocations of an invoice. */
export async function generateReceiptAction(invoiceId: string): Promise<BillingResult> {
  const user = await authorize("invoices_payments", "create");
  const org = await getPrimaryOrganization();
  if (!org) return { ok: false, error: "Organization not found." };

  const db = getDb();
  const [invoice] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.organizationId, org.id), eq(invoices.id, invoiceId)))
    .limit(1);
  if (!invoice) return { ok: false, error: "Invoice not found." };

  const allocs = await db
    .select({ amountCents: paymentAllocations.amountCents })
    .from(paymentAllocations)
    .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
    .where(
      and(
        eq(paymentAllocations.invoiceId, invoiceId),
        eq(payments.status, "confirmed"),
      ),
    );
  const amount = receiptableCents(allocs.map((a) => a.amountCents));
  if (amount <= 0) {
    return { ok: false, error: "No confirmed payments to receipt." };
  }

  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(receipts)
      .values({
        organizationId: org.id,
        paymentId: null, // invoice-level aggregate receipt
        invoiceId,
        receiptNumber: await nextReceiptNumber(tx, org.id),
        amountCents: amount,
        language: invoice.language,
        snapshot: {
          invoiceNumber: invoice.invoiceNumber,
          amountCents: amount,
          currency: invoice.currency,
        },
      })
      .returning();
    return row;
  });

  await recordAudit({
    organizationId: org.id,
    actorUserId: user.authId,
    action: "create",
    entityType: "receipt",
    entityId: created.id,
    after: { invoiceId, amount },
  });

  revalidatePath(`/billing/${invoiceId}`);
  return { ok: true, id: created.id };
}

/** FR-INV-003: void an issued invoice (kept, never deleted). */
export async function voidInvoiceAction(
  invoiceId: string,
  raw: unknown,
): Promise<BillingResult> {
  const user = await authorize("invoices_payments", "update");
  const parsed = voidInvoiceSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Reason required" };
  }
  const org = await getPrimaryOrganization();
  if (!org) return { ok: false, error: "Organization not found." };

  const db = getDb();
  await db
    .update(invoices)
    .set({ status: "void", voidedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(invoices.organizationId, org.id), eq(invoices.id, invoiceId)));

  await recordAudit({
    organizationId: org.id,
    actorUserId: user.authId,
    action: "void",
    entityType: "invoice",
    entityId: invoiceId,
    reason: parsed.data.reason,
    after: { status: "void" },
  });

  revalidatePath(`/billing/${invoiceId}`);
  return { ok: true, id: invoiceId };
}

/** FR-REF-001: refund a payment (linked to the original, never deleted). */
export async function refundAction(raw: unknown): Promise<BillingResult> {
  const user = await authorize("invoices_payments", "update");
  const parsed = refundSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const org = await getPrimaryOrganization();
  if (!org) return { ok: false, error: "Organization not found." };

  const db = getDb();
  const [payment] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.organizationId, org.id), eq(payments.id, parsed.data.paymentId)))
    .limit(1);
  if (!payment) return { ok: false, error: "Payment not found." };

  const already = await paymentRefundedCents(payment.id);
  const guard = canRefund({
    proposedCents: parsed.data.amountCents,
    paymentAmountCents: payment.amountCents,
    alreadyRefundedCents: already,
  });
  if (!guard.ok) return { ok: false, error: guard.reason };

  // Card payments taken via Square must be refunded at Square too (§10.1).
  const isSquare = payment.externalProvider === "square" && !!payment.externalId;
  if (isSquare && !getSquareConfig()) {
    return {
      ok: false,
      error: "Square is not configured — this card payment cannot be refunded.",
    };
  }

  // The local row goes first: its UUID is the Square idempotency key, so a
  // retried request can never refund the card twice (NFR-11).
  const [refundRow] = await db
    .insert(refunds)
    .values({
      organizationId: org.id,
      paymentId: payment.id,
      amountCents: parsed.data.amountCents,
      reason: parsed.data.reason,
      processedBy: user.dbUserId,
      externalProvider: isSquare ? "square" : null,
    })
    .returning();

  let squareRefundId: string | null = null;
  if (isSquare) {
    const result = await createSquareRefund({
      squarePaymentId: payment.externalId!,
      amountCents: parsed.data.amountCents,
      currency: payment.currency,
      idempotencyKey: refundRow.id,
      reason: parsed.data.reason,
    });
    if (!result.ok) {
      // Square rejected it — no money moved, so the anchor row is removed to
      // keep the ledger identical to Square. (A crash before this leaves the
      // row with external_id NULL, which reconciliation surfaces.)
      await db.delete(refunds).where(eq(refunds.id, refundRow.id));
      return { ok: false, error: result.error };
    }
    squareRefundId = result.value.refundId;
    await db
      .update(refunds)
      .set({ externalId: squareRefundId, updatedAt: new Date() })
      .where(eq(refunds.id, refundRow.id));
  }

  const newRefunded = already + parsed.data.amountCents;
  await db
    .update(payments)
    .set({
      status: derivePaymentStatus(payment.amountCents, newRefunded),
      updatedAt: new Date(),
    })
    .where(eq(payments.id, payment.id));

  await recordAudit({
    organizationId: org.id,
    actorUserId: user.authId,
    action: "refund",
    entityType: "payment",
    entityId: payment.id,
    reason: parsed.data.reason,
    after: { amount: parsed.data.amountCents, squareRefundId },
  });

  revalidatePath("/billing");
  return { ok: true, id: payment.id };
}

/** FR-REF-001: issue a credit note against an invoice. */
export async function creditNoteAction(raw: unknown): Promise<BillingResult> {
  const user = await authorize("invoices_payments", "update");
  const parsed = creditNoteSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const org = await getPrimaryOrganization();
  if (!org) return { ok: false, error: "Organization not found." };

  const db = getDb();
  const [created] = await db
    .insert(creditNotes)
    .values({
      organizationId: org.id,
      invoiceId: parsed.data.invoiceId,
      amountCents: parsed.data.amountCents,
      reason: parsed.data.reason,
      issuedBy: user.dbUserId,
    })
    .returning();

  await recordAudit({
    organizationId: org.id,
    actorUserId: user.authId,
    action: "refund",
    entityType: "credit_note",
    entityId: created.id,
    reason: parsed.data.reason,
    after: { invoiceId: parsed.data.invoiceId, amount: parsed.data.amountCents },
  });

  revalidatePath(`/billing/${parsed.data.invoiceId}`);
  return { ok: true, id: created.id };
}
