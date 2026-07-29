import { PDFDocument } from 'pdf-lib';
import { uploadFileToStorage } from '@/api/supabaseClient';

// ────────────────────────────────────────────────────────────────────────────
// CLIENT-SIDE PAGE-LEVEL CHUNKING — הפיצול מתבצע בדפדפן המשתמש (לא בשרת).
//
// בעיה עסקית: לקוח שולח קובץ PDF אחד גדול (8-10MB) עם 30+ עמודים מעורבבים.
// אם השרת (Worker) מפצל — הוא שורף את 150 השניות שלו על חיתוך/העלאה לפני שהוא
// בכלל מגיע לחילוץ → 504/502.
//
// פתרון: הדפדפן מפצל כל PDF >7 עמודים ל-chunks קלים בזיכרון המקומי, מעלה אותם
// לענן במקביל (Promise.all), ומחזיר רשימת URLs שטוחה ומוכנה. ל-Frontend אין מגבלת
// 150 שניות, כך שהפיצול לא מסכן את ה-Worker. ה-Worker מקבל קבצים מוכנים בלבד.
// ────────────────────────────────────────────────────────────────────────────

// פיצול בדפדפן: קבצים מעל 15 עמודים מפוצלים לצ'אנקים של 15 עמודים.
// קובץ 34 עמודים → 3 צ'אנקים. כל צ'אנק ≈ 2-3MB → Gemini Pro מסיים ב-40-60s בנוחות.
// בלי פיצול (999) — קובץ 7MB נחנק ב-120s timeout ומפיל את כל החיתום.
const MAX_PAGES_PER_CHUNK = 4;

// מוריד PDF מ-URL ומחזיר ArrayBuffer (קבצים בסטוראג' של Supabase)
async function fetchPdfBytes(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch failed ${res.status}`);
  return await res.arrayBuffer();
}

// מפצל ArrayBuffer של PDF לצ'אנקים של MAX_PAGES_PER_CHUNK עמודים, מעלה את כולם
// במקביל (Promise.all), ומחזיר מערך של { file_url, document_type } לכל צ'אנק.
async function splitAndUploadPdf(bytes, baseName, documentType) {
  const srcDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const totalPages = srcDoc.getPageCount();

  // PDF קטן (≤7 עמודים) — לא צריך לפצל
  if (totalPages <= MAX_PAGES_PER_CHUNK) return null;

  // בונים את כל ה-chunks ל-File objects (חיתוך CPU-bound מהיר)
  const chunkFiles = [];
  for (let start = 0; start < totalPages; start += MAX_PAGES_PER_CHUNK) {
    const end = Math.min(start + MAX_PAGES_PER_CHUNK, totalPages);
    const chunkDoc = await PDFDocument.create();
    const pageIndices = [];
    for (let p = start; p < end; p++) pageIndices.push(p);
    const copied = await chunkDoc.copyPages(srcDoc, pageIndices);
    copied.forEach((pg) => chunkDoc.addPage(pg));
    const chunkBytes = await chunkDoc.save();
    const chunkNum = Math.floor(start / MAX_PAGES_PER_CHUNK) + 1;
    chunkFiles.push(new File([chunkBytes], `${baseName}-part${chunkNum}.pdf`, { type: 'application/pdf' }));
  }

  // ── העלאה מקבילית (Promise.all) — מגלח עשרות שניות מול לולאה סדרתית ──
  const uploadedUrls = await Promise.all(
    chunkFiles.map((file) => uploadFileToStorage(file))
  );
  return uploadedUrls.map((file_url) => ({ file_url, document_type: documentType }));
}

// API ראשי: מקבל את רשימת הקבצים שהועלו ({ file_url, document_type, file_name }),
// ומחזיר רשימה מורחבת ושטוחה שבה כל PDF גדול הוחלף בצ'אנקים שלו. קבצים שאינם PDF /
// PDF קטן / כל כשל פיצול — נשארים כפי שהם (fallback בטוח — לעולם לא מאבדים קובץ).
export async function expandLargePdfs(uploadedFiles, onProgress) {
  const expanded = [];
  for (const f of uploadedFiles) {
    const name = f.file_name || '';
    const isPdf = name.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      expanded.push(f);
      continue;
    }
    try {
      const bytes = await fetchPdfBytes(f.file_url);
      const baseName = name.replace(/\.pdf$/i, '') || 'doc';
      const chunks = await splitAndUploadPdf(bytes, baseName, f.document_type);
      if (chunks && chunks.length > 0) {
        if (onProgress) onProgress(name, chunks.length);
        expanded.push(...chunks);
      } else {
        expanded.push(f); // ≤7 עמודים — כמו שהוא
      }
    } catch (err) {
      console.warn(`PDF split skipped for ${name} — using original:`, err?.message);
      expanded.push(f); // כשל פיצול — שולחים את הקובץ המקורי (fallback)
    }
  }
  return expanded;
}