import { describe, expect, it } from "vitest";
import {
  buildCalendar,
  escapeText,
  eventSummary,
  foldLine,
  formatUtc,
  icsStatus,
  initialsOf,
  type FeedAppointment,
} from "@/lib/domain/icalendar";

const appointment = (over: Partial<FeedAppointment> = {}): FeedAppointment => ({
  id: "11111111-2222-3333-4444-555555555555",
  startAt: new Date("2026-09-01T14:00:00Z"),
  endAt: new Date("2026-09-01T14:30:00Z"),
  status: "confirmed",
  modality: "in_person",
  serviceName: "Consultation",
  patientFirst: "Ana",
  patientLast: "Ruiz",
  updatedAt: new Date("2026-08-30T10:00:00Z"),
  ...over,
});

describe("escapeText", () => {
  it("escapes the characters that would otherwise end a property", () => {
    expect(escapeText("a;b,c")).toBe("a\\;b\\,c");
  });

  it("escapes backslashes without double-escaping the rest", () => {
    expect(escapeText("a\\b;c")).toBe("a\\\\b\\;c");
  });

  it("turns real newlines into the literal escape", () => {
    expect(escapeText("one\ntwo")).toBe("one\\ntwo");
  });
});

describe("foldLine", () => {
  it("leaves a short line alone", () => {
    expect(foldLine("SUMMARY:short")).toBe("SUMMARY:short");
  });

  it("folds at 75 octets with a leading space on continuations", () => {
    const folded = foldLine("SUMMARY:" + "x".repeat(200));
    const [first, ...rest] = folded.split("\r\n");
    expect(Buffer.from(first, "utf8").length).toBe(75);
    for (const line of rest) expect(line.startsWith(" ")).toBe(true);
    // Nothing is lost: unfolding restores the original.
    expect(folded.replace(/\r\n /g, "")).toBe("SUMMARY:" + "x".repeat(200));
  });

  it("never splits a multi-byte character", () => {
    // Accented names are two octets each, so a naive 75-character cut lands
    // mid-sequence and the line stops being valid UTF-8.
    const folded = foldLine("SUMMARY:" + "é".repeat(100));
    for (const line of folded.split("\r\n")) {
      const bytes = Buffer.from(line, "utf8");
      expect(bytes.toString("utf8")).toBe(line);
      expect(bytes.length).toBeLessThanOrEqual(75);
    }
    expect(folded.replace(/\r\n /g, "")).toBe("SUMMARY:" + "é".repeat(100));
  });
});

describe("formatUtc", () => {
  it("writes the basic UTC form calendars expect", () => {
    expect(formatUtc(new Date("2026-09-01T14:00:00Z"))).toBe("20260901T140000Z");
  });
});

describe("icsStatus", () => {
  it("keeps cancelled work visible as cancelled, not missing", () => {
    for (const s of ["cancelled", "no_show", "rescheduled"]) {
      expect(icsStatus(s)).toBe("CANCELLED");
    }
  });

  it("marks a booking that nobody has confirmed as tentative", () => {
    expect(icsStatus("scheduled")).toBe("TENTATIVE");
  });

  it("treats everything in progress or done as confirmed", () => {
    for (const s of ["confirmed", "checked_in", "in_progress", "completed"]) {
      expect(icsStatus(s)).toBe("CONFIRMED");
    }
  });
});

describe("eventSummary", () => {
  it("names nobody at the minimal level", () => {
    expect(eventSummary(appointment(), "minimal")).toBe("Consultation");
  });

  it("uses initials by default", () => {
    expect(eventSummary(appointment(), "initials")).toBe("Consultation — A.R.");
  });

  it("uses the full name only when asked to", () => {
    expect(eventSummary(appointment(), "full")).toBe("Consultation — Ana Ruiz");
  });

  it("falls back to a generic title when no service is set", () => {
    expect(eventSummary(appointment({ serviceName: null }), "minimal")).toBe(
      "Appointment",
    );
  });

  it("builds initials from accented names too", () => {
    expect(initialsOf("Álvaro", "Solé")).toBe("Á.S.");
  });
});

describe("buildCalendar", () => {
  const ics = (detail: "minimal" | "initials" | "full" = "initials") =>
    buildCalendar({
      calendarName: "Vicaria Health — Dr. Vega",
      appointments: [appointment()],
      detail,
      baseUrl: "https://admin.vicaria.ca",
      now: new Date("2026-08-31T12:00:00Z"),
    });

  it("wraps the events in a complete VCALENDAR", () => {
    const out = ics();
    expect(out.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(out.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(out).toContain("VERSION:2.0");
    expect(out).toContain("BEGIN:VEVENT");
    expect(out).toContain("END:VEVENT");
  });

  it("separates every line with CRLF, as the format requires", () => {
    expect(ics().split("\n").every((l) => l === "" || l.endsWith("\r"))).toBe(true);
  });

  it("gives each appointment a stable UID so updates replace, not duplicate", () => {
    expect(ics()).toContain(
      "UID:appointment-11111111-2222-3333-4444-555555555555@admin.vicaria.ca",
    );
  });

  it("links back to the appointment for the detail it does not carry", () => {
    expect(ics("minimal")).toContain(
      "https://admin.vicaria.ca/calendar/11111111-2222-3333-4444-555555555555",
    );
  });

  it("keeps the patient's name out of the feed unless detail is full", () => {
    expect(ics("minimal")).not.toContain("Ana");
    expect(ics("initials")).not.toContain("Ruiz");
    expect(ics("full")).toContain("Ana Ruiz");
  });

  it("writes times in UTC", () => {
    expect(ics()).toContain("DTSTART:20260901T140000Z");
    expect(ics()).toContain("DTEND:20260901T143000Z");
  });
});
