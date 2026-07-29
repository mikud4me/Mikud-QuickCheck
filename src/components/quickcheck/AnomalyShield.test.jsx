import { describe, it, expect } from 'vitest';
import { detectAnomalies } from './AnomalyShield';

const baseResult = () => ({
  borrower_info: { pti_ratio: 20 },
  risk_radar: [],
});

describe('detectAnomalies', () => {
  it('returns verdict "go" with no flags/warnings for a clean file', () => {
    const { flags, warnings, verdict } = detectAnomalies(baseResult());
    expect(flags).toHaveLength(0);
    expect(warnings).toHaveLength(0);
    expect(verdict).toBe('go');
  });

  it('flags a confirmed BDI failure as critical and returns no_go', () => {
    const result = { ...baseResult(), bdi_red_flags: ["חזרת שיק ב-01/2024"] };
    const { flags, verdict } = detectAnomalies(result);
    expect(flags.some(f => f.category === 'כשל בנקאי — BDI')).toBe(true);
    expect(verdict).toBe('no_go');
  });

  it('does NOT treat a normal existing-loan entry as a BDI failure', () => {
    const result = {
      ...baseResult(),
      risk_radar: [{ finding: 'החזר חודשי של הלוואה קיימת', category: 'הלוואות קיימות' }],
    };
    const { flags, verdict } = detectAnomalies(result);
    expect(flags.some(f => f.category === 'כשל בנקאי — BDI')).toBe(false);
    expect(verdict).toBe('go');
  });

  it('flags wage garnishment as critical', () => {
    const result = {
      ...baseResult(),
      risk_radar: [{ finding: 'עיקול שכר פעיל' }],
    };
    const { flags, verdict } = detectAnomalies(result);
    expect(flags.some(f => f.category === 'עיקול / הוצאה לפועל')).toBe(true);
    expect(verdict).toBe('no_go');
  });

  it('flags gambling activity as critical, crypto activity only as a warning', () => {
    const result = {
      ...baseResult(),
      risk_radar: [
        { finding: 'הפקדה לאתר הימורים casino' },
        { finding: 'רכישת ethereum בבורסת קריפטו' },
      ],
    };
    const { flags, warnings, verdict } = detectAnomalies(result);
    expect(flags.some(f => f.category === 'AML — הימורים')).toBe(true);
    expect(warnings.some(w => w.category === 'פעילות קריפטו')).toBe(true);
    expect(verdict).toBe('no_go'); // critical flag wins over warning
  });

  it('warns (not blocks) on large unclassified foreign transfers above the 50k threshold', () => {
    const result = {
      ...baseResult(),
      equity_events: [{ amount: 200000, description: 'העברה מחו"ל', date: '01/2024' }],
    };
    const { flags, warnings, verdict } = detectAnomalies(result);
    expect(flags).toHaveLength(0);
    expect(warnings.some(w => w.category === 'מקור הון — העברה זרה')).toBe(true);
    expect(verdict).toBe('caution');
  });

  it('treats PTI > 50 as a critical blocker', () => {
    const result = { borrower_info: { pti_ratio: 55 }, risk_radar: [] };
    const { flags, verdict } = detectAnomalies(result);
    expect(flags.some(f => f.category === 'כושר החזר')).toBe(true);
    expect(verdict).toBe('no_go');
  });

  it('treats PTI between 40 and 50 as a warning only', () => {
    const result = { borrower_info: { pti_ratio: 45 }, risk_radar: [] };
    const { flags, warnings, verdict } = detectAnomalies(result);
    expect(flags).toHaveLength(0);
    expect(warnings.some(w => w.category === 'כושר החזר')).toBe(true);
    expect(verdict).toBe('caution');
  });

  it('uses pti_consumer instead of pti_ratio for detected refinance cases', () => {
    const result = {
      borrower_info: { pti_ratio: 60, pti_consumer: 20 },
      risk_radar: [],
      detected_case_types: ['מחזור משכנתא'],
    };
    const { flags, warnings, verdict } = detectAnomalies(result);
    expect(flags).toHaveLength(0);
    expect(warnings).toHaveLength(0);
    expect(verdict).toBe('go');
  });
});
