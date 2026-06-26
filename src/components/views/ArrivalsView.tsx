import { useState, useEffect } from 'react';
import { User } from '../../lib/types';
import { supabase } from '../../lib/supabase';
import { ArrowLeft, ArrowDown, Package, User as UserIcon, Clock, CheckCircle } from 'lucide-react';

export const ArrivalsView = ({ user, onBack }: { user: User; onBack: () => void }) => {
  const [activeTab, setActiveTab] = useState<'ARRIVED' | 'DELIVERED'>('ARRIVED');
  const [cargoList, setCargoList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // PIN Modal State
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [selectedCargo, setSelectedCargo] = useState<any | null>(null);
  const [pinValue, setPinValue] = useState(['', '', '', '', '']);
  const [pinError, setPinError] = useState('');
  const [pinSuccess, setPinSuccess] = useState('');

  const fetchCargo = async () => {
    setLoading(true);
    try {
      if (activeTab === 'ARRIVED') {
        const { data, error } = await supabase
          .from('cargo_entries')
          .select('*')
          .eq('status', 'Arrive')
          .is('pin_used_at', null)
          .order('created_at', { ascending: false });

        if (!error && data) {
          // Filter by hub loosely (since we don't know the exact column, try route or destination)
          const hubPrefix = user.hub.split(' ')[0].toLowerCase();
          const filtered = data.filter(c => {
            const dest = (c.route || c.destination || c.hub_destination || '').toLowerCase();
            return dest.includes(hubPrefix);
          });
          setCargoList(filtered);
        }
      } else {
        const { data, error } = await supabase
          .from('cargo_entries')
          .select('*')
          .eq('status', 'Delivers')
          .order('pin_used_at', { ascending: false })
          .limit(100);

        if (!error && data) {
          const hubPrefix = user.hub.split(' ')[0].toLowerCase();
          const filtered = data.filter(c => {
             const dest = (c.route || c.destination || c.hub_destination || '').toLowerCase();
             return dest.includes(hubPrefix);
          });
          setCargoList(filtered);
        }
      }
    } catch (err) {
      console.error('Error fetching cargo:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCargo();
  }, [user.hub, activeTab]);

  const handlePinChange = (index: number, val: string) => {
    if (!/^\d*$/.test(val)) return;
    const newPin = [...pinValue];
    newPin[index] = val.slice(-1);
    setPinValue(newPin);
    setPinError('');

    if (val && index < 4) {
      document.getElementById(`pin-box-${index + 1}`)?.focus();
    }
  };

  const handleConfirmPin = async () => {
    const enteredPin = pinValue.join('');
    if (enteredPin.length !== 5) {
      setPinError('Please enter all 5 digits.');
      return;
    }

    if (!selectedCargo) return;

    let actualPin = selectedCargo.pickup_pin;
    if (!actualPin && selectedCargo.remark) {
      try {
        const parsed = JSON.parse(selectedCargo.remark);
        if (parsed && parsed.pin) actualPin = parsed.pin;
      } catch(e) {}
    }

    if (actualPin === enteredPin) {
      // MATCH
      try {
        await supabase.from('cargo_entries').update({
          status: 'Delivers',
          pin_used_at: new Date().toISOString(),
          released_by: user.id || 'Unknown',
        }).eq('entry_ref', selectedCargo.entry_ref || selectedCargo.id);

        await supabase.from('tracking_events').insert({
          cargo_ref: selectedCargo.entry_ref || selectedCargo.id,
          event_type: 'Delivers',
          hub_name: user.hub,
          scanned_by_name: user.name,
        });

        setPinSuccess('Cargo released to consignee ✓');
        setTimeout(() => {
          setPinModalOpen(false);
          setPinSuccess('');
          setPinValue(['', '', '', '', '']);
          fetchCargo();
        }, 2000);
      } catch (err) {
        setPinError('Failed to update status.');
      }
    } else {
      // NO MATCH
      setPinError('Incorrect PIN — cargo cannot be released. Ask the consignee to confirm their PIN.');
      setPinValue(['', '', '', '', '']);
      document.getElementById('pin-box-0')?.focus();
    }
  };

  return (
    <div className="flex flex-col h-full bg-[var(--color-obsidian)] text-[var(--color-foreground)] relative animate-in slide-in-from-right overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-[var(--color-border)] flex items-center justify-between shrink-0">
        <button
          onClick={onBack}
          className="flex items-center space-x-1 text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors cursor-pointer border-none bg-transparent"
        >
          <ArrowLeft size={16} />
          <span className="text-[11px] font-mono">Back</span>
        </button>
        <span className="text-[10px] font-mono text-[var(--color-accent-amber)] tracking-widest font-bold">
          ● CARGO LOG
        </span>
      </div>

      <div className="flex border-b border-[var(--color-border)]">
        <button
          onClick={() => setActiveTab('ARRIVED')}
          className={`flex-1 py-3 text-[12px] font-bold font-sans tracking-wide transition-colors ${
            activeTab === 'ARRIVED' 
              ? 'text-[var(--color-accent-amber)] border-b-2 border-[var(--color-accent-amber)]' 
              : 'text-[var(--color-muted)] hover:text-white'
          }`}
        >
          ARRIVED — Awaiting Collection
        </button>
        <button
          onClick={() => setActiveTab('DELIVERED')}
          className={`flex-1 py-3 text-[12px] font-bold font-sans tracking-wide transition-colors ${
            activeTab === 'DELIVERED' 
              ? 'text-[var(--color-success)] border-b-2 border-[var(--color-success)]' 
              : 'text-[var(--color-muted)] hover:text-white'
          }`}
        >
          DELIVERED
        </button>
      </div>

      <div className="p-4 flex-1 overflow-y-auto">
        {loading ? (
          <div className="text-center py-12 text-[var(--color-muted)] text-[12px] font-mono">
            Loading...
          </div>
        ) : cargoList.length === 0 ? (
          <div className="text-center py-12 border border-[rgba(255,255,255,0.05)] rounded-lg bg-[var(--color-surface-1)] text-[var(--color-muted)]">
            <Package size={32} className="mx-auto mb-3 opacity-20" />
            <p className="text-[13px] font-medium font-sans">No records found.</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {cargoList.map((cargo, i) => (
              <div key={cargo.id || i} className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-lg p-4 shadow-sm hover:border-[var(--color-border-strong)] transition-all flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div className="space-y-1">
                  <h3 className="text-[18px] font-bold text-white font-sans">{cargo.consignee_name}</h3>
                  <div className="text-[12px] font-mono text-[var(--color-muted)]">
                    Ref: <span className="text-[var(--color-light-muted)]">{cargo.entry_ref || cargo.id}</span>
                  </div>
                  <div className="text-[13px] font-sans text-[var(--color-accent-amber)] font-medium">
                    {cargo.route || cargo.destination || cargo.hub_destination}
                  </div>
                  <div className="text-[12px] font-sans text-[var(--color-muted)]">
                    {cargo.total_pcs || cargo.pieces} pcs • {cargo.total_kg || cargo.kg} kg
                  </div>
                  {activeTab === 'DELIVERED' ? (
                    <div className="text-[11px] font-mono text-[var(--color-light-muted)] mt-2 opacity-70">
                      Delivered: {new Date(cargo.pin_used_at || cargo.created_at).toLocaleString()} by {cargo.released_by || 'Unknown'}
                    </div>
                  ) : (
                    <div className="text-[11px] font-mono text-[var(--color-light-muted)] mt-2 opacity-70">
                      Arrived: {new Date(cargo.created_at).toLocaleString()}
                    </div>
                  )}
                </div>

                {activeTab === 'ARRIVED' && (
                  <button
                    onClick={() => {
                      setSelectedCargo(cargo);
                      setPinModalOpen(true);
                      setPinError('');
                      setPinSuccess('');
                      setPinValue(['', '', '', '', '']);
                    }}
                    className="shrink-0 bg-[var(--color-accent-amber)] text-black px-4 py-2.5 rounded hover:bg-opacity-90 font-bold font-sans text-[12px] transition-all"
                  >
                    RELEASE CARGO
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* PIN Verification Modal */}
      {pinModalOpen && selectedCargo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[var(--color-obsidian)] border border-[var(--color-border)] rounded-xl w-full max-w-sm overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="p-5 border-b border-[var(--color-border)] bg-[var(--color-surface-1)]">
              <h2 className="text-[18px] font-bold text-white mb-1">Enter customer PIN</h2>
              <p className="text-[12px] text-[var(--color-muted)]">Releasing cargo for <strong>{selectedCargo.consignee_name}</strong></p>
            </div>
            
            <div className="p-6">
              {pinSuccess ? (
                <div className="flex flex-col items-center justify-center py-6 text-[var(--color-success)] space-y-3">
                  <CheckCircle size={48} />
                  <div className="font-bold text-[16px]">{pinSuccess}</div>
                </div>
              ) : (
                <>
                  <div className="flex justify-center gap-2 mb-6">
                    {pinValue.map((v, idx) => (
                      <input
                        key={idx}
                        id={`pin-box-${idx}`}
                        type="text"
                        inputMode="numeric"
                        maxLength={1}
                        value={v}
                        onChange={(e) => handlePinChange(idx, e.target.value)}
                        className="w-12 h-14 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded text-center text-[24px] font-mono font-bold text-white focus:border-[var(--color-accent-amber)] focus:ring-1 focus:ring-[var(--color-accent-amber)] outline-none"
                      />
                    ))}
                  </div>

                  {pinError && (
                    <div className="bg-red-950/40 border border-red-900/50 text-red-400 p-3 rounded text-[12px] font-medium leading-relaxed mb-6">
                      {pinError}
                    </div>
                  )}

                  <div className="flex gap-3">
                    <button
                      onClick={() => setPinModalOpen(false)}
                      className="flex-1 py-3 bg-[var(--color-surface-2)] text-white text-[13px] font-bold rounded hover:bg-[var(--color-surface-card)] transition-colors"
                    >
                      CANCEL
                    </button>
                    <button
                      onClick={handleConfirmPin}
                      className="flex-1 py-3 bg-[var(--color-accent-amber)] text-black text-[13px] font-bold rounded hover:bg-opacity-90 transition-colors"
                    >
                      CONFIRM
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
