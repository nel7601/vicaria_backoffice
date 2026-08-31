import Link from "next/link";
import { monthGridDays } from "@/lib/domain/timezone";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX_CHIPS = 3;

export interface MonthGridEntry {
  id: string;
  /** Clinic-timezone day (YYYY-MM-DD) the entry belongs to. */
  day: string;
  /** Time label, e.g. "09:00". */
  time: string;
  label: string;
  /** Status dot Tailwind class, e.g. "bg-primary". */
  dotClass: string;
  /** Render struck-through/dimmed (cancelled, no-show). */
  struck?: boolean;
}

/**
 * Sunday-start month grid shared by the clinic calendar and the care
 * schedule. Each day links to that day's detail view; up to 3 entry chips
 * per cell plus a "+N more" indicator; today highlighted.
 */
export function MonthGrid({
  monthStr,
  todayStr,
  entries,
  dayHref,
}: {
  monthStr: string;
  todayStr: string;
  entries: MonthGridEntry[];
  dayHref: (day: string) => string;
}) {
  const days = monthGridDays(monthStr);
  const byDay = new Map<string, MonthGridEntry[]>();
  for (const e of entries) {
    const list = byDay.get(e.day);
    if (list) list.push(e);
    else byDay.set(e.day, [e]);
  }

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[720px]">
        <div className="grid grid-cols-7 border-b border-border text-center text-xs font-medium uppercase text-muted">
          {WEEKDAYS.map((w) => (
            <div key={w} className="py-2">
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((day) => {
            const inMonth = day.startsWith(monthStr);
            const isToday = day === todayStr;
            const dayEntries = byDay.get(day) ?? [];
            const extra = dayEntries.length - MAX_CHIPS;
            return (
              <Link
                key={day}
                href={dayHref(day)}
                /* Days from the neighbouring months are sunken, not hidden:
                   their appointments are real and shown, but the tint says at
                   a glance which cells belong to the month you opened. */
                className={`min-h-24 border-b border-r border-border/60 p-1.5 align-top transition ${
                  inMonth
                    ? "hover:bg-surface-muted"
                    : "bg-surface-sunken text-muted hover:brightness-[0.97]"
                }`}
              >
                <div
                  className={`mb-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                    isToday
                      ? "bg-primary font-semibold text-primary-foreground"
                      : inMonth
                        ? "font-medium"
                        : ""
                  }`}
                >
                  {Number(day.slice(8))}
                </div>
                {/* Neighbouring days are shown, and shown as secondary: the
                    grid tells the truth about them without competing with the
                    month you actually opened. */}
                <div className={`space-y-0.5 ${inMonth ? "" : "opacity-70"}`}>
                  {dayEntries.slice(0, MAX_CHIPS).map((e) => (
                    <div
                      key={e.id}
                      className={`flex items-center gap-1 truncate rounded bg-primary/5 px-1 py-0.5 text-[11px] leading-tight ${
                        e.struck ? "line-through opacity-50" : ""
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${e.dotClass}`}
                      />
                      <span className="tabular-nums">{e.time}</span>
                      <span className="truncate">{e.label}</span>
                    </div>
                  ))}
                  {extra > 0 && (
                    <div className="px-1 text-[11px] text-muted">+{extra} more</div>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
