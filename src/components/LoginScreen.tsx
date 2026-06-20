import React, { useState } from 'react';
import { DEMO_USERS } from '../lib/constants';
import { UserProfile, signIn } from '../lib/auth';

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
    <div className="min-h-screen bg-[var(--color-obsidian)] flex flex-col items-center justify-center p-8">
      <div className="w-full max-w-[380px] flex flex-col items-center">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="text-[48px] font-bold font-mono text-[var(--color-accent-amber)] leading-none">EHI</div>
          <div className="text-[13px] font-bold font-mono text-white tracking-[0.2em] mt-2">MULTISYSTEMS</div>
          <div className="text-[9px] font-mono text-[var(--color-muted)] mt-1">LOGISTICS INTELLIGENCE PLATFORM</div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="w-full space-y-4">
          <div className="space-y-1">
            <label className="text-[9px] font-mono uppercase text-[var(--color-muted)]">Email Address</label>
            <input 
              type="text" 
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full h-11 px-3 text-sm rounded bg-[var(--color-surface-1)] text-white border border-[rgba(255,255,255,0.07)] focus:outline-none focus:border-[var(--color-muted)]"
              required
            />
          </div>
          <div className="space-y-1">
            <label className="text-[9px] font-mono uppercase text-[var(--color-muted)]">Password</label>
            <input 
              type="password" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full h-11 px-3 text-sm rounded bg-[var(--color-surface-1)] text-white border border-[rgba(255,255,255,0.07)] focus:outline-none focus:border-[var(--color-muted)]"
              required
            />
          </div>
          
          {error && <div className="text-[11px] font-mono text-[var(--color-error)] text-center py-1">{error}</div>}

          <button 
            type="submit"
            disabled={isLoading}
            className="w-full py-[14px] bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] text-[14px] font-bold font-mono rounded mt-2 disabled:opacity-70 disabled:cursor-not-allowed transition-opacity"
          >
            {isLoading ? 'SIGNING IN...' : 'SIGN IN'}
          </button>
        </form>

        {/* Demo Credentials */}
        <div className="w-full mt-8">
          <div className="flex items-center justify-center space-x-2 mb-4">
            <div className="h-px bg-[rgba(255,255,255,0.07)] flex-1"></div>
            <span className="text-[9px] font-mono text-[var(--color-muted)]">Demo Credentials</span>
            <div className="h-px bg-[rgba(255,255,255,0.07)] flex-1"></div>
          </div>
          
          <div className="bg-[var(--color-surface-1)] rounded border border-[rgba(255,255,255,0.07)] flex flex-col divide-y divide-[rgba(255,255,255,0.07)] max-h-[160px] overflow-y-auto">
            {(Object.entries(DEMO_USERS)).map(([demoEmail, user]) => {
              const roleDisplay = user.role === 'super_admin' ? 'SUPER ADMIN' : 
                                  user.role === 'admin' ? 'ADMIN' : 
                                  user.role === 'cargo_agent' && demoEmail.includes('air') ? 'AIR OPS' :
                                  user.role === 'cargo_agent' ? 'CARGO' : 
                                  user.role === 'vj_agent' ? 'VJ POS' : 
                                  user.role === 'marketing_agent' ? 'MKTG' : 'AGENT';
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
                  <div className="text-[10px] font-mono text-[var(--color-light-muted)]">
                    <span className={`font-bold ${
                      roleDisplay === 'ADMIN' ? 'text-white' : 
                      roleDisplay === 'AIR OPS' ? 'text-[var(--color-error)]' : 
                      roleDisplay === 'VJ POS' ? 'text-[var(--color-accent-cobalt)]' : 
                      'text-[var(--color-accent-amber)]'
                    }`}>{roleDisplay}</span> &middot; {demoEmail} &middot; {user.password}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
