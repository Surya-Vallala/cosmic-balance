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
