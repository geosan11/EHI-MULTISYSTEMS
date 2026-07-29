import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { UserProfile, signIn } from '../lib/auth';
import ehiLogo from '../assets/branding/ehi-logo.png';
import loginBg from '../assets/branding/login-bg.jpg';
import loginArt from '../assets/branding/ehi_login_art.jpg';
import { getConnectionMode, testSupabaseConnection, supabase } from '../lib/supabase';
import { User, Eye, EyeOff, Loader2, AlertCircle } from 'lucide-react';

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
      {/* Ambient Glass Overlay (theme-aware) */}
      <div className="absolute inset-0 backdrop-blur-[6px] pointer-events-none" style={{ background: 'var(--color-overlay)' }} />

      {/* Main Container: Sleek desktop split card styled like the mockup */}
      <div
        className="relative z-10 w-full max-w-[380px] lg:max-w-3xl backdrop-blur-2xl p-4 lg:p-5"
        style={{
          background: 'var(--color-surface-card-glass)',
          border: '1px solid var(--color-border-strong)',
          borderRadius: 'var(--radius-2xl)',
          boxShadow: 'var(--shadow-modal)',
        }}
      >
        <div className="lg:grid lg:grid-cols-12 lg:gap-6 lg:items-center">

          {/* Left Column (Authentication Form) */}
          <div className="w-full lg:col-span-7 flex flex-col items-start lg:px-3 py-1">
            
            {/* Header Branding */}
            <div className="text-left mb-5 flex flex-col items-start w-full">
              {/* Mobile Logo Display */}
              <div
                className="mb-3.5 p-2 rounded-xl backdrop-blur-md shadow-lg lg:hidden"
                style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}
              >
                <img src={ehiLogo} alt="EHI Multisystems" style={{ width: 130, height: 'auto', objectFit: 'contain' }} />
              </div>

              <h1 className="text-2xl sm:text-[28px] font-extrabold font-sans tracking-tight" style={{ color: 'var(--color-foreground)' }}>Sign in</h1>
              <p className="text-[12px] font-sans mt-1" style={{ color: 'var(--color-muted)' }}>Enter your credentials to access your portal</p>

              {/* Connection Status Badge */}
              <div
                className="mt-2.5 inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full border backdrop-blur-md transition-all"
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
                <label htmlFor="login-email" className="block text-[11px] font-sans font-bold mb-1.5 ml-0.5 uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
                  Your email or username
                </label>
                <div className="relative">
                  <input
                    id="login-email"
                    name="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@company.com"
                    autoComplete="email"
                    className="w-full h-11 px-3.5 pr-10 rounded-[var(--radius-md)] focus:outline-none transition-all text-sm font-sans font-medium shadow-inner"
                    style={{
                      background: 'var(--color-input-bg)',
                      color: 'var(--color-input-text)',
                      border: '1.5px solid var(--color-border)',
                    }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--color-accent-amber)'; e.currentTarget.style.boxShadow = '0 0 0 3px var(--glow-amber)'; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.boxShadow = 'none'; }}
                    required
                  />
                  <User size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--color-muted)' }} />
                </div>
              </div>

              {/* Password Input with inline Forgot password link */}
              <div className="w-full">
                <div className="flex items-center justify-between mb-1.5 ml-0.5">
                  <label htmlFor="login-password" className="block text-[11px] font-sans font-bold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => { setShowForgotPassword(true); setResetEmail(email); setResetSent(false); setResetError(''); }}
                    className="text-[11px] font-sans hover:text-[var(--color-accent-amber)] transition-colors cursor-pointer"
                    style={{ color: 'var(--color-muted)' }}
                  >
                    Forget password?
                  </button>
                </div>
                <div className="relative">
                  <input
                    id="login-password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    autoComplete="current-password"
                    className="w-full h-11 px-3.5 pr-10 rounded-[var(--radius-md)] focus:outline-none transition-all text-sm font-sans font-medium shadow-inner"
                    style={{
                      background: 'var(--color-input-bg)',
                      color: 'var(--color-input-text)',
                      border: '1.5px solid var(--color-border)',
                    }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--color-accent-amber)'; e.currentTarget.style.boxShadow = '0 0 0 3px var(--glow-amber)'; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.boxShadow = 'none'; }}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 transition-colors cursor-pointer p-1"
                    style={{ color: 'var(--color-muted)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-foreground)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-muted)'; }}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {/* Remember Me — Frosted Glass Lens 3D Toggle */}
              <div className="flex items-center justify-between px-0.5 pt-0.5">
                <label className="flex items-center gap-3 cursor-pointer select-none" onClick={() => setRememberMe(v => !v)}>
                  {/* Glass pill track */}
                  <div
                    className="relative w-12 h-6 rounded-full transition-all duration-300 flex items-center px-1"
                    style={{
                      background: rememberMe
                        ? 'linear-gradient(135deg, rgba(34,197,94,0.12) 0%, rgba(251,191,36,0.08) 100%)'
                        : 'var(--color-surface-2)',
                      border: rememberMe ? '1px solid rgba(34,197,94,0.30)' : '1px solid var(--color-border-strong)',
                      boxShadow: 'var(--shadow-xs)',
                    }}
                  >
                    {/* Track label text */}
                    <span
                      className="absolute text-[7px] font-extrabold tracking-widest uppercase transition-all duration-300 pointer-events-none"
                      style={{
                        right: rememberMe ? 'auto' : '6px',
                        left: rememberMe ? '8px' : 'auto',
                        color: rememberMe ? 'rgba(34,197,94,0.85)' : 'var(--color-muted)',
                      }}
                    >
                      {rememberMe ? 'ON' : 'OFF'}
                    </span>

                    {/* Frosted Glass Lens Knob with Glowing Core */}
                    <div
                      className="absolute w-7 h-7 rounded-full transition-all duration-300 backdrop-blur-md flex items-center justify-center"
                      style={{
                        left: rememberMe ? 'calc(100% - 26px)' : '-2px',
                        background: 'var(--color-surface-card)',
                        boxShadow: rememberMe
                          ? '0 6px 16px rgba(34,197,94,0.45), var(--shadow-sm)'
                          : 'var(--shadow-sm)',
                        border: '1px solid var(--color-border-strong)',
                      }}
                    >
                      {/* Internal Radiant Glowing Core */}
                      <div
                        className="w-4 h-4 rounded-full transition-all duration-300"
                        style={{
                          background: rememberMe
                            ? 'radial-gradient(circle at 40% 35%, #86efac 0%, #22c55e 50%, #15803d 100%)'
                            : 'radial-gradient(circle at 40% 35%, rgba(255,255,255,0.6) 0%, rgba(160,175,200,0.4) 60%, rgba(100,115,140,0.5) 100%)',
                          boxShadow: rememberMe
                            ? '0 0 12px #22c55e, inset 0 1px 2px rgba(255,255,255,0.7)'
                            : 'inset 0 1px 2px rgba(255,255,255,0.5)',
                        }}
                      />

                      {/* Top Specular Lens Highlight */}
                      <div
                        className="absolute rounded-full pointer-events-none"
                        style={{
                          top: '12%', left: '18%',
                          width: '45%', height: '25%',
                          background: 'radial-gradient(ellipse, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0) 100%)',
                          filter: 'blur(0.4px)',
                        }}
                      />
                    </div>
                  </div>

                  <span className="text-[12px] font-sans font-semibold" style={{ color: 'var(--color-foreground)' }}>Remember me</span>
                </label>
              </div>

              {/* Error Message Alert */}
              {error && (
                <div className="flex items-center gap-2.5 bg-red-500/10 border border-red-500/25 backdrop-blur-md rounded-xl px-3.5 py-2.5 animate-in fade-in">
                  <AlertCircle size={15} className="text-red-400 shrink-0" />
                  <p className="text-[11.5px] font-sans text-red-200 leading-snug font-medium">{error}</p>
                </div>
              )}

              {connStatus === 'unconfigured' && (
                <div className="bg-amber-500/20 border border-amber-500/40 backdrop-blur-md rounded-xl px-3.5 py-2.5">
                  <p className="text-[10.5px] font-mono text-amber-200">
                    VITE_SUPABASE_URL not configured. Add it to Vercel environment variables.
                  </p>
                </div>
              )}

              {/* 3D Glass Login Button */}
              <button
                type="submit"
                disabled={isLoading || connStatus === 'unconfigured'}
                className="relative w-full h-11 rounded-xl overflow-hidden transition-all duration-200 transform hover:scale-[1.015] active:scale-[0.97] active:translate-y-[1px] disabled:opacity-50 mt-2 cursor-pointer group shadow-[0_6px_20px_rgba(251,191,36,0.45)] hover:shadow-[0_8px_28px_rgba(251,191,36,0.65)]"
                style={{
                  background: 'linear-gradient(160deg, #fde68a 0%, #fbbf24 35%, #d97706 100%)',
                  border: '1px solid rgba(253,230,138,0.5)',
                }}
              >
                {/* Top glass sheen */}
                <div
                  className="absolute inset-x-0 top-0 h-1/2 pointer-events-none rounded-t-xl"
                  style={{
                    background: 'linear-gradient(180deg, rgba(255,255,255,0.35) 0%, rgba(255,255,255,0.05) 100%)',
                  }}
                />
                {/* Dynamic light sheen streak on hover */}
                <div className="absolute inset-0 w-1/2 h-full bg-gradient-to-r from-transparent via-white/50 to-transparent -skew-x-12 -translate-x-full group-hover:translate-x-[300%] transition-transform duration-1000 ease-in-out pointer-events-none" />
                {/* Bottom depth shadow */}
                <div
                  className="absolute inset-x-0 bottom-0 h-[3px] pointer-events-none rounded-b-xl"
                  style={{ background: 'rgba(0,0,0,0.30)' }}
                />
                {/* Content */}
                <span className="relative z-10 flex items-center justify-center gap-2 text-[14px] font-extrabold font-sans text-amber-950 group-hover:scale-105 transition-transform duration-200">
                  {isLoading ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      <span>Signing in…</span>
                    </>
                  ) : (
                    'Sign in'
                  )}
                </span>
              </button>

              {/* Signup Link */}
              <div className="text-center pt-1">
                <span className="text-[11.5px] font-sans" style={{ color: 'var(--color-muted)' }}>
                  Don't have an account?{' '}
                  <button
                    type="button"
                    onClick={() => { setShowForgotPassword(true); setResetEmail(email); setResetSent(false); setResetError(''); }}
                    className="font-bold hover:text-[var(--color-accent-amber)] transition-colors cursor-pointer"
                    style={{ color: 'var(--color-foreground)' }}
                  >
                    Signup
                  </button>
                </span>
              </div>
            </form>

            {/* Footer Credit (Mobile only) */}
            <div className="mt-4 text-center text-[9.5px] font-sans font-medium lg:hidden" style={{ color: 'var(--color-muted)' }}>
              Created by <span className="italic font-semibold" style={{ color: 'var(--color-foreground)' }}>EHI Multisystems Nigeria Ltd</span>
            </div>
          </div>

          {/* Right Column (Desktop Cargo Aviation Artwork Panel - Centralized Logo) */}
          <div className="hidden lg:flex lg:col-span-5 flex-col justify-between p-5 rounded-[18px] bg-[#090a0f] border border-white/12 text-white min-h-[380px] shadow-[0_8px_32px_rgba(0,0,0,0.8),inset_0_1px_0_rgba(255,255,255,0.08)] relative overflow-hidden">
            
            {/* Cargo Plane Loading Background Artwork */}
            <div
              className="absolute inset-0 bg-cover bg-center opacity-90 pointer-events-none"
              style={{ backgroundImage: `url(${loginArt})` }}
            />
            {/* Soft Ambient Vignette Overlay */}
            <div className="absolute inset-0 bg-gradient-to-b from-slate-950/60 via-slate-950/30 to-slate-950/80 pointer-events-none" />

            {/* Centralized EHI Logo Container */}
            <div className="relative z-10 my-auto flex flex-col items-center justify-center w-full">
              <div className="p-4 px-6 rounded-2xl bg-white/95 backdrop-blur-xl border border-white/60 shadow-2xl flex items-center justify-center transition-transform duration-300 hover:scale-105">
                <img src={ehiLogo} alt="EHI Multisystems" style={{ width: 135, height: 'auto', objectFit: 'contain' }} />
              </div>
            </div>

            {/* Bottom Minimal Brand Tag */}
            <div className="relative z-10 pt-3 border-t border-white/20 flex items-center justify-between text-[10px] font-sans text-white/90">
              <span className="font-bold">EHI Multisystems Nigeria Ltd</span>
              <span className="text-[#fbbf24] font-extrabold tracking-wide">Aviation Logistics</span>
            </div>

          </div>

        </div>
      </div>

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
            className={`rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl backdrop-blur-2xl h-auto max-h-[85vh] ${
              isClosingReset ? 'animate-modal-slide-out' : 'animate-modal-slide-in'
            }`}
            style={{ background: 'var(--color-surface-card-glass)', border: '1px solid var(--color-border-strong)' }}
          >
            <div className="p-5" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <div className="text-[16px] font-bold" style={{ color: 'var(--color-foreground)' }}>Reset Password</div>
              <div className="text-[12px] mt-0.5" style={{ color: 'var(--color-muted)' }}>We'll email you a secure link to set a new password.</div>
            </div>
            <div className="p-5">
              {resetSent ? (
                <div className="text-center py-4 space-y-3">
                  <div className="text-[14px] text-amber-500 font-sans font-bold">Reset link sent ✓</div>
                  <p className="text-[12px] font-sans leading-relaxed" style={{ color: 'var(--color-foreground)' }}>
                    Check {resetEmail} for a password reset link. It may take a minute to arrive.
                  </p>
                  <button
                    onClick={closeForgotPasswordModal}
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
                    className="w-full h-12 px-4 text-sm rounded-[var(--radius-md)] focus:outline-none transition-all"
                    style={{ background: 'var(--color-input-bg)', color: 'var(--color-input-text)', border: '1px solid var(--color-border)' }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--color-accent-amber)'; e.currentTarget.style.boxShadow = '0 0 0 3px var(--glow-amber)'; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.boxShadow = 'none'; }}
                  />
                  {resetError && (
                    <p className="text-[12px] text-red-500 font-sans font-medium">{resetError}</p>
                  )}
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={closeForgotPasswordModal}
                      className="flex-1 h-11 text-[13px] font-bold rounded-xl transition-colors cursor-pointer"
                      style={{ border: '1px solid var(--color-border-strong)', color: 'var(--color-foreground)' }}
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
        </div>,
        document.body
      )}
    </div>
  );
};
