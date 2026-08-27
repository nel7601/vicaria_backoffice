import Link from "next/link";
import { Card, CardTitle } from "@/components/ui/card";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { formatCents } from "@/lib/domain/money";
import {
  getPrimaryOrganization,
  listServicesWithPrice,
} from "@/lib/db/queries/organization";
import {
  listInvoicesPaged,
  listPaymentsPaged,
  listUnverifiedEtransfers,
} from "@/lib/db/queries/billing";
import { listPatients } from "@/lib/db/queries/patients";
import { NewInvoiceForm, type InvoiceServiceOption } from "./new-invoice-form";
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

const PAGE_SIZE = 10;

const INVOICE_STATUSES = [
  "draft",
  "issued",
  "partially_paid",
  "paid",
  "overdue",
  "void",
  "refunded",
] as const;

const PAYMENT_METHODS = ["cash", "e_transfer", "square_card", "debit", "credit", "other"] as const;
const PAYMENT_STATUSES = ["pending", "confirmed", "failed", "cancelled", "partially_refunded", "refunded"] as const;

function pageOf(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

/** Querystring builder that keeps both sections' filters in the URL. */
function qs(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "" && v !== 1) sp.set(k, String(v));
  }
  const str = sp.toString();
  return str ? `?${str}` : "";
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{
    iq?: string;
    istatus?: string;
    ipage?: string;
    pq?: string;
    pmethod?: string;
    pstatus?: string;
    ppage?: string;
  }>;
}) {
  const sp = await searchParams;
  const iq = sp.iq ?? "";
  const istatus = (INVOICE_STATUSES as readonly string[]).includes(sp.istatus ?? "")
    ? sp.istatus
    : undefined;
  const ipage = pageOf(sp.ipage);
  const pq = sp.pq ?? "";
  const pmethod = (PAYMENT_METHODS as readonly string[]).includes(sp.pmethod ?? "")
    ? sp.pmethod
    : undefined;
  const pstatus = (PAYMENT_STATUSES as readonly string[]).includes(sp.pstatus ?? "")
    ? sp.pstatus
    : undefined;
  const ppage = pageOf(sp.ppage);
  const shared = {
    iq: iq || undefined,
    istatus,
    ipage,
    pq: pq || undefined,
    pmethod,
    pstatus,
    ppage,
  };
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

  let invoices: Awaited<ReturnType<typeof listInvoicesPaged>>["rows"] = [];
  let invoiceTotal = 0;
  let payments: Awaited<ReturnType<typeof listPaymentsPaged>>["rows"] = [];
  let paymentTotal = 0;
  let etransfers: Awaited<ReturnType<typeof listUnverifiedEtransfers>> = [];
  let patients: { id: string; label: string }[] = [];
  let serviceOptions: InvoiceServiceOption[] = [];
  let dbError: string | null = null;

  try {
    const org = await getPrimaryOrganization();
    if (org) {
      const [inv, pay, etr] = await Promise.all([
        listInvoicesPaged({
          organizationId: org.id,
          q: iq,
          status: istatus,
          page: ipage,
          pageSize: PAGE_SIZE,
        }),
        listPaymentsPaged({
          organizationId: org.id,
          q: pq,
          method: pmethod,
          status: pstatus,
          page: ppage,
          pageSize: PAGE_SIZE,
        }),
        listUnverifiedEtransfers(org.id),
      ]);
      invoices = inv.rows;
      invoiceTotal = inv.total;
      payments = pay.rows;
      paymentTotal = pay.total;
      etransfers = etr;
      if (canCreate) {
        const pats = await listPatients({ organizationId: org.id, limit: 100 });
        serviceOptions = (await listServicesWithPrice(org.id))
          .filter((sv) => sv.isActive)
          .map((sv) => ({
            id: sv.id,
            label: sv.nameEn,
            priceCents: sv.priceCents ?? 0,
            taxRateBps: sv.taxRateBps ?? 0,
          }));
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
        {canCreate && !dbError && (
          <NewInvoiceForm patients={patients} services={serviceOptions} />
        )}
      </div>

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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Invoices</CardTitle>
          <form method="get" className="flex flex-wrap items-center gap-2">
            {/* keep the payments section state */}
            {pq && <input type="hidden" name="pq" value={pq} />}
            {pmethod && <input type="hidden" name="pmethod" value={pmethod} />}
            {pstatus && <input type="hidden" name="pstatus" value={pstatus} />}
            {ppage > 1 && <input type="hidden" name="ppage" value={ppage} />}
            <input
              name="iq"
              defaultValue={iq}
              placeholder="Search number or patient"
              className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm"
            />
            <select
              name="istatus"
              defaultValue={istatus ?? ""}
              className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm"
            >
              <option value="">All statuses</option>
              {INVOICE_STATUSES.map((st) => (
                <option key={st} value={st}>
                  {st.replace("_", " ")}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-warm"
            >
              Filter
            </button>
            {(iq || istatus) && (
              <Link
                href={`/billing${qs({ ...shared, iq: undefined, istatus: undefined, ipage: 1 })}`}
                className="text-sm text-primary hover:underline"
              >
                Clear
              </Link>
            )}
          </form>
        </div>
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
        <Pagination
          page={ipage}
          total={invoiceTotal}
          hrefFor={(p) => `/billing${qs({ ...shared, ipage: p })}`}
        />
      </Card>

      {canCreate && !dbError && (
        <div className="flex w-full justify-end">
          <RecordPaymentForm patients={patients} />
        </div>
      )}

      {/* Recent payments */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Recent payments</CardTitle>
          <form method="get" className="flex flex-wrap items-center gap-2">
            {/* keep the invoices section state */}
            {iq && <input type="hidden" name="iq" value={iq} />}
            {istatus && <input type="hidden" name="istatus" value={istatus} />}
            {ipage > 1 && <input type="hidden" name="ipage" value={ipage} />}
            <input
              name="pq"
              defaultValue={pq}
              placeholder="Search patient or reference"
              className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm"
            />
            <select
              name="pmethod"
              defaultValue={pmethod ?? ""}
              className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm"
            >
              <option value="">All methods</option>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m.replace("_", " ")}
                </option>
              ))}
            </select>
            <select
              name="pstatus"
              defaultValue={pstatus ?? ""}
              className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm"
            >
              <option value="">All statuses</option>
              {PAYMENT_STATUSES.map((st) => (
                <option key={st} value={st}>
                  {st.replace("_", " ")}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-warm"
            >
              Filter
            </button>
            {(pq || pmethod || pstatus) && (
              <Link
                href={`/billing${qs({ ...shared, pq: undefined, pmethod: undefined, pstatus: undefined, ppage: 1 })}`}
                className="text-sm text-primary hover:underline"
              >
                Clear
              </Link>
            )}
          </form>
        </div>
        <ul className="mt-3 divide-y divide-border text-sm">
          {payments.length === 0 && <li className="py-2 text-muted">No payments.</li>}
          {payments.map((p) => (
            <li key={p.id} className="flex flex-wrap justify-between gap-2 py-2">
              <span>
                {p.patientFirst} {p.patientLast} · {p.method.replace("_", " ")}
                {p.reference ? ` · ${p.reference}` : ""}
              </span>
              <span className="text-muted">
                {p.receivedAt.toLocaleDateString("en-CA", { timeZone: "America/Toronto" })} ·{" "}
                {formatCents(p.amountCents)} · {p.status.replace("_", " ")}
              </span>
            </li>
          ))}
        </ul>
        <Pagination
          page={ppage}
          total={paymentTotal}
          hrefFor={(p) => `/billing${qs({ ...shared, ppage: p })}`}
        />
      </Card>
    </div>
  );
}

/** Prev/next pager shared by the two billing tables. */
function Pagination({
  page,
  total,
  hrefFor,
}: {
  page: number;
  total: number;
  hrefFor: (page: number) => string;
}) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (pages <= 1) return null;
  return (
    <div className="mt-3 flex items-center justify-between text-sm">
      <span className="text-muted">
        Page {page} of {pages} · {total} result{total === 1 ? "" : "s"}
      </span>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link
            href={hrefFor(page - 1)}
            className="rounded-md border border-border px-3 py-1 hover:bg-warm"
          >
            ← Prev
          </Link>
        ) : (
          <span className="rounded-md border border-border px-3 py-1 opacity-40">← Prev</span>
        )}
        {page < pages ? (
          <Link
            href={hrefFor(page + 1)}
            className="rounded-md border border-border px-3 py-1 hover:bg-warm"
          >
            Next →
          </Link>
        ) : (
          <span className="rounded-md border border-border px-3 py-1 opacity-40">Next →</span>
        )}
      </div>
    </div>
  );
}
