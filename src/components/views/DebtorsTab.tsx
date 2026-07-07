import React, { useState } from 'react';
import { Transaction, User } from '../../lib/types';
import { fmt } from '../../lib/helpers';
import { ChevronDown, ChevronUp, Printer, Plus } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export const DebtorsTab = ({ transactions = [], user, onUpdateTx }: { transactions?: Transaction[], user?: User, onUpdateTx?: (id: string, update: Partial<Transaction>) => void }) => {
  const [filter, setFilter] = useState<'All' | 'Corporate' | 'Individual'>('All');
  const [sort, setSort] = useState<'Highest Amount' | 'Oldest First' | 'Newest First' | 'Alphabetical'>('Highest Amount');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [showPaymentForm, setShowPaymentForm] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMode, setPaymentMode] = useState<'Cash' | 'Transfer'>('Cash');
  const [paymentBank, setPaymentBank] = useState('');

  const [statementPrint, setStatementPrint] = useState<Transaction | null>(null);

  // Compute real aging from the transaction's created_at timestamp
  const realAgeInDays = (t: any): number => {
    if (!t.created_at) return 0;
    const created = new Date(t.created_at).getTime();
    if (isNaN(created)) return 0;
    return Math.max(0, Math.floor((Date.now() - created) / 86400000));
  };

  const debts = transactions
    .filter(t => t.mode === 'Debt' || t.mode?.includes('Debt'))
    .map(t => {
      const ageInDays = realAgeInDays(t);
      let bucket: 'current' | 'overdue' | 'critical' | 'writeoff-risk' = 'current';
      if (ageInDays > 90) bucket = 'writeoff-risk';
      else if (ageInDays > 60) bucket = 'critical';
      else if (ageInDays > 30) bucket = 'overdue';

      return {
        ...t,
        clientType: ['Aramex', 'SAHCO', 'GlobaCom', 'ZeemMax', 'Slot', 'Salco', 'Slot Nigeria'].includes(t.name) ? 'Corporate' : 'Individual',
        ageInDays,
        agingBucket: bucket,
        balance: t.amount - (t.amountPaid || 0),
      };
    })
    .filter(d => d.balance > 0);

  let visibleDebts = debts;
  if (filter !== 'All') {
    visibleDebts = debts.filter(d => d.clientType === filter);
  }

  visibleDebts.sort((a, b) => {
    if (sort === 'Highest Amount') return b.balance - a.balance;
    if (sort === 'Oldest First') return b.ageInDays - a.ageInDays;
    if (sort === 'Newest First') return a.ageInDays - b.ageInDays;
    return a.name.localeCompare(b.name);
  });

  const totalOutstanding = visibleDebts.reduce((sum, d) => sum + d.balance, 0);

  const buckets = {
    current: debts.filter(d => d.agingBucket === 'current'),
    overdue: debts.filter(d => d.agingBucket === 'overdue'),
    critical: debts.filter(d => d.agingBucket === 'critical'),
    writeoff: debts.filter(d => d.agingBucket === 'writeoff-risk'),
  };

  const getBucketColor = (bucket: string) => {
    switch(bucket) {
      case 'current': return 'text-[var(--color-success)] bg-[rgba(16,185,129,0.1)] border-[var(--color-success)]';
      case 'overdue': return 'text-[var(--color-accent-amber)] bg-[rgba(245,158,11,0.1)] border-[var(--color-accent-amber)]';
      case 'critical': return 'text-[#ea580c] bg-[rgba(234,88,12,0.1)] border-[#ea580c]'; // orange-600
      case 'writeoff-risk': return 'text-[var(--color-error)] bg-[rgba(239,68,68,0.1)] border-[var(--color-error)]';
      default: return 'text-[var(--color-muted)]';
    }
  };

  const getBucketDot = (bucket: string) => {
    switch(bucket) {
      case 'current': return 'bg-[var(--color-success)]';
      case 'overdue': return 'bg-[var(--color-accent-amber)]';
      case 'critical': return 'bg-[#ea580c]';
      case 'writeoff-risk': return 'bg-[var(--color-error)]';
      default: return 'bg-gray-500';
    }
  };

  const handleRecordPayment = (id: string) => {
    const debt = debts.find(d => d.id === id);
    if (!debt) return;
    const paidNow = parseFloat(paymentAmount);
    if (!paidNow || paidNow <= 0) return;
    const cappedPaid = Math.min(paidNow, debt.balance);
    const newAmountPaid = (debt as any).amountPaid ? (debt as any).amountPaid + cappedPaid : cappedPaid;
    const historyEntry = { amount: cappedPaid, mode: paymentMode, by: user?.name || 'Unknown', at: new Date().toISOString() };
    const newHistory = [...(((debt as any).paymentHistory) || []), historyEntry];
    const remaining = debt.balance - cappedPaid;
    if (onUpdateTx) {
      onUpdateTx(id, {
        amountPaid: newAmountPaid,
        paymentHistory: newHistory,
        mode: remaining <= 0 ? 'Debt Paid' : 'Debt'
      } as any);
    }
    setShowPaymentForm(null);
    setPaymentAmount('');
  };

  return (
    <div className="space-y-6 pb-24">
      
      {statementPrint && (
        <div className="fixed inset-0 z-50 bg-[var(--color-obsidian)] flex flex-col p-4 overflow-y-auto">
          <div className="flex justify-between items-center mb-6">
            <button onClick={() => setStatementPrint(null)} className="text-[13px] font-sans font-medium text-[var(--color-muted)]">Close</button>
             <button onClick={() => window.print()} className="flex items-center space-x-2 bg-[var(--color-surface-2)] px-4 py-2 rounded-lg text-[13px] font-sans font-medium text-[var(--color-foreground)]">
              <Printer size={16} />
              <span>Print / Export PDF</span>
            </button>
          </div>

          <div className="bg-white rounded p-8 text-black print:p-0 print:m-0 print:w-full print:shadow-none min-h-[A4]">
            <div className="flex justify-between items-start border-b border-gray-300 pb-6 mb-6">
              <div>
                <h1 className="text-[24px] font-sans font-black text-black leading-none tracking-tight">EHI MULTISYSTEMS</h1>
                <div className="text-[12px] font-sans text-gray-500 mt-1">Logistics Intelligence Platform</div>
                <div className="text-[12px] font-sans text-gray-600 mt-4">{user?.hub || 'HQ'} Hub Operations</div>
              </div>
              <div className="text-right">
                <div className="text-[18px] font-sans font-bold text-gray-800">STATEMENT OF ACCOUNT</div>
                <div className="text-[12px] font-sans text-gray-500 mt-1">Generated: {new Date().toLocaleDateString()}</div>
              </div>
            </div>

            <div className="mb-8">
              <div className="text-[12px] font-sans font-medium text-gray-500 uppercase tracking-wider mb-1">Prepared For</div>
              <div className="text-[18px] font-sans font-bold text-gray-900">{statementPrint.name}</div>
              <div className="text-[13px] font-sans text-gray-600 mt-1">Account Type: Corporate</div>
            </div>

            <div className="overflow-x-auto">
            <table className="w-full text-left font-sans mb-8 min-w-[500px]">
              <thead>
                <tr className="border-b-2 border-gray-800">
                  <th className="py-2 text-[12px] font-bold text-gray-800">Date</th>
                  <th className="py-2 text-[12px] font-bold text-gray-800">Description</th>
                  <th className="py-2 text-[12px] font-bold text-gray-800 text-right">Debit (₦)</th>
                  <th className="py-2 text-[12px] font-bold text-gray-800 text-right">Credit (₦)</th>
                  <th className="py-2 text-[12px] font-bold text-gray-800 text-right">Balance (₦)</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-gray-200">
                  <td className="py-3 text-[13px] text-gray-700">{statementPrint.time}</td>
                  <td className="py-3 text-[13px] text-gray-900">{statementPrint.detail}</td>
                  <td className="py-3 text-[13px] font-mono text-gray-900 text-right">{fmt(statementPrint.amount).replace('₦','')}</td>
                  <td className="py-3 text-[13px] font-mono text-gray-700 text-right">-</td>
                  <td className="py-3 text-[13px] font-mono font-medium text-gray-900 text-right">{fmt(statementPrint.amount).replace('₦','')}</td>
                </tr>
                {((statementPrint as any).paymentHistory || []).reduce((rows: JSX.Element[], p: { amount: number; mode: string; at: string }, idx: number, arr: any[]) => {
                  const paidSoFar = arr.slice(0, idx + 1).reduce((s, x) => s + x.amount, 0);
                  const runningBalance = statementPrint.amount - paidSoFar;
                  rows.push(
                    <tr key={idx} className="border-b border-gray-200">
                      <td className="py-3 text-[13px] text-gray-700">{new Date(p.at).toLocaleDateString('en-GB')}</td>
                      <td className="py-3 text-[13px] text-gray-900">Payment received ({p.mode})</td>
                      <td className="py-3 text-[13px] font-mono text-gray-700 text-right">-</td>
                      <td className="py-3 text-[13px] font-mono text-gray-900 text-right">{fmt(p.amount).replace('₦','')}</td>
                      <td className="py-3 text-[13px] font-mono font-medium text-gray-900 text-right">{fmt(runningBalance).replace('₦','')}</td>
                    </tr>
                  );
                  return rows;
                }, [])}
              </tbody>
            </table>
            </div>

            <div className="flex justify-end mb-12">
              <div className="w-[300px]">
                <div className="flex justify-between py-2 border-b border-gray-200 text-[14px]">
                  <span className="font-sans font-medium text-gray-600">Total Outstanding:</span>
                  <span className="font-mono font-bold text-red-600">{fmt((statementPrint as any).balance ?? statementPrint.amount)}</span>
                </div>
              </div>
            </div>

            <div className="text-[11px] font-sans text-gray-500 italic text-center border-t border-gray-200 pt-4 mt-12">
              Payment is due within 30 days of service date. Please remit payment to EHI Multisystems accounts.
            </div>
          </div>
        </div>
      )}

      {/* SUMMARY HEADER */}
      <div className="bg-[var(--color-surface-card)] rounded-xl border border-[var(--color-border)] p-5">
        <div className="text-[13px] font-sans font-medium text-[var(--color-muted)] mb-1">Total Outstanding</div>
        <div className="text-[28px] font-mono font-bold text-[var(--color-error)] mb-6">{fmt(totalOutstanding)}</div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
           {([
             { label: 'Current', days: '0-30', bucket: 'current', data: buckets.current },
             { label: 'Overdue', days: '31-60', bucket: 'overdue', data: buckets.overdue },
             { label: 'Critical', days: '61-90', bucket: 'critical', data: buckets.critical },
             { label: 'Write-off Risk', days: '90+', bucket: 'writeoff-risk', data: buckets.writeoff }
           ] as const).map(b => (
             <div key={b.label} className={`border rounded-xl p-3 bg-opacity-10 border-opacity-30 ${getBucketColor(b.bucket)}`}>
               <div className="text-[11px] font-sans font-semibold uppercase tracking-wider mb-1 opacity-80">{b.label} <span className="opacity-60 lowercase font-normal ml-1">{b.days} days</span></div>
               <div className="text-[15px] font-mono font-bold">{fmt(b.data.reduce((sum,d)=>sum+d.balance,0))}</div>
               <div className="text-[11px] font-sans mt-0.5 opacity-70">{b.data.length} accounts</div>
             </div>
           ))}
        </div>
      </div>

      {user?.role === 'super_admin' && (
        <button className="w-full py-3.5 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-1)] text-[var(--color-foreground)] text-[14px] font-sans font-medium rounded-xl border border-[rgba(255,255,255,0.07)] transition-colors focus:outline-none flex items-center justify-center space-x-2">
          <Plus size={16} />
          <span>Log Manual Credit Sale</span>
        </button>
      )}

      {/* FILTER & SORT BAR */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex space-x-2 bg-[var(--color-surface-card)] p-1 rounded-xl border border-[rgba(255,255,255,0.04)] w-max">
           {['All', 'Corporate', 'Individual'].map(f => (
             <button
               key={f}
               onClick={() => setFilter(f as any)}
               className={`px-3 py-1.5 text-[12px] font-sans font-medium rounded-lg transition-colors focus:outline-none ${filter === f ? 'bg-[var(--color-surface-2)] text-[var(--color-foreground)] shadow-sm' : 'text-[var(--color-muted)] hover:text-[var(--color-foreground)]'}`}
             >
               {f}
             </button>
           ))}
        </div>

        <select 
          value={sort}
          onChange={e => setSort(e.target.value as any)}
          className="bg-[var(--color-surface-card)] border border-[rgba(255,255,255,0.07)] rounded-xl px-3 py-2 text-[12px] font-sans text-[var(--color-foreground)] focus:outline-none min-w-[150px]"
        >
          <option value="Highest Amount">Highest Amount</option>
          <option value="Oldest First">Oldest First</option>
          <option value="Newest First">Newest First</option>
          <option value="Alphabetical">Alphabetical</option>
        </select>
      </div>

      {/* DEBT LIST */}
      {visibleDebts.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-8 py-16 text-center bg-[var(--color-surface-card)] rounded-xl border border-dashed border-[var(--color-surface-2)]">
           <div className="w-12 h-12 rounded-full bg-[rgba(16,185,129,0.1)] flex items-center justify-center border border-[rgba(16,185,129,0.2)] mb-3">
             <div className="w-5 h-5 border-b-2 border-r-2 border-[var(--color-success)] transform rotate-45 mb-1" />
           </div>
           <div className="text-[15px] font-sans font-medium text-[var(--color-foreground)] mb-1">No outstanding debts</div>
           <div className="text-[13px] font-sans text-[var(--color-muted)]">All accounts are settled and up to date.</div>
        </div>
      ) : (
        <div className="space-y-3">
          <AnimatePresence>
            {visibleDebts.map(d => {
              const isExpanded = expandedId === d.id;
              
              return (
                <motion.div 
                  key={d.id}
                  layout="position"
                  className="bg-[var(--color-surface-card)] rounded-xl border border-[rgba(255,255,255,0.07)] overflow-hidden"
                >
                  {/* COLLAPSED ROW */}
                  <div 
                    onClick={() => setExpandedId(isExpanded ? null : d.id)}
                    className="p-4 flex items-center justify-between cursor-pointer hover:bg-[rgba(255,255,255,0.02)] transition-colors"
                  >
                    <div className="flex-1 min-w-0 pr-4">
                      <div className="flex items-center space-x-2 mb-1">
                        <div className={`w-2 h-2 rounded-full shrink-0 ${getBucketDot(d.agingBucket)}`} />
                        <span className="text-[14px] font-sans font-bold text-[var(--color-foreground)] truncate">{d.name}</span>
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-sans font-medium uppercase tracking-wider bg-[var(--color-surface-2)] text-[var(--color-muted)] shrink-0">
                          {d.clientType}
                        </span>
                      </div>
                      <div className={`text-[11px] font-sans font-medium inline-block px-1.5 py-0.5 rounded border ${getBucketColor(d.agingBucket)}`}>
                        {d.ageInDays} days overdue
                      </div>
                    </div>
                    
                    <div className="pl-4 border-l border-[rgba(255,255,255,0.07)] flex flex-col items-end justify-center">
                       <span className="text-[16px] font-mono font-bold text-[var(--color-error)] mb-1">{fmt(d.balance)}</span>
                       <div className="text-[var(--color-muted)]">
                         {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                       </div>
                    </div>
                  </div>

                  {/* EXPANDED AREA */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div 
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="border-t border-[rgba(255,255,255,0.07)] bg-[rgba(0,0,0,0.2)]"
                      >
                        <div className="p-4 space-y-4">
                           {/* Details */}
                           <div className="grid grid-cols-2 gap-4">
                             <div>
                               <div className="text-[11px] font-sans text-[var(--color-muted)] mb-1">Service Detail</div>
                               <div className="text-[13px] font-sans text-[var(--color-foreground)]">{d.detail}</div>
                             </div>
                             <div>
                               <div className="text-[11px] font-sans text-[var(--color-muted)] mb-1">Original Date</div>
                               <div className="text-[13px] font-sans text-[var(--color-foreground)]">{d.time}</div>
                             </div>
                           </div>

                           {/* Notes */}
                           <div>
                             <div className="text-[11px] font-sans text-[var(--color-muted)] mb-1">Notes</div>
                             <textarea 
                               placeholder="Add notes about this debt..."
                               className="w-full h-20 bg-[var(--color-surface-card)] border border-[rgba(255,255,255,0.07)] rounded-xl p-3 text-[13px] font-sans text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-cobalt)] transition-colors resize-none"
                             />
                           </div>

                           {/* Actions */}
                           <div className="flex space-x-2 pt-2 border-t border-[var(--color-border)]">
                             <button 
                               onClick={() => setShowPaymentForm(showPaymentForm === d.id ? null : d.id)}
                               className="flex-1 py-2.5 bg-[var(--color-surface-2)] text-[var(--color-success)] text-[13px] font-sans font-medium rounded-lg hover:bg-[var(--color-surface-1)] transition-colors focus:outline-none"
                             >
                               Record Payment
                             </button>
                             <button 
                               onClick={() => setStatementPrint(d as unknown as Transaction)}
                               className="flex-1 py-2.5 bg-[var(--color-surface-2)] text-[var(--color-foreground)] text-[13px] font-sans font-medium rounded-lg hover:bg-[var(--color-surface-1)] transition-colors focus:outline-none"
                             >
                               View Statement
                             </button>
                           </div>

                           {/* Mini Payment Form */}
                           <AnimatePresence>
                             {showPaymentForm === d.id && (
                               <motion.div 
                                 initial={{ height: 0, opacity: 0 }}
                                 animate={{ height: "auto", opacity: 1 }}
                                 exit={{ height: 0, opacity: 0 }}
                                 className="bg-[rgba(16,185,129,0.05)] border border-[rgba(16,185,129,0.2)] rounded-xl p-4 mt-3"
                               >
                                 <div className="text-[13px] font-sans font-semibold text-[var(--color-success)] mb-3">Post Payment</div>
                                 <div className="space-y-3">
                                   <div className="flex gap-3">
                                     <div className="flex-1">
                                       <label className="text-[11px] font-sans text-[var(--color-muted)] block mb-1">Amount ₦</label>
                                       <input 
                                         type="number"
                                         value={paymentAmount}
                                         onChange={e => setPaymentAmount(e.target.value)}
                                         placeholder={d.balance.toString()}
                                         className="w-full h-10 bg-[var(--color-surface-card)] border border-[rgba(255,255,255,0.07)] rounded-lg px-3 text-[var(--color-foreground)] font-mono text-[14px] focus:outline-none focus:border-[var(--color-success)] focus:ring-1 focus:ring-[var(--color-success)]"
                                       />
                                     </div>
                                     <div className="flex-1">
                                       <label className="text-[11px] font-sans text-[var(--color-muted)] block mb-1">Mode</label>
                                       <select 
                                         value={paymentMode}
                                         onChange={e => setPaymentMode(e.target.value as any)}
                                         className="w-full h-10 bg-[var(--color-surface-card)] border border-[rgba(255,255,255,0.07)] rounded-lg px-3 text-[var(--color-foreground)] font-sans text-[13px] focus:outline-none"
                                       >
                                         <option value="Cash">Cash</option>
                                         <option value="Transfer">Transfer</option>
                                       </select>
                                     </div>
                                   </div>
                                   
                                   <div className="flex justify-end pt-2">
                                     <button 
                                       onClick={() => handleRecordPayment(d.id)}
                                       className="bg-[var(--color-success)] text-[#0B0F19] px-6 py-2 rounded-lg text-[13px] font-sans font-bold hover:bg-opacity-90 transition-opacity focus:outline-none"
                                     >
                                       Confirm
                                     </button>
                                   </div>
                                 </div>
                               </motion.div>
                             )}
                           </AnimatePresence>

                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
};
