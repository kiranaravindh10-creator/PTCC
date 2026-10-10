import { describe, expect, it } from "vitest";
import {
  addDays,
  companyDayStart,
  companyToday,
  daysBetween,
  dueGroup,
  formatDayLabel,
  formatDue,
  formatTime12h,
  greetingFor,
  isIsoDate,
  toHourMinute,
} from "./time";

describe("company time zone", () => {
  it("uses India time for 'today', not the server's UTC date", () => {
    // 20:00 UTC on 7 Oct is 01:30 IST on 8 Oct.
    expect(companyToday(new Date("2026-10-07T20:00:00Z"))).toBe("2026-10-08");
    expect(companyToday(new Date("2026-10-07T18:00:00Z"))).toBe("2026-10-07");
  });

  it("starts the company day at midnight IST", () => {
    expect(companyDayStart("2026-10-08").toISOString()).toBe("2026-10-07T18:30:00.000Z");
  });

  it("greets by India time of day", () => {
    expect(greetingFor(new Date("2026-10-08T03:00:00Z"))).toBe("Good morning"); // 08:30 IST
    expect(greetingFor(new Date("2026-10-08T08:00:00Z"))).toBe("Good afternoon"); // 13:30 IST
    expect(greetingFor(new Date("2026-10-08T13:00:00Z"))).toBe("Good evening"); // 18:30 IST
  });
});

describe("calendar arithmetic", () => {
  it("adds days across month and year ends", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("counts days between dates", () => {
    expect(daysBetween("2026-10-08", "2026-10-10")).toBe(2);
    expect(daysBetween("2026-10-08", "2026-10-07")).toBe(-1);
  });

  it("validates ISO dates", () => {
    expect(isIsoDate("2026-10-08")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("08/10/2026")).toBe(false);
  });
});

describe("formatting", () => {
  it("formats 12-hour times", () => {
    expect(formatTime12h("00:05")).toBe("12:05 AM");
    expect(formatTime12h("10:30:00")).toBe("10:30 AM");
    expect(formatTime12h("12:00")).toBe("12:00 PM");
    expect(formatTime12h("16:45")).toBe("4:45 PM");
  });

  it("normalises time values", () => {
    expect(toHourMinute("9:05:00")).toBe("09:05");
    expect(toHourMinute(null)).toBeNull();
  });

  it("labels days relative to today", () => {
    const today = "2026-10-08"; // Thursday
    expect(formatDayLabel("2026-10-08", today)).toBe("Today");
    expect(formatDayLabel("2026-10-09", today)).toBe("Tomorrow");
    expect(formatDayLabel("2026-10-07", today)).toBe("Yesterday");
    expect(formatDayLabel("2026-10-12", today)).toBe("Mon, 12 Oct");
    expect(formatDayLabel("2026-11-20", today)).toBe("20 Nov");
    expect(formatDayLabel("2027-01-05", today)).toBe("5 Jan 2027");
  });

  it("describes when work is due", () => {
    const today = "2026-10-08";
    expect(formatDue("2026-10-08", "10:30", today)).toBe("Today, 10:30 AM");
    expect(formatDue("2026-10-08", "10:30", today, { includeDay: false })).toBe("10:30 AM");
    expect(formatDue("2026-10-08", null, today, { includeDay: false })).toBe("Today");
    expect(formatDue("2026-10-09", null, today)).toBe("Tomorrow");
    expect(formatDue(null, null, today)).toBe("No date");
  });

  it("groups work by due date", () => {
    const today = "2026-10-08";
    expect(dueGroup("2026-10-01", today)).toBe("overdue");
    expect(dueGroup("2026-10-08", today)).toBe("today");
    expect(dueGroup("2026-10-09", today)).toBe("tomorrow");
    expect(dueGroup("2026-10-20", today)).toBe("upcoming");
    expect(dueGroup(null, today)).toBe("unscheduled");
  });
});
