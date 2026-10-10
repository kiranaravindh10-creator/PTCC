/**
 * Date and time helpers anchored to PTCC's time zone.
 *
 * PTCC operates in India, so "today", "overdue" and greetings are always computed in
 * India Standard Time, regardless of where the server runs (e.g. UTC on Vercel).
 * Work is scheduled with a calendar date (`YYYY-MM-DD`) and an optional wall-clock
 * time (`HH:MM`) in this zone — see docs/DATABASE_ARCHITECTURE.md §1.
 */

export const COMPANY_TIME_ZONE = "Asia/Kolkata";
/** India Standard Time has a fixed offset (no daylight saving). */
export const COMPANY_UTC_OFFSET = "+05:30";

/** A calendar date in the company time zone, formatted `YYYY-MM-DD`. */
export type IsoDate = string;

const ymdFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: COMPANY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const hourMinuteFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: COMPANY_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const longDateFormatter = new Intl.DateTimeFormat("en-IN", {
  timeZone: COMPANY_TIME_ZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
});

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Today's date in the company time zone. */
export function companyToday(now: Date = new Date()): IsoDate {
  return ymdFormatter.format(now);
}

/** The instant a company calendar day starts (midnight IST). */
export function companyDayStart(date: IsoDate): Date {
  return new Date(`${date}T00:00:00${COMPANY_UTC_OFFSET}`);
}

/** Current wall-clock time in the company time zone, `HH:MM` (24-hour). */
export function companyTimeNow(now: Date = new Date()): string {
  return hourMinuteFormatter.format(now);
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = parseIsoDate(value);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function parseIsoDate(value: IsoDate): [number, number, number] {
  const [y = NaN, m = NaN, d = NaN] = value.split("-").map(Number);
  return [y, m, d];
}

function toUtcDate(value: IsoDate): Date {
  const [y, m, d] = parseIsoDate(value);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const result = toUtcDate(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtcDate(to).getTime() - toUtcDate(from).getTime()) / 86_400_000);
}

/** Normalises a Postgres `time` value (`HH:MM:SS`) or input value to `HH:MM`. */
export function toHourMinute(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!match) return null;
  return `${match[1]!.padStart(2, "0")}:${match[2]}`;
}

/** `14:05` → `2:05 PM` */
export function formatTime12h(value: string): string {
  const hm = toHourMinute(value);
  if (!hm) return value;
  const [h, m] = hm.split(":").map(Number) as [number, number];
  const suffix = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** "Good morning" / "Good afternoon" / "Good evening" in company time. */
export function greetingFor(now: Date = new Date()): string {
  const hour = Number(companyTimeNow(now).slice(0, 2));
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/** "Thursday, 8 October" */
export function formatLongDate(now: Date = new Date()): string {
  return longDateFormatter.format(now);
}

/** "Today" · "Tomorrow" · "Yesterday" · "Wed, 14 Oct" · "14 Oct 2027" */
export function formatDayLabel(date: IsoDate, today: IsoDate): string {
  const diff = daysBetween(today, date);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  const d = toUtcDate(date);
  const sameYear = date.slice(0, 4) === today.slice(0, 4);
  if (sameYear && Math.abs(diff) < 7) {
    return `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  }
  return sameYear
    ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
    : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export type DueGroup = "overdue" | "today" | "tomorrow" | "upcoming" | "unscheduled";

export function dueGroup(dueDate: IsoDate | null, today: IsoDate): DueGroup {
  if (!dueDate) return "unscheduled";
  const diff = daysBetween(today, dueDate);
  if (diff < 0) return "overdue";
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  return "upcoming";
}

/**
 * Human label for when work is due.
 * `{ includeDay: false }` omits "Today" for rows already grouped under Today.
 */
export function formatDue(
  dueDate: IsoDate | null,
  dueTime: string | null,
  today: IsoDate,
  options: { includeDay?: boolean } = {},
): string {
  if (!dueDate) return "No date";
  const includeDay = options.includeDay ?? true;
  const day = formatDayLabel(dueDate, today);
  const time = dueTime ? formatTime12h(dueTime) : null;
  if (!includeDay && day === "Today") return time ?? "Today";
  return time ? `${day}, ${time}` : day;
}

/** "Thu, 8 Oct" or "Thu, 8 Oct, 10:30 AM" — absolute, for text that is stored (e.g. notifications). */
export function formatAbsoluteDue(date: IsoDate, time: string | null): string {
  const d = toUtcDate(date);
  const day = `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return time ? `${day}, ${formatTime12h(time)}` : day;
}

/** Timestamp label for history and notifications: "10:42 AM", "Yesterday, 10:42 AM", "14 Oct, 10:42 AM". */
export function formatTimestamp(at: Date, now: Date = new Date()): string {
  const time = formatTime12h(companyTimeNow(at));
  const day = formatDayLabel(companyToday(at), companyToday(now));
  return day === "Today" ? time : `${day}, ${time}`;
}

/** Short relative time for recent events: "Just now", "5 min ago", "2 h ago", then a timestamp. */
export function formatRelative(at: Date, now: Date = new Date()): string {
  const seconds = Math.round((now.getTime() - at.getTime()) / 1000);
  if (seconds < 60) return "Just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 12) return `${hours} h ago`;
  return formatTimestamp(at, now);
}
