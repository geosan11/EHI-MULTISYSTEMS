import { useState } from 'react';
import { PaymentMode, Transaction } from '../../lib/types';
import { fmt, uid, tnow } from '../../lib/helpers';
import { CheckCircle, Loader2 } from 'lucide-react';
import { QRCode } from '../QRCode';
import { motion } from 'motion/react';

export const ValueJetForm = ({ onAddTx }: { onAddTx: (tx: Transaction) => void }) => {
  const [name, setName] = useState('');
  const [flight, setFlight] = useState('');
  const [dest, setDest] = useState('');
  const [kg, setKg] = useState('');
  const [rate, setRate] = useState('5000');
  const [mode, setMode] = useState<PaymentMode>('POS');

  const [successTx, setSuccessTx] = useState<{ tx: Transaction, kgs: number, exc: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const kgVal = parseFloat(kg) || 0;
  const rateVal = parseFloat(rate) || 0;
  const excessKg = Math.max(0, kgVal - 20.0);
  const totalAmount = excessKg * rateVal;

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
  };

  const handleReset = () => {
    setName('');
    setFlight('');
    setDest('');
    setKg('');
    setRate('5000');
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
        freeAllowance: 20,
        excessKg: successTx.exc,
        ratePerKg: rateVal,
        amount: successTx.tx.amount,
        paymentMode: successTx.tx.mode,
      };
      downloadVJReceipt(data);
    }
  };

  // Focus visible styles for ValueJet (cobalt stream)
  const vjFocusClasses = "focus:outline-none focus:ring-2 focus:ring-[rgba(59,130,246,0.5)] focus:border-[rgba(59,130,246,0.5)] transition-[border-color,box-shadow]";

  if (successTx) {
    const s = successTx;
    return (
      <div className="p-4 space-y-4 max-w-md mx-auto">
        <div className="border-b border-[rgba(255,255,255,0.07)] pb-1 mb-2">
          <span style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: '#3B82F6', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            ▸ BAGGAGE RECEIPT
          </span>
        </div>

        <motion.div 
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', damping: 15, stiffness: 200 }}
          className="bg-[rgba(59,130,246,0.1)] border border-[var(--color-accent-cobalt)] rounded text-center p-6 flex flex-col items-center"
        >
          <motion.div
            animate={{ scale: [1, 1.15, 1] }}
            transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
            className="flex justify-center"
          >
            <CheckCircle size={32} className="text-[var(--color-accent-cobalt)] mb-3" />
          </motion.div>
          <div className="text-[10px] font-mono text-[var(--color-accent-cobalt)] uppercase tracking-widest mb-1">COMMIT SUCCESS</div>
          <div className="text-[14px] font-bold font-mono text-[var(--color-accent-cobalt)] mb-4 uppercase" style={{ fontFamily: 'JetBrains Mono' }}>
            REF: {s.tx.id}
          </div>
          
          <div className="bg-white p-2 rounded max-w-max mb-4 shadow-md">
            <QRCode id={s.tx.id} size={150} />
          </div>

          <div className="text-[12px] font-sans text-[var(--color-light-muted)] mb-3">{s.tx.name}</div>
          
          <div className="w-full bg-[var(--color-obsidian)] rounded p-3 mb-4 text-left border border-[rgba(255,255,255,0.07)]">
            <div className="flex justify-between items-center mb-2">
              <span className="text-[10px] font-mono text-[var(--color-muted)]">Total Weight</span>
              <span className="text-[12px] font-mono text-[var(--color-foreground)]">{s.kgs.toFixed(1)} kg</span>
            </div>
            <div className="flex justify-between items-center mb-2">
              <span className="text-[10px] font-mono text-[var(--color-muted)]">Free Allowance</span>
              <span className="text-[12px] font-mono text-[var(--color-success)]">– 20.0 kg</span>
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
            <button onClick={handleReset} className="flex-1 py-3 bg-[var(--color-surface-1)] text-white text-[11px] font-mono rounded cursor-pointer">
              Next Passenger
            </button>
            <button onClick={handleDownloadReceipt} className="flex-1 py-3 bg-[var(--color-accent-cobalt)] text-white text-[11px] font-bold font-mono rounded cursor-pointer">
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
        </motion.div>
      </div>
    );
  }

  return (
    <div className="p-4 pb-12 h-full">
      <div className="border-b border-[rgba(255,255,255,0.07)] pb-1 mb-4">
        <span style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: '#3B82F6', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
          ▸ VALUEJET EXCESS BAGGAGE POS
        </span>
      </div>

      <div className="grid gap-6 md:grid-cols-[1fr_280px]">
        {/* Left Column */}
        <div className="space-y-4">
          <input 
            placeholder="Passenger Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={`w-full h-11 px-3 text-sm rounded bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.07)] text-white font-sans ${vjFocusClasses}`}
          />
          
          <div className="flex space-x-3">
            <input 
              placeholder="Flight Number"
              value={flight}
              onChange={(e) => setFlight(e.target.value)}
              className={`flex-1 h-11 px-3 text-sm rounded bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.07)] text-white font-sans min-w-0 ${vjFocusClasses}`}
            />
            <input 
              placeholder="Destination (Optional)"
              value={dest}
              onChange={(e) => setDest(e.target.value)}
              className={`flex-1 h-11 px-3 text-sm rounded bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.07)] text-white font-sans min-w-0 ${vjFocusClasses}`}
            />
          </div>

          <div className="flex space-x-3">
            <input 
              type="number"
              step="0.1"
              placeholder="Total Weight KG"
              value={kg}
              onChange={(e) => setKg(e.target.value)}
              className={`flex-1 h-11 px-3 text-sm rounded bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.07)] text-white font-sans min-w-0 ${vjFocusClasses}`}
            />
            <div className="flex-1 relative min-w-0">
              <div className="absolute left-3 top-0 bottom-0 flex items-center text-[10px] font-mono text-[var(--color-muted)]">₦</div>
              <input 
                type="number"
                placeholder="Rate per KG"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                className={`w-full h-11 pl-6 pr-3 text-sm rounded bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.07)] text-white font-sans ${vjFocusClasses}`}
              />
              <div className="absolute right-3 top-0 bottom-0 flex items-center text-[10px] font-mono text-[var(--color-muted)]">/kg</div>
            </div>
          </div>
          
          <select 
            value={mode}
            onChange={(e) => setMode(e.target.value as PaymentMode)}
            className={`w-full h-11 px-3 text-sm rounded bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.07)] text-white font-sans ${vjFocusClasses}`}
          >
            <option value="Cash">Cash</option>
            <option value="POS">POS</option>
            <option value="Transfer">Transfer</option>
          </select>
          
          {/* Submit button states */}
          <div className="pt-2">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!isValid || submitting}
              style={
                submitting ? { backgroundColor: 'rgba(59, 130, 246, 0.7)', color: '#FFFFFF', cursor: 'wait', pointerEvents: 'none' } :
                isValid ? { backgroundColor: '#3B82F6', color: '#FFFFFF', cursor: 'pointer' } :
                { backgroundColor: '#1E293B', color: '#64748B', cursor: 'not-allowed' }
              }
              className="w-full py-[14px] rounded font-bold font-mono text-[13px] flex items-center justify-center gap-2 transition-colors"
            >
              {submitting && <Loader2 size={16} className="animate-spin" />}
              {submitting ? 'COMMITTING...' : 'COMMIT TRANSACTION'}
            </button>
          </div>
        </div>

        {/* Right Column / Sticky Summary */}
        <aside className="space-y-4">
          <div className="sticky top-4">
            <div className={`rounded p-4 transition-colors duration-300 ${excessKg > 0 ? 'bg-[rgba(59,130,246,0.1)] border border-[rgba(59,130,246,0.2)]' : 'bg-[rgba(16,185,129,0.1)] border border-[rgba(16,185,129,0.2)]'}`}>
              <div className="flex justify-between items-center mb-2">
                <span className="text-[10px] font-mono text-[var(--color-muted)]">Total Weight</span>
                <span className="text-[12px] font-mono text-white" style={{ fontFamily: 'JetBrains Mono' }}>{kgVal.toFixed(1)} kg</span>
              </div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-[10px] font-mono text-[var(--color-muted)]">Free Allowance</span>
                <span className="text-[12px] font-mono text-[var(--color-success)]" style={{ fontFamily: 'JetBrains Mono' }}>– 20.0 kg</span>
              </div>
              <div className="flex justify-between items-center border-t border-[rgba(255,255,255,0.07)] mt-3 pt-3 mb-4">
                <span className="text-[10px] font-mono font-bold text-[var(--color-light-muted)]">Excess KG</span>
                <span className={`text-[12px] font-bold font-mono ${excessKg > 0 ? 'text-[var(--color-accent-cobalt)]' : 'text-white'}`} style={{ fontFamily: 'JetBrains Mono' }}>{excessKg.toFixed(1)} kg</span>
              </div>
              
              {excessKg > 0 ? (
                <>
                  <div className="text-[28px] font-bold font-mono text-[var(--color-accent-cobalt)] leading-none mt-2" style={{ fontFamily: 'JetBrains Mono' }}>{fmt(totalAmount)}</div>
                  <div className="text-[11px] font-mono text-[var(--color-light-muted)] mt-2">{excessKg.toFixed(1)} kg × ₦{rateVal}/kg</div>
                </>
              ) : (
                <div className="text-[14px] font-bold font-mono text-[var(--color-success)] mt-4 mb-2">₦0 — Within Limit ✓</div>
              )}
            </div>
          </div>
        </aside>

      </div>
    </div>
  );
};
