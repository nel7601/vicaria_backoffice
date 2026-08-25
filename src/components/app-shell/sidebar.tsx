"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV_ITEMS } from "./nav";

export function Sidebar({ visibleHrefs }: { visibleHrefs: string[] }) {
  const pathname = usePathname();
  const items = NAV_ITEMS.filter((i) => visibleHrefs.includes(i.href));

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
      <nav className="flex-1 space-y-1 p-3" aria-label="Primary">
        {items.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "block rounded-lg px-3 py-2 text-sm font-medium transition duration-150",
                active
                  ? "bg-primary-soft text-primary-hover"
                  : "text-foreground hover:bg-warm",
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
