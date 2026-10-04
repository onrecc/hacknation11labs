/** Local-calendar dates for people ("Today", "Yesterday 17:40"), never UTC slices of ISO strings. */

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const pad = (n: number): string => String(n).padStart(2, "0");

/** YYYY-MM-DD of `d` in the user's time zone (`toISOString()` would give the UTC day). */
export function localDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseYmd(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

function labelOf(d: Date, now: Date): string {
  const day = localDate(d);
  if (day === localDate(now)) return "Today";
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (day === localDate(yesterday)) return "Yesterday";
  const base = `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

/** "Today", "Yesterday" or "Mon 28 Sep" for a YYYY-MM-DD calendar day; anything else is returned as is. */
export function dayLabel(ymd: string, now: Date = new Date()): string {
  const d = parseYmd(ymd);
  return d ? labelOf(d, now) : ymd;
}

/** "Today 08:05", "Yesterday 17:40", "Wed 30 Sep 12:00" for an ISO timestamp, in local time. */
export function whenLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return `${labelOf(d, now)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
