import { z } from "zod";

/** Billing DTOs (spec §6.7). Amounts are integer cents. */

export const invoiceItemSchema = z.object({
  description: z.string().trim().min(1, "Required").max(300),
  quantity: z.number().int().min(1),
  unitPriceCents: z.number().int().min(0),
  discountCents: z.number().int().min(0).optional(),
  taxRateBps: z.number().int().min(0).max(10000).optional(),
  serviceId: z.string().uuid().optional(),
});

export const createInvoiceSchema = z.object({
  patientId: z.string().uuid(),
  language: z.enum(["en", "es"]),
  dueDate: z.string().date().optional(),
  /** One general description for the whole invoice. */
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
  items: z.array(invoiceItemSchema).min(1, "At least one line is required"),
});

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;

/** Editing a pre-invoice: everything but the patient can change while draft. */
export const updateInvoiceDraftSchema = z.object({
  language: z.enum(["en", "es"]),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
  items: z.array(invoiceItemSchema).min(1, "At least one line is required"),
});

export type UpdateInvoiceDraftInput = z.infer<typeof updateInvoiceDraftSchema>;

export const paymentMethod = z.enum([
  "cash",
  "e_transfer",
  "square_card",
  "square_invoice",
  "debit",
  "credit",
  "other",
]);

export const recordPaymentSchema = z.object({
  patientId: z.string().uuid(),
  method: paymentMethod,
  amountCents: z.number().int().positive(),
  reference: z.string().max(120).optional(),
  etransferSenderName: z.string().max(200).optional(),
  etransferSenderEmail: z.string().email().max(255).optional().or(z.literal("")),
});

export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;

/**
 * Card payment via Square (§10.1). `sourceId` is the one-time token produced
 * by the Web Payments SDK in the browser — card data never reaches our server.
 */
export const squareCardPaymentSchema = z.object({
  sourceId: z.string().trim().min(1, "Card token is required").max(500),
  /** SCA/3-D Secure verification token, when the SDK produced one. */
  verificationToken: z.string().trim().max(500).optional().or(z.literal("")),
});

export type SquareCardPaymentInput = z.infer<typeof squareCardPaymentSchema>;

export const allocateSchema = z.object({
  paymentId: z.string().uuid(),
  invoiceId: z.string().uuid(),
  amountCents: z.number().int().positive(),
});

export type AllocateInput = z.infer<typeof allocateSchema>;

export const refundSchema = z.object({
  paymentId: z.string().uuid(),
  amountCents: z.number().int().positive(),
  reason: z.string().trim().min(1, "Reason is required").max(500),
});

export type RefundInput = z.infer<typeof refundSchema>;

export const creditNoteSchema = z.object({
  invoiceId: z.string().uuid(),
  amountCents: z.number().int().positive(),
  reason: z.string().trim().min(1, "Reason is required").max(500),
});

export type CreditNoteInput = z.infer<typeof creditNoteSchema>;

export const voidInvoiceSchema = z.object({
  reason: z.string().trim().min(1, "Reason is required").max(500),
});

export const cashCloseSchema = z.object({
  countedCents: z.number().int().min(0),
});
