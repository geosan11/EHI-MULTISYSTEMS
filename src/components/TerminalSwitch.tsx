import { useState, useEffect } from 'react';
import { useToast } from '../lib/ToastContext';

export type Terminal = 'MMA2' | 'GAT';
const KEY = 'ehi_active_terminal';

// Persisted per device (not per user/session) -- a GAT agent sets it once
// per shift rather than flipping it on every single entry.
//
// forceValue lets a caller (the dedicated GAT workspace) pin the terminal
// without reading or writing localStorage -- GAT-tab sales always tag GAT
// regardless of what this device's persisted setting says, and leave that
// setting untouched for when the user goes back to a normal Cargo tab.
export function usePersistedTerminal(forceValue?: Terminal): [Terminal, (t: Terminal) => void] {
  const { showToast } = useToast();
  const [terminal, setTerminalState] = useState<Terminal>(() => {
    if (forceValue) return forceValue;
    const v = localStorage.getItem(KEY);
    return v === 'GAT' ? 'GAT' : 'MMA2';
  });
  useEffect(() => {
    if (forceValue) setTerminalState(forceValue);
  }, [forceValue]);
  useEffect(() => {
    if (forceValue) return;
    try { localStorage.setItem(KEY, terminal); } catch { /* ignore */ }
  }, [terminal, forceValue]);
  // Explicit confirmation on every real toggle -- this setting is easy to
  // miss (a small segmented control amid other form fields) and silently
  // submitting under the wrong terminal means an entry never shows up in
  // the GAT print queue at all. No-ops (re-clicking the already-active
  // option) don't re-toast.
  const setTerminal = (t: Terminal) => {
    if (forceValue) return;
    setTerminalState(prev => {
      if (prev !== t) showToast({ message: `Switched to ${t}`, type: 'info' });
      return t;
    });
  };
  return [terminal, setTerminal];
}

// Compact MMA2/GAT segmented control, mirroring the Retail/Office pill style.
export const TerminalSwitch = ({ value, onChange }: { value: Terminal; onChange: (t: Terminal) => void }) => (
  <div className="flex p-1 bg-[var(--color-surface-2)] rounded-lg border border-[var(--color-border)]">
    {(['MMA2', 'GAT'] as const).map(t => (
      <button
        key={t} type="button" onClick={() => onChange(t)}
        className={`px-3 h-8 text-[11px] font-bold font-mono rounded-md transition-all cursor-pointer ${
          value === t
            ? t === 'GAT'
              ? 'bg-[var(--color-accent-cobalt)] text-white shadow-md'
              : 'bg-[var(--color-accent-amber)] text-[#030712] shadow-md'
            : 'text-[var(--color-light-muted)] hover:text-[var(--color-foreground)]'
        }`}
      >{t}</button>
    ))}
  </div>
);
