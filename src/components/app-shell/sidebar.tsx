"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV_GROUPS } from "./nav";

export function Sidebar({ visibleHrefs }: { visibleHrefs: string[] }) {
  const pathname = usePathname();
  const groups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => visibleHrefs.includes(i.href)),
  })).filter((g) => g.items.length > 0);

  // Exact-first match so /care/schedule doesn't also light up /care.
  const allHrefs = groups.flatMap((g) => g.items.map((i) => i.href));
  function isActive(href: string): boolean {
    if (pathname === href) return true;
    if (!pathname.startsWith(href + "/")) return false;
    // A more specific sibling wins (e.g. /care/schedule over /care).
    return !allHrefs.some(
      (h) => h !== href && h.startsWith(href + "/") && pathname.startsWith(h),
    );
  }

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-surface">
      <div className="flex h-16 items-center gap-2 border-b border-border px-5">
        <Image
          src="/brand/vicaria-symbol.png"
          alt="Vicaria Health"
          width={30}
          height={40}
          className="h-10 w-auto"
          priority
        />
        <div className="leading-tight">
          <div
            className="text-sm font-bold"
            style={{
              fontFamily:
                "var(--font-libre-baskerville), 'Libre Baskerville', Georgia, serif",
            }}
          >
            Vicaria Health
          </div>
          <div className="text-xs text-muted">Backoffice</div>
        </div>
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto p-3" aria-label="Primary">
        {groups.map((group, gi) => (
          <div key={group.label ?? `top-${gi}`}>
            {group.label && (
              <div className="mb-1.5 flex items-center gap-2 px-3">
                <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted/80">
                  {group.label}
                </span>
                <span className="h-px flex-1 bg-border" aria-hidden />
              </div>
            )}
            <div
              className={cn(
                "space-y-0.5",
                // Labeled groups get a subtle rail so items read as nested.
                group.label && "ml-3.5 border-l border-border pl-2",
              )}
            >
              {group.items.map((item) => {
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "block rounded-lg px-3 py-1.5 text-sm transition duration-150",
                      active
                        ? "bg-primary-soft font-semibold text-primary-hover"
                        : "font-normal text-foreground/90 hover:bg-warm hover:text-foreground",
                    )}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
