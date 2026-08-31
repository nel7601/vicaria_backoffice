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
        Each practitioner gets a private link they add once to Google, Apple,
        Outlook or Zoho Calendar; their schedule then keeps itself up to date.
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

      <ul className="divide-y divide-border rounded-md border border-border">
        {rows.length === 0 && (
          <li className="p-3 text-sm text-muted">
            No practitioners yet. Mark an employee as “sees patients” to give
            them a calendar.
          </li>
        )}
        {rows.map((row) => (
          <li key={row.employeeId} className="p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-medium">{row.name}</div>
                <div className="text-xs text-muted">
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
