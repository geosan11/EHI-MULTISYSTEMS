import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useConfirm } from '../lib/ConfirmContext';

export interface KgTier {
  id: string;
  min_kg: number;
  max_kg: number | null;
  price: number;
}

// Shared kg-range tier list editor used by SpecialGoodsRates.tsx (price =
// rate_per_kg) and MinimumCharges.tsx (price = minimum_amount) -- both
// screens need the same "add/edit/delete a sorted list of [min_kg, max_kg]
// brackets with one price value" UI once a content-type+airline or
// airline+route pair is selected, differing only in labels and what the
// price represents.
export const KgTierEditor = ({
  tiers,
  priceLabel,
  priceUnit,
  onAdd,
  onUpdateField,
  onDelete,
  itemLabel = 'tier',
  unitLabel = 'KG',
}: {
  tiers: KgTier[];
  priceLabel: string;
  priceUnit: string;
  onAdd: (tier: { min_kg: number; max_kg: number | null; price: number }) => Promise<void>;
  onUpdateField: (id: string, field: 'min_kg' | 'max_kg' | 'price', value: number | null) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  itemLabel?: string;
  // Bracket unit shown in the MIN/MAX labels below -- the underlying
  // min_kg/max_kg fields stay generic numeric ranges regardless (e.g.
  // SizeTierRates.tsx maps its min_inches/max_inches into these same
  // fields and passes unitLabel="IN" so the labels read correctly).
  unitLabel?: string;
}) => {
  const [newMin, setNewMin] = useState('');
  const [newMax, setNewMax] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [adding, setAdding] = useState(false);
  const confirm = useConfirm();

  const sorted = [...tiers].sort((a, b) => a.min_kg - b.min_kg);

  const handleAdd = async () => {
    const min_kg = parseFloat(newMin);
    const max_kg = newMax.trim() === '' ? null : parseFloat(newMax);
    const price = parseFloat(newPrice);
    if (isNaN(min_kg) || min_kg < 0 || isNaN(price)) return;
    if (max_kg != null && (isNaN(max_kg) || max_kg < min_kg)) return;
    setAdding(true);
    await onAdd({ min_kg, max_kg, price });
    setAdding(false);
    setNewMin('');
    setNewMax('');
    setNewPrice('');
  };

  const handleDelete = async (id: string) => {
    const ok = await confirm({
      title: `Remove ${itemLabel}?`,
      message: `This bracket will no longer apply to new entries.`,
      confirmLabel: 'Remove',
      tone: 'danger',
    });
    if (!ok) return;
    await onDelete(id);
  };

  return (
    <div className="space-y-3">
      <div className="ehi-card p-4 space-y-3">
        <div className="text-[11px] font-bold text-[var(--color-muted)] uppercase tracking-widest">Add {unitLabel === 'KG' ? 'Weight' : 'Size'} Bracket</div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label htmlFor="tier-min" className="text-[9px] font-mono text-[var(--color-muted)] block mb-1">MIN {unitLabel}</label>
            <input id="tier-min" type="number" value={newMin} onChange={(e) => setNewMin(e.target.value)} placeholder="0" className="w-full ehi-input" />
          </div>
          <div>
            <label htmlFor="tier-max" className="text-[9px] font-mono text-[var(--color-muted)] block mb-1">MAX {unitLabel} (blank = &amp; up)</label>
            <input id="tier-max" type="number" value={newMax} onChange={(e) => setNewMax(e.target.value)} placeholder="45" className="w-full ehi-input" />
          </div>
          <div>
            <label htmlFor="tier-price" className="text-[9px] font-mono text-[var(--color-muted)] block mb-1">{priceLabel}</label>
            <input id="tier-price" type="number" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} className="w-full ehi-input" />
          </div>
        </div>
        <button
          onClick={handleAdd}
          disabled={!newMin.trim() || !newPrice.trim() || adding}
          className="w-full h-10 bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] rounded-lg text-[12px] font-bold disabled:opacity-40 flex items-center justify-center gap-2"
        >
          <Plus size={14} /> {adding ? 'Adding...' : 'Add Bracket'}
        </button>
      </div>

      <div className="space-y-2">
        {sorted.map(t => (
          <div key={t.id} className="ehi-card p-3.5 flex items-center gap-2">
            <button
              onClick={() => handleDelete(t.id)}
              aria-label="Remove bracket"
              className="p-1.5 bg-[rgba(239,68,68,0.08)] hover:bg-[rgba(239,68,68,0.18)] rounded-lg text-[var(--color-error)] transition-colors shrink-0"
            >
              <Trash2 size={13} strokeWidth={1.5} />
            </button>
            <div className="flex-1 grid grid-cols-3 gap-2">
              <div>
                <label htmlFor={`min-${t.id}`} className="text-[9px] font-mono text-[var(--color-muted)] block mb-1">MIN {unitLabel}</label>
                <input
                  id={`min-${t.id}`}
                  type="number"
                  defaultValue={t.min_kg}
                  key={`min-${t.id}-${t.min_kg}`}
                  onBlur={(e) => e.target.value !== '' && onUpdateField(t.id, 'min_kg', parseFloat(e.target.value))}
                  className="w-full ehi-input font-mono"
                />
              </div>
              <div>
                <label htmlFor={`max-${t.id}`} className="text-[9px] font-mono text-[var(--color-muted)] block mb-1">MAX {unitLabel}</label>
                <input
                  id={`max-${t.id}`}
                  type="number"
                  defaultValue={t.max_kg ?? ''}
                  key={`max-${t.id}-${t.max_kg}`}
                  placeholder="& up"
                  onBlur={(e) => onUpdateField(t.id, 'max_kg', e.target.value === '' ? null : parseFloat(e.target.value))}
                  className="w-full ehi-input font-mono"
                />
              </div>
              <div>
                <label htmlFor={`price-${t.id}`} className="text-[9px] font-mono text-[var(--color-muted)] block mb-1">{priceUnit}</label>
                <input
                  id={`price-${t.id}`}
                  type="number"
                  defaultValue={t.price}
                  key={`price-${t.id}-${t.price}`}
                  onBlur={(e) => e.target.value !== '' && onUpdateField(t.id, 'price', parseFloat(e.target.value))}
                  className="w-full ehi-input font-mono"
                />
              </div>
            </div>
          </div>
        ))}
        {sorted.length === 0 && (
          <div className="text-[12px] text-[var(--color-muted)] italic text-center py-8">
            No weight brackets configured yet.
          </div>
        )}
      </div>
    </div>
  );
};
