import { useState, useEffect } from 'react';
import { Transaction, PaymentMode } from '../../lib/types';
import { CORPORATE_CLIENTS, PRICING, CONTENT_TYPES, BANKS } from '../../lib/constants';
import { fmt, uid, tnow } from '../../lib/helpers';
import { CheckCircle, Loader2 } from 'lucide-react';
import { QRCode } from '../QRCode';

const AIRLINES = [
  { code: 'AK', name: 'Arik Air', prefix: '14', series: 14001 },
  { code: 'GA', name: 'Green Africa', prefix: '22', series: 22001 },
  { code: 'UN', name: 'United Nigeria', prefix: '31', series: 31001 }
];

export const AirCargoForm = ({ onAddTx }: { onAddTx: (tx: Transaction) => void }) => {
  const [airline, setAirline] = useState(AIRLINES[0]);
  const [awbStart, setAwbStart] = useState('');
  const [awbEnd, setAwbEnd] = useState('');
  const [consignee, setConsignee] = useState(CORPORATE_CLIENTS[0]);
  const [pcs, setPcs] = useState('');
  const [kg, setKg] = useState('');
  const [route, setRoute] = useState(Object.keys(PRICING)[0]);
  const [contentType, setContentType] = useState(CONTENT_TYPES[0]);
  const [slotRef, setSlotRef] = useState('');
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<PaymentMode | string>('Transfer');
  const [bank, setBank] = useState(BANKS[0]);
  const [remarks, setRemarks] = useState('');

  const [paystackRef, setPaystackRef] = useState('');
  const [verificationResult, setVerificationResult] = useState<{ verified: boolean, message: string } | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);

  const [successTx, setSuccessTx] = useState<Transaction | null>(null);

  useEffect(() => {
    setAwbStart(airline.series.toString());
  }, [airline]);

  const isValid = awbStart.trim().length > 0 && parseFloat(amount) > 0;

  const verifyPaystackPayment = async () => {
    if (!paystackRef.trim()) return;
    setIsVerifying(true);
    setVerificationResult(null);
    try {
      const response = await fetch('/api/paystack/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference: paystackRef }),
      });
      const data = await response.json();
      if (data.verified) {
        setVerificationResult({ verified: true, message: `✓ Verified: ₦${data.amount.toLocaleString()} from ${data.payer}` });
      } else {
        setVerificationResult({ verified: false, message: '✗ Could not verify reference' });
      }
    } catch {
      setVerificationResult({ verified: false, message: '✗ Error verifying payment' });
    } finally {
      setIsVerifying(false);
    }
  };

  const handleSubmit = () => {
    if (!isValid) return;

    const amt = parseFloat(amount) || 0;
    const awbRangeText = awbEnd ? `AWB ${awbStart}-${awbEnd}` : `AWB ${awbStart}`;

    const tx: Transaction = {
      id: uid('AC'),
      name: consignee,
      detail: `${awbRangeText} · ${route}`,
      amount: amt,
      mode,
      time: tnow(),
      type: 'air_cargo',
      status: 'Received',
      awbStart,
      awbEnd,
      consignee,
      pieces: parseInt(pcs) || 0,
      kg: parseFloat(kg) || 0,
      route,
      contentType,
      slotRef,
      bank: mode === 'Transfer' ? bank : undefined,
      remarks,
    };

    onAddTx(tx);
    setSuccessTx(tx);
    
    // Auto increment series conceptually
    setAirline(prev => ({ ...prev, series: prev.series + (awbEnd ? (parseInt(awbEnd) - parseInt(awbStart) + 1) : 1) }));
  };

  const handleReset = () => {
    setAwbEnd('');
    setPcs('');
    setKg('');
    setSlotRef('');
    setAmount('');
    setRemarks('');
    setPaystackRef('');
    setVerificationResult(null);
    setSuccessTx(null);
  };

  if (successTx) {
    return (
      <div className="p-4 space-y-4">
        <div className="bg-[rgba(239,68,68,0.1)] border border-[var(--color-error)] rounded text-center p-6 flex flex-col items-center">
          <CheckCircle size={32} className="text-[var(--color-error)] mb-3" />
          <div className="text-[10px] font-mono text-[var(--color-error)] uppercase tracking-widest mb-4">CONSIGNMENT LOGGED</div>
          
          <div className="bg-white p-2 rounded max-w-max mb-4">
            <QRCode id={successTx.id} size={150} />
          </div>

          <div className="text-[16px] font-bold font-mono text-white mb-1">{successTx.detail}</div>
          <div className="text-[12px] font-sans text-[var(--color-light-muted)] mb-3">{successTx.name} &middot; {successTx.pieces} Pcs ({successTx.kg}kg)</div>
          
          <div className="w-full bg-[var(--color-obsidian)] rounded p-3 mb-4">
            <div className="text-[10px] font-mono text-[var(--color-muted)] mb-1 text-left">Details</div>
            <div className="text-[11px] font-mono text-white mb-2 text-left">{successTx.contentType} {successTx.slotRef ? `| Slot: ${successTx.slotRef}` : ''}</div>
            
            <div className="flex justify-between items-end mt-3 border-t border-[rgba(255,255,255,0.07)] pt-3">
              <div className="text-left">
                <div className="text-[20px] font-bold font-mono text-[var(--color-error)]">{fmt(successTx.amount)}</div>
              </div>
              <div className="text-right">
                <div className="text-[9px] font-mono text-[var(--color-muted)]">{successTx.mode} {successTx.bank ? `· ${successTx.bank}` : ''}</div>
                <div className="text-[9px] font-mono text-[var(--color-muted)]">{successTx.time}</div>
              </div>
            </div>
          </div>

          <div className="flex w-full space-x-2">
            <button onClick={handleReset} className="flex-1 py-3 bg-[var(--color-surface-1)] text-white text-[11px] font-mono rounded">
              Log Another
            </button>
            <button className="flex-1 py-3 bg-[var(--color-error)] text-white text-[11px] font-bold font-mono rounded">
              Print Label
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 pb-8">
      <div className="text-[9px] font-mono text-[var(--color-error)] tracking-[0.1em] uppercase">▸ AIR CARGO / COMMERCIAL</div>
      
      <div className="flex space-x-2 mb-2">
        {AIRLINES.map((a) => (
          <button
            key={a.code}
            onClick={() => setAirline(a)}
            className={`px-3 py-1.5 text-[10px] font-mono rounded-full border transition-colors ${airline.code === a.code ? 'border-[var(--color-error)] text-[var(--color-error)] bg-[rgba(239,68,68,0.1)]' : 'border-[rgba(255,255,255,0.2)] text-[var(--color-muted)] hover:border-white'}`}
          >
            {a.name}
          </button>
        ))}
      </div>

      <div className="space-y-4 bg-[var(--color-surface-1)] p-4 rounded border border-[rgba(255,255,255,0.07)]">
        
        <div className="flex space-x-3 items-end">
          <div className="flex-1">
            <label className="text-[9px] font-mono text-[var(--color-muted)] block mb-1">AWB Range Start</label>
            <input 
              placeholder="e.g. 14153"
              value={awbStart}
              onChange={(e) => setAwbStart(e.target.value)}
              className="w-full h-11 px-3 text-sm rounded font-sans"
            />
          </div>
          <div className="text-[12px] font-mono text-[var(--color-muted)] pb-3">to</div>
          <div className="flex-1">
            <label className="text-[9px] font-mono text-[var(--color-muted)] block mb-1">AWB End (Optional)</label>
            <input 
              placeholder="e.g. 14154"
              value={awbEnd}
              onChange={(e) => setAwbEnd(e.target.value)}
              className="w-full h-11 px-3 text-sm rounded font-sans"
            />
          </div>
        </div>

        <div>
           <label className="text-[9px] font-mono text-[var(--color-muted)] block mb-1">Consignee</label>
           <select 
             value={consignee}
             onChange={(e) => setConsignee(e.target.value)}
             className="w-full h-11 px-3 text-sm rounded font-sans"
           >
             {CORPORATE_CLIENTS.map(c => <option key={c} value={c}>{c}</option>)}
           </select>
        </div>

        <div className="flex space-x-3">
          <div className="flex-1">
             <label className="text-[9px] font-mono text-[var(--color-muted)] block mb-1">Total Pcs</label>
             <input 
               type="number"
               placeholder="___"
               value={pcs}
               onChange={(e) => setPcs(e.target.value)}
               className="w-full h-11 px-3 text-sm rounded font-sans"
             />
          </div>
          <div className="flex-1">
             <label className="text-[9px] font-mono text-[var(--color-muted)] block mb-1">Total KG</label>
             <input 
               type="number"
               step="0.1"
               placeholder="___"
               value={kg}
               onChange={(e) => setKg(e.target.value)}
               className="w-full h-11 px-3 text-sm rounded font-sans"
             />
          </div>
        </div>

        <div className="flex space-x-3">
          <div className="flex-1">
             <label className="text-[9px] font-mono text-[var(--color-muted)] block mb-1">Route</label>
             <select 
               value={route}
               onChange={(e) => setRoute(e.target.value)}
               className="w-full h-11 px-3 text-sm rounded font-sans"
             >
               {Object.keys(PRICING).map(r => <option key={r} value={r}>{r}</option>)}
             </select>
          </div>
          <div className="flex-1">
             <label className="text-[9px] font-mono text-[var(--color-muted)] block mb-1">Content</label>
             <select 
               value={contentType}
               onChange={(e) => setContentType(e.target.value)}
               className="w-full h-11 px-3 text-sm rounded font-sans items-center"
             >
               {CONTENT_TYPES.map(c => <option key={c} value={c}>{c}</option>)}
             </select>
          </div>
        </div>

        <div>
           <label className="text-[9px] font-mono text-[var(--color-muted)] block mb-1">Slot Ref</label>
           <input 
             placeholder="___"
             value={slotRef}
             onChange={(e) => setSlotRef(e.target.value)}
             className="w-full h-11 px-3 text-sm rounded font-sans"
           />
        </div>

        <div>
           <label className="text-[9px] font-mono text-[var(--color-muted)] block mb-1">Amount ₦</label>
           <input 
             type="number"
             placeholder="___"
             value={amount}
             onChange={(e) => setAmount(e.target.value)}
             className="w-full h-11 px-3 text-sm rounded font-sans text-[var(--color-error)] font-bold font-mono text-lg"
           />
        </div>

        <div className="flex space-x-3">
          <div className="flex-1">
             <label className="text-[9px] font-mono text-[var(--color-muted)] block mb-1">Payment</label>
             <select 
               value={mode}
               onChange={(e) => setMode(e.target.value)}
               className="w-full h-11 px-3 text-sm rounded font-sans"
             >
               <option value="Transfer">Transfer</option>
               <option value="Cash">Cash</option>
               <option value="Debt">Debt</option>
               <option value="Debt Paid">Debt Paid</option>
             </select>
          </div>
          {mode === 'Transfer' && (
             <div className="flex-1">
               <label className="text-[9px] font-mono text-[var(--color-muted)] block mb-1">Bank</label>
               <select 
                 value={bank}
                 onChange={(e) => setBank(e.target.value)}
                 className="w-full h-11 px-3 text-sm rounded font-sans items-center"
               >
                 {BANKS.map(c => <option key={c} value={c}>{c}</option>)}
               </select>
             </div>
          )}
        </div>

        {mode === 'Transfer' && (
          <div className="flex space-x-2">
            <input 
              placeholder="Paystack Reference (optional)"
              value={paystackRef}
              onChange={(e) => setPaystackRef(e.target.value)}
              className="w-full h-11 px-3 text-[12px] rounded font-mono"
            />
            <button 
              onClick={verifyPaystackPayment}
              disabled={isVerifying || !paystackRef.trim()}
              className="h-11 px-4 bg-[var(--color-accent-cobalt)] text-white text-[12px] font-bold font-mono rounded flex items-center shrink-0 disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {isVerifying ? <Loader2 size={16} className="animate-spin" /> : 'Verify'}
            </button>
          </div>
        )}
        
        {verificationResult && (
          <div className={`text-[10px] font-mono px-3 py-2 rounded ${verificationResult.verified ? 'bg-[rgba(16,185,129,0.1)] text-[var(--color-success)] border border-[rgba(16,185,129,0.2)]' : 'bg-[rgba(239,68,68,0.1)] text-[var(--color-error)] border border-[rgba(239,68,68,0.2)]'}`}>
            {verificationResult.message}
          </div>
        )}

        <div>
           <label className="text-[9px] font-mono text-[var(--color-muted)] block mb-1">Remarks</label>
           <input 
             placeholder="___"
             value={remarks}
             onChange={(e) => setRemarks(e.target.value)}
             className="w-full h-11 px-3 text-sm rounded font-sans"
           />
        </div>

      </div>

      <button
        onClick={handleSubmit}
        disabled={!isValid}
        className={`w-full py-[14px] rounded font-bold font-mono text-[13px] transition-colors ${isValid ? 'bg-[var(--color-error)] text-white' : 'bg-[var(--color-surface-2)] text-[var(--color-muted)] cursor-not-allowed'}`}
      >
        LOG CONSIGNMENT
      </button>

    </div>
  );
};
