/**
 * Wall-clock helpers for dinner reminders. Everything is expressed as a local
 * date ("YYYY-MM-DD") plus minutes since local midnight in the household's
 * timezone, so 17:00 means 17:00 on the kitchen clock year-round.
 */

export const DEFAULT_DINNER_TIME = "17:00";
export const DEFAULT_LEAD_MINUTES = 10;
export const DEFAULT_TIMEZONE = "Europe/London";

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTime(value: string): boolean {
  return HHMM.test(value);
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** "17:30" → 1050. Assumes a validated value. */
export function timeToMinutes(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h! * 60 + m!;
}

/** 1050 → "17:30". Wraps into 00:00–23:59. */
export function minutesToTime(total: number): string {
  const t = ((Math.round(total) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

export interface LocalNow {
  /** "YYYY-MM-DD" in the household timezone. */
  date: string;
  /** 0 = Mon … 6 = Sun, matching meal_plan_entries.day_of_week. */
  dayOfWeek: number;
  /** Minutes since local midnight. */
  minutes: number;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6,
};

export function localNow(timezone: string, at: Date = new Date()): LocalNow {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value])
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    dayOfWeek: WEEKDAY_INDEX[parts.weekday!] ?? 0,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

/** Date arithmetic on "YYYY-MM-DD" strings, done in UTC so DST can't skew it. */
export function addDaysToDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 0 = Mon … 6 = Sun for a "YYYY-MM-DD" date. */
export function dayOfWeekOf(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sun
  return day === 0 ? 6 : day - 1;
}

/** The Monday that starts the meal-plan week containing `date`. */
export function weekStartOf(date: string): string {
  return addDaysToDate(date, -dayOfWeekOf(date));
}
