import { redirect } from "next/navigation";
import { Sidebar } from "@/components/app-shell/sidebar";
import { NAV_ITEMS } from "@/components/app-shell/nav";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  // Compute which nav items this user's roles may read. Dashboard is always on.
  const visibleHrefs = NAV_ITEMS.filter(
    (item) => !item.resource || can(user.roles, item.resource, "read"),
  ).map((item) => item.href);

  return (
    <div className="flex min-h-screen">
      <Sidebar visibleHrefs={visibleHrefs} />
      <div className="flex flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-border bg-surface px-6">
          <div className="text-sm text-muted">
            {user.roles.length > 0
              ? user.roles.join(", ")
              : "no role assigned"}
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm">{user.email}</span>
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-background"
              >
                Sign out
              </button>
            </form>
          </div>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
