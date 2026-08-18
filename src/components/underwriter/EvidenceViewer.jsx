import React, { useState, useEffect, useRef } from 'react';
import { Eye, EyeOff, X, ChevronLeft, ChevronRight, Maximize2, AlertCircle } from 'lucide-react';

/**
 * EvidenceViewer — PDF Evidence Deep-Link Viewer
 * 
 * Usage:
 *   <EvidenceButton fileUrl="..." page={2} label="הכנסה נטו" />
 * 
 * When clicked, opens a modal with the PDF pre-scrolled to the given page.
 * If fileUrl is null/undefined, the button is shown disabled (grey).
 * If page is null, opens at page 1 with a tooltip note.
 */

// ─── Modal ────────────────────────────────────────────────────────────────────
function EvidenceModal({ fileUrl, page, label, onClose }) {
  const [currentPage, setCurrentPage] = useState(page || 1);
  const [totalPages, setTotalPages] = useState(null);
  const iframeRef = useRef(null);

  // Build the URL with page anchor — works for PDF.js and native browser PDF viewers
  const buildPdfUrl = (url, p) => {
    if (!url) return '';
    // For uploaded files (supabase/base44 CDN), append #page=N
    return `${url}#page=${p}`;
  };

  useEffect(() => {
    setCurrentPage(page || 1);
  }, [page, fileUrl]);

  const goTo = (p) => {
    if (!p || p < 1) return;
    setCurrentPage(p);
    if (iframeRef.current) {
      iframeRef.current.src = buildPdfUrl(fileUrl, p);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-[#0d1524] border border-[#C5A059]/30 rounded-2xl overflow-hidden flex flex-col"
        style={{ width: 'min(90vw, 900px)', height: 'min(90vh, 700px)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#1e2d4a] shrink-0">
          <div className="flex items-center gap-3">
            <Eye className="w-4 h-4 text-[#C5A059]" />
            <div>
              <p className="text-white text-sm font-semibold">{label || 'מסמך ראיה'}</p>
              {!page && (
                <p className="text-amber-400/70 text-xs flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  לא זוהה עמוד מדויק — מוצג מעמוד 1
                </p>
              )}
              {page && (
                <p className="text-[#C5A059]/70 text-xs">עמוד {currentPage} מזוהה אוטומטית</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Page navigation */}
            <div className="flex items-center gap-1 border border-[#1e2d4a] rounded-lg px-2 py-1">
              <button onClick={() => goTo(currentPage - 1)} disabled={currentPage <= 1}
                className="text-[#8892B0] hover:text-white disabled:opacity-30 transition-colors">
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="text-[#8892B0] text-xs font-mono px-1">עמ' {currentPage}</span>
              <button onClick={() => goTo(currentPage + 1)}
                className="text-[#8892B0] hover:text-white transition-colors">
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
            {/* Open in new tab */}
            <a href={fileUrl} target="_blank" rel="noopener noreferrer"
              className="p-1.5 text-[#8892B0] hover:text-white transition-colors border border-[#1e2d4a] rounded-lg">
              <Maximize2 className="w-3.5 h-3.5" />
            </a>
            <button onClick={onClose}
              className="p-1.5 text-[#8892B0] hover:text-red-400 transition-colors border border-[#1e2d4a] rounded-lg">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* PDF iframe */}
        <div className="flex-1 overflow-hidden bg-[#080d16]">
          {fileUrl ? (
            <iframe
              ref={iframeRef}
              src={buildPdfUrl(fileUrl, currentPage)}
              className="w-full h-full border-0"
              title={label}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-[#4a5568]">
              <EyeOff className="w-10 h-10" />
              <p className="text-sm">קישור לקובץ לא זמין</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Button ────────────────────────────────────────────────────────────────────
export function EvidenceButton({ fileUrl, page, label, size = 'sm', normalized = false }) {
  const [open, setOpen] = useState(false);
  const disabled = !fileUrl;

  return (
    <>
      <div className="relative group inline-flex">
        <button
          onClick={() => !disabled && setOpen(true)}
          disabled={disabled}
          className={`
            inline-flex items-center justify-center rounded-lg border transition-all
            ${disabled
              ? 'border-[#1e2d4a] text-[#2d4060] cursor-not-allowed'
              : 'border-[#C5A059]/30 text-[#C5A059]/70 hover:text-[#C5A059] hover:border-[#C5A059]/60 hover:bg-[#C5A059]/5 cursor-pointer'}
            ${size === 'sm' ? 'w-6 h-6' : 'w-7 h-7'}
          `}
          title={disabled ? 'אין קישור לקובץ' : `הצג ראיה: ${label}`}
        >
          <Eye className={size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
        </button>

        {/* Tooltip for normalized ID */}
        {normalized && !disabled && (
          <div className="absolute bottom-full right-0 mb-2 hidden group-hover:block z-50 pointer-events-none">
            <div className="bg-[#0d1524] border border-emerald-500/30 rounded-lg px-3 py-2 text-xs text-emerald-400 whitespace-nowrap shadow-xl">
              ✓ אומת לאחר נורמליזציה של אפס מוביל
              <div className="absolute top-full right-3 w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-emerald-500/30" />
            </div>
          </div>
        )}
      </div>

      {open && (
        <EvidenceModal
          fileUrl={fileUrl}
          page={page}
          label={label}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

export default EvidenceButton;