import { useState } from 'react';
import { Transaction, User } from '../../lib/types';
import { CORPORATE_CLIENTS, CONTENT_TYPES, BANKS } from '../../lib/constants';
import { fmt, uid, tnow } from '../../lib/helpers';
import { CheckCircle, Loader2, User as UserIcon, Plane, Hash, Package, MapPin, Layers, Banknote, CreditCard, Landmark, MessageSquare } from 'lucide-react';
import { downloadCargoReceipt } from './CargoReceipt';
import { motion } from 'motion/react';
import { sendReceiptWhatsApp, buildCargoWhatsApp } from '../../lib/notifications';

const CARGO_ROUTES = [
  'ABV/Abuja', 'PHC/Port Harcourt', 'BNI/Benin', 'KAN/Kano',
  'Asaba', 'Enugu', 'Warri', 'Owerri', 'Lagos', 'Kaduna',
  'Makurdi', 'Other'
];

const LOCAL_SERIAL_KEY = () => {
  const today = new Date().toISOString().split('T')[0];
  return `ehi_cargo_serial_${today}`;
};

function getLocalSerial(): number {
  const stored = localStorage.getItem(LOCAL_SERIAL_KEY());
  return stored ? parseInt(stored) : 1;
}

function incrementLocalSerial(): number {
  const key = LOCAL_SERIAL_KEY();
  const next = getLocalSerial() + 1;
  localStorage.setItem(key, String(next));

  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  localStorage.removeItem(`ehi_cargo_serial_${yesterday}`);

  return next;
}

