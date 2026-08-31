import { type NextRequest } from "next/server";
import {
  listFeedEvents,
  resolveFeedToken,
  touchFeedToken,
} from "@/lib/db/queries/calendar-feed";
import { buildCalendar } from "@/lib/domain/icalendar";
import { publicOrigin } from "@/lib/site-url";

/**
 * The personal calendar feed: one employee's schedule as iCalendar.
 *
 * Subscribed to by Google, Apple, Outlook or Zoho, none of which can sign in —
 * so the secret URL is the credential, and it is checked on every fetch
 * against a token that can be revoked. What the events reveal about a patient
 * is capped by the organization's setting, because these end up stored on
 * servers we do not control.
 *
 * Never cached: a calendar client asking again should get today's answer.
 */
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token: raw } = await params;
  // Clients are happier with a URL that ends in .ics; the token is the rest.
  const token = raw.replace(/\.ics$/i, "");

  const subscription = await resolveFeedToken(token);
  if (!subscription) {
    return new Response("Calendar not found.", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const now = new Date();
  const events = await listFeedEvents(subscription, now);
  // Best effort: a feed that cannot record its own use is still a working feed.
  await touchFeedToken(token).catch(() => {});

  const body = buildCalendar({
    // Name it for what it carries, so someone who does both kinds of work
    // does not wonder why their shifts are under "Vicaria Health".
    calendarName: `${
      subscription.isPractitioner && subscription.isCaregiver
        ? "Vicaria"
        : subscription.isCaregiver
          ? "Vicaria Care"
          : "Vicaria Health"
    } — ${subscription.employeeName}`,
    events,
    detail: subscription.detail,
    baseUrl: publicOrigin(request),
    now,
  });

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'inline; filename="vicaria.ics"',
      "cache-control": "no-store, max-age=0",
    },
  });
}
