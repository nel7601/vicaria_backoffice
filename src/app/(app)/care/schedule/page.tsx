import Link from "next/link";
import { Card, CardTitle } from "@/components/ui/card";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { getPrimaryOrganization } from "@/lib/db/queries/organization";
import { listCaregivers, listShiftsInWindow } from "@/lib/db/queries/care";
import { formatMinutes, shiftMinutes } from "@/lib/domain/care";
import {
  clinicDateString,
  clinicDayWindow,
  clinicMonthWindow,
  shiftDay,
  shiftMonth,
} from "@/lib/domain/timezone";
import { MonthGrid } from "@/components/ui/month-grid";

const TZ = "America/Toronto";

const STATUS_STYLE: Record<string, string> = {
  scheduled: "bg-warm text-muted",
  confirmed: "bg-primary-soft text-primary-hover",
  in_progress: "bg-primary-soft text-primary-hover",
  completed: "bg-success-soft text-success",
  cancelled: "bg-danger/10 text-danger line-through",
  no_show: "bg-danger/10 text-danger line-through",
};

const STATUS_DOT: Record<string, string> = {
  scheduled: "bg-primary",
  confirmed: "bg-primary",
  in_progress: "bg-warning",
  completed: "bg-success",
  cancelled: "bg-danger",
  no_show: "bg-danger",
};

function fmtTime(d: Date) {
  return d.toLocaleTimeString("en-CA", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: TZ,
  });
}

function monthLabel(monthStr: string): string {
  const [y, m] = monthStr.split("-").map(Number);
  return new Intl.DateTimeFormat("en-CA", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, 15)));
}

/**
 * Care schedule — month calendar of home-care shifts by default; clicking a
 * day opens the caregiver day board.
 */
