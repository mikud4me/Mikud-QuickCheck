import { describe, it, expect } from 'vitest';
import { isGovtOrEducationEmployer, getGrossNetThresholdForSector } from './employerThresholds.js';

describe('isGovtOrEducationEmployer', () => {
  it('recognizes government/education/public-sector keywords', () => {
    expect(isGovtOrEducationEmployer('משרד החינוך')).toBe(true);
    expect(isGovtOrEducationEmployer('עיריית תל אביב')).toBe(true);
    expect(isGovtOrEducationEmployer('בית חולים הדסה')).toBe(true);
    expect(isGovtOrEducationEmployer('Ministry of Education')).toBe(true);
  });

  it('is case-insensitive for English keywords', () => {
    expect(isGovtOrEducationEmployer('MUNICIPALITY of somewhere')).toBe(true);
  });

  it('returns false for an ordinary private employer', () => {
    expect(isGovtOrEducationEmployer('חברת הייטק בע"מ')).toBe(false);
  });

  it('returns false for null/undefined/empty input without throwing', () => {
    expect(isGovtOrEducationEmployer(null)).toBe(false);
    expect(isGovtOrEducationEmployer(undefined)).toBe(false);
    expect(isGovtOrEducationEmployer('')).toBe(false);
  });
});

describe('getGrossNetThresholdForSector', () => {
  it('returns 0.42 for government/education employers regardless of income', () => {
    expect(getGrossNetThresholdForSector(50000, true)).toBe(0.42);
    expect(getGrossNetThresholdForSector(5000, true)).toBe(0.42);
  });

  it('returns 0.53 for high earners (>30k) outside govt/education', () => {
    expect(getGrossNetThresholdForSector(35000, false)).toBe(0.53);
  });

  it('returns 0.60 for mid earners (>20k, <=30k)', () => {
    expect(getGrossNetThresholdForSector(25000, false)).toBe(0.60);
  });

  it('returns 0.65 for regular earners (<=20k)', () => {
    expect(getGrossNetThresholdForSector(15000, false)).toBe(0.65);
  });
});
