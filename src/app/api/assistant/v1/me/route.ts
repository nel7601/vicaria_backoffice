import { NextResponse } from "next/server";
import { requestPrincipal } from "@/lib/assistant/auth/request-identity";
import { assistantError, assistantErrorResponse } from "@/lib/assistant/http";
import { assistantFlags } from "@/lib/assistant/flags";
import { principalReadScope } from "@/lib/auth/authorize-principal";

/**
 * GET /api/assistant/v1/me — the authenticated principal as the server sees it.
 *
 * This is the end-to-end proof of the Bearer path (Phase 0 gate): the APK
 * signs in against Supabase, calls this with the access token, and gets back
 * exactly the authority the server will apply — never what the client claims.
 *
 * The response carries no PHI: identity, roles and the read scopes that drive
 * which tools the app may offer.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const flags = assistantFlags();
  if (!flags.assistantEnabled) {
    return assistantError(
      "assistant_disabled",
      "The assistant is not enabled for this deployment",
      503,
    );
  }

  try {
    const principal = await requestPrincipal(request);

    return NextResponse.json({
      user: {
        authUserId: principal.authUserId,
        email: principal.email,
        roles: principal.roles,
        isPractitioner: principal.isPractitioner,
        aal: principal.aal,
      },
      // Ids the client may echo back for display only; the server never trusts
      // them as authority on a later request.
      organizationId: principal.organizationId,
      employeeId: principal.employeeId,
      scopes: {
        patients: principalReadScope(principal, "patients_demographic"),
        clinicalNotes: principalReadScope(principal, "clinical_notes"),
        homeCare: principalReadScope(principal, "home_care"),
        invoices: principalReadScope(principal, "invoices_payments"),
        clinicalReports: principalReadScope(principal, "clinical_reports"),
        marketingReports: principalReadScope(principal, "marketing_reports"),
      },
    });
  } catch (error) {
    return assistantErrorResponse(error);
  }
}
