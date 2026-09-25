import React, { useState } from 'react';
import { 
  Sparkles, 
  Lock, 
  Mail, 
  ShieldCheck, 
  AlertCircle, 
  ArrowRight,
  Eye,
  EyeOff,
  UserCheck
} from 'lucide-react';
import { AdminSession } from '../types/admin';

interface StaffLoginProps {
  onLoginSuccess: (session: AdminSession) => void;
  onBackToWebsite: () => void;
  onGoToAdminLogin?: () => void;
}

export const StaffLogin: React.FC<StaffLoginProps> = ({
  onLoginSuccess,
  onBackToWebsite,
  onGoToAdminLogin,
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');

    if (!email.trim() || !password) {
      setLoginError('Please enter both your registered staff email and password.');
      return;
    }

    try {
      setLoading(true);
      const res = await fetch('/api/auth/staff-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Invalid staff credentials.');
      }

      const session: AdminSession = {
        token: data.token,
        user: data.user,
        expiresAt: data.expiresAt || (Date.now() + 24 * 3600 * 1000),
      };

      localStorage.setItem('glossy_staff_session_v1', JSON.stringify(session));
      onLoginSuccess(session);
    } catch (err: any) {
      setLoginError(err.message || 'Staff sign in failed. Please contact salon administrator.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FAF7F5] flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative overflow-hidden">
      {/* Decorative luxury background glow */}
      <div className="absolute top-0 right-0 -mr-32 -mt-32 w-80 h-80 rounded-full bg-[#E8C5C8]/30 blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-0 -ml-32 -mb-32 w-80 h-80 rounded-full bg-[#EBDAD3]/40 blur-3xl pointer-events-none" />

      {/* Header Branding */}
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center relative z-10">
        <div 
          onClick={onBackToWebsite}
          className="inline-flex items-center gap-3 cursor-pointer group mb-2"
        >
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#E8C5C8] to-[#D99B9F] flex items-center justify-center shadow-md border border-[#D9B8B9] group-hover:scale-105 transition-transform">
            <Sparkles className="w-6 h-6 text-[#2D2424]" />
          </div>
          <div className="text-left">
            <h1 className="font-serif-luxury text-2xl font-bold tracking-tight text-[#2D2424]">
              The Glossy Looks
            </h1>
            <p className="text-[11px] text-[#7A6B6B] tracking-wider uppercase font-semibold">
              Professional Women Salon
            </p>
          </div>
        </div>

        <h2 className="mt-4 font-serif-luxury text-2xl sm:text-3xl font-bold text-[#2D2424]">
          Staff Operations Portal
        </h2>
        <p className="mt-1 text-xs text-[#7A6B6B] max-w-sm mx-auto">
          Sign in to access Today's Appointments, Walk-in POS Billing, and Thermal Invoicing.
        </p>
      </div>

      {/* Main Card */}
      <div className="mt-6 sm:mx-auto sm:w-full sm:max-w-md relative z-10 px-4 sm:px-0">
        <div className="bg-white py-8 px-6 sm:px-10 shadow-xl rounded-3xl border border-[#EDE1DD]">
          <form onSubmit={handleLoginSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-[#4A3C3C] mb-1">
                Staff Email Address / Login ID
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-[#8C7A7A] absolute left-3.5 top-3" />
                <input
                  type="email"
                  required
                  placeholder="priya.staff@theglossylooks.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-[#FAF7F5] border border-[#DDD0CB] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#8C3A42]/30"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#4A3C3C] mb-1">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-[#8C7A7A] absolute left-3.5 top-3" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  placeholder="Enter your staff password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-10 py-2.5 bg-[#FAF7F5] border border-[#DDD0CB] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#8C3A42]/30"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-3 text-[#8C7A7A] hover:text-[#2D2424]"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {loginError && (
              <div className="p-3 bg-[#FDF2F2] border border-[#F8B4B4] rounded-xl text-xs text-[#9B1C1C] flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{loginError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 rounded-xl bg-[#8C3A42] hover:bg-[#742F36] text-white font-semibold text-sm shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {loading ? (
                <span>Verifying credentials...</span>
              ) : (
                <>
                  <UserCheck className="w-4 h-4" />
                  <span>Sign In as Salon Staff</span>
                </>
              )}
            </button>

            {/* Demo Staff Credentials Helper */}
            <div className="p-3 bg-stone-50 border border-stone-200 rounded-xl space-y-1.5 text-xs">
              <p className="font-semibold text-stone-700 flex items-center justify-between">
                <span>Authorized Staff Account:</span>
                <span className="text-[10px] text-stone-400 font-normal">Click to fill</span>
              </p>
              <button
                type="button"
                onClick={() => {
                  setEmail('staff@theglossylooks.com');
                  setPassword('GlossyStaff@2026');
                }}
                className="w-full p-2 rounded-lg bg-white border border-stone-200 hover:border-[#8C3A42] text-left transition-colors cursor-pointer"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[#8C3A42] text-[11px]">Pooja Stylist (Staff)</span>
                  <span className="text-[9px] text-stone-400 font-mono">GlossyStaff@2026</span>
                </div>
                <p className="text-[10px] text-stone-600">staff@theglossylooks.com</p>
              </button>
            </div>

            {/* Notice for new staff */}
            <div className="p-3 bg-[#FAF7F5] border border-[#E8DDD8] rounded-xl text-[11px] text-[#7A6B6B] leading-relaxed">
              <span className="font-semibold text-[#2D2424] block mb-0.5">Need a Staff Login?</span>
              Staff accounts are created by the Salon Administrator in <span className="font-medium text-[#8C3A42]">Admin ➔ Staff Management</span>.
            </div>

            {/* Link to Admin Login */}
            <div className="pt-3 border-t border-[#F0E6E3] text-center">
              <button
                type="button"
                onClick={() => {
                  if (onGoToAdminLogin) {
                    onGoToAdminLogin();
                  } else {
                    window.location.href = '/admin/login';
                  }
                }}
                className="text-xs font-semibold text-[#8C3A42] hover:underline cursor-pointer"
              >
                Go to Administrator Login (/admin/login) ➔
              </button>
            </div>
          </form>

          {/* Back to Home Button */}
          <div className="mt-4 pt-4 border-t border-[#F0E6E3] text-center">
            <button
              type="button"
              onClick={onBackToWebsite}
              className="text-xs text-[#7A6B6B] hover:text-[#2D2424] font-medium"
            >
              ← Return to The Glossy Looks Salon Website
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
