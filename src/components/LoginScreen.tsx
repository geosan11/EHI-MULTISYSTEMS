import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { UserProfile, signIn } from '../lib/auth';
import ehiLogo from '../assets/branding/ehi-logo.png';
import { getConnectionMode, testSupabaseConnection, supabase } from '../lib/supabase';
import { Mail, Lock, Eye, EyeOff, Loader2, AlertCircle, Clock, Radar, ArrowRight, ShieldCheck } from 'lucide-react';

type ConnStatus = 'checking' | 'live' | 'offline' | 'unconfigured';

export const LoginScreen = ({ onLogin, notice }: { onLogin: (user: UserProfile) => void; notice?: { type: 'expired' | 'offline'; message: string } | null }) => {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError]       = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [connStatus, setConnStatus] = useState<ConnStatus>('checking');
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [isClosingReset, setIsClosingReset] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetSent, setResetSent] = useState(false);
  const [resetSending, setResetSending] = useState(false);
  const [resetError, setResetError] = useState('');

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
  }, []);

  // Real wall-clock UTC display for the top utility bar -- purely
  // informational (pre-login, there's no hub/shift context yet), so this
  // is the only thing in that bar that's safe to show without a session.
  const [utcTime, setUtcTime] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setUtcTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const utcLabel = utcTime.toISOString().slice(11, 19);

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

  // This screen is deliberately always-dark ("obsidian console"), same
  // rationale as .ehi-terminal in index.css -- it doesn't track the
  // in-app light/dark toggle since that's only meaningful once signed in.
  const statusConfig: Record<ConnStatus, { label: string; color: string; dot: string; pulse: boolean }> = {
    checking:     { label: 'Connecting…',      color: '#94a3b8', dot: '#94a3b8', pulse: true  },
    live:         { label: 'System Operational', color: '#34d399', dot: '#34d399', pulse: true  },
    offline:      { label: 'Server Offline',   color: '#f87171', dot: '#f87171', pulse: false },
    unconfigured: { label: 'Not Configured',   color: '#fbbf24', dot: '#fbbf24', pulse: false },
  };
  const status = statusConfig[connStatus];

  return (
    <div className="relative flex flex-col min-h-[100dvh] w-full overflow-y-auto overflow-x-hidden select-none bg-[#080b12] text-slate-100 antialiased animate-in fade-in duration-300">
      {/* Obsidian ambient mesh backdrop */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            'radial-gradient(at 15% 15%, rgba(59,130,246,0.16) 0px, transparent 48%),' +
            'radial-gradient(at 85% 20%, rgba(245,158,11,0.10) 0px, transparent 40%),' +
            'radial-gradient(at 50% 85%, rgba(99,102,241,0.14) 0px, transparent 55%),' +
            'radial-gradient(at 88% 85%, rgba(16,185,129,0.08) 0px, transparent 45%)',
        }}
      />

      {/* Top utility bar */}
      <header className="relative z-10 w-full px-4 sm:px-6 lg:px-10 py-3 flex items-center justify-between border-b border-white/[0.06] bg-slate-950/40 backdrop-blur-md">
        <div
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border backdrop-blur-md"
          style={{ background: `${status.dot}18`, borderColor: `${status.dot}40` }}
        >
          <span className="relative flex h-1.5 w-1.5">
            {status.pulse && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: status.dot }} />
            )}
            <span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ background: status.dot }} />
          </span>
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider" style={{ color: status.color }}>
            {status.label}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] font-mono text-slate-400">
          <Clock size={12} />
          <span>UTC <span className="text-slate-200 font-semibold">{utcLabel}</span></span>
        </div>
      </header>

      <main className="relative z-10 flex-1 flex items-center justify-center p-4 sm:p-6 lg:p-10">
        <div
          className="w-full max-w-[380px] lg:max-w-3xl rounded-3xl overflow-hidden grid grid-cols-1 lg:grid-cols-12 border border-white/10 shadow-2xl"
          style={{
            background: 'rgba(14,19,30,0.85)',
            backdropFilter: 'blur(28px)',
            WebkitBackdropFilter: 'blur(28px)',
            boxShadow: '0 35px 80px -20px rgba(0,0,0,0.9), 0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 1px rgba(255,255,255,0.1)',
          }}
        >
          {/* Left column: credentials */}
          <section className="lg:col-span-7 p-7 sm:p-10 lg:p-12 flex flex-col justify-between">
            {/* Mobile logo */}
            <div className="mb-6 flex items-center justify-center lg:hidden">
              <div className="p-2 rounded-xl bg-white/[0.04] border border-white/10">
                <img src={ehiLogo} alt="EHI Multisystems" style={{ width: 130, height: 'auto', objectFit: 'contain' }} />
              </div>
            </div>

            <div className="my-auto w-full max-w-md mx-auto">
              <div className="mb-8 text-left">
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white mb-2">Operator Access</h1>
                <p className="text-sm text-slate-400 leading-relaxed">Enter your credentials to access the dispatch console.</p>
              </div>

              {notice && (
                <div
                  className="w-full flex items-center gap-2.5 backdrop-blur-md rounded-xl px-3.5 py-2.5 mb-5 animate-in fade-in"
                  style={{
                    background: notice.type === 'offline' ? 'rgba(148,163,184,0.12)' : 'rgba(245,158,11,0.12)',
                    border: `1px solid ${notice.type === 'offline' ? 'rgba(148,163,184,0.3)' : 'rgba(245,158,11,0.3)'}`,
                  }}
                >
                  <AlertCircle size={15} className="shrink-0" style={{ color: notice.type === 'offline' ? '#94a3b8' : '#fbbf24' }} />
                  <p className="text-[12px] leading-snug font-medium" style={{ color: notice.type === 'offline' ? '#cbd5e1' : '#fcd34d' }}>{notice.message}</p>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-5">
                {/* Email */}
                <div>
                  <label htmlFor="login-email" className="block text-xs font-medium text-slate-300 mb-2">
                    Email
                  </label>
                  <div className="relative rounded-xl group transition-all duration-200">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500 group-focus-within:text-amber-400 transition-colors">
                      <Mail size={17} />
                    </div>
                    <input
                      id="login-email"
                      name="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@ehimultisystems.com"
                      autoComplete="email"
                      required
                      className="w-full bg-[#111724]/80 hover:bg-[#111724] text-slate-100 placeholder-slate-500 text-sm rounded-xl border border-white/10 hover:border-white/20 focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20 pl-10 pr-4 py-3 transition-all duration-200 outline-none"
                    />
                  </div>
                </div>

                {/* Password */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label htmlFor="login-password" className="block text-xs font-medium text-slate-300">
                      Password
                    </label>
                    <button
                      type="button"
                      onClick={() => { setShowForgotPassword(true); setResetEmail(email); setResetSent(false); setResetError(''); }}
                      className="text-xs text-amber-400/90 hover:text-amber-300 hover:underline transition-colors cursor-pointer"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative rounded-xl group transition-all duration-200">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500 group-focus-within:text-amber-400 transition-colors">
                      <Lock size={17} />
                    </div>
                    <input
                      id="login-password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••••••"
                      autoComplete="current-password"
                      required
                      className="w-full bg-[#111724]/80 hover:bg-[#111724] text-slate-100 placeholder-slate-500 text-sm rounded-xl border border-white/10 hover:border-white/20 focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20 pl-10 pr-11 py-3 transition-all duration-200 outline-none"
                    />
                    <button
                      type="button"
                      aria-label="Toggle password visibility"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-500 hover:text-slate-300 focus:outline-none transition-colors cursor-pointer"
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                {/* Remember me */}
                <div className="flex items-center justify-between pt-0.5">
                  <label className="inline-flex items-center gap-2.5 cursor-pointer select-none" onClick={() => setRememberMe(v => !v)}>
                    <span
                      className="relative inline-flex items-center w-9 h-5 rounded-full border transition-colors duration-200"
                      style={{
                        background: rememberMe ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' : '#1e293b',
                        borderColor: rememberMe ? 'transparent' : 'rgba(255,255,255,0.1)',
                        boxShadow: rememberMe ? '0 0 14px rgba(16,185,129,0.5)' : 'none',
                      }}
                    >
                      <span
                        className="w-3.5 h-3.5 bg-white rounded-full shadow transform transition-transform duration-200 ease-in-out"
                        style={{ transform: rememberMe ? 'translateX(1.375rem)' : 'translateX(0.125rem)' }}
                      />
                    </span>
                    <span className="text-xs text-slate-300">Remember this device</span>
                  </label>
                </div>

                {error && (
                  <div className="flex items-center gap-2.5 bg-red-500/10 border border-red-500/25 backdrop-blur-md rounded-xl px-3.5 py-2.5 animate-in fade-in">
                    <AlertCircle size={15} className="text-red-400 shrink-0" />
                    <p className="text-[12px] text-red-300 leading-snug font-medium">{error}</p>
                  </div>
                )}

                {connStatus === 'unconfigured' && (
                  <div className="bg-amber-500/10 border border-amber-400/25 backdrop-blur-md rounded-xl px-3.5 py-2.5">
                    <p className="text-[11px] font-mono text-amber-300">
                      VITE_SUPABASE_URL not configured. Add it to Vercel environment variables.
                    </p>
                  </div>
                )}

                {/* Primary CTA */}
                <div className="pt-1">
                  <button
                    type="submit"
                    disabled={isLoading || connStatus === 'unconfigured'}
                    className="relative w-full text-white font-semibold py-3 px-6 rounded-xl flex items-center justify-center gap-2 text-sm tracking-wide border border-white/20 shadow-lg group overflow-hidden transition-all duration-200 disabled:opacity-50"
                    style={{
                      background: 'linear-gradient(135deg, #3b82f6 0%, #4f46e5 52%, #7c3aed 100%)',
                      boxShadow: '0 10px 28px -4px rgba(79,70,229,0.5), 0 0 18px 2px rgba(99,102,241,0.25), inset 0 1px 1px rgba(255,255,255,0.3)',
                    }}
                  >
                    {isLoading ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        <span>Signing in…</span>
                      </>
                    ) : (
                      <>
                        <span>Access Console</span>
                        <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>

            <div className="pt-5 mt-5 border-t border-white/[0.06] flex items-center justify-between text-[11px] font-mono text-slate-500">
              <span>EHI Multisystems • Operational Hub</span>
              <span className="hidden sm:inline text-slate-600">Created by EHI Multisystems Nigeria Ltd</span>
            </div>
          </section>

          {/* Right column: brand / telemetry panel */}
          <section
            className="hidden lg:flex lg:col-span-5 m-3 lg:m-3.5 rounded-2xl p-6 sm:p-8 flex-col justify-between overflow-hidden shadow-2xl relative border border-white/15"
            style={{
              background: 'linear-gradient(155deg, rgba(30,58,138,0.85) 0%, rgba(49,46,129,0.9) 35%, rgba(76,29,149,0.85) 75%, rgba(26,16,60,0.95) 100%)',
              boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.2), 0 25px 50px -12px rgba(10,14,26,0.85)',
            }}
          >
            {/* Decorative radar rings + sweep + route curves -- kept purely
                atmospheric, no invented node names/latencies/security
                claims, since nothing here is backed by a real monitoring
                feed pre-login. */}
            <div aria-hidden="true" className="absolute inset-0 pointer-events-none overflow-hidden">
              <div className="absolute -right-16 -top-16 w-72 h-72 rounded-full border border-white/15 animate-ehi-pulse-orbit" />
              <div className="absolute -right-8 -top-8 w-56 h-56 rounded-full border border-white/10" />
              <div className="absolute -right-16 -top-16 w-72 h-72 animate-ehi-radar-sweep">
                <div className="w-1/2 h-1/2 origin-bottom-right" style={{ background: 'conic-gradient(from 0deg, rgba(255,255,255,0.22) 0deg, rgba(255,255,255,0.04) 45deg, transparent 60deg)' }} />
              </div>
              <svg className="w-full h-full opacity-20" fill="none" viewBox="0 0 400 600" xmlns="http://www.w3.org/2000/svg">
                <path d="M-40 180 C 130 110, 240 320, 420 220" stroke="#FFFFFF" strokeWidth="1.5" strokeDasharray="5 5" />
                <path d="M10 400 C 140 290, 290 520, 430 380" stroke="#FFFFFF" strokeWidth="1.5" strokeDasharray="3 3" />
                <circle cx="270" cy="460" r="3" fill="#FFFFFF" />
                <circle cx="180" cy="220" r="3" fill="#FFFFFF" />
              </svg>
            </div>

            <div className="relative z-10 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-white/95 backdrop-blur-md p-1.5 flex items-center justify-center shadow-lg ring-2 ring-white/20">
                  <img src={ehiLogo} alt="EHI Multisystems" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                </div>
                <div>
                  <span className="text-xs font-bold text-white tracking-wide block">CARGO CONSOLE</span>
                  <span className="text-[10px] font-mono text-blue-200/80">OPERATIONS TELEMETRY</span>
                </div>
              </div>
              <div className="px-2.5 py-1 rounded-full bg-black/40 backdrop-blur-md border border-white/15 text-[11px] font-mono text-blue-200 font-semibold flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <ShieldCheck size={13} className="text-emerald-400" />
                <span>SECURE GATEWAY</span>
              </div>
            </div>

            <div className="relative z-10 my-auto py-5 space-y-3">
              <div className="bg-slate-950/50 backdrop-blur-lg rounded-xl p-3.5 border border-white/15 shadow-xl">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-mono text-blue-200/90 flex items-center gap-1.5 font-medium">
                    <Radar size={14} className="text-emerald-300" />Network Overview
                  </span>
                </div>
                <div className="h-16 w-full rounded-lg bg-black/40 border border-white/10 relative overflow-hidden flex items-center justify-center">
                  <svg className="w-full h-full p-2" fill="none" viewBox="0 0 320 80" xmlns="http://www.w3.org/2000/svg">
                    <path d="M20 40 Q 90 10, 160 40 T 300 40" stroke="rgba(99,102,241,0.4)" strokeDasharray="4 4" strokeWidth="1.5" />
                    <path d="M20 40 Q 90 70, 160 40 T 300 40" stroke="rgba(245,158,11,0.4)" strokeDasharray="3 3" strokeWidth="1.5" />
                    <circle cx="40" cy="35" r="4" fill="#38BDF8" className="animate-pulse" />
                    <circle cx="160" cy="40" r="5" fill="#10B981" />
                    <circle cx="280" cy="45" r="4" fill="#F59E0B" className="animate-pulse" />
                  </svg>
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent animate-pulse pointer-events-none" />
                </div>
              </div>
              <div className="px-3 py-2.5 rounded-lg bg-amber-500/10 border border-amber-400/20 text-[11px] text-amber-200/90 flex items-center gap-2">
                <Lock size={14} className="text-amber-400 flex-shrink-0" />
                <span className="leading-tight">Active waybills, manifest payloads, and hub routes are restricted to authenticated operators.</span>
              </div>
            </div>

            <div className="relative z-10 pt-2 border-t border-white/10">
              <div className="flex items-center gap-2 mb-1.5">
                <Radar size={15} className="text-amber-400" />
                <p className="text-blue-200 text-[11px] font-mono uppercase tracking-widest font-semibold">Operations Control</p>
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-white leading-tight tracking-tight">
                Track, dispatch, and reconcile cargo in real time.
              </h2>
              <p className="text-[11px] text-white/70 mt-2 font-normal leading-relaxed">
                Integrated electronic manifests, instant waybill status sync, and automated custody handover receipts.
              </p>
            </div>
          </section>
        </div>
      </main>

      {/* Forgot Password Modal */}
      {showForgotPassword && createPortal(
        <div
          className={`fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 ${
            isClosingReset ? 'animate-modal-backdrop-out' : 'animate-modal-backdrop-in'
          }`}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeForgotPasswordModal();
          }}
        >
          <div
            className={`rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl h-auto max-h-[85vh] border border-white/10 ${
              isClosingReset ? 'animate-modal-slide-out' : 'animate-modal-slide-in'
            }`}
            style={{ background: 'rgba(14,19,30,0.95)', backdropFilter: 'blur(28px)' }}
          >
            <div className="p-5 border-b border-white/[0.06]">
              <div className="text-[16px] font-bold text-white">Reset Password</div>
              <div className="text-[12px] mt-0.5 text-slate-400">We'll email you a secure link to set a new password.</div>
            </div>
            <div className="p-5">
              {resetSent ? (
                <div className="text-center py-4 space-y-3">
                  <div className="text-[14px] font-bold text-amber-400">Reset link sent ✓</div>
                  <p className="text-[12px] leading-relaxed text-slate-200">
                    Check {resetEmail} for a password reset link. It may take a minute to arrive.
                  </p>
                  <button
                    onClick={closeForgotPasswordModal}
                    className="w-full h-11 text-white text-[13px] font-bold rounded-xl mt-2 transition-opacity hover:opacity-90 cursor-pointer"
                    style={{ background: 'linear-gradient(135deg, #3b82f6 0%, #4f46e5 52%, #7c3aed 100%)' }}
                  >
                    Done
                  </button>
                </div>
              ) : (
                <form onSubmit={handleForgotPassword} className="space-y-4">
                  <input
                    id="reset-email"
                    name="email"
                    type="email"
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    placeholder="you@ehimultisystems.com"
                    autoComplete="email"
                    autoFocus
                    className="w-full h-12 px-4 text-sm rounded-xl focus:outline-none transition-all bg-[#111724]/80 text-slate-100 border border-white/10 focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20"
                  />
                  {resetError && (
                    <p className="text-[12px] text-red-400 font-medium">{resetError}</p>
                  )}
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={closeForgotPasswordModal}
                      className="flex-1 h-11 text-[13px] font-bold rounded-xl transition-colors cursor-pointer border border-white/15 text-slate-200 hover:bg-white/5"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={resetSending}
                      className="flex-1 h-11 text-white text-[13px] font-bold rounded-xl disabled:opacity-60 transition-opacity hover:opacity-90 cursor-pointer"
                      style={{ background: 'linear-gradient(135deg, #3b82f6 0%, #4f46e5 52%, #7c3aed 100%)' }}
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
