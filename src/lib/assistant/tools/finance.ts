import { and, desc, eq, gte, lt, ne } from "drizzle-orm";
import { z } from "zod";
import { recordAccess } from "@/lib/audit/record";
import { getDb } from "@/lib/db";
import {
  invoiceItems,
  invoices,
  paymentAllocations,
  payments,
  patients,
} from "@/lib/db/schema";
import { planRead } from "../policy/scope";
import { dateSpecSchema, resolveDate } from "./resolve-date";
import type { AssistantTool, ToolContext } from "./types";

/**
 * Money in detail.
 *
 * `aggregate` answers how much; these answer which ones and what happened.
 * Amounts stay in cents throughout — formatting is the client's job, and a
 * float here is a rounding error waiting to be reported as fact.
 */

const invoiceInput = z.object({ invoiceId: z.uuid() });

export const getInvoiceTool: AssistantTool<z.infer<typeof invoiceInput>, unknown> = {
  name: "get_invoice",
  description:
    "One invoice in full: its lines, totals, what has been paid against it and what is " +
    "still open. Use it for 'what is on invoice VIC-01002', 'why does she owe that much'.",
  resource: "invoices_payments",
  action: "read",
  input: invoiceInput,

  async execute(args, ctx: ToolContext) {
    const plan = planRead(ctx.principal, "invoices_payments");
    if (plan.mode === "denied") return { refused: true, reason: plan.reason };

    const db = getDb();
    const [invoice] = await db
      .select({
        id: invoices.id,
        number: invoices.invoiceNumber,
        status: invoices.status,
        issueDate: invoices.issueDate,
        dueDate: invoices.dueDate,
        subtotal: invoices.subtotalCents,
        discount: invoices.discountCents,
        tax: invoices.taxCents,
        total: invoices.totalCents,
        paid: invoices.paidCents,
        balance: invoices.balanceCents,
        currency: invoices.currency,
        notes: invoices.notes,
        patientId: invoices.patientId,
        patientFirst: patients.legalFirstName,
        patientLast: patients.legalLastName,
      })
      .from(invoices)
      .innerJoin(patients, eq(patients.id, invoices.patientId))
      .where(
        and(
          eq(invoices.id, args.invoiceId),
          eq(invoices.organizationId, ctx.principal.organizationId),
        ),
      )
      .limit(1);

    if (!invoice) return { found: false, reason: "No such invoice is available to you." };

    const [lines, applied] = await Promise.all([
      db
        .select({
          description: invoiceItems.description,
          quantity: invoiceItems.quantity,
          unitPrice: invoiceItems.unitPriceCents,
          discount: invoiceItems.discountCents,
          taxRateBps: invoiceItems.taxRateBps,
        })
        .from(invoiceItems)
        .where(eq(invoiceItems.invoiceId, invoice.id)),
      db
        .select({
          amount: paymentAllocations.amountCents,
          method: payments.method,
          status: payments.status,
          receivedAt: payments.receivedAt,
        })
        .from(paymentAllocations)
        .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
        .where(eq(paymentAllocations.invoiceId, invoice.id)),
    ]);

    if (plan.identifiable) {
      await recordAccess({
        organizationId: ctx.principal.organizationId,
        actorUserId: ctx.principal.dbUserId,
        patientId: invoice.patientId,
        action: "assistant_read",
        route: "assistant:get_invoice",
        purpose: "Assistant read an invoice",
      });
    }

    return {
      found: true,
      invoiceId: invoice.id,
      number: invoice.number,
      status: invoice.status,
      // Only a role that may see identities learns whose invoice it is.
      patient: plan.identifiable
        ? `${invoice.patientFirst} ${invoice.patientLast}`.trim()
        : undefined,
      patientId: plan.identifiable ? invoice.patientId : undefined,
      issueDate: invoice.issueDate?.toISOString() ?? null,
      dueDate: invoice.dueDate?.toISOString() ?? null,
      currency: invoice.currency,
      amountsInCents: {
        subtotal: invoice.subtotal,
        discount: invoice.discount,
        tax: invoice.tax,
        total: invoice.total,
        paid: invoice.paid,
        balance: invoice.balance,
      },
      notes: invoice.notes ?? undefined,
      lines: lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unitPriceCents: l.unitPrice,
        discountCents: l.discount,
        taxRatePercent: l.taxRateBps / 100,
      })),
      payments: applied.map((p) => ({
        amountCents: p.amount,
        method: p.method,
        status: p.status,
        receivedAt: p.receivedAt?.toISOString() ?? null,
      })),
    };
  },
};

const paymentsInput = z.object({
  range: dateSpecSchema.optional(),
  status: z.enum(["pending", "confirmed", "failed", "cancelled", "refunded"]).optional(),
  method: z
    .enum(["cash", "e_transfer", "square_card", "square_invoice", "debit", "credit", "other"])
    .optional(),
  limit: z.int().min(1).max(50).default(25),
});

