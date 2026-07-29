import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { format } from 'date-fns';
import { he } from 'date-fns/locale';

const DOC_TYPE_LABELS = {
    id_card: 'תעודת זהות',
    payslip: 'תלושי שכר',
    bank_statement: 'דפי עובר ושב',
    mortgage_balance: 'יתרת סילוק / משכנתא קיימת',
    tax_assessment: 'שומת מס',
    cpa_letter: 'מכתב רו"ח',
    employment_letter: 'מכתב מעסיק / אישור',
    pension_slip: 'תלוש פנסיה / קצבה',
    property_doc: 'מסמכי נכס / טאבו',
    other: 'אחר',
};

// ────────────────────────────────────────────────────────────────────────────
// "הורד דוח כ-PDF" — exports exactly what the pre-scan result card shows:
// documents found and documents still missing.
//
// Renders an off-screen container with html2canvas, then places the
// resulting image into a jsPDF document — the same pattern already proven
// working elsewhere in this app (see ShareExport.jsx), sliced across pages
// if the content is taller than one A4 page.
//
// The container is positioned with `position:fixed; top:0; left:0; z-index:-1`
// rather than pushed off-screen via a large negative `right` offset. That
// offset trick is what broke this export previously: it depends on the
// *real* window width to compute a static left position, which desyncs from
// html2canvas the moment a custom `windowWidth` is passed (as this file used
// to do), producing a capture of empty space. Sitting at the real (0,0)
// origin — just behind the app's own opaque background, via z-index — avoids
// that mismatch entirely, without any opacity/visibility trick that would
// make html2canvas capture it as blank too.
// ────────────────────────────────────────────────────────────────────────────
const RENDER_WIDTH_PX = 800;
const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const MARGIN_MM = 10;

// שם → ת.ז — נשען על id_cards_found (בעל/ת התעודה הראשית, מאומת) ו-
// spouse_mentioned_on_sepach (ידוע מהספח, לא מאומת עצמאית) שכבר מגיעים מהסריקה
// הדטרמיניסטית; לא מבצע שום ניחוש/חיפוש נוסף. id_cards_found גובר אם שם מופיע בשניהם.
function buildNameToIdMap(scanResult) {
    const nameToId = new Map();
    (scanResult.spouse_mentioned_on_sepach || []).forEach(s => {
        if (s.full_name && s.id_number) nameToId.set(s.full_name.trim(), s.id_number);
    });
    (scanResult.id_cards_found || []).forEach(c => {
        if (c.full_name && c.id_number) nameToId.set(c.full_name.trim(), c.id_number);
    });
    return nameToId;
}

function formatNamesWithIds(scanResult) {
    const nameToId = buildNameToIdMap(scanResult);
    const names = (scanResult.borrower_names && scanResult.borrower_names.length)
        ? scanResult.borrower_names
        : [...nameToId.keys()];

    return names.map(name => {
        const id = nameToId.get(name.trim());
        return id ? `${name} (ת.ז ${id})` : name;
    });
}

export async function downloadScanSummaryPdf(scanResult) {
    const {
        found_documents = [],
        missing_critical = [],
    } = scanResult || {};

    const borrowerLines = formatNamesWithIds(scanResult);
    const dateStr = format(new Date(), 'dd/MM/yyyy HH:mm', { locale: he });

    const htmlContent = `
        <div dir="rtl" style="font-family:'Heebo','Arial',sans-serif;width:${RENDER_WIDTH_PX}px;background:#ffffff;color:#1e293b;line-height:1.6;padding:40px;box-sizing:border-box;">
          <div style="text-align:center;margin-bottom:30px;padding-bottom:20px;border-bottom:3px solid #2563eb;">
            <div style="color:#2563eb;font-size:26px;font-weight:700;margin-bottom:8px;">סיכום סריקת מסמכים</div>
            <div style="color:#64748b;font-size:15px;font-weight:500;">מיקוד משכנתאות${borrowerLines.length ? ' | ' + borrowerLines.join(', ') : ''}</div>
          </div>

          <div style="margin-bottom:26px;">
            <div style="font-size:18px;font-weight:700;margin-bottom:12px;padding-bottom:6px;border-bottom:2px solid #e2e8f0;color:#15803d;">✓ מסמכים שנמצאו (${found_documents.length})</div>
            ${found_documents.length ? found_documents.map(doc => `
              <div style="background:#f0fdf4;border-right:3px solid #22c55e;padding:10px 14px;margin-bottom:8px;border-radius:8px;font-size:14px;display:flex;align-items:center;gap:10px;">
                <span>${DOC_TYPE_LABELS[doc.type] || doc.type || 'מסמך'}</span>
                ${doc.details ? `<span style="color:#64748b;font-size:12px;">${doc.details}</span>` : ''}
              </div>`).join('') : '<div style="color:#94a3b8;font-size:13px;">לא נמצאו מסמכים</div>'}
          </div>

          <div style="margin-bottom:26px;">
            <div style="font-size:18px;font-weight:700;margin-bottom:12px;padding-bottom:6px;border-bottom:2px solid #e2e8f0;color:#b91c1c;">✗ מסמכים חסרים (${missing_critical.length})</div>
            ${missing_critical.length ? missing_critical.map(item => `
              <div style="background:#fef2f2;border-right:3px solid #ef4444;color:#991b1b;padding:10px 14px;margin-bottom:8px;border-radius:8px;font-size:14px;">${item}</div>
            `).join('') : '<div style="color:#94a3b8;font-size:13px;">לא זוהו מסמכים חסרים</div>'}
          </div>

          <div style="margin-top:40px;padding-top:16px;border-top:2px solid #e2e8f0;text-align:center;color:#94a3b8;font-size:11px;">נוצר בתאריך ${dateStr} | מיקוד משכנתאות</div>
        </div>
    `;

    const element = document.createElement('div');
    element.innerHTML = htmlContent;
    element.style.position = 'fixed';
    element.style.top = '0';
    element.style.left = '0';
    element.style.zIndex = '-1';
    element.style.width = `${RENDER_WIDTH_PX}px`;
    document.body.appendChild(element);

    try {
        const canvas = await html2canvas(element, { scale: 2, useCORS: true, logging: false });
        if (canvas.width === 0 || canvas.height === 0) {
            throw new Error('הרינדור של הדוח נכשל (קנבס ריק)');
        }

        const pdf = new jsPDF('p', 'mm', 'a4');
        const contentWidthMm = A4_WIDTH_MM - MARGIN_MM * 2;
        const pageContentHeightMm = A4_HEIGHT_MM - MARGIN_MM * 2;
        const imgHeightMm = (canvas.height * contentWidthMm) / canvas.width;
        const imgData = canvas.toDataURL('image/png');

        let heightLeftMm = imgHeightMm;
        let positionMm = MARGIN_MM;
        pdf.addImage(imgData, 'PNG', MARGIN_MM, positionMm, contentWidthMm, imgHeightMm);
        heightLeftMm -= pageContentHeightMm;

        while (heightLeftMm > 0) {
            positionMm = MARGIN_MM - (imgHeightMm - heightLeftMm);
            pdf.addPage();
            pdf.addImage(imgData, 'PNG', MARGIN_MM, positionMm, contentWidthMm, imgHeightMm);
            heightLeftMm -= pageContentHeightMm;
        }

        pdf.save(`סיכום_סריקת_מסמכים_${format(new Date(), 'ddMMyyyy')}.pdf`);
    } finally {
        document.body.removeChild(element);
    }
}
