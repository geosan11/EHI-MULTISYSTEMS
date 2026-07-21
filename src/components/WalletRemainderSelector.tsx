import { fmt } from '../lib/helpers';

// Shown only when a wallet is selected but its balance is LESS than the amount
// due. Lets staff pick how the leftover is collected. Controlled by the parent.
export const WalletRemainderSelector = ({
  walletName, coverage, remainder, mode, bank, onModeChange, onBankChange, banks = [],
}: {
  walletName: string;
  coverage: number;
  remainder: number;
  mode: 'Cash' | 'Transfer' | 'POS';
  bank: string;
  onModeChange: (m: 'Cash' | 'Transfer' | 'POS') => void;
  onBankChange: (b: string) => void;
  banks?: string[];
}) => (
  <div className="mt-2 p-3 rounded-xl border border-[var(--color-accent-amber)] bg-[rgba(245,158,11,0.06)] space-y-2">
    <div className="text-[11px] font-mono text-[var(--color-foreground)]">
      {walletName}'s wallet covers <span className="font-bold text-[var(--color-success)]">₦{fmt(coverage)}</span>.
      Collect the remaining <span className="font-bold text-[var(--color-accent-amber)]">₦{fmt(remainder)}</span> by:
    </div>
    <div className="flex gap-1.5">
      {(['Cash', 'Transfer', 'POS'] as const).map(m => (
        <button
          key={m} type="button" onClick={() => onModeChange(m)}
          className={`flex-1 h-9 rounded-lg text-[11px] font-bold font-mono transition-colors ${mode === m ? 'bg-[var(--color-accent-amber)] text-[var(--color-obsidian)]' : 'bg-[var(--color-surface-2)] text-[var(--color-muted)] border border-[var(--color-border)]'}`}
        >{m}</button>
      ))}
    </div>
    {(mode === 'Transfer' || mode === 'POS') && (
      banks.length > 0 ? (
        <select value={bank} onChange={e => onBankChange(e.target.value)}
          className="w-full h-9 px-2 text-[12px] font-mono rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-foreground)]">
          <option value="">Select bank…</option>
          {banks.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
      ) : (
        <input value={bank} onChange={e => onBankChange(e.target.value)} placeholder="Bank / POS terminal"
          className="w-full h-9 px-2 text-[12px] font-mono rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-foreground)]" />
      )
    )}
  </div>
);
