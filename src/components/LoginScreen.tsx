import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { UserProfile, signIn } from '../lib/auth';
import skyBg from '../assets/login-sky-bg.jpg';
import ehiLogo from '../assets/branding/ehi-logo.png';
import { getConnectionMode, testSupabaseConnection, supabase } from '../lib/supabase';
import { Mail, Lock, Eye, EyeOff, Loader2, AlertCircle, PackageSearch } from 'lucide-react';

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
      className="relative min-h-[100dvh] w-full flex flex-col items-center justify-between p-4 sm:p-6 overflow-y-auto overflow-x-hidden select-none bg-[#90c5f9] text-slate-900 antialiased"
      style={{ fontFamily: 'var(--font-display, "Plus Jakarta Sans", "Inter", sans-serif)' }}
    >
      {/* Photorealistic serene daylight cloudy sky backdrop */}
      <div
        aria-hidden="true"
        className="fixed inset-0 pointer-events-none bg-cover bg-center bg-no-repeat transition-opacity duration-700"
        style={{ backgroundImage: `url(${skyBg})` }}
      />

      {/* Subtle atmospheric light bloom */}
      <div
        aria-hidden="true"
        className="fixed inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(circle at 50% 35%, rgba(255,255,255,0.45) 0%, rgba(255,255,255,0) 65%)',
        }}
      />

      {/* Subtle ethereal concentric orbital guide arcs */}
      <div
        aria-hidden="true"
        className="fixed inset-0 pointer-events-none flex items-center justify-center overflow-hidden"
      >
        <div className="w-[640px] h-[640px] rounded-full border border-white/50 shadow-[0_0_90px_rgba(255,255,255,0.45)]" />
        <div className="absolute w-[960px] h-[960px] rounded-full border border-white/30" />
        <div className="absolute w-[1280px] h-[1280px] rounded-full border border-white/20" />
      </div>

      {/* Top Bar: Flows naturally in document order so it never overlaps the login card on short screens */}
      <div className="relative z-20 w-full max-w-6xl mx-auto flex items-center justify-between gap-3 pb-4 sm:pb-6 shrink-0">
        {/* Top Left Brand Emblem with Rounded Logo */}
        <header className="flex items-center gap-3">
          <img
            src={ehiLogo}
            alt="EHI Multisystems"
            className="h-10 w-10 sm:h-11 sm:w-11 rounded-2xl object-cover shadow-md border border-white/80 bg-white/90 p-0.5 shrink-0"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
          <div>
            <div className="text-[15px] sm:text-[17px] font-extrabold text-slate-900 tracking-[-0.02em] leading-tight">
              EHI Multisystems
            </div>
            <div className="text-[11px] font-medium text-slate-600 tracking-tight">
              Logistics &amp; Aviation Operations
            </div>
          </div>
        </header>

        {/* Top Right Live Telemetry Badge */}
        <aside
          aria-label="System status"
          className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/75 backdrop-blur-md border border-white/85 shadow-[0_2px_10px_rgba(0,0,0,0.04)] text-xs shrink-0"
        >
          <span className="relative flex h-2 w-2">
            {status.pulse && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: status.dot }} />
            )}
            <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: status.dot }} />
          </span>
          <span className="font-semibold text-slate-700 tracking-[-0.01em] text-[11px]">{status.label}</span>
        </aside>
      </div>

      {/* Main Glassmorphic Login Card */}
      <main className="relative z-10 my-auto w-full max-w-[420px] rounded-[32px] p-7 sm:p-9 border border-white/90 shadow-[0_25px_60px_-15px_rgba(20,50,90,0.12),0_0_0_1px_rgba(255,255,255,0.8)_inset] bg-white/85 backdrop-blur-md transition-all">
        {/* Top Rounded Logo Badge */}
        <div className="mx-auto mb-5 w-14 h-14 rounded-2xl bg-white/95 border border-white shadow-[0_6px_20px_rgba(15,23,42,0.08)] p-1.5 flex items-center justify-center overflow-hidden">
          <img
            src={ehiLogo}
            alt="EHI Logo"
            className="w-full h-full rounded-xl object-contain"
          />
        </div>

        {/* Heading & Subtitle */}
        <div className="text-center mb-6">
          <h1 className="text-[22px] sm:text-[25px] font-extrabold text-slate-900 tracking-[-0.03em] mb-1.5">
            Operator Sign In
          </h1>
          <p className="text-[13px] font-medium text-slate-500 leading-relaxed max-w-[300px] mx-auto tracking-[-0.01em]">
            Sign in with your station credentials to manage flights, cargo manifests, and ledgers.
          </p>
        </div>

        {notice && (
          <div
            className="w-full flex items-center gap-2.5 backdrop-blur-md rounded-xl px-3.5 py-2.5 mb-4 animate-in fade-in bg-amber-500/10 border border-amber-500/25 text-amber-900 text-xs"
          >
            <AlertCircle size={15} className="shrink-0 text-amber-600" />
            <p className="leading-snug font-medium">{notice.message}</p>
          </div>
        )}

        {/* Authentication Form */}
        <form onSubmit={handleSubmit} className="space-y-3.5">
          {/* Email input field */}
          <div className="relative rounded-xl bg-[#eef3f8]/85 hover:bg-[#eaf0f6] focus-within:bg-white focus-within:ring-2 focus-within:ring-slate-900/15 border border-slate-200/60 transition-all">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
              <Mail size={17} />
            </div>
            <input
              id="login-email"
              name="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Operator email address"
              autoComplete="email"
              required
              className="w-full bg-transparent text-slate-800 placeholder-slate-400 text-[14px] font-medium py-3 pl-10 pr-4 outline-none tracking-[-0.01em]"
            />
          </div>

          {/* Password input field */}
          <div className="relative rounded-xl bg-[#eef3f8]/85 hover:bg-[#eaf0f6] focus-within:bg-white focus-within:ring-2 focus-within:ring-slate-900/15 border border-slate-200/60 transition-all">
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
              className="w-full bg-transparent text-slate-800 placeholder-slate-400 text-[14px] font-medium py-3 pl-10 pr-10 outline-none tracking-[-0.01em]"
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
              className="text-xs text-slate-500 hover:text-slate-800 transition-colors font-semibold tracking-[-0.01em] cursor-pointer"
            >
              Forgot password?
            </button>
          </div>

          {error && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-3.5 py-2.5 text-xs text-red-700 animate-in fade-in">
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
              className="w-full py-3.5 px-6 rounded-xl bg-[#1e2029] hover:bg-[#12131a] active:bg-black text-white font-semibold text-[14px] tracking-[-0.01em] shadow-[0_4px_14px_rgba(30,32,41,0.22)] active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {isLoading ? (
                <>
                  <Loader2 size={16} className="animate-spin text-white" />
                  <span>Signing in…</span>
                </>
              ) : (
                <span>Sign In</span>
              )}
            </button>
          </div>
        </form>

        {/* Customer Self-Service Waybill Lookup + Security Footer */}
        <div className="mt-6 pt-4 border-t border-slate-200/70 flex flex-col items-center gap-2 text-center">
          <Link
            to="/track"
            className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-slate-600 hover:text-slate-900 transition-colors tracking-[-0.01em]"
          >
            <PackageSearch size={14} />
            <span>Track a Shipment or Waybill →</span>
          </Link>
          <p className="text-[11px] font-medium text-slate-400 tracking-[-0.01em]">
            Authorized personnel only · EHI Command Portal
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
