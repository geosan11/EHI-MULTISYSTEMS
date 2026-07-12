import { useState, useEffect } from 'react';
import { PaymentMode, Transaction, User } from '../../lib/types';
import { fmt, tnow, getHubCode } from '../../lib/helpers';
import { CheckCircle, Loader2, ClipboardList, MessageSquare, Plus, Printer, Bluetooth } from 'lucide-react';
import { QRCode } from '../QRCode';
import { sendReceiptWhatsApp, buildValueJetWhatsApp } from '../../lib/notifications';
import { PaymentNarrationBox } from '../PaymentNarrationBox';
import { CARGO_ROUTES, BANKS } from '../../lib/constants';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/ToastContext';

export const ValueJetForm = ({
  onAddTx,
  user,
  onShowHistory,
  transactions = [],
}: {
  onAddTx: (tx: Transaction) => void;
  user: User;
  onShowHistory?: () => void;
  transactions?: Transaction[];
}) => {
  const [name, setName] = useState('');
  const [pnr, setPnr]   = useState('');
  // ValueJet's IATA code is fixed (VK) -- staff only ever key in the flight
  // number itself, never the airline prefix, so store just the digits and
  // compose the real flight code from that everywhere it's needed.
  const [flight, setFlight] = useState('');
  const flightCode = flight ? `VK${flight}` : '';
  const [dest, setDest] = useState(CARGO_ROUTES[0]);
  const [kg, setKg] = useState('');
  const [pcs, setPcs] = useState('');
  const [phone, setPhone] = useState('');
  const [mode, setMode] = useState<PaymentMode>('POS');
  const [bank, setBank] = useState(BANKS[0] || 'Sterling Bank');
  const [amountOverride, setAmountOverride] = useState<string>('');
  const [narrationCode, setNarrationCode] = useState<string>('');

  const [successTx, setSuccessTx] = useState<{ tx: Transaction, kgs: number, exc: number, pcs: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (successTx) {
      document.querySelectorAll('.overflow-y-auto, main').forEach(el => {
        el.scrollTop = 0;
      });
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  }, [successTx]);

  useEffect(() => {
    if (mode === 'Transfer' && !narrationCode) {
      import('../../lib/helpers').then(({ generatePaymentNarration }) => {
        // use a random serial for VJ if none exists since we don't track VJ serials the same way
        setNarrationCode(generatePaymentNarration(user.hub_code || user.hub, Math.floor(Math.random() * 9000) + 1000));
      });
    }
  }, [mode, narrationCode, user.hub]);

  // Was reading localStorage directly on every render -- a value set in
  // Pricing Configuration on another device would never reach this screen
  // at all. Now loads from the same Supabase-backed config, with the
  // localStorage read as an instant first-paint value while that fetch
  // is in flight (and as an offline fallback).
  const [vjFreeAllowance, setVjFreeAllowance] = useState(() =>
    parseFloat(localStorage.getItem('ehi_vj_free_kg') || '23')
  );
  const [vjRatePerKg, setVjRatePerKg] = useState(() =>
    parseFloat(localStorage.getItem('ehi_vj_rate_per_kg') || '1000')
  );

  useEffect(() => {
    supabase.from('pricing_config').select('config_value').eq('config_key', 'vj_settings').single()
      .then(({ data, error }) => {
        if (data?.config_value && !error) {
          const cfg = data.config_value as { freeKg?: string | number; ratePerKg?: string | number };
          if (cfg.freeKg !== undefined) {
            setVjFreeAllowance(parseFloat(String(cfg.freeKg)));
            localStorage.setItem('ehi_vj_free_kg', String(cfg.freeKg));
          }
          if (cfg.ratePerKg !== undefined) {
            setVjRatePerKg(parseFloat(String(cfg.ratePerKg)));
            localStorage.setItem('ehi_vj_rate_per_kg', String(cfg.ratePerKg));
          }
        }
      });
  }, []);

  const kgVal = Math.round(parseFloat(kg)) || 0;
  const pcsVal = Math.max(1, parseInt(pcs) || 1);
  const excessKg = Math.max(0, kgVal - vjFreeAllowance);
  const minAmount = excessKg * vjRatePerKg;
  const parsedOverride = parseFloat(amountOverride) || 0;
  const totalAmount = amountOverride !== "" ? parsedOverride : minAmount;

  const isValid = name.trim().length > 0 && flight.trim().length > 0 && kgVal > 0 && (amountOverride === "" || parsedOverride >= minAmount);

  const { showToast } = useToast();

  const handleSubmit = async () => {
    if (!isValid || submitting) return;

    setSubmitting(true);

    const hubCode = getHubCode(user.hub_code || user.hub);
    const { data: seq, error: tagError } = await supabase.rpc('next_awb_number', { p_hub_code: `${hubCode}-VJ` });
    if (tagError || !seq) {
      showToast({ message: `Failed to generate tag number: ${tagError?.message || 'unknown error'}. Please try again.`, type: 'error' });
      setSubmitting(false);
      return;
    }
    const resolvedTag = `EHI-${hubCode}-VJ-${String(seq).padStart(6, '0')}`;

    const tx: Transaction = {
      id: resolvedTag,
      name: name.trim(),
      detail: `${flightCode} · ${dest} · ${pcsVal}pcs · +${excessKg}kg excess`,
      amount: totalAmount,
      mode,
      bank: mode === 'Transfer' || mode === 'POS' ? bank : undefined,
      paymentNarration: mode === 'Transfer' ? narrationCode : undefined,
      airline: 'ValueJet',
      time: tnow(),
      type: 'baggage',
      status: 'Delivered',
      destination: dest,
      excessKg: excessKg,
      totalKg: kgVal,
      flight: flightCode,
      pnr: pnr.trim().toUpperCase() || undefined,
      kg: excessKg,
      pieces: pcsVal,
      // TODO: capture client_type at entry
    } as any;
    // Attach phone for EHIApp to write to passenger_phone column
    (tx as any).phone = phone.trim() || undefined;

    setSuccessTx({ tx, kgs: kgVal, exc: excessKg, pcs: pcsVal });
    setSubmitting(false);

    onAddTx(tx);

    if (phone.trim().length > 0) {
      sendReceiptWhatsApp({
        phone: phone.trim(),
        ref: tx.id,
        message: buildValueJetWhatsApp({
          ref: tx.id,
          passenger: name.trim(),
          flight: flightCode,
          totalPieces: pcsVal,
          totalKg: kgVal,
          excessKg,
          amount: totalAmount,
          mode,
        }, vjFreeAllowance, vjRatePerKg),
      });
    }
  };

  const handleReset = () => {
    setName('');
    setPnr('');
    setFlight('');
    setDest(CARGO_ROUTES[0]);
    setKg('');
    setPcs('');
    setAmountOverride('');
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
        flightNumber: flightCode,
        destination: dest || 'Unknown',
        totalPieces: successTx.pcs,
        totalBaggage: successTx.kgs,
        freeAllowance: vjFreeAllowance,
        excessKg: successTx.exc,
        ratePerKg: vjRatePerKg,
        amount: successTx.tx.amount,
        paymentMode: successTx.tx.mode,
        paymentNarration: successTx.tx.paymentNarration,
        bankName: successTx.tx.bank,
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
      flightNumber: flightCode,
      destination: dest || 'Unknown',
      totalPieces: successTx.pcs,
      totalBaggage: successTx.kgs,
      freeAllowance: vjFreeAllowance,
      excessKg: successTx.exc,
      ratePerKg: vjRatePerKg,
      amount: successTx.tx.amount,
      paymentMode: successTx.tx.mode,
      paymentNarration: successTx.tx.paymentNarration,
      bankName: successTx.tx.bank,
    });
  };

  const formInputClass = "w-full h-12 px-4 text-[16px] rounded-[var(--radius-sm)] bg-[var(--color-input-bg)] text-[var(--color-input-text)] border border-[var(--color-border)] font-sans focus:outline-none focus:border-[var(--color-accent-cobalt)] focus:ring-2 focus:ring-[var(--glow-cobalt)] transition-colors";

  if (successTx) {
    const s = successTx;
    return (
      <div className="p-4 space-y-4 max-w-xl mx-auto w-full">
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
              <span className="text-[12px] font-mono text-[var(--color-foreground)]">{s.kgs} kg</span>
            </div>
            <div className="flex justify-between items-center mb-2">
              <span className="text-[10px] font-mono text-[var(--color-muted)]">Free Allowance</span>
              <span className="text-[12px] font-mono text-[var(--color-success)]">– {vjFreeAllowance} kg</span>
            </div>
            <div className="flex justify-between items-center pb-2 border-b border-[var(--color-border)]">
              <span className="text-[10px] font-mono text-[var(--color-accent-cobalt)]">Excess Baggage</span>
              <span className="text-[12px] font-bold font-mono text-[var(--color-accent-cobalt)]">{s.exc} kg</span>
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

          <button
            onClick={handleReset}
            className="w-full py-3 mb-2 bg-[var(--color-surface-1)] text-[var(--color-foreground)] text-[11px] font-mono rounded cursor-pointer flex justify-center items-center gap-2 border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
          >
            <Plus size={14} /> NEXT PASSENGER
          </button>

          <div className="grid grid-cols-2 gap-2 mb-2">
            <button
              onClick={() => {
                import('../../lib/escpos').then(async ({ printViaBluetooth }) => {
                  await printViaBluetooth(async () => {
                    const m = await import('../../lib/escposVJPrinting');
                    // Build the VJReceiptPrintData object
                    const printData = {
                      entryRef: s.tx.id,
                      date: new Date().toLocaleDateString('en-GB'),
                      originState: user.hub || 'Lagos',
                      agentName: user.name || 'VJ Agent',
                      passengerName: s.tx.name,
                      flight: flightCode,
                      destination: dest || 'Unknown',
                      totalPieces: s.pcs,
                      totalWeightKg: s.kgs,
                      freeAllowanceKg: vjFreeAllowance,
                      excessChargeKg: s.exc,
                      ratePerKg: vjRatePerKg,
                      amount: s.tx.amount,
                      paymentMode: s.tx.mode,
                      trackingUrl: `https://app.ehimultisystems.com/track/${s.tx.id}`,
                      paymentNarration: s.tx.paymentNarration,
                      bankName: s.tx.bank,
                    };
                    return await m.compileVJReceiptStream(printData, '80mm');
                  });
                }).catch((err: any) => {
                  console.error('Bluetooth print failed:', err);
                  showToast({ message: err?.message || 'Bluetooth print failed. Ensure the printer is paired and powered on.', type: 'error' });
                });
              }}
              className="py-2.5 bg-[var(--color-accent-cobalt)] text-white text-[11px] font-bold font-mono rounded cursor-pointer flex flex-col justify-center items-center leading-none hover:bg-opacity-95 border-none"
            >
              <Bluetooth size={14} className="mb-0.5" />
              <span>PRINT POS (80mm)</span>
            </button>
            <button
              onClick={() => {
                import('../../lib/escpos').then(async ({ printViaBluetooth }) => {
                  await printViaBluetooth(async () => {
                    const m = await import('../../lib/escposVJPrinting');
                    const printData = {
                      entryRef: s.tx.id,
                      date: new Date().toLocaleDateString('en-GB'),
                      originState: user.hub || 'Lagos',
                      agentName: user.name || 'VJ Agent',
                      passengerName: s.tx.name,
                      flight: flightCode,
                      destination: dest || 'Unknown',
                      totalPieces: s.pcs,
                      totalWeightKg: s.kgs,
                      freeAllowanceKg: vjFreeAllowance,
                      excessChargeKg: s.exc,
                      ratePerKg: vjRatePerKg,
                      amount: s.tx.amount,
                      paymentMode: s.tx.mode,
                      trackingUrl: `https://app.ehimultisystems.com/track/${s.tx.id}`,
                      paymentNarration: s.tx.paymentNarration,
                      bankName: s.tx.bank,
                    };
                    return await m.compileVJReceiptStream(printData, '58mm');
                  });
                }).catch((err: any) => {
                  console.error('Bluetooth print failed:', err);
                  showToast({ message: err?.message || 'Bluetooth print failed. Ensure the printer is paired and powered on.', type: 'error' });
                });
              }}
              className="py-2.5 bg-[var(--color-accent-cobalt)] bg-opacity-80 text-white text-[11px] font-bold font-mono rounded cursor-pointer flex flex-col justify-center items-center leading-none hover:bg-opacity-95 border-none"
            >
              <Bluetooth size={14} className="mb-0.5" />
              <span>PRINT POS (58mm)</span>
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
            ↓ PDF RECEIPT
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
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              import('./ValueJetLedgerPDF').then(({ downloadVJLedgerPDF }) => {
                const todayStr = new Date().toISOString().split('T')[0];
                const vjToday = transactions.filter(t => 
                  (t.type === 'baggage' || (t as any).stream === 'baggage') && 
                  t.created_at?.startsWith(todayStr)
                );
                vjToday.sort((a, b) => (a.flight || '').localeCompare(b.flight || ''));
                downloadVJLedgerPDF({
                  date: new Date().toLocaleDateString('en-GB'),
                  hubName: user.hub || 'EHI Hub',
                  transactions: vjToday,
                  filters: { flight: '', destination: '' }
                });
              });
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-[var(--color-border)] rounded-lg text-[11px] font-mono text-[var(--color-muted)] hover:text-[var(--color-accent-amber)] hover:border-[var(--color-accent-amber)] transition-colors cursor-pointer"
          >
            <Printer size={14} /> <span>Daily PDF</span>
          </button>
          {onShowHistory && (
            <button
              onClick={onShowHistory}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-[var(--color-border)] rounded-lg text-[11px] font-mono text-[var(--color-muted)] hover:text-[var(--color-accent-cobalt)] hover:border-[var(--color-accent-cobalt)] transition-colors cursor-pointer"
            >
              <ClipboardList size={14} /> <span>History</span>
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-[1fr_280px]">
        {/* Left Column */}
        <div className="space-y-4">
          <div className="space-y-1.5">
            <span className="text-[12px] font-sans font-semibold text-[var(--color-light-muted)]">Passenger Name</span>
            <input
              id="vj-name"
              name="name"
              placeholder="Enter Passenger Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={formInputClass}
            />
          </div>

          <div className="space-y-1.5">
            <span className="text-[12px] font-sans font-semibold text-[var(--color-light-muted)]">PNR / Booking Reference <span className="text-[10px] font-normal text-[var(--color-muted)]">(Optional)</span></span>
            <input
              id="vj-pnr"
              name="pnr"
              placeholder="e.g. ABC123"
              value={pnr}
              onChange={(e) => setPnr(e.target.value.toUpperCase())}
              className={`${formInputClass} uppercase tracking-widest font-mono`}
              maxLength={10}
            />
          </div>

          <div className="space-y-1.5">
            <span className="text-[12px] font-sans font-semibold text-[var(--color-light-muted)] font-bold flex items-center gap-1.5">
              <MessageSquare size={14} className="text-[var(--color-accent-cobalt)]" />
              Passenger Phone — WhatsApp Receipt (Optional)
            </span>
            <input
              id="vj-phone"
              name="phone"
              type="tel"
              placeholder="Include country code for foreign customers (e.g. +44, +1, +233)"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={formInputClass}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <span className="text-[12px] font-sans font-semibold text-[var(--color-light-muted)]">Flight Number</span>
              <div className="flex items-stretch">
                <span className="flex items-center px-3 h-12 rounded-l-[var(--radius-sm)] border border-r-0 border-[var(--color-border)] bg-[var(--color-surface-2)] text-[15px] font-bold text-[var(--color-light-muted)]">
                  VK
                </span>
                <input
                  id="vj-flight"
                  name="flight"
                  placeholder="216"
                  inputMode="numeric"
                  value={flight}
                  onChange={(e) => setFlight(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  className={`${formInputClass} rounded-l-none`}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <span className="text-[12px] font-sans font-semibold text-[var(--color-light-muted)] font-bold">Destination</span>
              <select
                value={dest}
                onChange={(e) => setDest(e.target.value)}
                className={formInputClass}
                style={{ appearance: "none" }}
              >
                {CARGO_ROUTES.map((route) => (
                  <option key={route} value={route}>
                    {route}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <span className="text-[12px] font-sans font-semibold text-[var(--color-light-muted)]">Total Pieces</span>
              <input
                id="vj-pcs"
                name="pcs"
                type="number"
                step="1"
                min="1"
                placeholder="1"
                value={pcs}
                onChange={(e) => setPcs(e.target.value)}
                className={formInputClass}
              />
            </div>
            <div className="space-y-1.5">
              <span className="text-[12px] font-sans font-semibold text-[var(--color-light-muted)]">Total Weight (KG)</span>
              <input
                id="vj-kg"
                name="kg"
                type="number"
                step="1"
                min="0"
                placeholder="0"
                value={kg}
                onChange={(e) => {
                  // Previously stripped ALL non-digit characters, including
                  // the decimal point itself -- typing a realistic scale
                  // reading like "22.6" produced the digit string "226",
                  // inflating the excess-kg billing ~10x. kgVal already
                  // does Math.round(parseFloat(kg)) below, so this only
                  // needs to let a real decimal value through (and drop any
                  // second decimal point from something like "22..6").
                  const cleanVal = e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
                  setKg(cleanVal);
                }}
                className={formInputClass}
              />
            </div>
            <div className="space-y-1.5">
              <span className="text-[12px] font-sans font-semibold text-[var(--color-light-muted)]">Excess Rate</span>
              <div
                className="h-12 px-4 flex items-center justify-between rounded-[var(--radius-sm)] bg-[var(--color-surface-3)] border border-[var(--color-border-strong)]"
              >
                <span className="text-[12px] font-bold font-mono text-[var(--color-accent-cobalt)]">
                  ₦{vjRatePerKg.toLocaleString('en-NG')}<span className="text-[10px] font-normal text-[var(--color-muted)]">/kg</span>
                </span>
              </div>
            </div>
          </div>
          
          <div className="space-y-1.5">
            <span className="text-[12px] font-sans font-semibold text-[var(--color-light-muted)]">Total Amount (₦)</span>
            <div className="relative">
              <input
                id="vj-amount"
                name="amount"
                type="number"
                min="0"
                placeholder={minAmount > 0 ? minAmount.toString() : "0"}
                value={amountOverride !== "" ? amountOverride : (minAmount > 0 ? minAmount : "")}
                onChange={(e) => setAmountOverride(e.target.value)}
                onBlur={() => {
                  if (amountOverride !== "" && parsedOverride < minAmount) {
                    setAmountOverride("");
                  }
                }}
                className={`${formInputClass} font-mono font-bold ${amountOverride !== "" && parsedOverride < minAmount ? "text-[var(--color-error)] border-[var(--color-error)]" : ""}`}
              />
              {amountOverride !== "" && parsedOverride < minAmount && (
                <span className="text-[10px] text-[var(--color-error)] absolute right-3 top-1/2 -translate-y-1/2">
                  Min: {minAmount}
                </span>
              )}
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
            {(mode === 'Transfer' || mode === 'POS') && (
              <div className="space-y-1.5 pt-1 animate-in fade-in slide-in-from-top-2 duration-200">
                <span className="text-[12px] font-sans font-semibold text-[var(--color-light-muted)]">
                  {mode === 'POS' ? 'POS Terminal / Bank' : 'Receiving Bank'}
                </span>
                <select
                  value={bank}
                  onChange={(e) => setBank(e.target.value)}
                  className={formInputClass}
                  style={{ appearance: 'none' }}
                >
                  {BANKS.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {mode === 'Transfer' && (
              <PaymentNarrationBox narrationCode={narrationCode} />
            )}
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
        <aside className="ehi-desktop-only">
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
                <div className="flex justify-between border-b border-[var(--color-border)] pb-1 mb-1"><span style={{ color: 'var(--color-muted)' }}>PNR</span><span className="font-mono text-[11px] font-bold text-[var(--color-accent-cobalt)]">{pnr || '—'}</span></div>
                <div className="flex justify-between border-b border-[var(--color-border)] pb-1 mb-1"><span style={{ color: 'var(--color-muted)' }}>Flight</span><span className="font-bold text-[var(--color-accent-cobalt)]">{flightCode || '—'}</span></div>
                <div className="flex justify-between border-b border-[var(--color-border)] pb-1 mb-1"><span style={{ color: 'var(--color-muted)' }}>Total Weight</span><span className="font-semibold text-[var(--color-foreground)]">{kgVal} kg</span></div>
                <div className="flex justify-between border-b border-[var(--color-border)] pb-1 mb-1"><span style={{ color: 'var(--color-muted)' }}>Free Limit</span><span className="font-semibold text-[var(--color-success)]">– {vjFreeAllowance} kg</span></div>
                <div className="flex justify-between"><span style={{ color: 'var(--color-muted)' }}>Excess KG</span><span className={`font-bold ${excessKg > 0 ? 'text-[var(--color-accent-cobalt)]' : 'text-[var(--color-muted)]'}`}>{excessKg} kg</span></div>
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
                  color: totalAmount > 0
                    ? 'var(--color-accent-cobalt)'
                    : 'var(--color-muted)',
                }}>
                  {totalAmount > 0
                    ? '₦' + totalAmount.toLocaleString('en-NG')
                    : '₦0'}
                </div>
                {excessKg > 0 && (
                  <div style={{
                    fontSize: 10, fontFamily: 'monospace',
                    color: 'var(--color-muted)', marginTop: 6,
                  }}>
                    {excessKg} kg × ₦{vjRatePerKg.toLocaleString('en-NG')}/kg
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
