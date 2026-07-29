import React, { useMemo } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer
} from 'recharts';
import { Flame, TrendingDown, AlertTriangle, ArrowDown } from 'lucide-react';
import { computeBleedingPathData, computeMonthlyBurn } from './bleedingPathMath';

export default function BleedingPathChart({ tracks, newMonthlyPayment, newAverageRate, remainingBalance }) {
  const chartData = useMemo(
    () => computeBleedingPathData(tracks, newMonthlyPayment, newAverageRate, remainingBalance),
    [tracks, newMonthlyPayment, newAverageRate, remainingBalance]
  );

  const crossoverYear = chartData.findIndex((d, i) => i > 0 && d.existing > d.new_mortgage * 1.05);

  // Calculate monthly index damage
  const monthlyBurn = useMemo(
    () => computeMonthlyBurn(tracks, remainingBalance),
    [tracks, remainingBalance]
  );

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    const existing = payload.find(p => p.dataKey === 'existing')?.value || 0;
    const newM = payload.find(p => p.dataKey === 'new_mortgage')?.value || 0;
    const gap = existing - newM;
    return (
      <div style={{
        background: 'rgba(10,25,47,0.97)',
        border: '1px solid rgba(197,160,89,0.4)',
        borderRadius: '12px',
        padding: '14px 18px',
        boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
        direction: 'rtl',
        minWidth: '200px',
      }}>
        <p style={{ color: '#D4AF37', fontWeight: '800', fontSize: '13px', marginBottom: '10px' }}>{label}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
            <span style={{ color: '#fca5a5', fontSize: '11px' }}>🔴 נוכחית</span>
            <span style={{ color: '#fca5a5', fontWeight: '800', fontSize: '12px' }}>₪{existing.toLocaleString()}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
            <span style={{ color: '#86efac', fontSize: '11px' }}>🟢 חדשה</span>
            <span style={{ color: '#86efac', fontWeight: '800', fontSize: '12px' }}>₪{newM.toLocaleString()}</span>
          </div>
          {gap > 0 && (
            <div style={{ borderTop: '1px solid rgba(197,160,89,0.3)', paddingTop: '6px', marginTop: '2px', display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#fbbf24', fontSize: '11px' }}>פער נזק מדד</span>
              <span style={{ color: '#fbbf24', fontWeight: '900', fontSize: '13px' }}>₪{gap.toLocaleString()}</span>
            </div>
          )}
        </div>
      </div>
    );
  };

  if (!chartData.length) return null;

  const maxVal = Math.max(...chartData.map(d => d.existing));

  return (
    <div style={{
      background: 'linear-gradient(135deg, #0A192F 0%, #0F2442 50%, #0A192F 100%)',
      border: '1px solid rgba(239,68,68,0.3)',
      borderRadius: '20px',
      overflow: 'hidden',
      boxShadow: '0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(197,160,89,0.1)',
      position: 'relative',
    }}>
      {/* Top glow */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: '3px',
        background: 'linear-gradient(90deg, transparent, #ef4444, #f97316, #ef4444, transparent)',
      }} />

      {/* Ambient red glow */}
      <div style={{
        position: 'absolute', top: '-80px', right: '-80px',
        width: '300px', height: '300px',
        background: 'radial-gradient(circle, rgba(239,68,68,0.08) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      {/* Header */}
      <div style={{ padding: '28px 32px 20px', position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
              <div style={{
                width: '36px', height: '36px', borderRadius: '10px',
                background: 'linear-gradient(135deg, #ef4444, #dc2626)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 0 20px rgba(239,68,68,0.4)',
              }}>
                <Flame style={{ width: '18px', height: '18px', color: 'white' }} />
              </div>
              <div>
                <div style={{ fontSize: '10px', color: '#94a3b8', letterSpacing: '2px', textTransform: 'uppercase' }}>ניתוח אינפלציה</div>
                <h3 style={{ fontSize: '18px', fontWeight: '900', color: 'white', margin: 0, lineHeight: 1.2 }}>
                  המסלול המדמם
                </h3>
              </div>
            </div>
            <p style={{ fontSize: '12px', color: '#8892B0', lineHeight: '1.7', maxWidth: '420px' }}>
              כסף שנשרף בכל חודש בגלל הצמדה למדד —{' '}
              <span style={{ color: '#fca5a5', fontWeight: '700' }}>הקו האדום עולה</span> למרות שאתם משלמים.
              הקו הירוק מראה את מסלול הירידה הנקי לאחר המחזור.
            </p>
          </div>

          {/* Monthly burn badge */}
          {monthlyBurn > 0 && (
            <div style={{
              background: 'linear-gradient(135deg, rgba(239,68,68,0.15), rgba(220,38,38,0.08))',
              border: '1.5px solid rgba(239,68,68,0.4)',
              borderRadius: '14px',
              padding: '14px 18px',
              textAlign: 'center',
              flexShrink: 0,
            }}>
              <div style={{ fontSize: '9px', color: '#fca5a5', letterSpacing: '1px', marginBottom: '4px' }}>🔥 נשרף מדי חודש</div>
              <div style={{ fontSize: '22px', fontWeight: '900', color: '#ef4444', lineHeight: 1 }}>
                ₪{monthlyBurn.toLocaleString()}
              </div>
              <div style={{ fontSize: '9px', color: '#94a3b8', marginTop: '3px' }}>נזק הצמדה למדד</div>
            </div>
          )}
        </div>
      </div>

      {/* Chart */}
      <div style={{ padding: '0 24px 8px', height: '280px' }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="gradExisting" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#ef4444" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="gradNew" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#22c55e" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#22c55e" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="2 6" stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'Heebo, sans-serif' }}
              axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
              tickLine={false}
              interval={3}
            />
            <YAxis
              tickFormatter={(v) => `₪${(v / 1000).toFixed(0)}K`}
              tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'Heebo, sans-serif' }}
              axisLine={false}
              tickLine={false}
              width={55}
            />
            <Tooltip content={<CustomTooltip />} />
            {crossoverYear > 0 && (
              <ReferenceLine
                x={`שנה ${crossoverYear}`}
                stroke="rgba(251,191,36,0.6)"
                strokeDasharray="5 3"
                strokeWidth={1.5}
                label={{
                  value: `⚠️ שנה ${crossoverYear}`,
                  fill: '#fbbf24',
                  fontSize: 10,
                  fontWeight: '700',
                  position: 'top',
                }}
              />
            )}
            <Area
              type="monotone"
              dataKey="existing"
              stroke="#ef4444"
              strokeWidth={2.5}
              fill="url(#gradExisting)"
              dot={false}
              activeDot={{ r: 5, fill: '#ef4444', stroke: 'white', strokeWidth: 2 }}
              name="existing"
            />
            <Area
              type="monotone"
              dataKey="new_mortgage"
              stroke="#22c55e"
              strokeWidth={2.5}
              fill="url(#gradNew)"
              dot={false}
              activeDot={{ r: 5, fill: '#22c55e', stroke: 'white', strokeWidth: 2 }}
              name="new_mortgage"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: '24px', padding: '4px 24px 16px' }}>
        {[
          { color: '#ef4444', label: 'משכנתא נוכחית (צמודה)', bg: 'rgba(239,68,68,0.1)' },
          { color: '#22c55e', label: 'משכנתא חדשה (לא צמודה)', bg: 'rgba(34,197,94,0.1)' },
        ].map(({ color, label, bg }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
            <div style={{ width: '28px', height: '3px', background: color, borderRadius: '2px', boxShadow: `0 0 8px ${color}80` }} />
            <span style={{ fontSize: '10px', color: '#8892B0' }}>{label}</span>
          </div>
        ))}
      </div>

      {/* Alert box */}
      {crossoverYear > 0 && (
        <div style={{
          margin: '0 24px 24px',
          background: 'linear-gradient(135deg, rgba(239,68,68,0.12), rgba(220,38,38,0.06))',
          border: '1px solid rgba(239,68,68,0.35)',
          borderRadius: '14px',
          padding: '16px 20px',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '14px',
        }}>
          <div style={{
            width: '32px', height: '32px', borderRadius: '8px', flexShrink: 0,
            background: 'rgba(239,68,68,0.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <AlertTriangle style={{ width: '16px', height: '16px', color: '#ef4444' }} />
          </div>
          <div>
            <div style={{ fontSize: '13px', fontWeight: '800', color: '#fca5a5', marginBottom: '4px' }}>
              נקודת האל-חזור: שנה {crossoverYear}
            </div>
            <div style={{ fontSize: '11px', color: '#8892B0', lineHeight: '1.7' }}>
              החוב שלכם יהיה <span style={{ color: '#fca5a5', fontWeight: '700' }}>גבוה יותר</span> מהיתרה הנוכחית —
              למרות שנות תשלומים. המדד "מחזיר" לכם את כל ההחזרים. מחזור עכשיו עוצר את הנזק הזה לחלוטין.
            </div>
          </div>
        </div>
      )}

      {/* Footer note */}
      <div style={{
        margin: '0 24px 20px',
        display: 'flex', alignItems: 'center', gap: '6px',
      }}>
        <TrendingDown style={{ width: '12px', height: '12px', color: '#475569', flexShrink: 0 }} />
        <span style={{ fontSize: '9px', color: '#475569' }}>
          מבוסס על מדד צפוי 2.5% לשנה · ריביות מסלולים קיימים
        </span>
      </div>
    </div>
  );
}