import { useState, useEffect } from 'react';
import { User } from '../../lib/types';
import { supabase } from '../../lib/supabase';
import { ArrowLeft, Truck, RefreshCw, Loader, Package } from 'lucide-react';

function timeSince(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diffMs / 3600000);
  if (hours < 1) {
    const mins = Math.max(1, Math.floor(diffMs / 60000));
    return `${mins}m ago`;
  }
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export const IncomingToHub = ({ user, onBack }: { user: User; onBack: () => void }) => {
  const [cargoList, setCargoList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchIncoming = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('cargo_entries')
        .select('entry_ref, id, consignee_name, route, total_pcs, total_kg, content_type, airline, awb_tag_number, created_at, status')
        .eq('status', 'In-Transit')
        .order('created_at', { ascending: false })
        .limit(200);

      if (error) { console.error('Incoming fetch error:', error); return; }

      // route is free text (e.g. "Lagos", "Abuja - Zone 2"), not a hub_id
      // foreign key, so destination matching happens client-side against
      // the current hub's name -- same fuzzy-word-match approach already
      // used in scanLogic.ts's isCorrectDestination check, kept consistent
      // rather than inventing a different matching rule for this view.
      const hubWords = user.hub.toLowerCase().split(' ').filter(w => w.length > 3);
      const filtered = (data || []).filter(c => {
        const dest = (c.route || '').toLowerCase();
        return hubWords.some(w => dest.includes(w));
      });

      setCargoList(filtered);
    } catch (err) {
      console.error('Incoming fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchIncoming(); }, [user.hub]);

  return (
    <div className="flex flex-col h-full bg-[var(--color-obsidian)] text-[var(--color-foreground)] overflow-hidden">
      <div className="ehi-view-header">
        <button onClick={onBack} className="flex items-center gap-1.5 text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors">
          <ArrowLeft size={15} />
          <span className="text-[11px] font-mono">Back</span>
        </button>
        <span className="text-[10px] font-mono text-[var(--color-accent-cobalt)] tracking-widest font-bold">● INCOMING</span>
        <button onClick={fetchIncoming} className="p-1.5 rounded hover:bg-[var(--color-surface-2)] transition-colors">
          <RefreshCw size={14} className={`text-[var(--color-muted)] ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="px-4 py-3 text-[11px] font-sans text-[var(--color-muted)] border-b border-[var(--color-border)]">
        Cargo departed elsewhere, heading to <strong className="text-[var(--color-foreground)]">{user.hub}</strong> — not yet scanned as arrived
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="ehi-page-body px-4 py-4 space-y-3">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader size={22} className="animate-spin text-[var(--color-accent-cobalt)]" />
            </div>
          ) : cargoList.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 border border-dashed border-[rgba(255,255,255,0.08)] rounded-xl">
              <Truck size={32} className="text-[var(--color-muted)] mb-3 opacity-40" />
              <p className="text-[13px] font-sans font-medium text-[var(--color-muted)]">
                Nothing currently in transit to this hub.
              </p>
            </div>
          ) : cargoList.map((c, i) => (
            <div key={c.id || i} className="ehi-card p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div className="space-y-1 min-w-0">
                <div className="text-[15px] font-bold text-[var(--color-foreground)] font-sans">{c.consignee_name}</div>
                <div className="text-[10px] font-mono text-[var(--color-muted)]">
                  <span className="text-[var(--color-accent-cobalt)]">{c.entry_ref || c.id}</span>
                  {c.awb_tag_number && <span className="ml-2 text-[var(--color-muted)]">· AWB {c.awb_tag_number}</span>}
                  {c.airline && <span className="ml-2 text-[var(--color-muted)]">· {c.airline}</span>}
                </div>
                <div className="text-[12px] font-sans text-[var(--color-muted)]">
                  {c.route || '—'} &nbsp;·&nbsp; {c.total_pcs || '?'} pcs &nbsp;·&nbsp; {c.total_kg || '?'} kg &nbsp;·&nbsp; {c.content_type || 'Package'}
                </div>
              </div>
              <div className="shrink-0 flex items-center gap-1.5 text-[var(--color-accent-cobalt)] text-[11px] font-bold font-mono">
                <Package size={14} /> {timeSince(c.created_at)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
