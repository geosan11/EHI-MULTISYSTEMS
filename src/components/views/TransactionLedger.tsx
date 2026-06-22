import { useState } from 'react';
import { Transaction, User } from '../../lib/types';
import { fmt } from '../../lib/helpers';
import { ArrowLeft, Edit2, X, Check } from 'lucide-react';

export const TransactionLedger = ({ 
  user, 
  transactions, 
  onBack, 
  onUpdateTx 
}: { 
  user: User; 
  transactions: Transaction[]; 
  onBack: () => void; 
  onUpdateTx: (tx: Transaction) => void; 
}) => {
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);

  const handleEditClick = (tx: Transaction) => {
    setEditingTx({ ...tx });
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
        <button onClick={onBack} className="flex items-center space-x-1 text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors cursor-pointer">
          <ArrowLeft size={16} />
          <span className="text-[11px] font-mono">Back</span>
        </button>
        <span className="text-[10px] font-mono text-[var(--color-accent-amber)] tracking-widest font-bold">● TRANSACTION LEDGER</span>
      </div>

      {/* Table Container */}
      <div className="flex-1 overflow-auto p-4 pb-20">
        <div className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl overflow-hidden shadow-sm">
          <table className="w-full text-left font-mono text-[10px]">
            <thead className="bg-[#111827]">
              <tr className="text-[var(--color-muted)] border-b border-[rgba(255,255,255,0.05)] uppercase">
                <th className="py-3 px-3 font-medium">Ref ID</th>
                <th className="py-3 px-2 font-medium">Time</th>
                <th className="py-3 px-2 font-medium">Type</th>
                <th className="py-3 px-2 font-medium">Detail</th>
                <th className="py-3 px-2 font-medium text-center">Mode</th>
                <th className="py-3 px-2 font-medium text-right">Amount</th>
                <th className="py-3 px-2 font-medium text-center">Status</th>
                <th className="py-3 px-3 font-medium text-center">Action</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((tx) => (
                <tr key={tx.id} className="border-b border-[rgba(255,255,255,0.03)] hover:bg-[rgba(255,255,255,0.02)] transition-colors">
                  <td className="py-2.5 px-3 text-[var(--color-light-muted)] whitespace-nowrap">{tx.id}</td>
                  <td className="py-2.5 px-2 text-[var(--color-muted)] whitespace-nowrap">{tx.time}</td>
                  <td className="py-2.5 px-2 text-[var(--color-foreground)] capitalize">{tx.type}</td>
                  <td className="py-2.5 px-2 text-white truncate max-w-[150px]">{tx.name} &middot; {tx.detail}</td>
                  <td className="py-2.5 px-2 text-center">
                    <span className={`px-1.5 py-0.5 rounded font-sans text-[9px] font-medium ${
                      tx.mode === 'Cash' ? 'bg-[rgba(16,185,129,0.15)] text-[var(--color-success)]' :
                      tx.mode === 'Transfer' ? 'bg-[rgba(59,130,246,0.15)] text-[var(--color-accent-cobalt)]' :
                      tx.mode === 'POS' ? 'bg-[rgba(245,158,11,0.15)] text-[var(--color-accent-amber)]' :
                      'border border-[var(--color-error)] text-[var(--color-error)]'
                    }`}>
                      {tx.mode === 'Debt' ? 'Credit' : tx.mode}
                    </span>
                  </td>
                  <td className="py-2.5 px-2 text-right font-bold text-white whitespace-nowrap">{fmt(tx.amount)}</td>
                  <td className="py-2.5 px-2 text-center text-[var(--color-light-muted)]">{tx.status}</td>
                  <td className="py-2.5 px-3 text-center">
                    <button 
                      onClick={() => handleEditClick(tx)}
                      className="text-[var(--color-muted)] hover:text-white p-1 rounded-full hover:bg-[rgba(255,255,255,0.1)] transition-colors inline-flex cursor-pointer"
                    >
                      <Edit2 size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Modal Dialog */}
      {editingTx && (
        <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-[2px] flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-[var(--color-surface-card)] border border-[rgba(255,255,255,0.1)] rounded-xl w-full max-w-sm shadow-xl flex flex-col overflow-hidden">
            <div className="p-4 border-b border-[rgba(255,255,255,0.05)] flex justify-between items-center bg-[#111827]">
              <h3 className="font-bold font-sans text-white">Edit Transaction</h3>
              <button 
                onClick={() => setEditingTx(null)}
                className="text-[var(--color-muted)] hover:text-white p-1 cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>
            
            <div className="p-4 space-y-4">
              <div className="text-[12px] font-mono text-[var(--color-muted)] bg-[rgba(255,255,255,0.05)] p-2 rounded">
                Ref: <span className="text-white">{editingTx.id}</span>
              </div>
              
              <div className="space-y-1">
                <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">Amount (₦)</label>
                <input 
                  type="number"
                  value={editingTx.amount}
                  onChange={(e) => setEditingTx({ ...editingTx, amount: parseFloat(e.target.value) || 0 })}
                  className="w-full h-10 px-3 bg-[var(--color-surface-2)] border border-[rgba(255,255,255,0.07)] rounded-lg text-white font-mono text-[14px] focus:outline-none focus:border-[var(--color-accent-amber)]"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">Payment Mode</label>
                <select 
                  value={editingTx.mode}
                  onChange={(e) => setEditingTx({ ...editingTx, mode: e.target.value as any })}
                  className="w-full h-10 px-3 bg-[var(--color-surface-2)] border border-[rgba(255,255,255,0.07)] rounded-lg text-white font-sans text-[13px] focus:outline-none focus:border-[var(--color-accent-amber)]"
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
                    className="w-full h-10 px-3 bg-[var(--color-surface-2)] border border-[rgba(255,255,255,0.07)] rounded-lg text-white font-sans text-[13px] focus:outline-none focus:border-[var(--color-accent-amber)]"
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
                  className="w-full h-10 px-3 bg-[var(--color-surface-2)] border border-[rgba(255,255,255,0.07)] rounded-lg text-white font-sans text-[13px] focus:outline-none focus:border-[var(--color-accent-amber)]"
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
