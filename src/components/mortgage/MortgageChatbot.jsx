import React, { useState, useEffect, useRef } from 'react';
import { MessageCircle, X, Send, Loader2, Calculator, FileText, TrendingUp, Phone, ChevronDown } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import ReactMarkdown from 'react-markdown';

const KNOWLEDGE_BASE = `
אתה מיקו - יועץ משכנתאות AI מקצועי של מיקוד משכנתאות. 
אתה חם, מקצועי, מדויק, ומדבר בעברית פשוטה וברורה.
אל תשתמש במונחים טכניים מיותרים — הסבר בצורה שכל אחד מבין.

## על מיקוד משכנתאות:
- חברת ייעוץ משכנתאות מובילה בישראל
- טלפון: *2324
- שירות דיגיטלי מלא — ממלאים פרטים אונליין וקיבלת תמהילים תוך דקות
- הגשה מקבילה ל-6 בנקים: לאומי, הפועלים, דיסקונט, מזרחי טפחות, בינלאומי, ירושלים

## כללים בישראל:
- LTV (יחס מימון): עד 75% לדירה ראשונה, עד 70% לשנייה, עד 50% להשקעה
- ה-PTI (יחס החזר להכנסה): עד 40% מהכנסה נטו חודשית
- תקופה מקסימלית: 30 שנה (לרוב הבנקים)
- גיל: ההחזר האחרון לא יעבור גיל 75-80 בממוצע

## ריביות משוערות כיום (פברואר 2026):
- פריים: בנק ישראל 4.5% → פריים = 6% (בנקים נותנים פריים מינוס 0.3%-1%)
- קבועה לא צמודה: 4.5%-5.5% לרוב
- קבועה צמודה: 3%-4%
- משתנה: 3.5%-4.5%
שים לב: אלו הערכות בלבד — הריבית הסופית תלויה בפרופיל הלקוח ובמשא ומתן

## סוגי מסלולים — הסבר פשוט:
1. **פריים** — ריבית שמשתנה עם ריבית בנק ישראל. זול כשהריבית נמוכה, מסוכן כשעולה. מומלץ: עד 33% מהמשכנתא.
2. **קבועה לא צמודה** — הריבית קבועה, ההחזר ידוע לאורך כל הדרך. הכי בטוח. יקר יותר.
3. **קבועה צמודה** — ריבית נמוכה יותר אבל ההלוואה "מתנפחת" עם המדד. סיכון אינפלציה.
4. **משתנה צמודה** — ריבית מתעדכנת כל 5 שנים + הצמדה. גמישות בינונית.
5. **משתנה לא צמודה** — ריבית מתעדכנת ללא הצמדה. גמישה.

## מחזור משכנתא:
- מה זה? החלפת משכנתא קיימת במשכנתא חדשה בריביות נמוכות יותר
- מתי כדאי? כשהריביות בשוק נמוכות מהריבית שלך ביותר מ-1%
- כמה עולה? פיצוי מוקדם + עמלות בנק = בדרך כלל 5,000-15,000 ₪
- נקודת איזון: לרוב 18-36 חודשים
- חיסכון אפשרי: 500-3,000 ₪ בחודש!
- **יש לנו כלי אוטומטי שמחשב את החיסכון שלך בדיוק** — בדיקת מחזור מהירה

## מה קורה בתהליך עם מיקוד:
1. ממלאים פרטים אונליין (5 דקות)
2. חותמים על הסכם דיגיטלי
3. מעלים מסמכים (תלושי שכר, דפי חשבון, ת"ז)
4. מקבלים 3 תמהילים מותאמים אישית
5. משלמים עמלת שירות (2,500 ₪)
6. אנחנו מגישים ל-6 בנקים בו-זמנית ומנהלים משא ומתן

## הנחיות מענה:
- ענה בקצרה — עד 150 מילה בדרך כלל
- היה חם וידידותי, לא "בוטי"
- אם שואלים "כמה אוכל ללוות" — עזור לחשב לפי הכנסה × 40% ÷ החזר חודשי
- אם שואלים על מחזור — הפנה לבדיקת מחזור מהירה (כפתור למטה)
- אם שואלים על רכישת נכס — הפנה לתהליך הדיגיטלי
- אם שאלה מורכבת — המלץ לשוחח עם יועץ ב-*2324
- אל תמציא ריביות מדויקות — ציין שאלו הערכות בלבד
- אם יש בקשה לחישוב — עשה אותו! חשב ותסביר
`;

