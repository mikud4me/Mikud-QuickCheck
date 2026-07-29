import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingDown, TrendingUp, CheckCircle2 } from 'lucide-react';
import { motion } from 'framer-motion';

export default function RefinanceCalculator({ currentLoan, savings, clientInfo, surgicalAnalysis, partialRefinanceSavings }) {
  if (!savings) return null;

  // תמיכה גם ברשימת לווים (borrowers) וגם בפורמט הישן (name/idNumber בודדים)
  const clientBorrowers = clientInfo?.borrowers?.length
    ? clientInfo.borrowers
    : (clientInfo?.name ? [{ name: clientInfo.name, idNumber: clientInfo.idNumber }] : []);

  // 🔪 זיהוי אסטרטגיה: מחזור מלא vs מחזור חלקי
  const shouldUseSurgical = partialRefinanceSavings?.isWorthwhile && surgicalAnalysis?.strategy?.type === 'SURGICAL';
  const displaySavings = shouldUseSurgical ? partialRefinanceSavings : savings;

  // 🚦 מנגנון הנרטיב המותאם של מיקוד משכנתאות
  const getStrategicInsight = (savingsAmount, isSurgical) => {
    const displayAmount = savingsAmount ? Math.round(savingsAmount).toLocaleString() : '0';

    if (savingsAmount < 0) {
      return {
        type: 'NOT_WORTHWHILE',
        bgColor: 'from-red-950/40 to-[#172A45]',
        borderColor: 'border-red-500/40',
        icon: '⛔',
        iconColor: 'text-red-400',
        iconBg: 'bg-red-500/20',
        title: 'מחזור לא משתלם כרגע',
        description: `עם הריביות הנוכחיות בשוק, מחזור המשכנתא שלך עשוי לעלות יותר מאשר להישאר עם המשכנתא הקיימת. זה יכול להשתנות כשריביות השוק יורדות.`
      };
    }

    if (isSurgical) {
      return {
        type: 'SURGICAL',
        bgColor: 'from-blue-950/30 to-[#172A45]',
        borderColor: 'border-blue-400/40',
        icon: '',
        iconColor: 'text-blue-400',
        iconBg: 'bg-blue-500/20',
        title: surgicalAnalysis.strategy.title,
        description: `${surgicalAnalysis.strategy.description}. חיסכון נטו: ₪${displayAmount}`
      };
    }

    if (savingsAmount && savingsAmount >= 50000) {
      return {
        type: 'PROFIT',
        bgColor: 'from-green-950/30 to-[#172A45]',
        borderColor: 'border-green-500/40',
        icon: '💰',
        iconColor: 'text-green-400',
        iconBg: 'bg-green-500/20',
        title: 'מחזור רווחי במיוחד - תחסוך המון!',
        description: `זיהינו פוטנציאל חיסכון אדיר של ₪${displayAmount}. זהו מהלך כלכלי מתבקש שילך איתכם 20 שנה קדימה.`
      };
    } else if (savingsAmount && savingsAmount >= 20000) {
      return {
        type: 'OPTIMIZATION',
        bgColor: 'from-blue-950/30 to-[#172A45]',
        borderColor: 'border-blue-400/40',
        icon: '✅',
        iconColor: 'text-blue-400',
        iconBg: 'bg-blue-500/20',
        title: 'אופטימיזציה אסטרטגית - משתלם!',
        description: `החיסכון של ₪${displayAmount} משמעותי, אך הערך האמיתי כאן הוא שיפור תמהיל המסלולים והפחתת סיכוני ריבית עתידיים לטווח ארוך.`
      };
    } else {
      return {
        type: 'DEFENSIVE',
        bgColor: 'from-amber-950/30 to-[#172A45]',
        borderColor: 'border-amber-400/40',
        icon: '🛡️',
        iconColor: 'text-amber-400',
        iconBg: 'bg-amber-500/20',
        title: 'מהלך הגנתי חכם - מומלץ!',
        description: `החיסכון הישיר של ₪${displayAmount} עשוי להיראות צנוע, אך המהלך קריטי כדי "לנעול" ריביות נמוכות עכשיו ולמנוע עלייה בתזרים החודשי בשנים הבאות.`
      };
    }
  };

  const netSavings = displaySavings.netSavings;
  const monthlySavingsValue = displaySavings.monthlySavings || savings.monthlySavings;
  const monthsToBreakEven = displaySavings.breakEvenMonths;

  const isNegativeSavings = netSavings < 0;
  const strategicInsight = getStrategicInsight(netSavings, shouldUseSurgical);

  if (isNegativeSavings) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <Card className="glass-card border-2 border-red-500/40 bg-gradient-to-br from-red-950/40 to-[#172A45] shadow-xl">
          <CardHeader className="border-b border-red-500/20">
            <CardTitle className="flex items-center gap-2 text-2xl">
              <div className="w-12 h-12 bg-red-500/20 rounded-xl flex items-center justify-center">
                <span className="text-2xl">⛔</span>
              </div>
              <span className="text-red-400">מחזור לא משתלם כרגע</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="glass-card rounded-xl p-6 mb-4 border border-red-500/30 bg-[#0A192F]/50">
              <h3 className="font-bold text-white mb-3 text-lg">💡 מה זה אומר?</h3>
              <p className="text-[#8892B0] leading-relaxed mb-4">
                עם הריביות הנוכחיות בשוק, מחזור המשכנתא שלך עשוי לעלות יותר מאשר להישאר עם המשכנתא הקיימת.
                זה יכול להשתנות כשריביות השוק יורדות.
              </p>
              <div className="glass-card rounded-lg p-4 text-sm border border-red-500/20">
                <div className="flex justify-between mb-2">
                  <span className="text-[#8892B0]">עלות משכנתא נוכחית:</span>
                  <span className="font-bold text-white">זולה יחסית</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#8892B0]">עלות מחזור משוערת:</span>
                  <span className="font-bold text-red-400">גבוהה יותר (₪{Math.abs(netSavings).toLocaleString()} הפסד)</span>
                </div>
              </div>
            </div>
            <div className="text-sm text-[#8892B0]">
              <strong className="text-white">המלצה:</strong> כדאי להישאר עם המשכנתא הנוכחית כרגע. נעדכן אותך כשהשוק ישתנה.
            </div>
          </CardContent>
        </Card>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <Card className={`glass-card border-2 ${strategicInsight.borderColor} bg-gradient-to-br ${strategicInsight.bgColor} shadow-xl`}>
        <CardHeader className="border-b border-[#C5A059]/20">
          <CardTitle className="flex items-center gap-2 text-2xl">
            {strategicInsight.icon && (
              <div className={`w-12 h-12 ${strategicInsight.iconBg} rounded-xl flex items-center justify-center`}>
                <span className="text-2xl">{strategicInsight.icon}</span>
              </div>
            )}
            <span className={strategicInsight.iconColor}>{strategicInsight.title}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          {/* תוצאת החיסכון הראשית */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div className={`glass-card rounded-2xl p-6 border-2 ${monthlySavingsValue >= 0 ? 'border-green-500/40' : 'border-amber-500/40'}`}>
              <div className="flex items-center gap-3 mb-3">
                <div className={`w-10 h-10 ${monthlySavingsValue >= 0 ? 'bg-green-500/20' : 'bg-amber-500/20'} rounded-xl flex items-center justify-center`}>
                  {monthlySavingsValue >= 0 ? (
                    <TrendingDown className="w-6 h-6 text-green-400" />
                  ) : (
                    <TrendingUp className="w-6 h-6 text-amber-400" />
                  )}
                </div>
                <p className="text-base font-bold text-[#8892B0]">
                  {monthlySavingsValue >= 0 ? 'חיסכון חודשי' : 'השקעה חודשית'}
                </p>
              </div>
              <p className={`text-5xl font-black ${monthlySavingsValue >= 0 ? 'text-green-400' : 'text-amber-400'} mb-1`}>
                ₪{Math.abs(monthlySavingsValue)?.toLocaleString()}
              </p>
              <p className="text-sm text-[#8892B0]">
                {monthlySavingsValue >= 0 ? 'פחות בכל חודש!' : 'לקיצור תקופה'}
              </p>
            </div>

            <div className="glass-card rounded-2xl p-6 border-2 border-[#C5A059]/40">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 bg-[#C5A059]/20 rounded-xl flex items-center justify-center">
                  <span className="text-xl">💰</span>
                </div>
                <p className="text-base font-bold text-[#8892B0]">חיסכון כולל נטו</p>
              </div>
              <p className="text-5xl font-black text-[#D4AF37] mb-1">
                ₪{netSavings?.toLocaleString()}
              </p>
              <p className="text-sm text-[#8892B0]">לאורך כל התקופה</p>
            </div>
          </div>

          {/* פרטי לקוח */}
          {clientBorrowers.length > 0 && (
            <div className="glass-card border border-[#C5A059]/30 rounded-xl p-5 mb-6">
              <h3 className="font-bold text-white text-lg mb-4">פרטי לקוח</h3>
              <div className="space-y-2">
                {clientBorrowers.map((borrower, i) => (
                  <div key={i} className="flex items-center justify-between glass-card rounded-lg px-4 py-3 border border-[#C5A059]/20">
                    <div className="flex items-center gap-3">
                      <span className="w-8 h-8 bg-[#C5A059]/20 rounded-full flex items-center justify-center text-sm font-bold text-[#D4AF37] flex-shrink-0">
                        {i + 1}
                      </span>
                      <span className="font-bold text-white">{borrower.name || 'לא זוהה שם'}</span>
                    </div>
                    <div className="text-sm text-[#8892B0]">
                      ת.ז:{' '}
                      <span className="font-bold text-white">{borrower.idNumber || 'לא זוהה'}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* תצוגת השפעת המדד */}
          {currentLoan.tracks && currentLoan.tracks.some(t =>
            t.track_type.toLowerCase().includes('צמוד') || t.track_type.toLowerCase().includes('linked')
          ) && (
            <div className="mb-6 glass-card border border-amber-500/30 rounded-xl p-6">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-amber-500/20 rounded-xl flex items-center justify-center flex-shrink-0">
                  <span className="text-2xl">📈</span>
                </div>
                <div>
                  <h4 className="font-bold text-amber-300 text-lg mb-2">
                    ⚠️ השפעת המדד על התשלומים העתידיים
                  </h4>
                  <p className="text-sm text-[#8892B0] leading-relaxed mb-3">
                    יש לך מסלולים צמודים למדד. תחזית המדד לשנים הבאות היא 2.5% שנתי, מה שאומר שהתשלום החודשי שלך
                    <span className="font-bold text-white"> יעלה בכל חודש</span>. המערכת כבר לקחה זאת בחשבון בחישוב החיסכון.
                  </p>
                  <div className="glass-card rounded-lg p-3 text-xs border border-amber-500/20">
                    <div className="flex justify-between mb-1">
                      <span className="text-amber-300/80">תשלום היום:</span>
                      <span className="font-bold text-white">₪{currentLoan.monthlyPayment?.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-amber-300/80">תשלום משוער בעוד 10 שנים (עם מדד):</span>
                      <span className="font-bold text-white">
                        ₪{Math.round(currentLoan.monthlyPayment * Math.pow(1.025, 10)).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ניתוח אסטרטגי */}
          <div className={`p-6 rounded-xl border-2 ${strategicInsight.borderColor} bg-gradient-to-br ${strategicInsight.bgColor}`}>
            <div className="flex items-start gap-4">
              <div className={`w-14 h-14 ${strategicInsight.iconBg} rounded-xl flex items-center justify-center flex-shrink-0`}>
                <span className="text-3xl">{strategicInsight.icon}</span>
              </div>
              <div>
                <h4 className={`font-bold text-xl mb-3 ${strategicInsight.iconColor}`}>
                  {strategicInsight.title}
                </h4>
                <p className="text-base leading-relaxed text-[#8892B0] mb-4">
                  {strategicInsight.description}
                </p>

                {/* פירוט מספרי */}
                <div className="glass-card rounded-lg p-4 border border-[#C5A059]/20">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-[#8892B0] mb-1">
                        {monthlySavingsValue >= 0 ? 'חיסכון חודשי' : 'השקעה חודשית'}
                      </p>
                      <p className={`font-bold text-lg ${monthlySavingsValue >= 0 ? strategicInsight.iconColor : 'text-amber-400'}`}>
                        ₪{Math.abs(monthlySavingsValue)?.toLocaleString()}
                      </p>
                      {monthlySavingsValue < 0 && (
                        <p className="text-xs text-amber-400/80 mt-1">לקיצור תקופה</p>
                      )}
                    </div>
                    <div>
                      <p className="text-[#8892B0] mb-1">נקודת איזון</p>
                      <p className={`font-bold text-lg ${strategicInsight.iconColor}`}>
                        {monthsToBreakEven} חודשים
                      </p>
                    </div>
                  </div>
                </div>

                {/* קריאה לפעולה */}
                <div className="mt-4 flex items-center gap-2 text-sm">
                  <CheckCircle2 className={`w-5 h-5 ${strategicInsight.iconColor}`} />
                  <span className="font-bold text-white">
                    {strategicInsight.type === 'PROFIT' && 'מומלץ בחום - זהו חלון הזדמנויות!'}
                    {strategicInsight.type === 'OPTIMIZATION' && 'מומלץ - השקעה חכמה לטווח ארוך'}
                    {strategicInsight.type === 'DEFENSIVE' && 'מומלץ - מהלך הגנתי נכון לפברואר 2026'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
