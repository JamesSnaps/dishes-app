/**
 * Locale-free date labels for deliveries. Built by hand rather than with
 * toLocaleDateString because Node's ICU and browsers disagree on punctuation
 * ("Fri 30 Oct" vs "Fri, 30 Oct"), which breaks hydration. Pure, so client
 * components can use it too.
 */

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parts(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  const js = d.getUTCDay(); // 0 = Sun
  return { day: DAYS[js === 0 ? 6 : js - 1]!, date: d.getUTCDate(), month: MONTHS[d.getUTCMonth()]! };
}

/** "2026-10-19" → "Monday". */
export function weekdayName(date: string): string {
  return parts(date).day;
}

/** "2026-10-19" → "Mon". */
export function weekdayShort(date: string): string {
  return parts(date).day.slice(0, 3);
}

/** "2026-10-19" → "Mon 19 Oct". */
export function shortDate(date: string): string {
  const p = parts(date);
  return `${p.day.slice(0, 3)} ${p.date} ${p.month}`;
}
