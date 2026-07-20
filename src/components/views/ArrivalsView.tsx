import { useState, useEffect, useRef } from 'react';
import { User } from '../../lib/types';
import { supabase } from '../../lib/supabase';
import { Package, CheckCircle, RefreshCw, Loader, History } from 'lucide-react';
import { BackButton } from '../BackButton';
import { isTagAlreadyDelivered, logScanEvent } from '../../lib/scanLogic';
import { ProofOfDeliveryForm } from './ProofOfDelivery';
import { useToast } from '../../lib/ToastContext';

type MainTab = 'AWAITING' | 'DELIVERED' | 'LOG';
type DateFilter = 'today' | 'yesterday' | '7days';

function getDateRange(filter: DateFilter): { start: string; end?: string } {
  const now = new Date();
  if (filter === 'today') {
    const s = new Date(now); s.setHours(0, 0, 0, 0);
    return { start: s.toISOString() };
  }
  if (filter === 'yesterday') {
    const s = new Date(now); s.setDate(s.getDate() - 1); s.setHours(0, 0, 0, 0);
    const e = new Date(now); e.setHours(0, 0, 0, 0);
    return { start: s.toISOString(), end: e.toISOString() };
  }
  // 7days
  const s = new Date(now); s.setDate(s.getDate() - 7); s.setHours(0, 0, 0, 0);
  return { start: s.toISOString() };
}

