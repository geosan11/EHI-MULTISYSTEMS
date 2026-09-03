import { useState, useEffect } from 'react';
import { User } from '../../lib/types';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/ToastContext';
import { RefreshCw, CheckCircle2 } from 'lucide-react';
import { PageHeader, Spinner } from '../ui';

function timeSince(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diffMs / 3600000);
  if (hours < 1) {
    const mins = Math.max(1, Math.floor(diffMs / 60000));
    return `${mins}m`;
  }
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

type Source = 'Cargo' | 'Marketing' | 'Package';

interface OutboundArrivalRow {
  key: string;
  source: Source;
  entryRef: string;
  customerName: string;
  destinationLabel: string;
  pcs?: number;
  kg?: number;
  awb?: string;
  airline?: string;
  contentType?: string;
  createdAt: string;
}

export const OutboundArrivals = ({ user, onBack }: { user: User; onBack: () => void }) => {
  const [rows, setRows] = useState<OutboundArrivalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const { showToast } = useToast();

  const fetchArrivals = async () => {
    setLoading(true);
    try {
      const isAdmin = ['super_admin', 'admin', 'accountant', 'auditor'].includes(user.role);
      const addHubFilter = (q: any) => (!isAdmin && user.hub_id) ? q.eq('hub_id', user.hub_id) : q;

      const [cargoRes, mktRes, pkgRes] = await Promise.all([
        addHubFilter(
          supabase.from('cargo_entries')
            .select('id, entry_ref, consignee_name, route, awb_tag_number, total_pcs, total_kg, content_type, airline, hub_id, status, created_at')
            .eq('status', 'Arrived')
        ).order('created_at', { ascending: false }).limit(200),
        addHubFilter(
          supabase.from('marketing_entries')
            .select('id, entry_ref, customer_name, route, awb_tag_number, qty_big_bag, qty_med_bag, qty_small_bag, hub_id, status, created_at')
            .eq('status', 'Arrived')
        ).order('created_at', { ascending: false }).limit(200),
        addHubFilter(
          supabase.from('package_entries')
            .select('id, entry_ref, customer_name, destination, content_type, contents, total_pcs, total_kg, hub_id, status, created_at')
            .eq('status', 'Arrived')
        ).order('created_at', { ascending: false }).limit(200),
      ]);

      let errorCount = 0;
      const merged: OutboundArrivalRow[] = [];

      if (cargoRes.error) {
        console.error('Outbound arrivals (cargo) fetch error:', cargoRes.error);
        errorCount++;
      } else {
        for (const c of cargoRes.data || []) {
          merged.push({
            key: `Cargo-${c.id}`,
            source: 'Cargo',
            entryRef: c.entry_ref,
            customerName: c.consignee_name,
            destinationLabel: c.route || '—',
            pcs: c.total_pcs,
            kg: c.total_kg,
            awb: c.awb_tag_number,
            airline: c.airline,
            contentType: c.content_type,
            createdAt: c.created_at,
          });
        }
      }

      if (mktRes.error) {
        console.error('Outbound arrivals (marketing) fetch error:', mktRes.error);
        errorCount++;
      } else {
        for (const m of mktRes.data || []) {
          const bags = (m.qty_big_bag || 0) + (m.qty_med_bag || 0) + (m.qty_small_bag || 0);
          merged.push({
            key: `Marketing-${m.id}`,
            source: 'Marketing',
            entryRef: m.entry_ref,
            customerName: m.customer_name,
            destinationLabel: m.route || '—',
            pcs: bags || undefined,
            awb: m.awb_tag_number,
            createdAt: m.created_at,
          });
        }
      }

      if (pkgRes.error) {
        console.error('Outbound arrivals (package) fetch error:', pkgRes.error);
        errorCount++;
      } else {
        for (const p of pkgRes.data || []) {
          merged.push({
            key: `Package-${p.id}`,
            source: 'Package',
            entryRef: p.entry_ref,
            customerName: p.customer_name,
            destinationLabel: p.destination || '—',
            pcs: p.total_pcs,
            kg: p.total_kg,
            contentType: p.content_type || p.contents,
            createdAt: p.created_at,
          });
        }
      }

      merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setRows(merged);

      if (errorCount === 3) {
        showToast({ message: 'Failed to load outbound arrivals. Please try again.', type: 'error' });
      } else if (errorCount > 0) {
        showToast({ message: 'Some outbound arrivals failed to load. Showing what succeeded.', type: 'error' });
      }
    } catch (err) {
      console.error('Outbound arrivals fetch error:', err);
      showToast({ message: 'Failed to load outbound arrivals. Please try again.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchArrivals(); }, [user.hub_id]);

  return (
    <div className="flex flex-col h-full bg-[var(--color-canvas)] text-[var(--color-foreground)] overflow-hidden">
      <PageHeader
        title="Outbound Arrivals"
        onBack={onBack}
        actions={
          <button onClick={fetchArrivals} aria-label="Refresh" className="p-1.5 rounded hover:bg-[var(--color-surface-2)] transition-colors">
            <RefreshCw size={14} className={`text-[var(--color-muted)] ${loading ? 'animate-spin' : ''}`} />
          </button>
        }
      />

      <div className="px-4 py-3 text-[11px] font-sans text-[var(--color-muted)] border-b border-[var(--color-border)]">
        Shipments dispatched from <strong className="text-[var(--color-foreground)]">{user.hub}</strong> — confirmed arrived at destination
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="ehi-page-body px-4 py-4 space-y-3">
          {loading ? (
            <div className="flex justify-center py-12">
              <Spinner size="lg" tone="current" className="text-[var(--color-success)]" />
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 border border-dashed border-[var(--color-border)] rounded-xl">
              <CheckCircle2 size={32} className="text-[var(--color-muted)] mb-3 opacity-40" />
              <p className="text-[13px] font-sans font-medium text-[var(--color-muted)]">
                Nothing dispatched from this hub has been confirmed as arrived yet.
              </p>
            </div>
          ) : rows.map((r) => (
            <div key={r.key} className="ehi-card p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div className="space-y-1 min-w-0">
                <div className="text-[15px] font-bold text-[var(--color-foreground)] font-sans">{r.customerName}</div>
                <div className="text-[10px] font-mono text-[var(--color-muted)]">
                  <span className="text-[var(--color-success)]">{r.entryRef}</span>
                  <span className="ml-2 px-1.5 py-0.5 rounded bg-[var(--color-surface-2)] text-[var(--color-muted)]">{r.source}</span>
                  {r.awb && <span className="ml-2 text-[var(--color-muted)]">· AWB {r.awb}</span>}
                  {r.airline && <span className="ml-2 text-[var(--color-muted)]">· {r.airline}</span>}
                </div>
                <div className="text-[12px] font-sans text-[var(--color-muted)]">
                  {r.destinationLabel} &nbsp;·&nbsp; {r.pcs || '?'} pcs {r.kg ? `· ${r.kg} kg` : ''} &nbsp;·&nbsp; {r.contentType || 'Package'}
                </div>
              </div>
              <div className="shrink-0 flex flex-col items-end gap-0.5">
                <div className="flex items-center gap-1 text-[var(--color-success)] text-[11px] font-bold font-mono">
                  <CheckCircle2 size={12} /> ARRIVED
                </div>
                <div className="text-[10px] font-mono text-[var(--color-muted)]">
                  arrived {timeSince(r.createdAt)} ago
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