export const CargoForm = ({ onAddTx, user }: {
  onAddTx: (tx: Transaction) => void;
  user: User;
}) => {
  const [serialNumber, setSerialNumber] = useState<number>(getLocalSerial);
  const [consignee, setConsignee] = useState(CORPORATE_CLIENTS[0] as string);
  const [airline, setAirline] = useState('Arik Air');
  const [customConsignee, setCustomConsignee] = useState('');
  const [awb, setAwb] = useState('');
  const [pcs, setPcs] = useState('1');
  const [kg, setKg] = useState('');
  const [route, setRoute] = useState(CARGO_ROUTES[0]);
  const [contentType, setContentType] = useState(CONTENT_TYPES[0] as string);
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<'Cash' | 'Transfer' | 'POS' | 'Debt'>('Cash');
  const [bank, setBank] = useState(BANKS[0] as string);
  const [remark, setRemark] = useState('');
  const [senderPhone, setSenderPhone] = useState('');
  
  const [successTx, setSuccessTx] = useState<Transaction | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const actualConsignee = consignee === 'Other' ? customConsignee : consignee;
  const parsedAmount = parseFloat(amount) || 0;
  
  const isValid = actualConsignee.trim().length > 0 &&
                  awb.trim().length > 0 &&
                  route.trim().length > 0 &&
                  contentType.trim().length > 0 &&
                  parsedAmount > 0;

  const handleSubmit = () => {
    if (!isValid || submitting) return;
    setSubmitting(true);

    const summaryStr = `${airline} · ${awb} · ${pcs}pcs · ${kg}KG · ${route} · ${contentType}`;

    const tx: Transaction = {
      id: uid('CG'),
      name: actualConsignee,
      detail: summaryStr,
      amount: parsedAmount,
      mode,
      bank: (mode === 'Transfer' || mode === 'POS') ? bank : undefined,
      remarks: remark.trim(),
      time: tnow(),
      type: 'cargo',
      status: 'Intake',
      awb_tag_number: awb,
      pieces: parseInt(pcs) || 1,
      kg: parseFloat(kg) || 0,
    };

    setSuccessTx(tx);
    setSerialNumber(incrementLocalSerial());
    setSubmitting(false);

    onAddTx(tx);

    if (senderPhone.trim().length > 0) {
      sendReceiptWhatsApp({
        phone: senderPhone.trim(),
        ref: tx.id,
        message: buildCargoWhatsApp({
          ref: tx.id,
          consignee: actualConsignee,
          awb,
          route,
          kg,
          pcs,
          amount: parsedAmount,
          mode,
          bank: (mode === 'Transfer' || mode === 'POS') ? bank : undefined,
        }),
      });
    }
  };

  const handleReset = () => {
    setConsignee(CORPORATE_CLIENTS[0] as string);
    setCustomConsignee('');
    setAirline('Arik Air');
    setAwb('');
    setPcs('1');
    setKg('');
    setRoute(CARGO_ROUTES[0]);
    setContentType(CONTENT_TYPES[0] as string);
    setAmount('');
    setMode('Cash');
    setBank(BANKS[0] as string);
    setRemark('');
    setSenderPhone('');
    setSuccessTx(null);
  };

  const handleDownloadReceipt = async () => {
    if (successTx) {
      const { downloadCargoReceipt } = await import('./CargoReceipt');
      const data = {
        entryRef: successTx.id,
        serialNumber: serialNumber - 1,
        date: new Date().toLocaleDateString('en-GB'),
        hubName: user?.hub || 'EHI Cargo Station',
        agentName: user?.name || 'EHI Agent',
        airline: airline === 'Green Africa'
          ? 'Green Africa Airways'
          : airline === 'United Nigeria'
            ? 'United Nigeria Airlines'
            : airline,
        consignee: actualConsignee,
        awbTagNumber: awb,
        pieces: parseInt(pcs),
        kg: parseFloat(kg),
        route: route,
        contentType: contentType,
        amount: parsedAmount,
        paymentMode: mode,
        bankName: bank || undefined,
        remark: remark || undefined,
      };
      downloadCargoReceipt(data);
    }
  };

  const handlePrintReceipt = async () => {
    if (successTx) {
      const { printCargoReceipt } = await import('./CargoReceipt');
      const data = {
        entryRef: successTx.id,
        serialNumber: serialNumber - 1,
        date: new Date().toLocaleDateString('en-GB'),
        hubName: user?.hub || 'EHI Cargo Station',
        agentName: user?.name || 'EHI Agent',
        airline: airline === 'Green Africa'
          ? 'Green Africa Airways'
          : airline === 'United Nigeria'
            ? 'United Nigeria Airlines'
            : airline,
        consignee: actualConsignee,
        awbTagNumber: awb,
        pieces: parseInt(pcs),
        kg: parseFloat(kg),
        route: route,
        contentType: contentType,
        amount: parsedAmount,
        paymentMode: mode,
        bankName: bank || undefined,
        remark: remark || undefined,
      };
      printCargoReceipt(data);
    }
  };

  const formInputClass = "w-full h-12 px-3 text-[14px] rounded-xl bg-[var(--color-surface-2)] text-[var(--color-foreground)] border border-[var(--color-border)] font-sans focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-amber)] focus:border-[var(--color-accent-amber)] transition-all";

  const renderLabel = (icon: any, text: string) => {
    const Icon = icon;
    return (
      <div className="flex items-center space-x-1.5 mb-1.5">
        <Icon size={14} className="text-[var(--color-light-muted)]" />
        <label className="text-[13px] font-sans font-medium text-[var(--color-light-muted)]">{text}</label>
      </div>
    );
  };

  if (successTx) {
    return (
      <div className="p-4 space-y-4 max-w-md mx-auto">
        <div className="border-b border-[rgba(255,255,255,0.07)] pb-2 mb-2">
          <span className="text-[14px] font-sans font-semibold text-[var(--color-foreground)]">Cargo Receipt</span>
        </div>

        <motion.div 
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', damping: 15, stiffness: 200 }}
          className="bg-[rgba(16,185,129,0.05)] border border-[var(--color-success)] rounded-xl text-center p-8 flex flex-col items-center"
        >
          <motion.div
            animate={{ scale: [1, 1.15, 1] }}
            transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
          >
            <CheckCircle size={40} className="text-[var(--color-success)] mb-3" />
          </motion.div>
          <div className="text-[14px] font-medium font-sans text-[var(--color-success)] mb-1">Cargo entry saved successfully!</div>
          <div className="text-[12px] font-mono text-[var(--color-muted)] mb-6">
            REF: {successTx.id}
          </div>
          
          <div className="w-full bg-[var(--color-surface-card)] rounded-xl p-4 mb-8 border border-[var(--color-border)] text-left space-y-3">
             <div className="flex justify-between border-b border-[rgba(255,255,255,0.05)] pb-2">
               <span className="text-[13px] font-sans text-[var(--color-muted)]">Consignee</span>
               <span className="text-[14px] font-sans font-medium text-[var(--color-foreground)]">{successTx.name}</span>
             </div>
             <div className="flex justify-between border-b border-[rgba(255,255,255,0.05)] pb-2">
               <span className="text-[13px] font-sans text-[var(--color-muted)]">AWB / Tag No</span>
               <span className="text-[14px] font-sans font-medium text-[var(--color-accent-amber)]">{successTx.awb_tag_number}</span>
             </div>
             <div className="flex justify-between border-b border-[rgba(255,255,255,0.05)] pb-2">
               <span className="text-[13px] font-sans text-[var(--color-muted)]">Weight / Route</span>
               <span className="text-[14px] font-sans font-medium text-white">{successTx.kg} KG — {successTx.detail.split(' · ')[4]}</span>
             </div>
             <div className="flex justify-between border-b border-[rgba(255,255,255,0.05)] pb-2">
               <span className="text-[13px] font-sans text-[var(--color-muted)]">Content</span>
               <span className="text-[14px] font-sans font-medium text-white">{successTx.detail.split(' · ')[5]}</span>
             </div>
             <div className="flex justify-between border-b border-[rgba(255,255,255,0.05)] pb-2">
               <span className="text-[13px] font-sans text-[var(--color-muted)]">Amount</span>
               <span className="text-[15px] font-bold font-mono text-[var(--color-accent-amber)]">{fmt(successTx.amount)}</span>
             </div>
             <div className="flex justify-between pt-1">
               <span className="text-[13px] font-sans text-[var(--color-muted)]">Payment</span>
               <span className="text-[14px] font-sans text-white">{successTx.mode} {successTx.bank && `(${successTx.bank})`}</span>
             </div>
          </div>

          <div className="flex w-full space-x-3">
            <button onClick={handleReset} className="flex-1 py-3.5 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-1)] text-white text-[14px] font-sans font-medium rounded-xl transition-colors cursor-pointer focus:outline-none">
              New Entry
            </button>
            <button onClick={handlePrintReceipt} className="flex-1 py-3.5 bg-[var(--color-accent-amber)] hover:bg-opacity-90 text-[var(--color-obsidian)] text-[14px] font-bold font-sans rounded-xl transition-opacity cursor-pointer focus:outline-none">
              Print Receipt
            </button>
          </div>
          
          <button
            onClick={handleDownloadReceipt}
            style={{
              width: '100%', padding: '11px',
              background: 'transparent',
              border: '1px solid rgba(245,158,11,0.3)',
              borderRadius: 8, cursor: 'pointer',
              fontSize: 11, fontFamily: 'monospace',
              fontWeight: 700, color: 'var(--color-accent-amber)',
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
    <div className="p-4 pb-24 h-full" style={{ width: '100%', boxSizing: 'border-box' }}>
      <div className="grid gap-6 md:grid-cols-[1fr_280px]">
        <div>
          <div className="flex flex-col mb-4">
            <h1 className="text-[18px] font-sans font-bold text-white leading-tight">New Cargo Entry</h1>
          </div>
          
          <div className="space-y-4">
            <div>
              {renderLabel(UserIcon, "Consignee")}
              <div className="flex flex-col space-y-2">
                <select 
                  value={consignee}
                  onChange={(e) => setConsignee(e.target.value)}
                  className={formInputClass}
                >
                  {CORPORATE_CLIENTS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                {consignee === 'Other' && (
                  <input 
                    placeholder="Enter Consignee Name"
                    value={customConsignee}
                    onChange={(e) => setCustomConsignee(e.target.value)}
                    className={formInputClass}
                  />
                )}
              </div>
            </div>

            <div>
              {renderLabel(Plane, "Airline")}
              <select 
                value={airline}
                onChange={(e) => setAirline(e.target.value)}
                className={formInputClass}
              >
                <option value="Arik Air">Arik Air</option>
                <option value="Green Africa">Green Africa</option>
                <option value="United Nigeria">United Nigeria</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div>
              {renderLabel(Hash, "AWB / Tag No")}
              <input 
                type="text"
                placeholder="e.g. 30795 or 31455-68"
                value={awb}
                onChange={(e) => setAwb(e.target.value.toUpperCase())}
                className={`${formInputClass} font-mono`}
              />
              {awb.includes('-') && (
                <div className="text-[11px] font-sans text-[var(--color-accent-amber)] mt-1 text-right">Range detected</div>
              )}
            </div>

            <div className="flex space-x-3">
              <div className="flex-1">
                {renderLabel(Package, "Pcs")}
                <input 
                  type="number"
                  min="1"
                  value={pcs}
                  onChange={(e) => setPcs(e.target.value)}
                  className={formInputClass}
                />
              </div>
              <div className="flex-1">
                {renderLabel(Package, "KG")}
                <input 
                  type="number"
                  step="0.1"
                  value={kg}
                  onChange={(e) => setKg(e.target.value)}
                  className={formInputClass}
                />
              </div>
            </div>

            <div className="flex space-x-3">
              <div className="flex-1">
                {renderLabel(MapPin, "Route")}
                <select 
                  value={route}
                  onChange={(e) => setRoute(e.target.value)}
                  className={formInputClass}
                >
                  {CARGO_ROUTES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div className="flex-1">
                {renderLabel(Layers, "Content")}
                <select 
                  value={contentType}
                  onChange={(e) => setContentType(e.target.value)}
                  className={formInputClass}
                >
                  {CONTENT_TYPES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-3 my-6">
            <div className="w-1 h-5 bg-[var(--color-accent-amber)] rounded-full"></div>
            <div className="text-[14px] font-sans font-medium text-[var(--color-accent-amber)]">Payment Details</div>
            <div className="flex-1 h-px bg-[rgba(255,255,255,0.07)]"></div>
          </div>

          <div className="space-y-4">
            <div>
              {renderLabel(Banknote, "Amount")}
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-muted)] font-mono text-[18px]">₦</span>
                <input 
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full h-14 pl-9 pr-4 text-[18px] md:text-[22px] font-bold text-[var(--color-accent-amber)] rounded-xl bg-[var(--color-surface-2)] border border-[rgba(255,255,255,0.07)] font-mono focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-amber)] focus:border-[var(--color-accent-amber)] transition-all"
                />
              </div>
            </div>

            <div>
              {renderLabel(CreditCard, "Receipt / Payment Mode")}
              <div className="flex bg-[var(--color-surface-1)] rounded-xl p-1.5 border border-[rgba(255,255,255,0.07)] mb-3">
                {['Cash', 'Transfer', 'POS'].map(m => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m as any)}
                    className={`flex-1 py-2.5 text-[13px] font-sans font-medium rounded-lg transition-colors cursor-pointer focus:outline-none ${mode === m ? 'bg-[var(--color-surface-2)] text-white shadow-sm' : 'text-[var(--color-muted)] hover:text-white'}`}
                  >
                    {m}
                  </button>
                ))}
              </div>

              <div className="flex items-center justify-center space-x-3 my-3">
                 <div className="flex-1 h-px bg-[rgba(255,255,255,0.05)]" />
                 <div className="text-[11px] font-sans text-[var(--color-muted)] uppercase tracking-wider">OR</div>
                 <div className="flex-1 h-px bg-[rgba(255,255,255,0.05)]" />
              </div>

              <button
                type="button"
                onClick={() => setMode('Debt')}
                className={`w-full py-2.5 text-[13px] font-sans font-medium rounded-lg border transition-colors cursor-pointer focus:outline-none ${mode === 'Debt' ? 'bg-[rgba(239,68,68,0.1)] border-[var(--color-error)] text-[var(--color-error)] shadow-sm' : 'bg-transparent border-[rgba(239,68,68,0.3)] text-[var(--color-error)] hover:bg-[rgba(239,68,68,0.05)]'}`}
              >
                Log as Credit Sale (Debt)
              </button>
              
              {mode === 'Debt' && (
                <div className="mt-2 text-[12px] font-sans text-[var(--color-error)] bg-[rgba(239,68,68,0.05)] p-2.5 rounded-lg border border-[rgba(239,68,68,0.1)]">
                  This sale will be logged as a credit. Collect payment before dispatch or arrange with management.
                </div>
              )}
            </div>
            
            {mode === 'Transfer' && (
              <motion.div
                 initial={{ height: 0, opacity: 0 }}
                 animate={{ height: "auto", opacity: 1 }}
                 className="overflow-hidden"
              >
                {renderLabel(Landmark, "Bank")}
                <select 
                  value={bank}
                  onChange={(e) => setBank(e.target.value)}
                  className={formInputClass}
                >
                  {BANKS.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </motion.div>
            )}

            {mode === 'POS' && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                className="overflow-hidden"
              >
                {renderLabel(CreditCard, "POS Terminal / Bank")}
                <select
                  value={bank}
                  onChange={(e) => setBank(e.target.value)}
                  className={formInputClass}
                >
                  {BANKS.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </motion.div>
            )}

            <div>
               {renderLabel(MessageSquare, "Remark (Optional)")}
               <input 
                 placeholder="Add notes..."
                 value={remark}
                 onChange={(e) => setRemark(e.target.value)}
                 className={formInputClass}
               />
            </div>

            <div>
              {renderLabel(MessageSquare, "Sender Phone — WhatsApp Receipt (Optional)")}
              <input
                type="tel"
                placeholder="e.g. 08012345678"
                value={senderPhone}
                onChange={(e) => setSenderPhone(e.target.value)}
                className={formInputClass}
              />
            </div>
          </div>

          <div className="pt-8">
            <button
              onClick={handleSubmit}
              disabled={!isValid || submitting}
              className={`w-full py-4 rounded-xl font-sans font-bold text-[16px] flex items-center justify-center gap-2 transition-all focus:outline-none ${
                submitting ? 'opacity-80 cursor-wait bg-[var(--color-accent-amber)] text-[var(--color-obsidian)]' :
                !isValid ? 'bg-[var(--color-surface-2)] text-[var(--color-muted)] cursor-not-allowed' :
                'bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] cursor-pointer hover:bg-opacity-90'
              }`}
            >
              {submitting && <Loader2 size={18} className="animate-spin" />}
              {submitting ? 'LOGGING...' : 'LOG CARGO ENTRY'}
            </button>
          </div>
        </div>

        {/* Desktop sticky summary */}
        <aside className="hidden md:block">
          <div style={{
            position: 'sticky', top: 16,
            background: 'var(--color-surface-card)',
            border: '1px solid var(--color-border)',
            borderRadius: 12, padding: 20,
          }}>
            <div style={{
              fontSize: 10, fontFamily: 'monospace',
              color: 'var(--color-muted)',
              textTransform: 'uppercase', letterSpacing: '0.1em',
              marginBottom: 16, fontWeight: 600
            }}>
              ENTRY SUMMARY
            </div>
            <div style={{ fontSize: 13, fontFamily: 'monospace', lineHeight: 2.2, color: 'var(--color-foreground)' }}>
              <div className="flex justify-between"><span style={{ color: 'var(--color-muted)' }}>Consignee</span><span className="truncate ml-4 font-medium" style={{ maxWidth: '140px' }}>{actualConsignee || '—'}</span></div>
              <div className="flex justify-between"><span style={{ color: 'var(--color-muted)' }}>AWB</span><span className="font-semibold text-[var(--color-accent-amber)]">{awb || '—'}</span></div>
              <div className="flex justify-between"><span style={{ color: 'var(--color-muted)' }}>Route</span><span className="font-medium">{route}</span></div>
              <div className="flex justify-between"><span style={{ color: 'var(--color-muted)' }}>Content</span><span className="font-medium">{contentType}</span></div>
              <div className="flex justify-between"><span style={{ color: 'var(--color-muted)' }}>Pcs / KG</span><span className="font-medium">{pcs || '—'} / {kg || '—'}</span></div>
            </div>
            <div style={{
              borderTop: '1px solid var(--color-border)',
              paddingTop: 16, marginTop: 16,
            }}>
              <div style={{
                fontSize: 10, fontFamily: 'monospace',
                color: 'var(--color-muted)', marginBottom: 6,
                fontWeight: 600, letterSpacing: '0.05em'
              }}>AMOUNT</div>
              <div style={{
                fontSize: 28, fontWeight: 800, fontFamily: 'monospace',
                color: parsedAmount > 0
                  ? 'var(--color-accent-amber)'
                  : 'var(--color-light-muted)',
              }}>
                {parsedAmount > 0
                  ? '₦' + parsedAmount.toLocaleString('en-NG')
                  : '₦0'}
              </div>
              <div style={{
                fontSize: 11, fontFamily: 'monospace',
                color: 'var(--color-muted)', marginTop: 6,
              }}>
                {mode}{mode === 'Transfer' && bank ? ` · ${bank}` : ''}
              </div>
            </div>
            <div style={{
              fontSize: 10, fontFamily: 'monospace',
              color: 'var(--color-muted)', marginTop: 24,
              display: 'flex', justifyContent: 'space-between'
            }}>
              <span>{new Date().toLocaleDateString('en-NG')}</span>
              <span>Entry #{serialNumber}</span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};

