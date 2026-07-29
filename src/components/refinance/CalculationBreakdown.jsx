import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronUp, Calculator, AlertTriangle } from 'lucide-react';
import { calcCpiLinkedTrackCost } from './cpiLinkedMath';

/**
 * 🔍 תצוגת שלבי ביניים מפורטת - Calculation Breakdown
 * מציג את כל החישובים צעד אחר צעד כדי לזהות טעויות
 */
export default function CalculationBreakdown({ analysisData }) {
  const [expanded, setExpanded] = useState(true);
  
  if (!analysisData) return null;
  
  const { currentLoan, savings, surgicalAnalysis } = analysisData;
  
  return (
    <Card className="border-2 border-purple-300 bg-purple-50">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-purple-900 flex items-center gap-2">
            <Calculator className="w-5 h-5" />
            🔍 שלבי חישוב מפורטים (למציאת טעויות)
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </Button>
        </div>
      </CardHeader>
      
      {expanded && (
        <CardContent className="space-y-4">
          {/* 🏷️ סוג התיק לניתוח */}
          <div className="bg-gradient-to-r from-blue-100 to-purple-100 border-2 border-blue-400 rounded-xl p-4 mb-4">
            <h4 className="font-bold text-blue-900 mb-2 text-center">📋 סוג התיק לניתוח</h4>
            <div className="text-center">
              <span className={`inline-block text-base px-5 py-2 rounded-full font-bold ${
                analysisData.savings?.equityReleaseAnalysis 
                  ? 'bg-purple-600 text-white' 
                  : 'bg-blue-600 text-white'
              }`}>
                {analysisData.savings?.equityReleaseAnalysis 
                  ? '🏦 משכנתא לכל מטרה (איחוד חובות + equity release)' 
                  : '🏠 מחזור משכנתא (דיור בלבד)'}
              </span>
            </div>
          </div>

          {/* שלב 1: נתוני המשכנתא הקיימת */}
          <div className="bg-white rounded-xl p-4 border-2 border-red-200">
            <h4 className="font-bold text-red-900 mb-3 flex items-center gap-2">
              <span className="bg-red-100 w-6 h-6 rounded-full flex items-center justify-center text-sm">1</span>
              נתוני המשכנתא הקיימת (כפי שהוזנו)
            </h4>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex justify-between bg-red-50 p-2 rounded">
                <span>יתרה לסילוק (מהמסמך):</span>
                <span className="font-bold">₪{currentLoan.remainingBalance?.toLocaleString()}</span>
              </div>
              <div className="flex justify-between bg-red-50 p-2 rounded">
                <span>ריבית ממוצעת נוכחית:</span>
                <span className="font-bold">{currentLoan.averageInterestRate}%</span>
              </div>
              <div className="flex justify-between bg-red-50 p-2 rounded">
                <span>תשלום חודשי נוכחי:</span>
                <span className="font-bold">₪{currentLoan.monthlyPayment?.toLocaleString()}</span>
              </div>
              <div className="flex justify-between bg-red-50 p-2 rounded">
                <span>חודשים נותרים:</span>
                <span className="font-bold">{currentLoan.remainingMonths}</span>
              </div>
            </div>
            
            {/* פירוט מסלולים */}
            {currentLoan.tracks && (
              <div className="mt-3 pt-3 border-t border-red-200">
                <p className="text-xs font-bold text-red-900 mb-2">פירוט מסלולים:</p>
                {currentLoan.tracks.map((track, idx) => (
                  <div key={idx} className="bg-red-50 p-2 rounded mb-2 text-xs">
                    <div className="flex justify-between mb-1">
                      <span className="font-bold">{track.track_type}</span>
                      <span className={`
                        ${track.status === 'GOLDEN' ? 'text-green-600' : ''}
                        ${track.status === 'TOXIC' ? 'text-red-600' : ''}
                        ${track.status === 'NEUTRAL' ? 'text-yellow-600' : ''}
                      `}>
                        {track.status === 'GOLDEN' && '🟢 נכס זהב'}
                        {track.status === 'TOXIC' && '🔴 רעיל'}
                        {track.status === 'NEUTRAL' && '🟡 גבולי'}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>יתרה: ₪{track.remaining_balance?.toLocaleString()}</div>
                      <div>ריבית: {track.interest_rate}%</div>
                      <div>חודשים: {track.remaining_months}</div>
                      <div>
                        {track.effective_rate && (
                          <span className="text-orange-600 font-bold">
                            אפקטיבי (+ מדד): {track.effective_rate.toFixed(2)}%
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* שלב 2: חישוב סך תשלומים ישנים */}
          <div className="bg-white rounded-xl p-4 border-2 border-orange-200">
            <h4 className="font-bold text-orange-900 mb-3 flex items-center gap-2">
              <span className="bg-orange-100 w-6 h-6 rounded-full flex items-center justify-center text-sm">2</span>
              חישוב סך תשלומים במשכנתא הנוכחית
            </h4>
            <div className="space-y-2 text-sm">
              <div className="bg-orange-50 p-3 rounded">
                <p className="mb-2 font-bold text-orange-900">סך תשלומים ישנים (כולל מדד לצמודים):</p>
                <p className="font-mono">
                  <span className="font-bold text-orange-600">₪{savings?.unifiedSavings?.totalExistingCost?.toLocaleString() || 'מחושב בצד שרת'}</span>
                  {currentLoan.monthlyPayment > 0 && currentLoan.remainingMonths > 0 && (
                    <span className="text-xs text-slate-500"> (בסיס: ₪{currentLoan.monthlyPayment?.toLocaleString()} × {currentLoan.remainingMonths} חודשים)</span>
                  )}
                </p>
              </div>
              
              {currentLoan.tracks?.some(t => t.track_type.toLowerCase().includes('צמוד')) && (
                <div className="bg-amber-100 p-3 rounded border border-amber-300">
                  <p className="mb-2 font-bold text-amber-900 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" />
                    תיקון: חישוב עם השפעת מדד (2.5% שנתי)
                  </p>
                  <p className="text-xs text-amber-800 mb-2">
                    למסלולים צמודים, התשלום עולה כל חודש לפי המדד.
                    נוסחה: P × ((1+i)^n - 1) / i
                  </p>
                  {currentLoan.tracks.filter(t => t.track_type.toLowerCase().includes('צמוד')).map((track, idx) => {
                    const { monthlyPayment, totalWithInflation } = calcCpiLinkedTrackCost(track);

                    return (
                      <div key={idx} className="bg-white/60 p-2 rounded mb-1 text-xs">
                        <p className="font-bold">{track.track_type}:</p>
                        <p>תשלום בסיס: ₪{Math.round(monthlyPayment).toLocaleString()}</p>
                        <p className="text-amber-900 font-bold">
                          סך כל התשלומים (כולל מדד): ₪{Math.round(totalWithInflation).toLocaleString()}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* שלב 3: חישוב תשלומים חדשים */}
          <div className="bg-white rounded-xl p-4 border-2 border-green-200">
            <h4 className="font-bold text-green-900 mb-3 flex items-center gap-2">
              <span className="bg-green-100 w-6 h-6 rounded-full flex items-center justify-center text-sm">3</span>
              חישוב משכנתא חדשה (אחרי מחזור)
            </h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between bg-green-50 p-2 rounded">
                <span>יתרה לסילוק (זהה):</span>
                <span className="font-bold">₪{currentLoan.remainingBalance?.toLocaleString()}</span>
              </div>
              <div className="flex justify-between bg-green-50 p-2 rounded">
                <span>ריבית חדשה (ממוצע שוק):</span>
                <span className="font-bold text-green-600">{savings?.newAverageRate}%</span>
              </div>
              <div className="flex justify-between bg-green-50 p-2 rounded">
                <span>תשלום חודשי חדש:</span>
                <span className="font-bold">₪{savings?.newMonthlyPayment?.toLocaleString()}</span>
              </div>
              <div className="flex justify-between bg-green-50 p-2 rounded">
                <span>תקופה:</span>
                <span className="font-bold">{currentLoan.remainingMonths} חודשים</span>
              </div>
              <div className="bg-green-100 p-3 rounded font-mono text-xs">
                <p className="mb-1">סך תשלומים חדשים (לא צמוד):</p>
                <p className="font-bold text-green-600">
                  ₪{savings?.unifiedSavings?.totalNewCost?.toLocaleString() || (savings?.newMonthlyPayment * currentLoan.remainingMonths)?.toLocaleString()}
                </p>
              </div>
            </div>
          </div>

          {/* שלב 4: עמלות */}
          <div className="bg-white rounded-xl p-4 border-2 border-yellow-200">
            <h4 className="font-bold text-yellow-900 mb-3 flex items-center gap-2">
              <span className="bg-yellow-100 w-6 h-6 rounded-full flex items-center justify-center text-sm">4</span>
              עמלות מחזור
            </h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between bg-yellow-50 p-2 rounded">
                <span>פיצוי פירעון מוקדם:</span>
                <span className="font-bold">₪{savings?.earlyRepaymentFee?.toLocaleString()}</span>
              </div>
              <div className="flex justify-between bg-yellow-50 p-2 rounded">
                <span>עמלות בנק:</span>
                <span className="font-bold">₪{savings?.bankFees?.toLocaleString()}</span>
              </div>
              <div className="flex justify-between bg-yellow-50 p-2 rounded">
                <span>עלויות משפטיות ושמאות:</span>
                <span className="font-bold">₪{savings?.legalFees?.toLocaleString()}</span>
              </div>
              <div className="flex justify-between bg-yellow-100 p-2 rounded font-bold border-t-2 border-yellow-300">
                <span>סך עמלות:</span>
                <span className="text-yellow-900">₪{savings?.refinanceCost?.toLocaleString()}</span>
              </div>
            </div>
          </div>

          {/* שלב 5: חישוב חיסכון סופי */}
          <div className="bg-white rounded-xl p-4 border-2 border-blue-200">
            <h4 className="font-bold text-blue-900 mb-3 flex items-center gap-2">
              <span className="bg-blue-100 w-6 h-6 rounded-full flex items-center justify-center text-sm">5</span>
              חישוב חיסכון סופי
            </h4>
            <div className="space-y-3 text-sm">
              <div className="bg-blue-50 p-3 rounded">
                <p className="font-mono text-xs mb-2">נוסחת חישוב:</p>
                <p className="font-mono text-xs">
                  חיסכון ברוטו = סך תשלומים ישנים - סך תשלומים חדשים
                </p>
                <p className="font-mono text-xs mt-2 text-blue-600 font-bold">
                  ₪{savings?.unifiedSavings?.totalExistingCost?.toLocaleString()} - ₪{savings?.unifiedSavings?.totalNewCost?.toLocaleString()} = ₪{savings?.unifiedSavings?.grossSavings?.toLocaleString()}
                </p>
              </div>
              
              <div className="bg-blue-50 p-3 rounded">
                <p className="font-mono text-xs mb-2">חיסכון נטו:</p>
                <p className="font-mono text-xs">
                  חיסכון ברוטו - עמלות = חיסכון נטו
                </p>
                <p className="font-mono text-xs mt-2">
                  ₪{savings?.unifiedSavings?.grossSavings?.toLocaleString()} - ₪{savings?.refinanceCost?.toLocaleString()} = 
                  <span className="text-blue-600 font-bold"> ₪{savings?.netSavings?.toLocaleString()}</span>
                </p>
              </div>
              
              <div className="bg-gradient-to-r from-blue-100 to-blue-200 p-3 rounded border-2 border-blue-400">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-blue-900">תוצאה סופית - חיסכון נטו:</span>
                  <span className="text-2xl font-bold text-blue-600">₪{savings?.netSavings?.toLocaleString()}</span>
                </div>
              </div>
            </div>
          </div>

          {/* אזהרות */}
          <div className="bg-red-50 border-2 border-red-300 rounded-xl p-4">
            <h4 className="font-bold text-red-900 mb-2 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" />
              נקודות לבדיקה
            </h4>
            <ul className="text-xs text-red-800 space-y-1">
              <li>• האם היתרה כוללת הצמדה? (צריך להיות {currentLoan.remainingBalance})</li>
              <li>• האם חישוב התשלומים הישנים כולל מדד למסלולים צמודים?</li>
              <li>• האם הריבית החדשה ({savings?.newAverageRate}%) נכונה לפברואר 2026?</li>
              <li>• האם עמלת הפירעון ({savings?.earlyRepaymentFee}) מציאותית? (1.5% מהיתרה או מהמסמך)</li>
            </ul>
          </div>
          
          {/* הדפסה למסוף */}
          <Button
            onClick={() => {
              console.log('='.repeat(60));
              console.log('🔍 CALCULATION BREAKDOWN - FULL DATA');
              console.log('='.repeat(60));
              console.log('Current Loan:', currentLoan);
              console.log('Savings:', savings);
              console.log('Surgical Analysis:', surgicalAnalysis);
              console.log('='.repeat(60));
              alert('✅ נתונים מלאים הודפסו ל-Console (F12 -> Console)');
            }}
            variant="outline"
            size="sm"
            className="w-full"
          >
            📋 הדפס נתונים מלאים ל-Console
          </Button>
        </CardContent>
      )}
    </Card>
  );
}