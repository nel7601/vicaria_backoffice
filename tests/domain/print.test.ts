import { describe, expect, it } from "vitest";
import {
  buildPrintableInvoice,
  receiptMethodLabel,
  type BuildPrintableInvoiceInput,
} from "@/lib/domain/print";
import { formatReceiptNumber } from "@/lib/domain/invoice";

const company = {
  legalName: "Vicaria Health Inc.",
  operatingName: "Vicaria Health",
  address: "1 King St W, Hamilton ON",
  phone: "+19055550100",
  email: "info@vicaria.ca",
  website: "vicaria.ca",
};

const patient = {
  name: "Ana Ruiz",
  patientNumber: "P-00042",
  address: "22 Main St",
  email: "ana@example.com",
  phone: "+19055550111",
};

function input(
  overrides: Partial<BuildPrintableInvoiceInput["invoice"]> = {},
  rest: Partial<BuildPrintableInvoiceInput> = {},
): BuildPrintableInvoiceInput {
  return {
    invoice: {
      invoiceNumber: "INV-00007",
      status: "issued",
      subtotalCents: 10000,
      discountCents: 0,
      taxCents: 1300,
      totalCents: 11300,
      paidCents: 5000,
      balanceCents: 6300,
      notes: null,
      snapshot: {},
      ...overrides,
    },
    items: [
      {
        description: "Skin tag removal (simple)",
        quantity: 5,
        unitPriceCents: 2000,
        lineTotalCents: 10000,
      },
    ],
    company,
    patient,
    legalFooter: "HST #12345",
    ...rest,
  };
}

describe("buildPrintableInvoice", () => {
  it("prints a draft from live rows and says it is not an invoice yet", () => {
    const doc = buildPrintableInvoice(
      input({ invoiceNumber: null, status: "draft" }),
    );
    expect(doc.isDraft).toBe(true);
    expect(doc.fromSnapshot).toBe(false);
    expect(doc.lines).toHaveLength(1);
    expect(doc.totalCents).toBe(11300);
    expect(doc.billTo?.name).toBe("Ana Ruiz");
  });

  it("reprints an issued invoice from the frozen snapshot, not today's rows", () => {
    const doc = buildPrintableInvoice(
      input({
        snapshot: {
          invoiceNumber: "INV-00007",
          company: { legalName: "Vicaria Health Inc.", phone: "+19055550999" },
          billTo: { name: "Ana Ruiz", address: "Old address 1" },
          legalFooter: "HST #OLD",
          totals: {
            subtotalCents: 9000,
            discountCents: 0,
            taxCents: 1170,
            totalCents: 10170,
          },
          items: [
            {
              description: "Skin tag removal (simple)",
              quantity: 4,
              unitPriceCents: 2250,
              lineTotalCents: 9000,
            },
          ],
        },
      }),
    );
    expect(doc.fromSnapshot).toBe(true);
    // The price rose and the patient moved since; the document must not.
    expect(doc.totalCents).toBe(10170);
    expect(doc.lines[0].quantity).toBe(4);
    expect(doc.billTo?.address).toBe("Old address 1");
    expect(doc.company.phone).toBe("+19055550999");
    expect(doc.legalFooter).toBe("HST #OLD");
  });

  it("keeps paid and balance live, because they move after issuing", () => {
    const doc = buildPrintableInvoice(
      input({
        paidCents: 11300,
        balanceCents: 0,
        snapshot: {
          totals: {
            subtotalCents: 10000,
            discountCents: 0,
            taxCents: 1300,
            totalCents: 11300,
          },
        },
      }),
    );
    expect(doc.paidCents).toBe(11300);
    expect(doc.balanceCents).toBe(0);
  });

  it("falls back to live identity where an old snapshot has none", () => {
    const doc = buildPrintableInvoice(
      input({
        // Snapshots written before the print work carried only totals/items.
        snapshot: {
          totals: {
            subtotalCents: 10000,
            discountCents: 0,
            taxCents: 1300,
            totalCents: 11300,
          },
        },
      }),
    );
    expect(doc.company.address).toBe("1 King St W, Hamilton ON");
    expect(doc.billTo?.patientNumber).toBe("P-00042");
    expect(doc.legalFooter).toBe("HST #12345");
  });

  it("ignores a snapshot that is not an object", () => {
    const doc = buildPrintableInvoice(input({ snapshot: "corrupted" }));
    expect(doc.totalCents).toBe(11300);
    expect(doc.lines).toHaveLength(1);
  });

  it("does not trust a snapshot on a draft", () => {
    const doc = buildPrintableInvoice(
      input({
        invoiceNumber: null,
        status: "draft",
        snapshot: { totals: { totalCents: 1 } },
      }),
    );
    expect(doc.totalCents).toBe(11300);
  });
});

describe("receiptMethodLabel", () => {
  it("maps stored methods onto the paper form's boxes", () => {
    expect(receiptMethodLabel("cash")).toBe("Cash");
    expect(receiptMethodLabel("debit")).toBe("Debit");
    expect(receiptMethodLabel("credit")).toBe("Credit Card");
    expect(receiptMethodLabel("square_card")).toBe("Credit Card");
    expect(receiptMethodLabel("e_transfer")).toBe("E-Transfer");
  });

  it("falls back to Other for anything unmapped", () => {
    expect(receiptMethodLabel("square_invoice")).toBe("Other");
    expect(receiptMethodLabel("bitcoin")).toBe("Other");
  });
});

describe("formatReceiptNumber", () => {
  it("pads to a stable width so receipts sort as text", () => {
    expect(formatReceiptNumber("REC-", 1)).toBe("REC-00001");
    expect(formatReceiptNumber("REC-", 12345)).toBe("REC-12345");
  });
});
