// Export everything to a CSV file that opens in Excel or Google Sheets.
import { Platform, Share } from 'react-native';
import { paiseToInput } from './money';
import type { AppState, Id } from './types';

function cell(v: string | number | undefined): string {
  const s = v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildCsv(state: AppState): string {
  const name = (id: Id) => (id === state.meId ? `${state.people[id]?.name ?? 'Me'} (me)` : state.people[id]?.name ?? 'Unknown');
  const groupName = (id: Id | null) => (id ? state.groups.find((g) => g.id === id)?.name ?? '' : '(no group)');
  const list = (rec: Record<Id, number>) =>
    Object.entries(rec)
      .map(([id, v]) => `${name(id)}: ${paiseToInput(v)}`)
      .join('; ');

  const rows: (string | number | undefined)[][] = [
    ['Date', 'Type', 'Group', 'Description', 'Currency', 'Amount', 'Paid by', 'Split between', 'From', 'To', 'Note'],
  ];
  for (const e of state.expenses) {
    rows.push([e.date.slice(0, 10), 'Expense', groupName(e.groupId), e.description, e.currency, paiseToInput(e.amount), list(e.payers), list(e.shares), '', '', '']);
  }
  for (const p of state.payments) {
    rows.push([
      p.date.slice(0, 10),
      p.settlementId ? 'Settle-up (balancing)' : 'Payment',
      groupName(p.groupId),
      '',
      p.currency,
      paiseToInput(p.amount),
      '',
      '',
      name(p.from),
      name(p.to),
      '',
    ]);
  }
  for (const t of state.transfers) {
    rows.push([
      t.date.slice(0, 10),
      t.kind === 'settlement' ? 'Overall settle-up' : 'Transfer',
      '',
      '',
      t.currency,
      paiseToInput(t.amount),
      '',
      '',
      name(t.from),
      name(t.to),
      t.note,
    ]);
  }
  const [header, ...body] = rows;
  body.sort((a, b) => String(b[0]).localeCompare(String(a[0])));
  return [header, ...body].map((r) => r.map(cell).join(',')).join('\n');
}

/** Save (web) or share (phone app) the CSV. Returns a short status message. */
export async function exportCsv(state: AppState): Promise<string> {
  const csv = buildCsv(state);
  const filename = `cosmic-balance-${new Date().toISOString().slice(0, 10)}.csv`;
  if (Platform.OS === 'web') {
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return `Saved ${filename}. Open it in Excel or Google Sheets.`;
  }
  await Share.share({ title: filename, message: csv });
  return 'Shared. Save it somewhere safe, like your email or Drive.';
}
