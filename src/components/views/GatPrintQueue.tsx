import { useState, useEffect, useMemo } from 'react';
import { Printer, Loader, CheckCircle2, RefreshCw, Package, Boxes } from 'lucide-react';
import { User } from '../../lib/types';
import { supabase } from '../../lib/supabase';
import { BackButton } from '../BackButton';
import { useToast } from '../../lib/ToastContext';
import { fmt, tnow } from '../../lib/helpers';

type DocType = 'tags' | 'receipts';
type Stream = 'all' | 'cargo' | 'package';

interface Row {
  stream: 'cargo' | 'package';
  entry_ref: string;
  name: string;
  routeOrDestination: string;
  total_pcs: number | null;
  total_kg: number | null;
  amount: number;
  created_at: string;
  // Cargo-only extras (undefined for package rows)
  airline?: string;
  content_type?: string;
  awb_tag_number?: string;
  receipt_mode?: string;
  bank?: string;
  payment_narration?: string;
  remark?: string;
  pickup_pin?: string;
  // Package-only extras
  contents?: string;
  payment_mode?: string;
}

const rowKey = (r: Row) => `${r.stream}:${r.entry_ref}`;
const HUB_LABEL = 'EHI GAT Terminal (Lagos MM1)';

// GAT has no printers -- this screen lets MMA2 batch-print tags/receipts for
// GAT's cargo + package sales. Mirrors OfficeWorkReconciliation.tsx's
// structure (BackButton header, filter row, card list, sticky action button).
export const GatPrintQueue = ({ user, onBack }: { user: User; onBack: () => void }) => {
  const { showToast } = useToast();
  const todayStr = new Date().toISOString().split('T')[0];
  // A "needs printing" queue is inherently not time-bound -- yesterday's
  // unprinted backlog silently vanished once the calendar rolled over,
  // since this defaulted to today only. Default dateFrom 30 days back so
  // backlog doesn't disappear; dateTo still defaults to today.
  const thirtyDaysAgoStr = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  const [dateFrom, setDateFrom] = useState(thirtyDaysAgoStr);
  const [dateTo, setDateTo] = useState(todayStr);
  const [docType, setDocType] = useState<DocType>('tags');
  const [stream, setStream] = useState<Stream>('all');
  const [reprintMode, setReprintMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [printing, setPrinting] = useState(false);
  const [progressText, setProgressText] = useState('');

  const load = async () => {
    setLoading(true);
    setSelected(new Set());
    const fromISO = new Date(`${dateFrom}T00:00:00`).toISOString();
    const toISO = new Date(`${dateTo}T23:59:59`).toISOString();
    const stampCol = docType === 'tags' ? 'tag_printed_at' : 'receipt_printed_at';

    const out: Row[] = [];

    if (stream === 'all' || stream === 'cargo') {
      let q = supabase.from('cargo_entries')
        .select('entry_ref, consignee_name, route, total_pcs, total_kg, amount, airline, content_type, awb_tag_number, receipt_mode, bank, payment_narration, remark, pickup_pin, created_at, tag_printed_at, receipt_printed_at')
        .eq('terminal', 'GAT')
        .gte('created_at', fromISO)
        .lte('created_at', toISO)
        .order('created_at');
      q = reprintMode ? q.not(stampCol, 'is', null) : q.is(stampCol, null);
      const { data, error } = await q;
      if (error) { showToast({ message: `Failed to load GAT cargo entries: ${error.message}`, type: 'error' }); }
      (data || []).forEach((r: any) => out.push({
        stream: 'cargo',
        entry_ref: r.entry_ref,
        name: r.consignee_name || 'Cargo',
        routeOrDestination: r.route || '',
        total_pcs: r.total_pcs,
        total_kg: r.total_kg,
        amount: r.amount || 0,
        created_at: r.created_at,
        airline: r.airline,
        content_type: r.content_type,
        awb_tag_number: r.awb_tag_number,
        receipt_mode: r.receipt_mode,
        bank: r.bank,
        payment_narration: r.payment_narration,
        remark: r.remark,
        pickup_pin: r.pickup_pin,
      }));
    }

    if (stream === 'all' || stream === 'package') {
      let q = supabase.from('package_entries')
        .select('entry_ref, customer_name, destination, total_pcs, total_kg, amount, content_type, contents, payment_mode, bank, payment_narration, created_at, tag_printed_at, receipt_printed_at')
        .eq('terminal', 'GAT')
        .gte('created_at', fromISO)
        .lte('created_at', toISO)
        .order('created_at');
      q = reprintMode ? q.not(stampCol, 'is', null) : q.is(stampCol, null);
      const { data, error } = await q;
      if (error) { showToast({ message: `Failed to load GAT package entries: ${error.message}`, type: 'error' }); }
      (data || []).forEach((r: any) => out.push({
        stream: 'package',
        entry_ref: r.entry_ref,
        name: r.customer_name || 'Customer',
        routeOrDestination: r.destination || '',
        total_pcs: r.total_pcs,
        total_kg: r.total_kg,
        amount: r.amount || 0,
        created_at: r.created_at,
        content_type: r.content_type,
        contents: r.contents,
        payment_mode: r.payment_mode,
        bank: r.bank,
        payment_narration: r.payment_narration,
      }));
    }

    out.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    setRows(out);
    setLoading(false);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [dateFrom, dateTo, docType, stream, reprintMode]);

  const toggle = (key: string) => setSelected(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const allSelected = rows.length > 0 && rows.every(r => selected.has(rowKey(r)));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map(rowKey)));

  const printOne = async (row: Row, serial: number) => {
    const date = `${new Date().toLocaleDateString('en-GB')} ${tnow()}`;
    if (row.stream === 'cargo' && docType === 'tags') {
      const { printCargoTagPDF } = await import('./CargoTagPDF');
      await printCargoTagPDF({
        id: row.awb_tag_number || row.entry_ref,
        name: row.name,
        route: row.routeOrDestination,
        pieces: row.total_pcs || 1,
        weight: row.total_kg || 0,
        airline: row.airline,
        hubName: HUB_LABEL,
        date,
        contentType: row.content_type,
      });
    } else if (row.stream === 'cargo' && docType === 'receipts') {
      const { printCargoReceipt } = await import('./CargoReceipt');
      await printCargoReceipt({
        entryRef: row.entry_ref,
        serialNumber: serial,
        date,
        hubName: HUB_LABEL,
        agentName: user.name,
        airline: row.airline || '',
        consignee: row.name,
        awbTagNumber: row.awb_tag_number || row.entry_ref,
        pieces: row.total_pcs || 1,
        kg: row.total_kg || 0,
        route: row.routeOrDestination,
        contentType: row.content_type || '',
        amount: row.amount,
        paymentMode: row.receipt_mode || 'Cash',
        bankName: row.bank || undefined,
        paymentNarration: row.payment_narration || undefined,
        remark: row.remark || undefined,
        pickupPin: row.pickup_pin || undefined,
      });
    } else if (row.stream === 'package' && docType === 'tags') {
      const { printPackageTagPDF } = await import('./PackageTagPDF');
      await printPackageTagPDF({
        id: row.entry_ref,
        name: row.name,
        destination: row.routeOrDestination,
        contentType: row.content_type || 'Package',
        pieces: row.total_pcs || undefined,
        kg: row.total_kg || undefined,
        contents: row.contents,
        hubName: HUB_LABEL,
        date,
      });
    } else if (row.stream === 'package' && docType === 'receipts') {
      const { downloadPackageReceipt } = await import('./PackageReceipt');
      await downloadPackageReceipt({
        entryRef: row.entry_ref,
        date,
        agentName: user.name,
        customerName: row.name,
        destination: row.routeOrDestination,
        contentType: row.content_type || 'Package',
        pieces: row.total_pcs || undefined,
        kg: row.total_kg || undefined,
        contents: row.contents,
        amount: row.amount,
        paymentMode: row.payment_mode || 'Cash',
        paymentNarration: row.payment_narration || undefined,
        bankName: row.bank || undefined,
      });
    }
  };

  const handlePrint = async () => {
    const toPrint = rows.filter(r => selected.has(rowKey(r)));
    if (toPrint.length === 0 || printing) return;
    setPrinting(true);
    const stampCol = docType === 'tags' ? 'tag_printed_at' : 'receipt_printed_at';
    let done = 0, failed = 0;
    // Sequential, not Promise.all -- avoids hitting the browser with N
    // simultaneous PDF windows/downloads at once.
    for (let i = 0; i < toPrint.length; i++) {
      const row = toPrint[i];
      setProgressText(`Printing ${i + 1} of ${toPrint.length}…`);
      try {
        await printOne(row, i + 1);
        // Reprint mode never re-stamps -- it's explicitly for entries
        // already marked printed, so the stamp (and the original print
        // date it records) stays untouched.
        if (!reprintMode) {
          const table = row.stream === 'cargo' ? 'cargo_entries' : 'package_entries';
          // Was a plain client .update() -- the SELECT that populates this
          // queue uses the sibling-hub-widened RLS policy, but the UPDATE
          // policy on cargo_entries/package_entries was never widened to
          // match (same bug class already fixed for debt-clearing). A
          // staff member whose own hub differs from the GAT-tagged rows'
          // hub got a false "N printed" toast while this write silently
          // affected 0 rows -- the exact entries reappeared as still
          // needing printing on the next load. mark_gat_printed is a
          // narrow, sibling-hub-authorized RPC (supabase/migrations/
          // 20260903_security_and_bugfix_pass.sql) for exactly this write.
          const { error } = await supabase.rpc('mark_gat_printed', {
            p_table: table,
            p_entry_ref: row.entry_ref,
            p_column: stampCol,
            p_logged_by: user.name,
          });
          if (error) throw error;
        }
        done++;
      } catch (err: any) {
        failed++;
        console.error(`Failed to print ${row.entry_ref}`, err);
      }
    }
    setPrinting(false);
    setProgressText('');
    showToast({ message: `${done} printed${failed ? `, ${failed} failed` : ''}.`, type: failed ? 'warning' : 'success' });
    load();
  };

  const selectedCount = selected.size;
  const cargoCount = useMemo(() => rows.filter(r => r.stream === 'cargo').length, [rows]);
  const packageCount = useMemo(() => rows.filter(r => r.stream === 'package').length, [rows]);

  return (
    <main className="flex-1 flex flex-col h-full bg-[var(--color-bg)] overflow-y-auto">
      <div className="bg-[var(--color-surface-card)] border-b border-[var(--color-border)] p-4">
        <BackButton onClick={onBack} label="Back to Menu" className="mb-3" />
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 bg-[rgba(59,130,246,0.1)] rounded-lg"><Printer size={20} className="text-[var(--color-accent-cobalt)]" /></div>
            <div className="min-w-0">
              <h1 className="text-[16px] font-bold text-[var(--color-foreground)] tracking-tight">GAT Print Queue</h1>
              <p className="text-[11px] font-mono text-[var(--color-muted)] mt-0.5">Batch-print tags &amp; receipts for GAT sales -- GAT has no printers</p>
            </div>
          </div>
          <button onClick={load} className="h-9 w-9 flex items-center justify-center rounded-lg bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-accent-cobalt)]" title="Refresh"><RefreshCw size={14} /></button>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Date range */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 h-9 px-2 bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-lg font-mono text-[11px]">
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="bg-transparent text-[var(--color-foreground)] border-none focus:outline-none" />
            <span className="text-[var(--color-border)]">→</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="bg-transparent text-[var(--color-foreground)] border-none focus:outline-none" />
          </div>

          {/* Doc type */}
          <div className="flex items-center gap-1 h-9 px-1 bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-lg">
            {(['tags', 'receipts'] as const).map(t => (
              <button key={t} onClick={() => setDocType(t)} className={`h-7 px-3 rounded text-[11px] font-bold font-mono capitalize transition-all ${docType === t ? 'bg-[var(--color-accent-cobalt)] text-white' : 'text-[var(--color-muted)] hover:text-[var(--color-foreground)]'}`}>{t}</button>
            ))}
          </div>

          {/* Stream */}
          <div className="flex items-center gap-1 h-9 px-1 bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-lg">
            {([{ v: 'all', l: 'All' }, { v: 'cargo', l: 'Cargo' }, { v: 'package', l: 'Package' }] as const).map(({ v, l }) => (
              <button key={v} onClick={() => setStream(v)} className={`h-7 px-3 rounded text-[11px] font-bold font-mono transition-all ${stream === v ? 'bg-[var(--color-accent-amber)] text-[var(--color-obsidian)]' : 'text-[var(--color-muted)] hover:text-[var(--color-foreground)]'}`}>{l}</button>
            ))}
          </div>

          {/* Reprint mode */}
          <label className="flex items-center gap-1.5 h-9 px-3 bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-lg text-[11px] font-mono text-[var(--color-muted)] cursor-pointer">
            <input type="checkbox" checked={reprintMode} onChange={(e) => setReprintMode(e.target.checked)} />
            Reprint mode (already-printed entries)
          </label>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-[12px] font-mono text-[var(--color-muted)] py-10 justify-center"><Loader size={16} className="animate-spin" /> Loading GAT entries…</div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <CheckCircle2 size={28} className="text-[var(--color-success)]" />
            <div className="text-[13px] font-mono text-[var(--color-muted)]">
              {reprintMode ? 'No printed GAT entries in this range.' : 'No unprinted GAT entries in this range.'}
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-lg px-3 py-2">
              <label className="flex items-center gap-2 text-[11px] font-mono text-[var(--color-muted)] cursor-pointer">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} /> Select all ({rows.length})
              </label>
              <div className="text-[11px] font-mono text-[var(--color-muted)]">
                {cargoCount} cargo &middot; {packageCount} package
              </div>
            </div>

            <div className="space-y-2">
              {rows.map(r => {
                const key = rowKey(r);
                return (
                  <div key={key} className={`rounded-lg border p-3 ${selected.has(key) ? 'border-[var(--color-accent-cobalt)] bg-[rgba(59,130,246,0.06)]' : 'border-[var(--color-border)] bg-[var(--color-surface-1)]'}`}>
                    <div className="flex items-start gap-3">
                      <input type="checkbox" checked={selected.has(key)} onChange={() => toggle(key)} className="mt-1" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {r.stream === 'cargo' ? <Boxes size={12} className="text-[var(--color-accent-cobalt)]" /> : <Package size={12} className="text-[var(--color-accent-amber)]" />}
                          <span className="text-[12px] font-bold text-[var(--color-foreground)]">{r.name}</span>
                          <span className="text-[9px] font-mono text-[var(--color-muted)] uppercase">{r.stream}</span>
                        </div>
                        <div className="text-[10px] font-mono text-[var(--color-muted)] mt-0.5">
                          {r.entry_ref} &middot; {r.routeOrDestination || '—'} &middot; {r.total_pcs || 1}pcs &middot; {r.total_kg || 0}kg &middot; {new Date(r.created_at).toLocaleString('en-GB')}
                        </div>
                      </div>
                      <div className="text-[12px] font-bold font-mono text-[var(--color-foreground)] shrink-0">{fmt(r.amount)}</div>
                    </div>
                  </div>
                );
              })}
            </div>

            <button
              onClick={handlePrint}
              disabled={printing || selectedCount === 0}
              className="w-full h-11 rounded-lg bg-[var(--color-accent-cobalt)] text-white text-[12px] font-bold font-mono disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {printing ? <><Loader size={14} className="animate-spin" /> {progressText || 'Printing…'}</> : `${reprintMode ? 'Reprint' : 'Print'} ${selectedCount} selected ${docType}`}
            </button>
          </>
        )}
      </div>
    </main>
  );
};
