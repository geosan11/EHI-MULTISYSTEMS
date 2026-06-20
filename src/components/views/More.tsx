import { AccountingConsole } from './AccountingConsole';
import { useState } from 'react';
import { User, Transaction } from '../../lib/types';
import { fmt } from '../../lib/helpers';
import { FileText, Activity, Database, Shield, Settings, LogOut, ArrowLeft } from 'lucide-react';

export const More = ({ user, transactions, onLogout, onEOD, onAddTx }: { user: User; transactions: Transaction[]; onLogout: () => void; onEOD: () => void; onAddTx: (tx: Transaction) => void }) => {
  const [eodView, setEodView] = useState(false);
  const [accountingView, setAccountingView] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  const handleLockEOD = () => {
    setIsGenerating(true);
    setTimeout(() => {
      setIsGenerating(false);
      setEodView(false);
      onEOD();
    }, 2500);
  };

  if (accountingView) {
    return <AccountingConsole user={user} transactions={transactions} onBack={() => setAccountingView(false)} />;
  }

  if (eodView) {
    const cargoTx = transactions.filter(t => t.type === 'cargo');
    const mktgTx = transactions.filter(t => t.type === 'marketing');
    const vjTx = transactions.filter(t => t.type === 'baggage');

    const cargoTotal = cargoTx.reduce((sum, t) => sum + t.amount, 0);
    const mktgTotal = mktgTx.reduce((sum, t) => sum + t.amount, 0);
    const vjTotal = vjTx.reduce((sum, t) => sum + t.amount, 0);
    const gt = cargoTotal + mktgTotal + vjTotal;

    const cashTotal = transactions.reduce((sum, t) => sum + (t.mode === 'Cash' ? t.amount : 0), 0);
    const transferTotal = transactions.reduce((sum, t) => sum + (t.mode === 'Transfer' || t.mode === 'Transfer-as-Cash' ? t.amount : 0), 0);

    return (
      <div className="flex flex-col h-full bg-[var(--color-obsidian)] p-4 relative text-white animate-in slide-in-from-right overflow-y-auto pb-[60px]">
        <button onClick={() => setEodView(false)} className="flex items-center space-x-2 text-[var(--color-light-muted)] mb-4 w-max p-2 -ml-2 rounded hover:bg-[var(--color-surface-2)]">
          <ArrowLeft size={16} />
          <span className="text-[11px] font-mono">Back</span>
        </button>

        <div className="text-[9px] font-mono text-[var(--color-accent-amber)] tracking-[0.1em] uppercase mb-4">▸ EOD DAILY CLOSE</div>
        <div className="text-[12px] font-mono text-white mb-6 bg-[rgba(255,255,255,0.05)] px-3 py-2 rounded max-w-max border border-[rgba(255,255,255,0.1)]">
          {new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' })}
        </div>
        
        <div className="bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.07)] rounded overflow-hidden flex flex-col mb-8">
          <div className="p-4 border-b border-[rgba(255,255,255,0.07)] flex justify-between items-center bg-[rgba(245,158,11,0.05)]">
            <span className="text-[11px] font-mono text-[var(--color-muted)]">Cargo Station</span>
            <span className="text-[14px] font-bold font-mono text-[var(--color-accent-amber)]">{fmt(cargoTotal)}</span>
          </div>
          <div className="p-4 border-b border-[rgba(255,255,255,0.07)] flex justify-between items-center bg-[rgba(16,185,129,0.05)]">
            <span className="text-[11px] font-mono text-[var(--color-muted)]">Field Marketing</span>
            <span className="text-[14px] font-bold font-mono text-[var(--color-success)]">{fmt(mktgTotal)}</span>
          </div>
          <div className="p-4 border-b border-[rgba(255,255,255,0.07)] flex justify-between items-center bg-[rgba(59,130,246,0.05)]">
            <span className="text-[11px] font-mono text-[var(--color-muted)]">ValueJet Baggage</span>
            <span className="text-[14px] font-bold font-mono text-[var(--color-accent-cobalt)]">{fmt(vjTotal)}</span>
          </div>
          <div className="p-4 border-b border-[rgba(255,255,255,0.07)] flex justify-between items-center bg-[rgba(16,185,129,0.05)]">
            <span className="text-[11px] font-bold font-mono text-white">Grand Total</span>
            <span className="text-[16px] font-bold font-mono text-[var(--color-success)]">{fmt(gt)}</span>
          </div>
          <div className="p-4 flex flex-col space-y-2 bg-[var(--color-surface-1)]">
            <div className="flex justify-between items-center">
              <span className="text-[10px] font-mono text-[var(--color-muted)]">Cash</span>
              <span className="text-[12px] font-mono text-white">{fmt(cashTotal)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-[10px] font-mono text-[var(--color-muted)]">Transfer</span>
              <span className="text-[12px] font-mono text-white">{fmt(transferTotal)}</span>
            </div>
          </div>
          <div className="p-3 border-t border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)] flex justify-between items-center">
            <span className="text-[10px] font-mono text-[var(--color-muted)]">Total Transactions</span>
            <span className="text-[11px] font-bold font-mono text-white">{transactions.length}</span>
          </div>
        </div>

        <button 
          onClick={handleLockEOD}
          disabled={isGenerating}
          className="w-full py-[14px] bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] text-[13px] font-bold font-mono rounded disabled:opacity-70 disabled:cursor-not-allowed transition-opacity"
        >
          {isGenerating ? 'GENERATING…' : 'LOCK EOD + SEND REPORT'}
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3 pb-8">
      <button 
        onClick={() => setEodView(true)}
        className="w-full bg-[var(--color-surface-1)] hover:bg-[var(--color-surface-2)] transition-colors border border-[rgba(245,158,11,0.2)] rounded p-4 flex items-center justify-between"
      >
        <div className="flex items-center space-x-3">
          <FileText size={18} className="text-[var(--color-accent-amber)]" />
          <div className="text-left">
            <div className="text-[13px] font-bold font-sans text-white">EOD Daily Close</div>
            <div className="text-[10px] font-mono text-[var(--color-muted)]">Generate and dispatch end of day reports</div>
          </div>
        </div>
      </button>

      <button className="w-full bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.07)] rounded p-4 flex items-center justify-between opacity-80 cursor-default">
        <div className="flex items-center space-x-3">
          <Activity size={18} className="text-[var(--color-accent-cobalt)]" />
          <div className="text-left">
            <div className="text-[13px] font-bold font-sans text-white">Tracking History</div>
            <div className="text-[10px] font-mono text-[var(--color-muted)]">{transactions.length} total records logged</div>
          </div>
        </div>
      </button>

      <button 
        onClick={() => {
          if (user.role === 'admin' || user.role === 'super_admin' || user.role === 'accountant') {
            setAccountingView(true);
          }
        }}
        className={`w-full bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.07)] rounded p-4 flex items-center justify-between transition-colors ${(user.role === 'admin' || user.role === 'super_admin' || user.role === 'accountant') ? 'hover:border-[var(--color-success)] hover:bg-[var(--color-surface-2)] cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}
      >
        <div className="flex items-center space-x-3">
          <Database size={18} className="text-[var(--color-success)]" />
          <div className="text-left">
            <div className="text-[13px] font-bold font-sans text-white">Accounting</div>
            <div className="text-[10px] font-mono text-[var(--color-muted)]">Sync with central ERP</div>
          </div>
        </div>
      </button>

      <div className="w-full bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.07)] rounded p-4 flex items-center justify-between opacity-50 cursor-not-allowed">
        <div className="flex items-center space-x-3">
          <Shield size={18} className="text-[var(--color-muted)]" />
          <div className="text-left">
            <div className="text-[13px] font-bold font-sans text-white">Access Control</div>
            <div className="text-[10px] font-mono text-[var(--color-muted)]">Manage station users</div>
          </div>
        </div>
        <div className="px-2 py-0.5 bg-[rgba(255,255,255,0.1)] rounded text-[8px] font-mono text-white">SOON</div>
      </div>

      <div className="w-full bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.07)] rounded p-4 flex items-center justify-between opacity-50 cursor-not-allowed">
        <div className="flex items-center space-x-3">
          <Settings size={18} className="text-[var(--color-muted)]" />
          <div className="text-left">
            <div className="text-[13px] font-bold font-sans text-white">Settings</div>
            <div className="text-[10px] font-mono text-[var(--color-muted)]">Platform configuration</div>
          </div>
        </div>
        <div className="px-2 py-0.5 bg-[rgba(255,255,255,0.1)] rounded text-[8px] font-mono text-white">SOON</div>
      </div>

      <button 
        onClick={() => {
          if (confirm('Sign out of EHI Multisystems?')) {
            onLogout();
          }
        }}
        className="w-full mt-4 bg-[var(--color-surface-1)] hover:bg-[rgba(239,68,68,0.1)] transition-colors border border-[rgba(255,255,255,0.07)] hover:border-[rgba(239,68,68,0.3)] rounded p-4 flex items-center space-x-3"
      >
        <LogOut size={18} className="text-[var(--color-error)]" />
        <div className="text-left">
          <div className="text-[13px] font-bold font-sans text-[var(--color-error)]">Sign Out</div>
          <div className="text-[10px] font-mono text-[var(--color-error)] opacity-80">{user.name} &middot; {user.hub}</div>
        </div>
      </button>

    </div>
  );
};
