import { useState } from 'react';
import { PaymentMode, Transaction } from '../../lib/types';
import { fmt, uid, tnow } from '../../lib/helpers';
import { CheckCircle, Loader2 } from 'lucide-react';
import { QRCode } from '../QRCode';
import { motion } from 'motion/react';
import { sendReceiptWhatsApp, buildValueJetWhatsApp } from '../../lib/notifications';

const VJ_RATE_PER_KG = 1000;

export const ValueJetForm = ({ onAddTx }: { onAddTx: (tx: Transaction) => void }) => {
  const [name, setName] = useState('');
  const [flight, setFlight] = useState('');
  const [dest, setDest] = useState('');
  const [kg, setKg] = useState('');
  const [phone, setPhone] = useState('');
  const [mode, setMode] = useState<PaymentMode>('POS');

  const [successTx, setSuccessTx] = useState<{ tx: Transaction, kgs: number, exc: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const vjFreeAllowance = parseFloat(
    localStorage.getItem('ehi_vj_free_kg') || '20'
  );

  const kgVal = parseFloat(kg) || 0;
  const excessKg = Math.max(0, kgVal - vjFreeAllowance);
  const totalAmount = excessKg * VJ_RATE_PER_KG;

  const isValid = name.trim().length > 0 && flight.trim().length > 0 && kgVal > 0;

  const handleSubmit = () => {
    if (!isValid || submitting) return;

    setSubmitting(true);

    const tx: Transaction = {
      id: uid('VJ'),
      name: name.trim(),
      detail: `${flight.toUpperCase()} · +${excessKg.toFixed(1)}kg excess`,
      amount: totalAmount,
      mode,
      time: tnow(),
      type: 'baggage',
      status: 'Delivered'
    };

    setSuccessTx({ tx, kgs: kgVal, exc: excessKg });
    setSubmitting(false);

    onAddTx(tx);

    if (phone.trim().length > 0) {
      sendReceiptWhatsApp({
        phone: phone.trim(),
        ref: tx.id,
        message: buildValueJetWhatsApp({
          ref: tx.id,
          passenger: name.trim(),
          flight: flight.toUpperCase(),
          totalKg: kgVal,
          excessKg,
          amount: totalAmount,
          mode,
        }),
      });
    }
  };

  const handleReset = () => {
    setName('');
    setFlight('');
    setDest('');
    setKg('');
    setPhone('');
    setSuccessTx(null);
  };

  const handleDownloadReceipt = async () => {
    if (successTx) {
      const { downloadVJReceipt } = await import('./ValueJetReceipt');
      const data = {
        entryRef: successTx.tx.id,
        date: new Date().toLocaleDateString('en-GB'),
        hubName: 'ValueJet Counter',
        agentName: 'VJ Agent',
        passengerName: successTx.tx.name,
        flightNumber: flight.toUpperCase(),
        destination: dest || 'Unknown',
        totalBaggage: successTx.kgs,
        freeAllowance: vjFreeAllowance,
        excessKg: successTx.exc,
        ratePerKg: VJ_RATE_PER_KG,
        amount: successTx.tx.amount,
        paymentMode: successTx.tx.mode,
      };
      downloadVJReceipt(data);
    }
  };

  const handlePrintReceipt = async () => {
    if (!successTx) return;
    const { printVJReceipt } = await import('./ValueJetReceipt');
    await printVJReceipt({
      entryRef: successTx.tx.id,
      date: new Date().toLocaleDateString('en-GB'),
      hubName: 'ValueJet Counter',
      agentName: 'VJ Agent',
      passengerName: successTx.tx.name,
      flightNumber: flight.toUpperCase(),
      destination: dest || 'Unknown',
      totalBaggage: successTx.kgs,
      freeAllowance: vjFreeAllowance,
      excessKg: successTx.exc,
      ratePerKg: VJ_RATE_PER_KG,
      amount: successTx.tx.amount,
      paymentMode: successTx.tx.mode,
    });
  };

  // Focus visible styles for ValueJet (cobalt stream)
  const vjFocusClasses = "focus:outline-none focus:ring-2 focus:ring-[rgba(59,130,246,0.5)] focus:border-[rgba(59,130,246,0.5)] transition-[border-color,box-shadow]";

  if (successTx) {
    const s = successTx;
    return (
      <div className="p-4 space-y-4 max-w-md mx-auto">
        <div className="border-b border-[var(--color-border)] pb-1 mb-2">
          <span style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: '#3B82F6', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            ▸ BAGGAGE RECEIPT
          </span>
        </div>

        <div 
          className="bg-[rgba(59,130,246,0.1)] border border-[var(--color-accent-cobalt)] rounded text-center p-6 flex flex-col items-center animate-in fade-in zoom-in-95 duration-200"
        >
          <div className="flex justify-center animate-pulse">
            <CheckCircle size={32} className="text-[var(--color-accent-cobalt)] mb-3" />
          </div>
          <div className="text-[10px] font-mono text-[var(--color-accent-cobalt)] uppercase tracking-widest mb-1">COMMIT SUCCESS</div>
          <div className="text-[14px] font-bold font-mono text-[var(--color-accent-cobalt)] mb-4 uppercase" style={{ fontFamily: 'JetBrains Mono' }}>
            REF: {s.tx.id}
          </div>
          
          <div className="bg-white p-2 rounded max-w-max mb-4 shadow-md">
            <QRCode id={s.tx.id} size={150} />
          </div>

          <div className="text-[12px] font-sans text-[var(--color-light-muted)] mb-3">{s.tx.name}</div>
          
          <div className="w-full bg-[var(--color-obsidian)] rounded p-3 mb-4 text-left border border-[var(--color-border)]">
            <div className="flex justify-between items-center mb-2">
              <span className="text-[10px] font-mono text-[var(--color-muted)]">Total Weight</span>
              <span className="text-[12px] font-mono text-[var(--color-foreground)]">{s.kgs.toFixed(1)} kg</span>
            </div>
            <div className="flex justify-between items-center mb-2">
              <span className="text-[10px] font-mono text-[var(--color-muted)]">Free Allowance</span>
              <span className="text-[12px] font-mono text-[var(--color-success)]">– {vjFreeAllowance.toFixed(1)} kg</span>
            </div>
            <div className="flex justify-between items-center pb-2 border-b border-[rgba(255,255,255,0.07)]">
              <span className="text-[10px] font-mono text-[var(--color-accent-cobalt)]">Excess Baggage</span>
              <span className="text-[12px] font-bold font-mono text-[var(--color-accent-cobalt)]">{s.exc.toFixed(1)} kg</span>
            </div>
            
            <div className="flex justify-between items-end mt-3">
              <div>
                <div className="text-[20px] font-bold font-mono text-[var(--color-accent-cobalt)]" style={{ fontFamily: 'JetBrains Mono' }}>{fmt(s.tx.amount)}</div>
              </div>
              <div className="text-right">
                <div className="text-[9px] font-mono text-[var(--color-muted)]">{s.tx.mode}</div>
                <div className="text-[9px] font-mono text-[var(--color-muted)]">{s.tx.time}</div>
              </div>
            </div>
          </div>

          <div className="flex w-full space-x-2">
            <button onClick={handleReset} className="flex-1 py-3 bg-[var(--color-surface-1)] text-[var(--color-foreground)] text-[11px] font-mono rounded cursor-pointer">
              Next Passenger
            </button>
            <button onClick={handlePrintReceipt} className="flex-1 py-3 bg-[var(--color-accent-cobalt)] text-[var(--color-foreground)] text-[11px] font-bold font-mono rounded cursor-pointer">
              Print Receipt
            </button>
          </div>
          <button
            onClick={handleDownloadReceipt}
            style={{
              width: '100%', padding: '11px',
              background: 'transparent',
              border: '1px solid rgba(59,130,246,0.3)',
              borderRadius: 8, cursor: 'pointer',
              fontSize: 11, fontFamily: 'monospace',
              fontWeight: 700, color: 'var(--color-accent-cobalt)',
              display: 'flex', alignItems: 'center',
              justifyContent: 'center', gap: 6,
              marginTop: 8,
            }}
          >
            ↓ DOWNLOAD RECEIPT
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 pb-24 h-full" style={{ width: '100%', boxSizing: 'border-box' }}>
      <div className="border-b border-[var(--color-border)] pb-2 mb-4 flex items-center justify-between">
        <span style={{ fontFamily: 'JetBrains Mono', fontSize: 11, fontWeight: 700, color: 'var(--color-accent-cobalt)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
          ▸ VALUEJET EXCESS BAGGAGE TICKETING
        </span>
      </div>

      <div className="grid gap-6 md:grid-cols-[1fr_280px]">
        {/* Left Column */}
        <div className="space-y-4">
          <div className="space-y-1.5">
            <span className="text-[12px] font-sans font-semibold text-[var(--color-light-muted)]">Passenger Name</span>
            <input 
              placeholder="Enter Passenger Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full h-12 px-4 text-[14px] rounded-[var(--radius-sm)] bg-[var(--color-input-bg)] text-[var(--color-input-text)] border border-[var(--color-border)] font-sans focus:outline-none transition-all"
            />
          </div>

          <div className="space-y-1.5">
            <span className="text-[12px] font-sans font-semibold text-[var(--color-light-muted)] font-bold">Passenger Phone — WhatsApp Receipt (Optional)</span>
            <input
              type="tel"
              placeholder="e.g. 08012345678"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full h-12 px-4 text-[14px] rounded-[var(--radius-sm)] bg-[var(--color-input-bg)] text-[var(--color-input-text)] border border-[var(--color-border)] font-sans focus:outline-none transition-all"
            />
          </div>
          
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <span className="text-[12px] font-sans font-semibold text-[var(--color-light-muted)]">Flight Number</span>
              <input 
                placeholder="e.g. VJ102"
                value={flight}
                onChange={(e) => setFlight(e.target.value)}
                className="w-full h-12 px-4 text-[14px] rounded-[var(--radius-sm)] bg-[var(--color-input-bg)] text-[var(--color-input-text)] border border-[var(--color-border)] font-sans focus:outline-none transition-all uppercase"
              />
            </div>
            <div className="space-y-1.5">
              <span className="text-[12px] font-sans font-semibold text-[var(--color-light-muted)] font-bold">Destination</span>
              <input 
                placeholder="e.g. Abuja"
                value={dest}
                onChange={(e) => setDest(e.target.value)}
                className="w-full h-12 px-4 text-[14px] rounded-[var(--radius-sm)] bg-[var(--color-input-bg)] text-[var(--color-input-text)] border border-[var(--color-border)] font-sans focus:outline-none transition-all"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <span className="text-[12px] font-sans font-semibold text-[var(--color-light-muted)]">Total Weight (KG)</span>
              <input 
                type="number"
                step="0.1"
                placeholder="0.0"
                value={kg}
                onChange={(e) => setKg(e.target.value)}
                className="w-full h-12 px-4 text-[14px] rounded-[var(--radius-sm)] bg-[var(--color-input-bg)] text-[var(--color-input-text)] border border-[var(--color-border)] font-sans focus:outline-none transition-all"
              />
            </div>
            <div className="space-y-1.5">
              <span className="text-[12px] font-sans font-semibold text-[var(--color-light-muted)]">Excess Rate</span>
              <div
                className="h-12 px-4 flex items-center justify-between rounded-[var(--radius-sm)] bg-[var(--color-surface-3)] border border-[var(--color-border-strong)]"
              >
                <span className="text-[12px] font-bold font-mono text-[var(--color-accent-cobalt)]">
                  ₦1,000<span className="text-[10px] font-normal text-[var(--color-muted)]">/kg</span>
                </span>
              </div>
            </div>
          </div>
          
          <div className="space-y-1.5">
            <span className="text-[12px] font-sans font-semibold text-[var(--color-light-muted)]">Payment Mode</span>
            <div className="flex bg-[var(--color-surface-3)] rounded-[var(--radius-sm)] p-1 border border-[var(--color-border)]">
              {['Cash', 'POS', 'Transfer'].map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m as PaymentMode)}
                  style={{
                    background: mode === m ? 'var(--color-surface-1)' : 'transparent',
                    color: mode === m ? 'var(--color-accent-cobalt)' : 'var(--color-muted)',
                    border: 'none',
                  }}
                  className={`flex-1 py-2 text-[13px] font-sans font-semibold rounded-[var(--radius-xs)] shadow-sm transition-all focus:outline-none cursor-pointer`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
          
          {/* Submit button states */}
          <div className="pt-4">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!isValid || submitting}
              className={`w-full py-4 rounded-[var(--radius-sm)] font-sans font-bold text-[16px] flex items-center justify-center gap-2 transition-all focus:outline-none ${
                submitting ? 'opacity-80 cursor-wait bg-[var(--color-accent-cobalt)] text-white' :
                !isValid ? 'bg-[var(--color-surface-3)] text-[var(--color-muted)] cursor-not-allowed border border-[var(--color-border)]' :
                'bg-[var(--color-accent-cobalt)] text-white cursor-pointer hover:bg-opacity-95'
              }`}
            >
              {submitting && <Loader2 size={18} className="animate-spin" />}
              {submitting ? 'COMMITTING...' : 'COMMIT TRANSACTION'}
            </button>
          </div>
        </div>

        {/* Right Column / Sticky Summary */}
        <aside className="hidden md:block">
          <div className="sticky top-4">
            <div style={{
              background: 'var(--color-surface-1)',
              border: '1.5px solid var(--color-border-strong)',
              borderRadius: 'var(--radius-md)', padding: 20,
              boxShadow: 'var(--shadow-card)',
            }}>
              <div style={{
                fontSize: 10, fontFamily: 'monospace',
                color: 'var(--color-accent-cobalt)',
                textTransform: 'uppercase', letterSpacing: '0.12em',
                marginBottom: 16, fontWeight: 700
              }}>
                ▸ TICKETING SUMMARY
              </div>
              <div style={{ fontSize: 13, fontFamily: 'monospace', lineHeight: 2.2, color: 'var(--color-foreground)' }}>
                <div className="flex justify-between border-b border-[var(--color-border)] pb-1 mb-1"><span style={{ color: 'var(--color-muted)' }}>Passenger</span><span className="truncate ml-4 font-semibold text-[var(--color-foreground)]" style={{ maxWidth: '140px' }}>{name || '—'}</span></div>
                <div className="flex justify-between border-b border-[var(--color-border)] pb-1 mb-1"><span style={{ color: 'var(--color-muted)' }}>Flight</span><span className="font-bold text-[var(--color-accent-cobalt)]">{flight.toUpperCase() || '—'}</span></div>
                <div className="flex justify-between border-b border-[var(--color-border)] pb-1 mb-1"><span style={{ color: 'var(--color-muted)' }}>Total Weight</span><span className="font-semibold text-[var(--color-foreground)]">{kgVal.toFixed(1)} kg</span></div>
                <div className="flex justify-between border-b border-[var(--color-border)] pb-1 mb-1"><span style={{ color: 'var(--color-muted)' }}>Free Limit</span><span className="font-semibold text-[var(--color-success)]">– {vjFreeAllowance.toFixed(1)} kg</span></div>
                <div className="flex justify-between"><span style={{ color: 'var(--color-muted)' }}>Excess KG</span><span className={`font-bold ${excessKg > 0 ? 'text-[var(--color-accent-cobalt)]' : 'text-[var(--color-muted)]'}`}>{excessKg.toFixed(1)} kg</span></div>
              </div>

              <div style={{
                borderTop: '1.5px dashed var(--color-border-strong)',
                paddingTop: 16, marginTop: 16,
              }}>
                <div style={{
                  fontSize: 10, fontFamily: 'monospace',
                  color: 'var(--color-muted)', marginBottom: 6,
                  fontWeight: 700, letterSpacing: '0.05em'
                }}>TOTAL DUE</div>
                <div style={{
                  fontSize: 28, fontWeight: 800, fontFamily: 'monospace',
                  color: excessKg > 0
                    ? 'var(--color-accent-cobalt)'
                    : 'var(--color-muted)',
                }}>
                  {excessKg > 0
                    ? '₦' + totalAmount.toLocaleString('en-NG')
                    : '₦0'}
                </div>
                {excessKg > 0 && (
                  <div style={{
                    fontSize: 10, fontFamily: 'monospace',
                    color: 'var(--color-muted)', marginTop: 6,
                  }}>
                    {excessKg.toFixed(1)} kg × ₦1,000/kg
                  </div>
                )}
              </div>
            </div>
          </div>
        </aside>

      </div>
    </div>
  );
};
