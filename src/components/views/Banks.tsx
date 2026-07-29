import { useState, useEffect } from 'react';
import { Landmark, Plus, Trash2, Loader, Power } from 'lucide-react';
import { BackButton } from '../BackButton';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/ToastContext';
import { useConfirm } from '../../lib/ConfirmContext';

interface BankRow {
  id: string;
  name: string;
  csv_format: string | null;
  active: boolean;
}

export const Banks = ({ onBack }: { onBack: () => void }) => {
  const [banks, setBanks] = useState<BankRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);

  const { showToast } = useToast();
  const confirm = useConfirm();

  const fetchBanks = async () => {
    const { data, error } = await supabase
      .from('banks')
      .select('*')
      .order('name');
    if (error) {
      showToast({ message: `Failed to load banks: ${error.message}`, type: 'error' });
    } else {
      setBanks(data || []);
    }
    setLoading(false);
  };

  useEffect(() => { fetchBanks(); }, []);

  const handleAdd = async () => {
    const name = newName.trim();
    if (!name) return;
    setAdding(true);
    const { data, error } = await supabase.from('banks').insert({ name }).select().single();
    setAdding(false);
    if (error) {
      showToast({ message: `Failed to add ${name}: ${error.message}`, type: 'error' });
      return;
    }
    setBanks(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
    setNewName('');
  };

  // Optimistic update -- rolls back on failure so the screen never shows a
  // state that isn't actually saved (same pattern as ExcessBaggageAirlines/ContentTypes).
  const handleToggleActive = async (b: BankRow) => {
    const prev = banks;
    setBanks(cur => cur.map(x => x.id === b.id ? { ...x, active: !x.active } : x));
    const { error } = await supabase.from('banks').update({ active: !b.active, updated_at: new Date().toISOString() }).eq('id', b.id);
    if (error) {
      setBanks(prev);
      showToast({ message: `Failed to save change: ${error.message}`, type: 'error' });
    }
  };

  const handleDelete = async (b: BankRow) => {
    const ok = await confirm({
      title: 'Remove bank?',
      message: `Remove "${b.name}"? Existing transactions keep it on record, but staff can no longer pick it for new ones.`,
      confirmLabel: 'Remove',
      tone: 'danger',
    });
    if (!ok) return;
    const { error } = await supabase.from('banks').delete().eq('id', b.id);
    if (error) {
      showToast({ message: `Failed to remove ${b.name}: ${error.message}`, type: 'error' });
      return;
    }
    setBanks(prev => prev.filter(x => x.id !== b.id));
    showToast({ message: `${b.name} removed`, type: 'success' });
  };

  return (
    <main className="flex flex-col h-full bg-[var(--color-obsidian)] overflow-y-auto">
      <div className="ehi-view-header">
        <BackButton onClick={onBack} />
        <div className="text-center">
          <div className="text-[12px] font-bold text-[var(--color-foreground)]">Banks</div>
          <div className="text-[10px] font-mono text-[var(--color-muted)]">Synced across all devices</div>
        </div>
        <div className="w-8" />
      </div>

      <div className="ehi-page-body px-4 pt-4 pb-6 space-y-3">
        <div className="bg-[rgba(59,130,246,0.08)] border border-[rgba(59,130,246,0.2)] rounded-xl p-3" style={{ boxShadow: 'var(--shadow-sm)' }}>
          <p className="text-[11px] text-[var(--color-accent-cobalt)] font-sans leading-relaxed">
            These are the banks staff pick from for Transfer/POS payments across Cargo, Marketing,
            Package and Excess Baggage. Banks added here won't automatically get CSV statement
            auto-matching in Bank Reconciliation -- that needs a developer to add a parser for the new
            format first.
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader size={20} className="animate-spin text-[var(--color-accent-amber)]" />
          </div>
        ) : (
          <>
            <div className="ehi-card p-4 space-y-3">
              <div className="text-[11px] font-bold text-[var(--color-muted)] uppercase tracking-widest">Add Bank</div>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="e.g. Moniepoint"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                  className="flex-1 ehi-input"
                />
                <button
                  onClick={handleAdd}
                  disabled={!newName.trim() || adding}
                  aria-label="Add bank"
                  className="px-3 h-10 bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] rounded-lg font-bold disabled:opacity-40 hover:opacity-90 transition-opacity"
                >
                  <Plus size={15} />
                </button>
              </div>
            </div>

            <div className="space-y-2">
              {banks.map(b => (
                <div key={b.id} className="ehi-card p-3.5 flex items-center gap-3">
                  <button
                    onClick={() => handleDelete(b)}
                    aria-label={`Remove ${b.name}`}
                    className="p-1.5 bg-[rgba(239,68,68,0.08)] hover:bg-[rgba(239,68,68,0.18)] rounded-lg text-[var(--color-error)] transition-colors shrink-0"
                  >
                    <Trash2 size={13} strokeWidth={1.5} />
                  </button>
                  <div className="w-8 h-8 bg-[var(--color-surface-2)] rounded-lg flex items-center justify-center shrink-0">
                    <Landmark size={15} strokeWidth={1.5} className="text-[var(--color-muted)]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-sans font-semibold text-[13px] text-[var(--color-foreground)] truncate">{b.name}</div>
                    {b.csv_format && (
                      <div className="text-[10px] font-mono text-[var(--color-muted)]">CSV auto-match supported</div>
                    )}
                  </div>
                  <button
                    onClick={() => handleToggleActive(b)}
                    aria-label={b.active ? `Deactivate ${b.name}` : `Activate ${b.name}`}
                    className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold shrink-0 transition-colors ${
                      b.active
                        ? 'bg-[rgba(34,197,94,0.1)] text-[var(--color-success)]'
                        : 'bg-[var(--color-surface-2)] text-[var(--color-muted)]'
                    }`}
                  >
                    <Power size={11} /> {b.active ? 'Active' : 'Inactive'}
                  </button>
                </div>
              ))}
              {banks.length === 0 && (
                <div className="text-[12px] text-[var(--color-muted)] italic text-center py-8">
                  No banks configured yet.
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
};