export default async function CareSchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; month?: string; caregiver?: string }>;
}) {
  const { date, month, caregiver } = await searchParams;
  const user = await getSessionUser();
  const roles = user?.roles ?? [];

  if (!can(roles, "home_care", "read")) {
    return (
      <Card>
        <CardTitle>Care schedule</CardTitle>
        <p className="mt-2 text-sm text-muted">
          Your role cannot view the care schedule.
        </p>
      </Card>
    );
  }

  const isDayView = Boolean(date);
  const dayStr = date ?? clinicDateString(new Date());
  const monthStr = month ?? dayStr.slice(0, 7);
  const { from, to } = isDayView
    ? clinicDayWindow(dayStr)
    : clinicMonthWindow(monthStr);
  const cgQuery = caregiver ? `&caregiver=${caregiver}` : "";

  let shifts: Awaited<ReturnType<typeof listShiftsInWindow>> = [];
  let caregivers: Awaited<ReturnType<typeof listCaregivers>> = [];
  let dbError: string | null = null;

  try {
    const org = await getPrimaryOrganization();
    if (org) {
      [shifts, caregivers] = await Promise.all([
        listShiftsInWindow({
          organizationId: org.id,
          from,
          to,
          caregiverId: caregiver,
        }),
        listCaregivers(org.id),
      ]);
    }
  } catch (e) {
    dbError = "Database not reachable. Run migration 0005 and retry.";
    console.error("Care schedule load failed:", e);
  }

  // Group by caregiver for the day board.
  const byCaregiver = new Map<
    string,
    { name: string; shifts: typeof shifts; minutes: number }
  >();
  if (isDayView) {
    for (const s of shifts) {
      const entry = byCaregiver.get(s.caregiverId) ?? {
        name: `${s.caregiverFirst} ${s.caregiverLast}`,
        shifts: [] as typeof shifts,
        minutes: 0,
      };
      entry.shifts.push(s);
      if (!["cancelled", "no_show"].includes(s.status)) {
        entry.minutes += shiftMinutes({ startAt: s.startAt, endAt: s.endAt });
      }
      byCaregiver.set(s.caregiverId, entry);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Care schedule</h1>
        <p className="text-sm text-muted">
          Home-care shifts ·{" "}
          {isDayView ? `day board · ${dayStr}` : monthLabel(monthStr)}
        </p>
      </div>

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {isDayView ? (
              <>
                <Link
                  href={`/care/schedule?month=${dayStr.slice(0, 7)}${cgQuery}`}
                  className="rounded-md border border-border px-3 py-1.5 text-sm text-primary hover:bg-warm"
                >
                  ⊞ Month
                </Link>
                <Link
                  href={`/care/schedule?date=${shiftDay(dayStr, -1)}${cgQuery}`}
                  className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-warm"
                >
                  ← Prev
                </Link>
                <Link
                  href={`/care/schedule?date=${shiftDay(dayStr, 1)}${cgQuery}`}
                  className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-warm"
                >
                  Next →
                </Link>
                <Link
                  href={`/care/schedule?date=${clinicDateString(new Date())}${cgQuery}`}
                  className="rounded-md border border-border px-3 py-1.5 text-sm text-primary hover:bg-warm"
                >
                  Today
                </Link>
              </>
            ) : (
              <>
                <Link
                  href={`/care/schedule?month=${shiftMonth(monthStr, -1)}${cgQuery}`}
                  className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-warm"
                >
                  ← {monthLabel(shiftMonth(monthStr, -1))}
                </Link>
                <Link
                  href={`/care/schedule?month=${shiftMonth(monthStr, 1)}${cgQuery}`}
                  className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-warm"
                >
                  {monthLabel(shiftMonth(monthStr, 1))} →
                </Link>
                <Link
                  href={`/care/schedule${caregiver ? `?caregiver=${caregiver}` : ""}`}
                  className="rounded-md border border-border px-3 py-1.5 text-sm text-primary hover:bg-warm"
                >
                  Today
                </Link>
              </>
            )}
          </div>
          <form method="get" className="flex items-center gap-2">
            {isDayView ? (
              <input type="hidden" name="date" value={dayStr} />
            ) : (
              <input type="hidden" name="month" value={monthStr} />
            )}
            <select
              name="caregiver"
              defaultValue={caregiver ?? ""}
              className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm"
            >
              <option value="">All caregivers</option>
              {caregivers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.firstName} {c.lastName}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-warm"
            >
              Filter
            </button>
          </form>
        </div>

        {dbError && <p className="text-sm text-warning">{dbError}</p>}

        {/* Month calendar of shifts */}
        {!dbError && !isDayView && (
          <MonthGrid
            monthStr={monthStr}
            todayStr={clinicDateString(new Date())}
            dayHref={(day) => `/care/schedule?date=${day}${cgQuery}`}
            entries={shifts.map((s) => ({
              id: s.id,
              day: clinicDateString(s.startAt),
              time: fmtTime(s.startAt),
              label: `${s.patientFirst} ${s.patientLast} · ${s.caregiverFirst}`,
              dotClass: STATUS_DOT[s.status] ?? "bg-muted",
              struck: ["cancelled", "no_show"].includes(s.status),
            }))}
          />
        )}

        {/* Day board grouped by caregiver */}
        {!dbError && isDayView && (
          <>
            {byCaregiver.size === 0 && (
              <p className="py-8 text-center text-sm text-muted">
                No home-care shifts for this day.
              </p>
            )}
            <div className="space-y-5">
              {[...byCaregiver.values()].map((cg) => (
                <div key={cg.name}>
                  <div className="flex items-baseline justify-between">
                    <h3 className="text-sm font-semibold">{cg.name}</h3>
                    <span className="text-xs text-muted">
                      {formatMinutes(cg.minutes)} scheduled
                    </span>
                  </div>
                  <ul className="mt-2 divide-y divide-border rounded-md border border-border">
                    {cg.shifts.map((s) => (
                      <li
                        key={s.id}
                        className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
                      >
                        <div>
                          <span className="tabular-nums font-medium">
                            {fmtTime(s.startAt)}–{fmtTime(s.endAt)}
                          </span>{" "}
                          ·{" "}
                          <Link
                            href={`/care/${s.agreementId}`}
                            className="text-primary hover:underline"
                          >
                            {s.patientFirst} {s.patientLast}
                          </Link>
                        </div>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[s.status] ?? ""}`}
                        >
                          {s.status.replace("_", " ")}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
