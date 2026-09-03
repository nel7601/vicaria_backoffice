import { redirect } from "next/navigation";
import Link from "next/link";
import { Card, CardTitle } from "@/components/ui/card";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import {
  getPrimaryOrganization,
  listAcquisitionSources,
} from "@/lib/db/queries/organization";
import { NewPatientForm } from "./new-patient-form";

export default async function NewPatientPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!can(user.roles, "patients_demographic", "create")) {
    return (
      <Card>
        <CardTitle>New patient</CardTitle>
        <p className="mt-2 text-sm text-muted">
          Your role cannot create patients.
        </p>
      </Card>
    );
  }

  // A missing database must not block the form; it just leaves the source
  // menu empty, which the form handles.
  let sources: string[] = [];
  try {
    const org = await getPrimaryOrganization();
    if (org) {
      sources = (await listAcquisitionSources(org.id))
        .filter((s) => s.isActive)
        .map((s) => s.name);
    }
  } catch (e) {
    console.error("Acquisition sources load failed:", e);
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/patients" className="text-sm text-primary hover:underline">
          ← Patients
        </Link>
        <h1 className="mt-1 text-xl font-semibold">New patient</h1>
        <p className="text-sm text-muted">
          Contact data is normalized; a duplicate check runs before saving
          (FR-PAT-001/002).
        </p>
      </div>
      <Card>
        <NewPatientForm sources={sources} />
      </Card>
    </div>
  );
}
