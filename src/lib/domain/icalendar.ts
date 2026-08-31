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

export interface FeedAppointment {
  id: string;
  startAt: Date;
  endAt: Date;
  /** Appointment status as stored; mapped to an iCalendar STATUS below. */
  status: string;
  modality: string;
  serviceName: string | null;
  patientFirst: string;
  patientLast: string;
  updatedAt: Date;
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
  appointment: FeedAppointment,
  detail: CalendarDetail,
): string {
  const service = appointment.serviceName?.trim() || "Appointment";
  if (detail === "minimal") return service;
  const who =
    detail === "full"
      ? `${appointment.patientFirst} ${appointment.patientLast}`.trim()
      : initialsOf(appointment.patientFirst, appointment.patientLast);
  return who ? `${service} — ${who}` : service;
}

function modalityLabel(modality: string): string {
  return modality.replace(/_/g, " ");
}

export interface CalendarOptions {
  /** Shown as the calendar's name once subscribed. */
  calendarName: string;
  appointments: FeedAppointment[];
  detail: CalendarDetail;
  /** Absolute origin, e.g. https://admin.vicaria.ca — used for links and UIDs. */
  baseUrl: string;
  now?: Date;
}

/** Build the whole VCALENDAR document. */
export function buildCalendar(options: CalendarOptions): string {
  const { calendarName, appointments, detail, baseUrl } = options;
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

  for (const appointment of appointments) {
    const detailUrl = `${baseUrl}/calendar/${appointment.id}`;
    const description =
      detail === "minimal"
        ? `${modalityLabel(appointment.modality)}\n\nOpen in Vicaria: ${detailUrl}`
        : `${eventSummary(appointment, detail)}\n${modalityLabel(appointment.modality)}\n\nOpen in Vicaria: ${detailUrl}`;

    lines.push(
      "BEGIN:VEVENT",
      `UID:appointment-${appointment.id}@${host}`,
      `DTSTAMP:${formatUtc(now)}`,
      `DTSTART:${formatUtc(appointment.startAt)}`,
      `DTEND:${formatUtc(appointment.endAt)}`,
      `LAST-MODIFIED:${formatUtc(appointment.updatedAt)}`,
      `SUMMARY:${escapeText(eventSummary(appointment, detail))}`,
      `DESCRIPTION:${escapeText(description)}`,
      `LOCATION:${escapeText(modalityLabel(appointment.modality))}`,
      `URL:${detailUrl}`,
      `STATUS:${icsStatus(appointment.status)}`,
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
