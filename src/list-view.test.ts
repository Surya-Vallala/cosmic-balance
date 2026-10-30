import { describe, expect, it } from 'vitest';
import { dateWords, matchesSearch, sectionKey, sectionLabel, sections, sectionsBy, sectionSummary } from './list-view';

const NOW = new Date(2026, 9, 30, 16, 0); // Fri 30 Oct 2026
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).toISOString();

describe('sections by day or month', () => {
  const items = [
    { id: 'a', date: at(2026, 10, 30, 15) },
    { id: 'b', date: at(2026, 10, 30, 9) },
    { id: 'c', date: at(2026, 10, 29) },
    { id: 'd', date: at(2026, 10, 21) },
    { id: 'e', date: at(2026, 9, 2) },
    { id: 'f', date: at(2025, 12, 31) },
  ];
  it('by day: one section per calendar day, newest first, order kept', () => {
    const s = sections(items, 'day', NOW);
    expect(s.map((x) => x.label)).toEqual(['Today', 'Yesterday', 'Wed, 21 Oct', 'Wed, 2 Sep', 'Wed, 31 Dec 2025']);
    expect(s[0].items.map((x) => x.id)).toEqual(['a', 'b']);
  });
  it('by month: the month, with the year only for other years', () => {
    const s = sections(items, 'month', NOW);
    expect(s.map((x) => x.label)).toEqual(['October', 'September', 'December 2025']);
    expect(s[0].items.map((x) => x.id)).toEqual(['a', 'b', 'c', 'd']);
  });
  it('by day for a trip, by month for a list spanning more than six weeks', () => {
    expect(sectionsBy([{ date: at(2026, 10, 30) }, { date: at(2026, 10, 21) }])).toBe('day');
    expect(sectionsBy([{ date: at(2026, 10, 30) }, { date: at(2026, 9, 15) }])).toBe('day'); // 45 days
    expect(sectionsBy([{ date: at(2026, 10, 30) }, { date: at(2026, 9, 14) }])).toBe('month');
    expect(sectionsBy(items)).toBe('month');
    expect(sectionsBy([])).toBe('day');
  });
  it('keys follow the phone’s calendar', () => {
    expect(sectionKey(at(2026, 10, 30, 23), 'day')).toBe('2026-10-30');
    expect(sectionKey(at(2026, 10, 30, 0), 'month')).toBe('2026-10');
    expect(sectionLabel('2026-01', 'month', NOW)).toBe('January');
  });
});

describe('finding an expense by typing', () => {
  const taxi = ['Taxi to the airport', 'Shared with the Bangkok gang', 'Ravi Kumar', 'You', 'Surya', 'THB'];
  const when = [at(2026, 10, 21)];
  it('any part of the description, remarks or a name; any case or accent', () => {
    expect(matchesSearch('taxi', taxi)).toBe(true);
    expect(matchesSearch('AIRPORT', taxi)).toBe(true);
    expect(matchesSearch('bangkok', taxi)).toBe(true);
    expect(matchesSearch('ravi', taxi)).toBe(true);
    expect(matchesSearch('cafe', ['Café Amazon'])).toBe(true);
    expect(matchesSearch('massage', taxi)).toBe(false);
  });
  it('every word must be found, anywhere', () => {
    expect(matchesSearch('taxi ravi', taxi)).toBe(true);
    expect(matchesSearch('ravi taxi', taxi)).toBe(true);
    expect(matchesSearch('taxi priya', taxi)).toBe(false);
  });
  it('by its date: whole words (so “26” isn’t found in 2026), or the start of a day or month name', () => {
    expect(matchesSearch('21 oct', taxi, [], when)).toBe(true);
    expect(matchesSearch('wednesday', taxi, [], when)).toBe(true);
    expect(matchesSearch('wed', taxi, [], when)).toBe(true);
    expect(matchesSearch('october 2026', taxi, [], when)).toBe(true);
    expect(matchesSearch('22 oct', taxi, [], when)).toBe(false);
    expect(matchesSearch('26', taxi, [], when)).toBe(false);
    expect(matchesSearch('2', taxi, [], when)).toBe(false);
    expect(dateWords(at(2026, 10, 21))).toEqual(['wednesday', '21', 'oct', 'october', '2026']);
  });
  it('by amount, typed as you like', () => {
    const amounts = [180000, 60000]; // ₹1,800 total, ₹600 your part
    for (const q of ['1800', '1,800', '₹1800', '₹1,800', '600', '1800.00']) expect(matchesSearch(q, ['Taxi'], amounts)).toBe(true);
    expect(matchesSearch('180', ['Taxi'], amounts)).toBe(false);
    expect(matchesSearch('1801', ['Taxi'], amounts)).toBe(false);
    expect(matchesSearch('1800', ['Taxi'], [180050])).toBe(true); // ₹1,800.50
    expect(matchesSearch('1800.5', ['Taxi'], [180050])).toBe(true);
    expect(matchesSearch('1800.5', ['Taxi'], [180000])).toBe(false);
  });
  it('a number in the text counts too ("3 nights")', () => {
    expect(matchesSearch('3 nights', ['Hostel, 3 nights'], [1860000])).toBe(true);
  });
  it('nothing typed: everything', () => {
    expect(matchesSearch('  ', taxi)).toBe(true);
  });
});

describe('what a section holds', () => {
  it('counts and what was spent', () => {
    expect(
      sectionSummary([
        { kind: 'expense', spent: { amount: 300000, currency: 'INR' } },
        { kind: 'expense', spent: { amount: 120000, currency: 'INR' } },
        { kind: 'payment' },
      ]),
    ).toBe('2 expenses, 1 payment · ₹4,200');
    expect(sectionSummary([{ kind: 'expense', spent: { amount: 50000, currency: 'INR' } }])).toBe('1 expense · ₹500');
    expect(sectionSummary([{ kind: 'transfer' }, { kind: 'settlement' }])).toBe('1 transfer, 1 settle-up');
  });
  it('several currencies side by side', () => {
    expect(
      sectionSummary([
        { kind: 'expense', spent: { amount: 50000, currency: 'INR' } },
        { kind: 'expense', spent: { amount: 30000, currency: 'THB' } },
      ]),
    ).toBe('2 expenses · ₹500 + ฿300');
  });
});
