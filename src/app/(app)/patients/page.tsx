import Link from "next/link";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getSessionUser } from "@/lib/auth/session";
import { can, readScopeFor } from "@/lib/auth/rbac";
import { getPrimaryOrganization } from "@/lib/db/queries/organization";
import { getEmployeeIdForAuthUser } from "@/lib/db/queries/employee";
import { listPatients } from "@/lib/db/queries/patients";

const PATIENT_STATUSES = [
  "prospect",
  "active",
  "inactive",
  "blocked",
  "deceased",
] as const;

const STATUS_STYLE: Record<string, string> = {
  prospect: "bg-warm text-muted",
  active: "bg-success-soft text-success",
  inactive: "bg-border/60 text-muted",
  blocked: "bg-danger/10 text-danger",
  deceased: "bg-border/60 text-muted",
};

export default async function PatientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; service?: string; status?: string }>;
}) {
  const { q, service: rawService, status: rawStatus } = await searchParams;
  const service =
    rawService === "clinic" || rawService === "care" ? rawService : undefined;
  const status = (PATIENT_STATUSES as readonly string[]).includes(
    rawStatus ?? "",
  )
    ? rawStatus
    : undefined;
  const user = await getSessionUser();
  const roles = user?.roles ?? [];

  if (!can(roles, "patients_demographic", "read")) {
    return (
      <Card>
        <CardTitle>Patients</CardTitle>
        <p className="mt-2 text-sm text-muted">Your role cannot view patients.</p>
      </Card>
    );
  }

  const scope = readScopeFor(roles, "patients_demographic");
  let rows: Awaited<ReturnType<typeof listPatients>> = [];
  let dbError: string | null = null;

  try {
    const org = await getPrimaryOrganization();
    if (org && user) {
      let assignedEmployeeId: string | undefined;
      if (scope === "assigned") {
        const empId = await getEmployeeIdForAuthUser(org.id, user.authId);
        // Fail safe: a practitioner with no employee mapping sees nobody.
        assignedEmployeeId = empId ?? "00000000-0000-0000-0000-000000000000";
      }
      rows = await listPatients({
        organizationId: org.id,
        search: q,
        assignedEmployeeId,
        marketingOnly: scope === "limited" && roles.includes("marketing"),
        service,
        status,
      });
    }
  } catch (e) {
    dbError = "Database not reachable. Configure DATABASE_URL and run migrations.";
    console.error("Patients load failed:", e);
  }

  const canCreate = can(roles, "patients_demographic", "create");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Patients</h1>
          <p className="text-sm text-muted">
            {scope === "assigned"
              ? "Your assigned patients."
              : scope === "limited"
                ? "Marketing-consented patients (limited fields)."
                : "All patients."}
          </p>
        </div>
        {canCreate && (
          <Link href="/patients/new">
            <Button>New patient</Button>
          </Link>
        )}
      </div>

      <Card>
        <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
          <input
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search name, email, phone, patient #"
            className="w-full max-w-md rounded-lg border border-border bg-surface px-3 py-2 text-sm"
          />
          <select
            name="service"
            defaultValue={service ?? ""}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm"
          >
            <option value="">All services</option>
            <option value="clinic">Clinic (consultation)</option>
            <option value="care">Home care</option>
          </select>
          <select
            name="status"
            defaultValue={status ?? ""}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm"
          >
            <option value="">All statuses</option>
            {PATIENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <Button type="submit" variant="secondary">
            Filter
          </Button>
          {(q || service || status) && (
            <Link href="/patients" className="text-sm text-primary hover:underline">
              Clear
            </Link>
          )}
        </form>

        {dbError && <p className="text-sm text-warning">{dbError}</p>}

        {!dbError && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase text-muted">
                  <th className="py-2 pr-4">Patient #</th>
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Contact</th>
                  <th className="py-2 pr-4">Lang</th>
                  <th className="py-2 pr-4">Service</th>
                  <th className="py-2 pr-4">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-muted">
                      No patients found.
                    </td>
                  </tr>
                )}
                {rows.map((p) => (
                  <tr key={p.id} className="border-b border-border/60">
                    <td className="py-2 pr-4 font-mono text-xs">
                      {p.patientNumber}
                    </td>
                    <td className="py-2 pr-4">
                      <Link
                        href={`/patients/${p.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {p.preferredName || p.legalFirstName} {p.legalLastName}
                      </Link>
                    </td>
                    <td className="py-2 pr-4 text-muted">
                      {p.email || p.phoneE164 || "—"}
                    </td>
                    <td className="py-2 pr-4 uppercase">{p.preferredLanguage}</td>
                    <td className="py-2 pr-4">
                      <span className="flex flex-wrap gap-1">
                        {(p.hasClinic || !p.hasCare) && (
                          <span className="rounded-full bg-success-soft px-2 py-0.5 text-xs text-success">
                            Clinic
                          </span>
                        )}
                        {p.hasCare && (
                          <span className="rounded-full bg-primary-soft px-2 py-0.5 text-xs text-primary-hover">
                            Home care
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="py-2 pr-4">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[p.status] ?? ""}`}
                      >
                        {p.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