const FAQ_CHIPS = [
  { label: '💰 כמה אוכל ללוות?', question: 'כמה כסף אני יכול ללוות למשכנתא? הכנסתי נטו היא X שקל' },
  { label: '🔄 מחזור משכנתא', question: 'מה זה מחזור משכנתא ומתי כדאי לעשות אחד?' },
  { label: '📊 איזה מסלול מומלץ?', question: 'איזה מסלול משכנתא מומלץ לי — פריים, קבועה או משתנה?' },
  { label: '🏦 מה הריבית היום?', question: 'מה הריביות על משכנתא כיום בישראל?' },
  { label: '📋 מה המסמכים הנדרשים?', question: 'אילו מסמכים צריך להביא לבנק לקבלת משכנתא?' },
  { label: '⏱️ כמה זמן לוקח?', question: 'כמה זמן לוקח תהליך קבלת המשכנתא?' },
];

const QUICK_ACTIONS = [
  { icon: TrendingUp, label: 'בדיקת מחזור', page: 'RefinanceQuickCheck', color: 'bg-green-600 hover:bg-green-700' },
  { icon: FileText, label: 'פתח תיק', page: 'ClientWorkflow', color: 'bg-blue-600 hover:bg-blue-700' },
  { icon: Calculator, label: 'מחשבון', page: 'Calculator', color: 'bg-slate-700 hover:bg-slate-800' },
];

