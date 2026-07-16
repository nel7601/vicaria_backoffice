import { Card, CardTitle } from "@/components/ui/card";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import {
  getCompanySettings,
  getPrimaryOrganization,
  listEmployees,
  listLocations,
} from "@/lib/db/queries/organization";
import { CompanyForm } from "./company-form";
import { LocationsSection, type LocationRow } from "./locations-section";
import { EmployeesSection, type EmployeeRow } from "./employees-section";

/**
 * Settings (spec §7, Phase 1). Company + locations + employees/roles.
 * Read access requires the `configuration` resource; editing is gated per
 * section (configuration for company/locations, users_roles for employees).
 */
export default async function SettingsPage() {
  const user = await getSessionUser();
  const roles = user?.roles ?? [];

  if (!can(roles, "configuration", "read")) {
    return (
      <Card>
        <CardTitle>Settings</CardTitle>
        <p className="mt-2 text-sm text-muted">
          Your role does not have access to configuration.
        </p>
      </Card>
    );
  }

  const canEditCompany = can(roles, "configuration", "update");
  const canEditEmployees = can(roles, "users_roles", "create");

  // Degrade gracefully when the database is not configured (dev without env).
  let dbError: string | null = null;
  let companyDefaults = {};
  let locations: LocationRow[] = [];
  let employees: EmployeeRow[] = [];

  try {
    const org = await getPrimaryOrganization();
    if (org) {
      const settings = await getCompanySettings(org.id);
      companyDefaults = {
        legalName: org.legalName,
        operatingName: org.operatingName ?? "",
        timezone: org.timezone,
        currency: org.currency,
        address: settings?.address ?? "",
        phone: settings?.phone ?? "",
        email: settings?.email ?? "",
        website: settings?.website ?? "",
        invoiceNumberPrefix: settings?.invoiceNumberPrefix ?? "INV-",
        legalFooterEn: settings?.legalFooterEn ?? "",
        legalFooterEs: settings?.legalFooterEs ?? "",
      };
      locations = (await listLocations(org.id)) as LocationRow[];
      employees = (await listEmployees(org.id)) as EmployeeRow[];
    }
  } catch (e) {
    dbError =
      "Database not reachable. Configure DATABASE_URL and run migrations to manage settings.";
    console.error("Settings load failed:", e);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-muted">
          Company identity, locations and employee roles (FR-ADM-001/002/003).
        </p>
      </div>

      {dbError && (
        <Card>
          <p className="text-sm text-warning">{dbError}</p>
        </Card>
      )}

      <Card>
        <CardTitle>Company</CardTitle>
        <div className="mt-4">
          <CompanyForm defaults={companyDefaults} canEdit={canEditCompany} />
        </div>
      </Card>

      <Card>
        <CardTitle>Locations</CardTitle>
        <div className="mt-4">
          <LocationsSection locations={locations} canEdit={canEditCompany} />
        </div>
      </Card>

      <Card>
        <CardTitle>Employees &amp; roles</CardTitle>
        <div className="mt-4">
          <EmployeesSection employees={employees} canEdit={canEditEmployees} />
        </div>
      </Card>
    </div>
  );
}
