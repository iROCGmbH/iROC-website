import { describe, expect, it } from 'vitest';
import { fmtDate } from './Expenses';

describe('fmtDate', () => {
  it('formats both date-only and PostgreSQL ISO timestamp values', () => {
    expect(fmtDate('2026-01-15')).toBe('15.01.2026');
    expect(fmtDate('2026-01-15T00:00:00.000Z')).toBe('15.01.2026');
  });

  it('returns malformed values rather than displaying Invalid Date', () => {
    expect(fmtDate('not-a-date')).toBe('not-a-date');
  });
});