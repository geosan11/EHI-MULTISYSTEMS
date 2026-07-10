import React, { useState } from 'react';
import ehiLogo from '../assets/branding/ehi-logo.png';
import { supabase } from '../lib/supabase';

// Shown when Supabase fires a PASSWORD_RECOVERY auth event -- i.e. the user
// clicked the "reset your password" link from their email. Previously
// nothing handled this event at all: the recovery session was established
// correctly in the background, but the app just fell through to the
// normal login screen with no way to actually set a new password. The old
// password kept working, which made the whole "reset" flow look like it
// silently did nothing.
export const ResetPasswordScreen = ({ onDone }: { onDone: () => void }) => {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(updateError.message || 'Could not update password. Try again.');
      } else {
        setDone(true);
      }
    } catch {
      setError('Network error. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-[var(--color-obsidian)] relative flex flex-col items-center justify-center p-8 overflow-hidden" style={{ minHeight: '100dvh' }}>
      <div className="absolute w-[500px] h-[500px] rounded-full pointer-events-none filter blur-[100px]" style={{ background: 'radial-gradient(circle, rgba(245,158,11,0.12) 0%, transparent 65%)', top: '-10%', left: '-10%' }} />
      <div className="absolute w-[500px] h-[500px] rounded-full pointer-events-none filter blur-[100px]" style={{ background: 'radial-gradient(circle, rgba(59,130,246,0.09) 0%, transparent 65%)', bottom: '-10%', right: '-10%' }} />

      <div className="w-full max-w-[380px] flex flex-col items-center z-10">
        <div className="mb-8">
          <img src={ehiLogo} alt="EHI Multisystems" style={{ width: 160, height: 'auto', objectFit: 'contain' }} />
        </div>

        <div className="w-full bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-6">
          {done ? (
            <div className="text-center">
              <div className="text-[15px] font-sans font-bold text-[var(--color-foreground)] mb-2">
                Password updated
              </div>
              <div className="text-[13px] text-[var(--color-muted)] mb-5">
                Your password has been changed. Continue to the app.
              </div>
              <button
                onClick={onDone}
                className="w-full h-12 bg-[var(--color-accent-amber)] text-[#111827] font-sans font-bold rounded-[var(--radius-sm)] cursor-pointer"
              >
                Continue
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <div className="text-[15px] font-sans font-bold text-[var(--color-foreground)] mb-1">
                Set a new password
              </div>
              <div className="text-[13px] text-[var(--color-muted)] mb-5">
                Choose a new password for your account.
              </div>

              <label htmlFor="reset-new-password" className="text-[12px] font-sans font-semibold text-[var(--color-light-muted)]">
                New password
              </label>
              <input
                id="reset-new-password"
                name="new-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                autoFocus
                className="w-full h-12 px-4 mt-1.5 mb-4 text-[16px] rounded-[var(--radius-sm)] bg-[var(--color-input-bg)] text-[var(--color-input-text)] border border-[var(--color-border)] font-sans focus:outline-none focus:border-[var(--color-accent-amber)]"
              />

              <label htmlFor="reset-confirm-password" className="text-[12px] font-sans font-semibold text-[var(--color-light-muted)]">
                Confirm new password
              </label>
              <input
                id="reset-confirm-password"
                name="confirm-password"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                className="w-full h-12 px-4 mt-1.5 mb-4 text-[16px] rounded-[var(--radius-sm)] bg-[var(--color-input-bg)] text-[var(--color-input-text)] border border-[var(--color-border)] font-sans focus:outline-none focus:border-[var(--color-accent-amber)]"
              />

              {error && (
                <div className="text-[12px] text-[var(--color-error)] mb-4">{error}</div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full h-12 bg-[var(--color-accent-amber)] text-[#111827] font-sans font-bold rounded-[var(--radius-sm)] cursor-pointer disabled:opacity-60"
              >
                {submitting ? 'Updating…' : 'Update Password'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
