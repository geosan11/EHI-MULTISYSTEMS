import { useState, useEffect } from 'react';
import { Tag, Plus, Trash2, Power, Sparkles, Layers, Ruler, Pencil } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/ToastContext';
import { useConfirm } from '../../lib/ConfirmContext';
import { Badge, Button, PageHeader, Spinner, TextField } from '../ui';

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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

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

  // Same optimistic-with-rollback pattern as the toggle handlers below.
  // content_type on cargo_entries/package_entries is a denormalized text
  // copy of the name at entry time, not a live FK -- so renaming here only
  // affects the dropdown staff see for NEW entries going forward; existing
  // entries keep whatever text they were given at creation, same as
  // deactivating one already only affects new entries.
  const handleRename = async (t: ContentType) => {
    const trimmed = editValue.trim();
    setEditingId(null);
    if (!trimmed || trimmed === t.name) return;
    const prev = types;
    setTypes(cur => cur.map(x => x.id === t.id ? { ...x, name: trimmed } : x).sort((a, b) => a.name.localeCompare(b.name)));
    const { error } = await supabase.from('content_types').update({ name: trimmed, updated_at: new Date().toISOString() }).eq('id', t.id);
    if (error) {
      setTypes(prev);
      showToast({ message: `Failed to rename to ${trimmed}: ${error.message}`, type: 'error' });
    }
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
    <main className="flex flex-col h-full bg-[var(--color-canvas)] overflow-y-auto">
      <PageHeader title="Content Types" subtitle="Synced across all devices" onBack={onBack} />

      <div className="ehi-page-body px-4 pt-4 pb-6 space-y-3">
        <div className="bg-[var(--color-info-bg)] border border-[var(--color-info-border)] rounded-xl p-3">
          <p className="text-[11px] text-[var(--color-accent-cobalt)] font-sans leading-relaxed">
            These are the cargo/package content categories staff pick from at intake. Deactivating one hides
            it from new entries without touching existing ones. "Other" always stays available for a
            one-off free-text entry and isn't a row here.
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner size="lg" />
          </div>
        ) : (
          <>
            <div className="ehi-card p-4 space-y-3">
              <div className="text-[11px] font-bold text-[var(--color-muted)] uppercase tracking-widest">Add Content Type</div>
              <div className="flex items-end gap-2">
                <TextField
                  containerClassName="flex-1"
                  placeholder="e.g. Auto Parts"
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
                  aria-label="Add content type"
                />
              </div>
            </div>

            <div className="space-y-2">
              {types.map(t => (
                <div key={t.id} className="ehi-card p-3.5 space-y-2">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => handleDelete(t)}
                      aria-label={`Remove ${t.name}`}
                      className="p-1.5 bg-[var(--color-error-bg)] hover:bg-[var(--color-error-border)] rounded-lg text-[var(--color-error-fg)] transition-colors shrink-0"
                    >
                      <Trash2 size={13} strokeWidth={1.5} />
                    </button>
                    <div className="w-8 h-8 bg-[var(--color-surface-2)] rounded-lg flex items-center justify-center shrink-0">
                      <Tag size={15} strokeWidth={1.5} className="text-[var(--color-muted)]" />
                    </div>
                    {editingId === t.id ? (
                      <input
                        type="text"
                        autoFocus
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        // onBlur is the single commit path -- an input
                        // that's still focused when it unmounts (which
                        // setEditingId(null) causes on the next render)
                        // fires a real blur event as part of that removal,
                        // so calling handleRename directly from onKeyDown
                        // too would double-fire it. Both keys act through
                        // blur() instead of racing it: Escape resets
                        // editValue back to t.name first, so the resulting
                        // handleRename call hits its own no-op guard.
                        onBlur={() => handleRename(t)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.currentTarget.blur(); }
                          if (e.key === 'Escape') { setEditValue(t.name); e.currentTarget.blur(); }
                        }}
                        className="flex-1 ehi-input py-1"
                      />
                    ) : (
                      <button
                        onClick={() => { setEditingId(t.id); setEditValue(t.name); }}
                        aria-label={`Rename ${t.name}`}
                        className="flex-1 flex items-center gap-1.5 group/name text-left"
                      >
                        <span className="font-sans font-semibold text-[13px] text-[var(--color-foreground)]">{t.name}</span>
                        <Pencil size={11} strokeWidth={1.5} className="text-[var(--color-muted)] opacity-0 group-hover/name:opacity-100 transition-opacity shrink-0" />
                      </button>
                    )}
                    <button
                      onClick={() => handleToggleActive(t)}
                      aria-label={t.active ? `Deactivate ${t.name}` : `Activate ${t.name}`}
                      className="shrink-0 rounded-full cursor-pointer"
                    >
                      <Badge tone={t.active ? 'success' : 'neutral'}>
                        <Power size={10} /> {t.active ? 'Active' : 'Inactive'}
                      </Badge>
                    </button>
                  </div>
                  <div className="flex items-center gap-2 pl-11">
                    {/* Flag toggles -- longer "Mark X" labels than a status Badge
                        wants, kept as plain tokenised pills. */}
                    <button
                      onClick={() => handleToggleSpecialGoods(t)}
                      aria-label={t.is_special_goods ? `Unflag ${t.name} as special goods` : `Flag ${t.name} as special goods`}
                      className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold shrink-0 transition-colors ${
                        t.is_special_goods
                          ? 'bg-[var(--color-amber-bg)] text-[var(--color-amber-fg)]'
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
                          ? 'bg-[var(--color-info-bg)] text-[var(--color-info-fg)]'
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
                          ? 'bg-[var(--color-info-bg)] text-[var(--color-info-fg)]'
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
                  {[t.is_special_goods, t.is_flat_tier, t.is_size_tier].filter(Boolean).length > 1 && (
                    // CargoForm.tsx's autoAmount silently prioritizes
                    // size tier > flat tier > special-goods/per-kg for any
                    // one content type -- not a double-charge, but with more
                    // than one flag set here, whichever bracket an admin
                    // configures for a LOWER-priority flag is silently
                    // ignored with no indication anything's wrong.
                    <div className="ml-11 px-2.5 py-1.5 rounded-lg bg-[var(--color-amber-bg)] border border-[var(--color-amber-border)] text-[10px] font-mono text-[var(--color-amber-fg)] leading-relaxed">
                      Multiple pricing modes flagged -- only {t.is_size_tier ? 'Size Tier' : t.is_flat_tier ? 'Flat Tier' : 'Special Goods'} rates actually apply to "{t.name}" (size beats flat beats special-goods/per-kg); the others are configured but silently ignored.
                    </div>
                  )}
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
