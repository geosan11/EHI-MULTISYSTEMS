import { useState, useEffect, useRef } from 'react';
import { User } from '../../lib/types';
import { supabase } from '../../lib/supabase';
import { ArrowLeft, Package, CheckCircle, RefreshCw, Loader } from 'lucide-react';

export const ArrivalsView = ({ user, onBack }: { user: User; onBack: () => void }) => {
  const [activeTab, setActiveTab] = useState<'ARRIVED' | 'DELIVERED'>('ARRIVED');
  const [cargoList, setCargoList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [selectedCargo, setSelectedCargo] = useState<any | null>(null);
  const [pinValue, setPinValue] = useState(['', '', '', '', '']);
  const [pinError, setPinError] = useState('');
  const [pinSuccess, setPinSuccess] = useState('');
  const [releasing, setReleasing] = useState(false);

  const firstPinRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (pinModalOpen) setTimeout(() => firstPinRef.current?.focus(), 100);
  }, [pinModalOpen]);

  const fetchCargo = async () => {
    setLoading(true);
    try {
      const isAdmin = ['super_admin', 'admin'].includes(user.role);

      if (activeTab === 'ARRIVED') {
        let q = supabase
          .from('cargo_entries')
          .select('entry_ref, id, consignee_name, consignee_phone, route, total_pcs, total_kg, pickup_pin, pin_used_at, status, created_at, hub_id, awb_tag_number')
          .eq('status', 'Arrived')
          .is('pin_used_at', null)
          .order('created_at', { ascending: false });

        if (!isAdmin && user.hub_id) q = q.eq('hub_id', user.hub_id) as any;

        const { data, error } = await q;
        if (!error && data) setCargoList(data);
      } else {
        let q = supabase
          .from('cargo_entries')
          .select('entry_ref, id, consignee_name, route, total_pcs, total_kg, pin_used_at, released_by, status, created_at, hub_id, awb_tag_number')
          .eq('status', 'Delivered')
          .not('pin_used_at', 'is', null)
          .order('pin_used_at', { ascending: false })
          .limit(100);

        if (!isAdmin && user.hub_id) q = q.eq('hub_id', user.hub_id) as any;

        const { data, error } = await q;
        if (!error && data) setCargoList(data);
      }
    } catch (err) {
      console.error('Arrivals fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCargo(); }, [user.hub_id, activeTab]);

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
      try {
        const ref = selectedCargo.entry_ref || selectedCargo.id;

        await supabase.from('cargo_entries').update({
          status: 'Delivered',
          pin_used_at: new Date().toISOString(),
          released_by: user.id && user.id.length > 30 ? user.id : null,
        }).eq('entry_ref', ref);

        await supabase.from('tracking_events').insert({
          cargo_ref: ref,
          event_type: 'DELIVER',
          hub_name: user.hub,
          hub_id: user.hub_id || null,
          scanned_by_name: user.name,
        });

        setPinSuccess('Cargo released to consignee ✓');
        setTimeout(() => {
          setPinModalOpen(false);
          setPinSuccess('');
          setPinValue(['', '', '', '', '']);
          setSelectedCargo(null);
          fetchCargo();
        }, 2000);
      } catch {
        setPinError('Failed to update status. Try again.');
      }
    } else {
      setPinError('Incorrect PIN — consignee must present the correct 5-digit PIN sent to their phone.');
      setPinValue(['', '', '', '', '']);
      setTimeout(() => firstPinRef.current?.focus(), 50);
    }
    setReleasing(false);
  };

  return (
    <div className="flex flex-col h-full bg-[var(--color-obsidian)] text-[var(--color-foreground)] overflow-hidden">
      <div className="ehi-view-header">
        <button onClick={onBack} className="flex items-center gap-1.5 text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors">
          <ArrowLeft size={15} />
          <span className="text-[11px] font-mono">Back</span>
        </button>
        <span className="text-[10px] font-mono text-[var(--color-accent-amber)] tracking-widest font-bold">● ARRIVALS</span>
        <button onClick={fetchCargo} className="p-1.5 rounded hover:bg-[var(--color-surface-2)] transition-colors">
          <RefreshCw size={14} className={`text-[var(--color-muted)] ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="flex border-b border-[var(--color-border)] shrink-0">
        {(['ARRIVED', 'DELIVERED'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-3 text-[11px] font-bold font-mono tracking-widest transition-colors ${
              activeTab === tab
                ? tab === 'ARRIVED'
                  ? 'text-[var(--color-accent-amber)] border-b-2 border-[var(--color-accent-amber)]'
                  : 'text-[var(--color-success)] border-b-2 border-[var(--color-success)]'
                : 'text-[var(--color-muted)] hover:text-[var(--color-foreground)]'
            }`}
          >
            {tab === 'ARRIVED' ? '📦 AWAITING COLLECTION' : '✅ DELIVERED TODAY'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="ehi-page-body px-4 py-4 space-y-3">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader size={22} className="animate-spin text-[var(--color-accent-amber)]" />
            </div>
          ) : cargoList.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 border border-dashed border-[rgba(255,255,255,0.08)] rounded-xl">
              <Package size={32} className="text-[var(--color-muted)] mb-3 opacity-40" />
              <p className="text-[13px] font-sans font-medium text-[var(--color-muted)]">
                {activeTab === 'ARRIVED' ? 'No cargo awaiting collection at this hub.' : 'No deliveries recorded today.'}
              </p>
            </div>
          ) : cargoList.map((c, i) => (
            <div key={c.id || i} className="ehi-card p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div className="space-y-1 min-w-0">
                <div className="text-[15px] font-bold text-[var(--color-foreground)] font-sans">{c.consignee_name}</div>
                <div className="text-[10px] font-mono text-[var(--color-muted)]">
                  <span className="text-[var(--color-accent-amber)]">{c.entry_ref || c.id}</span>
                  {c.awb_tag_number && <span className="ml-2 text-[var(--color-muted)]">· AWB {c.awb_tag_number}</span>}
                </div>
                <div className="text-[12px] font-sans text-[var(--color-muted)]">
                  {c.route || '—'} &nbsp;·&nbsp; {c.total_pcs || '?'} pcs &nbsp;·&nbsp; {c.total_kg || '?'} kg
                </div>
                <div className="text-[10px] font-mono text-[var(--color-muted)] opacity-70 mt-1">
                  {activeTab === 'ARRIVED'
                    ? `Arrived: ${new Date(c.created_at).toLocaleString('en-NG')}`
                    : `Released: ${new Date(c.pin_used_at).toLocaleString('en-NG')}`}
                </div>
              </div>
              {activeTab === 'ARRIVED' && (
                <button
                  onClick={() => {
                    setSelectedCargo(c);
                    setPinModalOpen(true);
                    setPinError('');
                    setPinSuccess('');
                    setPinValue(['', '', '', '', '']);
                  }}
                  className="shrink-0 px-5 py-2.5 bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] font-bold text-[12px] rounded-lg hover:opacity-90 transition-opacity"
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
              {pinSuccess ? (
                <div className="flex flex-col items-center py-6 text-[var(--color-success)] space-y-3">
                  <CheckCircle size={48} />
                  <div className="font-bold text-[15px] text-center">{pinSuccess}</div>
                </div>
              ) : (
                <>
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
                      className="flex-1 h-11 bg-[var(--color-surface-2)] text-[var(--color-muted)] text-[12px] font-bold rounded-lg hover:bg-[var(--color-surface-card)] transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleConfirmPin}
                      disabled={releasing || pinValue.join('').length !== 5}
                      className="flex-1 h-11 bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] text-[12px] font-bold rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
                    >
                      {releasing ? 'Releasing…' : 'Confirm PIN'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
