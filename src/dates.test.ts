import { describe, expect, it } from 'vitest';
import { dayLabel, fromDay, toDay } from './dates';

describe('expense dates', () => {
  const now = new Date(2026, 9, 5, 9, 30); // 5 Oct 2026, 9:30 on this phone

  it('reads the calendar day on this phone', () => {
    expect(toDay(now)).toBe('2026-10-05');
    expect(toDay(new Date(2026, 0, 3).toISOString())).toBe('2026-01-03');
  });
  it('today keeps the current time', () => {
    expect(fromDay('2026-10-05', null, now)).toBe(now.toISOString());
  });
  it('another day is stored at midday, and reads back as that day', () => {
    const iso = fromDay('2026-09-28', null, now);
    expect(iso).toBe(new Date(2026, 8, 28, 12).toISOString());
    expect(toDay(iso)).toBe('2026-09-28');
  });
  it('editing without changing the day keeps the original moment', () => {
    const original = new Date(2026, 8, 28, 20, 15).toISOString();
    expect(fromDay('2026-09-28', original, now)).toBe(original);
    expect(fromDay('2026-09-27', original, now)).toBe(new Date(2026, 8, 27, 12).toISOString());
  });
  it('labels days the way people say them', () => {
    expect(dayLabel('2026-10-05', now)).toBe('Today');
    expect(dayLabel('2026-10-04', now)).toBe('Yesterday');
    expect(dayLabel('2026-10-02', now)).toBe('Fri, 2 Oct');
    expect(dayLabel('2025-12-31', now)).toBe('Wed, 31 Dec 2025');
  });
});
