import React, { useState } from 'react';
import { MessageSquare, ChevronLeft, Loader2, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function IntakeQuestionsPanel({ questions, onSubmit, isLoading, diagnosis }) {
  const [answers, setAnswers] = useState({});

  const handleChange = (id, value) => {
    setAnswers(prev => ({ ...prev, [id]: value }));
  };

  const allAnswered = questions.every(q => {
    const val = answers[q.id];
    if (q.type === 'boolean') return val !== undefined;
    return val !== undefined && val !== '';
  });

  return (
    <div className="bg-slate-800/60 border border-amber-500/30 rounded-2xl p-6 mb-6 shadow-2xl" dir="rtl">
      <div className="flex items-center gap-3 mb-3">
        <div className="p-2 bg-amber-500/10 rounded-xl">
          <MessageSquare className="w-5 h-5 text-amber-400" />
        </div>
        <div>
          <p className="font-black text-white text-base">שאלות אסטרטגיות — ניתוח חתם בכיר</p>
          <p className="text-xs text-slate-400">מיקוד זיהה {questions.length} נקודות קריטיות שדורשות בירור לפני הניתוח המלא</p>
        </div>
      </div>

      {/* אבחון ראשי של ה-AI */}
      {diagnosis?.one_liner && (
        <div className="mb-4 bg-red-950/40 border border-red-500/40 rounded-xl px-4 py-3 flex items-start gap-2">
          <span className="text-red-400 text-sm mt-0.5">⚠️</span>
          <div>
            <p className="text-xs font-black text-red-400 uppercase tracking-wide mb-0.5">אבחון חתם — בעיה מרכזית בתיק</p>
            <p className="text-sm text-white font-semibold">{diagnosis.one_liner}</p>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {questions.map((q, i) => (
          <div key={q.id} className="bg-slate-900/60 border border-slate-700 rounded-xl p-4">
            <div className="flex items-start gap-3 mb-3">
              <span className="text-xs font-black text-amber-400 mt-0.5 shrink-0">{i + 1}.</span>
              <div className="flex-1">
                <p className="text-white text-sm font-bold mb-1">{q.question_text}</p>
                <p className="text-xs text-slate-500">{q.context}</p>
              </div>
              {answers[q.id] !== undefined && answers[q.id] !== '' && (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              )}
            </div>

            {/* Input by type */}
            {q.type === 'boolean' && (
              <div className="flex gap-3 mr-6">
                {['כן', 'לא'].map(opt => (
                  <button
                    key={opt}
                    onClick={() => handleChange(q.id, opt === 'כן')}
                    className={`px-5 py-2 rounded-lg text-sm font-bold border transition-all ${
                      answers[q.id] === (opt === 'כן')
                        ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                        : 'border-slate-600 text-slate-400 hover:border-slate-400'
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            )}

            {q.type === 'select' && q.options && (
              <div className="flex flex-wrap gap-2 mr-6">
                {q.options.map(opt => (
                  <button
                    key={opt}
                    onClick={() => handleChange(q.id, opt)}
                    className={`px-4 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                      answers[q.id] === opt
                        ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                        : 'border-slate-600 text-slate-400 hover:border-slate-400'
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            )}

            {q.type === 'number' && (
              <div className="mr-6 flex items-center gap-2">
                <span className="text-slate-400 text-sm">₪</span>
                <input
                  type="text"
                  placeholder="הזן סכום..."
                  value={answers[q.id] !== undefined ? Number(String(answers[q.id]).replace(/,/g, '')).toLocaleString('he-IL') || '' : ''}
                  onChange={e => {
                    const raw = e.target.value.replace(/,/g, '').replace(/[^0-9]/g, '');
                    handleChange(q.id, raw ? parseInt(raw) : '');
                  }}
                  className="flex-1 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm font-bold focus:outline-none focus:border-amber-500"
                />
              </div>
            )}

            {q.type === 'text' && (
              <div className="mr-6">
                <input
                  type="text"
                  placeholder="הזן תשובה..."
                  value={answers[q.id] || ''}
                  onChange={e => handleChange(q.id, e.target.value)}
                  className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm font-bold focus:outline-none focus:border-amber-500"
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Progress indicator */}
      <div className="mt-4 mb-4 flex items-center gap-2">
        <div className="flex-1 bg-slate-700 rounded-full h-1.5">
          <div
            className="bg-amber-500 h-1.5 rounded-full transition-all duration-300"
            style={{ width: `${(Object.keys(answers).length / questions.length) * 100}%` }}
          />
        </div>
        <span className="text-xs text-slate-400 shrink-0">
          {Object.keys(answers).length}/{questions.length} ענו
        </span>
      </div>

      <div className="flex gap-3">
        <Button
          onClick={() => onSubmit(answers)}
          disabled={isLoading || !allAnswered}
          className="flex-1 h-12 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-white font-black text-sm rounded-xl disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isLoading ? (
            <><Loader2 className="w-4 h-4 ml-2 animate-spin" /> מנתח תיק...</>
          ) : (
            <><ChevronLeft className="w-4 h-4 ml-2" /> המשך לניתוח מלא →</>
          )}
        </Button>
        <Button
          onClick={() => onSubmit({})}
          disabled={isLoading}
          variant="outline"
          className="h-12 px-5 border-slate-600 text-slate-400 hover:text-white text-sm rounded-xl"
        >
          דלג
        </Button>
      </div>
    </div>
  );
}