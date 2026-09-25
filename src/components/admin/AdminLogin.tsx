import React, { useState, useEffect } from 'react';
import { 
  Sparkles, 
  Lock, 
  Mail, 
  User, 
  ShieldCheck, 
  AlertCircle, 
  CheckCircle2, 
  ArrowRight,
  Eye,
  EyeOff,
  Phone
} from 'lucide-react';
import { AdminSession, AdminUser } from '../../types/admin';

interface AdminLoginProps {
  onLoginSuccess: (session: AdminSession) => void;
  onBackToWebsite: () => void;
  onGoToStaffLogin?: () => void;
}

export const AdminLogin: React.FC<AdminLoginProps> = ({ 
  onLoginSuccess, 
  onBackToWebsite,
  onGoToStaffLogin
}) => {
  // Setup is ONLY true if server reports 0 admin accounts exist.
  // Defaults to false so "Admin Sign In" is ALWAYS shown first without flickering.
  const [isSetup, setIsSetup] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(true);

  // Login form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [loading, setLoading] = useState(false);

  // Setup form state (first-time SALON_ADMIN creation only)
  const [setupName, setSetupName] = useState('');
  const [setupEmail, setSetupEmail] = useState('');
  const [setupPhone, setSetupPhone] = useState('');
  const [setupPassword, setSetupPassword] = useState('');
  const [setupConfirmPassword, setSetupConfirmPassword] = useState('');
  const [setupError, setSetupError] = useState('');

  useEffect(() => {
    // Check real server/database status to permanently prevent unwanted "Create Admin Account" page
    const checkServerAuthStatus = async () => {
      try {
        const res = await fetch('/api/auth/status');
        if (res.ok) {
          const data = await res.json();
          // If server reports initialized === true, setup is permanently false
          setIsSetup(!data.initialized);
        } else {
          setIsSetup(false);
        }
      } catch {
        setIsSetup(false);
      } finally {
        setCheckingStatus(false);
      }
    };

    checkServerAuthStatus();
  }, []);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    if (!email.trim() || !password) {
      setLoginError('Please enter both your registered admin email and password.');
      return;
    }

    try {
      setLoading(true);
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Invalid admin credentials.');
      }

      if (data.user.role !== 'SALON_ADMIN' && data.user.role !== 'SUPER_ADMIN') {
        throw new Error('This account does not have Salon Admin privileges. Please use /staff/login.');
      }

      const session: AdminSession = {
        token: data.token,
        user: data.user,
        expiresAt: data.expiresAt || (Date.now() + 24 * 3600 * 1000),
      };

      localStorage.setItem('glossy_admin_session_v1', JSON.stringify(session));
      onLoginSuccess(session);
    } catch (err: any) {
      setLoginError(err.message || 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleSetupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSetupError('');

    if (!setupName.trim() || !setupEmail.trim() || !setupPassword) {
      setSetupError('All required fields must be completed.');
      return;
    }

    if (setupPassword.length < 6) {
      setSetupError('Password must be at least 6 characters long.');
      return;
    }

    if (setupPassword !== setupConfirmPassword) {
      setSetupError('Passwords do not match. Please re-enter.');
      return;
    }

    try {
      setLoading(true);
      const res = await fetch('/api/auth/setup-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: setupName.trim(),
          email: setupEmail.trim().toLowerCase(),
          phone: setupPhone.trim(),
          password: setupPassword,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Initial setup failed.');
      }

      const session: AdminSession = {
        token: data.token,
        user: data.user,
        expiresAt: data.expiresAt || (Date.now() + 24 * 3600 * 1000),
      };

      localStorage.setItem('glossy_admin_session_v1', JSON.stringify(session));
      setIsSetup(false);
      onLoginSuccess(session);
    } catch (err: any) {
      setSetupError(err.message || 'Initial setup could not be completed.');
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
          {isSetup ? 'Initial Security Setup' : 'Admin Portal Sign In'}
        </h2>
        <p className="mt-1 text-xs text-[#7A6B6B] max-w-sm mx-auto">
          {isSetup 
            ? 'Create the primary salon administrator account.' 
            : 'Authorized salon administration and management portal.'}
        </p>
      </div>

      {/* Main Card */}
      <div className="mt-6 sm:mx-auto sm:w-full sm:max-w-md relative z-10 px-4 sm:px-0">
        <div className="bg-white py-8 px-6 sm:px-10 shadow-xl rounded-3xl border border-[#EDE1DD]">
          
          {/* STANDARD ADMIN SIGN IN FORM (DEFAULT & ALWAYS SHOWN WHEN ADMIN EXISTS) */}
          {!isSetup && (
            <form onSubmit={handleLoginSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#4A3C3C] mb-1">
                  Admin Email Address
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-[#8C7A7A] absolute left-3.5 top-3" />
                  <input
                    type="email"
                    required
                    placeholder="admin@theglossylooks.com"
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
                    placeholder="Enter admin password"
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
                  <span>Authenticating...</span>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4" />
                    <span>Sign In to Admin Portal</span>
                  </>
                )}
              </button>

              {/* Demo Credentials Helper */}
              <div className="p-3 bg-stone-50 border border-stone-200 rounded-xl space-y-2 text-xs">
                <p className="font-semibold text-stone-700 flex items-center justify-between">
                  <span>Authorized System Credentials:</span>
                  <span className="text-[10px] text-stone-400 font-normal">Click to fill</span>
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEmail('superadmin@theglossylooks.com');
                      setPassword('GlossySuper@2026');
                    }}
                    className="p-2 rounded-lg bg-white border border-stone-200 hover:border-[#8C3A42] text-left transition-colors cursor-pointer"
                  >
                    <p className="font-bold text-[#8C3A42] text-[11px]">Platform Admin</p>
                    <p className="text-[10px] text-stone-600 truncate">superadmin@theglossylooks.com</p>
                    <p className="text-[9px] text-stone-400 font-mono">GlossySuper@2026</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEmail('admin@theglossylooks.com');
                      setPassword('GlossyAdmin@2026');
                    }}
                    className="p-2 rounded-lg bg-white border border-stone-200 hover:border-[#8C3A42] text-left transition-colors cursor-pointer"
                  >
                    <p className="font-bold text-[#8C3A42] text-[11px]">Salon Admin</p>
                    <p className="text-[10px] text-stone-600 truncate">admin@theglossylooks.com</p>
                    <p className="text-[9px] text-stone-400 font-mono">GlossyAdmin@2026</p>
                  </button>
                </div>
              </div>

              {/* Link to Staff Login */}
              <div className="pt-3 border-t border-[#F0E6E3] text-center space-y-2">
                <p className="text-xs text-[#7A6B6B]">
                  Are you a salon staff member?
                </p>
                <button
                  type="button"
                  onClick={() => {
                    if (onGoToStaffLogin) {
                      onGoToStaffLogin();
                    } else {
                      window.location.href = '/staff/login';
                    }
                  }}
                  className="text-xs font-semibold text-[#8C3A42] hover:underline cursor-pointer"
                >
                  Go to Staff Portal Login (/staff/login) ➔
                </button>
              </div>
            </form>
          )}

          {/* INITIAL ADMIN SETUP FORM (ONLY IF 0 ADMIN ACCOUNTS EXIST IN SERVER) */}
          {isSetup && (
            <form onSubmit={handleSetupSubmit} className="space-y-3.5">
              <div className="p-3 bg-[#FAF0F1] border border-[#E8C5C8] rounded-xl text-xs text-[#8C3A42]">
                <p className="font-semibold">Initial One-Time Setup</p>
                <p className="text-[11px] text-[#665454] mt-0.5">
                  Set up the primary administrator account for The Glossy Looks. This will be locked after creation.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#4A3C3C] mb-1">Full Name</label>
                <div className="relative">
                  <User className="w-4 h-4 text-[#8C7A7A] absolute left-3.5 top-3" />
                  <input
                    type="text"
                    required
                    placeholder="Salon Owner / Manager"
                    value={setupName}
                    onChange={(e) => setSetupName(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-[#FAF7F5] border border-[#DDD0CB] rounded-xl text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#4A3C3C] mb-1">Admin Email Address</label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-[#8C7A7A] absolute left-3.5 top-3" />
                  <input
                    type="email"
                    required
                    placeholder="admin@theglossylooks.com"
                    value={setupEmail}
                    onChange={(e) => setSetupEmail(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-[#FAF7F5] border border-[#DDD0CB] rounded-xl text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#4A3C3C] mb-1">Mobile Phone (Optional)</label>
                <div className="relative">
                  <Phone className="w-4 h-4 text-[#8C7A7A] absolute left-3.5 top-3" />
                  <input
                    type="tel"
                    placeholder="+91 98765 43210"
                    value={setupPhone}
                    onChange={(e) => setSetupPhone(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-[#FAF7F5] border border-[#DDD0CB] rounded-xl text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#4A3C3C] mb-1">Password</label>
                  <input
                    type="password"
                    required
                    placeholder="Min 6 characters"
                    value={setupPassword}
                    onChange={(e) => setSetupPassword(e.target.value)}
                    className="w-full px-3 py-2 bg-[#FAF7F5] border border-[#DDD0CB] rounded-xl text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#4A3C3C] mb-1">Confirm Password</label>
                  <input
                    type="password"
                    required
                    placeholder="Re-enter password"
                    value={setupConfirmPassword}
                    onChange={(e) => setSetupConfirmPassword(e.target.value)}
                    className="w-full px-3 py-2 bg-[#FAF7F5] border border-[#DDD0CB] rounded-xl text-sm"
                  />
                </div>
              </div>

              {setupError && (
                <div className="p-3 bg-[#FDF2F2] border border-[#F8B4B4] rounded-xl text-xs text-[#9B1C1C]">
                  {setupError}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 rounded-xl bg-[#8C3A42] hover:bg-[#742F36] text-white font-semibold text-sm shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {loading ? 'Configuring Account...' : 'Complete Initial Setup & Enter'}
              </button>
            </form>
          )}

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
