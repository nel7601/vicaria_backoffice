"use server";

import { authorize } from "@/lib/auth/authorize";
import { recordAudit } from "@/lib/audit/record";
import { getPrimaryOrganization } from "@/lib/db/queries/organization";
import { runReport, type ReportFilters } from "@/lib/db/queries/reports";
import { getReport } from "@/lib/reports/registry";
import { toCsv } from "@/lib/reports/csv";

export interface ExportResult {
  ok: boolean;
  filename?: string;
  csv?: string;
  error?: string;
}

/**
 * Export a report as CSV (§10.3). Every sensitive export writes an audit event
 * with the actor, report code, filters and row count.
 */
export async function exportReportAction(
  code: string,
  filters: { from?: string; to?: string },
): Promise<ExportResult> {
  const def = getReport(code);
  if (!def) return { ok: false, error: "Unknown report." };

  const user = await authorize(def.resource, "read");
  const org = await getPrimaryOrganization();
  if (!org) return { ok: false, error: "Organization not found." };

  const parsed: ReportFilters = {
    from: filters.from ? new Date(filters.from) : undefined,
    to: filters.to ? new Date(filters.to) : undefined,
  };

  const result = await runReport(code, org.id, parsed);
  const csv = toCsv(result.columns, result.rows);

  await recordAudit({
    organizationId: org.id,
    actorUserId: user.authId,
    action: "export",
    entityType: "report",
    entityId: code,
    reason: `CSV export of ${code}`,
    after: {
      filters: { from: filters.from ?? null, to: filters.to ?? null },
      rows: result.rows.length,
      format: "csv",
    },
  });

  return {
    ok: true,
    filename: `${code}-${new Date().toISOString().slice(0, 10)}.csv`,
    csv,
  };
}
