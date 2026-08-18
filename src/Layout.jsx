import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from './utils';
import {
  Home, Calculator, FileText, Users, TrendingUp, Shield,
  Menu, X, ChevronLeft, Phone, Mail, Building2, Globe, Target
} from 'lucide-react';
import MortgageChatbot from './components/mortgage/MortgageChatbot';
import { Toaster } from 'sonner';

// Nav has 3 tabs now (was 2) -- מרכז חיתום מוסדי added 2026-08-19, no
// auth/role check needed to decide visibility since none of these pages
// require a login, by explicit decision.
const navItems = [
  { name: 'QuickDocCheck', label: '⚡ בדיקה מהירה', icon: FileText, highlight: true },
  { name: 'RefinanceQuickCheck', label: 'בדיקת מחזור מהירה', icon: TrendingUp },
  { name: 'UnderwriterDashboard', label: 'מרכז חיתום מוסדי', icon: Shield },
];

export default function Layout({ children, currentPageName }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const filteredNavItems = navItems;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50/30" dir="rtl">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');
        @import url('https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;500;600;700;800;900&display=swap');
        * { 
          font-family: 'Inter', 'Heebo', sans-serif;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
        }
        :root {
          --primary: #0f172a;
          --primary-light: #1e293b;
          --accent: #0ea5e9;
          --gold: #f59e0b;
          --luxury-dark: #0f172a;
          --luxury-gold: #f59e0b;
        }
        @keyframes gradient {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        .animate-gradient {
          animation: gradient 8s ease infinite;
        }
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-20px); }
        }
        .animate-float {
          animation: float 6s ease-in-out infinite;
        }
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        .animate-shimmer {
          animation: shimmer 3s infinite;
        }
      `}</style>
      
      {/* Header */}
      <header className="fixed top-0 right-0 left-0 z-50 bg-white/90 backdrop-blur-md border-b border-slate-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between py-4 gap-4 w-full">
            {/* Desktop Navigation */}
            <nav className="hidden md:flex flex-1 flex-wrap items-center justify-center gap-2 px-2">
              {filteredNavItems.map((item) => {
                const Icon = item.icon;
                const isActive = currentPageName === item.name;
                return (
                  <Link
                    key={item.name}
                    to={createPageUrl(item.name)}
                    className={`group relative flex items-center gap-2 px-3 py-2 rounded-lg transition-all duration-300 ${
                      isActive 
                        ? 'bg-gradient-to-r from-slate-900 to-slate-800 text-white shadow-xl shadow-slate-900/30' 
                        : item.highlight ? 'text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 border border-emerald-200/60' : 'text-slate-700 hover:bg-slate-50 hover:text-slate-900'
                    }`}
                  >
                    {isActive && (
                      <div className="absolute inset-0 bg-gradient-to-r from-amber-500/10 to-transparent rounded-lg" />
                    )}
                    <Icon className={`w-4 h-4 relative z-10 ${isActive ? 'text-amber-400' : 'group-hover:text-slate-900'}`} />
                    <span className="font-bold text-xs relative z-10 tracking-tight">{item.label}</span>
                  </Link>
                );
              })}
            </nav>

            {/* Contact Info */}
            <div className="hidden lg:flex items-center gap-4 shrink-0">
              <a href="tel:*2324" className="flex items-center gap-1.5 text-slate-600 hover:text-amber-600 transition-colors group">
                <Phone className="w-3.5 h-3.5 group-hover:animate-pulse" />
                <span className="text-xs font-bold">*2324</span>
              </a>
              <Link
                to={createPageUrl('QuickDocCheck')}
                className="relative px-4 py-2 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white rounded-lg font-bold text-xs shadow-xl shadow-slate-900/40 hover:shadow-slate-900/60 transition-all duration-300 hover:-translate-y-0.5 overflow-hidden group"
              >
                <div className="absolute inset-0 bg-gradient-to-r from-amber-500/0 via-amber-500/20 to-amber-500/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
                <span className="relative">התחל עכשיו</span>
              </Link>
            </div>

            {/* Mobile Menu Button */}
            <button 
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 rounded-xl bg-slate-100"
            >
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden bg-white border-t border-slate-200 py-4 px-4 shadow-lg">
            {filteredNavItems.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.name}
                  to={createPageUrl(item.name)}
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl text-slate-700 hover:bg-slate-50 hover:text-amber-600 transition-all"
                >
                  <Icon className="w-5 h-5" />
                  <span className="font-bold">{item.label}</span>
                </Link>
              );
            })}
          </div>
        )}
      </header>

      {/* Main Content */}
      <main className="pt-24">
        {children}
      </main>

      {/* AI Chatbot */}
      <MortgageChatbot />

      {/* Toast Notifications */}
      <Toaster position="top-center" richColors />

      {/* Footer */}
      <footer className="bg-gradient-to-b from-slate-950 to-black text-white py-20 mt-20 border-t border-gold/20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-12">
            <div className="md:col-span-2">
              <div className="mb-6">
                <div className="relative inline-block mb-4">
                  <div className="absolute inset-0 bg-gradient-to-r from-red-500/30 to-blue-500/30 rounded-2xl blur-xl"></div>
                  <img 
                    src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/6969f8ed362d4cf13c0e3732/a8c69ce04_1.png"
                    alt="מיקוד משכנתאות"
                    className="relative h-48 w-auto object-contain drop-shadow-xl"
                  />
                </div>
              </div>
              <p className="text-slate-400 leading-relaxed max-w-md">
                מיקוד משכנתאות מספקת ייעוץ משכנתאות מקצועי ואישי. אנו מלווים אתכם לאורך כל הדרך - 
                מהייעוץ הראשוני ועד לחתימה על המשכנתא הטובה ביותר עבורכם.
              </p>
            </div>
            
            <div>
              <h4 className="font-bold text-lg mb-4">קישורים מהירים</h4>
              <ul className="space-y-3">
                {navItems.slice(0, 3).map(item => (
                  <li key={item.name}>
                    <Link 
                      to={createPageUrl(item.name)}
                      className="text-slate-400 hover:text-white transition-colors"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            
            <div>
              <h4 className="font-bold text-lg mb-4">צור קשר</h4>
              <ul className="space-y-3 text-slate-400">
                <li className="flex items-center gap-2">
                  <Phone className="w-4 h-4" />
                  <a href="tel:*2324" className="hover:text-red-400 transition-colors">*2324</a>
                </li>
                <li className="flex items-center gap-2">
                  <Mail className="w-4 h-4" />
                  <span>Office@mikud4me.co.il</span>
                </li>
              </ul>
            </div>
          </div>
          
          <div className="border-t border-slate-800 mt-12 pt-8 text-center text-slate-500 text-sm">
            © {new Date().getFullYear()} מיקוד משכנתאות. כל הזכויות שמורות.
          </div>
        </div>
      </footer>
    </div>
  );
}