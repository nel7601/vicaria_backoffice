import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";

/**
 * Printable documents live outside the app shell: no sidebar, no header, no
 * navigation — nothing that would end up on the paper the patient is handed.
 *
 * Authentication is repeated here because these routes are not under
 * `(app)/layout.tsx`; MFA is enforced the same way, so a privileged session
 * cannot use a print URL to skip the second factor.
 */
export default async function PrintLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.mfaRequired && !user.mfaSatisfied) redirect("/mfa");

  return <div className="min-h-screen bg-background p-6 print:bg-white print:p-0">{children}</div>;
}
