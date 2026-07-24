import { useState, useEffect } from 'react';
import { Tag, Plus, Trash2, Loader, Power, Sparkles, Layers, Ruler } from 'lucide-react';
import { BackButton } from '../BackButton';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/ToastContext';
import { useConfirm } from '../../lib/ConfirmContext';

interface ContentType {
  id: string;
  name: string;
  active: boolean;
  is_special_goods: boolean;
  is_flat_tier: boolean;
  is_size_tier: boolean;
}

export const ContentTypes = ({ onBack, onManageRates }: { onBack: () => void; onManageRates?: (contentTypeId: string, rateType?: 'special' | 'flat' | 'size') => void }) => {
  const [types, setTypes] = useState<ContentType[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);

  const { showToast } = useToast();
  const confirm = useConfirm();

  const fetchTypes = async () => {
    const { data, error } = await supabase
      .from('content_types')
      .select('*')
      .order('name');
    if (error) {
      showToast({ message: `Failed to load content types: ${error.message}`, type: 'error' });
    } else {
      setTypes(data || []);
    }
    setLoading(false);
  };

  useEffect(() => { fetchTypes(); }, []);

  const handleAdd = async () => {
    const name = newName.trim();
    if (!name) return;
    setAdding(true);
    const { data, error } = await supabase.from('content_types').insert({ name }).select().single();
    setAdding(false);
    if (error) {
      showToast({ message: `Failed to add ${name}: ${error.message}`, type: 'error' });
      return;
    }
    setTypes(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
    setNewName('');
  };

  // Optimistic update -- rolls back on failure so the screen never shows a
  // state that isn't actually saved (same pattern as ExcessBaggageAirlines).
  const handleToggleActive = async (t: ContentType) => {
    const prev = types;
    setTypes(cur => cur.map(x => x.id === t.id ? { ...x, active: !x.active } : x));
    const { error } = await supabase.from('content_types').update({ active: !t.active, updated_at: new Date().toISOString() }).eq('id', t.id);
    if (error) {
      setTypes(prev);
      showToast({ message: `Failed to save change: ${error.message}`, type: 'error' });
    }
  };

  // Same optimistic pattern as handleToggleActive/handleToggleSpecialGoods/
  // handleToggleFlatTier below.
  const handleToggleSizeTier = async (t: ContentType) => {
    const prev = types;
    setTypes(cur => cur.map(x => x.id === t.id ? { ...x, is_size_tier: !x.is_size_tier } : x));
    const { error } = await supabase.from('content_types').update({ is_size_tier: !t.is_size_tier, updated_at: new Date().toISOString() }).eq('id', t.id);
    if (error) {
      setTypes(prev);
      showToast({ message: `Failed to save change: ${error.message}`, type: 'error' });
    }
  };

  // Same optimistic pattern as handleToggleActive above.
  const handleToggleSpecialGoods = async (t: ContentType) => {
    const prev = types;
    setTypes(cur => cur.map(x => x.id === t.id ? { ...x, is_special_goods: !x.is_special_goods } : x));
    const { error } = await supabase.from('content_types').update({ is_special_goods: !t.is_special_goods, updated_at: new Date().toISOString() }).eq('id', t.id);
    if (error) {
      setTypes(prev);
      showToast({ message: `Failed to save change: ${error.message}`, type: 'error' });
    }
  };

  // Same optimistic pattern as handleToggleActive/handleToggleSpecialGoods above.
  const handleToggleFlatTier = async (t: ContentType) => {
    const prev = types;
    setTypes(cur => cur.map(x => x.id === t.id ? { ...x, is_flat_tier: !x.is_flat_tier } : x));
    const { error } = await supabase.from('content_types').update({ is_flat_tier: !t.is_flat_tier, updated_at: new Date().toISOString() }).eq('id', t.id);
    if (error) {
      setTypes(prev);
      showToast({ message: `Failed to save change: ${error.message}`, type: 'error' });
    }
  };

  const handleDelete = async (t: ContentType) => {
    const ok = await confirm({
      title: 'Remove content type?',
      message: `Remove "${t.name}"? Existing entries keep it, but staff can no longer pick it for new ones.`,
      confirmLabel: 'Remove',
      tone: 'danger',
    });
    if (!ok) return;
    const { error } = await supabase.from('content_types').delete().eq('id', t.id);
    if (error) {
      showToast({ message: `Failed to remove ${t.name}: ${error.message}`, type: 'error' });
      return;
    }
    setTypes(prev => prev.filter(x => x.id !== t.id));
    showToast({ message: `${t.name} removed`, type: 'success' });
  };

  return (
    <main className="flex flex-col h-full bg-[var(--color-obsidian)] overflow-y-auto">
      <div className="ehi-view-header">
        <BackButton onClick={onBack} />
        <div className="text-center">
          <div className="text-[12px] font-bold text-[var(--color-foreground)]">Content Types</div>
          <div className="text-[10px] font-mono text-[var(--color-muted)]">Synced across all devices</div>
        </div>
        <div className="w-8" />
      </div>

      <div className="ehi-page-body px-4 pt-4 pb-6 space-y-3">
        <div className="bg-[rgba(59,130,246,0.08)] border border-[rgba(59,130,246,0.2)] rounded-xl p-3">
          <p className="text-[11px] text-[var(--color-accent-cobalt)] font-sans leading-relaxed">
            These are the cargo/package content categories staff pick from at intake. Deactivating one hides
            it from new entries without touching existing ones. "Other" always stays available for a
            one-off free-text entry and isn't a row here.
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader size={20} className="animate-spin text-[var(--color-accent-amber)]" />
          </div>
        ) : (
          <>
            <div className="ehi-card p-4 space-y-3">
              <div className="text-[11px] font-bold text-[var(--color-muted)] uppercase tracking-widest">Add Content Type</div>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="e.g. Auto Parts"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                  className="flex-1 ehi-input"
                />
                <button
                  onClick={handleAdd}
                  disabled={!newName.trim() || adding}
                  aria-label="Add content type"
                  className="px-3 h-10 bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] rounded-lg font-bold disabled:opacity-40 hover:opacity-90 transition-opacity"
                >
                  <Plus size={15} />
                </button>
              </div>
            </div>

            <div className="space-y-2">
              {types.map(t => (
                <div key={t.id} className="ehi-card p-3.5 space-y-2">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => handleDelete(t)}
                      aria-label={`Remove ${t.name}`}
                      className="p-1.5 bg-[rgba(239,68,68,0.08)] hover:bg-[rgba(239,68,68,0.18)] rounded-lg text-[var(--color-error)] transition-colors shrink-0"
                    >
                      <Trash2 size={13} strokeWidth={1.5} />
                    </button>
                    <div className="w-8 h-8 bg-[var(--color-surface-2)] rounded-lg flex items-center justify-center shrink-0">
                      <Tag size={15} strokeWidth={1.5} className="text-[var(--color-muted)]" />
                    </div>
                    <span className="flex-1 font-sans font-semibold text-[13px] text-[var(--color-foreground)]">{t.name}</span>
                    <button
                      onClick={() => handleToggleActive(t)}
                      aria-label={t.active ? `Deactivate ${t.name}` : `Activate ${t.name}`}
                      className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold shrink-0 transition-colors ${
                        t.active
                          ? 'bg-[rgba(34,197,94,0.1)] text-[var(--color-success)]'
                          : 'bg-[var(--color-surface-2)] text-[var(--color-muted)]'
                      }`}
                    >
                      <Power size={11} /> {t.active ? 'Active' : 'Inactive'}
                    </button>
                  </div>
                  <div className="flex items-center gap-2 pl-11">
                    <button
                      onClick={() => handleToggleSpecialGoods(t)}
                      aria-label={t.is_special_goods ? `Unflag ${t.name} as special goods` : `Flag ${t.name} as special goods`}
                      className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold shrink-0 transition-colors ${
                        t.is_special_goods
                          ? 'bg-[rgba(245,158,11,0.12)] text-[var(--color-accent-amber)]'
                          : 'bg-[var(--color-surface-2)] text-[var(--color-muted)]'
                      }`}
                    >
                      <Sparkles size={11} /> {t.is_special_goods ? 'Special Goods' : 'Mark Special Goods'}
                    </button>
                    <button
                      onClick={() => handleToggleFlatTier(t)}
                      aria-label={t.is_flat_tier ? `Unflag ${t.name} as flat tier` : `Flag ${t.name} as flat tier`}
                      className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold shrink-0 transition-colors ${
                        t.is_flat_tier
                          ? 'bg-[rgba(59,130,246,0.12)] text-[var(--color-accent-cobalt)]'
                          : 'bg-[var(--color-surface-2)] text-[var(--color-muted)]'
                      }`}
                    >
                      <Layers size={11} /> {t.is_flat_tier ? 'Flat Tier' : 'Mark Flat Tier'}
                    </button>
                    <button
                      onClick={() => handleToggleSizeTier(t)}
                      aria-label={t.is_size_tier ? `Unflag ${t.name} as size tier` : `Flag ${t.name} as size tier`}
                      className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold shrink-0 transition-colors ${
                        t.is_size_tier
                          ? 'bg-[rgba(59,130,246,0.12)] text-[var(--color-accent-cobalt)]'
                          : 'bg-[var(--color-surface-2)] text-[var(--color-muted)]'
                      }`}
                    >
                      <Ruler size={11} /> {t.is_size_tier ? 'Size Tier' : 'Mark Size Tier'}
                    </button>
                    {(t.is_special_goods || t.is_flat_tier || t.is_size_tier) && onManageRates && (
                      <button
                        onClick={() => onManageRates(t.id, t.is_special_goods ? 'special' : t.is_flat_tier ? 'flat' : 'size')}
                        className="text-[10px] font-bold text-[var(--color-accent-cobalt)] hover:opacity-80 transition-opacity"
                      >
                        Manage Rates →
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {types.length === 0 && (
                <div className="text-[12px] text-[var(--color-muted)] italic text-center py-8">
                  No content types configured yet.
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
};