export const listPaymentsTool: AssistantTool<z.infer<typeof paymentsInput>, unknown> = {
  name: "list_payments",
  description:
    "Payments received, filtered by date range, status or method. Use it for 'what came in " +
    "this week', 'which e-transfers are still unverified', 'show me the cash payments'. " +
    "For totals rather than a list, use aggregate.",
  resource: "invoices_payments",
  action: "read",
  input: paymentsInput,

  async execute(args, ctx: ToolContext) {
    const plan = planRead(ctx.principal, "invoices_payments");
    if (plan.mode === "denied") return { refused: true, reason: plan.reason };

    const db = getDb();
    const conditions = [eq(payments.organizationId, ctx.principal.organizationId)];

    const range = args.range
      ? resolveDate(args.range, ctx.now, ctx.timeZone)
      : undefined;
    if (range) {
      conditions.push(gte(payments.receivedAt, range.from));
      conditions.push(lt(payments.receivedAt, range.to));
    }
    if (args.status) {
      conditions.push(eq(payments.status, args.status));
    }
    if (args.method) {
      conditions.push(eq(payments.method, args.method));
    }

    const rows = await db
      .select({
        id: payments.id,
        amount: payments.amountCents,
        method: payments.method,
        status: payments.status,
        receivedAt: payments.receivedAt,
        reference: payments.reference,
        patientId: payments.patientId,
        patientFirst: patients.legalFirstName,
        patientLast: patients.legalLastName,
      })
      .from(payments)
      .leftJoin(patients, eq(patients.id, payments.patientId))
      .where(and(...conditions))
      .orderBy(desc(payments.receivedAt))
      .limit(args.limit);

    const total = rows.reduce((sum, r) => sum + r.amount, 0);

    if (!plan.identifiable) {
      return {
        count: rows.length,
        totalCents: total,
        note: "This role sees amounts only, without patient identities.",
      };
    }

    await Promise.all(
      [...new Set(rows.map((r) => r.patientId).filter(Boolean))].map((patientId) =>
        recordAccess({
          organizationId: ctx.principal.organizationId,
          actorUserId: ctx.principal.dbUserId,
          patientId: patientId as string,
          action: "assistant_read",
          route: "assistant:list_payments",
          purpose: "Assistant read payments",
        }),
      ),
    );

    return {
      count: rows.length,
      totalCents: total,
      range: range ? { start: range.startDay, end: range.endDay } : "all time",
      payments: rows.map((r) => ({
        paymentId: r.id,
        amountCents: r.amount,
        method: r.method,
        status: r.status,
        receivedAt: r.receivedAt?.toISOString() ?? null,
        reference: r.reference ?? undefined,
        patient:
          r.patientFirst ? `${r.patientFirst} ${r.patientLast}`.trim() : undefined,
        patientId: r.patientId ?? undefined,
      })),
    };
  },
};

const overdueInput = z.object({
  /** Days past due to consider; 0 means anything with a due date in the past. */
  minDaysOverdue: z.int().min(0).max(365).default(0),
  limit: z.int().min(1).max(50).default(25),
});

export const listOverdueInvoicesTool: AssistantTool<z.infer<typeof overdueInput>, unknown> = {
  name: "list_overdue_invoices",
  description:
    "Invoices past their due date with money still owed, oldest first. Use it for " +
    "'who owes us', 'what is overdue', 'chase the late ones'.",
  resource: "invoices_payments",
  action: "read",
  input: overdueInput,

  async execute(args, ctx: ToolContext) {
    const plan = planRead(ctx.principal, "invoices_payments");
    if (plan.mode === "denied") return { refused: true, reason: plan.reason };

    const db = getDb();
    const cutoff = new Date(ctx.now.getTime() - args.minDaysOverdue * 86_400_000);

    const rows = await db
      .select({
        id: invoices.id,
        number: invoices.invoiceNumber,
        balance: invoices.balanceCents,
        dueDate: invoices.dueDate,
        status: invoices.status,
        patientId: invoices.patientId,
        patientFirst: patients.legalFirstName,
        patientLast: patients.legalLastName,
      })
      .from(invoices)
      .innerJoin(patients, eq(patients.id, invoices.patientId))
      .where(
        and(
          eq(invoices.organizationId, ctx.principal.organizationId),
          ne(invoices.status, "draft"),
          ne(invoices.status, "void"),
          ne(invoices.balanceCents, 0),
          lt(invoices.dueDate, cutoff),
        ),
      )
      .orderBy(invoices.dueDate)
      .limit(args.limit);

    const total = rows.reduce((sum, r) => sum + r.balance, 0);
    const days = (d: Date | null) =>
      d ? Math.floor((ctx.now.getTime() - d.getTime()) / 86_400_000) : null;

    if (!plan.identifiable) {
      return { count: rows.length, totalOwedCents: total, note: "Amounts only for this role." };
    }

    return {
      count: rows.length,
      totalOwedCents: total,
      invoices: rows.map((r) => ({
        invoiceId: r.id,
        number: r.number,
        owedCents: r.balance,
        dueDate: r.dueDate?.toISOString() ?? null,
        daysOverdue: days(r.dueDate),
        status: r.status,
        patient: `${r.patientFirst} ${r.patientLast}`.trim(),
        patientId: r.patientId,
      })),
    };
  },
};
