import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { UserProfile, signIn } from '../lib/auth';
import ehiLogo from '../assets/branding/ehi-logo.png';
import { getConnectionMode, testSupabaseConnection, supabase } from '../lib/supabase';
import { Mail, Lock, Eye, EyeOff, Loader2, AlertCircle, Clock, ArrowRight, ShieldCheck, Radio, Server, Activity } from 'lucide-react';

type ConnStatus = 'checking' | 'live' | 'offline' | 'unconfigured';

export const LoginScreen = ({ onLogin, notice }: { onLogin: (user: UserProfile) => void; notice?: { type: 'expired' | 'offline'; message: string } | null }) => {
  const [email, setEmail]             = useState('');
  const [password, setPassword]       = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe]   = useState(true);
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
  }, []);

  // Wall-clock UTC display for the top utility bar
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

  const statusConfig: Record<ConnStatus, { label: string; color: string; dot: string; pulse: boolean }> = {
    checking:     { label: 'Connecting…',        color: '#94a3b8', dot: '#94a3b8', pulse: true  },
    live:         { label: 'Network Operational', color: '#34d399', dot: '#34d399', pulse: true  },
    offline:      { label: 'Offline Mode Cache',  color: '#f87171', dot: '#f87171', pulse: false },
    unconfigured: { label: 'Not Configured',     color: '#fbbf24', dot: '#fbbf24', pulse: false },
  };
  const status = statusConfig[connStatus];

  return (
    <div className="relative flex flex-col min-h-[100dvh] w-full overflow-y-auto overflow-x-hidden select-none bg-[#07090e] text-slate-100 antialiased">
      {/* Obsidian atmospheric lighting */}
      <div
        aria-hidden="true"
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage:
            'radial-gradient(circle at 50% 0%, rgba(251,191,36,0.08) 0px, transparent 650px),' +
            'radial-gradient(circle at 85% 100%, rgba(59,130,246,0.06) 0px, transparent 550px),' +
            'radial-gradient(circle at 10% 90%, rgba(16,185,129,0.04) 0px, transparent 500px)',
        }}
      />
      {/* Subtle geometric grid background */}
      <div
        aria-hidden="true"
        className="fixed inset-0 pointer-events-none opacity-[0.035]"
        style={{
          backgroundImage:
            'linear-gradient(to right, #ffffff 1px, transparent 1px), linear-gradient(to bottom, #ffffff 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />

      {/* Top utility bar */}
      <header className="relative z-10 w-full px-4 sm:px-8 lg:px-12 py-3 flex items-center justify-between border-b border-white/[0.06] bg-[#090d16]/70 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <div
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full border backdrop-blur-md transition-all"
            style={{ background: `${status.dot}14`, borderColor: `${status.dot}33` }}
          >
            <span className="relative flex h-2 w-2">
              {status.pulse && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: status.dot }} />
              )}
              <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: status.dot }} />
            </span>
            <span className="text-[11px] font-mono font-bold uppercase tracking-wider" style={{ color: status.color }}>
              {status.label}
            </span>
          </div>

          <div className="hidden md:flex items-center gap-1.5 text-[11px] font-mono text-slate-400 border-l border-white/10 pl-3">
            <Server size={12} className="text-slate-500" />
            <span>NODE // <span className="text-slate-300 font-semibold">WEST-AFRICA-LOS</span></span>
          </div>
        </div>

        <span className="hidden sm:inline text-[11px] font-mono uppercase tracking-[0.2em] text-slate-500 font-semibold">
          EHI Multisystems • Aviation Logistics Suite
        </span>

        <div className="flex items-center gap-2 text-[11px] font-mono text-slate-400 bg-white/[0.03] px-2.5 py-1 rounded-lg border border-white/[0.06]">
          <Clock size={13} className="text-[var(--color-accent-amber)]" />
          <span>UTC <span className="text-slate-200 font-semibold tracking-wider">{utcLabel}</span></span>
        </div>
      </header>

      {/* Main card container */}
      <main className="relative z-10 flex-1 flex items-center justify-center p-4 sm:p-6 lg:p-10">
        <div
          className="w-full max-w-[420px] lg:max-w-4xl rounded-[28px] overflow-hidden grid grid-cols-1 lg:grid-cols-12 border border-white/[0.08] shadow-[0_30px_90px_-20px_rgba(0,0,0,0.9)]"
          style={{
            background: 'linear-gradient(180deg, rgba(16,21,34,0.92) 0%, rgba(10,13,22,0.95) 100%)',
            backdropFilter: 'blur(32px)',
            WebkitBackdropFilter: 'blur(32px)',
          }}
        >
          {/* Left Column: Credentials Form */}
          <section className="lg:col-span-7 p-6 sm:p-8 lg:p-10 flex flex-col justify-between">
            {/* Mobile Header / Brand */}
            <div className="mb-6 flex items-center justify-between lg:hidden">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-xl bg-white/[0.05] border border-white/10">
                  <img src={ehiLogo} alt="EHI Multisystems" style={{ width: 44, height: 'auto', objectFit: 'contain' }} />
                </div>
                <div>
                  <div className="text-[13px] font-bold text-white tracking-wider">EHI MULTISYSTEMS</div>
                  <div className="text-[10px] font-mono text-[var(--color-accent-amber)]">ENTERPRISE CONSOLE</div>
                </div>
              </div>
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-[10px] font-mono text-emerald-400 font-semibold">
                <ShieldCheck size={12} />
                <span>TLS 1.3</span>
              </div>
            </div>

            <div className="my-auto w-full max-w-sm mx-auto">
              <div className="mb-6 text-left">
                <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md bg-[var(--color-accent-amber)]/10 border border-[var(--color-accent-amber)]/25 mb-2.5">
                  <Activity size={12} className="text-[var(--color-accent-amber)]" />
                  <span className="text-[10px] font-mono font-bold tracking-widest text-[var(--color-accent-amber)] uppercase">Secure Operator Gateway</span>
                </div>
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white mb-1.5">
                  Sign In
                </h1>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Enter your dispatch credentials to access the operational ledger and cargo consoles.
                </p>
              </div>

              {notice && (
                <div
                  className="w-full flex items-center gap-2.5 backdrop-blur-md rounded-xl px-3.5 py-2.5 mb-4 animate-in fade-in"
                  style={{
                    background: notice.type === 'offline' ? 'rgba(148,163,184,0.12)' : 'rgba(251,191,36,0.12)',
                    border: `1px solid ${notice.type === 'offline' ? 'rgba(148,163,184,0.3)' : 'rgba(251,191,36,0.3)'}`,
                  }}
                >
                  <AlertCircle size={15} className="shrink-0" style={{ color: notice.type === 'offline' ? '#94a3b8' : '#fbbf24' }} />
                  <p className="text-[12px] leading-snug font-medium" style={{ color: notice.type === 'offline' ? '#cbd5e1' : '#fcd34d' }}>{notice.message}</p>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Email input */}
                <div>
                  <label htmlFor="login-email" className="block text-[11px] font-mono uppercase tracking-wider text-slate-300 font-semibold mb-1.5">
                    Operator Email
                  </label>
                  <div className="relative rounded-xl group transition-all">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500 group-focus-within:text-[var(--color-accent-amber)] transition-colors">
                      <Mail size={16} />
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
                      className="w-full bg-[#0c101c]/90 text-slate-100 placeholder-slate-500 text-sm rounded-xl border border-white/10 hover:border-white/20 focus:border-[var(--color-accent-amber)] focus:ring-2 focus:ring-[var(--color-accent-amber)]/20 pl-10 pr-4 py-2.5 transition-all outline-none font-sans"
                    />
                  </div>
                </div>

                {/* Password input */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label htmlFor="login-password" className="block text-[11px] font-mono uppercase tracking-wider text-slate-300 font-semibold">
                      Master Key
                    </label>
                    <button
                      type="button"
                      onClick={() => { setShowForgotPassword(true); setResetEmail(email); setResetSent(false); setResetError(''); }}
                      className="text-xs text-[var(--color-accent-amber)] hover:underline transition-colors cursor-pointer font-medium"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative rounded-xl group transition-all">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500 group-focus-within:text-[var(--color-accent-amber)] transition-colors">
                      <Lock size={16} />
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
                      className="w-full bg-[#0c101c]/90 text-slate-100 placeholder-slate-500 text-sm rounded-xl border border-white/10 hover:border-white/20 focus:border-[var(--color-accent-amber)] focus:ring-2 focus:ring-[var(--color-accent-amber)]/20 pl-10 pr-11 py-2.5 transition-all outline-none font-sans"
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

                {/* Remember device toggle */}
                <div className="flex items-center justify-between pt-1">
                  <label className="inline-flex items-center gap-2.5 cursor-pointer select-none" onClick={() => setRememberMe(v => !v)}>
                    <span
                      className="relative inline-flex items-center w-8 h-4.5 rounded-full border transition-all"
                      style={{
                        background: rememberMe ? 'var(--color-accent-amber)' : 'rgba(255,255,255,0.08)',
                        borderColor: rememberMe ? 'transparent' : 'rgba(255,255,255,0.15)',
                        boxShadow: rememberMe ? '0 0 12px rgba(251,191,36,0.35)' : 'none',
                      }}
                    >
                      <span
                        className="w-3.5 h-3.5 bg-slate-950 rounded-full shadow transform transition-transform duration-200 ease-in-out"
                        style={{ transform: rememberMe ? 'translateX(1.125rem)' : 'translateX(0.125rem)' }}
                      />
                    </span>
                    <span className="text-xs text-slate-300 font-medium">Remember terminal credentials</span>
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
                      VITE_SUPABASE_URL not configured. Add it to environment variables.
                    </p>
                  </div>
                )}

                {/* Primary CTA (Obsidian Gold Luxe) */}
                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={isLoading || connStatus === 'unconfigured'}
                    className="relative w-full text-slate-950 font-bold py-3 px-6 rounded-xl flex items-center justify-center gap-2 text-sm tracking-wide transition-all duration-200 cursor-pointer disabled:opacity-50 group hover:opacity-95"
                    style={{
                      background: 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 50%, #d97706 100%)',
                      boxShadow: '0 8px 24px -4px rgba(245,158,11,0.4), inset 0 1px 1px rgba(255,255,255,0.4)',
                    }}
                  >
                    {isLoading ? (
                      <>
                        <Loader2 size={16} className="animate-spin text-slate-950" />
                        <span>Authenticating…</span>
                      </>
                    ) : (
                      <>
                        <span>Enter Console</span>
                        <ArrowRight size={16} className="transition-transform group-hover:translate-x-1 stroke-[2.5]" />
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>

            <div className="pt-4 mt-6 border-t border-white/[0.06] flex items-center justify-between text-[11px] font-mono text-slate-500">
              <span>EHI Multisystems • Operational Hub</span>
              <span>v2.0 // Lagos Hub</span>
            </div>
          </section>

          {/* Right Column: Aviation Telemetry & Dispatch Control Panel */}
          <section
            className="hidden lg:flex lg:col-span-5 m-3 rounded-2xl p-6 flex-col justify-between overflow-hidden relative border border-white/[0.08]"
            style={{
              background: 'linear-gradient(165deg, rgba(17,24,39,0.95) 0%, rgba(12,17,29,0.98) 50%, rgba(8,11,18,0.99) 100%)',
              boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.1), 0 20px 40px -10px rgba(0,0,0,0.8)',
            }}
          >
            {/* Ambient gold-tinted tactical radar background */}
            <div aria-hidden="true" className="absolute inset-0 pointer-events-none overflow-hidden">
              <div className="absolute -right-16 -top-16 w-72 h-72 rounded-full border border-amber-400/10 animate-ehi-pulse-orbit" />
              <div className="absolute -right-8 -top-8 w-56 h-56 rounded-full border border-white/5" />
              <div className="absolute -right-16 -top-16 w-72 h-72 animate-ehi-radar-sweep">
                <div className="w-1/2 h-1/2 origin-bottom-right" style={{ background: 'conic-gradient(from 0deg, rgba(251,191,36,0.15) 0deg, rgba(251,191,36,0.02) 45deg, transparent 60deg)' }} />
              </div>
              {/* Route lines */}
              <svg className="w-full h-full opacity-20" fill="none" viewBox="0 0 400 600" xmlns="http://www.w3.org/2000/svg">
                <path d="M-40 180 C 130 110, 240 320, 420 220" stroke="#FBBF24" strokeWidth="1.5" strokeDasharray="5 5" />
                <path d="M10 400 C 140 290, 290 520, 430 380" stroke="#38BDF8" strokeWidth="1.5" strokeDasharray="3 3" />
                <circle cx="270" cy="460" r="3.5" fill="#FBBF24" />
                <circle cx="180" cy="220" r="3.5" fill="#38BDF8" />
              </svg>
            </div>

            {/* Top brand header in telemetry panel */}
            <div className="relative z-10 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-white p-2 flex items-center justify-center shadow-lg border border-white/20">
                  <img src={ehiLogo} alt="EHI Multisystems" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                </div>
                <div>
                  <span className="text-xs font-extrabold text-white tracking-wider block font-sans">EHI MULTISYSTEMS</span>
                  <span className="text-[10px] font-mono text-[var(--color-accent-amber)] font-medium">DISPATCH TELEMETRY</span>
                </div>
              </div>
              <div className="px-2.5 py-1 rounded-full bg-white/[0.04] backdrop-blur-md border border-white/10 text-[10px] font-mono text-slate-300 font-semibold flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <ShieldCheck size={12} className="text-emerald-400" />
                <span>SECURE GATEWAY</span>
              </div>
            </div>

            {/* Middle telemetry widget */}
            <div className="relative z-10 my-auto py-4 space-y-3">
              <div className="bg-[#080d18]/80 backdrop-blur-lg rounded-2xl p-4 border border-white/[0.08] shadow-xl">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-mono text-slate-300 flex items-center gap-1.5 font-semibold">
                    <Radio size={14} className="text-[var(--color-accent-amber)]" />Active Hub Network
                  </span>
                  <span className="text-[10px] font-mono text-emerald-400 font-bold">ALL HUBS SYNCHRONIZED</span>
                </div>

                {/* Hub Node Matrix */}
                <div className="grid grid-cols-4 gap-2 pt-1 pb-2">
                  {[
                    { code: 'LOS', name: 'Lagos Hub', status: 'ACTIVE' },
                    { code: 'ABV', name: 'Abuja Station', status: 'ACTIVE' },
                    { code: 'PHC', name: 'Port Harcourt', status: 'ACTIVE' },
                    { code: 'KAN', name: 'Kano Station', status: 'SYNC' },
                  ].map((node) => (
                    <div key={node.code} className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-2 text-center">
                      <div className="text-[12px] font-mono font-bold text-white">{node.code}</div>
                      <div className="text-[9px] font-mono text-slate-400 truncate">{node.name}</div>
                      <div className="text-[8px] font-mono text-emerald-400 font-bold mt-0.5">{node.status}</div>
                    </div>
                  ))}
                </div>

                <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between text-[10px] font-mono text-slate-400">
                  <span>Data Integrity: 100% Offline-First</span>
                  <span className="text-[var(--color-accent-amber)] font-semibold">Encrypted PWA</span>
                </div>
              </div>

              <div className="px-3.5 py-2.5 rounded-xl bg-amber-400/[0.06] border border-amber-400/20 text-[11px] text-amber-200/90 flex items-center gap-2.5">
                <Lock size={15} className="text-[var(--color-accent-amber)] shrink-0" />
                <span className="leading-snug">Airwaybills, manifests, and cash ledger reconciliations require authenticated role credentials.</span>
              </div>
            </div>

            {/* Bottom telemetry footer */}
            <div className="relative z-10 pt-3 border-t border-white/[0.08]">
              <div className="flex items-center gap-2 mb-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent-amber)]" />
                <p className="text-[var(--color-accent-amber)] text-[10px] font-mono uppercase tracking-widest font-semibold">
                  Aviation Operations & Cargo Command
                </p>
              </div>
              <h2 className="text-base font-bold text-white leading-tight">
                Real-time tracking, flight manifests & fiscal ledger.
              </h2>
              <p className="text-[11px] text-slate-400 mt-1 font-normal leading-relaxed">
                Automated custody handovers, airline excess baggage, and instant retail POS reconciliation.
              </p>
            </div>
          </section>
        </div>
      </main>

      {/* Forgot Password Modal */}
      {showForgotPassword && createPortal(
        <div
          className={`fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 ${
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
            style={{ background: 'rgba(12,17,28,0.96)', backdropFilter: 'blur(32px)' }}
          >
            <div className="p-6 border-b border-white/[0.06]">
              <div className="text-[17px] font-bold text-white">Reset Master Password</div>
              <div className="text-[12px] mt-1 text-slate-400">We will email a secure link to reset your operator credentials.</div>
            </div>
            <div className="p-6">
              {resetSent ? (
                <div className="text-center py-4 space-y-3">
                  <div className="text-[15px] font-bold text-[var(--color-accent-amber)]">Reset Link Dispatched ✓</div>
                  <p className="text-[12px] leading-relaxed text-slate-200">
                    Check <span className="font-semibold text-white">{resetEmail}</span> for your reset link.
                  </p>
                  <button
                    onClick={closeForgotPasswordModal}
                    className="w-full h-11 text-slate-950 text-[13px] font-bold rounded-xl mt-3 transition-opacity hover:opacity-90 cursor-pointer"
                    style={{ background: 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 50%, #d97706 100%)' }}
                  >
                    Return to Login
                  </button>
                </div>
              ) : (
                <form onSubmit={handleForgotPassword} className="space-y-4">
                  <div>
                    <label htmlFor="reset-email" className="block text-[11px] font-mono uppercase tracking-wider text-slate-300 font-semibold mb-1.5">
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
                      className="w-full h-11 px-4 text-sm rounded-xl focus:outline-none transition-all bg-[#090d16] text-slate-100 border border-white/10 focus:border-[var(--color-accent-amber)] focus:ring-2 focus:ring-[var(--color-accent-amber)]/20"
                    />
                  </div>
                  {resetError && (
                    <p className="text-[12px] text-red-400 font-medium">{resetError}</p>
                  )}
                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={closeForgotPasswordModal}
                      className="flex-1 h-11 text-[13px] font-semibold rounded-xl transition-colors cursor-pointer border border-white/15 text-slate-300 hover:bg-white/5"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={resetSending}
                      className="flex-1 h-11 text-slate-950 text-[13px] font-bold rounded-xl disabled:opacity-60 transition-opacity hover:opacity-95 cursor-pointer"
                      style={{ background: 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 50%, #d97706 100%)' }}
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
