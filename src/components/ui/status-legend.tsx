export interface LegendItem {
  dotClass: string;
  label: string;
  struck?: boolean;
  /** Glyph shown instead of the dot, matching the entries it explains. */
  badge?: string;
}

/** Color key shown above the month calendars. */
export function StatusLegend({ items }: { items: LegendItem[] }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md bg-background px-3 py-2 text-xs text-muted">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5">
          {it.badge ? (
            <span
              aria-hidden
              className={`w-2 shrink-0 text-center text-[10px] font-bold leading-none ${it.dotClass}`}
            >
              {it.badge}
            </span>
          ) : (
            <span className={`h-2 w-2 shrink-0 rounded-full ${it.dotClass}`} />
          )}
          <span className={it.struck ? "line-through" : ""}>{it.label}</span>
        </span>
      ))}
    </div>
  );
}
