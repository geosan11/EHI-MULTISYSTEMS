import { useState, useEffect, useRef, useMemo } from 'react';
import { useEnterToNextField } from '../../lib/useEnterToNextField';
import { PaymentMode, Transaction, User, ExcessBaggageAirline } from '../../lib/types';
import { fmt, roundMoney, tnow, getHubCode, upperOnChange } from '../../lib/helpers';
import { chargeWalletForSale } from '../../lib/walletPayment';
import { matchWallet } from '../../lib/customerIdentity';
import { WalletRemainderSelector } from '../WalletRemainderSelector';
import { getNextTag } from '../../lib/tagPool';
import { CheckCircle, Loader2, ClipboardList, MessageSquare, Plus, Printer, Bluetooth } from 'lucide-react';
import { QRCode } from '../QRCode';
import { sendReceiptWhatsApp, buildExcessBaggageWhatsApp } from '../../lib/notifications';
import { PaymentNarrationBox } from '../PaymentNarrationBox';
import { useBanks } from '../../lib/banks';
import { useToast } from '../../lib/ToastContext';
import { useHubRoutes, useValidatedRouteSelection } from '../../lib/hubRoutes';

import { supabase } from '../../lib/supabase';
import { CustomerWalletPicker } from '../CustomerWalletPicker';
import { CustomerWallet } from '../../lib/types';
import { ReviewEntryModal } from './ReviewEntryModal';

