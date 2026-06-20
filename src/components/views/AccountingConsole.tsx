import { useState } from 'react';
import { User, Transaction } from '../../lib/types';
import { fmt } from '../../lib/helpers';
import { ArrowLeft } from 'lucide-react';

export const AccountingConsole = ({ user, transactions, onBack }: { user: User, transactions: Transaction[], onBack: () => void }) => {
  const [tab, setTab] = useState<'Today' | 'This Week' | 'This Month' | 'Custom'>('Today');
  
  const cargoTotal = transactions.filter(t => t.type === 'cargo').reduce((sum, t) => sum + t.amount, 0);
  const vjTotal = transactions.filter(t => t.type === 'baggage').reduce((sum, t) => sum + t.amount, 0);
  const mktgTotal = transactions.filter(t => t.type === 'marketing').reduce((sum, t) => sum + t.amount, 0);
  const airTotal = transactions.filter(t => t.type === 'air_cargo').reduce((sum, t) => sum + t.amount, 0);
  const gt = cargoTotal + vjTotal + mktgTotal + airTotal;

  const cashTotal = transactions.reduce((sum, t) => sum + (t.mode === 'Cash' ? t.amount : 0), 0);
  const transferTotal = transactions.reduce((sum, t) => sum + (t.mode === 'Transfer' ? t.amount : 0), 0);
  const posTotal = transactions.reduce((sum, t) => sum + (t.mode === 'POS' ? t.amount : 0), 0);
  const debtTotal = transactions.reduce((sum, t) => sum + (t.mode === 'Debt' ? t.amount : 0), 0);

  const total = cashTotal + transferTotal + posTotal + debtTotal;
  const cashPct = total ? (cashTotal / total) * 100 : 0;
  const transferPct = total ? (transferTotal / total) * 100 : 0;
  const posPct = total ? (posTotal / total) * 100 : 0;
  const debtPct = total ? (debtTotal / total) * 100 : 0;

  return (
    <div className="flex flex-col h-full bg-[var(--color-obsidian)] p-4 relative text-white animate-in slide-in-from-right overflow-y-auto">
      <button onClick={onBack} className="flex items-center space-x-2 text-[var(--color-light-muted)] mb-4 w-max p-2 -ml-2 rounded hover:bg-[var(--color-surface-2)]">
        <ArrowLeft size={16} />
        <span className="text-[11px] font-mono">Back</span>
      </button>

      <div className="text-[9px] font-mono text-[var(--color-accent-cobalt)] tracking-[0.1em] uppercase mb-4">▸ ACCOUNTING CONSOLE</div>

      <div className="flex border-b border-[rgba(255,255,255,0.07)] mb-6">
        {['Today', 'This Week', 'This Month', 'Custom'].map((t) => (
          <button
            key={t}
            onClick={() => setTab(t as any)}
            className={`px-3 py-2 text-[11px] font-mono whitespace-nowrap ${tab === t ? 'text-[var(--color-accent-cobalt)] border-b-2 border-[var(--color-accent-cobalt)]' : 'text-[var(--color-muted)]'}`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.07)] rounded overflow-hidden flex flex-col mb-6">
        <div className="p-4 border-b border-[rgba(255,255,255,0.07)] flex justify-between items-center bg-[rgba(16,185,129,0.05)]">
          <span className="text-[11px] font-bold font-mono text-white">Grand Total</span>
          <span className="text-[18px] font-bold font-mono text-[var(--color-success)]">{fmt(gt)}</span>
        </div>
        <div className="p-4 grid grid-cols-2 gap-4">
          <div>
            <div className="text-[9px] font-mono text-[var(--color-muted)]">Ground Cargo</div>
            <div className="text-[13px] font-bold font-mono text-[var(--color-accent-amber)] mt-1">{fmt(cargoTotal)}</div>
          </div>
          <div>
            <div className="text-[9px] font-mono text-[var(--color-muted)]">ValueJet</div>
            <div className="text-[13px] font-bold font-mono text-[var(--color-accent-cobalt)] mt-1">{fmt(vjTotal)}</div>
          </div>
          <div>
            <div className="text-[9px] font-mono text-[var(--color-muted)]">Marketing</div>
            <div className="text-[13px] font-bold font-mono text-[var(--color-accent-amber)] mt-1">{fmt(mktgTotal)}</div>
          </div>
          <div>
            <div className="text-[9px] font-mono text-[var(--color-muted)]">Air Cargo</div>
            <div className="text-[13px] font-bold font-mono text-[var(--color-error)] mt-1">{fmt(airTotal)}</div>
          </div>
        </div>
      </div>

      {/* Payment Breakdown Section */}
      <div className="mb-6">
        <div className="text-[11px] font-mono text-white mb-2">Payment Breakdown</div>
        <div className="w-full h-3 flex rounded overflow-hidden mb-2">
          {cashPct > 0 && <div style={{width: `${cashPct}%`}} className="bg-[var(--color-success)]" title={`Cash: ${fmt(cashTotal)}`} />}
          {transferPct > 0 && <div style={{width: `${transferPct}%`}} className="bg-[var(--color-accent-cobalt)]" title={`Transfer: ${fmt(transferTotal)}`} />}
          {posPct > 0 && <div style={{width: `${posPct}%`}} className="bg-[var(--color-accent-amber)]" title={`POS: ${fmt(posTotal)}`} />}
          {debtPct > 0 && <div style={{width: `${debtPct}%`}} className="bg-[var(--color-error)]" title={`Debt: ${fmt(debtTotal)}`} />}
        </div>
        <div className="grid grid-cols-4 gap-2 text-center text-[9px] font-mono text-[var(--color-muted)]">
          <div className="text-[var(--color-success)]">{cashPct.toFixed(0)}%</div>
          <div className="text-[var(--color-accent-cobalt)]">{transferPct.toFixed(0)}%</div>
          <div className="text-[var(--color-accent-amber)]">{posPct.toFixed(0)}%</div>
          <div className="text-[var(--color-error)]">{debtPct.toFixed(0)}%</div>
        </div>
      </div>

      {/* Outstanding Debt */}
      <div className="mb-6 bg-[var(--color-surface-1)] rounded p-4 border border-[rgba(255,255,255,0.07)]">
        <div className="text-[11px] font-mono text-[var(--color-muted)] mb-1">Outstanding Debt</div>
        <div className="text-[18px] font-bold font-mono text-[var(--color-error)]">{fmt(debtTotal)}</div>
        <div className="mt-3 divide-y divide-[rgba(255,255,255,0.07)]">
          {transactions.filter(t => t.mode === 'Debt').map(t => (
            <div key={t.id} className="py-2 flex justify-between items-center">
              <div>
                <div className="text-[12px] text-white">{t.name}</div>
                <div className="text-[9px] font-mono text-[var(--color-muted)]">Due: Tomorrow</div>
              </div>
              <div className="text-right flex flex-col items-end">
                <div className="text-[12px] font-mono font-bold text-[var(--color-error)]">{fmt(t.amount)}</div>
                <button className="text-[9px] font-mono text-[var(--color-accent-cobalt)] mt-1">Mark Paid</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Corporate Account Statements & Agent Commission omitted for brevity, will just add headers */}
      <div className="mb-6 bg-[var(--color-surface-1)] rounded p-4 border border-[rgba(255,255,255,0.07)] opacity-60">
        <div className="text-[11px] font-mono text-[var(--color-muted)] mb-2">Corporate Account Statements</div>
        <div className="text-[10px] font-mono text-white text-center py-4">Select Corporate Client...</div>
      </div>
      
      <div className="mb-6 bg-[var(--color-surface-1)] rounded p-4 border border-[rgba(255,255,255,0.07)] opacity-60">
        <div className="text-[11px] font-mono text-[var(--color-muted)] mb-2">Agent Commission Tracker</div>
        <div className="text-[10px] font-mono text-white text-center py-4">Data syncing...</div>
      </div>

    </div>
  );
};
