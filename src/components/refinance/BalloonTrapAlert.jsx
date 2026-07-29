import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { AlertTriangle, Clock, Bomb } from 'lucide-react';

export default function BalloonTrapAlert({ externalDebts }) {
  if (!externalDebts || externalDebts.length === 0) return null;

  // Detect balloon/grace loans: monthly payment < 1% of balance = interest only
  const balloonLoans = externalDebts.filter(debt => {
    if (!debt.monthly_repayment || !debt.remaining_balance) return false;
    const paymentRatio = debt.monthly_repayment / debt.remaining_balance;
    return paymentRatio < 0.01; // Less than 1% = likely interest-only
  });

  if (balloonLoans.length === 0) return null;

  const totalBalloonDebt = balloonLoans.reduce((s, d) => s + (d.remaining_balance || 0), 0);

  return (
    <Card className="border-2 border-orange-400 bg-gradient-to-br from-orange-50 to-red-50">
      <CardContent className="p-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-orange-500 rounded-xl flex items-center justify-center flex-shrink-0">
            <Bomb className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1">
            <h3 className="font-black text-orange-900 text-lg mb-1">
              ⚠️ פצצת זמן תזרימית זוהתה!
            </h3>
            <p className="text-orange-800 text-sm mb-3">
              זוהו <strong>{balloonLoans.length} הלוואות חשודות כגרייס/בלון</strong> – תשלומי ריבית בלבד.
              סכום הקרן שייפרע בבת אחת: <strong>₪{totalBalloonDebt.toLocaleString()}</strong>
            </p>
            
            <div className="space-y-2 mb-4">
              {balloonLoans.map((loan, i) => (
                <div key={i} className="bg-white border border-orange-200 rounded-lg p-3 flex justify-between items-center text-sm">
                  <div>
                    <p className="font-semibold text-slate-800">{loan.creditor || 'הלוואה ' + (i+1)}</p>
                    <p className="text-xs text-orange-700">
                      החזר חודשי: ₪{loan.monthly_repayment?.toLocaleString()} | 
                      יחס לקרן: {((loan.monthly_repayment / loan.remaining_balance) * 100).toFixed(2)}% 
                      <span className="text-red-600 font-bold"> ← ריבית בלבד!</span>
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-red-700">₪{loan.remaining_balance?.toLocaleString()}</p>
                    <p className="text-xs text-slate-500">קרן לפירעון</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="bg-orange-100 border border-orange-300 rounded-xl p-3 flex items-start gap-2">
              <Clock className="w-4 h-4 text-orange-700 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-orange-900 font-semibold">
                המלצה: אחד הלוואות אלו לתוך המשכנתא החדשה עכשיו – לפני שתצטרך לשלם ₪{totalBalloonDebt.toLocaleString()} בבת אחת. 
                המשכנתא לכל מטרה תפרוס את החוב הזה על 20+ שנה ותחסוך לך לחץ תזרימי חמור.
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}