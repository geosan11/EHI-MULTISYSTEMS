import React, { useState, useEffect } from 'react';
import { UserProfile, signIn } from '../lib/auth';
import { EHILogo } from './EHILogo';
import { getConnectionMode, testSupabaseConnection } from '../lib/supabase';

type ConnStatus = 'checking' | 'live' | 'offline' | 'unconfigured';

export const LoginScreen = ({ onLogin }: { onLogin: (user: UserProfile) => void }) => {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [connStatus, setConnStatus] = useState<ConnStatus>('checking');

  useEffect(() => {
    // Quick connection probe on mount
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
      // Distinguish network errors from auth errors
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
    checking:     { label: 'Connecting…',    color: 'var(--color-muted)',          dot: '#64748b', pulse: true  },
    live:         { label: 'System Online',  color: 'var(--color-success)',         dot: '#10b981', pulse: true  },
    offline:      { label: 'Server Offline', color: 'var(--color-error)',           dot: '#ef4444', pulse: false },
    unconfigured: { label: 'Not Configured', color: 'var(--color-accent-amber)',    dot: '#f59e0b', pulse: false },
  };
  const status = statusConfig[connStatus];

  return (
    <div className="bg-[var(--color-obsidian)] relative flex flex-col items-center justify-center p-8 overflow-hidden" style={{ minHeight: '100dvh' }}>
      {/* Background glows */}
      <div className="absolute w-[500px] h-[500px] rounded-full pointer-events-none filter blur-[100px]" style={{ background: 'radial-gradient(circle, rgba(245,158,11,0.12) 0%, transparent 65%)', top: '-10%', left: '-10%' }} />
      <div className="absolute w-[500px] h-[500px] rounded-full pointer-events-none filter blur-[100px]" style={{ background: 'radial-gradient(circle, rgba(59,130,246,0.09) 0%, transparent 65%)', bottom: '-10%', right: '-10%' }} />

      <div className="w-full max-w-[380px] flex flex-col items-center z-10">
        {/* Header */}
        <div className="text-center mb-10 flex flex-col items-center">
          <div className="mb-4">
            <EHILogo width={180} height={100} />
          </div>
          {/* Dynamic connection status badge */}
          <div
            className="mt-2 inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full border transition-all"
            style={{ background: `${status.dot}18`, borderColor: `${status.dot}33` }}
          >
            <div
              className={`w-1.5 h-1.5 rounded-full ${status.pulse ? 'animate-pulse' : ''}`}
              style={{ background: status.dot }}
            />
            <span className="text-[10px] font-sans font-semibold uppercase tracking-wide" style={{ color: status.color }}>
              {status.label}
            </span>
          </div>
          <div className="text-[14px] font-sans text-[var(--color-muted)] mt-4">Staff Operations Portal</div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="w-full space-y-4">
          <div className="space-y-1.5">
            <label className="text-[13px] font-sans font-medium text-[var(--color-light-muted)]">Email Address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@ehimultisystems.com"
              autoComplete="email"
              className="w-full h-12 px-4 text-sm rounded-xl bg-[var(--color-surface-1)] text-[var(--color-foreground)] border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-accent-amber)] focus:ring-1 focus:ring-[var(--color-accent-amber)] transition-all"
              required
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[13px] font-sans font-medium text-[var(--color-light-muted)]">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="w-full h-12 px-4 text-sm rounded-xl bg-[var(--color-surface-1)] text-[var(--color-foreground)] border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-accent-amber)] focus:ring-1 focus:ring-[var(--color-accent-amber)] transition-all"
              required
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 bg-[rgba(239,68,68,0.08)] border border-[rgba(239,68,68,0.25)] rounded-lg px-3 py-2">
              <span className="text-[var(--color-error)] mt-0.5 shrink-0">⚠</span>
              <p className="text-[12px] font-sans text-[var(--color-error)] leading-snug">{error}</p>
            </div>
          )}

          {connStatus === 'unconfigured' && (
            <div className="bg-[rgba(245,158,11,0.08)] border border-[rgba(245,158,11,0.25)] rounded-lg px-3 py-2">
              <p className="text-[11px] font-mono text-[var(--color-accent-amber)]">
                VITE_SUPABASE_URL not configured. Add it to Vercel environment variables.
              </p>
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading || connStatus === 'unconfigured'}
            className="ehi-btn-primary ehi-btn"
          >
            {isLoading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <div className="absolute bottom-6 left-0 right-0 text-center text-[11px] font-sans text-[var(--color-muted)]">
          EHI Multisystems Nigeria Ltd · MMA2, Ikeja, Lagos
        </div>
      </div>
    </div>
  );
};
