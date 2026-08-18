import React from 'react';
import { motion } from 'framer-motion';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { Link } from 'react-router-dom';

/**
 * BackgroundProcessingScreen — מסך המתנה אסינכרוני.
 * מוצג אחרי שתיק נכנס לתור עיבוד ברקע. המשתמש חופשי לנווט — הדוח יקפוץ אוטומטית כשמוכן.
 */
export default function BackgroundProcessingScreen({ onCancel }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] gap-8" dir="rtl">
      <div className="relative">
        <div className="absolute inset-[-50px] bg-[#C5A059]/8 rounded-full blur-3xl animate-pulse" />
        <motion.div
          className="absolute inset-[-24px] rounded-full border border-[#C5A059]/20"
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 6, ease: 'linear' }}
        >
          <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-[#C5A059]/60 shadow-[0_0_12px_#C5A059]" />
        </motion.div>
        <div className="relative w-20 h-20 rounded-2xl border border-[#C5A059]/50 bg-[#0d1524] flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-[#C5A059] animate-spin" />
        </div>
      </div>

      <div className="text-center max-w-md">
        <div className="inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 rounded-full px-4 py-1.5 mb-4">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-emerald-400 text-xs font-bold tracking-widest">הקובץ התקבל</span>
        </div>
        <h2 className="text-white text-xl font-bold mb-2">החיתום מתבצע ברקע</h2>
        <p className="text-[#8892B0] text-sm leading-relaxed">
          המסמכים בעיבוד עמוק (חילוץ נתונים · אימות זהות · רדאר חובות צל).<br/>
          <span className="text-[#C5A059]">תוכל להמשיך לעבוד — הדוח יופיע כאן אוטומטית כשיהיה מוכן,</span> ותקבל התראה.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Link
          to="/UnderwriterPortal"
          className="px-5 py-2.5 border border-[#1e2d4a] hover:border-[#C5A059]/40 text-[#8892B0] hover:text-[#C5A059] text-sm rounded-xl transition-all"
        >
          המשך ללובי החיתום
        </Link>
        <button
          onClick={onCancel}
          className="px-5 py-2.5 text-[#4a5568] hover:text-[#8892B0] text-sm transition-colors"
        >
          העלה תיק נוסף
        </button>
      </div>

      <p className="text-[#4a5568] text-xs">רשת ביטחון פעילה — גם אם הדפדפן ייסגר, התיק יושלם אוטומטית.</p>
    </div>
  );
}