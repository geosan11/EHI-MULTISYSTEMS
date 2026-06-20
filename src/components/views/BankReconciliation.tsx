import React, { useState } from 'react';
import { ArrowLeft, Upload, CheckCircle2, AlertCircle, RefreshCw, Layers, DollarSign, FileSpreadsheet } from 'lucide-react';
import { fmt } from '../../lib/helpers';
import { Transaction } from '../../lib/types';

interface BankTx {
  id: string;
  date: string;
  description: string;
  credit: number;
  reference: string;
  matchedId?: string;
  status: 'Unmatched' | 'Auto-Matched' | 'Manual-Matched';
}

export const BankReconciliation = ({ 
  transactions, 
  onBack 
}: { 
  transactions: Transaction[]; 
  onBack: () => void;
}) => {
  const [bankType, setBankType] = useState<'UBA' | 'GTBank' | 'Access'>('UBA');
  const [fileImported, setFileImported] = useState(false);
  const [matchingInProgress, setMatchingInProgress] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  
  // Simulated Imported Bank Sheet Transactions
  const [bankTxList, setBankTxList] = useState<BankTx[]>([
    { id: 'BTX-9901', date: '2026-06-20', description: 'CR/TRF/MADAM UCHECHI/PHC LOGISTICS', credit: 95000, reference: 'REF-009941A3', status: 'Unmatched' },
    { id: 'BTX-9902', date: '2026-06-20', description: 'NIP/TRANSFER/ARAMEX AWB 14153', credit: 845000, reference: 'REF-224151X9', status: 'Unmatched' },
    { id: 'BTX-9903', date: '2026-06-20', description: 'POS/DEBIT/SETTLEMENT/DAILY', credit: 48500, reference: 'REF-884152A1', status: 'Unmatched' },
    { id: 'BTX-9904', date: '2026-06-19', description: 'TRANSFER/SUNBRIDGE LOGISTICS LTD', credit: 40000, reference: 'REF-335193B6', status: 'Unmatched' },
    { id: 'BTX-9905', date: '2026-06-19', description: 'TRF/FASTMOVE CARGO SERVICES', credit: 186000, reference: 'REF-114920B2', status: 'Unmatched' },
    { id: 'BTX-9906', date: '2026-06-19', description: 'SUSPICIOUS TRF/UNREGISTERED CLIENT', credit: 150000, reference: 'REF-559190Z9', status: 'Unmatched' }
  ]);

  // Filter EHI system transfer payments
  const systemPayments = transactions.filter(t => t.mode === 'Transfer').map(t => ({
    id: t.id,
    name: t.name,
    amount: t.amount,
    time: t.time,
    date: '2026-06-20',
    matched: false
  }));

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement> | React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    // Simulate successful parsing of CSV sheet
    setFileImported(true);
  };

  const handleAutoMatch = () => {
    setMatchingInProgress(true);
    setTimeout(() => {
      setBankTxList(prev => prev.map(btx => {
        // Find exact match in EHI transactions
        const systemMatch = systemPayments.find(sp => sp.amount === btx.credit);
        if (systemMatch) {
          return {
            ...btx,
            status: 'Auto-Matched',
            matchedId: systemMatch.id
          };
        }
        return btx;
      }));
      setMatchingInProgress(false);
    }, 1500);
  };

  const handleManualMatch = (btxId: string, sysId: string) => {
    setBankTxList(prev => prev.map(btx => {
      if (btx.id === btxId) {
        return {
          ...btx,
          status: 'Manual-Matched',
          matchedId: sysId
        };
      }
      return btx;
    }));
  };

  const handleResetMatch = (btxId: string) => {
    setBankTxList(prev => prev.map(btx => {
      if (btx.id === btxId) {
        return {
          ...btx,
          status: 'Unmatched',
          matchedId: undefined
        };
      }
      return btx;
    }));
  };

  const unmatchedBtxCount = bankTxList.filter(b => b.status === 'Unmatched').length;
  const matchedBtxCount = bankTxList.filter(b => b.status !== 'Unmatched').length;
  const totalCredits = bankTxList.reduce((sum, b) => sum + b.credit, 0);

  return (
    <div className="flex flex-col h-full bg-[var(--color-obsidian)] p-4 text-white overflow-y-auto pb-[80px]">
      {/* Header back navigation */}
      <div className="flex items-center justify-between border-b border-[rgba(255,255,255,0.07)] pb-2 mb-4">
        <button onClick={onBack} className="flex items-center space-x-1 text-[var(--color-muted)] hover:text-white transition-colors">
          <ArrowLeft size={16} />
          <span className="text-[11px] font-mono">Back</span>
        </button>
        <span className="text-[10px] font-mono text-[var(--color-accent-cobalt)] tracking-widest font-bold">● ENTERPRISE BANK RECONCILIATION</span>
      </div>

      <div className="text-[9px] font-mono text-slate-400 tracking-[0.15em] uppercase mb-4">▸ RECON ENGINE v1.0</div>

      {/* Upload Box */}
      {!fileImported ? (
        <div className="bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.05)] rounded p-5 space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-[11px] font-bold text-white uppercase tracking-wide">Import Bank CSV Statement</span>
            <select 
              value={bankType} 
              onChange={(e) => setBankType(e.target.value as any)}
              className="bg-black/40 border border-[rgba(255,255,255,0.1)] rounded px-2.5 py-1 text-[10px] font-mono focus:outline-none focus:border-[var(--color-accent-cobalt)]"
            >
              <option value="UBA">UBA Statement format</option>
              <option value="GTBank">GTBank Statement format</option>
              <option value="Access">Access Bank format</option>
            </select>
          </div>

          <div 
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleFileUpload}
            className={`border-2 border-dashed rounded-xl p-8 py-10 text-center flex flex-col items-center justify-center space-y-3 transition-colors ${
              dragOver ? 'border-[var(--color-accent-cobalt)] bg-blue-500/5' : 'border-[rgba(255,255,255,0.1)] bg-black/10'
            }`}
          >
            <Upload size={32} className={`${dragOver ? 'text-[var(--color-accent-cobalt)]' : 'text-[var(--color-muted)]'} animate-pulse`} />
            <div className="space-y-1">
              <span className="text-[12px] font-bold text-white block">Drag and drop bank statement</span>
              <span className="text-[9px] text-[var(--color-muted)] font-mono block">Supports .CSV and .TXT statement exports</span>
            </div>
            <div className="relative">
              <input 
                type="file" 
                accept=".csv,.txt"
                onChange={handleFileUpload}
                className="absolute inset-0 opacity-0 w-full cursor-pointer h-full"
              />
              <button className="bg-[var(--color-accent-cobalt)] hover:bg-blue-600 text-white font-mono text-[10px] uppercase font-bold px-4 py-2 rounded-lg pointer-events-none">
                Select File
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Reconcile Metrics summary cards */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.05)] p-3 rounded">
              <span className="text-[8px] font-mono text-[var(--color-muted)] uppercase tracking-wide block">Statement Credits</span>
              <span className="text-[14px] font-bold font-mono text-white mt-1 block">{fmt(totalCredits)}</span>
              <span className="text-[8px] font-mono text-slate-500 block">6 transactions loaded</span>
            </div>
            
            <div className="bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.05)] p-3 rounded">
              <span className="text-[8px] font-mono text-[var(--color-muted)] uppercase tracking-wide block">Matched Deposits</span>
              <span className="text-[14px] font-bold font-mono text-[var(--color-success)] mt-1 block">
                {fmt(bankTxList.filter(b => b.status !== 'Unmatched').reduce((sum, b) => sum + b.credit, 0))}
              </span>
              <span className="text-[8px] font-mono text-[var(--color-success)] block">{matchedBtxCount} records paired</span>
            </div>

            <div className="bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.05)] p-3 rounded">
              <span className="text-[8px] font-mono text-[var(--color-muted)] uppercase tracking-wide block">Unresolved</span>
              <span className="text-[14px] font-bold font-mono text-[var(--color-error)] mt-1 block">
                {fmt(bankTxList.filter(b => b.status === 'Unmatched').reduce((sum, b) => sum + b.credit, 0))}
              </span>
              <span className="text-[8px] font-mono text-[var(--color-error)] block">{unmatchedBtxCount} unmatched left</span>
            </div>
          </div>

          {/* Engine trigger bar */}
          <div className="bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.05)] rounded p-4 flex flex-col sm:flex-row justify-between items-center gap-3">
            <div className="flex items-center space-x-2">
              <FileSpreadsheet size={16} className="text-[var(--color-accent-cobalt)]" />
              <div>
                <span className="text-[11px] font-bold text-white block">UBA_statement_2026_06_20.csv</span>
                <span className="text-[8px] font-mono text-[var(--color-muted)] uppercase block">Bank: United Bank for Africa (UBA) · Status: Matched {matchedBtxCount}/6</span>
              </div>
            </div>

            <div className="flex space-x-2">
              <button 
                onClick={handleAutoMatch}
                disabled={matchingInProgress}
                className="bg-[var(--color-accent-cobalt)] hover:bg-blue-600 disabled:opacity-60 text-white font-mono text-[10px] uppercase font-bold px-3.5 py-2 rounded flex items-center space-x-1.5 cursor-pointer"
              >
                <Layers size={12} className={matchingInProgress ? 'animate-spin' : ''} />
                <span>{matchingInProgress ? 'Matching...' : 'Auto-Match Engine'}</span>
              </button>
              
              <button 
                onClick={() => setFileImported(false)}
                className="bg-neutral-800 hover:bg-neutral-700 text-slate-300 font-mono text-[10px] uppercase font-bold px-3 py-2 rounded cursor-pointer"
              >
                Reset Sheet
              </button>
            </div>
          </div>

          {/* Reconciliation table split layout */}
          <div className="bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.05)] rounded overflow-hidden">
            <div className="p-3 border-b border-[rgba(255,255,255,0.05)] bg-[rgba(255,255,255,0.02)] flex justify-between items-center">
              <span className="text-[10px] font-mono font-bold text-white uppercase tracking-wider">Statement Ledger vs. System Log</span>
              <span className="text-[8.5px] text-[var(--color-muted)] font-mono uppercase">Interactive Drag and Drop / One-Click Pair</span>
            </div>

            <div className="divide-y divide-[rgba(255,255,255,0.05)]">
              {bankTxList.map((btx) => {
                const correspondingSysPayment = btx.matchedId ? systemPayments.find(sp => sp.id === btx.matchedId) : null;
                return (
                  <div key={btx.id} className="p-3.5 grid grid-cols-1 md:grid-cols-12 gap-3 items-center hover:bg-black/10">
                    {/* Bank Tx Info */}
                    <div className="md:col-span-5 space-y-1">
                      <div className="flex items-center space-x-1.5">
                        <span className="text-[8px] font-mono text-[var(--color-muted)]">{btx.date}</span>
                        <span className="text-[8px] font-mono bg-blue-500/10 text-[var(--color-accent-cobalt)] px-1 rounded uppercase tracking-widest">{btx.id}</span>
                      </div>
                      <span className="text-[11px] font-semibold text-white block truncate">{btx.description}</span>
                      <span className="text-[9px] font-mono text-slate-500 block truncate">REF: {btx.reference}</span>
                    </div>

                    {/* Stream Amount Direction */}
                    <div className="md:col-span-2 flex flex-col md:items-center">
                      <span className="text-[12px] font-bold font-mono text-[var(--color-success)]">{fmt(btx.credit)}</span>
                      <span className="text-[8px] font-mono text-slate-500 uppercase tracking-widest block">Credit Deposit</span>
                    </div>

                    {/* Reconciliation Action / State */}
                    <div className="md:col-span-5 flex items-center justify-between md:justify-end space-x-3 bg-black/20 p-2 md:p-0 md:bg-transparent rounded">
                      {btx.status === 'Unmatched' ? (
                        <>
                          <div className="text-left md:text-right">
                            <span className="text-[9px] text-[var(--color-error)] uppercase font-mono block">● Unresolved</span>
                            <span className="text-[8px] text-[var(--color-muted)] font-mono block">No system receipt locked</span>
                          </div>
                          
                          {/* Fast Matching Suggestions */}
                          <div className="flex space-x-1.5">
                            {systemPayments.filter(sp => sp.amount === btx.credit).map((sp) => (
                              <button
                                key={sp.id}
                                onClick={() => handleManualMatch(btx.id, sp.id)}
                                className="bg-[rgba(16,185,129,0.1)] hover:bg-[rgba(16,185,129,0.2)] border border-[rgba(16,185,129,0.3)] text-[var(--color-success)] text-[9px] font-mono font-bold px-2 py-1 rounded cursor-pointer"
                                title="Pair with this matching system ledger"
                              >
                                Pair ({sp.id.slice(0,6).toUpperCase()})
                              </button>
                            ))}
                            {systemPayments.filter(sp => sp.amount === btx.credit).length === 0 && (
                              <span className="text-[9.5px] italic text-[var(--color-muted)]">No corresponding entries found</span>
                            )}
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="text-left md:text-right mr-2">
                            <div className="flex items-center md:justify-end space-x-1">
                              <CheckCircle2 size={11} className="text-[var(--color-success)]" />
                              <span className="text-[9.5px] text-[var(--color-success)] uppercase font-bold font-mono">
                                {btx.status === 'Auto-Matched' ? 'Auto Mapped' : 'Manually Paired'}
                              </span>
                            </div>
                            <span className="text-[8.5px] text-slate-400 font-mono block truncate max-w-[150px]">
                              System Ledger: {correspondingSysPayment ? correspondingSysPayment.name : btx.matchedId?.toUpperCase() || ''}
                            </span>
                          </div>
                          <button 
                            onClick={() => handleResetMatch(btx.id)}
                            className="bg-neutral-800 hover:bg-neutral-700 text-slate-400 hover:text-white px-2 py-1 rounded text-[8.5px] font-mono uppercase cursor-pointer"
                          >
                            Unlink
                          </button>
                        </>
                      )}
                    </div>

                  </div>
                );
              })}
            </div>

            {/* Reconciliation Confirmation footer */}
            <div className="p-4 border-t border-[rgba(255,255,255,0.05)] bg-[rgba(255,255,255,0.02)] flex justify-between items-center flex-col sm:flex-row gap-3">
              <div className="flex items-center space-x-2">
                <AlertCircle size={14} className="text-[var(--color-accent-cobalt)]" />
                <span className="text-[10px] font-sans text-slate-400">Reconciliation locks automated ledger accounting updates.</span>
              </div>
              <button 
                onClick={() => {
                  alert('Bank Reconciliation confirmed successfully! Reports generated and accounts synced to Central ERP.');
                  onBack();
                }}
                disabled={matchedBtxCount === 0}
                className="bg-[var(--color-success)] hover:bg-emerald-600 disabled:opacity-50 text-[var(--color-obsidian)] font-mono text-[11px] uppercase font-black px-4 py-2.5 rounded-lg transition-colors cursor-pointer"
              >
                Confirm & Lock Reconciliation
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};
