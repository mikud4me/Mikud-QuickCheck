import React, { useState } from 'react';
import { Briefcase, Home, Banknote, ChevronLeft, ArrowLeft, Target, RefreshCw, Landmark, Crown, CreditCard, Sparkles } from 'lucide-react';

/**
 * DealSetupModal — מסך פתיחת תיק (Underwriting Policy Setup).
 * אוסף את מבנה העסקה המלא לפני העלאת מסמכים כדי שמנוע המדיניות ינתח נכון:
 *   1. סוג המשכנתא (Dropdown מקיף — כל סוגי השוק הישראלי)
 *   2. דגלי חתם מפורשים: איחוד חובות עו"ש / שבתון מורים מאושר
 *   3. שווי נכס + סכום מבוקש (מחושב LTV)
 * הנתונים נארזים ל-deal_context (כולל policy flags) + wizardData ונשלחים לשרת.
 */

const PRODUCT_OPTIONS = [
  { value: 'purchase', label: 'רכישת נכס (יד 2 / קבלן / מחיר למשתכן)', icon: Home, hint: 'חישוב LTV מול שווי הנכס הנרכש', loan_purpose: 'purchase' },
  { value: 'refinance_only', label: 'מחזור משכנתא בלבד', icon: RefreshCw, hint: 'מחזור המשכנתא הקיימת — ללא איחוד חובות צרכניים', loan_purpose: 'refinance' },
  { value: 'refinance_consolidation', label: 'מחזור ואיחוד חובות', icon: Target, hint: 'המשכנתא החדשה סוגרת הלוואות צרכניות — לא נספרות ב-PTI', loan_purpose: 'refinance' },
  { value: 'any_purpose', label: 'משכנתא לכל מטרה (שעבוד נכס קיים)', icon: Landmark, hint: 'הלוואה כנגד נכס קיים ללא רכישה', loan_purpose: 'any_purpose' },
  { value: 'reverse_mortgage', label: 'משכנתא לגיל הזהב (משכנתא הפוכה)', icon: Crown, hint: 'ללא החזר חודשי שוטף — מבוסס שווי נכס וגיל', loan_purpose: 'reverse' },
];

const fmt = (n) => (n ? Number(n).toLocaleString('he-IL') : '');
const parseNum = (s) => Number(String(s).replace(/[^\d]/g, '')) || 0;

