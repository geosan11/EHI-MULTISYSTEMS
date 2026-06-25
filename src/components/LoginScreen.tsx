import React, { useState } from 'react';
import { UserProfile, signIn } from '../lib/auth';
import { LoadingState } from './views/LoadingState';
import { EHILogo } from './EHILogo';

export const LoginScreen = ({ onLogin }: { onLogin: (user: UserProfile) => void }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const user = await signIn(email, password);
      onLogin(user);
    } catch (err: any) {
      setError(err.message || 'Invalid credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-[var(--color-obsidian)] relative flex flex-col items-center justify-center p-8 overflow-hidden" style={{ minHeight: '100dvh' }}>
      {/* Background radial glows */}
      <div className="absolute top-0 left-0 w-[500px] h-[500px] rounded-full pointer-events-none filter blur-[100px]" style={{ background: 'radial-gradient(circle, rgba(245,158,11,0.12) 0%, transparent 65%)', top: '-10%', left: '-10%' }} />
      <div className="absolute bottom-0 right-0 w-[500px] h-[500px] rounded-full pointer-events-none filter blur-[100px]" style={{ background: 'radial-gradient(circle, rgba(59,130,246,0.09) 0%, transparent 65%)', bottom: '-10%', right: '-10%' }} />

      <div className="w-full max-w-[380px] flex flex-col items-center z-10">
        {/* Header */}
        <div className="text-center mb-10 flex flex-col items-center">
          <div className="mb-4">
            <EHILogo width={180} height={100} />
          </div>
          <div className="mt-2 inline-flex items-center space-x-1.5 bg-[rgba(16,185,129,0.1)] px-2.5 py-1 rounded-full border border-[rgba(16,185,129,0.2)]">
            <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-success)] animate-pulse"></div>
            <span className="text-[10px] font-sans font-semibold text-[var(--color-success)] uppercase tracking-wide">System Online</span>
          </div>
          <div className="text-[14px] font-sans text-[var(--color-muted)] mt-4">Staff Operations Portal</div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="w-full space-y-4">
          <div className="space-y-1.5">
            <label className="text-[13px] font-sans font-medium text-[var(--color-light-muted)]">Email Address</label>
            <input 
              type="text" 
              value={email}
              onChange={(e) => setEmail(e.target.value)}
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
              className="w-full h-12 px-4 text-sm rounded-xl bg-[var(--color-surface-1)] text-[var(--color-foreground)] border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-accent-amber)] focus:ring-1 focus:ring-[var(--color-accent-amber)] transition-all"
              required
            />
          </div>
          
          {error && <div className="text-[13px] font-sans text-[var(--color-error)] text-center py-1">{error}</div>}

          <button 
            type="submit"
            disabled={isLoading}
            className="ehi-btn-primary ehi-btn"
          >
            {isLoading ? 'Signing In...' : 'Sign In'}
          </button>
        </form>

        {/* Footer */}
        <div className="absolute bottom-6 left-0 right-0 text-center text-[11px] font-sans text-[var(--color-muted)]">
          EHI Multisystems &middot; Powered by EHI Ops
        </div>
      </div>
    </div>
  );
};

