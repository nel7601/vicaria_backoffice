import { NextResponse } from "next/server";
import { AuthorizationError } from "@/lib/auth/errors";
import { TenantResolutionError } from "@/lib/auth/principal";
import { AssistantAuthError } from "./auth/request-identity";

/**
 * HTTP conventions for the assistant API.
 *
 * Two rules the mobile client depends on:
 *  1. Authentication failures answer 401 with JSON — never a 302 to /login.
 *     A redirect would reach the APK as an HTML login page and look like a
 *     mysterious parse error instead of an expired token.
 *  2. Error bodies carry a stable machine-readable `error` code plus a short
 *     message, and never PHI or internal details (SEC-06).
 */
export interface AssistantErrorBody {
  error: string;
  message: string;
}

export function assistantError(
  code: string,
  message: string,
  status: number,
): NextResponse<AssistantErrorBody> {
  const response = NextResponse.json({ error: code, message }, { status });
  if (status === 401) {
    response.headers.set("WWW-Authenticate", "Bearer");
  }
  return response;
}

/**
 * Translate a thrown error into an assistant HTTP response.
 *
 * Unknown errors become a generic 500: the cause belongs in server logs, not
 * in a response body that may reach a device screen.
 */
export function assistantErrorResponse(
  error: unknown,
): NextResponse<AssistantErrorBody> {
  if (error instanceof AssistantAuthError) {
    return assistantError(error.code, error.message, error.status);
  }
  if (error instanceof AuthorizationError) {
    return assistantError(
      "forbidden",
      "Not authorized for this operation",
      403,
    );
  }
  if (error instanceof TenantResolutionError) {
    return assistantError(
      "no_tenant",
      "This account is not linked to an organization",
      403,
    );
  }
  return assistantError("internal_error", "Unexpected error", 500);
}