function DateChips({ value, onChange }: { value: DateFilter; onChange: (f: DateFilter) => void }) {
  const opts: { key: DateFilter; label: string }[] = [
    { key: 'today', label: 'Today' },
    { key: 'yesterday', label: 'Yesterday' },
    { key: '7days', label: 'Last 7 Days' },
  ];
  return (
    <div className="flex gap-2 px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] shrink-0">
      {opts.map(o => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          className={`px-3 py-1 rounded-full text-[10px] font-mono font-bold transition-colors border cursor-pointer ${
            value === o.key
              ? 'bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] border-[var(--color-accent-amber)]'
              : 'bg-transparent text-[var(--color-muted)] border-[var(--color-border)] hover:border-[var(--color-accent-amber)]'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const ArrivalsView = ({ user, onBack }: { user: User; onBack: () => void }) => {
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<MainTab>(() => {
    return (sessionStorage.getItem('ehi_arrivals_tab') as any) || 'AWAITING';
  });

  useEffect(() => {
    sessionStorage.setItem('ehi_arrivals_tab', activeTab);
  }, [activeTab]);
  const [cargoList, setCargoList] = useState<any[]>([]);
  const [logList, setLogList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [deliveredFilter, setDeliveredFilter] = useState<DateFilter>('today');
  const [logFilter, setLogFilter] = useState<DateFilter>('today');

  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [selectedCargo, setSelectedCargo] = useState<any | null>(null);
  const [pinValue, setPinValue] = useState(['', '', '', '', '']);
  const [pinError, setPinError] = useState('');
  const [releasing, setReleasing] = useState(false);
  // Set once the PIN is verified — swaps the modal for the signature-capture
  // screen. Delivery isn't finalized until that signature is collected, so
  // there's always a proof-of-delivery record even when the consignee has no ID.
  const [activePodCapture, setActivePodCapture] = useState<{ ref: string; cargo: any } | null>(null);

  const firstPinRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (pinModalOpen) setTimeout(() => firstPinRef.current?.focus(), 100);
  }, [pinModalOpen]);

  const isAdmin = ['super_admin', 'admin'].includes(user.role);

  // Both fetchCargo/fetchLog are triggered by the filter-change effect below
  // AND called imperatively (handlePodComplete's refresh, tab switches) --
  // a plain effect-scoped `active` flag can't cover imperative calls, so a
  // shared generation counter is used instead: each call claims the next
  // generation up front, and only applies its result if it's still the
  // latest one by the time the query resolves. Without this, fast filter
  // clicking (Today -> Yesterday -> 7 days) could let an older, slower
  // response land after a newer one and show the wrong filter's data.
  const fetchGenRef = useRef(0);

  // ── Fetch AWAITING or DELIVERED ──────────────────────────────────────────
  const fetchCargo = async () => {
    const myGen = ++fetchGenRef.current;
    setLoading(true);
    try {
      if (activeTab === 'AWAITING') {
        let q = supabase
          .from('cargo_entries')
          .select('entry_ref, id, consignee_name, consignee_phone, route, total_pcs, total_kg, pickup_pin, pin_used_at, status, created_at, hub_id, awb_tag_number')
          .eq('status', 'Arrived')
          .is('pin_used_at', null)
          .order('created_at', { ascending: false });
        if (!isAdmin && user.hub_id) q = q.eq('hub_id', user.hub_id) as any;
        const { data, error } = await q;
        if (fetchGenRef.current !== myGen) return;
        if (!error && data) setCargoList(data);
      } else {
        const range = getDateRange(deliveredFilter);
        let q = supabase
          .from('cargo_entries')
          .select('entry_ref, id, consignee_name, route, total_pcs, total_kg, pin_used_at, status, created_at, hub_id, awb_tag_number')
          .eq('status', 'Delivered')
          .not('pin_used_at', 'is', null)
          .gte('pin_used_at', range.start)
          .order('pin_used_at', { ascending: false })
          .limit(150);
        if (range.end) q = q.lt('pin_used_at', range.end) as any;
        if (!isAdmin && user.hub_id) q = q.eq('hub_id', user.hub_id) as any;
        const { data, error } = await q;
        if (fetchGenRef.current !== myGen) return;
        if (!error && data) setCargoList(data);
      }
    } catch (err) {
      if (fetchGenRef.current !== myGen) return;
      console.error('Arrivals fetch error:', err);
    } finally {
      if (fetchGenRef.current === myGen) setLoading(false);
    }
  };

  // ── Fetch ARRIVAL LOG from tracking_events ───────────────────────────────
  const fetchLog = async () => {
    const myGen = ++fetchGenRef.current;
    setLoading(true);
    try {
      const range = getDateRange(logFilter);
      const hubWords = user.hub.toLowerCase().split(' ').filter(w => w.length >= 3);

      let q = supabase
        .from('tracking_events')
        .select('id, cargo_ref, event_type, hub_name, scanned_by_name, created_at, cargo_destination, alert_reason')
        .in('event_type', ['ARRIVE', 'DEPART', 'DELIVER', 'WRONG_DESTINATION_ALERT'])
        .gte('created_at', range.start)
        .order('created_at', { ascending: false })
        .limit(200);

      if (range.end) q = q.lt('created_at', range.end) as any;

      // Scope non-admins to their own hub's events
      if (!isAdmin && hubWords.length > 0) {
        q = q.or(hubWords.map(w => `hub_name.ilike.%${w}%`).join(',')) as any;
      }

      const { data: events, error } = await q;
      if (fetchGenRef.current !== myGen) return;
      if (error || !events) { setLoading(false); return; }

      // Batch-fetch consignee names for the unique cargo refs
      const refs = [...new Set(events.map((e: any) => e.cargo_ref))];
      let nameMap: Record<string, string> = {};
      if (refs.length > 0) {
        const { data: entries } = await supabase
          .from('cargo_entries')
          .select('entry_ref, consignee_name')
          .in('entry_ref', refs as string[]);
        nameMap = Object.fromEntries((entries || []).map((c: any) => [c.entry_ref, c.consignee_name]));
      }

      if (fetchGenRef.current !== myGen) return;
      setLogList(events.map((e: any) => ({ ...e, consignee_name: nameMap[e.cargo_ref] || null })));
    } catch (err) {
      if (fetchGenRef.current !== myGen) return;
      console.error('Arrival log fetch error:', err);
    } finally {
      if (fetchGenRef.current === myGen) setLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'LOG') fetchLog();
    else fetchCargo();
  }, [activeTab, deliveredFilter, logFilter, user.hub_id]);

  // ── PIN handlers ─────────────────────────────────────────────────────────
  const handlePinChange = (index: number, val: string) => {
    if (!/^\d*$/.test(val)) return;
    const next = [...pinValue];
    next[index] = val.slice(-1);
    setPinValue(next);
    setPinError('');
    if (val && index < 4) document.getElementById(`pin-${index + 1}`)?.focus();
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !pinValue[index] && index > 0) {
      document.getElementById(`pin-${index - 1}`)?.focus();
    }
  };

  const handleConfirmPin = async () => {
    const entered = pinValue.join('');
    if (entered.length !== 5) { setPinError('Enter all 5 digits.'); return; }
    if (!selectedCargo) return;

    setReleasing(true);
    const storedPin = selectedCargo.pickup_pin;

    if (!storedPin) {
      setPinError('No PIN assigned to this cargo entry. Contact the originating hub.');
      setReleasing(false);
      return;
    }

    if (storedPin === entered) {
      const ref = selectedCargo.entry_ref || selectedCargo.id;

      // Guard against a duplicate DELIVER log — e.g. two staff opening the
      // PIN modal for the same cargo, or a retried submit after a slow
      // network response, would otherwise both pass validation above and
      // each write their own DELIVER row.
      if (await isTagAlreadyDelivered(ref)) {
        setPinError('This cargo was already marked as delivered.');
        setReleasing(false);
        return;
      }

      // PIN confirmed — hand off to signature capture. Delivery isn't
      // finalized (status/tracking event) until that completes, so a
      // signature is always on file, ID or no ID.
      setPinModalOpen(false);
      setActivePodCapture({ ref, cargo: selectedCargo });
    } else {
      setPinError('Incorrect PIN — consignee must present the correct 5-digit PIN sent to their phone.');
      setPinValue(['', '', '', '', '']);
      setTimeout(() => firstPinRef.current?.focus(), 50);
    }
    setReleasing(false);
  };

  const handlePodComplete = async () => {
    if (!activePodCapture) return;
    const { ref, cargo } = activePodCapture;
    try {
      const { error } = await supabase.from('cargo_entries').update({
        status: 'Delivered',
        pin_used_at: new Date().toISOString(),
        released_by: user.id && user.id.length > 30 ? user.id : null,
      }).eq('entry_ref', ref);
      if (error) throw error;

      // Route through the shared scan-logging path so this gets the same
      // single tracking_events row, status sync, and consignee/sender SMS
      // notification as a DELIVER done via the QR scanner.
      await logScanEvent(ref, 'DELIVER', user.hub, user.name, cargo.route);
    } catch (err: any) {
      // The signature/photo was already physically captured -- staff need
      // to know this did NOT finalize server-side. Previously this only
      // logged to the console and silently closed the capture screen as if
      // it had succeeded, risking cargo handed over but never marked
      // Delivered, or a pickup PIN never marked used (reusable again).
      console.error('Failed to finalize delivery after signature capture:', err);
      showToast({ message: `Signature captured, but finalizing delivery failed: ${err.message || 'unknown error'}. Try again -- do not hand over cargo a second time.`, type: 'error' });
      return;
    }
    setActivePodCapture(null);
    setSelectedCargo(null);
    setPinValue(['', '', '', '', '']);
    fetchCargo();
  };

  if (activePodCapture) {
    return (
      <div className="fixed inset-0 z-[150] bg-[var(--color-bg)] flex flex-col">
        <ProofOfDeliveryForm
          awbNumber={activePodCapture.ref}
          consigneeName={activePodCapture.cargo.consignee_name}
          user={user}
          onComplete={handlePodComplete}
          onCancel={() => setActivePodCapture(null)}
        />
      </div>
    );
  }

  // ── Event type helpers ────────────────────────────────────────────────────
  const eventColor = (type: string) =>
    type === 'ARRIVE' ? 'var(--color-success)' :
    type === 'DEPART' ? 'var(--color-accent-cobalt)' :
    type === 'DELIVER' ? '#a855f7' : 'var(--color-error)';

  const eventLabel = (type: string) =>
    type === 'ARRIVE' ? '▼ ARRIVED' :
    type === 'DEPART' ? '▲ DEPARTED' :
    type === 'DELIVER' ? '✓ DELIVERED' : '⚠ WRONG STATION';

  // ── Tabs config ──────────────────────────────────────────────────────────
  const tabs: { key: MainTab; label: string }[] = [
    { key: 'AWAITING', label: '📦 AWAITING' },
    { key: 'DELIVERED', label: '✅ DELIVERED' },
    { key: 'LOG', label: '📋 SCAN LOG' },
  ];

  return (
    <div className="flex flex-col h-full bg-[var(--color-obsidian)] text-[var(--color-foreground)] overflow-hidden">

      {/* Header */}
      <div className="ehi-view-header">
        <BackButton onClick={onBack} label="Back" />
        <span className="text-[10px] font-mono text-[var(--color-accent-amber)] tracking-widest font-bold">● ARRIVALS</span>
        <button onClick={() => activeTab === 'LOG' ? fetchLog() : fetchCargo()} aria-label="Refresh" className="p-1.5 rounded hover:bg-[var(--color-surface-2)] transition-colors">
          <RefreshCw size={14} className={`text-[var(--color-muted)] ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-[var(--color-border)] shrink-0">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`flex-1 py-2.5 text-[10px] font-bold font-mono tracking-widest transition-colors cursor-pointer border-none ${
              activeTab === t.key
                ? t.key === 'AWAITING'
                  ? 'text-[var(--color-accent-amber)] border-b-2 border-[var(--color-accent-amber)] bg-[rgba(245,158,11,0.05)]'
                  : t.key === 'DELIVERED'
                    ? 'text-[var(--color-success)] border-b-2 border-[var(--color-success)] bg-[rgba(16,185,129,0.05)]'
                    : 'text-[var(--color-accent-cobalt)] border-b-2 border-[var(--color-accent-cobalt)] bg-[rgba(59,130,246,0.05)]'
                : 'text-[var(--color-muted)] hover:text-[var(--color-foreground)] bg-transparent'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Date filter chips (for DELIVERED and LOG tabs) */}
      {activeTab === 'DELIVERED' && (
        <DateChips value={deliveredFilter} onChange={f => setDeliveredFilter(f)} />
      )}
      {activeTab === 'LOG' && (
        <DateChips value={logFilter} onChange={f => setLogFilter(f)} />
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="ehi-page-body px-4 py-4 space-y-3">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader size={22} className="animate-spin text-[var(--color-accent-amber)]" />
            </div>

          ) : activeTab === 'LOG' ? (
            // ── SCAN LOG ──────────────────────────────────────────────────
            logList.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-14 border border-dashed border-[rgba(255,255,255,0.08)] rounded-xl">
                <History size={32} className="text-[var(--color-muted)] mb-3 opacity-40" />
                <p className="text-[13px] font-sans font-medium text-[var(--color-muted)]">
                  No scan events found for this period.
                </p>
              </div>
            ) : logList.map((ev, i) => {
              const color = eventColor(ev.event_type);
              const label = eventLabel(ev.event_type);
              return (
                <div key={ev.id || i} className="ehi-card p-3.5 flex items-start gap-3">
                  {/* Event type indicator */}
                  <div className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center"
                    style={{ background: `${color}18`, border: `1.5px solid ${color}55` }}>
                    <span style={{ color, fontSize: 13, fontWeight: 900 }}>
                      {ev.event_type === 'ARRIVE' ? '▼' : ev.event_type === 'DEPART' ? '▲' : ev.event_type === 'DELIVER' ? '✓' : '⚠'}
                    </span>
                  </div>

                  <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-mono font-bold uppercase tracking-wider" style={{ color }}>
                        {label}
                      </span>
                      <span className="text-[9px] font-mono text-[var(--color-muted)] shrink-0">
                        {new Date(ev.created_at).toLocaleString('en-NG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div className="text-[13px] font-mono font-bold text-[var(--color-accent-amber)]">
                      {ev.cargo_ref}
                    </div>
                    {ev.consignee_name && (
                      <div className="text-[12px] font-sans text-[var(--color-foreground)]">{ev.consignee_name}</div>
                    )}
                    <div className="text-[10px] font-mono text-[var(--color-muted)]">
                      {ev.hub_name}
                      {ev.scanned_by_name && <span> · by {ev.scanned_by_name}</span>}
                    </div>
                    {ev.event_type === 'WRONG_DESTINATION_ALERT' && ev.alert_reason && (
                      <div className="text-[10px] font-mono text-[var(--color-error)] bg-[rgba(239,68,68,0.07)] px-2 py-1 rounded mt-1">
                        {ev.alert_reason}
                      </div>
                    )}
                    {ev.cargo_destination && ev.event_type !== 'WRONG_DESTINATION_ALERT' && (
                      <div className="text-[10px] font-mono text-[var(--color-muted)]">→ {ev.cargo_destination}</div>
                    )}
                  </div>
                </div>
              );
            })

          ) : cargoList.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 border border-dashed border-[rgba(255,255,255,0.08)] rounded-xl">
              <Package size={32} className="text-[var(--color-muted)] mb-3 opacity-40" />
              <p className="text-[13px] font-sans font-medium text-[var(--color-muted)]">
                {activeTab === 'AWAITING'
                  ? 'No cargo awaiting collection at this hub.'
                  : `No deliveries found for ${deliveredFilter === 'today' ? 'today' : deliveredFilter === 'yesterday' ? 'yesterday' : 'the last 7 days'}.`}
              </p>
            </div>

          ) : cargoList.map((c, i) => (
            // ── AWAITING / DELIVERED cards ────────────────────────────────
            <div key={c.id || i} className="ehi-card p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div className="space-y-1 min-w-0">
                <div className="text-[15px] font-bold text-[var(--color-foreground)] font-sans">{c.consignee_name}</div>
                <div className="text-[10px] font-mono text-[var(--color-muted)]">
                  <span className="text-[var(--color-accent-amber)]">{c.entry_ref || c.id}</span>
                  {c.awb_tag_number && <span className="ml-2">· AWB {c.awb_tag_number}</span>}
                </div>
                <div className="text-[12px] font-sans text-[var(--color-muted)]">
                  {c.route || '—'} &nbsp;·&nbsp; {c.total_pcs || '?'} pcs &nbsp;·&nbsp; {c.total_kg || '?'} kg
                </div>
                <div className="text-[10px] font-mono text-[var(--color-muted)] opacity-70 mt-1">
                  {activeTab === 'AWAITING'
                    ? `Logged: ${new Date(c.created_at).toLocaleString('en-NG')}`
                    : `Released: ${new Date(c.pin_used_at).toLocaleString('en-NG')}`}
                </div>
              </div>

              {activeTab === 'AWAITING' && (
                <button
                  onClick={() => {
                    setSelectedCargo(c);
                    setPinModalOpen(true);
                    setPinError('');
                    setPinValue(['', '', '', '', '']);
                  }}
                  className="shrink-0 px-5 py-2.5 bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] font-bold text-[12px] rounded-lg hover:opacity-90 transition-opacity cursor-pointer border-none"
                >
                  RELEASE CARGO
                </button>
              )}
              {activeTab === 'DELIVERED' && (
                <div className="shrink-0 flex items-center gap-1.5 text-[var(--color-success)] text-[11px] font-bold font-mono">
                  <CheckCircle size={14} /> DELIVERED
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* PIN modal */}
      {pinModalOpen && selectedCargo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[var(--color-obsidian)] border border-[var(--color-border)] rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl">
            <div className="p-5 border-b border-[var(--color-border)] bg-[var(--color-surface-card)]">
              <div className="text-[16px] font-bold text-[var(--color-foreground)] mb-0.5">Customer PIN Verification</div>
              <div className="text-[12px] text-[var(--color-muted)]">
                Releasing to <strong className="text-[var(--color-foreground)]">{selectedCargo.consignee_name}</strong>
              </div>
              <div className="text-[10px] font-mono text-[var(--color-accent-amber)] mt-1">{selectedCargo.entry_ref || selectedCargo.id}</div>
            </div>
            <div className="p-6">
              <p className="text-[11px] text-[var(--color-muted)] text-center mb-4 font-sans">
                Ask the consignee to provide the 5-digit PIN sent to their phone when the cargo was logged.
              </p>
              <div className="flex justify-center gap-2 mb-5">
                {pinValue.map((v, idx) => (
                  <input
                    key={idx}
                    id={`pin-${idx}`}
                    ref={idx === 0 ? firstPinRef : undefined}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={v}
                    onChange={(e) => handlePinChange(idx, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(idx, e)}
                    className="w-12 h-14 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl text-center text-[22px] font-mono font-bold text-[var(--color-foreground)] focus:border-[var(--color-accent-amber)] focus:ring-1 focus:ring-[var(--color-accent-amber)] outline-none transition-colors"
                  />
                ))}
              </div>
              {pinError && (
                <div className="bg-[rgba(239,68,68,0.08)] border border-[rgba(239,68,68,0.25)] text-[var(--color-error)] p-3 rounded-lg text-[11px] font-sans leading-relaxed mb-4">
                  {pinError}
                </div>
              )}
              <div className="flex gap-3">
                <button
                  onClick={() => { setPinModalOpen(false); setPinError(''); setPinValue(['', '', '', '', '']); }}
                  className="flex-1 h-11 bg-[var(--color-surface-2)] text-[var(--color-muted)] text-[12px] font-bold rounded-lg hover:bg-[var(--color-surface-card)] transition-colors cursor-pointer border-none"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmPin}
                  disabled={releasing || pinValue.join('').length !== 5}
                  className="flex-1 h-11 bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] text-[12px] font-bold rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer border-none"
                >
                  {releasing ? 'Releasing…' : 'Confirm PIN'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
