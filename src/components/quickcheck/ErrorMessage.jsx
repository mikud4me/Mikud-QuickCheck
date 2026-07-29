import React from 'react';
import { AlertTriangle } from 'lucide-react';

/**
 * ErrorMessage — הצגת סיבת שגיאה מפורשת על המסך (במקום קריסה/מסך לבן).
 * משמש כש-response.status !== 200 או כשגוף התגובה מכיל error.
 * מקבל את הטקסט המדויק מהשרת ומציג אותו בעברית ברורה.
 */
export default function ErrorMessage({ text, code }) {
  const display = text || 'אירעה שגיאה בעיבוד המסמכים. נסה שוב או העלה מסמכים אחרים.';
  return (
    <div
      dir="rtl"
      style={{
        background: 'linear-gradient(135deg,#3D0000,#1a0000)',
        border: '2px solid #ef4444',
        borderRadius: '16px',
        padding: '24px 28px',
        margin: '20px 0',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '16px',
      }}
    >
      <div
        style={{
          width: '44px',
          height: '44px',
          borderRadius: '12px',
          background: 'rgba(239,68,68,0.15)',
          border: '1px solid #ef444466',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <AlertTriangle className="w-6 h-6" style={{ color: '#f87171' }} />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ color: '#fca5a5', fontWeight: 900, fontSize: '15px', marginBottom: '6px' }}>
          העיבוד נכשל — סיבת השגיאה:
        </div>
        <p style={{ color: '#fecaca', fontSize: '13px', lineHeight: 1.7, margin: 0 }}>{display}</p>
        {code && (
          <div style={{ marginTop: '8px', fontSize: '10px', color: '#f8717188', fontFamily: 'monospace' }}>
            קוד שגיאה: {code}
          </div>
        )}
      </div>
    </div>
  );
}