import React from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, Wind, Clock, DollarSign, ArrowLeft } from 'lucide-react';

/**
 * DualStrategyCard — מציג שתי אסטרטגיות מחזור:
 * A: מקסימום חיסכון (קיצור שנים)
 * B: מקסימום חמצן (הפחתת החזר חודשי)
 */
export default function DualStrategyCard({ dualStrategy, currentMonthlyPayment }) {
  if (!dualStrategy) return null;
  const { strategyA, strategyB } = dualStrategy;
  const current = currentMonthlyPayment || dualStrategy.currentMonthly || 0;

  const formatNum = (n) => Math.round(n || 0).toLocaleString();
  // A תמיד עדיף מבחינת חיסכון כלכלי — B הוא "חמצן" לתזרים, לא חיסכון
  const isABetter = true;

  return (
    <div style={{ marginBottom: '24px' }}>
      {/* כותרת */}
      <div style={{ textAlign: 'center', marginBottom: '16px' }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: '8px',
          background: 'rgba(197,160,89,0.15)', border: '1px solid rgba(197,160,89,0.4)',
          borderRadius: '20px', padding: '6px 16px', marginBottom: '8px'
        }}>
          <span style={{ color: '#D4AF37', fontSize: '12px', fontWeight: 900, letterSpacing: '1px', textTransform: 'uppercase' }}>
            בחר את הדרך שלך
          </span>
        </div>
        <h3 style={{ color: 'white', fontSize: 'clamp(15px, 4vw, 20px)', fontWeight: 900, margin: 0 }}>2 אסטרטגיות מחזור — כל אחת לצורך אחר</h3>
        <p style={{ color: '#8892B0', fontSize: '13px', marginTop: '4px' }}>
          החזר נוכחי: <strong style={{ color: '#C5A059' }}>₪{formatNum(current)}</strong> — כמה רוצים לשנות?
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Strategy A — מקסימום חיסכון */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.1 }}
          style={{
            background: isABetter
              ? 'linear-gradient(160deg, #0a2a1a 0%, #0F2442 100%)'
              : 'linear-gradient(160deg, #0F2442 0%, #0A192F 100%)',
            border: isABetter ? '2px solid #C5A059' : '1px solid rgba(197,160,89,0.25)',
            borderRadius: '16px',
            padding: '20px',
            position: 'relative',
            overflow: 'hidden',
            boxShadow: isABetter ? '0 0 30px rgba(197,160,89,0.15)' : 'none'
          }}
        >
          {/* פס העליון תופס גובה קבוע בשני הכרטיסים כדי שהתוכן מתחתיו יתחיל באותו גובה */}
          <div style={{
            margin: '-20px -20px 12px -20px', textAlign: 'center',
            padding: '5px', fontSize: '10px', fontWeight: 900, letterSpacing: '1.5px',
            textTransform: 'uppercase',
            background: isABetter ? 'linear-gradient(90deg, #B8922A, #D4AF37, #B8922A)' : 'transparent',
            color: isABetter ? '#0A192F' : 'transparent'
          }}>⭐ חיסכון מרבי</div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <div style={{
                width: '36px', height: '36px', borderRadius: '10px',
                background: 'rgba(134,166,134,0.15)', border: '1px solid rgba(134,166,134,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px'
              }}>🏆</div>
              <div>
                <div style={{ color: '#86A686', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px' }}>
                  מקסימום חיסכון
                </div>
                <div style={{ color: 'white', fontSize: '14px', fontWeight: 800 }}>קיצור שנים</div>
              </div>
            </div>

            {/* ⏱️ הבידול המרכזי של האסטרטגיה הזו */}
            {strategyA?.yearsShortened > 0 && (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                background: 'rgba(134,166,134,0.15)', border: '1px solid rgba(134,166,134,0.35)',
                borderRadius: '10px', padding: '8px 10px', marginBottom: '10px'
              }}>
                <span style={{ fontSize: '15px' }}>⏱️</span>
                <span style={{ color: '#86A686', fontSize: '14px', fontWeight: 900 }}>
                  קיצור של {strategyA.yearsShortened} שנים מהתקופה
                </span>
              </div>
            )}

            {/* 💰 חיסכון נטו כולל — הסטטיסטיקה המרכזית */}
            <div style={{
              background: 'linear-gradient(135deg, rgba(134,166,134,0.22), rgba(134,166,134,0.06))',
              border: '1px solid rgba(134,166,134,0.4)',
              borderRadius: '12px', padding: '16px 12px', marginBottom: '10px', textAlign: 'center'
            }}>
              <div style={{ color: '#B7C9B7', fontSize: '11px', fontWeight: 700, marginBottom: '4px' }}>חיסכון נטו כולל לאורך התקופה</div>
              <div style={{ color: '#4ADE80', fontSize: 'clamp(26px, 7vw, 38px)', fontWeight: 900, lineHeight: 1.1 }}>
                {(strategyA?.netSavings || 0) >= 0 ? '' : '-'}₪{formatNum(Math.abs(strategyA?.netSavings || 0))}
              </div>
            </div>

            {/* נתונים משניים */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '10px' }}>
              <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: '8px', padding: '8px', textAlign: 'center' }}>
                <div style={{ color: '#8892B0', fontSize: '9px', marginBottom: '2px' }}>החזר חודשי חדש</div>
                <div style={{ color: 'white', fontSize: '16px', fontWeight: 900 }}>₪{formatNum(strategyA?.monthlyPayment)}</div>
                {strategyA?.monthlyDelta !== undefined && (
                  <div style={{ fontSize: '9px', color: strategyA.monthlyDelta <= 0 ? '#86A686' : '#F87171', fontWeight: 700 }}>
                    {strategyA.monthlyDelta <= 0 ? `▼ ₪${formatNum(Math.abs(strategyA.monthlyDelta))} פחות` : `▲ ₪${formatNum(Math.abs(strategyA.monthlyDelta))} יותר`}
                  </div>
                )}
              </div>
              <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: '8px', padding: '8px', textAlign: 'center' }}>
                <div style={{ color: '#8892B0', fontSize: '9px', marginBottom: '2px' }}>תקופה</div>
                <div style={{ color: 'white', fontSize: '16px', fontWeight: 900 }}>{strategyA?.periodYears}<span style={{ fontSize: '10px', color: '#8892B0', marginRight: '2px' }}>שנ'</span></div>
              </div>
            </div>

            <div style={{ fontSize: '11px', color: '#6B7E99', fontStyle: 'italic', textAlign: 'center' }}>
              {strategyA?.suitedFor}
            </div>
          </div>
        </motion.div>

        {/* Strategy B — מקסימום חמצן */}
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.2 }}
          style={{
            background: !isABetter
              ? 'linear-gradient(160deg, #0a1a2a 0%, #0F2442 100%)'
              : 'linear-gradient(160deg, #0F2442 0%, #0A192F 100%)',
            border: !isABetter ? '2px solid #C5A059' : '1px solid rgba(197,160,89,0.25)',
            borderRadius: '16px',
            padding: '20px',
            position: 'relative',
            overflow: 'hidden',
            boxShadow: !isABetter ? '0 0 30px rgba(197,160,89,0.15)' : 'none'
          }}
        >
          {/* פס העליון תופס גובה קבוע בשני הכרטיסים כדי שהתוכן מתחתיו יתחיל באותו גובה */}
          <div style={{
            margin: '-20px -20px 12px -20px', textAlign: 'center',
            padding: '5px', fontSize: '10px', fontWeight: 900, letterSpacing: '1.5px',
            textTransform: 'uppercase',
            background: !isABetter ? 'linear-gradient(90deg, #B8922A, #D4AF37, #B8922A)' : 'transparent',
            color: !isABetter ? '#0A192F' : 'transparent'
          }}>⭐ חמצן לתזרים</div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <div style={{
                width: '36px', height: '36px', borderRadius: '10px',
                background: 'rgba(96,165,250,0.15)', border: '1px solid rgba(96,165,250,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px'
              }}>🫁</div>
              <div>
                <div style={{ color: '#60A5FA', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px' }}>
                  מקסימום חמצן
                </div>
                <div style={{ color: 'white', fontSize: '14px', fontWeight: 800 }}>הפחתת החזר</div>
              </div>
            </div>

            {/* 🪙 הבידול המרכזי של האסטרטגיה הזו */}
            {strategyB?.monthlyRelief > 0 && (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                background: 'rgba(96,165,250,0.15)', border: '1px solid rgba(96,165,250,0.35)',
                borderRadius: '10px', padding: '8px 10px', marginBottom: '10px'
              }}>
                <span style={{ fontSize: '15px' }}>🪙</span>
                <span style={{ color: '#60A5FA', fontSize: '14px', fontWeight: 900 }}>
                  ₪{formatNum(strategyB.monthlyRelief)} יותר בעו"ש כל חודש
                </span>
              </div>
            )}

            {/* 💰 חיסכון נטו כולל — הסטטיסטיקה המרכזית */}
            <div style={{
              background: (strategyB?.netSavings || 0) >= 0
                ? 'linear-gradient(135deg, rgba(134,166,134,0.22), rgba(134,166,134,0.06))'
                : 'linear-gradient(135deg, rgba(245,158,11,0.18), rgba(245,158,11,0.05))',
              border: (strategyB?.netSavings || 0) >= 0 ? '1px solid rgba(134,166,134,0.4)' : '1px solid rgba(245,158,11,0.35)',
              borderRadius: '12px', padding: '16px 12px', marginBottom: '10px', textAlign: 'center'
            }}>
              <div style={{ color: (strategyB?.netSavings || 0) >= 0 ? '#B7C9B7' : '#FCD9A8', fontSize: '11px', fontWeight: 700, marginBottom: '4px' }}>
                {(strategyB?.netSavings || 0) >= 0 ? 'חיסכון נטו כולל לאורך התקופה' : 'עלות נוספת לתקופה (מחיר ה"חמצן")'}
              </div>
              <div style={{ color: (strategyB?.netSavings || 0) >= 0 ? '#4ADE80' : '#F59E0B', fontSize: 'clamp(26px, 7vw, 38px)', fontWeight: 900, lineHeight: 1.1 }}>
                {(strategyB?.netSavings || 0) >= 0 ? `₪${formatNum(strategyB?.netSavings)}` : `+₪${formatNum(Math.abs(strategyB?.netSavings || 0))}`}
              </div>
            </div>

            {/* נתונים משניים */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '10px' }}>
              <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: '8px', padding: '8px', textAlign: 'center' }}>
                <div style={{ color: '#8892B0', fontSize: '9px', marginBottom: '2px' }}>החזר חודשי חדש</div>
                <div style={{ color: 'white', fontSize: '16px', fontWeight: 900 }}>₪{formatNum(strategyB?.monthlyPayment)}</div>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: '8px', padding: '8px', textAlign: 'center' }}>
                <div style={{ color: '#8892B0', fontSize: '9px', marginBottom: '2px' }}>תקופה</div>
                <div style={{ color: 'white', fontSize: '16px', fontWeight: 900 }}>{strategyB?.periodYears}<span style={{ fontSize: '10px', color: '#8892B0', marginRight: '2px' }}>שנ'</span></div>
                <div style={{ color: '#8892B0', fontSize: '9px' }}>מקסימום מותר</div>
              </div>
            </div>

            <div style={{ fontSize: '11px', color: '#6B7E99', fontStyle: 'italic', textAlign: 'center' }}>
              {strategyB?.suitedFor}
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}