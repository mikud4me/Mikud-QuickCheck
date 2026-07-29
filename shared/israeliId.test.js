import { describe, it, expect } from 'vitest';
import { isValidIsraeliId } from './israeliId.js';

describe('isValidIsraeliId', () => {
  it('accepts a known-valid 9-digit Israeli ID', () => {
    // 123456782 is a well-known valid test ID (passes the Luhn-like checksum)
    expect(isValidIsraeliId('123456782')).toBe(true);
  });

  it('rejects an ID that fails the checksum', () => {
    expect(isValidIsraeliId('123456789')).toBe(false);
  });

  it('rejects IDs that are not exactly 9 digits', () => {
    expect(isValidIsraeliId('12345')).toBe(false);
    expect(isValidIsraeliId('1234567890')).toBe(false);
  });

  it('rejects zero-padded employee-number look-alikes even if 9 digits', () => {
    expect(isValidIsraeliId('000001420')).toBe(false);
    expect(isValidIsraeliId('000000045')).toBe(false);
  });

  it('strips dashes and spaces before validating', () => {
    expect(isValidIsraeliId('123-456-782')).toBe(true);
    expect(isValidIsraeliId('123 456 782')).toBe(true);
  });

  it('returns false for null, undefined, or empty input without throwing', () => {
    expect(isValidIsraeliId(null)).toBe(false);
    expect(isValidIsraeliId(undefined)).toBe(false);
    expect(isValidIsraeliId('')).toBe(false);
  });
});