export default function DealSetupModal({ initialCaseType, onConfirm, onBack }) {
  const [product, setProduct] = useState(
    initialCaseType === 'refinance' ? 'refinance_consolidation' : 'purchase'
  );
  const [propertyValue, setPropertyValue] = useState('');
  const [requestedAmount, setRequestedAmount] = useState('');
  const [touched, setTouched] = useState(false);

  // ── Identity Anchors — עוגני זהות קשיחים ──
  const [b1Name, setB1Name] = useState('');
  const [b1Id, setB1Id] = useState('');
  const [b2Name, setB2Name] = useState('');
  const [b2Id, setB2Id] = useState('');

  // ── Underwriter Policy Flags ──
  const [consolidateDebts, setConsolidateDebts] = useState(false);

  const selectedProduct = PRODUCT_OPTIONS.find(p => p.value === product) || PRODUCT_OPTIONS[0];
  const isReverse = product === 'reverse_mortgage';
  const isConsolidationProduct = product === 'refinance_consolidation';
  // עסקת מחזור — השדה המספרי השני מייצג "יתרת משכנתא קיימת", לא "סכום מבוקש"
  const isRefinanceProduct = selectedProduct.loan_purpose === 'refinance';

  const propVal = parseNum(propertyValue);
  const reqAmt = parseNum(requestedAmount);
  // משכנתא הפוכה — אין החזר חודשי; LTV מבוסס שווי בלבד
  const ltv = propVal > 0 && reqAmt > 0 ? Math.round((reqAmt / propVal) * 100) : null;

  // משכנתא הפוכה / מחזור — סכום השדה אינו חובה כדי להמשיך:
  // במחזור היתרה תילקח מ"דוח יתרות לסילוק" אם השדה ריק.
  const valid = product && propVal > 0 && (isReverse || isRefinanceProduct || reqAmt > 0);

  const handleConfirm = () => {
    setTouched(true);
    if (!valid) return;

    // איחוד חובות מופעל אוטומטית במוצר "מחזור ואיחוד", או ידנית ע"י החתם
    const doConsolidate = isConsolidationProduct || consolidateDebts;

    // ── Identity Anchors — עוגני זהות שהחתם הגדיר מראש ──
    const identityAnchors = [];
    if (b1Name.trim() || b1Id.trim()) identityAnchors.push({ name: b1Name.trim(), id: b1Id.replace(/\D/g, '').padStart(9,'0').slice(-9) });
    if (b2Name.trim() || b2Id.trim()) identityAnchors.push({ name: b2Name.trim(), id: b2Id.replace(/\D/g, '').padStart(9,'0').slice(-9) });

    // deal_context — נשלח כפרמטר ל-processUnderwriterCase / normalizeDocData
    const dealContext = {
      loan_purpose: selectedProduct.loan_purpose,
      product_type: product,
      product_label: selectedProduct.label,
      estimated_property_value: propVal,
      requested_mortgage_amount: isReverse ? 0 : reqAmt,
      ltv_projected: ltv,
      // ── Policy Flags — חוקים קשיחים שהחתם הגדיר ──
      consolidate_existing_debts: doConsolidate,
      teacher_sabbatical_approved: false,
      is_reverse_mortgage: isReverse,
      // ── Identity Anchors — עוגני זהות דטרמיניסטיים ──
      identity_anchors: identityAnchors,
    };
    // wizardData — שדות ש-buildUnderwriterReport כבר קורא מהם
    const wizardData = {
      caseType: selectedProduct.loan_purpose === 'refinance' ? 'refinance' : 'mortgage',
      loanPurposeWizard: selectedProduct.loan_purpose,
      productType: product,
      estimatedPropertyValue: propVal,
      requestedMortgageAmount: isReverse ? 0 : reqAmt,
      requestedLoanAmountWizard: isReverse ? 0 : reqAmt,
    };
    onConfirm({ dealContext, wizardData });
  };

  return (
    <div className="max-w-2xl mx-auto py-10 px-4 space-y-7" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        {onBack ? (
          <button onClick={onBack} className="text-[#8892B0] hover:text-[#C5A059] text-sm flex items-center gap-1.5 transition-colors">
            <ChevronLeft className="w-4 h-4" />
            חזור
          </button>
        ) : <div className="w-16" />}
        <div className="inline-flex items-center gap-2 bg-[#C5A059]/10 border border-[#C5A059]/30 rounded-full px-4 py-1.5">
          <Briefcase className="w-3.5 h-3.5 text-[#C5A059]" />
          <span className="text-[#C5A059] text-xs font-bold tracking-widest">פתיחת תיק חיתום</span>
        </div>
        <div className="w-16" />
      </div>

      <div className="text-center">
        <h2 className="text-white text-2xl font-bold tracking-tight">הגדרת מבנה העסקה</h2>
        <p className="text-[#8892B0] text-sm mt-2">
          לפני העלאת המסמכים — הגדר את סוג המשכנתא ומבנה העסקה.<br />
          <span className="text-[#C5A059]">מנוע המדיניות יחיל חוקי חיתום שונים בהתאם להגדרות אלו.</span>
        </p>
      </div>

      {/* Product Dropdown */}
      <div className="space-y-3">
        <label className="text-[#8892B0] text-xs font-bold tracking-wider">סוג המשכנתא / מוצר</label>
        <div className="grid grid-cols-1 gap-2.5">
          {PRODUCT_OPTIONS.map(opt => {
            const Icon = opt.icon;
            const active = product === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => setProduct(opt.value)}
                className={`flex items-center gap-3 px-4 py-3.5 rounded-xl border text-right transition-all ${
                  active
                    ? 'border-[#C5A059]/60 bg-[#C5A059]/8'
                    : 'border-[#1e2d4a] bg-[#0d1524] hover:border-[#C5A059]/30'
                }`}
              >
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${active ? 'bg-[#C5A059]/15' : 'bg-[#111827]'}`}>
                  <Icon className={`w-4 h-4 ${active ? 'text-[#C5A059]' : 'text-[#8892B0]'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold ${active ? 'text-white' : 'text-[#cbd5e1]'}`}>{opt.label}</p>
                  <p className="text-[#4a5568] text-xs mt-0.5">{opt.hint}</p>
                </div>
                <div className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${active ? 'border-[#C5A059]' : 'border-[#2a3a55]'}`}>
                  {active && <div className="w-1.5 h-1.5 rounded-full bg-[#C5A059]" />}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Underwriter Policy Toggle Flags ── */}
      <div className="space-y-3">
        <label className="text-[#8892B0] text-xs font-bold tracking-wider">הגדרות חיתום (חוקים קשיחים)</label>

        {/* Debt Consolidation */}
        <PolicyToggle
          icon={CreditCard}
          active={isConsolidationProduct || consolidateDebts}
          locked={isConsolidationProduct}
          onToggle={() => setConsolidateDebts(v => !v)}
          title='איחוד חובות — סגירת הלוואות עו"ש קיימות'
          hint={isConsolidationProduct
            ? 'מופעל אוטומטית במוצר "מחזור ואיחוד" — ההלוואות הקיימות לא ייספרו ב-PTI'
            : 'המשכנתא החדשה תסגור את ההלוואות הקיימות — לא ייספרו ב-PTI העתידי'}
        />

      </div>

      {/* Numeric inputs */}
      <div className={`grid grid-cols-1 ${isReverse ? '' : 'sm:grid-cols-2'} gap-4`}>
        <div className="space-y-2">
          <label className="text-[#8892B0] text-xs font-bold tracking-wider flex items-center gap-1.5">
            <Home className="w-3.5 h-3.5" /> שווי נכס מוערך
          </label>
          <div className="relative">
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[#4a5568] text-sm">₪</span>
            <input
              inputMode="numeric"
              value={propVal > 0 ? fmt(propVal) : ''}
              onChange={e => setPropertyValue(e.target.value)}
              className={`w-full bg-[#0d1524] border text-white text-sm rounded-xl px-4 py-3 pr-8 outline-none transition-colors font-mono ${
                touched && propVal <= 0 ? 'border-red-500/50' : 'border-[#1e2d4a] focus:border-[#C5A059]/40'
              }`}
            />
          </div>
        </div>
        {!isReverse && (
          <div className="space-y-2">
            <label className="text-[#8892B0] text-xs font-bold tracking-wider flex items-center gap-1.5">
              {isRefinanceProduct ? <RefreshCw className="w-3.5 h-3.5" /> : <Banknote className="w-3.5 h-3.5" />}
              {isRefinanceProduct ? 'יתרת משכנתא קיימת' : 'סכום משכנתא מבוקש'}
            </label>
            <div className="relative">
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[#4a5568] text-sm">₪</span>
              <input
                inputMode="numeric"
                value={reqAmt > 0 ? fmt(reqAmt) : ''}
                onChange={e => setRequestedAmount(e.target.value)}
                placeholder={isRefinanceProduct ? 'יוחלץ מדוח יתרות (לא חובה)' : '1,500,000'}
                className={`w-full bg-[#0d1524] border text-white text-sm rounded-xl px-4 py-3 pr-8 outline-none transition-colors font-mono ${
                  touched && !isRefinanceProduct && reqAmt <= 0 ? 'border-red-500/50' : 'border-[#1e2d4a] focus:border-[#C5A059]/40'
                }`}
              />
            </div>
            {isRefinanceProduct && (
              <p className="text-[#4a5568] text-[11px] leading-relaxed">
                היתרה הישנה. אם תושאר ריקה — המערכת תיקח אותה מדוח היתרות לסילוק שחולץ מהמסמכים.
                {isConsolidationProduct && ' חובות העו"ש לאיחוד יתווספו אוטומטית לחישוב המשכנתא החדשה.'}
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── Identity Anchors Section ── */}
      <div className="space-y-3">
        <label className="text-[#8892B0] text-xs font-bold tracking-wider flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#C5A059]" />
          עוגני זהות — נעילת לווים (מומלץ מאוד)
        </label>
        <p className="text-[#4a5568] text-xs">
          הזן שם ות.ז. של הלווים. המנוע ישייך תלושים ומסמכים <strong className="text-[#C5A059]">אך ורק</strong> לפי ת.ז. אלו — ימנע ערבוב בין בני זוג.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Borrower 1 */}
          <div className="space-y-2 bg-[#0d1524] border border-[#1e2d4a] rounded-xl p-4">
            <p className="text-[#C5A059] text-xs font-bold">לווה 1 (ראשי)</p>
            <input
              value={b1Name}
              onChange={e => setB1Name(e.target.value)}
              placeholder="שם מלא — לווה 1"
              className="w-full bg-[#111827] border border-[#1e2d4a] focus:border-[#C5A059]/40 text-white rounded-lg px-3 py-2 text-sm outline-none placeholder:text-[#3a4a65]"
            />
            <input
              value={b1Id}
              onChange={e => setB1Id(e.target.value)}
              placeholder="ת.ז — 9 ספרות"
              maxLength={9}
              inputMode="numeric"
              className="w-full bg-[#111827] border border-[#1e2d4a] focus:border-[#C5A059]/40 text-white rounded-lg px-3 py-2 text-sm outline-none placeholder:text-[#3a4a65] font-mono"
            />
          </div>
          {/* Borrower 2 */}
          <div className="space-y-2 bg-[#0d1524] border border-[#1e2d4a] rounded-xl p-4">
            <p className="text-[#8892B0] text-xs font-bold">לווה 2 (שני) — אופציונלי</p>
            <input
              value={b2Name}
              onChange={e => setB2Name(e.target.value)}
              placeholder="שם מלא — לווה 2"
              className="w-full bg-[#111827] border border-[#1e2d4a] focus:border-[#C5A059]/40 text-white rounded-lg px-3 py-2 text-sm outline-none placeholder:text-[#3a4a65]"
            />
            <input
              value={b2Id}
              onChange={e => setB2Id(e.target.value)}
              placeholder="ת.ז — 9 ספרות"
              maxLength={9}
              inputMode="numeric"
              className="w-full bg-[#111827] border border-[#1e2d4a] focus:border-[#C5A059]/40 text-white rounded-lg px-3 py-2 text-sm outline-none placeholder:text-[#3a4a65] font-mono"
            />
          </div>
        </div>
      </div>

      {/* Smart Engine Notice — מנוע החיתום בוחר ריבית ותקופה לבד */}
      {!isReverse && (
        <div className="flex items-start gap-3 rounded-xl px-5 py-3.5 border border-[#C5A059]/25 bg-[#C5A059]/5">
          <Sparkles className="w-4 h-4 text-[#C5A059] mt-0.5 shrink-0" />
          <p className="text-[#cbd5e1] text-xs leading-relaxed">
            <span className="text-[#C5A059] font-bold">מנוע החיתום החכם יעבוד עבורך.</span> אין צורך להזין ריבית או שנים —
            המערכת תקרא את נתוני האמת מהמסמכים (יתרות, ריביות קיימות, גיל הלווים) ותבנה אוטומטית
            פתרון מיטבי במבחן לחץ שמרני, עם שורה תחתונה ברורה של כדאיות.
          </p>
        </div>
      )}

      {/* Projected LTV */}
      {ltv != null && !isReverse && (
        <div className={`flex items-center justify-between rounded-xl px-5 py-3.5 border ${
          ltv > 75 ? 'border-red-500/30 bg-red-500/5' : ltv > 60 ? 'border-amber-500/30 bg-amber-500/5' : 'border-emerald-500/30 bg-emerald-500/5'
        }`}>
          <div className="flex items-center gap-2">
            <Target className={`w-4 h-4 ${ltv > 75 ? 'text-red-400' : ltv > 60 ? 'text-amber-400' : 'text-emerald-400'}`} />
            <span className="text-[#8892B0] text-sm">LTV עתידי משוער (לפני שמאות)</span>
          </div>
          <span className={`font-mono font-bold text-lg ${ltv > 75 ? 'text-red-400' : ltv > 60 ? 'text-amber-400' : 'text-emerald-400'}`}>
            {ltv}%
          </span>
        </div>
      )}

      {touched && !valid && (
        <p className="text-red-400 text-xs text-center">
          {(isReverse || isRefinanceProduct) ? 'יש למלא שווי נכס כדי להמשיך.' : 'יש למלא שווי נכס וסכום מבוקש כדי להמשיך.'}
        </p>
      )}

      <button
        onClick={handleConfirm}
        disabled={!valid}
        className="w-full py-4 bg-[#C5A059] hover:bg-[#D4AF37] disabled:opacity-40 disabled:cursor-not-allowed text-[#0A0F1A] font-bold text-sm rounded-xl transition-all flex items-center justify-center gap-2"
      >
        המשך להעלאת מסמכים
        <ArrowLeft className="w-4 h-4" />
      </button>
    </div>
  );
}

function PolicyToggle({ icon: Icon, active, locked, onToggle, title, hint }) {
  return (
    <button
      onClick={locked ? undefined : onToggle}
      disabled={locked}
      className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border text-right transition-all ${
        active
          ? 'border-emerald-500/40 bg-emerald-500/5'
          : 'border-[#1e2d4a] bg-[#0d1524] hover:border-[#C5A059]/30'
      } ${locked ? 'cursor-default' : 'cursor-pointer'}`}
    >
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${active ? 'bg-emerald-500/15' : 'bg-[#111827]'}`}>
        <Icon className={`w-4 h-4 ${active ? 'text-emerald-400' : 'text-[#8892B0]'}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold ${active ? 'text-white' : 'text-[#cbd5e1]'}`}>{title}</p>
        <p className="text-[#4a5568] text-xs mt-0.5">{hint}</p>
      </div>
      {/* Switch */}
      <div className={`w-10 h-5 rounded-full shrink-0 relative transition-colors ${active ? 'bg-emerald-500' : 'bg-[#2a3a55]'}`}>
        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${active ? 'right-0.5' : 'right-[22px]'}`} />
      </div>
    </button>
  );
}