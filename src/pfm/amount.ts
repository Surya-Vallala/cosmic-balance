// The amount keypad: digits, a decimal point, and + / − to add things up
// ("850+120−50" is 920).
import { parseRupees } from '../money';

/** What the keypad shows, worked out in hundredths; null if it isn't a sum yet. */
export function evalAmount(expr: string): number | null {
  const s = expr.replace(/\s|,/g, '').replace(/−/g, '-');
  if (!s) return null;
  const parts = s.match(/[+-]?[^+-]+/g);
  if (!parts || parts.join('') !== s) return null;
  let total = 0;
  for (const p of parts) {
    const neg = p.startsWith('-');
    const v = parseRupees(p.replace(/^[+-]/, ''));
    if (v === null) return null;
    total += neg ? -v : v;
  }
  return total;
}

/** Whether the keypad text has a sum in it (so Done shows "=" first). */
export const hasSum = (expr: string) => /[+\-−]/.test(expr.replace(/^[+\-−]/, ''));

/** Typing a key into the keypad text. */
export function pressKey(expr: string, key: string): string {
  if (key === 'back') return expr.slice(0, -1);
  if (key === 'clear') return '';
  const last = expr.slice(-1);
  const isOp = (c: string) => c === '+' || c === '−';
  if (isOp(key)) {
    if (!expr) return expr;
    return isOp(last) ? expr.slice(0, -1) + key : expr + key;
  }
  // The number being typed now (after the last + or −).
  const current = expr.split(/[+−]/).pop() ?? '';
  if (key === '.') {
    if (current.includes('.')) return expr;
    return expr + (current ? '.' : '0.');
  }
  if (/^\d+$/.test(key)) {
    const dot = current.indexOf('.');
    if (dot >= 0 && current.length - dot - 1 + key.length > 2) return expr; // two decimals at most
    if (current.replace('.', '').length >= 12) return expr;
    if (current === '0' && key !== '.') return expr.slice(0, -1) + key.replace(/^0+(?=\d)/, '');
    return expr + key;
  }
  return expr;
}
