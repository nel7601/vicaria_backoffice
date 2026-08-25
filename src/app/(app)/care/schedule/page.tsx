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
  shiftDay,
} from "@/lib/domain/timezone";

const TZ = "America/Toronto";

const STATUS_STYLE: Record<string, string> = {
  scheduled: "bg-warm text-muted",
  confirmed: "bg-primary-soft text-primary-hover",
  in_progress: "bg-primary-soft text-primary-hover",
  completed: "bg-success-soft text-success",
  cancelled: "bg-danger/10 text-danger line-through",
  no_show: "bg-danger/10 text-danger line-through",
};

function fmtTime(d: Date) {
  return d.toLocaleTimeString("en-CA", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: TZ,
  });
}

/** Caregiver day board — who is where, when, across all agreements. */
export default async function CareSchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; caregiver?: string }>;
}) {
  const { date, caregiver } = await searchParams;
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

  const dayStr = date ?? clinicDateString(new Date());
  const { from, to } = clinicDayWindow(dayStr);
  const cgQuery = caregiver ? `&caregiver=${caregiver}` : "";

  const org = await getPrimaryOrganization();
  const [shifts, caregivers] = org
    ? await Promise.all([
        listShiftsInWindow({
          organizationId: org.id,
          from,
          to,
          caregiverId: caregiver,
        }),
        listCaregivers(org.id),
      ])
    : [[], []];

  // Group by caregiver for the board.
  const byCaregiver = new Map<
    string,
    { name: string; shifts: typeof shifts; minutes: number }
  >();
  for (const s of shifts) {
    const key = s.caregiverId;
    const entry = byCaregiver.get(key) ?? {
      name: `${s.caregiverFirst} ${s.caregiverLast}`,
      shifts: [] as typeof shifts,
      minutes: 0,
    };
    entry.shifts.push(s);
    if (!["cancelled", "no_show"].includes(s.status)) {
      entry.minutes += shiftMinutes({ startAt: s.startAt, endAt: s.endAt });
    }
    byCaregiver.set(key, entry);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Care schedule</h1>
        <p className="text-sm text-muted">
          Home-care shifts by caregiver · {dayStr}
        </p>
      </div>

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
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
              href={`/care/schedule${caregiver ? `?caregiver=${caregiver}` : ""}`}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-primary hover:bg-warm"
            >
              Today
            </Link>
          </div>
          <form method="get" className="flex items-center gap-2">
            <input type="hidden" name="date" value={dayStr} />
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
      </Card>
    </div>
  );
}
