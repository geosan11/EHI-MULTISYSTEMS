import React, { useState } from 'react';
import { DEMO_USERS } from '../lib/constants';
import { UserProfile, signIn } from '../lib/auth';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { LoadingState } from './views/LoadingState';

export const LoginScreen = ({ onLogin }: { onLogin: (user: UserProfile) => void }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showDemo, setShowDemo] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const user = await signIn(email, password);
      onLogin(user);
    } catch (err: any) {
      setError(err.message || 'Invalid credentials. Use the demo credentials below.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDemoClick = async (demoEmail: string, demoPass: string) => {
    setEmail(demoEmail);
    setPassword(demoPass);
    setIsLoading(true);
    setError('');
    
    try {
      const user = await signIn(demoEmail, demoPass);
      onLogin(user);
    } catch (err: any) {
      setError(err.message || 'Invalid credentials. Use the demo credentials below.');
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
          <div style={{
            width: 88, height: 88,
            borderRadius: 'var(--radius-xl)',
            background: 'linear-gradient(135deg, rgba(245,158,11,0.18) 0%, rgba(245,158,11,0.07) 100%)',
            border: '1.5px solid rgba(245,158,11,0.32)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: 16,
            boxShadow: '0 8px 32px rgba(245,158,11,0.14), 0 0 0 1px rgba(245,158,11,0.06) inset',
          }}>
            <span className="font-sans text-[36px] font-black text-[var(--color-accent-amber)] leading-none select-none">EHI</span>
          </div>
          <div className="mt-2 inline-flex items-center space-x-1.5 bg-[rgba(16,185,129,0.1)] px-2.5 py-1 rounded-full border border-[rgba(16,185,129,0.2)]">
            <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-success)] animate-pulse"></div>
            <span className="text-[10px] font-sans font-semibold text-[var(--color-success)] uppercase tracking-wide">System Online</span>
          </div>
          <div className="text-[15px] font-bold font-sans text-[var(--color-foreground)] tracking-[0.1em] mt-6">MULTISYSTEMS</div>
          <div className="text-[14px] font-sans text-[var(--color-muted)] mt-1">Staff Operations Portal</div>
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

        {/* Demo Credentials */}
        <div className="w-full mt-6">
          <button 
            onClick={() => setShowDemo(!showDemo)}
            className="w-full flex items-center justify-center space-x-2 text-[13px] font-sans text-[var(--color-foreground)] bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.07)] rounded-xl py-3 hover:bg-[var(--color-surface-2)] transition-colors focus:outline-none"
          >
            <span>Need help signing in? Use Demo</span>
            {showDemo ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          
          {showDemo && (
            <div className="bg-[var(--color-surface-1)] rounded-xl mt-2 border border-[rgba(255,255,255,0.07)] flex flex-col divide-y divide-[rgba(255,255,255,0.07)] max-h-[160px] overflow-y-auto">
              {(Object.entries(DEMO_USERS)).map(([demoEmail, user]) => {
                const roleDisplay =
                  user.role === 'super_admin' ? 'SUPER ADMIN' :
                  user.role === 'cargo_agent' && demoEmail.includes('air') ? 'AIR OPS' :
                  user.role === 'cargo_agent' ? 'CARGO' :
                  user.role === 'vj_agent' ? 'VALUEJET POS' :
                  user.role === 'marketing_agent' ? 'MARKETING' :
                  user.role === 'driver' ? 'DRIVER' :
                  user.role === 'accountant' ? 'ACCOUNTANT' :
                  user.role === 'auditor' ? 'AUDITOR' :
                  user.role.toUpperCase();
                const roleColour =
                  roleDisplay === 'SUPER ADMIN' ? 'text-[var(--color-accent-amber)]' :
                  roleDisplay === 'ADMIN'       ? 'text-[var(--color-foreground)]' :
                  roleDisplay === 'CARGO'       ? 'text-[var(--color-accent-amber)]' :
                  roleDisplay === 'AIR OPS'     ? 'text-[var(--color-error)]' :
                  roleDisplay === 'VALUEJET POS'? 'text-[var(--color-accent-cobalt)]' :
                  roleDisplay === 'MARKETING'   ? 'text-[var(--color-success)]' :
                  roleDisplay === 'DRIVER'      ? 'text-purple-400' :
                  roleDisplay === 'ACCOUNTANT'  ? 'text-[var(--color-accent-cobalt)]' :
                  roleDisplay === 'AUDITOR'     ? 'text-[var(--color-error)]' :
                  'text-[var(--color-muted)]';
                return (
                  <div 
                    key={demoEmail}
                    onClick={() => handleDemoClick(demoEmail, user.password)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        handleDemoClick(demoEmail, user.password);
                      }
                    }}
                    className="px-3 py-2 flex flex-col cursor-pointer hover:bg-[var(--color-surface-2)] transition-colors active:opacity-70 focus:outline-none focus:bg-[var(--color-surface-2)]"
                  >
                    <div className="text-[11px] font-mono text-[var(--color-light-muted)]">
                      <span className={`font-bold font-sans text-[10px] uppercase tracking-wider ${roleColour}`}>{roleDisplay}</span> &middot; {demoEmail} &middot; {user.password}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="absolute bottom-6 left-0 right-0 text-center text-[11px] font-sans text-[var(--color-muted)]">
          EHI Multisystems &middot; Powered by EHI Ops
        </div>
      </div>
    </div>
  );
};

