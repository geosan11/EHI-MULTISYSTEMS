import React, { useState, useEffect } from 'react';
import { Expense, User } from '../../lib/types';
import { fmt, uid, tnow, sanitizeSpreadsheetRows } from '../../lib/helpers';
import { Car, Truck, Bus, Box, Package, Briefcase, Download, Plus, AlertCircle, Edit2, CheckCircle, XCircle } from 'lucide-react';
import { EmptyState } from './EmptyState';
import { useExpenseCategories, useExpenseBudgets, saveExpenseBudget } from '../../lib/expenseCategories';
import { useToast } from '../../lib/ToastContext';
import * as XLSX from 'xlsx';

export const ExpensesTab = ({ expenses = [], user, period = 'today', onAddExpense, onUpdateExpense }: { expenses?: Expense[], user?: User, period?: string, onAddExpense?: (e: Expense) => void, onUpdateExpense?: (expenseId: string, decision: 'approved' | 'rejected') => void }) => {
  const { showToast } = useToast();

  const [showForm, setShowForm] = useState(true);
  const expenseCategories = useExpenseCategories();
  const categories = expenseCategories.map(c => c.name);
  const [category, setCategory] = useState<string>('');
  useEffect(() => {
    if (categories.length > 0 && !categories.includes(category)) setCategory(categories[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories]);
  const [subCategory, setSubCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [desc, setDesc] = useState('');
  const [mode, setMode] = useState<'Cash' | 'Transfer'>('Cash');
  const [bank, setBank] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);

  const monthKey = date.substring(0, 7); // YYYY-MM

  // Budgets are per category-per-month rows in Supabase now, not a
  // localStorage blob keyed per device -- a budget set on one terminal is
  // visible everywhere immediately, and each month keeps its own value
  // (pre-filled from the most recent prior month until edited).
  const { budgets: budgetRows, refetch: refetchBudgets } = useExpenseBudgets(monthKey);
  const budgets: Record<string, number> = {};
  const categoryIds: Record<string, string> = {};
  budgetRows.forEach(b => { budgets[b.name] = b.budget; categoryIds[b.name] = b.categoryId; });

  const [editingBudget, setEditingBudget] = useState<string | null>(null);
  const [budgetInput, setBudgetInput] = useState('');

  const saveBudget = async (cat: string, val: number) => {
    setEditingBudget(null);
    const categoryId = categoryIds[cat];
    if (!categoryId) return;
    const errorMsg = await saveExpenseBudget(categoryId, monthKey, val);
    if (errorMsg) {
      showToast({ message: `Failed to save ${cat} budget: ${errorMsg}`, type: 'error' });
      return;
    }
    refetchBudgets();
  };

  const handleExportCSV = () => {
    const rows = expenses.map(e => ({
      Date: e.created_at ? e.created_at.split('T')[0] : '',
      Time: e.time,
      Category: e.type,
      Description: e.description,
      Amount: e.amount,
      Mode: e.mode || '',
      Status: e.status || 'approved',
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sanitizeSpreadsheetRows(rows)), 'Expenses');
    XLSX.writeFile(wb, `EHI_Expenses_${new Date().toISOString().split('T')[0]}.csv`);
  };

  const getIcon = (cat: string) => {
    switch (cat) {
      case 'Card/Cardboard': return <Box size={16} />;
      case 'Carrier': return <Truck size={16} />;
      case 'Transport': return <Car size={16} />;
      case 'Bus Hire': return <Bus size={16} />;
      case 'Sack & Nylon': return <Package size={16} />;
      case 'Marker': return <Edit2 size={16} />;
      default: return <Briefcase size={16} />;
    }
  };

  const totalExpenses = expenses.filter(e => (e.status || 'approved') === 'approved').reduce((sum, e) => sum + e.amount, 0);

  const handleLog = () => {
    const numAmt = parseFloat(amount);
    if (!numAmt || numAmt <= 0 || !desc) return;

    const requiresApproval = numAmt > 20000 && user?.role !== 'super_admin' && user?.role !== 'admin';
    const status = requiresApproval ? 'pending' : 'approved';

    const exp: Expense = {
      id: uid('EX' as any),
      type: category,
      amount: numAmt,
      description: desc + (subCategory ? ` - ${subCategory}` : ''),
      time: tnow(),
      created_at: new Date().toISOString(),
      status,
      mode,
      bank: mode === 'Transfer' ? bank : undefined
    };

    if (onAddExpense) onAddExpense(exp);
    setAmount('');
    setDesc('');
    setSubCategory('');
    setBank('');
  };

  const numAmount = parseFloat(amount) || 0;
  const requiresApproval = numAmount > 20000 && user?.role !== 'super_admin' && user?.role !== 'admin';

  return (
    <div className="space-y-6 pb-24">
      {/* PERIOD SUMMARY */}
      <div className="bg-[var(--color-surface-card)] rounded-xl border border-[var(--color-border)] p-5">
         <div className="text-[13px] font-sans font-medium text-[var(--color-muted)] mb-1">Total Expenses ({period})</div>
         <div className="text-[28px] font-mono font-bold text-[var(--color-warning)] mb-2">{fmt(totalExpenses)}</div>
      </div>

      {/* EXPENSE FORM */}
      <div className="bg-[var(--color-surface-card)] rounded-xl border border-[var(--color-border)] p-5">
         <div className="text-[14px] font-sans font-semibold text-[var(--color-foreground)] mb-4">Log Expense</div>
         
         <div className="space-y-4">
           {/* CATEGORY SCROLLER */}
           <div className="flex space-x-2 overflow-x-auto pb-2 scrollbar-hide">
              {categories.map(c => (
                <button
                  key={c}
                  onClick={() => setCategory(c)}
                  className={`flex items-center space-x-1.5 px-3 py-2 text-[12px] font-sans font-medium rounded-lg whitespace-nowrap transition-colors focus:outline-none ${category === c ? 'bg-[rgba(245,158,11,0.15)] text-[var(--color-accent-amber)] border border-[rgba(245,158,11,0.3)] shadow-sm' : 'bg-[var(--color-surface-1)] text-[var(--color-muted)] border border-transparent'}`}
                >
                  {getIcon(c)} <span>{c}</span>
                </button>
              ))}
           </div>
           
           <div className="flex gap-3">
             <div className="flex-1">
               <label htmlFor="expense-amount" className="text-[11px] font-sans text-[var(--color-muted)] block mb-1">Amount ₦</label>
               <input
                 id="expense-amount"
                 type="number"
                 value={amount}
                 onChange={e => setAmount(e.target.value)}
                 placeholder="0"
                 className="w-full h-11 bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl px-3 text-[var(--color-accent-amber)] font-mono text-[16px] font-bold focus:outline-none focus:border-[var(--color-accent-amber)] focus:ring-1 focus:ring-[var(--color-accent-amber)]"
               />
             </div>
             <div className="flex-1">
               <label className="text-[11px] font-sans text-[var(--color-muted)] block mb-1">Payment Mode</label>
               <div className="flex bg-[var(--color-surface-1)] rounded-xl p-1 border border-[var(--color-border)] h-11">
                 <button onClick={() => setMode('Cash')} className={`flex-1 text-[12px] font-sans font-medium rounded-lg ${mode === 'Cash' ? 'bg-[var(--color-surface-2)] text-[var(--color-foreground)] shadow-sm' : 'text-[var(--color-muted)]'}`}>Cash</button>
                 <button onClick={() => setMode('Transfer')} className={`flex-1 text-[12px] font-sans font-medium rounded-lg ${mode === 'Transfer' ? 'bg-[var(--color-surface-2)] text-[var(--color-foreground)] shadow-sm' : 'text-[var(--color-muted)]'}`}>Transfer</button>
               </div>
             </div>
           </div>

           <div>
             <label htmlFor="expense-description" className="text-[11px] font-sans text-[var(--color-muted)] block mb-1">Description</label>
             <input
               id="expense-description"
               type="text"
               value={desc}
               onChange={e => setDesc(e.target.value)}
               placeholder="e.g. Fuel for bus, Toll gate..."
               className="w-full h-11 bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl px-3 text-[var(--color-foreground)] font-sans text-[13px] focus:outline-none focus:border-[var(--color-accent-amber)]"
             />
           </div>

           {requiresApproval && (
             <div className="flex items-start space-x-2 bg-[rgba(245,158,11,0.1)] border border-[rgba(245,158,11,0.2)] p-3 rounded-xl mt-2">
               <AlertCircle size={16} className="text-[var(--color-accent-amber)] shrink-0 mt-0.5" />
               <div className="text-[12px] font-sans text-[var(--color-accent-amber)]">
                 This expense requires admin approval before it is posted.
               </div>
             </div>
           )}

           <button 
             onClick={handleLog}
             disabled={!amount || !desc}
             className="w-full h-12 mt-2 bg-[var(--color-accent-amber)] disabled:opacity-50 hover:bg-opacity-90 text-[#0B0F19] text-[15px] font-sans font-bold rounded-xl transition-all focus:outline-none flex items-center justify-center space-x-2"
           >
             <Plus size={18} />
             <span>{requiresApproval ? "Submit for Approval" : "Log Expense"}</span>
           </button>
         </div>
      </div>

      {/* BUDGET VS ACTUAL */}
      <div className="bg-[var(--color-surface-card)] rounded-xl border border-[var(--color-border)] p-5">
         <div className="text-[15px] font-sans font-bold text-[var(--color-foreground)] mb-4">Budget Tracker</div>
         <div className="space-y-4">
           {categories.map(c => {
             // Falls back to 0 (not undefined) during the brief window
             // before useExpenseBudgets' fetch resolves.
             const budget = budgets[c] ?? 0;
             const spent = expenses.filter(e => e.type === c && (e.status || 'approved') === 'approved').reduce((sum, e) => sum + e.amount, 0);
             const pct = budget ? (spent / budget) * 100 : 0;
             
             let barColor = 'bg-[var(--color-success)]';
             if (pct > 100) barColor = 'bg-[var(--color-error)]'; // should be striped in a real app
             else if (pct > 85) barColor = 'bg-[#ea580c]';
             else if (pct > 60) barColor = 'bg-[var(--color-accent-amber)]';

             return (
               <div key={c} className="space-y-1.5">
                 <div className="flex justify-between items-center text-[12px] font-sans">
                   <div className="flex items-center space-x-2 text-[var(--color-foreground)]">
                     <span className="text-[var(--color-muted)]">{getIcon(c)}</span>
                     <span className="font-medium">{c}</span>
                   </div>
                   <div className="flex items-center space-x-2">
                     <span className="font-mono text-[var(--color-muted)]">{fmt(spent)}</span>
                     <span className="text-[var(--color-light-muted)]">/</span>
                     
                     {editingBudget === c ? (
                       <div className="flex items-center space-x-1">
                         <input 
                           type="number" 
                           autoFocus
                           className="w-20 bg-[var(--color-surface-1)] border border-[var(--color-muted)] rounded px-1 text-[11px] text-[var(--color-foreground)] font-mono h-6 outline-none"
                           value={budgetInput}
                           onChange={e => setBudgetInput(e.target.value)}
                           onBlur={() => saveBudget(c, parseFloat(budgetInput) || budget)}
                           onKeyDown={e => e.key === 'Enter' && saveBudget(c, parseFloat(budgetInput) || budget)}
                         />
                       </div>
                     ) : (
                       <div className="flex items-center space-x-1 group">
                         <span className="font-mono text-[var(--color-foreground)]">{fmt(budget)}</span>
                         <button onClick={() => { setEditingBudget(c); setBudgetInput(budget.toString()); }} aria-label={`Edit ${c} budget`} className="opacity-0 group-hover:opacity-100 text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-opacity focus:outline-none">
                           <Edit2 size={12} />
                         </button>
                       </div>
                     )}
                   </div>
                 </div>
                 
                 <div className="w-full h-2 bg-[var(--color-surface-1)] rounded-full overflow-hidden">
                   <div style={{ width: `${Math.min(pct, 100)}%` }} className={`h-full rounded-full transition-all ${barColor}`} />
                 </div>
               </div>
             );
           })}
         </div>
      </div>

      {/* EXPENSE LOG */}
      <div>
         <div className="flex justify-between items-center mb-3">
           <span className="text-[14px] font-sans font-semibold text-[var(--color-foreground)]">Expense Log</span>
           <button onClick={handleExportCSV} className="flex items-center space-x-1 text-[11px] font-sans text-[var(--color-accent-cobalt)] bg-[rgba(59,130,246,0.1)] px-2 py-1 rounded focus:outline-none hover:bg-opacity-20 transition-colors">
             <Download size={12} />
             <span>CSV</span>
           </button>
         </div>

         {expenses.length === 0 ? (
            <EmptyState icon={<Briefcase size={36} strokeWidth={1.5} />} message="No expenses logged yet." />
         ) : (
            <div className="space-y-2">
              {expenses.map((e, idx) => (
                <div key={idx} className="bg-[var(--color-surface-card)] rounded-xl border border-[var(--color-border)] p-4 flex items-start space-x-3">
                  <div className="w-8 h-8 rounded-full bg-[rgba(245,158,11,0.1)] text-[var(--color-accent-amber)] flex items-center justify-center mt-0.5">
                    {getIcon(e.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between">
                      <span className="text-[14px] font-sans font-medium text-[var(--color-foreground)] break-words pr-2 leading-tight">{e.description}</span>
                      <span className="text-[15px] font-mono font-bold text-[var(--color-accent-amber)] shrink-0">{fmt(e.amount)}</span>
                    </div>
                    <div className="flex items-center space-x-2 mt-2">
                      <span className="text-[11px] font-sans text-[var(--color-muted)]">{e.time}</span>
                      <span className="w-1 h-1 rounded-full bg-[var(--color-muted)]" />
                      <span className="text-[11px] font-sans text-[var(--color-muted)]">{e.type}</span>
                      
                      {e.status && (
                        <>
                           <span className="w-1 h-1 rounded-full bg-[var(--color-muted)]" />
                           <span className={`flex items-center space-x-1 px-1.5 py-0.5 rounded text-[9px] font-sans font-bold uppercase tracking-wider ${
                             e.status === 'approved' ? 'text-[var(--color-success)] bg-[rgba(16,185,129,0.1)]' :
                             e.status === 'pending' ? 'text-[var(--color-accent-amber)] bg-[rgba(245,158,11,0.1)]' :
                             'text-[var(--color-error)] bg-[rgba(239,68,68,0.1)]'
                           }`}>
                             {e.status === 'approved' && <CheckCircle size={10} />}
                             {e.status === 'pending' && <AlertCircle size={10} />}
                             {e.status === 'rejected' && <XCircle size={10} />}
                             <span>{e.status}</span>
                           </span>
                        </>
                      )}
                    </div>

                    {e.status === 'approved' && e.approvedBy && (
                      <div className="text-[10px] font-sans text-[var(--color-muted)] mt-1">Approved by {e.approvedBy}</div>
                    )}
                    {e.status === 'rejected' && e.rejectedBy && (
                      <div className="text-[10px] font-sans text-[var(--color-muted)] mt-1">Rejected by {e.rejectedBy}</div>
                    )}

                    {e.status === 'pending' && (user?.role === 'super_admin' || user?.role === 'admin') && (
                      <div className="flex space-x-2 mt-3 pt-3 border-t border-[var(--color-border)]">
                        <button
                          onClick={() => onUpdateExpense?.(e.id, 'approved')}
                          className="flex-1 py-1.5 bg-[rgba(16,185,129,0.1)] hover:bg-[rgba(16,185,129,0.2)] text-[var(--color-success)] text-[11px] font-sans font-bold rounded flex justify-center items-center space-x-1 transition-colors"
                        >
                          <CheckCircle size={12}/> <span>Approve</span>
                        </button>
                        <button
                          onClick={() => onUpdateExpense?.(e.id, 'rejected')}
                          className="flex-1 py-1.5 bg-[rgba(239,68,68,0.1)] hover:bg-[rgba(239,68,68,0.2)] text-[var(--color-error)] text-[11px] font-sans font-bold rounded flex justify-center items-center space-x-1 transition-colors"
                        >
                          <XCircle size={12}/> <span>Reject</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
         )}
      </div>

    </div>
  );
};
