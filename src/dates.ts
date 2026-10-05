const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function shortDate(iso: string): { day: string; month: string } {
  const d = new Date(iso);
  return { day: String(d.getDate()), month: MONTHS[d.getMonth()] };
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** "Today", "Yesterday", "12 Sep", or "12 Sep 2025" for other years. */
export function relativeDay(iso: string): string {
  const d = new Date(iso);
  const today = startOfDay(new Date());
  const diff = Math.round((today - startOfDay(d)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  const base = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === new Date().getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

/** "Today, 9:41 am", "Yesterday, 6:05 pm", or a date for older ones. */
export function relativeTime(iso: string): string {
  const day = relativeDay(iso);
  if (day !== 'Today' && day !== 'Yesterday') return day;
  const d = new Date(iso);
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${day}, ${h % 12 || 12}:${m} ${h < 12 ? 'am' : 'pm'}`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The calendar day of a moment, on this phone's clock: "2026-10-05". */
export function toDay(iso: string | Date = new Date()): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The moment to store for a chosen day. Today keeps the current time (so the
 * order of today's expenses stays right); another day is stored at midday,
 * so it reads as the same day in any time zone nearby. Editing without
 * changing the day keeps the original moment.
 */
export function fromDay(day: string, original?: string | null, now: Date = new Date()): string {
  if (original && toDay(original) === day) return original;
  if (day === toDay(now)) return now.toISOString();
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, 12).toISOString();
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Today", "Yesterday", "Fri, 2 Oct", or "Fri, 2 Oct 2025". */
export function dayLabel(day: string, now: Date = new Date()): string {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const diff = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - date.getTime()) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  const base = `${WEEKDAYS[date.getDay()]}, ${d} ${MONTHS[m - 1]}`;
  return y === now.getFullYear() ? base : `${base} ${y}`;
}