export const ExcessBaggageForm = ({
  airline,
  onAddTx,
  user,
  onShowHistory,
  transactions = [],
  customerWallets = [],
  setCustomerWallets,
}: {
  airline: ExcessBaggageAirline;
  onAddTx: (tx: Transaction) => void;
  user: User;
  onShowHistory?: () => void;
  transactions?: Transaction[];
  customerWallets?: CustomerWallet[];
  setCustomerWallets?: React.Dispatch<React.SetStateAction<CustomerWallet[]>>;
}) => {
  const [name, setName] = useState('');
  const [pnr, setPnr]   = useState('');
  // The airline's flight prefix (e.g. "VK") is fixed per airline -- staff
  // only ever key in the flight number itself, so store just the digits
  // and compose the real flight code from that everywhere it's needed.
  const [flight, setFlight] = useState('');
  const flightCode = flight ? `${airline.flight_prefix}${flight}` : '';
  const routes = useHubRoutes();
  const [dest, setDest] = useState(routes[0]);
  useValidatedRouteSelection(routes, dest, setDest);
  const [kg, setKg] = useState('');
  const [pcs, setPcs] = useState('');
  const [phone, setPhone] = useState('');
  const [mode, setMode] = useState<PaymentMode>('POS');

  const [selectedWalletOverride, setSelectedWalletOverride] = useState<CustomerWallet | null>(null);
  const [walletRemainderMode, setWalletRemainderMode] = useState<'Cash' | 'Transfer' | 'POS'>('Cash');
  const [walletRemainderBank, setWalletRemainderBank] = useState('');
  const activeWallet = useMemo(() => {
    if (selectedWalletOverride) return selectedWalletOverride;
    return matchWallet(customerWallets, name, phone);
  }, [name, phone, customerWallets, selectedWalletOverride]);
  const banks = useBanks();
  const [bank, setBank] = useState(banks[0] || 'Sterling Bank');
  const [amountOverride, setAmountOverride] = useState<string>('');
  const [narrationCode, setNarrationCode] = useState<string>('');

  const [successTx, setSuccessTx] = useState<{ tx: Transaction, kgs: number, exc: number, pcs: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showBaggageReview, setShowBaggageReview] = useState(false);

  // Pre-fetched once (like CargoForm/PackageForm/MarketingWorkspace's own
  // tag/id pre-fetch), not popped live inside handleSubmit -- popping live
  // on every call meant a double-fire (e.g. a chattery mouse double-clicking
  // ReviewEntryModal's Confirm button before React re-rendered the disabled
  // state) consumed TWO real tag numbers and could produce two distinct
  // manifests rows instead of one.
  const [pendingTag, setPendingTag] = useState('');
  const fetchPendingTag = async () => {
    const hubCode = getHubCode(user.hub_code || user.hub);
    const tag = await getNextTag(`${hubCode}-${airline.tag_code}`, `EHI-${hubCode}-${airline.tag_code}`);
    setPendingTag(tag || '');
  };
  useEffect(() => { fetchPendingTag(); }, [airline.tag_code, user.hub_code, user.hub]);

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
        // use a random serial since excess-baggage tickets aren't tracked by serial the same way cargo is
        setNarrationCode(generatePaymentNarration(user.hub_code || user.hub, Math.floor(Math.random() * 9000) + 1000));
      });
    }
  }, [mode, narrationCode, user.hub]);

  // Free allowance / rate come straight from the airline config passed down
  // by EHIApp (itself fetched from excess_baggage_airlines and cached for
  // offline use) -- no per-airline fetch needed here.
  const freeAllowance = airline.free_allowance_kg;
  const ratePerKg = airline.rate_per_kg;

  const kgVal = Math.round(parseFloat(kg)) || 0;
  const pcsVal = Math.max(1, parseInt(pcs) || 1);
  const excessKg = Math.max(0, kgVal - freeAllowance);
  const minAmount = roundMoney(excessKg * ratePerKg);
  const parsedOverride = parseFloat(amountOverride) || 0;
  const totalAmount = amountOverride !== "" ? parsedOverride : minAmount;

  const isValid = name.trim().length > 0 && flight.trim().length > 0 && kgVal > 0 && (amountOverride === "" || parsedOverride >= minAmount);

  const { showToast } = useToast();

  const handleSubmit = async () => {
    if (!isValid || submitting) return;

    setSubmitting(true);

    const resolvedTag = pendingTag;
    if (!resolvedTag) {
      showToast({ message: 'No tag number available offline. Connect to the internet briefly to reserve more, then try again.', type: 'error' });
      setSubmitting(false);
      return;
    }

    const tx: Transaction = {
      id: resolvedTag,
      name: name.trim(),
      detail: `${flightCode} · ${dest} · ${pcsVal}pcs · +${excessKg}kg excess`,
      amount: totalAmount,
      mode,
      bank: mode === 'Transfer' || mode === 'POS' ? bank : undefined,
      paymentNarration: mode === 'Transfer' ? narrationCode : undefined,
      airline: airline.name,
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
      enteredByName: user.name,
      // TODO: capture client_type at entry
    } as any;
    // Attach phone for EHIApp to write to passenger_phone column
    (tx as any).phone = phone.trim() || undefined;

    // Wallet payment — AUTO-SPLIT. Wallet covers what it can; any remainder is
    // collected by the chosen Cash/Transfer/POS method and recorded as the
    // receipt_mode, so the till isn't silently short. EOD nets
    // wallet_deduction_amount out of the cash/transfer/POS totals.
    if (mode === "Wallet" && activeWallet) {
      const charge = await chargeWalletForSale({
        wallet: activeWallet,
        amount: totalAmount,
        cargoRef: resolvedTag,
        description: `Excess Baggage ${resolvedTag}`,
        loggedBy: user.name,
      });
      if (!charge.ok) {
        showToast({ message: `Wallet deduction failed: ${charge.error}. Entry was not logged.`, type: 'error' });
        setSubmitting(false);
        return;
      }
      // Guard: a short wallet needs a remainder method (Cash needs nothing;
      // Transfer/POS need a bank/terminal reference).
      if (charge.remainder > 0 && (walletRemainderMode === 'Transfer' || walletRemainderMode === 'POS') && !walletRemainderBank.trim()) {
        showToast({ message: `Enter the bank/terminal for the ₦${fmt(charge.remainder)} remainder.`, type: 'warning' });
        setSubmitting(false);
        return;
      }
      tx.wallet_id = activeWallet.id;
      tx.wallet_deduction_amount = charge.walletDeduction;
      (tx as any).wallet_balance_before = activeWallet.balance;
      (tx as any).wallet_balance_after = charge.newBalance;
      if (charge.remainder > 0) {
        tx.mode = walletRemainderMode;
        tx.bank = (walletRemainderMode === 'Transfer' || walletRemainderMode === 'POS') ? walletRemainderBank.trim() : undefined;
      }

      if (setCustomerWallets) {
        setCustomerWallets(prev => prev.map(w => w.id === activeWallet.id ? { ...w, balance: charge.newBalance! } : w));
      }
      showToast({
        message: charge.remainder > 0
          ? `₦${fmt(charge.walletDeduction)} from ${activeWallet.customer_name}'s wallet · ₦${fmt(charge.remainder)} by ${walletRemainderMode}. Balance: ₦${fmt(charge.newBalance!)}`
          : `💰 ₦${fmt(charge.walletDeduction)} deducted from ${activeWallet.customer_name}'s Credit Wallet. Remaining Balance: ₦${fmt(charge.newBalance!)}`,
        type: 'success'
      });
    }

    setSuccessTx({ tx, kgs: kgVal, exc: excessKg, pcs: pcsVal });
    setSubmitting(false);

    onAddTx(tx);

    if (phone.trim().length > 0) {
      sendReceiptWhatsApp({
        phone: phone.trim(),
        ref: tx.id,
        message: buildExcessBaggageWhatsApp(airline.name, {
          ref: tx.id,
          passenger: name.trim(),
          flight: flightCode,
          totalPieces: pcsVal,
          totalKg: kgVal,
          excessKg,
          amount: totalAmount,
          mode,
        }, freeAllowance, ratePerKg),
      });
    }
  };

  const handleReset = () => {
    setName('');
    setPnr('');
    setFlight('');
    setDest(routes[0]);
    setKg('');
    setPcs('');
    setAmountOverride('');
    setPhone('');
    setSuccessTx(null);
    fetchPendingTag();
  };

  const handleDownloadReceipt = async () => {
    if (successTx) {
      const { downloadBaggageReceipt } = await import('./ExcessBaggageReceipt');
      const data = {
        airlineName: airline.name,
        entryRef: successTx.tx.id,
        date: `${new Date().toLocaleDateString('en-GB')} ${tnow()}`,
        hubName: `${airline.name} Counter`,
        agentName: user.name || 'Agent',
        passengerName: successTx.tx.name,
        flightNumber: flightCode,
        destination: dest || 'Unknown',
        totalPieces: successTx.pcs,
        totalBaggage: successTx.kgs,
        freeAllowance,
        excessKg: successTx.exc,
        ratePerKg,
        amount: successTx.tx.amount,
        paymentMode: successTx.tx.mode,
        paymentNarration: successTx.tx.paymentNarration,
        bankName: successTx.tx.bank,
      };
      downloadBaggageReceipt(data);
    }
  };

  const handlePrintReceipt = async () => {
    if (!successTx) return;
    const { printBaggageReceipt } = await import('./ExcessBaggageReceipt');
    await printBaggageReceipt({
      airlineName: airline.name,
      entryRef: successTx.tx.id,
      date: `${new Date().toLocaleDateString('en-GB')} ${tnow()}`,
      hubName: `${airline.name} Counter`,
      agentName: user.name || 'Agent',
      passengerName: successTx.tx.name,
      flightNumber: flightCode,
      destination: dest || 'Unknown',
      totalPieces: successTx.pcs,
      totalBaggage: successTx.kgs,
      freeAllowance,
      excessKg: successTx.exc,
      ratePerKg,
      amount: successTx.tx.amount,
      paymentMode: successTx.tx.mode,
      paymentNarration: successTx.tx.paymentNarration,
      bankName: successTx.tx.bank,
    });
  };

  const formInputClass = "w-full h-12 px-4 text-[16px] rounded-[var(--radius-sm)] bg-[var(--color-input-bg)] text-[var(--color-input-text)] border border-[var(--color-border)] font-sans focus:outline-none focus:border-[var(--color-accent-cobalt)] focus:ring-2 focus:ring-[var(--glow-cobalt)] transition-colors";

  const formRootRef = useRef<HTMLDivElement>(null);
  useEnterToNextField(formRootRef);

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
              <span className="text-[12px] font-mono text-[var(--color-success)]">– {freeAllowance} kg</span>
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
                    const m = await import('../../lib/escposBaggagePrinting');
                    const printData = {
                      airlineName: airline.name,
                      entryRef: s.tx.id,
                      date: `${new Date().toLocaleDateString('en-GB')} ${tnow()}`,
                      originState: user.hub || 'Lagos',
                      agentName: user.name || 'Agent',
                      passengerName: s.tx.name,
                      flight: flightCode,
                      destination: dest || 'Unknown',
                      totalPieces: s.pcs,
                      totalWeightKg: s.kgs,
                      freeAllowanceKg: freeAllowance,
                      excessChargeKg: s.exc,
                      ratePerKg,
                      amount: s.tx.amount,
                      paymentMode: s.tx.mode,
                      trackingUrl: `https://app.ehimultisystems.com/track/${s.tx.id}`,
                      paymentNarration: s.tx.paymentNarration,
                      bankName: s.tx.bank,
                    };
                    return await m.compileBaggageReceiptStream(printData, '80mm');
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
                    const m = await import('../../lib/escposBaggagePrinting');
                    const printData = {
                      airlineName: airline.name,
                      entryRef: s.tx.id,
                      date: `${new Date().toLocaleDateString('en-GB')} ${tnow()}`,
                      originState: user.hub || 'Lagos',
                      agentName: user.name || 'Agent',
                      passengerName: s.tx.name,
                      flight: flightCode,
                      destination: dest || 'Unknown',
                      totalPieces: s.pcs,
                      totalWeightKg: s.kgs,
                      freeAllowanceKg: freeAllowance,
                      excessChargeKg: s.exc,
                      ratePerKg,
                      amount: s.tx.amount,
                      paymentMode: s.tx.mode,
                      trackingUrl: `https://app.ehimultisystems.com/track/${s.tx.id}`,
                      paymentNarration: s.tx.paymentNarration,
                      bankName: s.tx.bank,
                    };
                    return await m.compileBaggageReceiptStream(printData, '58mm');
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
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8, width: '100%' }}>
            <button
              onClick={handlePrintReceipt}
              style={{
                padding: '11px',
                background: 'transparent',
                border: '1px solid rgba(59,130,246,0.3)',
                borderRadius: 8, cursor: 'pointer',
                fontSize: 11, fontFamily: 'monospace',
                fontWeight: 700, color: 'var(--color-accent-cobalt)',
                display: 'flex', alignItems: 'center',
                justifyContent: 'center', gap: 6,
              }}
            >
              PRINT PDF
            </button>
            <button
              onClick={handleDownloadReceipt}
              style={{
                padding: '11px',
                background: 'transparent',
                border: '1px solid rgba(59,130,246,0.3)',
                borderRadius: 8, cursor: 'pointer',
                fontSize: 11, fontFamily: 'monospace',
                fontWeight: 700, color: 'var(--color-accent-cobalt)',
                display: 'flex', alignItems: 'center',
                justifyContent: 'center', gap: 6,
              }}
            >
              ↓ DOWNLOAD PDF
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={formRootRef} className="p-4 pb-24 h-full" style={{ width: '100%', boxSizing: 'border-box' }}>
      <div className="border-b border-[var(--color-border)] pb-2 mb-4 flex items-center justify-between">
        <span style={{ fontFamily: 'JetBrains Mono', fontSize: 11, fontWeight: 700, color: 'var(--color-accent-cobalt)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
          ▸ {airline.name.toUpperCase()} EXCESS BAGGAGE TICKETING
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              import('./ExcessBaggageLedgerPDF').then(({ downloadBaggageLedgerPDF }) => {
                const todayStr = new Date().toISOString().split('T')[0];
                const baggageToday = transactions.filter(t =>
                  (t.type === 'baggage' || (t as any).stream === 'baggage') &&
                  (t.airline || 'ValueJet') === airline.name &&
                  t.created_at?.startsWith(todayStr)
                );
                baggageToday.sort((a, b) => (a.flight || '').localeCompare(b.flight || ''));
                downloadBaggageLedgerPDF({
                  airlineName: airline.name,
                  date: `${new Date().toLocaleDateString('en-GB')} ${tnow()}`,
                  hubName: user.hub || 'EHI Hub',
                  transactions: baggageToday,
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
              id="baggage-name"
              name="name"
              placeholder="Enter Passenger Name"
              value={name}
              onChange={upperOnChange(setName)}
              className={formInputClass}
            />
          </div>

          <div className="space-y-1.5">
            <span className="text-[12px] font-sans font-semibold text-[var(--color-light-muted)]">PNR / Booking Reference <span className="text-[10px] font-normal text-[var(--color-muted)]">(Optional)</span></span>
            <input
              id="baggage-pnr"
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
              id="baggage-phone"
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
                  {airline.flight_prefix}
                </span>
                <input
                  id="baggage-flight"
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
                {routes.map((route) => (
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
                id="baggage-pcs"
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
                id="baggage-kg"
                name="kg"
                type="number"
                step="1"
                min="0"
                placeholder="0"
                value={kg}
                onChange={(e) => {
                  // Only strip characters that aren't digits or the decimal
                  // point itself (and drop a second decimal point) -- kgVal
                  // already does Math.round(parseFloat(kg)) below.
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
                  ₦{ratePerKg.toLocaleString('en-NG')}<span className="text-[10px] font-normal text-[var(--color-muted)]">/kg</span>
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <span className="text-[12px] font-sans font-semibold text-[var(--color-light-muted)]">Total Amount (₦)</span>
            <div className="relative">
              <input
                id="baggage-amount"
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
            {ratePerKg === 0 && excessKg > 0 && (
              <div className="text-[10px] text-[var(--color-accent-amber)] mt-1">
                No rate configured for {airline.name} — this excess weight is auto-calculating as free. Set a rate per kg in Excess Baggage Airlines, or enter amount manually.
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <span className="text-[12px] font-sans font-semibold text-[var(--color-light-muted)]">Payment Mode</span>
            <div className="flex bg-[var(--color-surface-3)] rounded-[var(--radius-sm)] p-1 border border-[var(--color-border)]">
              {['Cash', 'POS', 'Transfer', 'Wallet'].map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m as PaymentMode)}
                  style={{
                    background: mode === m ? 'var(--color-surface-1)' : 'transparent',
                    color: mode === m ? 'var(--color-accent-cobalt)' : 'var(--color-muted)',
                    border: 'none',
                  }}
                  className={`flex-1 py-2 text-[13px] font-sans font-semibold rounded-[var(--radius-xs)] shadow-sm transition-all focus:outline-none cursor-pointer flex items-center justify-center gap-1`}
                >
                  {m === 'Wallet' ? '💰 Wallet' : m}
                </button>
              ))}
            </div>
            {mode === "Wallet" && (
              <div className="mt-2 space-y-2">
                <CustomerWalletPicker
                  wallets={customerWallets}
                  selectedWallet={activeWallet}
                  onSelectWallet={(w) => setSelectedWalletOverride(w)}
                  currentCustomerName={name}
                />
                {activeWallet && activeWallet.balance < totalAmount && (
                  <WalletRemainderSelector
                    walletName={activeWallet.customer_name}
                    coverage={activeWallet.balance}
                    remainder={totalAmount - activeWallet.balance}
                    mode={walletRemainderMode}
                    bank={walletRemainderBank}
                    onModeChange={setWalletRemainderMode}
                    onBankChange={setWalletRemainderBank}
                  />
                )}
              </div>
            )}
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
                  {banks.map((b) => (
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
              onClick={() => setShowBaggageReview(true)}
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
            {showBaggageReview && (
              <ReviewEntryModal
                title="Review Excess Baggage Entry"
                details={[
                  { label: 'Customer', value: name },
                  { label: 'Flight', value: flightCode },
                  { label: 'Destination', value: dest },
                  { label: 'Weight', value: `${kgVal} KG` },
                  { label: 'Amount', value: totalAmount },
                  { label: 'Payment Mode', value: mode },
                ]}
                onConfirm={() => { setShowBaggageReview(false); handleSubmit(); }}
                onCancel={() => setShowBaggageReview(false)}
                confirmText="Commit Transaction"
                isSubmitting={submitting}
              />
            )}
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
                <div className="flex justify-between border-b border-[var(--color-border)] pb-1 mb-1"><span style={{ color: 'var(--color-muted)' }}>Free Limit</span><span className="font-semibold text-[var(--color-success)]">– {freeAllowance} kg</span></div>
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
                  {fmt(totalAmount)}
                </div>
                {excessKg > 0 && (
                  <div style={{
                    fontSize: 10, fontFamily: 'monospace',
                    color: 'var(--color-muted)', marginTop: 6,
                  }}>
                    {excessKg} kg × ₦{ratePerKg.toLocaleString('en-NG')}/kg
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
