import { describe, it, expect } from 'vitest';
import { buildIdentityLock, computeMissingCritical, buildIdCardDetails } from './preScanRequirements.js';

function scanAndMiss(scanResult) {
    const identityLock = buildIdentityLock(scanResult);
    const missing = computeMissingCritical(scanResult, identityLock);
    delete identityLock._missingCriticalAdditions;
    return { identityLock, missing };
}

describe('computeMissingCritical', () => {
    it('flags a spouse known only from a ספח as a missing document, every time (the reported bug)', () => {
        const scanResult = {
            found_documents: [
                { type: 'id_card', count: 1, details: 'ת.ז של פמלה קצב, כולל ספח' },
                { type: 'payslip', count: 4, details: 'תלושי שכר של פמלה קצב' },
            ],
            has_id_card: true,
            has_payslips: true,
            has_bank_statements: false,
            has_business_indicator: false,
            id_cards_found: [{ full_name: 'פמלה קצב', id_number: '123456782' }],
            spouse_mentioned_on_sepach: [{ full_name: 'דורון קצב', id_number: '032557852', mentioned_on: 'פמלה קצב' }],
            payslip_identities: [{ employee_name: 'פמלה קצב', employee_id: '123456782', employer: 'x' }],
            borrower_names: ['פמלה קצב', 'דורון קצב'],
            num_borrowers_detected: 2,
            suggested_report_type: 'מחזור משכנתא',
            additional_suggested_types: [],
        };
        const { missing } = scanAndMiss(scanResult);
        expect(missing.some(m => m.includes('דורון קצב'))).toBe(true);
        expect(missing).toContain('דפי עובר ושב');
        expect(missing).toContain('אישור יתרת סילוק למשכנתא קיימת');
    });

    it('is deterministic — identical input always produces identical output', () => {
        const scanResult = {
            found_documents: [{ type: 'id_card', count: 1 }],
            has_id_card: true, has_payslips: false, has_bank_statements: false, has_business_indicator: false,
            id_cards_found: [{ full_name: 'א', id_number: '1' }],
            spouse_mentioned_on_sepach: [{ full_name: 'ב', id_number: '2', mentioned_on: 'א' }],
            payslip_identities: [], borrower_names: ['א', 'ב'], num_borrowers_detected: 2,
            suggested_report_type: 'מחזור משכנתא', additional_suggested_types: [],
        };
        expect(scanAndMiss(scanResult).missing).toEqual(scanAndMiss(scanResult).missing);
    });

    it('reports nothing missing for a fully-documented single-borrower purchase case, aside from the property doc', () => {
        const scanResult = {
            found_documents: [
                { type: 'id_card', count: 1 },
                { type: 'payslip', count: 3 },
                { type: 'bank_statement', count: 3 },
            ],
            has_id_card: true,
            has_payslips: true,
            has_bank_statements: true,
            has_business_indicator: false,
            id_cards_found: [{ full_name: 'יעקב כהן', id_number: '111111118' }],
            spouse_mentioned_on_sepach: [],
            payslip_identities: [{ employee_name: 'יעקב כהן', employee_id: '111111118' }],
            borrower_names: ['יעקב כהן'],
            num_borrowers_detected: 1,
            suggested_report_type: 'רכישת נכס חדש',
            additional_suggested_types: [],
        };
        const { missing } = scanAndMiss(scanResult);
        expect(missing).toEqual(['מסמכי נכס (הסכם רכישה / נסח טאבו)']);
    });

    it('flags core requirements when nothing was uploaded', () => {
        const scanResult = {
            found_documents: [],
            has_id_card: false, has_payslips: false, has_bank_statements: false, has_business_indicator: false,
            id_cards_found: [], spouse_mentioned_on_sepach: [], payslip_identities: [],
            borrower_names: [], num_borrowers_detected: 0,
            suggested_report_type: '', additional_suggested_types: [],
        };
        const { missing } = scanAndMiss(scanResult);
        expect(missing).toEqual(expect.arrayContaining([
            'תעודת זהות',
            'מסמכי הכנסה (תלושי שכר / שומת מס / תלוש פנסיה)',
            'דפי עובר ושב',
        ]));
    });

    it('flags missing tax assessment / CPA letter for a business owner even if a payslip exists', () => {
        const scanResult = {
            found_documents: [{ type: 'id_card', count: 1 }, { type: 'bank_statement', count: 3 }],
            has_id_card: true, has_payslips: false, has_bank_statements: true, has_business_indicator: true,
            id_cards_found: [{ full_name: 'רותי לוי', id_number: '222222226' }],
            spouse_mentioned_on_sepach: [], payslip_identities: [],
            borrower_names: ['רותי לוי'], num_borrowers_detected: 1,
            suggested_report_type: 'בעלי עסקים וחברות', additional_suggested_types: [],
        };
        const { missing } = scanAndMiss(scanResult);
        expect(missing).toContain('שומת מס ומכתב רו"ח (לבעל עסק / עצמאי)');
    });

    it('flags a missing pension slip for a golden-age case', () => {
        const scanResult = {
            found_documents: [{ type: 'id_card', count: 1 }, { type: 'bank_statement', count: 1 }],
            has_id_card: true, has_payslips: false, has_bank_statements: true, has_business_indicator: false,
            id_cards_found: [{ full_name: 'שרה גיל', id_number: '333333334' }],
            spouse_mentioned_on_sepach: [], payslip_identities: [],
            borrower_names: ['שרה גיל'], num_borrowers_detected: 1,
            suggested_report_type: 'גיל הזהב', additional_suggested_types: [],
        };
        const { missing } = scanAndMiss(scanResult);
        expect(missing).toContain('תלוש פנסיה / קצבה');
    });

    it('does not double-flag income when a second borrower is detected but no income proof exists at all', () => {
        const scanResult = {
            found_documents: [{ type: 'id_card', count: 1 }],
            has_id_card: true, has_payslips: false, has_bank_statements: false, has_business_indicator: false,
            id_cards_found: [{ full_name: 'א', id_number: '1' }],
            spouse_mentioned_on_sepach: [], payslip_identities: [],
            borrower_names: ['א', 'ב'], num_borrowers_detected: 2,
            suggested_report_type: '', additional_suggested_types: [],
        };
        const { missing } = scanAndMiss(scanResult);
        const incomeMentions = missing.filter(m => m.includes('מסמכי הכנסה'));
        expect(incomeMentions).toHaveLength(1);
    });

    it('flags a second borrower missing separate income proof only when income proof exists for the first', () => {
        const scanResult = {
            found_documents: [{ type: 'id_card', count: 1 }, { type: 'payslip', count: 3 }],
            has_id_card: true, has_payslips: true, has_bank_statements: true, has_business_indicator: false,
            id_cards_found: [{ full_name: 'א', id_number: '1' }],
            spouse_mentioned_on_sepach: [], payslip_identities: [{ employee_name: 'א', employee_id: '1' }],
            borrower_names: ['א', 'ב'], num_borrowers_detected: 2,
            suggested_report_type: '', additional_suggested_types: [],
        };
        const { missing } = scanAndMiss(scanResult);
        expect(missing).toContain('מסמכי הכנסה עבור הלווה/ת השני/ה בתיק');
    });
});

