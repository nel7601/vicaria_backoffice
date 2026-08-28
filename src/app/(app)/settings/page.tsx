import { Card, CardTitle } from "@/components/ui/card";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import {
  getCompanySettings,
  getPrimaryOrganization,
  listEmployees,
  listServiceCategories,
  listServicesWithPrice,
} from "@/lib/db/queries/organization";
import { listTemplatesDetailed } from "@/lib/db/queries/encounters";
import type { TemplateFieldInput } from "@/lib/schemas/template";
import { CompanyForm } from "./company-form";
import { EmployeesSection, type EmployeeRow } from "./employees-section";
import { ServicesSection, type ServiceRow } from "./services-section";
import { CategoriesSection, type CategoryRow } from "./categories-section";
import { TemplatesSection, type TemplateRow } from "./templates-section";

function extractFields(schema: unknown): TemplateFieldInput[] {
  if (Array.isArray(schema)) return schema as TemplateFieldInput[];
  if (schema && typeof schema === "object" && "fields" in schema) {
    const f = (schema as { fields?: unknown }).fields;
    if (Array.isArray(f)) return f as TemplateFieldInput[];
  }
  return [];
}

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
  let employees: EmployeeRow[] = [];
  let services: ServiceRow[] = [];
  let categories: CategoryRow[] = [];
  let templates: TemplateRow[] = [];

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
      employees = (await listEmployees(org.id)) as EmployeeRow[];
      services = (await listServicesWithPrice(org.id)) as ServiceRow[];
      categories = (await listServiceCategories(org.id)) as CategoryRow[];
      templates = (await listTemplatesDetailed(org.id)).map((t) => ({
        templateId: t.templateId,
        name: t.name,
        serviceId: t.serviceId,
        serviceName: t.serviceName,
        version: t.version,
        fields: extractFields(t.schema),
        usageCount: t.usageCount ?? 0,
        archived: Boolean(t.archivedAt),
      }));
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
        <CardTitle>Categories</CardTitle>
        <div className="mt-4">
          <CategoriesSection categories={categories} canEdit={canEditCompany} />
        </div>
      </Card>

      <Card>
        <CardTitle>Services &amp; prices</CardTitle>
        <div className="mt-4">
          <ServicesSection
            services={services}
            categories={categories.filter((c) => c.isActive).map((c) => c.name)}
            canEdit={canEditCompany}
          />
        </div>
      </Card>

      <Card>
        <CardTitle>Encounter templates</CardTitle>
        <div className="mt-4">
          <TemplatesSection
            templates={templates}
            services={services
              .filter((s) => s.isActive)
              .map((s) => ({ id: s.id, label: s.nameEn }))}
            canEdit={canEditCompany}
          />
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
