"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { inputClass } from "@/components/ui/field";
import {
  issueCalendarFeedAction,
  revokeCalendarFeedAction,
  setCalendarFeedDetailAction,
} from "./calendar-sync-actions";
import { deleteBtnClass, editBtnClass } from "./services-section";

export type FeedDetail = "minimal" | "initials" | "full";

export interface CalendarFeedRow {
  employeeId: string;
  name: string;
  /** What this person's feed publishes: appointments, shifts, or both. */
  carries: string;
  /** Full subscription URL, or null when this employee has no live link. */
  url: string | null;
  lastUsedAt: string | null;
}

const DETAIL_LABEL: Record<FeedDetail, string> = {
  minimal: "Service only — “Consultation”",
  initials: "Service and initials — “Consultation — A.R.”",
  full: "Service and full name — “Consultation — Ana Ruiz”",
};

function fmtUsed(iso: string | null): string {
  if (!iso) return "never fetched";
  return `last fetched ${new Date(iso).toLocaleString("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Toronto",
  })}`;
}

/**
 * Subscription links for practitioners, plus the one setting that decides how
 * much those events may reveal.
 */
export function CalendarSyncSection({
  rows,
  detail,
  canEdit,
}: {
  rows: CalendarFeedRow[];
  detail: FeedDetail;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  function issue(employeeId: string, replacing: boolean) {
    if (
      replacing &&
      !window.confirm(
        "Replace this link? The current one stops working immediately and the employee has to subscribe again.",
      )
    )
      return;
    setError(null);
    startTransition(async () => {
      const res = await issueCalendarFeedAction(employeeId);
      if (res.ok) router.refresh();
      else setError(res.error ?? "Could not create the link.");
    });
  }

  function revoke(employeeId: string) {
    if (
      !window.confirm(
        "Revoke this link? Their calendar will stop updating until a new one is issued.",
      )
    )
      return;
    setError(null);
    startTransition(async () => {
      const res = await revokeCalendarFeedAction(employeeId);
      if (res.ok) router.refresh();
      else setError(res.error ?? "Could not revoke the link.");
    });
  }

  function changeDetail(next: FeedDetail) {
    setError(null);
    startTransition(async () => {
      const res = await setCalendarFeedDetailAction(next);
      if (res.ok) router.refresh();
      else setError(res.error ?? "Could not change the setting.");
    });
  }

  async function copy(url: string, employeeId: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(employeeId);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError("Could not copy — select the link and copy it manually.");
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Practitioners and caregivers get a private link they add once to
        Google, Apple, Outlook or Zoho Calendar; their schedule — clinic
        appointments, home-care shifts, or both — then keeps itself up to date.
        The link is read-only — nobody can book from their phone — and it is the
        credential, so treat it like a password and replace it if it is shared
        by mistake. Calendars refresh on their own schedule: Apple within
        minutes, Google can take several hours.
      </p>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">What the events say</span>
        <select
          className={`${inputClass} max-w-lg`}
          value={detail}
          disabled={!canEdit || pending}
          onChange={(e) => changeDetail(e.target.value as FeedDetail)}
        >
          {(Object.keys(DETAIL_LABEL) as FeedDetail[]).map((d) => (
            <option key={d} value={d}>
              {DETAIL_LABEL[d]}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted">
          These events are stored by Google, Apple or Zoho, outside the clinic.
          Every level links back here for the full record, so the name only ever
          needs to leave if you decide it should.
        </span>
      </label>

      <details className="rounded-md border border-border bg-surface-muted p-3 text-sm">
        <summary className="cursor-pointer font-medium">
          How to subscribe (send this with the link)
        </summary>
        <div className="mt-3 space-y-3 text-muted">
          <div>
            <div className="font-medium text-foreground">Google Calendar</div>
            <p>
              Do this on a computer — the phone app cannot subscribe to a link,
              though the calendar shows up there once it is added. At{" "}
              <span className="font-mono text-xs">calendar.google.com</span>,
              find <em>Other calendars</em> in the left column, press the{" "}
              <strong>+</strong> beside it, choose <strong>From URL</strong>,
              paste the link and press <em>Add calendar</em>.
            </p>
            <p className="mt-1">
              Do not use <em>Import</em>: that copies today&apos;s appointments
              once and never updates them again.
            </p>
          </div>
          <div>
            <div className="font-medium text-foreground">
              iPhone, iPad or Mac
            </div>
            <p>
              iPhone: Settings → Apps → Calendar → Calendar Accounts → Add
              Account → Other → Add Subscribed Calendar, then paste the link.
              Mac: Calendar → File → New Calendar Subscription. Apple lets you
              choose how often it refreshes; every 15 minutes is a good setting.
            </p>
          </div>
          <div>
            <div className="font-medium text-foreground">Outlook</div>
            <p>
              At <span className="font-mono text-xs">outlook.com</span>:
              Calendar → Add calendar → Subscribe from web, paste the link and
              give it a name.
            </p>
          </div>
        </div>
      </details>

      <ul className="divide-y divide-border rounded-md border border-border">
        {rows.length === 0 && (
          <li className="p-3 text-sm text-muted">
            Nobody has a schedule yet. Mark an employee as “sees patients” or
            “caregiver” to give them a calendar.
          </li>
        )}
        {rows.map((row) => (
          <li key={row.employeeId} className="p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-medium">{row.name}</div>
                <div className="text-xs text-muted">
                  {row.carries} ·{" "}
                  {row.url ? fmtUsed(row.lastUsedAt) : "no link issued"}
                </div>
              </div>
              {canEdit && (
                <div className="flex gap-1.5">
                  <button
                    onClick={() => issue(row.employeeId, Boolean(row.url))}
                    disabled={pending}
                    className={editBtnClass}
                  >
                    {row.url ? "Replace link" : "Create link"}
                  </button>
                  {row.url && (
                    <button
                      onClick={() => revoke(row.employeeId)}
                      disabled={pending}
                      className={deleteBtnClass}
                    >
                      Revoke
                    </button>
                  )}
                </div>
              )}
            </div>
            {row.url && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  readOnly
                  value={row.url}
                  onFocus={(e) => e.currentTarget.select()}
                  className={`${inputClass} flex-1 font-mono text-xs`}
                />
                <button
                  onClick={() => copy(row.url!, row.employeeId)}
                  className={editBtnClass}
                >
                  {copied === row.employeeId ? "Copied" : "Copy"}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