describe('buildIdCardDetails', () => {
    it('never phrases both people as equally verified when one is only mentioned on a ספח', () => {
        // exact reported scenario: wife's ID uploaded, husband only named on her ספח
        const scanResult = {
            id_cards_found: [{ full_name: 'פמלה פרגיס קצב', id_number: '123456782' }],
            spouse_mentioned_on_sepach: [{ full_name: 'דורון קצב', id_number: '032557852', mentioned_on: 'פמלה פרגיס קצב' }],
        };
        const details = buildIdCardDetails(scanResult);
        expect(details).toContain('פמלה פרגיס קצב');
        expect(details).toContain('תעודת זהות עצמאית אומתה');
        expect(details).toContain('דורון קצב');
        expect(details).toContain('מוזכר/ת בספח');
        // must never claim the spouse's ID was independently verified
        expect(details).not.toMatch(/דורון קצב.*תעודת זהות עצמאית אומתה/);
    });

    it('returns null when there is nothing to describe', () => {
        expect(buildIdCardDetails({})).toBeNull();
        expect(buildIdCardDetails({ id_cards_found: [], spouse_mentioned_on_sepach: [] })).toBeNull();
    });

    it('describes a single verified holder with no spouse mentioned', () => {
        const details = buildIdCardDetails({
            id_cards_found: [{ full_name: 'יעקב כהן', id_number: '111111118' }],
            spouse_mentioned_on_sepach: [],
        });
        expect(details).toBe('יעקב כהן (ת.ז 111111118) — תעודת זהות עצמאית אומתה');
    });

    it('uses the exact same phrasing for a spouse mentioned alone across details/warnings/missing, and a distinct fixed phrasing when children are also listed', () => {
        const spouseAlone = { full_name: 'דורון קצב', id_number: '032557852', mentioned_on: 'פמלה קצב' };
        const spouseWithKids = { ...spouseAlone, children_also_listed: true };

        const detailsAlone = buildIdCardDetails({ id_cards_found: [], spouse_mentioned_on_sepach: [spouseAlone] });
        const detailsWithKids = buildIdCardDetails({ id_cards_found: [], spouse_mentioned_on_sepach: [spouseWithKids] });

        expect(detailsAlone).toContain('מוזכר/ת בספח של פמלה קצב');
        expect(detailsAlone).not.toContain('ילדי המשפחה');
        expect(detailsWithKids).toContain('מוזכר/ת בספח יחד עם ילדי המשפחה של פמלה קצב');

        // the same core phrase (minus the trailing clause specific to each surface) must appear
        // in the warnings message and the missing_critical item too — not a different wording
        const lockAlone = buildIdentityLock({ id_cards_found: [], spouse_mentioned_on_sepach: [spouseAlone] });
        const lockWithKids = buildIdentityLock({ id_cards_found: [], spouse_mentioned_on_sepach: [spouseWithKids] });
        expect(lockAlone.warnings[0].message).toContain('מוזכר/ת בספח של פמלה קצב');
        expect(lockWithKids.warnings[0].message).toContain('מוזכר/ת בספח יחד עם ילדי המשפחה של פמלה קצב');

        const missingAlone = computeMissingCritical({ id_cards_found: [], spouse_mentioned_on_sepach: [spouseAlone] }, lockAlone);
        const missingWithKids = computeMissingCritical({ id_cards_found: [], spouse_mentioned_on_sepach: [spouseWithKids] }, lockWithKids);
        expect(missingAlone.find(m => m.includes('דורון קצב'))).toContain('מוזכר/ת בספח של פמלה קצב');
        expect(missingWithKids.find(m => m.includes('דורון קצב'))).toContain('מוזכר/ת בספח יחד עם ילדי המשפחה של פמלה קצב');
    });
});
