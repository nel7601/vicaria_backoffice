/**
 * iCalendar (RFC 5545) generation for the personal calendar feed.
 *
 * Pure and self-contained so the format can be tested without a database or a
 * request: the rules that break real calendar clients — CRLF endings, folding
 * at 75 *octets* rather than characters, escaping in TEXT values — are easy to
 * get subtly wrong and impossible to notice until someone's phone silently
 * refuses the whole feed.
 */

/** How much an event may say about the patient (see company settings). */
export type CalendarDetail = "minimal" | "initials" | "full";

/**
 * One thing on an employee's calendar: a clinic appointment or a home-care
 * shift. Both lines of business publish through the same feed, because an
 * employee who does both wants one subscription, not two.
 */
export interface FeedEvent {
  id: string;
  /** Distinguishes the two so their ids can never collide in a UID. */
  kind: "appointment" | "shift";
  startAt: Date;
  endAt: Date;
  /** Status as stored; mapped to an iCalendar STATUS below. */
  status: string;
  /** What it is: the service booked, or the home-care visit. */
  title: string;
  /** Where it happens: the modality, or the client's home. */
  where: string;
  patientFirst: string;
  patientLast: string;
  updatedAt: Date;
  /** Path back into the backoffice for the detail this feed omits. */
  detailPath: string;
}

/** Escape a TEXT value: backslash first, or it would escape our own escapes. */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/**
 * Fold a content line to 75 octets, continuing with a leading space.
 *
 * The limit is octets, not characters: a name like "Solé" is one character
 * more but two octets more, and splitting inside a multi-byte sequence
 * produces invalid UTF-8 that some clients reject outright.
 */
export function foldLine(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;

  const parts: string[] = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Never cut mid-character: continuation bytes are 10xxxxxx.
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) {
      end--;
    }
    parts.push(bytes.subarray(start, end).toString("utf8"));
    start = end;
    limit = 74; // continuation lines carry a leading space
  }
  return parts.join("\r\n ");
}

/** UTC timestamp in the basic format calendars expect: 20260901T140000Z. */
export function formatUtc(date: Date): string {
  return `${date.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
}

/**
 * Map an appointment status onto iCalendar's three.
 *
 * Cancelled work stays in the feed as CANCELLED rather than vanishing: a
 * client that simply stops seeing an event may leave it on screen, and a
 * practitioner who still sees a cancelled visit will show up for it.
 */
export function icsStatus(status: string): "CONFIRMED" | "TENTATIVE" | "CANCELLED" {
  switch (status) {
    case "cancelled":
    case "no_show":
    case "rescheduled":
    // A missed shift is one nobody attended; it holds no time either.
    case "missed":
      return "CANCELLED";
    case "scheduled":
      return "TENTATIVE";
    default:
      return "CONFIRMED";
  }
}

/** Initials, for the detail level that names no one: "Ana Ruiz" → "A.R." */
export function initialsOf(first: string, last: string): string {
  const letters = [first, last]
    .map((part) => part.trim()[0])
    .filter(Boolean)
    .map((c) => `${c!.toUpperCase()}.`);
  return letters.join("");
}

/** The event title, at the detail level the organization allows. */
export function eventSummary(
  event: FeedEvent,
  detail: CalendarDetail,
): string {
  const what = event.title.trim() || "Appointment";
  if (detail === "minimal") return what;
  const who =
    detail === "full"
      ? `${event.patientFirst} ${event.patientLast}`.trim()
      : initialsOf(event.patientFirst, event.patientLast);
  return who ? `${what} — ${who}` : what;
}

function modalityLabel(modality: string): string {
  return modality.replace(/_/g, " ");
}

export interface CalendarOptions {
  /** Shown as the calendar's name once subscribed. */
  calendarName: string;
  events: FeedEvent[];
  detail: CalendarDetail;
  /** Absolute origin, e.g. https://admin.vicaria.ca — used for links and UIDs. */
  baseUrl: string;
  now?: Date;
}

/** Build the whole VCALENDAR document. */
export function buildCalendar(options: CalendarOptions): string {
  const { calendarName, events, detail, baseUrl } = options;
  const now = options.now ?? new Date();
  const host = hostOf(baseUrl);

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Vicaria Health//Backoffice//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(calendarName)}`,
    "X-WR-TIMEZONE:America/Toronto",
    // A hint, not a promise: clients refresh when they choose to.
    "REFRESH-INTERVAL;VALUE=DURATION:PT15M",
    "X-PUBLISHED-TTL:PT15M",
  ];

  for (const event of events) {
    const detailUrl = `${baseUrl}${event.detailPath}`;
    const where = modalityLabel(event.where);
    const description =
      detail === "minimal"
        ? `${where}\n\nOpen in Vicaria: ${detailUrl}`
        : `${eventSummary(event, detail)}\n${where}\n\nOpen in Vicaria: ${detailUrl}`;

    lines.push(
      "BEGIN:VEVENT",
      `UID:${event.kind}-${event.id}@${host}`,
      `DTSTAMP:${formatUtc(now)}`,
      `DTSTART:${formatUtc(event.startAt)}`,
      `DTEND:${formatUtc(event.endAt)}`,
      `LAST-MODIFIED:${formatUtc(event.updatedAt)}`,
      `SUMMARY:${escapeText(eventSummary(event, detail))}`,
      `DESCRIPTION:${escapeText(description)}`,
      `LOCATION:${escapeText(where)}`,
      `URL:${detailUrl}`,
      `STATUS:${icsStatus(event.status)}`,
      // The clinic owns these events; nobody should edit them in their phone.
      "TRANSP:OPAQUE",
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return "vicaria";
  }
}
