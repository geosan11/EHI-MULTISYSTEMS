import { useState, useMemo } from 'react';
import { Transaction, User, Expense } from '../../lib/types';
import { fmt } from '../../lib/helpers';
import { ArrowLeft, Edit2, X, Check, Filter, Search } from 'lucide-react';

type Entry = {
  id: string;
  time: string;
  type: string;
  name: string;
  detail: string;
  amount: number;
  mode: string;
  status: string;
  source: 'transaction' | 'expense';
  raw: any;
};

export const TransactionLedger = ({ 
  user, 
  transactions, 
  expenses = [],
  onBack, 
  onUpdateTx 
}: { 
  user: User; 
  transactions: Transaction[]; 
  expenses?: Expense[];
  onBack: () => void; 
  onUpdateTx: (tx: Transaction) => void; 
}) => {
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('All');
  const [modeFilter, setModeFilter] = useState('All');

  const entries = useMemo(() => {
    const list: Entry[] = [
      ...transactions.map(t => ({ ...t, source: 'transaction' as const, raw: t })),
      ...expenses.map(e => ({
        id: e.id,
        time: e.time,
        type: 'expense',
        name: e.type,
        detail: e.description,
        amount: e.amount,
        mode: 'Expense',
        status: 'N/A',
        source: 'expense' as const,
        raw: e
      }))
    ];
    return list.sort((a, b) => {
      // Sort by time descending (this assumes time format HH:MM which sorts lexically)
      // Since there's no full date, sorting string time is simple enough
      if (a.time > b.time) return -1;
      if (a.time < b.time) return 1;
      return 0;
    });
  }, [transactions, expenses]);

  const filteredEntries = entries.filter(e => {
    if (typeFilter !== 'All' && e.type !== typeFilter.toLowerCase()) return false;
    
    if (modeFilter !== 'All') {
      if (modeFilter === 'Revenue') {
        if (e.source === 'expense' || e.mode === 'Debt') return false;
      } else {
        if (e.mode.toLowerCase() !== modeFilter.toLowerCase()) return false;
      }
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const text = `${e.id} ${e.time} ${e.type} ${e.name} ${e.detail} ${e.mode}`.toLowerCase();
      if (!text.includes(q)) return false;
    }

    return true;
  });

  const handleEditClick = (e: Entry) => {
    if (e.source === 'transaction') {
      setEditingTx({ ...e.raw });
    }
  };

  const handleSaveEdit = () => {
    if (editingTx) {
      onUpdateTx(editingTx);
      setEditingTx(null);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[var(--color-obsidian)] text-[var(--color-foreground)] relative animate-in slide-in-from-right overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-[var(--color-border)] flex items-center justify-between shrink-0">
        <button onClick={onBack} className="flex items-center space-x-1 text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors cursor-pointer border-none bg-transparent">
          <ArrowLeft size={16} />
          <span className="text-[11px] font-mono">Back</span>
        </button>
        <span className="text-[10px] font-mono text-[var(--color-accent-amber)] tracking-widest font-bold">● MASTER LEDGER</span>
      </div>

      {/* Filters */}
      <div className="p-4 border-b border-[var(--color-border)] flex flex-col md:flex-row gap-3">
        <div className="flex-1 relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)]" />
          <input 
            type="text" 
            placeholder="Search entries, dates, amounts..." 
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full h-10 pl-9 pr-3 bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-lg text-[12px] font-sans text-white focus:outline-none focus:border-[var(--color-accent-blue)]"
          />
        </div>
        
        <div className="flex gap-3">
          <div className="flex items-center bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-lg overflow-hidden h-10 px-2 font-mono text-[11px]">
            <Filter size={12} className="text-[var(--color-muted)] mx-2" />
            <select 
              value={typeFilter} 
              onChange={e => setTypeFilter(e.target.value)}
              className="bg-transparent text-white border-none focus:outline-none cursor-pointer h-full"
            >
              <option value="All">All Types</option>
              <option value="Cargo">Cargo</option>
              <option value="Baggage">Baggage</option>
              <option value="Marketing">Marketing</option>
              <option value="Expense">Expense</option>
            </select>
          </div>

          <div className="flex items-center bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-lg overflow-hidden h-10 px-2 font-mono text-[11px]">
            <select 
              value={modeFilter} 
              onChange={e => setModeFilter(e.target.value)}
              className="bg-transparent text-white border-none focus:outline-none cursor-pointer h-full px-2"
            >
              <option value="All">All Modes</option>
              <option value="Revenue">Revenue Only</option>
              <option value="Expense">Expense Only</option>
              <option value="Cash">Cash</option>
              <option value="Transfer">Transfer</option>
              <option value="POS">POS</option>
              <option value="Debt">Debt (Credit)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Table Container */}
      <div className="flex-1 overflow-auto p-4 pb-20">
        <div className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl overflow-hidden shadow-sm">
          <table className="w-full text-left font-mono text-[10px]">
            <thead className="bg-[#111827]">
              <tr className="text-[var(--color-muted)] border-b border-[rgba(255,255,255,0.05)] uppercase">
                <th className="py-3 px-3 font-medium">Ref ID</th>
                <th className="py-3 px-2 font-medium">Time/Date</th>
                <th className="py-3 px-2 font-medium">Type</th>
                <th className="py-3 px-2 font-medium">Detail</th>
                <th className="py-3 px-2 font-medium text-center">Mode</th>
                <th className="py-3 px-2 font-medium text-right">Amount</th>
                <th className="py-3 px-2 font-medium text-center">Status</th>
                <th className="py-3 px-3 font-medium text-center">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredEntries.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-[var(--color-muted)]">
                    No entries found matching filters.
                  </td>
                </tr>
              ) : (
                filteredEntries.map((e) => (
                  <tr key={e.id} className="border-b border-[rgba(255,255,255,0.03)] hover:bg-[rgba(255,255,255,0.02)] transition-colors">
                    <td className="py-2.5 px-3 text-[var(--color-light-muted)] whitespace-nowrap">{e.id}</td>
                    <td className="py-2.5 px-2 text-[var(--color-muted)] whitespace-nowrap">{e.time}</td>
                    <td className={`py-2.5 px-2 capitalize font-bold ${e.source === 'expense' ? 'text-[var(--color-error)]' : 'text-[var(--color-foreground)]'}`}>{e.type}</td>
                    <td className="py-2.5 px-2 text-[var(--color-foreground)] truncate max-w-[150px]">{e.name} &middot; {e.detail}</td>
                    <td className="py-2.5 px-2 text-center">
                      <span className={`px-1.5 py-0.5 rounded font-sans text-[9px] font-medium whitespace-nowrap ${
                        e.mode === 'Cash' ? 'bg-[rgba(16,185,129,0.15)] text-[var(--color-success)]' :
                        e.mode === 'Transfer' ? 'bg-[rgba(59,130,246,0.15)] text-[var(--color-accent-cobalt)]' :
                        e.mode === 'POS' ? 'bg-[rgba(245,158,11,0.15)] text-[var(--color-accent-amber)]' :
                        e.mode === 'Expense' ? 'bg-[rgba(239,68,68,0.15)] text-[var(--color-error)]' :
                        'border border-[var(--color-error)] text-[var(--color-error)]'
                      }`}>
                        {e.mode === 'Debt' ? 'Credit' : e.mode}
                      </span>
                    </td>
                    <td className={`py-2.5 px-2 text-right font-bold whitespace-nowrap ${e.source === 'expense' ? 'text-[var(--color-error)]' : 'text-[var(--color-success)]'}`}>
                      {e.source === 'expense' ? '-' : ''}{fmt(e.amount)}
                    </td>
                    <td className="py-2.5 px-2 text-center">
                      {e.status !== 'N/A' ? (
                        <div className="flex items-center justify-center gap-1.5">
                          <div className={`w-1.5 h-1.5 rounded-full ${
                            e.status === 'Delivered' ? 'bg-emerald-500' :
                            ['In-Transit', 'Departure', 'Dispatched'].includes(e.status) ? 'bg-blue-500' :
                            e.status === 'Arrived' ? 'bg-amber-500' :
                            'bg-slate-400'
                          }`} />
                          <span className={`font-medium ${
                            e.status === 'Delivered' ? 'text-emerald-500' :
                            ['In-Transit', 'Departure', 'Dispatched'].includes(e.status) ? 'text-blue-500' :
                            e.status === 'Arrived' ? 'text-amber-500' :
                            'text-slate-400'
                          }`}>{e.status}</span>
                        </div>
                      ) : (
                        <span className="text-slate-600">N/A</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      {e.source === 'transaction' ? (
                        <button 
                          onClick={() => handleEditClick(e)}
                          className="text-[var(--color-muted)] hover:text-white p-1 rounded-full hover:bg-[rgba(255,255,255,0.1)] transition-colors inline-flex cursor-pointer border-none bg-transparent"
                        >
                          <Edit2 size={12} />
                        </button>
                      ) : (
                        <span className="text-[var(--color-muted)] text-[8px] uppercase">N/A</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Modal Dialog */}
      {editingTx && (
        <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-[2px] flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-[var(--color-surface-card)] border border-[rgba(255,255,255,0.1)] rounded-xl w-full max-w-sm shadow-xl flex flex-col overflow-hidden">
            <div className="p-4 border-b border-[rgba(255,255,255,0.05)] flex justify-between items-center bg-[#111827]">
              <h3 className="font-bold font-sans text-[var(--color-foreground)]">Edit Transaction</h3>
              <button 
                onClick={() => setEditingTx(null)}
                className="text-[var(--color-muted)] hover:text-[var(--color-foreground)] p-1 cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>
            
            <div className="p-4 space-y-4">
              <div className="text-[12px] font-mono text-[var(--color-muted)] bg-[rgba(255,255,255,0.05)] p-2 rounded">
                Ref: <span className="text-[var(--color-foreground)]">{editingTx.id}</span>
              </div>
              
              <div className="space-y-1">
                <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">Amount (₦)</label>
                <input 
                  type="number"
                  value={editingTx.amount}
                  onChange={(e) => setEditingTx({ ...editingTx, amount: parseFloat(e.target.value) || 0 })}
                  className="w-full h-10 px-3 bg-[var(--color-surface-2)] border border-[rgba(255,255,255,0.07)] rounded-lg text-[var(--color-foreground)] font-mono text-[14px] focus:outline-none focus:border-[var(--color-accent-amber)]"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">Payment Mode</label>
                <select 
                  value={editingTx.mode}
                  onChange={(e) => setEditingTx({ ...editingTx, mode: e.target.value as any })}
                  className="w-full h-10 px-3 bg-[var(--color-surface-2)] border border-[rgba(255,255,255,0.07)] rounded-lg text-[var(--color-foreground)] font-sans text-[13px] focus:outline-none focus:border-[var(--color-accent-amber)]"
                >
                  <option value="Cash">Cash</option>
                  <option value="Transfer">Bank Transfer</option>
                  <option value="POS">POS / Card</option>
                  <option value="Debt">On Credit (Debt)</option>
                </select>
              </div>

              {editingTx.mode === 'Transfer' && (
                <div className="space-y-1">
                  <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">Bank</label>
                  <select 
                    value={editingTx.bank || ''}
                    onChange={(e) => setEditingTx({ ...editingTx, bank: e.target.value })}
                    className="w-full h-10 px-3 bg-[var(--color-surface-2)] border border-[rgba(255,255,255,0.07)] rounded-lg text-[var(--color-foreground)] font-sans text-[13px] focus:outline-none focus:border-[var(--color-accent-amber)]"
                  >
                    <option value="">Select Bank</option>
                    <option value="GTBank">GTBank</option>
                    <option value="Access Bank">Access Bank</option>
                    <option value="Zenith Bank">Zenith Bank</option>
                    <option value="UBA">UBA</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              )}

              <div className="space-y-1">
                <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">Status</label>
                <select 
                  value={editingTx.status}
                  onChange={(e) => setEditingTx({ ...editingTx, status: e.target.value as any })}
                  className="w-full h-10 px-3 bg-[var(--color-surface-2)] border border-[rgba(255,255,255,0.07)] rounded-lg text-[var(--color-foreground)] font-sans text-[13px] focus:outline-none focus:border-[var(--color-accent-amber)]"
                >
                  <option value="Intake">Intake</option>
                  <option value="Dispatched">Dispatched</option>
                  <option value="Delivered">Delivered</option>
                  <option value="Cancelled">Cancelled</option>
                </select>
              </div>
            </div>

            <div className="p-4 border-t border-[rgba(255,255,255,0.05)] bg-[#111827] flex justify-end">
               <button 
                 onClick={handleSaveEdit}
                 className="h-9 px-4 bg-[var(--color-success)] hover:bg-emerald-600 text-[var(--color-obsidian)] font-bold font-sans text-[13px] rounded-lg cursor-pointer flex items-center gap-1.5 transition-colors"
               >
                 <Check size={14} />
                 <span>Save Changes</span>
               </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