export default function MortgageChatbot() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [showFAQ, setShowFAQ] = useState(true);
  const chatEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (isOpen && messages.length === 0) {
      setMessages([{
        role: 'assistant',
        text: 'שלום! 👋 אני **מיקו**, יועץ המשכנתאות הדיגיטלי של מיקוד.\n\nאני כאן לעזור לך עם כל שאלה על משכנתאות — חישובים, מסלולים, מחזור, ועוד.\n\nמה תרצה לדעת?'
      }]);
    }
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [isOpen]);

  const sendMessage = async (text) => {
    if (!text.trim() || loading) return;

    const userMsg = text.trim();
    setInput('');
    setShowFAQ(false);

    const updatedMessages = [...messages, { role: 'user', text: userMsg }];
    setMessages(updatedMessages);
    setLoading(true);

    // בנה היסטוריית שיחה לקונטקסט
    const conversationHistory = updatedMessages
      .slice(-8) // שמור 8 הודעות אחרונות
      .map(m => `${m.role === 'user' ? 'לקוח' : 'מיקו'}: ${m.text}`)
      .join('\n');

    try {
      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `${KNOWLEDGE_BASE}

## היסטוריית השיחה:
${conversationHistory}

## שאלת הלקוח כעת:
${userMsg}

ענה בעברית, בצורה ידידותית ומקצועית. קצר וברור.`,
        add_context_from_internet: false
      });

      const replyText = typeof response === 'string' 
        ? response 
        : (response?.response || response?.text || 'מצטער, לא הצלחתי לענות. נסה שוב או פנה אלינו ב-*2324');

      setMessages(prev => [...prev, { role: 'assistant', text: replyText }]);
    } catch {
      setMessages(prev => [...prev, {
        role: 'assistant',
        text: 'מצטער, חלה שגיאה. אנא נסה שוב או פנה אלינו ב-📞 *2324'
      }]);
    } finally {
      setLoading(false);
    }
  };

  const handleSend = () => sendMessage(input);
  const handleFAQ = (chip) => sendMessage(chip.question);
  const handleQuickAction = (page) => window.location.href = createPageUrl(page);

  return (
    <div className="fixed bottom-6 left-6 z-50 flex flex-col items-start" dir="rtl">
      {/* Chat Window */}
      {isOpen && (
        <div className="bg-white w-[390px] mb-4 rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden"
          style={{ height: '580px' }}>

          {/* Header */}
          <div className="bg-gradient-to-l from-slate-900 to-slate-800 p-4 text-white flex justify-between items-center flex-shrink-0">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="w-11 h-11 rounded-full bg-amber-400 flex items-center justify-center text-slate-900 font-black text-lg shadow-lg">
                  מ
                </div>
                <div className="absolute -bottom-0.5 -left-0.5 w-3 h-3 bg-green-400 rounded-full border-2 border-slate-900" />
              </div>
              <div>
                <h3 className="font-black text-sm tracking-tight">מיקו · יועץ משכנתאות AI</h3>
                <p className="text-xs text-slate-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 bg-green-400 rounded-full inline-block" />
                  מחובר עכשיו · מיקוד משכנתאות
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <a 
                href="tel:*2324"
                className="flex items-center gap-1 text-xs bg-amber-400 text-slate-900 px-2 py-1 rounded-lg font-black hover:bg-amber-300 transition-colors"
              >
                <Phone className="w-3 h-3" />
                *2324
              </a>
              <button onClick={() => setIsOpen(false)} className="hover:bg-white/10 p-1.5 rounded-lg transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="flex gap-2 p-3 bg-slate-50 border-b border-slate-100 flex-shrink-0">
            {QUICK_ACTIONS.map((action, i) => {
              const Icon = action.icon;
              return (
                <button
                  key={i}
                  onClick={() => handleQuickAction(action.page)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl text-white text-xs font-bold transition-colors ${action.color}`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {action.label}
                </button>
              );
            })}
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50">
            {messages.map((msg, i) => (
              <div key={i} className={`flex items-end gap-2 ${msg.role === 'user' ? 'justify-start flex-row-reverse' : 'justify-start'}`}>
                {msg.role === 'assistant' && (
                  <div className="w-7 h-7 rounded-full bg-amber-400 flex items-center justify-center text-slate-900 font-black text-xs flex-shrink-0 mb-1">
                    מ
                  </div>
                )}
                <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 shadow-sm text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-slate-800 text-white rounded-bl-none'
                    : 'bg-white text-slate-800 rounded-br-none border border-slate-200'
                }`}>
                  {msg.role === 'assistant' ? (
                    <ReactMarkdown
                      className="prose prose-sm max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:mb-1.5 [&_ul]:mr-4 [&_ul]:list-disc [&_li]:mb-0.5 [&_strong]:font-bold"
                    >
                      {msg.text}
                    </ReactMarkdown>
                  ) : (
                    <p>{msg.text}</p>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex items-end gap-2">
                <div className="w-7 h-7 rounded-full bg-amber-400 flex items-center justify-center text-slate-900 font-black text-xs flex-shrink-0">
                  מ
                </div>
                <div className="bg-white border border-slate-200 rounded-2xl rounded-br-none px-4 py-3 shadow-sm">
                  <div className="flex gap-1 items-center">
                    <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}

            {/* FAQ Chips */}
            {showFAQ && messages.length <= 1 && !loading && (
              <div className="space-y-2 pt-2">
                <p className="text-xs text-slate-400 font-medium text-center">שאלות נפוצות — לחץ לשאול:</p>
                <div className="flex flex-wrap gap-2">
                  {FAQ_CHIPS.map((chip, i) => (
                    <button
                      key={i}
                      onClick={() => handleFAQ(chip)}
                      className="text-xs bg-white border border-slate-200 hover:border-amber-400 hover:bg-amber-50 text-slate-700 px-3 py-1.5 rounded-full transition-all shadow-sm font-medium"
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Show FAQ again button */}
            {!showFAQ && messages.length > 1 && (
              <button
                onClick={() => setShowFAQ(true)}
                className="w-full text-xs text-slate-400 hover:text-slate-600 flex items-center justify-center gap-1 py-1 transition-colors"
              >
                <ChevronDown className="w-3 h-3" />
                שאלות נפוצות
              </button>
            )}

            {showFAQ && messages.length > 1 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {FAQ_CHIPS.map((chip, i) => (
                  <button
                    key={i}
                    onClick={() => handleFAQ(chip)}
                    className="text-xs bg-white border border-slate-200 hover:border-amber-400 hover:bg-amber-50 text-slate-700 px-3 py-1.5 rounded-full transition-all shadow-sm font-medium"
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* Input */}
          <div className="p-3 bg-white border-t border-slate-100 flex-shrink-0">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                className="flex-1 bg-slate-100 border-0 rounded-xl px-4 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-400/50"
                placeholder="שאל אותי כל שאלה על משכנתא..."
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSend()}
                disabled={loading}
              />
              <button
                onClick={handleSend}
                disabled={loading || !input.trim()}
                className="bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white rounded-xl px-4 transition-colors"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
            <p className="text-[10px] text-slate-400 text-center mt-2">
              מיקו הוא עוזר AI — לייעוץ מחייב התקשרו <strong>*2324</strong>
            </p>
          </div>
        </div>
      )}

      {/* Toggle Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative w-24 h-24 bg-white rounded-full shadow-2xl hover:scale-110 transition-all flex items-center justify-center border-4 border-amber-400 overflow-hidden"
      >
        {isOpen ? (
          <X className="w-7 h-7 text-slate-800" />
        ) : (
          <>
            <img
              src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/6969f8ed362d4cf13c0e3732/16f8c88ea_Gemini_Generated_Image_ae1zscae1zscae1z2.jpg"
              alt="מיקוד משכנתאות"
              className="w-full h-full object-contain p-1"
            />
            <div className="absolute -top-1 -right-1 w-4 h-4 bg-green-400 rounded-full border-2 border-white animate-pulse" />
          </>
        )}
      </button>
    </div>
  );
}