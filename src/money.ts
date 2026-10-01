// Currencies, and formatting/parsing of amounts.
//
// Every amount is stored as an integer number of hundredths of its currency
// (paise for rupees, satang for baht, cents for dollars), so maths never
// suffers from floating-point rounding.

export type CurrencyCode = string;

export interface Currency {
  code: CurrencyCode;
  symbol: string;
  name: string;
  /** Decimal places to show. Stored values always keep two. */
  decimals: 0 | 2;
  /** Rough value of one unit in rupees, only used to pre-fill exchange rates. */
  approxInr: number;
}

// Approximate rates (early 2026) as starting values. Groups set their own.
const LIST: Currency[] = [
  { code: 'INR', symbol: '₹', name: 'Indian rupee', decimals: 2, approxInr: 1 },
  { code: 'THB', symbol: '฿', name: 'Thai baht', decimals: 2, approxInr: 2.87 },
  { code: 'USD', symbol: '$', name: 'US dollar', decimals: 2, approxInr: 96 },
  { code: 'EUR', symbol: '€', name: 'Euro', decimals: 2, approxInr: 110 },
  { code: 'GBP', symbol: '£', name: 'British pound', decimals: 2, approxInr: 128 },
  { code: 'AED', symbol: 'AED', name: 'UAE dirham', decimals: 2, approxInr: 26.1 },
  { code: 'SGD', symbol: 'S$', name: 'Singapore dollar', decimals: 2, approxInr: 74 },
  { code: 'MYR', symbol: 'RM', name: 'Malaysian ringgit', decimals: 2, approxInr: 22.9 },
  { code: 'IDR', symbol: 'Rp', name: 'Indonesian rupiah', decimals: 0, approxInr: 0.0058 },
  { code: 'VND', symbol: '₫', name: 'Vietnamese dong', decimals: 0, approxInr: 0.0037 },
  { code: 'LKR', symbol: 'LKR', name: 'Sri Lankan rupee', decimals: 2, approxInr: 0.32 },
  { code: 'NPR', symbol: 'NPR', name: 'Nepalese rupee', decimals: 2, approxInr: 0.625 },
  { code: 'JPY', symbol: '¥', name: 'Japanese yen', decimals: 0, approxInr: 0.64 },
  { code: 'AUD', symbol: 'A$', name: 'Australian dollar', decimals: 2, approxInr: 63 },
  { code: 'CAD', symbol: 'C$', name: 'Canadian dollar', decimals: 2, approxInr: 70 },
];

export const CURRENCIES: Record<CurrencyCode, Currency> = Object.fromEntries(LIST.map((c) => [c.code, c]));
export const CURRENCY_CODES = LIST.map((c) => c.code);

export function currency(code: CurrencyCode): Currency {
  return CURRENCIES[code] ?? { code, symbol: code, name: code, decimals: 2, approxInr: 1 };
}

/** A sensible starting rate: how many `base` units one `code` unit is worth. */
export function approxRate(code: CurrencyCode, base: CurrencyCode): number {
  const r = currency(code).approxInr / currency(base).approxInr;
  // Keep 4 significant figures so the field is readable.
  return Number(r.toPrecision(4));
}

function groupDigits(intPart: string, indian: boolean): string {
  if (intPart.length <= 3) return intPart;
  if (!indian) return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  // 1234567 -> 12,34,567
  const last3 = intPart.slice(-3);
  let rest = intPart.slice(0, -3);
  const parts: string[] = [];
  while (rest.length > 2) {
    parts.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest) parts.unshift(rest);
  return parts.join(',') + ',' + last3;
}

/** 123450, 'INR' -> "₹1,234.50"; 45000, 'THB' -> "฿450"; 120000, 'AED' -> "AED 1,200" */
export function formatMoney(minor: number, code: CurrencyCode = 'INR', opts: { sign?: boolean } = {}): string {
  const c = currency(code);
  const neg = minor < 0;
  let abs = Math.abs(Math.round(minor));
  if (c.decimals === 0) abs = Math.round(abs / 100) * 100;
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  let num = groupDigits(String(whole), code === 'INR');
  if (frac !== 0) num += '.' + String(frac).padStart(2, '0');
  const s = /^[A-Z]{2,}$/.test(c.symbol) ? `${c.symbol} ${num}` : c.symbol + num;
  if (opts.sign && neg) return '−' + s;
  if (opts.sign && minor > 0) return '+' + s;
  return s;
}

/** Shorthand used across the app for rupee amounts. */
export function formatRupees(paise: number, opts: { sign?: boolean } = {}): string {
  return formatMoney(paise, 'INR', opts);
}

/** Plain number for payment links: 123450 -> "1234.50" */
export function paiseToDecimalString(minor: number): string {
  return (Math.round(minor) / 100).toFixed(2);
}

/** Stored amount -> editable input string: 45000 -> "450", 45050 -> "450.50" */
export function paiseToInput(minor: number): string {
  const whole = Math.floor(minor / 100);
  const frac = minor % 100;
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, '0')}`;
}

/**
 * Parse an amount typed by the user into hundredths.
 * Accepts "450", "450.5", "1,250.75", "₹ 300". Returns null if invalid.
 */
export function parseRupees(input: string): number | null {
  const cleaned = input.replace(/[^\d.]/g, (ch) => (/[,\s₹฿$€£¥₫]/.test(ch) ? '' : ch));
  if (cleaned === '') return null;
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const [whole, frac = ''] = cleaned.split('.');
  return Number(whole) * 100 + Number((frac + '00').slice(0, 2));
}
export const parseAmount = parseRupees;

/** Parse a plain positive decimal number (percent, share count or rate). */
export function parseNumber(input: string): number | null {
  const cleaned = input.replace(/[,\s%]/g, '');
  if (cleaned === '') return null;
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}
