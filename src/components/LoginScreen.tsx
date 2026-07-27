import React, { useState, useEffect } from 'react';
import { UserProfile, signIn } from '../lib/auth';
import ehiLogo from '../assets/branding/ehi-logo.png';
import loginBg from '../assets/branding/login-bg.jpg';
import { getConnectionMode, testSupabaseConnection, supabase } from '../lib/supabase';
import { User, Eye, EyeOff, Check, Loader2, AlertCircle, ShieldCheck, Plane, Building2 } from 'lucide-react';

type ConnStatus = 'checking' | 'live' | 'offline' | 'unconfigured';

export const LoginScreen = ({ onLogin }: { onLogin: (user: UserProfile) => void }) => {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError]       = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [connStatus, setConnStatus] = useState<ConnStatus>('checking');
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetSent, setResetSent] = useState(false);
  const [resetSending, setResetSending] = useState(false);
  const [resetError, setResetError] = useState('');

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
    checking:     { label: 'Connecting…',    color: '#94a3b8', dot: '#94a3b8', pulse: true  },
    live:         { label: 'System Online',  color: '#3b9797', dot: '#3b9797', pulse: true  },
    offline:      { label: 'Server Offline', color: '#bf092f', dot: '#bf092f', pulse: false },
    unconfigured: { label: 'Not Configured', color: '#fbbf24', dot: '#f59e0b', pulse: false },
  };
  const status = statusConfig[connStatus];

  return (
    <div
      className="relative flex flex-col items-center justify-center min-h-[100dvh] w-full bg-cover bg-center bg-no-repeat overflow-y-auto overflow-x-hidden p-4 sm:p-6 lg:p-10 select-none animate-in fade-in duration-300"
      style={{
        backgroundImage: `url(${loginBg})`,
      }}
    >
      {/* Dark Ambient Glass Overlay */}
      <div className="absolute inset-0 bg-slate-950/65 backdrop-blur-[6px] pointer-events-none" />

      {/* Main Container: Split card with inner gradient card on desktop */}
      <div className="relative z-10 w-full max-w-[390px] lg:max-w-3xl bg-[#0f1117]/85 backdrop-blur-2xl border border-white/8 rounded-[24px] p-3 lg:p-4 shadow-[0_30px_85px_rgba(0,0,0,0.85),inset_0_1px_1px_rgba(255,255,255,0.06)]">
        <div className="lg:grid lg:grid-cols-12 lg:gap-6 lg:items-center">

          {/* Left Column (Desktop Only Inner Gradient Card) */}
          <div className="hidden lg:flex lg:col-span-5 flex-col justify-between p-5 rounded-[18px] bg-[#1a1f2e] border border-[#fbbf24]/18 text-white min-h-[390px] shadow-[0_8px_32px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.04)] relative overflow-hidden">
            {/* Subtle ambient glows — amber top-left, dark slate bottom-right */}
            <div className="absolute -top-16 -left-16 w-56 h-56 rounded-full bg-[#fbbf24]/8 filter blur-[55px] pointer-events-none" />
            <div className="absolute -bottom-16 -right-16 w-56 h-56 rounded-full bg-white/3 filter blur-[50px] pointer-events-none" />
            {/* Amber top accent line */}
            <div className="absolute top-0 left-8 right-8 h-[1px] bg-gradient-to-r from-transparent via-[#fbbf24]/35 to-transparent pointer-events-none" />

            <div className="relative z-10 p-2.5 rounded-xl bg-white/5 border border-white/10 w-fit shadow-md backdrop-blur-md">
              <img src={ehiLogo} alt="EHI Multisystems" style={{ width: 110, height: 'auto', objectFit: 'contain' }} />
            </div>

            <div className="relative z-10 space-y-3 pt-7">
              <div>
                <span className="inline-block text-[9px] uppercase font-extrabold tracking-widest text-[#fbbf24] bg-[#fbbf24]/10 border border-[#fbbf24]/22 px-2 py-0.5 rounded-full shadow-sm mb-2.5">
                  OPERATIONS HUB
                </span>
                <h2 className="text-[17px] font-extrabold text-white tracking-tight leading-snug">
                  Logistics & Aviation Operations Portal
                </h2>
                <p className="text-[11.5px] text-white/60 mt-1.5 font-sans leading-relaxed">
                  Centralized hub management, cargo manifests, passenger baggage accounting, and live station ledgers.
                </p>
              </div>

              {/* Status checklist */}
              <div className="space-y-2.5 pt-2">
                <div className="flex items-center gap-2.5 text-white/90">
                  <div className="w-5 h-5 rounded-full bg-[#fbbf24]/12 border border-[#fbbf24]/25 flex items-center justify-center shrink-0">
                    <ShieldCheck size={11} className="text-[#fbbf24]" />
                  </div>
                  <span className="text-[11px] font-semibold font-sans">End-to-End Encrypted DB Sync</span>
                </div>
                <div className="flex items-center gap-2.5 text-white/90">
                  <div className="w-5 h-5 rounded-full bg-[#fbbf24]/12 border border-[#fbbf24]/25 flex items-center justify-center shrink-0">
                    <Plane size={11} className="text-[#fbbf24]" />
                  </div>
                  <span className="text-[11px] font-semibold font-sans">Multi-Station Hub Network</span>
                </div>
                <div className="flex items-center gap-2.5 text-white/90">
                  <div className="w-5 h-5 rounded-full bg-[#22c55e]/15 border border-[#22c55e]/30 flex items-center justify-center shrink-0">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#22c55e]" />
                  </div>
                  <span className="text-[11px] font-semibold font-sans">All Systems Operational</span>
                </div>
              </div>
            </div>

            <div className="relative z-10 text-[9px] font-mono text-white/35 pt-6">
              EHI Multisystems Ltd · Portal v2.0
            </div>
          </div>

          {/* Right Column (Mobile Header + Authentication Form) */}
          <div className="w-full lg:col-span-7 flex flex-col items-center lg:px-5 py-1">
            
            {/* Header Branding */}
            <div className="text-center mb-4 flex flex-col items-center w-full">
              {/* Mobile Logo Display */}
              <div className="mb-3.5 p-2.5 rounded-2xl bg-slate-900/80 border border-white/15 backdrop-blur-md shadow-lg lg:hidden">
                <img src={ehiLogo} alt="EHI Multisystems" style={{ width: 150, height: 'auto', objectFit: 'contain' }} />
              </div>

              <h1 className="text-2xl sm:text-3xl font-extrabold font-sans text-white tracking-tight">Login</h1>
              <p className="text-[12px] sm:text-[13px] font-sans text-white/70 mt-1">Welcome back, please login to your account</p>

              {/* Connection Status Badge */}
              <div
                className="mt-2.5 inline-flex items-center space-x-1.5 px-3 py-1 rounded-full border backdrop-blur-md transition-all"
                style={{ background: `${status.dot}20`, borderColor: `${status.dot}40` }}
              >
                <div
                  className={`w-1.5 h-1.5 rounded-full ${status.pulse ? 'animate-pulse' : ''}`}
                  style={{ background: status.dot }}
                />
                <span className="text-[9px] font-mono font-bold uppercase tracking-wider" style={{ color: status.color }}>
                  {status.label}
                </span>
              </div>
            </div>

            {/* Login Form */}
            <form onSubmit={handleSubmit} className="w-full space-y-4">
              {/* Email / Username Input */}
              <div className="w-full">
                <label htmlFor="login-email" className="block text-[11px] font-sans font-bold text-white/60 mb-1.5 ml-1 uppercase tracking-wider">
                  User Name / Email
                </label>
                <div className="relative">
                  <input
                    id="login-email"
                    name="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter user name or email"
                    autoComplete="email"
                    className="w-full h-12 px-4 pr-12 rounded-xl bg-slate-900/60 text-white placeholder-white/30 border border-white/15 focus:border-[var(--color-accent-amber)] focus:bg-slate-900/80 focus:outline-none transition-all text-sm font-sans font-medium shadow-inner"
                    required
                  />
                  <User size={18} className="absolute right-4 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
                </div>
              </div>

              {/* Password Input */}
              <div className="w-full">
                <label htmlFor="login-password" className="block text-[11px] font-sans font-bold text-white/60 mb-1.5 ml-1 uppercase tracking-wider">
                  Password
                </label>
                <div className="relative">
                  <input
                    id="login-password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter account password"
                    autoComplete="current-password"
                    className="w-full h-12 px-4 pr-12 rounded-xl bg-slate-900/60 text-white placeholder-white/30 border border-white/15 focus:border-[var(--color-accent-amber)] focus:bg-slate-900/80 focus:outline-none transition-all text-sm font-sans font-medium shadow-inner"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-white/40 hover:text-white transition-colors cursor-pointer p-1"
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              {/* Remember Me — 3D Glass Toggle */}
              <div className="flex items-center justify-between px-1">
                <label className="flex items-center gap-3 cursor-pointer select-none" onClick={() => setRememberMe(v => !v)}>
                  {/* Glass pill track */}
                  <div
                    className="relative w-12 h-6 rounded-full transition-all duration-300 flex items-center"
                    style={{
                      background: rememberMe
                        ? 'linear-gradient(135deg, rgba(251,191,36,0.18) 0%, rgba(251,191,36,0.08) 100%)'
                        : 'rgba(255,255,255,0.06)',
                      border: rememberMe ? '1px solid rgba(251,191,36,0.35)' : '1px solid rgba(255,255,255,0.12)',
                      boxShadow: rememberMe
                        ? 'inset 0 2px 6px rgba(0,0,0,0.4), inset 0 -1px 2px rgba(251,191,36,0.12)'
                        : 'inset 0 2px 6px rgba(0,0,0,0.4)',
                    }}
                  >
                    {/* Track label text */}
                    <span
                      className="absolute text-[7px] font-bold tracking-widest uppercase transition-all duration-300 pointer-events-none"
                      style={{
                        right: rememberMe ? 'auto' : '5px',
                        left: rememberMe ? '7px' : 'auto',
                        color: rememberMe ? 'rgba(251,191,36,0.7)' : 'rgba(255,255,255,0.25)',
                      }}
                    >
                      {rememberMe ? 'ON' : 'OFF'}
                    </span>

                    {/* 3D Glass Orb Knob */}
                    <div
                      className="absolute w-7 h-7 rounded-full transition-all duration-300"
                      style={{
                        left: rememberMe ? 'calc(100% - 26px)' : '-2px',
                        background: rememberMe
                          ? 'radial-gradient(circle at 38% 32%, #f59e0b 0%, #d97706 50%, #92400e 100%)'
                          : 'radial-gradient(circle at 38% 32%, rgba(255,255,255,0.55) 0%, rgba(200,210,225,0.45) 50%, rgba(140,155,175,0.55) 100%)',
                        boxShadow: rememberMe
                          ? '0 4px 14px rgba(217,119,6,0.60), 0 2px 4px rgba(0,0,0,0.4), inset 0 -3px 5px rgba(100,40,0,0.50), inset 0 2px 4px rgba(254,215,170,0.65)'
                          : '0 4px 10px rgba(0,0,0,0.4), 0 1px 3px rgba(0,0,0,0.3), inset 0 -2px 4px rgba(0,0,0,0.25), inset 0 2px 4px rgba(255,255,255,0.4)',
                        border: rememberMe
                          ? '1px solid rgba(251,191,36,0.6)'
                          : '1px solid rgba(255,255,255,0.25)',
                      }}
                    >
                      {/* Top specular reflection */}
                      <div
                        className="absolute rounded-full pointer-events-none"
                        style={{
                          top: '18%', left: '22%',
                          width: '40%', height: '22%',
                          background: 'radial-gradient(ellipse, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0) 100%)',
                          filter: 'blur(0.5px)',
                        }}
                      />
                      {/* Bottom shadow rim */}
                      <div
                        className="absolute rounded-full pointer-events-none"
                        style={{
                          bottom: '12%', left: '20%',
                          width: '60%', height: '18%',
                          background: 'radial-gradient(ellipse, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0) 100%)',
                          filter: 'blur(1px)',
                        }}
                      />
                    </div>
                  </div>

                  <span className="text-[12.5px] font-sans font-semibold text-white/80">Remember me</span>
                </label>
              </div>

              {/* Error Message Alert */}
              {error && (
                <div className="flex items-center gap-2.5 bg-red-500/10 border border-red-500/25 backdrop-blur-md rounded-xl px-4 py-3 animate-in fade-in">
                  <AlertCircle size={16} className="text-red-400 shrink-0" />
                  <p className="text-[12px] font-sans text-red-200 leading-snug font-medium">{error}</p>
                </div>
              )}

              {connStatus === 'unconfigured' && (
                <div className="bg-amber-500/20 border border-amber-500/40 backdrop-blur-md rounded-xl px-4 py-3">
                  <p className="text-[11px] font-mono text-amber-200">
                    VITE_SUPABASE_URL not configured. Add it to Vercel environment variables.
                  </p>
                </div>
              )}

              {/* 3D Glass Login Button */}
              <button
                type="submit"
                disabled={isLoading || connStatus === 'unconfigured'}
                className="relative w-full h-12 rounded-xl overflow-hidden transition-all duration-150 transform active:scale-[0.97] active:translate-y-[1px] disabled:opacity-50 mt-3 cursor-pointer group"
                style={{
                  background: 'linear-gradient(160deg, #f59e0b 0%, #d97706 45%, #b45309 100%)',
                  boxShadow: '0 1px 0 rgba(255,255,255,0.30) inset, 0 -3px 0 rgba(0,0,0,0.35) inset, 0 6px 20px rgba(217,119,6,0.45), 0 2px 6px rgba(0,0,0,0.4)',
                  border: '1px solid rgba(251,191,36,0.45)',
                }}
              >
                {/* Top glass sheen */}
                <div
                  className="absolute inset-x-0 top-0 h-1/2 pointer-events-none rounded-t-xl"
                  style={{
                    background: 'linear-gradient(180deg, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0.04) 100%)',
                  }}
                />
                {/* Bottom depth shadow */}
                <div
                  className="absolute inset-x-0 bottom-0 h-[3px] pointer-events-none rounded-b-xl"
                  style={{ background: 'rgba(0,0,0,0.30)' }}
                />
                {/* Content */}
                <span className="relative z-10 flex items-center justify-center gap-2 text-[15px] font-extrabold font-sans text-amber-950">
                  {isLoading ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      <span>Logging in…</span>
                    </>
                  ) : (
                    'Login to Dashboard'
                  )}
                </span>
              </button>

              {/* Forgot Password Trigger */}
              <div className="text-center pt-1">
                <button
                  type="button"
                  onClick={() => { setShowForgotPassword(true); setResetEmail(email); setResetSent(false); setResetError(''); }}
                  className="text-[12px] font-sans text-white/60 hover:text-white transition-colors cursor-pointer"
                >
                  Don't have an account? <span className="font-bold underline text-white">Signup / Reset</span>
                </button>
              </div>
            </form>

            {/* Footer Credit (Mobile only) */}
            <div className="mt-6 text-center text-[10px] font-sans text-white/50 font-medium lg:hidden">
              Created by <span className="italic font-semibold text-white/70">EHI Multisystems Nigeria Ltd</span>
            </div>
          </div>
        </div>
      </div>

      {/* Forgot Password Modal */}
      {showForgotPassword && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in">
          <div className="bg-slate-950/90 border border-white/20 rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl backdrop-blur-2xl">
            <div className="p-5 border-b border-white/10 bg-white/5">
              <div className="text-[16px] font-bold text-white">Reset Password</div>
              <div className="text-[12px] text-white/70 mt-0.5">We'll email you a secure link to set a new password.</div>
            </div>
            <div className="p-5">
              {resetSent ? (
                <div className="text-center py-4 space-y-3">
                  <div className="text-[14px] text-amber-400 font-sans font-bold">Reset link sent ✓</div>
                  <p className="text-[12px] text-white/80 font-sans leading-relaxed">
                    Check {resetEmail} for a password reset link. It may take a minute to arrive.
                  </p>
                  <button
                    onClick={() => setShowForgotPassword(false)}
                    className="w-full h-11 bg-amber-500 hover:bg-amber-400 text-slate-950 text-[13px] font-bold rounded-xl mt-2 transition-colors cursor-pointer"
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
                    className="w-full h-12 px-4 text-sm rounded-xl bg-white/10 text-white placeholder-white/50 border border-white/20 focus:outline-none focus:border-amber-400"
                  />
                  {resetError && (
                    <p className="text-[12px] text-red-400 font-sans font-medium">{resetError}</p>
                  )}
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setShowForgotPassword(false)}
                      className="flex-1 h-11 border border-white/20 text-white/80 text-[13px] font-bold rounded-xl hover:bg-white/10 transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={resetSending}
                      className="flex-1 h-11 bg-amber-500 hover:bg-amber-400 text-slate-950 text-[13px] font-bold rounded-xl disabled:opacity-60 transition-colors cursor-pointer"
                    >
                      {resetSending ? 'Sending…' : 'Send Reset Link'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
