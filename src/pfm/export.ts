// Money as a CSV file that opens in Excel or Google Sheets: your own records,
// your shares of group expenses, paying for friends and settle-ups.
import { paiseToInput } from '../money';
import type { Id } from '../types';
import { categoryPath, type Entry } from './logic';
import type { MoneyData } from './types';

function cell(v: string | number | undefined | null): string {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const HEADER = ['Date', 'Type', 'Category', 'Sub-category', 'Account', 'To account', 'Amount', 'Currency', 'Note', 'More details', 'Group'];

const TYPE: Record<Entry['kind'], string> = {
  expense: 'Expense',
  income: 'Income',
  transfer: 'Transfer',
  share: 'Your share (group)',
  paid: 'Paid for friends',
  settle: 'Settle-up',
};

/** One row per entry, newest first. Amounts are in each entry's own currency. */
export function buildMoneyCsv(m: MoneyData, entries: Entry[], groupName: (id: Id | null) => string): string {
  const acc = (id: Id | null | undefined) => (id ? m.accounts[id]?.name ?? 'Deleted account' : '');
  const rows: (string | number | undefined | null)[][] = [HEADER];
  const sorted = [...entries].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  for (const e of sorted) {
    const path = e.categoryId ? categoryPath(m.categories, e.categoryId) : [];
    const received =
      e.kind === 'transfer' && e.toCurrency && e.toCurrency !== e.currency && e.toAmount !== undefined
        ? `received ${paiseToInput(e.toAmount)} ${e.toCurrency}`
        : undefined;
    const note = [e.split ? e.title : undefined, e.note, received].filter(Boolean).join(' · ');
    rows.push([
      e.day,
      TYPE[e.kind],
      path[0] ?? '',
      path[1] ?? '',
      acc(e.accountId),
      e.kind === 'transfer' ? acc(e.toAccountId) : '',
      // Money out of you is negative for settle-ups you paid; everything else is as shown.
      e.kind === 'settle' && e.moved !== undefined && e.moved < 0 ? `-${paiseToInput(e.amount)}` : paiseToInput(e.amount),
      e.currency,
      note,
      e.details,
      e.split ? groupName(e.groupId) : '',
    ]);
  }
  return rows.map((r) => r.map(cell).join(',')).join('\n');
}
