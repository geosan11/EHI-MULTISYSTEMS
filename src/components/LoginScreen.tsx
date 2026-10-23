import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { UserProfile, signIn } from '../lib/auth';
import skyBg from '../assets/login-sky-bg.jpg';
import ehiLogo from '../assets/branding/ehi-logo.png';
import { getConnectionMode, testSupabaseConnection, supabase } from '../lib/supabase';
import { Mail, Lock, Eye, EyeOff, Loader2, AlertCircle, Sun, Moon, PackageSearch, ShieldCheck } from 'lucide-react';

type ConnStatus = 'checking' | 'live' | 'offline' | 'unconfigured';

export const LoginScreen = ({ onLogin, notice }: { onLogin: (user: UserProfile) => void; notice?: { type: 'expired' | 'offline'; message: string } | null }) => {
  const [email, setEmail]             = useState('');
  const [password, setPassword]       = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError]             = useState('');
  const [isLoading, setIsLoading]     = useState(false);
  const [connStatus, setConnStatus]   = useState<ConnStatus>('checking');
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [isClosingReset, setIsClosingReset] = useState(false);
  const [resetEmail, setResetEmail]   = useState('');
  const [resetSent, setResetSent]     = useState(false);
  const [resetSending, setResetSending] = useState(false);
  const [resetError, setResetError]   = useState('');
  const [isDark, setIsDark]           = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('ehi-theme') || localStorage.getItem('ehi_theme');
      if (saved === 'dark' || saved === 'light') return saved === 'dark';
      return document.documentElement.classList.contains('dark');
    } catch {
      return false;
    }
  });

  const toggleLoginTheme = () => {
    const next = !isDark;
    setIsDark(next);
    try {
      localStorage.setItem('ehi-theme', next ? 'dark' : 'light');
      document.documentElement.classList.toggle('dark', next);
      document.documentElement.classList.toggle('light', !next);
    } catch {}
  };

  const closeForgotPasswordModal = () => {
    if (isClosingReset) return;
    setIsClosingReset(true);
    setTimeout(() => {
      setShowForgotPassword(false);
      setIsClosingReset(false);
    }, 200);
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetEmail.trim()) {
      setResetError('Enter your email address.');
      return;
    }
    setResetSending(true);
    setResetError('');
    try {
      const resetOrigin = import.meta.env.DEV ? window.location.origin : 'https://app.ehimultisystems.com';
      const { error } = await supabase.auth.resetPasswordForEmail(resetEmail.trim().toLowerCase(), {
        redirectTo: `${resetOrigin}/`,
      });
      if (error) {
        setResetError(error.message || 'Could not send reset email. Try again.');
      } else {
        setResetSent(true);
      }
    } catch {
      setResetError('Network error. Check your connection and try again.');
    } finally {
      setResetSending(false);
    }
  };

  useEffect(() => {
    if (getConnectionMode() === 'unconfigured') {
      setConnStatus('unconfigured');
      return;
    }
    testSupabaseConnection().then(result => {
      setConnStatus(result.ok ? 'live' : 'offline');
    }).catch(() => setConnStatus('offline'));

    // Preload EHIApp in the background after the login screen paints so
    // clicking "Get Started" transitions immediately without waiting for bundle download.
    const preloadTimer = setTimeout(() => {
      import('./EHIApp').catch(() => {});
    }, 300);
    return () => clearTimeout(preloadTimer);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError('Email and password are required.');
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      const user = await signIn(email.trim().toLowerCase(), password);
      onLogin(user);
    } catch (err: any) {
      const msg: string = err.message || '';
      if (msg.toLowerCase().includes('fetch') || msg.toLowerCase().includes('network') || msg.toLowerCase().includes('connect')) {
        setError('Cannot reach the server. Check your internet connection and try again.');
        setConnStatus('offline');
      } else if (msg.toLowerCase().includes('deactivated')) {
        setError('Your account has been deactivated. Contact your administrator.');
      } else if (msg.toLowerCase().includes('profile not set up')) {
        setError('Account exists but profile is not configured. Contact IT.');
      } else {
        setError('Incorrect email or password. Try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const statusConfig: Record<ConnStatus, { label: string; color: string; dot: string; pulse: boolean }> = {
    checking:     { label: 'Connecting…',        color: '#64748b', dot: '#94a3b8', pulse: true  },
    live:         { label: 'Network Live',       color: '#059669', dot: '#10b981', pulse: true  },
    offline:      { label: 'Offline Mode Cache', color: '#dc2626', dot: '#ef4444', pulse: false },
    unconfigured: { label: 'Not Configured',     color: '#d97706', dot: '#f59e0b', pulse: false },
  };
  const status = statusConfig[connStatus];

  return (
    <div
      className={`relative min-h-[100dvh] w-full flex flex-col items-center justify-between p-4 sm:p-6 overflow-y-auto overflow-x-hidden select-none antialiased font-sans transition-colors duration-300 ${
        isDark ? 'bg-[#0f1117] text-slate-100' : 'bg-[#90c5f9] text-slate-900'
      }`}
    >
      {/* Daylight sky backdrop (dimmed automatically in Night-Shift Dark Mode to prevent glare) */}
      <div
        aria-hidden="true"
        className={`fixed inset-0 pointer-events-none bg-cover bg-center bg-no-repeat transition-opacity duration-500 ${
          isDark ? 'opacity-10' : 'opacity-100'
        }`}
        style={{ backgroundImage: `url(${skyBg})` }}
      />

      {/* Atmospheric light bloom / night-shift radial vignette */}
      <div
        aria-hidden="true"
        className="fixed inset-0 pointer-events-none"
        style={{
          background: isDark
            ? 'radial-gradient(circle at 50% 35%, rgba(251,191,36,0.07) 0%, rgba(15,17,23,0.92) 70%)'
            : 'radial-gradient(circle at 50% 35%, rgba(255,255,255,0.45) 0%, rgba(255,255,255,0) 65%)',
        }}
      />

      {/* Subtle concentric radar guide arcs */}
      <div
        aria-hidden="true"
        className="fixed inset-0 pointer-events-none flex items-center justify-center overflow-hidden"
      >
        <div className={`w-[640px] h-[640px] rounded-full border ${isDark ? 'border-white/5' : 'border-white/50 shadow-[0_0_90px_rgba(255,255,255,0.45)]'}`} />
        <div className={`absolute w-[960px] h-[960px] rounded-full border ${isDark ? 'border-white/[0.03]' : 'border-white/30'}`} />
        <div className={`absolute w-[1280px] h-[1280px] rounded-full border ${isDark ? 'border-white/[0.02]' : 'border-white/20'}`} />
      </div>

      {/* Top Bar: Flows naturally in document order so it never overlaps the login card on short screens */}
      <div className="relative z-20 w-full max-w-6xl mx-auto flex items-center justify-between gap-3 pb-4 sm:pb-6 shrink-0">
        {/* Top Left Brand Emblem */}
        <header className="flex items-center gap-2.5">
          <img
            src={ehiLogo}
            alt="EHI Multisystems"
            className="h-9 w-auto object-contain shrink-0"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
          <div>
            <div className={`text-sm sm:text-base font-bold tracking-tight font-sans leading-tight ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
              EHI Multisystems
            </div>
            <div className={`text-[10px] font-mono uppercase tracking-wider ${isDark ? 'text-amber-400/90' : 'text-slate-600'}`}>
              Aviation &amp; Cargo Ops
            </div>
          </div>
        </header>

        {/* Top Right Telemetry + Day/Night Shift Toggle */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={toggleLoginTheme}
            title={isDark ? 'Switch to Daylight Mode' : 'Switch to Night-Shift Dark Mode'}
            aria-label="Toggle day or night shift display mode"
            className={`h-8 w-8 rounded-full flex items-center justify-center border backdrop-blur-md transition-colors cursor-pointer ${
              isDark
                ? 'bg-slate-800/80 border-slate-700 text-amber-400 hover:bg-slate-700'
                : 'bg-white/75 border-white/80 text-slate-700 hover:bg-white shadow-sm'
            }`}
          >
            {isDark ? <Sun size={14} /> : <Moon size={14} />}
          </button>

          <aside
            aria-label="System status"
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full backdrop-blur-md border text-xs ${
              isDark
                ? 'bg-slate-900/80 border-slate-700/80 text-slate-200'
                : 'bg-white/75 border-white/80 shadow-[0_2px_10px_rgba(0,0,0,0.04)] text-slate-700'
            }`}
          >
            <span className="relative flex h-2 w-2">
              {status.pulse && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: status.dot }} />
              )}
              <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: status.dot }} />
            </span>
            <span className="font-semibold tracking-wide font-mono text-[11px]">{status.label}</span>
          </aside>
        </div>
      </div>

      {/* Main Operations Terminal Login Card */}
      <main
        className={`relative z-10 my-auto w-full max-w-[420px] rounded-[28px] p-7 sm:p-9 border backdrop-blur-md transition-all ${
          isDark
            ? 'bg-[#1a1f2e]/90 border-white/10 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.7)]'
            : 'bg-white/88 border-white/90 shadow-[0_25px_60px_-15px_rgba(20,50,90,0.12),0_0_0_1px_rgba(255,255,255,0.8)_inset]'
        }`}
      >
        {/* Top operational badge */}
        <div
          className={`mx-auto mb-4 w-12 h-12 rounded-2xl border flex items-center justify-center ${
            isDark
              ? 'bg-amber-400/10 border-amber-400/25 text-amber-400'
              : 'bg-white/95 border-slate-200/80 shadow-[0_4px_16px_rgba(15,23,42,0.06)] text-slate-800'
          }`}
        >
          <ShieldCheck size={22} />
        </div>

        {/* Heading & Subtitle */}
        <div className="text-center mb-6">
          <div className={`text-[10px] font-mono uppercase tracking-[0.14em] font-bold mb-1 ${isDark ? 'text-amber-400' : 'text-amber-700'}`}>
            ▸ STATION TERMINAL ACCESS
          </div>
          <h1 className={`text-[22px] sm:text-2xl font-bold tracking-tight mb-1.5 ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
            Operator Sign In
          </h1>
          <p className={`text-xs sm:text-[13px] leading-relaxed max-w-[310px] mx-auto ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            Enter your station credentials to access flight manifests, cargo ledgers, and dispatch operations.
          </p>
        </div>

        {notice && (
          <div
            className={`w-full flex items-center gap-2.5 backdrop-blur-md rounded-xl px-3.5 py-2.5 mb-4 animate-in fade-in border text-xs ${
              isDark
                ? 'bg-amber-500/15 border-amber-400/30 text-amber-200'
                : 'bg-amber-500/10 border-amber-500/25 text-amber-900'
            }`}
          >
            <AlertCircle size={15} className="shrink-0 text-amber-500" />
            <p className="leading-snug font-medium">{notice.message}</p>
          </div>
        )}

        {/* Authentication Form */}
        <form onSubmit={handleSubmit} className="space-y-3.5">
          {/* Email input field */}
          <div
            className={`relative rounded-xl border transition-all ${
              isDark
                ? 'bg-[#141720] border-white/10 focus-within:border-amber-400/60 focus-within:ring-2 focus-within:ring-amber-400/15'
                : 'bg-[#eef3f8]/80 hover:bg-[#eaf0f6] focus-within:bg-white focus-within:ring-2 focus-within:ring-slate-900/15 border-slate-200/60'
            }`}
          >
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
              <Mail size={17} />
            </div>
            <input
              id="login-email"
              name="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Operator Email"
              autoComplete="email"
              required
              className={`w-full bg-transparent text-sm py-3 pl-10 pr-4 outline-none font-sans ${
                isDark ? 'text-slate-100 placeholder-slate-500' : 'text-slate-800 placeholder-slate-400'
              }`}
            />
          </div>

          {/* Password input field */}
          <div
            className={`relative rounded-xl border transition-all ${
              isDark
                ? 'bg-[#141720] border-white/10 focus-within:border-amber-400/60 focus-within:ring-2 focus-within:ring-amber-400/15'
                : 'bg-[#eef3f8]/80 hover:bg-[#eaf0f6] focus-within:bg-white focus-within:ring-2 focus-within:ring-slate-900/15 border-slate-200/60'
            }`}
          >
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
              <Lock size={17} />
            </div>
            <input
              id="login-password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              autoComplete="current-password"
              required
              className={`w-full bg-transparent text-sm py-3 pl-10 pr-10 outline-none font-sans ${
                isDark ? 'text-slate-100 placeholder-slate-500' : 'text-slate-800 placeholder-slate-400'
              }`}
            />
            <button
              type="button"
              aria-label="Toggle password visibility"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600 focus:outline-none transition-colors cursor-pointer"
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          {/* Forgot Password link */}
          <div className="flex justify-end pt-0.5">
            <button
              type="button"
              onClick={() => { setShowForgotPassword(true); setResetEmail(email); setResetSent(false); setResetError(''); }}
              className={`text-xs transition-colors font-medium cursor-pointer ${
                isDark ? 'text-slate-400 hover:text-amber-400' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Forgot password?
            </button>
          </div>

          {error && (
            <div className={`flex items-center gap-2 border rounded-xl px-3.5 py-2.5 text-xs animate-in fade-in ${
              isDark ? 'bg-red-500/15 border-red-500/30 text-red-300' : 'bg-red-500/10 border-red-500/20 text-red-700'
            }`}>
              <AlertCircle size={15} className="text-red-500 shrink-0" />
              <p className="leading-snug font-medium">{error}</p>
            </div>
          )}

          {connStatus === 'unconfigured' && (
            <div className="bg-amber-500/10 border border-amber-400/25 rounded-xl px-3.5 py-2.5 text-xs text-amber-800">
              VITE_SUPABASE_URL not configured. Add it to environment variables.
            </div>
          )}

          {/* Primary Action Button */}
          <div className="pt-1.5">
            <button
              type="submit"
              disabled={isLoading || connStatus === 'unconfigured'}
              className={`w-full py-3.5 px-6 rounded-xl font-bold text-sm tracking-wide active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 ${
                isDark
                  ? 'bg-[#fbbf24] hover:bg-[#f59e0b] text-slate-950 shadow-[0_4px_16px_rgba(251,191,36,0.25)]'
                  : 'bg-[#1e2029] hover:bg-[#12131a] active:bg-black text-white shadow-[0_4px_14px_rgba(30,32,41,0.22)]'
              }`}
            >
              {isLoading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  <span>Authenticating…</span>
                </>
              ) : (
                <span>Sign In to Terminal</span>
              )}
            </button>
          </div>
        </form>

        {/* Customer Self-Service Waybill Lookup + Security Footer */}
        <div className={`mt-6 pt-4 border-t flex flex-col items-center gap-2.5 text-center ${isDark ? 'border-white/10' : 'border-slate-200/70'}`}>
          <Link
            to="/track"
            className={`inline-flex items-center gap-1.5 text-xs font-semibold transition-colors ${
              isDark ? 'text-amber-400 hover:text-amber-300' : 'text-slate-700 hover:text-slate-950'
            }`}
          >
            <PackageSearch size={14} />
            <span>Track a Shipment or Waybill →</span>
          </Link>
          <p className={`text-[10px] font-mono tracking-wide uppercase ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
            Authorized Personnel Only · All Logins Audited
          </p>
        </div>
      </main>

      {/* Bottom spacer for balanced vertical centering on tall viewports */}
      <div aria-hidden="true" className="h-4 shrink-0" />

      {/* Forgot Password Modal (matches the clean frosted theme) */}
      {showForgotPassword && createPortal(
        <div
          className={`fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-md p-4 ${
            isClosingReset ? 'animate-modal-backdrop-out' : 'animate-modal-backdrop-in'
          }`}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeForgotPasswordModal();
          }}
        >
          <div
            className={`rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl h-auto max-h-[85vh] border border-white/90 bg-white/90 backdrop-blur-2xl ${
              isClosingReset ? 'animate-modal-slide-out' : 'animate-modal-slide-in'
            }`}
          >
            <div className="p-6 border-b border-slate-100">
              <h2 className="text-[17px] font-bold text-slate-900">Reset Operator Password</h2>
              <p className="text-[12px] mt-1 text-slate-500">We will email a secure link to reset your account credentials.</p>
            </div>
            <div className="p-6">
              {resetSent ? (
                <div className="text-center py-4 space-y-3">
                  <div className="text-[15px] font-bold text-emerald-600">Reset Link Dispatched ✓</div>
                  <p className="text-[12px] leading-relaxed text-slate-600">
                    Check <span className="font-semibold text-slate-900">{resetEmail}</span> for your reset link.
                  </p>
                  <button
                    onClick={closeForgotPasswordModal}
                    className="w-full h-11 text-white text-[13px] font-medium rounded-xl mt-3 transition-opacity bg-[#1e2029] hover:bg-[#12131a] cursor-pointer"
                  >
                    Return to Login
                  </button>
                </div>
              ) : (
                <form onSubmit={handleForgotPassword} className="space-y-4">
                  <div>
                    <label htmlFor="reset-email" className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Operator Email Address
                    </label>
                    <input
                      id="reset-email"
                      name="email"
                      type="email"
                      value={resetEmail}
                      onChange={(e) => setResetEmail(e.target.value)}
                      placeholder="you@ehimultisystems.com"
                      autoComplete="email"
                      autoFocus
                      className="w-full h-11 px-4 text-sm rounded-xl focus:outline-none transition-all bg-[#eef3f8]/80 text-slate-900 border border-slate-200/50 focus:border-slate-900/40 focus:ring-2 focus:ring-slate-900/15"
                    />
                  </div>
                  {resetError && (
                    <p className="text-[12px] text-red-500 font-medium">{resetError}</p>
                  )}
                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={closeForgotPasswordModal}
                      className="flex-1 h-11 text-[13px] font-medium rounded-xl transition-colors cursor-pointer border border-slate-200 text-slate-600 hover:bg-slate-100"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={resetSending}
                      className="flex-1 h-11 text-white text-[13px] font-medium rounded-xl disabled:opacity-60 transition-opacity bg-[#1e2029] hover:bg-[#12131a] cursor-pointer"
                    >
                      {resetSending ? 'Sending…' : 'Send Reset Link'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
