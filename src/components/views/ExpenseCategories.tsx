import { useState, useEffect } from 'react';
import { Receipt, Plus, Trash2, Power } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/ToastContext';
import { useConfirm } from '../../lib/ConfirmContext';
import { Badge, Button, PageHeader, Spinner, TextField } from '../ui';

interface ExpenseCategoryRow {
  id: string;
  name: string;
  active: boolean;
}

export const ExpenseCategories = ({ onBack }: { onBack: () => void }) => {
  const [categories, setCategories] = useState<ExpenseCategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);

  const { showToast } = useToast();
  const confirm = useConfirm();

  const fetchCategories = async () => {
    const { data, error } = await supabase
      .from('expense_categories')
      .select('*')
      .order('name');
    if (error) {
      showToast({ message: `Failed to load expense categories: ${error.message}`, type: 'error' });
    } else {
      setCategories(data || []);
    }
    setLoading(false);
  };

  useEffect(() => { fetchCategories(); }, []);

  const handleAdd = async () => {
    const name = newName.trim();
    if (!name) return;
    setAdding(true);
    const { data, error } = await supabase.from('expense_categories').insert({ name }).select().single();
    setAdding(false);
    if (error) {
      showToast({ message: `Failed to add ${name}: ${error.message}`, type: 'error' });
      return;
    }
    setCategories(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
    setNewName('');
  };

  // Optimistic update -- rolls back on failure so the screen never shows a
  // state that isn't actually saved (same pattern as ExcessBaggageAirlines/ContentTypes).
  const handleToggleActive = async (c: ExpenseCategoryRow) => {
    const prev = categories;
    setCategories(cur => cur.map(x => x.id === c.id ? { ...x, active: !x.active } : x));
    const { error } = await supabase.from('expense_categories').update({ active: !c.active, updated_at: new Date().toISOString() }).eq('id', c.id);
    if (error) {
      setCategories(prev);
      showToast({ message: `Failed to save change: ${error.message}`, type: 'error' });
    }
  };

  const handleDelete = async (c: ExpenseCategoryRow) => {
    const ok = await confirm({
      title: 'Remove category?',
      message: `Remove "${c.name}"? Existing expenses and past budgets keep it, but staff can no longer log new expenses against it.`,
      confirmLabel: 'Remove',
      tone: 'danger',
    });
    if (!ok) return;
    const { error } = await supabase.from('expense_categories').delete().eq('id', c.id);
    if (error) {
      showToast({ message: `Failed to remove ${c.name}: ${error.message}`, type: 'error' });
      return;
    }
    setCategories(prev => prev.filter(x => x.id !== c.id));
    showToast({ message: `${c.name} removed`, type: 'success' });
  };

  return (
    <main className="flex flex-col h-full bg-[var(--color-canvas)] overflow-y-auto">
      <PageHeader title="Expense Categories" subtitle="Synced across all devices" onBack={onBack} />

      <div className="ehi-page-body px-4 pt-4 pb-6 space-y-3">
        <div className="bg-[var(--color-info-bg)] border border-[var(--color-info-border)] rounded-xl p-3" style={{ boxShadow: 'var(--shadow-sm)' }}>
          <p className="text-[11px] text-[var(--color-accent-cobalt)] font-sans leading-relaxed">
            These are the categories staff pick from when logging an expense. Monthly budgets for each
            category are set in the Expense tab's Budget Tracker, not here -- this screen only manages
            the category list itself.
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner size="lg" />
          </div>
        ) : (
          <>
            <div className="ehi-card p-4 space-y-3">
              <div className="text-[11px] font-bold text-[var(--color-muted)] uppercase tracking-widest">Add Category</div>
              <div className="flex items-end gap-2">
                <TextField
                  containerClassName="flex-1"
                  placeholder="e.g. Fuel"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                />
                <Button
                  variant="primary"
                  iconLeft={Plus}
                  onClick={handleAdd}
                  loading={adding}
                  disabled={!newName.trim()}
                  aria-label="Add expense category"
                />
              </div>
            </div>

            <div className="space-y-2">
              {categories.map(c => (
                <div key={c.id} className="ehi-card p-3.5 flex items-center gap-3">
                  <button
                    onClick={() => handleDelete(c)}
                    aria-label={`Remove ${c.name}`}
                    className="p-1.5 bg-[var(--color-error-bg)] hover:bg-[var(--color-error-border)] rounded-lg text-[var(--color-error-fg)] transition-colors shrink-0"
                  >
                    <Trash2 size={13} strokeWidth={1.5} />
                  </button>
                  <div className="w-8 h-8 bg-[var(--color-surface-2)] rounded-lg flex items-center justify-center shrink-0">
                    <Receipt size={15} strokeWidth={1.5} className="text-[var(--color-muted)]" />
                  </div>
                  <span className="flex-1 font-sans font-semibold text-[13px] text-[var(--color-foreground)]">{c.name}</span>
                  <button
                    onClick={() => handleToggleActive(c)}
                    aria-label={c.active ? `Deactivate ${c.name}` : `Activate ${c.name}`}
                    className="shrink-0 rounded-full cursor-pointer"
                  >
                    <Badge tone={c.active ? 'success' : 'neutral'}>
                      <Power size={10} /> {c.active ? 'Active' : 'Inactive'}
                    </Badge>
                  </button>
                </div>
              ))}
              {categories.length === 0 && (
                <div className="text-[12px] text-[var(--color-muted)] italic text-center py-8">
                  No expense categories configured yet.
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
};
