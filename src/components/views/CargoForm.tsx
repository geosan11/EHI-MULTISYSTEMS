import { useState, useEffect } from 'react';
import { Transaction, CargoEntry } from '../../lib/types';
import { CORPORATE_CLIENTS, CONTENT_TYPES, BANKS } from '../../lib/constants';
import { fmt, uid, tnow } from '../../lib/helpers';
import { CheckCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { downloadCargoReceipt } from './CargoReceipt';

// Helper route options based on standard destinations
const CARGO_ROUTES = [
  'ABV/Abuja', 'PHC/Port Harcourt', 'BNI/Benin', 'KAN/Kano',
  'Asaba', 'Enugu', 'Warri', 'Owerri', 'Lagos', 'Kaduna',
  'Makurdi', 'Other'
];

export const CargoForm = ({ onAddTx }: { onAddTx: (tx: Transaction) => void }) => {
  const [serialNumber, setSerialNumber] = useState<number>(1);
  const [consignee, setConsignee] = useState(CORPORATE_CLIENTS[0] as string);
  const [airline, setAirline] = useState('Arik Air');
  const [customConsignee, setCustomConsignee] = useState('');
  const [awb, setAwb] = useState('');
  const [pcs, setPcs] = useState('1');
  const [kg, setKg] = useState('');
  const [route, setRoute] = useState(CARGO_ROUTES[0]);
  const [contentType, setContentType] = useState(CONTENT_TYPES[0] as string);
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<'Cash'|'Transfer'|'Debt'>('Cash');
  const [bank, setBank] = useState(BANKS[0] as string);
  const [remark, setRemark] = useState('');
  const [salesAnalysis, setSalesAnalysis] = useState('');
  
  const [successTx, setSuccessTx] = useState<Transaction | null>(null);

  async function getNextSerialNumber(): Promise<number> {
    try {
      const today = new Date().toISOString().split('T')[0];
      const { data } = await supabase
        .from('cargo_entries')
        .select('serial_number')
        .eq('entry_date', today)
        .order('serial_number', { ascending: false })
        .limit(1);

      if (data && data.length > 0) {
        return data[0].serial_number + 1;
      }
    } catch (e) {
      console.warn("Could not fetch serial, falling back to 1", e);
    }
    return 1;
  }

  useEffect(() => {
    getNextSerialNumber().then(setSerialNumber);
  }, []);

  const actualConsignee = consignee === 'Other' ? customConsignee : consignee;
  
  const isValid = actualConsignee.trim().length > 0 &&
                  awb.trim().length > 0 &&
                  route.trim().length > 0 &&
                  contentType.trim().length > 0 &&
                  parseFloat(amount) > 0;

  const handleSubmit = () => {
    if (!isValid) return;

    const summaryStr = `${airline} · ${awb} · ${pcs}pcs · ${kg}KG · ${route} · ${contentType}`;

    const tx: Transaction = {
      id: uid('CG'),
      name: actualConsignee,
      detail: summaryStr,
      amount: parseFloat(amount),
      mode,
      bank: mode === 'Transfer' ? bank : undefined,
      remarks: remark.trim(),
      time: tnow(),
      type: 'cargo',
      status: 'Intake',
      awb_tag_number: awb,
      pieces: parseInt(pcs) || 1,
      kg: parseFloat(kg) || 0,
    };

    onAddTx(tx);
    setSuccessTx(tx);
    
    // Auto increment conceptual
    getNextSerialNumber().then(setSerialNumber);
  };

  const handleReset = () => {
    setAwb('');
    setPcs('1');
    setKg('');
    setAmount('');
    setRemark('');
    setSalesAnalysis('');
    setSuccessTx(null);
  };

  const handleDownloadReceipt = () => {
    if (successTx) {
      downloadCargoReceipt(successTx, serialNumber);
    }
  };

  if (successTx) {
    return (
      <div className="p-4 space-y-4">
        <div className="bg-[rgba(16,185,129,0.1)] border border-[var(--color-success)] rounded text-center p-6 flex flex-col items-center">
          <CheckCircle size={32} className="text-[var(--color-success)] mb-3" />
          <div className="text-[12px] font-bold font-mono text-[var(--color-success)] mb-4">Entry Logged — #{serialNumber - 1}</div>
          
          <div className="w-full bg-[var(--color-surface-1)] rounded p-4 mb-6 border border-[rgba(255,255,255,0.07)] text-left space-y-2">
             <div className="flex justify-between border-b border-[rgba(255,255,255,0.05)] pb-2">
               <span className="text-[10px] font-mono text-[var(--color-muted)]">Consignee</span>
               <span className="text-[12px] font-mono text-white">{successTx.name}</span>
             </div>
             <div className="flex justify-between border-b border-[rgba(255,255,255,0.05)] pb-2">
               <span className="text-[10px] font-mono text-[var(--color-muted)]">AWB/Tag No</span>
               <span className="text-[12px] font-mono text-[var(--color-accent-amber)]">{successTx.awb_tag_number}</span>
             </div>
             <div className="flex justify-between border-b border-[rgba(255,255,255,0.05)] pb-2">
               <span className="text-[10px] font-mono text-[var(--color-muted)]">Weight / Route</span>
               <span className="text-[12px] font-mono text-white">{successTx.kg} KG — {successTx.detail.split('·')[3]}</span>
             </div>
             <div className="flex justify-between border-b border-[rgba(255,255,255,0.05)] pb-2">
               <span className="text-[10px] font-mono text-[var(--color-muted)]">Content</span>
               <span className="text-[12px] font-mono text-white">{successTx.detail.split('·')[4]}</span>
             </div>
             <div className="flex justify-between border-b border-[rgba(255,255,255,0.05)] pb-2">
               <span className="text-[10px] font-mono text-[var(--color-muted)]">Amount</span>
               <span className="text-[13px] font-bold font-mono text-white">{fmt(successTx.amount)}</span>
             </div>
             <div className="flex justify-between pt-1">
               <span className="text-[10px] font-mono text-[var(--color-muted)]">Payment</span>
               <span className="text-[12px] font-mono text-white">{successTx.mode} {successTx.bank && `(${successTx.bank})`}</span>
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
    <div className="p-4 space-y-4 pb-12">
      <div className="flex justify-between items-center mb-2">
        <div className="text-[9px] font-mono text-[var(--color-accent-amber)] tracking-[0.1em] uppercase">▸ NEW CARGO ENTRY</div>
        <div className="text-[11px] font-mono text-[var(--color-accent-amber)]">
          Entry #{serialNumber} — {new Date().toLocaleDateString('en-NG')}
        </div>
      </div>
      
      {/* OPERATIONAL SECTION */}
      <div className="space-y-4 bg-[var(--color-surface-1)] p-4 rounded border border-[rgba(255,255,255,0.07)]">
        
        <div>
          <label className="text-[9px] font-mono text-[var(--color-muted)] block mb-1">Consignee</label>
          <div className="flex space-x-2">
            <select 
              value={consignee}
              onChange={(e) => setConsignee(e.target.value)}
              className="w-full h-11 px-3 text-sm rounded font-sans"
            >
              {CORPORATE_CLIENTS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            {consignee === 'Other' && (
              <input 
                placeholder="Enter Consignee"
                value={customConsignee}
                onChange={(e) => setCustomConsignee(e.target.value)}
                className="w-full h-11 px-3 text-sm rounded font-sans"
              />
            )}
          </div>
        </div>

        <div>
          <label className="text-[9px] font-mono text-[var(--color-muted)] block mb-1">Airline</label>
          <div className="flex space-x-2">
             <select 
              value={airline}
              onChange={(e) => setAirline(e.target.value)}
              className="w-full h-11 px-3 text-sm rounded font-sans"
             >
               <option value="Arik Air">Arik Air</option>
               <option value="Green Africa">Green Africa</option>
               <option value="United Nigeria">United Nigeria</option>
               <option value="Other">Other</option>
             </select>
          </div>
        </div>

        <div>
          <label className="text-[9px] font-mono text-[var(--color-muted)] block mb-1">AWB / Tag No</label>
          <input 
            type="text"
            placeholder="e.g. 30795 or 31455-68"
            value={awb}
            onChange={(e) => setAwb(e.target.value.toUpperCase())}
            className="w-full h-11 px-3 text-[14px] font-bold rounded font-mono"
          />
          {awb.includes('-') && (
            <div className="text-[9px] font-mono text-[var(--color-accent-amber)] mt-1 ml-1 opacity-80">Range detected</div>
          )}
        </div>

        <div className="flex space-x-3">
          <div className="flex-1">
            <label className="text-[9px] font-mono text-[var(--color-muted)] block mb-1">Pcs</label>
            <input 
              type="number"
              min="1"
              value={pcs}
              onChange={(e) => setPcs(e.target.value)}
              className="w-full h-11 px-3 text-sm rounded font-sans"
            />
          </div>
          <div className="flex-1">
            <label className="text-[9px] font-mono text-[var(--color-muted)] block mb-1">KG</label>
            <input 
              type="number"
              step="0.1"
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
              className="w-full h-11 px-3 text-[13px] rounded font-sans"
            >
              {CARGO_ROUTES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="flex-1">
            <label className="text-[9px] font-mono text-[var(--color-muted)] block mb-1">Content</label>
            <select 
              value={contentType}
              onChange={(e) => setContentType(e.target.value)}
              className="w-full h-11 px-3 text-[13px] rounded font-sans"
            >
              {CONTENT_TYPES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center space-x-3 py-1 opacity-70">
        <div className="flex-1 h-[1px] bg-[rgba(255,255,255,0.1)]"></div>
        <div className="text-[9px] font-mono text-[var(--color-muted)] tracking-widest uppercase">FINANCIAL</div>
        <div className="flex-1 h-[1px] bg-[rgba(255,255,255,0.1)]"></div>
      </div>

      {/* FINANCIAL SECTION */}
      <div className="space-y-4 bg-[var(--color-surface-1)] p-4 rounded border border-[rgba(255,255,255,0.07)]">
        <div>
          <label className="text-[9px] font-mono text-[var(--color-muted)] block mb-1">Amount ₦</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)] font-mono text-lg">₦</span>
            <input 
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full h-14 pl-8 pr-3 text-[20px] font-bold text-[var(--color-accent-amber)] rounded font-mono"
            />
          </div>
        </div>

        <div className="flex space-x-3">
          <div className="flex-1">
            <label className="text-[9px] font-mono text-[var(--color-muted)] block mb-1">Receipt / Payment Mode</label>
            <div className="flex bg-[rgba(0,0,0,0.2)] rounded p-1">
              {['Cash', 'Transfer', 'Debt'].map(m => (
                <button
                  key={m}
                  onClick={() => setMode(m as any)}
                  className={`flex-1 py-2 text-[11px] font-mono rounded transition-colors ${mode === m ? 'bg-[var(--color-surface-2)] text-white' : 'text-[var(--color-muted)] hover:text-white'}`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        </div>
        
        {mode === 'Transfer' && (
          <div>
            <label className="text-[9px] font-mono text-[var(--color-muted)] block mb-1">Bank</label>
            <select 
              value={bank}
              onChange={(e) => setBank(e.target.value)}
              className="w-full h-11 px-3 text-sm rounded font-sans"
            >
              {BANKS.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
        )}

        <div>
           <label className="text-[9px] font-mono text-[var(--color-muted)] block mb-1">Remark</label>
           <input 
             placeholder="Optional notes"
             value={remark}
             onChange={(e) => setRemark(e.target.value)}
             className="w-full h-11 px-3 text-sm rounded font-sans"
           />
        </div>

        <div>
           <label className="text-[9px] font-mono text-[var(--color-muted)] block mb-1">Sales Analysis / Debt Notes</label>
           <textarea
             placeholder="e.g., Debt paid / ABV ₦667 outstanding / Transfer confirmed UBA"
             value={salesAnalysis}
             onChange={(e) => setSalesAnalysis(e.target.value)}
             className="w-full h-20 p-3 text-sm rounded font-sans resize-none"
             rows={3}
           />
        </div>
      </div>

      <button
        onClick={handleSubmit}
        disabled={!isValid}
        className={`w-full py-[14px] rounded font-bold font-mono text-[13px] transition-colors ${isValid ? 'bg-[var(--color-accent-amber)] text-[var(--color-obsidian)]' : 'bg-[var(--color-surface-2)] text-[var(--color-muted)] cursor-not-allowed'}`}
      >
        LOG CARGO ENTRY
      </button>

    </div>
  );
};
