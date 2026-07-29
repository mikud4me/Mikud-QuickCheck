import React from 'react';
import { TrendingUp } from 'lucide-react';

/**
 * LiveRatesBadge — מציג את הריביות החיות שבהן השתמש הניתוח
 */
export default function LiveRatesBadge({ newRates }) {
  if (!newRates?.average_rates) return null;
  const r = newRates.average_rates;

  const items = [
    { label: 'פריים', value: r.prime, color: '#60A5FA' },
    { label: 'קבועה לא צמודה', value: r.fixed_unlinked, color: '#C5A059' },
    { label: 'משתנה לא צמודה', value: r.variable_unlinked, color: '#86A686' },
    { label: 'קבועה צמודה', value: r.fixed_linked, color: '#F59E0B' },
  ].filter(i => i.value);

  return (
    <div style={{
      background: 'rgba(15,36,66,0.8)',
      border: '1px solid rgba(197,160,89,0.25)',
      borderRadius: '12px',
      padding: '12px 16px',
      marginBottom: '20px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
        <TrendingUp style={{ width: '14px', height: '14px', color: '#D4AF37' }} />
        <span style={{ fontSize: '11px', fontWeight: 800, color: '#D4AF37', textTransform: 'uppercase', letterSpacing: '1px' }}>
          ריביות שוק בזמן אמת — ששימשו לחישוב
        </span>
        <span style={{ fontSize: '10px', color: '#4B5563', marginRight: 'auto' }}>עודכן היום</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        {items.map((item, i) => (
          <div key={i} style={{
            background: 'rgba(255,255,255,0.04)',
            border: `1px solid ${item.color}30`,
            borderRadius: '8px',
            padding: '6px 12px',
            display: 'flex', alignItems: 'center', gap: '6px'
          }}>
            <span style={{ fontSize: '11px', color: '#8892B0' }}>{item.label}</span>
            <span style={{ fontSize: '14px', fontWeight: 900, color: item.color }}>{item.value?.toFixed(2)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}