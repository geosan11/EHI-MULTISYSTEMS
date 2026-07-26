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
    live:         { label: 'System Online',  color: '#34d399', dot: '#10b981', pulse: true  },
    offline:      { label: 'Server Offline', color: '#f87171', dot: '#ef4444', pulse: false },
    unconfigured: { label: 'Not Configured', color: '#fbbf24', dot: '#f59e0b', pulse: false },
  };
  const status = statusConfig[connStatus];

  return (
    <div
      className="relative flex flex-col items-center justify-center min-h-[100dvh] w-full bg-cover bg-center bg-no-repeat overflow-y-auto overflow-x-hidden p-4 sm:p-6 lg:p-10 select-none"
      style={{
        backgroundImage: `url(${loginBg})`,
      }}
    >
      {/* Dark Ambient Glass Overlay */}
      <div className="absolute inset-0 bg-slate-950/50 backdrop-blur-[4px] pointer-events-none" />

      {/* Main Responsive Container: Single card on mobile, 2-column split layout on desktop */}
      <div className="relative z-10 w-full max-w-[420px] lg:max-w-4xl bg-slate-950/60 backdrop-blur-2xl border border-white/20 rounded-3xl p-6 sm:p-8 lg:p-10 shadow-[0_30px_80px_rgba(0,0,0,0.7),inset_0_1px_1px_rgba(255,255,255,0.3)] animate-in fade-in zoom-in-95 duration-200">
        <div className="lg:grid lg:grid-cols-12 lg:gap-10 lg:items-center">

          {/* Left Column (Desktop Only Operational Overview) */}
          <div className="hidden lg:flex lg:col-span-5 flex-col items-start space-y-6 border-r border-white/10 pr-8">
            <div className="p-3 rounded-2xl bg-slate-900/80 border border-white/15 shadow-xl backdrop-blur-md">
              <img src={ehiLogo} alt="EHI Multisystems" style={{ width: 180, height: 'auto', objectFit: 'contain' }} />
            </div>

            <div>
              <h2 className="text-2xl font-extrabold text-white tracking-tight leading-tight">Logistics & Aviation Operations Portal</h2>
              <p className="text-xs text-white/70 mt-2 font-sans leading-relaxed">
                Centralized hub management, cargo manifests, passenger baggage accounting, and live station ledgers.
              </p>
            </div>

            {/* Live Operational Status */}
            <div className="w-full space-y-3 pt-2">
              <div className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/10 backdrop-blur-md">
                <ShieldCheck size={20} className="text-sky-400 shrink-0" />
                <div>
                  <div className="text-[12px] font-bold text-white">End-to-End Encrypted</div>
                  <div className="text-[10px] text-white/60">Offline-first local cache & DB sync</div>
                </div>
              </div>

              <div className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/10 backdrop-blur-md">
                <Plane size={20} className="text-amber-400 shrink-0" />
                <div>
                  <div className="text-[12px] font-bold text-white">Multi-Station Network</div>
                  <div className="text-[10px] text-white/60">MMA2 Lagos, Abuja, Kano, Port Harcourt, Enugu</div>
                </div>
              </div>
            </div>

            <div className="text-[10px] font-mono text-white/50 pt-4">
              EHI Multisystems Nigeria Ltd · Operations Platform v2.0
            </div>
          </div>

          {/* Right Column (Mobile Header + Authentication Form) */}
          <div className="w-full lg:col-span-7 flex flex-col items-center">
            
            {/* Header Branding */}
            <div className="text-center mb-6 flex flex-col items-center w-full">
              {/* Mobile Logo Display */}
              <div className="mb-3 p-2.5 rounded-2xl bg-slate-900/80 border border-white/15 backdrop-blur-md shadow-lg lg:hidden">
                <img src={ehiLogo} alt="EHI Multisystems" style={{ width: 160, height: 'auto', objectFit: 'contain' }} />
              </div>

              <h1 className="text-2xl sm:text-3xl font-extrabold font-sans text-white tracking-tight">Login</h1>
              <p className="text-[12px] sm:text-[13px] font-sans text-white/80 mt-1 font-medium">Welcome back please login to your account</p>

              {/* Connection Status Badge */}
              <div
                className="mt-2.5 inline-flex items-center space-x-1.5 px-3 py-1 rounded-full border backdrop-blur-md transition-all"
                style={{ background: `${status.dot}20`, borderColor: `${status.dot}40` }}
              >
                <div
                  className={`w-2 h-2 rounded-full ${status.pulse ? 'animate-pulse' : ''}`}
                  style={{ background: status.dot }}
                />
                <span className="text-[10px] font-mono font-bold uppercase tracking-wider" style={{ color: status.color }}>
                  {status.label}
                </span>
              </div>
            </div>

            {/* Login Form */}
            <form onSubmit={handleSubmit} className="w-full space-y-4 sm:space-y-5">
              {/* Email / Username Input */}
              <div className="relative w-full">
                <input
                  id="login-email"
                  name="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="User Name"
                  autoComplete="email"
                  className="w-full h-12 sm:h-13 px-4 pr-12 rounded-2xl bg-slate-900/60 text-white placeholder-white/50 border border-white/25 focus:border-amber-400 focus:bg-slate-900/80 focus:outline-none transition-all text-sm font-sans font-medium shadow-inner"
                  required
                />
                <User size={19} className="absolute right-4 top-1/2 -translate-y-1/2 text-white/60 pointer-events-none" />
              </div>

              {/* Password Input */}
              <div className="relative w-full">
                <input
                  id="login-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  autoComplete="current-password"
                  className="w-full h-12 sm:h-13 px-4 pr-12 rounded-2xl bg-slate-900/60 text-white placeholder-white/50 border border-white/25 focus:border-amber-400 focus:bg-slate-900/80 focus:outline-none transition-all text-sm font-sans font-medium shadow-inner"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-white/60 hover:text-white transition-colors cursor-pointer p-1"
                >
                  {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
                </button>
              </div>

              {/* Remember Me Control */}
              <div className="flex items-center justify-between px-1">
                <label className="flex items-center gap-2.5 cursor-pointer text-[13px] font-sans font-medium text-white/90 select-none">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="hidden"
                  />
                  <div className={`w-5 h-5 rounded-md flex items-center justify-center border transition-all ${rememberMe ? 'bg-amber-500 border-amber-400 text-slate-950 shadow-[0_0_12px_rgba(245,158,11,0.6)]' : 'border-white/40 bg-white/10'}`}>
                    {rememberMe && <Check size={14} strokeWidth={3} />}
                  </div>
                  <span>Remember me</span>
                </label>
              </div>

              {/* Error Message Alert */}
              {error && (
                <div className="flex items-center gap-2.5 bg-red-500/20 border border-red-500/40 backdrop-blur-md rounded-xl px-4 py-3 animate-in fade-in">
                  <AlertCircle size={17} className="text-red-400 shrink-0" />
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

              {/* Gradient Action Button */}
              <button
                type="submit"
                disabled={isLoading || connStatus === 'unconfigured'}
                className="w-full h-12 sm:h-13 rounded-2xl bg-gradient-to-r from-amber-400 via-amber-500 to-orange-500 hover:from-amber-300 hover:to-amber-500 text-slate-950 font-bold font-sans text-[15px] shadow-[0_10px_30px_rgba(245,158,11,0.4)] transition-all transform active:scale-[0.98] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 mt-2"
              >
                {isLoading ? (
                  <>
                    <Loader2 size={20} className="animate-spin text-slate-950" />
                    <span>Logging in…</span>
                  </>
                ) : (
                  'Login'
                )}
              </button>

              {/* Forgot Password Trigger */}
              <div className="text-center pt-1">
                <button
                  type="button"
                  onClick={() => { setShowForgotPassword(true); setResetEmail(email); setResetSent(false); setResetError(''); }}
                  className="text-[12px] font-sans text-white/80 hover:text-white transition-colors cursor-pointer"
                >
                  Don't have an account? <span className="font-bold underline text-white">Signup / Reset</span>
                </button>
              </div>
            </form>

            {/* Footer Credit (Mobile only) */}
            <div className="mt-6 text-center text-[11px] font-sans text-white/60 font-medium lg:hidden">
              Created by <span className="italic font-semibold text-white/80">EHI Multisystems Nigeria Ltd</span>
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
