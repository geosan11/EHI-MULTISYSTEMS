import { useState, useEffect } from 'react';

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
  const setTerminal = (t: Terminal) => { if (!forceValue) setTerminalState(t); };
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
