import { useState } from 'react';
import { PRICING, BANKS } from '../../lib/constants';
import { PaymentMode, Transaction } from '../../lib/types';
import { fmt, uid, tnow } from '../../lib/helpers';
import { CheckCircle, Loader2 } from 'lucide-react';
import { QRCode } from '../QRCode';

export const CargoForm = ({ onAddTx }: { onAddTx: (tx: Transaction) => void }) => {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [route, setRoute] = useState(Object.keys(PRICING)[0]);
  const [mode, setMode] = useState<PaymentMode>('Cash');
  const [bank, setBank] = useState('');
  const [notes, setNotes] = useState('');
  
  const [bb, setBb] = useState(0);
  const [mb, setMb] = useState(0);
  const [sb, setSb] = useState(0);

  const [paystackRef, setPaystackRef] = useState('');
  const [verificationResult, setVerificationResult] = useState<{ verified: boolean, message: string } | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);

  const [successTx, setSuccessTx] = useState<Transaction | null>(null);

  const routePrices = PRICING[route];
  const totalAmount = (bb * routePrices.BB) + (mb * routePrices.MB) + (sb * routePrices.SB);
  
  let details = [];
  if (bb > 0) details.push(`${bb}BB`);
  if (mb > 0) details.push(`${mb}MB`);
  if (sb > 0) details.push(`${sb}SB`);
  const summaryStr = `${details.join(' ')} → ${route}`;

  const isValid = name.trim().length > 0 && phone.trim().length > 0 && totalAmount > 0;

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

    const tx: Transaction = {
      id: uid('WB'),
      name: name.trim(),
      detail: summaryStr,
      amount: totalAmount,
      mode,
      bank: mode === 'Transfer' || mode === 'Debt' ? bank : undefined,
      remarks: notes.trim(),
      time: tnow(),
      type: 'cargo',
      status: 'Intake'
    };

    onAddTx(tx);
    setSuccessTx(tx);
  };

  const handleReset = () => {
    setName('');
    setPhone('');
    setBb(0);
    setMb(0);
    setSb(0);
    setBank('');
    setNotes('');
    setPaystackRef('');
    setVerificationResult(null);
    setSuccessTx(null);
  };

  const handleDownloadReceipt = () => {
    alert("Downloading PDF receipt...");
  };

  if (successTx) {
    return (
      <div className="p-4 space-y-4">
        <div className="bg-[rgba(16,185,129,0.1)] border border-[var(--color-success)] rounded text-center p-6 flex flex-col items-center">
          <CheckCircle size={32} className="text-[var(--color-success)] mb-3" />
          <div className="text-[10px] font-mono text-[var(--color-success)] uppercase tracking-widest mb-4">WAYBILL GENERATED</div>
          
          <div className="bg-white p-2 rounded max-w-max mb-4">
            <QRCode id={successTx.id} size={150} />
          </div>

          <div className="text-[16px] font-bold font-mono text-white mb-1">{successTx.id}</div>
          <div className="text-[12px] font-sans text-[var(--color-light-muted)] mb-3">{successTx.name}</div>
          
          <div className="w-full bg-[var(--color-obsidian)] rounded p-3 mb-4">
            <div className="text-[10px] font-mono text-[var(--color-muted)] mb-1">Details</div>
            <div className="text-[11px] font-mono text-white mb-2">{successTx.detail}</div>
            
            <div className="flex justify-between items-end mt-3 border-t border-[rgba(255,255,255,0.07)] pt-3">
              <div className="text-left">
                <div className="text-[20px] font-bold font-mono text-[var(--color-accent-amber)]">{fmt(successTx.amount)}</div>
              </div>
              <div className="text-right">
                <div className="text-[9px] font-mono text-[var(--color-muted)]">{successTx.mode}</div>
                <div className="text-[9px] font-mono text-[var(--color-muted)]">{successTx.time}</div>
              </div>
            </div>
          </div>

          <div className="flex w-full space-x-2">
            <button onClick={handleReset} className="flex-1 py-3 bg-[var(--color-surface-1)] text-white text-[11px] font-mono rounded">
              New Entry
            </button>
            <button onClick={handleDownloadReceipt} className="flex-1 py-3 bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] text-[11px] font-bold font-mono rounded">
              Print Receipt
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 pb-8">
      <div className="text-[9px] font-mono text-[var(--color-accent-amber)] tracking-[0.1em] uppercase">▸ NEW CARGO WAYBILL</div>
      
      <div className="space-y-3">
        <input 
          placeholder="Customer Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full h-11 px-3 text-sm rounded font-sans"
        />
        
        <div className="flex space-x-3">
          <input 
            type="tel"
            placeholder="Phone Number"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="flex-1 h-11 px-3 text-sm rounded font-sans min-w-0"
          />
          <select 
            value={route}
            onChange={(e) => setRoute(e.target.value)}
            className="flex-1 h-11 px-3 text-sm rounded font-sans min-w-0"
          >
            {Object.keys(PRICING).map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        
        <div className="flex space-x-3">
          <select 
            value={mode}
            onChange={(e) => setMode(e.target.value as PaymentMode)}
            className="h-11 px-3 text-sm flex-1 rounded font-sans"
          >
            <option value="Cash">Cash</option>
            <option value="POS">POS</option>
            <option value="Transfer">Transfer</option>
            <option value="Debt">Debt</option>
          </select>

          {(mode === 'Transfer' || mode === 'Debt') && (
            <select 
              value={bank}
              onChange={(e) => setBank(e.target.value)}
              className="h-11 px-3 text-sm flex-1 rounded font-sans"
            >
              <option value="">Select Bank</option>
              {BANKS.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
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
        
        <input 
          placeholder="Notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full h-11 px-3 text-sm rounded font-sans"
        />
      </div>

      <div className="bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.07)] rounded overflow-hidden">
        <div className="bg-[rgba(255,255,255,0.02)] py-2 text-center text-[10px] font-mono text-[var(--color-light-muted)] border-b border-[rgba(255,255,255,0.05)]">
          Package Count × Rate
        </div>
        
        <div className="flex divide-x divide-[rgba(255,255,255,0.07)]">
          {/* BB */}
          <div className="flex-1 flex flex-col items-center py-4">
            <div className="text-[11px] font-bold font-mono text-white">Big Bag</div>
            <div className="text-[9px] font-mono text-[var(--color-accent-amber)] opacity-70 mb-3">{fmt(routePrices.BB)}</div>
            
            <div className="flex items-center space-x-2">
              <button 
                onClick={() => setBb(prev => Math.max(0, prev - 1))}
                className="w-[30px] h-[30px] rounded bg-[var(--color-surface-2)] text-white text-[14px] flex items-center justify-center hover:bg-[rgba(255,255,255,0.1)] focus:outline-none"
              >-</button>
              <div className={`text-[20px] font-bold font-mono w-[20px] text-center ${bb > 0 ? 'text-[var(--color-accent-amber)]' : 'text-[var(--color-muted)]'}`}>{bb}</div>
              <button 
                onClick={() => setBb(prev => prev + 1)}
                className="w-[30px] h-[30px] rounded bg-[var(--color-surface-2)] text-white text-[14px] flex items-center justify-center hover:bg-[rgba(255,255,255,0.1)] focus:outline-none"
              >+</button>
            </div>
          </div>

          {/* MB */}
          <div className="flex-1 flex flex-col items-center py-4">
            <div className="text-[11px] font-bold font-mono text-white">Med Bag</div>
            <div className="text-[9px] font-mono text-[var(--color-accent-amber)] opacity-70 mb-3">{fmt(routePrices.MB)}</div>
            
            <div className="flex items-center space-x-2">
              <button 
                onClick={() => setMb(prev => Math.max(0, prev - 1))}
                className="w-[30px] h-[30px] rounded bg-[var(--color-surface-2)] text-white text-[14px] flex items-center justify-center hover:bg-[rgba(255,255,255,0.1)] focus:outline-none"
              >-</button>
              <div className={`text-[20px] font-bold font-mono w-[20px] text-center ${mb > 0 ? 'text-[var(--color-accent-amber)]' : 'text-[var(--color-muted)]'}`}>{mb}</div>
              <button 
                onClick={() => setMb(prev => prev + 1)}
                className="w-[30px] h-[30px] rounded bg-[var(--color-surface-2)] text-white text-[14px] flex items-center justify-center hover:bg-[rgba(255,255,255,0.1)] focus:outline-none"
              >+</button>
            </div>
          </div>

          {/* SB */}
          <div className="flex-1 flex flex-col items-center py-4">
            <div className="text-[11px] font-bold font-mono text-white">Sml Bag</div>
            <div className="text-[9px] font-mono text-[var(--color-accent-amber)] opacity-70 mb-3">{fmt(routePrices.SB)}</div>
            
            <div className="flex items-center space-x-2">
              <button 
                onClick={() => setSb(prev => Math.max(0, prev - 1))}
                className="w-[30px] h-[30px] rounded bg-[var(--color-surface-2)] text-white text-[14px] flex items-center justify-center hover:bg-[rgba(255,255,255,0.1)] focus:outline-none"
              >-</button>
              <div className={`text-[20px] font-bold font-mono w-[20px] text-center ${sb > 0 ? 'text-[var(--color-accent-amber)]' : 'text-[var(--color-muted)]'}`}>{sb}</div>
              <button 
                onClick={() => setSb(prev => prev + 1)}
                className="w-[30px] h-[30px] rounded bg-[var(--color-surface-2)] text-white text-[14px] flex items-center justify-center hover:bg-[rgba(255,255,255,0.1)] focus:outline-none"
              >+</button>
            </div>
          </div>
        </div>
      </div>

      <div className={`rounded p-4 transition-colors duration-300 ${totalAmount > 0 ? 'bg-[rgba(245,158,11,0.1)] border border-[rgba(245,158,11,0.2)]' : 'bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.07)]'}`}>
        <div className="text-[10px] font-mono text-[var(--color-muted)] mb-1">Auto-Calculated Total</div>
        <div className={`text-[30px] font-bold font-mono ${totalAmount > 0 ? 'text-[var(--color-accent-amber)]' : 'text-[var(--color-muted)]'}`}>
          {totalAmount > 0 ? fmt(totalAmount) : '—'}
        </div>
        {totalAmount > 0 && (
          <div className="text-[10px] font-mono text-white opacity-80 mt-1">{summaryStr}</div>
        )}
      </div>

      <button
        onClick={handleSubmit}
        disabled={!isValid}
        className={`w-full py-[14px] rounded font-bold font-mono text-[13px] transition-colors ${isValid ? 'bg-[var(--color-accent-amber)] text-[var(--color-obsidian)]' : 'bg-[var(--color-surface-2)] text-[var(--color-muted)] cursor-not-allowed'}`}
      >
        GENERATE WAYBILL + QR
      </button>

    </div>
  );
};
