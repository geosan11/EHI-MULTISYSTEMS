import { useState, useEffect } from 'react';
import { Transaction, User } from '../../lib/types';
import { CORPORATE_CLIENTS, CONTENT_TYPES, BANKS, CARGO_ROUTES } from '../../lib/constants';
import { fmt, uid, tnow } from '../../lib/helpers';
import {
  CheckCircle, Loader2, User as UserIcon, Plane, Hash, Package, MapPin, Layers,
  Banknote, CreditCard, Landmark, MessageSquare, Scale, Users, ShieldAlert,
  PlusCircle, Trash2, Edit3, Coins, Search, ArrowRight, Table, DollarSign
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { sendReceiptWhatsApp, buildCargoWhatsApp } from '../../lib/notifications';

interface CorporateClient {
  id: string;
  company_name: string;
  contact_phone: string;
  accumulated_monthly_debt: number;
}

interface CorporateRouteRate {
  id: string;
  corporate_client_id: string;
  route_name: string;
  rate_per_kg: number;
}

interface PendingWeighingIntake {
  id: string;
  consignee: string;
  pieces: number;
  route: string;
  contentType: string;
  airline: string;
  awb: string;
  created_at: string;
  sender_phone?: string;
  time: string;
}

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

import { QRCode } from '../QRCode';
import { PaymentNarrationBox } from '../PaymentNarrationBox';

export const CargoForm = ({ onAddTx, user }: {
  onAddTx: (tx: Transaction) => void;
  user: User;
}) => {
  // Navigation tabs between Regular & Corporate Billing
  const [activePortal, setActivePortal] = useState<'retail' | 'corporate'>('retail');
  const [corpSubTab, setCorpSubTab] = useState<'intake' | 'weighing' | 'directory'>('intake');

  // --- STANDARD RETAIL STATES ---
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
  
  const [narrationCode, setNarrationCode] = useState<string>('');

  useEffect(() => {
    if (mode === 'Transfer' && !narrationCode) {
      import('../../lib/helpers').then(({ generatePaymentNarration }) => {
        setNarrationCode(generatePaymentNarration(user.hub, serialNumber));
      });
    }
  }, [mode, narrationCode, user.hub, serialNumber]);
  
  const [standardRates, setStandardRates] = useState<Record<string, number>>({});

  useEffect(() => {
    const saved = localStorage.getItem('ehi_standard_cargo_rates');
    if (saved) {
      setStandardRates(JSON.parse(saved));
    } else {
      const initial: Record<string, number> = {};
      CARGO_ROUTES.forEach(r => initial[r] = 500);
      setStandardRates(initial);
      localStorage.setItem('ehi_standard_cargo_rates', JSON.stringify(initial));
    }
  }, []);

  // Auto calculate amount for retail
  useEffect(() => {
    const w = parseFloat(kg) || 0;
    const rate = standardRates[route] || 500;
    if (w > 0) {
      setAmount((w * rate).toString());
    } else {
      setAmount('');
    }
  }, [kg, route, standardRates]);

  const [availableAirlines, setAvailableAirlines] = useState<string[]>(['Arik Air', 'Green Africa', 'United Nigeria', 'Other']);

  useEffect(() => {
    const rawCommissions = localStorage.getItem('ehi_airline_commissions');
    if (rawCommissions) {
      try {
        const parsed = JSON.parse(rawCommissions);
        const keys = Object.keys(parsed);
        if (keys.length > 0) {
          setAvailableAirlines(keys);
          if (!keys.includes(airline)) {
            setAirline(keys[0]);
          }
        }
      } catch (e) {
        // ignore
      }
    }
  }, []);

  const [successTx, setSuccessTx] = useState<Transaction | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // --- B2B CORPORATE PERSISTED STATES ---
  const [corpClients, setCorpClients] = useState<CorporateClient[]>(() => {
    const saved = localStorage.getItem('ehi_corporate_clients_v2');
    if (saved) return JSON.parse(saved);
    const initial = [
      { id: 'corp_1', company_name: 'Aramex', contact_phone: '08011223344', accumulated_monthly_debt: 154300 },
      { id: 'corp_2', company_name: 'SAHCO', contact_phone: '08022334455', accumulated_monthly_debt: 84000 },
      { id: 'corp_3', company_name: 'GlobaCom', contact_phone: '09033445566', accumulated_monthly_debt: 220000 },
      { id: 'corp_4', company_name: 'ZeemMax', contact_phone: '08044556677', accumulated_monthly_debt: 0 },
      { id: 'corp_5', company_name: 'EHI', contact_phone: '08055667788', accumulated_monthly_debt: 0 },
      { id: 'corp_6', company_name: 'Salco', contact_phone: '08066778899', accumulated_monthly_debt: 0 },
      { id: 'corp_7', company_name: 'Slot', contact_phone: '08077889900', accumulated_monthly_debt: 0 }
    ];
    localStorage.setItem('ehi_corporate_clients_v2', JSON.stringify(initial));
    return initial;
  });

  const [corpRates, setCorpRates] = useState<CorporateRouteRate[]>(() => {
    const saved = localStorage.getItem('ehi_corporate_route_rates_v2');
    if (saved) return JSON.parse(saved);
    const initial = [
      { id: 'rate_1', corporate_client_id: 'corp_1', route_name: 'ABV/Abuja', rate_per_kg: 600 },
      { id: 'rate_2', corporate_client_id: 'corp_1', route_name: 'BNI/Benin', rate_per_kg: 400 },
      { id: 'rate_3', corporate_client_id: 'corp_1', route_name: 'Lagos', rate_per_kg: 350 },
      { id: 'rate_4', corporate_client_id: 'corp_2', route_name: 'ABV/Abuja', rate_per_kg: 500 },
      { id: 'rate_5', corporate_client_id: 'corp_2', route_name: 'BNI/Benin', rate_per_kg: 420 },
      { id: 'rate_6', corporate_client_id: 'corp_3', route_name: 'ABV/Abuja', rate_per_kg: 650 },
      { id: 'rate_7', corporate_client_id: 'corp_3', route_name: 'PHC/Port Harcourt', rate_per_kg: 750 }
    ];
    localStorage.setItem('ehi_corporate_route_rates_v2', JSON.stringify(initial));
    return initial;
  });

  const [pendingIntakes, setPendingIntakes] = useState<PendingWeighingIntake[]>(() => {
    const saved = localStorage.getItem('ehi_pending_intakes_v2');
    if (saved) return JSON.parse(saved);
    const initial = [
      {
        id: 'CG-INT-309',
        consignee: 'Aramex',
        pieces: 4,
        route: 'ABV/Abuja',
        contentType: 'Documents',
        airline: 'Arik Air',
        awb: 'AWB-ARAM-92',
        created_at: new Date().toISOString(),
        sender_phone: '08011223344',
        time: '10:15'
      },
      {
        id: 'CG-INT-315',
        consignee: 'SAHCO',
        pieces: 8,
        route: 'BNI/Benin',
        contentType: 'Medical',
        airline: 'United Nigeria',
        awb: 'AWB-SAHC-15',
        created_at: new Date().toISOString(),
        sender_phone: '08022334455',
        time: '12:40'
      }
    ];
    localStorage.setItem('ehi_pending_intakes_v2', JSON.stringify(initial));
    return initial;
  });

  // --- PHASE 1 STATE FIELDS ---
  const [intakeConsignee, setIntakeConsignee] = useState(corpClients[0]?.company_name || 'Aramex');
  const [intakeAirline, setIntakeAirline] = useState('Arik Air');
  
  useEffect(() => {
    if (availableAirlines.length > 0) {
      if (!availableAirlines.includes(intakeAirline)) {
        setIntakeAirline(availableAirlines[0]);
      }
    }
  }, [availableAirlines]);

  const [intakeAwb, setIntakeAwb] = useState('');
  const [intakePcs, setIntakePcs] = useState('1');
  const [intakeRoute, setIntakeRoute] = useState(CARGO_ROUTES[0]);
  const [intakeContentType, setIntakeContentType] = useState<string>(CONTENT_TYPES[0]);
  const [intakeSenderPhone, setIntakeSenderPhone] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // --- PHASE 2 STATE FIELDS ---
  const [selectedIntake, setSelectedIntake] = useState<PendingWeighingIntake | null>(null);
  const [gateWeight, setGateWeight] = useState('');
  const [customRateOverwrite, setCustomRateOverwrite] = useState('');
  const [isWeighingSubmitting, setIsWeighingSubmitting] = useState(false);

  // --- RATE MANAGEMENT STATES ---
  const [newClientName, setNewClientName] = useState('');
  const [newClientPhone, setNewClientPhone] = useState('');
  const [selectedRateClient, setSelectedRateClient] = useState<CorporateClient | null>(null);
  const [rateRoute, setRateRoute] = useState(CARGO_ROUTES[0]);
  const [ratePrice, setRatePrice] = useState('');

  // --- SYSTEM HELPERS ---
  const isAuthorizedRole = user && ['super_admin', 'admin', 'accountant', 'auditor'].includes(user.role);

  const updateLocalCorpClients = (updated: CorporateClient[]) => {
    setCorpClients(updated);
    localStorage.setItem('ehi_corporate_clients_v2', JSON.stringify(updated));
  };

  const updateLocalCorpRates = (updated: CorporateRouteRate[]) => {
    setCorpRates(updated);
    localStorage.setItem('ehi_corporate_route_rates_v2', JSON.stringify(updated));
  };

  const updateLocalPendingIntakes = (updated: PendingWeighingIntake[]) => {
    setPendingIntakes(updated);
    localStorage.setItem('ehi_pending_intakes_v2', JSON.stringify(updated));
  };

  // --- ACTION: LOG FIELD INTAKE (Phase 1) ---
  const handleLogFieldIntake = () => {
    if (!intakeAwb.trim()) {
      alert("Please provide the Air Waybill / Tag Number.");
      return;
    }

    const newIntake: PendingWeighingIntake = {
      id: `CG-INT-${Math.floor(100 + Math.random() * 900)}`,
      consignee: intakeConsignee,
      pieces: parseInt(intakePcs) || 1,
      route: intakeRoute,
      contentType: intakeContentType,
      airline: intakeAirline,
      awb: intakeAwb.toUpperCase().trim(),
      created_at: new Date().toISOString(),
      sender_phone: intakeSenderPhone.trim() || undefined,
      time: tnow()
    };

    const updated = [newIntake, ...pendingIntakes];
    updateLocalPendingIntakes(updated);

    // Clear and Toast
    setIntakeAwb('');
    setIntakePcs('1');
    setIntakeSenderPhone('');
    setSuccessMessage(`Phase 1 Pick-up saved for ${newIntake.consignee}. Cargo registered at Gate.`);
    setTimeout(() => setSuccessMessage(''), 4000);
  };

  // --- ACTION: FINALIZE SCALE WEIGHING (Phase 2) ---
  const handleFinalizeWeighing = () => {
    if (!selectedIntake || !gateWeight) return;
    setIsWeighingSubmitting(true);

    const weightNum = parseFloat(gateWeight) || 0;
    if (weightNum <= 0) {
      alert("Please enter a valid verified weight in KG.");
      setIsWeighingSubmitting(false);
      return;
    }

    // Dynamic Look-up Contract Rates or Fallback baseline (₦500/KG)
    const matchingClientObj = corpClients.find(c => c.company_name === selectedIntake.consignee);
    const contractRateRecord = matchingClientObj
      ? corpRates.find(r => r.corporate_client_id === matchingClientObj.id && r.route_name === selectedIntake.route)
      : undefined;

    const rateToUse = customRateOverwrite 
      ? parseFloat(customRateOverwrite) 
      : contractRateRecord 
        ? contractRateRecord.rate_per_kg 
        : 500;

    const computedCost = weightNum * rateToUse;

    // Build central ledger transaction record (Debt contract)
    const finalTxDetail = `${selectedIntake.airline} · ${selectedIntake.awb} · ${selectedIntake.pieces}pcs · ${weightNum}KG · ${selectedIntake.route} · ${selectedIntake.contentType}`;
    
    const txEntry: Transaction = {
      id: uid('CG'),
      name: selectedIntake.consignee,
      detail: finalTxDetail,
      amount: computedCost,
      mode: 'Debt',
      remarks: `Gate Weight Finalized (${rateToUse} ₦/KG Contract). Ref Intake ID: ${selectedIntake.id}`,
      time: tnow(),
      type: 'cargo',
      status: 'Intake',
      awb_tag_number: selectedIntake.awb,
      airline: selectedIntake.airline,
      pieces: selectedIntake.pieces,
      kg: weightNum
    };

    // 1. Add to central transactions grid
    onAddTx(txEntry);

    // 2. Increment client's monthly accumulated debt balance (Supabase automation proxy)
    if (matchingClientObj) {
      const updatedClients = corpClients.map(c => {
        if (c.id === matchingClientObj.id) {
          return {
            ...c,
            accumulated_monthly_debt: c.accumulated_monthly_debt + computedCost
          };
        }
        return c;
      });
      updateLocalCorpClients(updatedClients);
    }

    // 3. Remove from pending intakes queue
    const filteredPending = pendingIntakes.filter(pi => pi.id !== selectedIntake.id);
    updateLocalPendingIntakes(filteredPending);

    // 4. Trigger printer receipt model & clear states
    setSuccessTx(txEntry);
    setSelectedIntake(null);
    setGateWeight('');
    setCustomRateOverwrite('');
    setIsWeighingSubmitting(false);
  };

  // --- ACTION: ADD NEW CORPORATE B2B ACCOUNT ---
  const handleCreateCorpAccount = () => {
    if (!newClientName.trim()) return;
    const newClient: CorporateClient = {
      id: 'corp_' + Math.random().toString(36).substr(2, 9),
      company_name: newClientName.trim(),
      contact_phone: newClientPhone.trim() || 'N/A',
      accumulated_monthly_debt: 0
    };
    updateLocalCorpClients([...corpClients, newClient]);
    setNewClientName('');
    setNewClientPhone('');
  };

  // --- ACTION: SET CUSTOM ROUTE RATE ---
  const handleSaveRouteRate = () => {
    if (!selectedRateClient || !ratePrice) return;
    const priceNum = parseFloat(ratePrice) || 0;
    if (priceNum <= 0) return;

    // Check if route rate already exists
    const existingIndex = corpRates.findIndex(
      r => r.corporate_client_id === selectedRateClient.id && r.route_name === rateRoute
    );

    let updatedRates = [...corpRates];
    if (existingIndex > -1) {
      updatedRates[existingIndex].rate_per_kg = priceNum;
    } else {
      updatedRates.push({
        id: 'rate_' + Math.random().toString(36).substr(2, 9),
        corporate_client_id: selectedRateClient.id,
        route_name: rateRoute,
        rate_per_kg: priceNum
      });
    }

    updateLocalCorpRates(updatedRates);
    setRatePrice('');
    alert(`Custom negotiated contract rate updated: ${selectedRateClient.company_name} Route ${rateRoute} set to ₦${priceNum}/KG`);
  };

  // --- RETAIL BILLING SUBMIT ---
  const actualConsignee = consignee === 'Other' ? customConsignee : consignee;
  const parsedAmount = parseFloat(amount) || 0;
  
  const isRetailFormValid = actualConsignee.trim().length > 0 &&
                            awb.trim().length > 0 &&
                            route.trim().length > 0 &&
                            contentType.trim().length > 0 &&
                            parsedAmount > 0;

  const handleRetailSubmit = () => {
    if (!isRetailFormValid || submitting) return;
    setSubmitting(true);

    const summaryStr = `${airline} · ${awb} · ${pcs}pcs · ${kg}KG · ${route} · ${contentType}`;

    const tx: Transaction = {
      id: uid('CG'),
      name: actualConsignee,
      detail: summaryStr,
      amount: parsedAmount,
      mode,
      bank: (mode === 'Transfer' || mode === 'POS') ? bank : undefined,
      paymentNarration: mode === 'Transfer' ? narrationCode : undefined,
      remarks: remark.trim(),
      time: tnow(),
      type: 'cargo',
      status: 'Intake',
      awb_tag_number: awb,
      airline: airline,
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
          paymentNarration: mode === 'Transfer' ? narrationCode : undefined,
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
        consignee: successTx.name,
        awbTagNumber: successTx.awb_tag_number || awb,
        pieces: successTx.pieces || parseInt(pcs),
        kg: successTx.kg || parseFloat(kg),
        route: successTx.detail.split(' · ')[4] || route,
        contentType: successTx.detail.split(' · ')[5] || contentType,
        amount: successTx.amount,
        paymentMode: successTx.mode,
        paymentNarration: successTx.paymentNarration,
        bankName: successTx.bank || undefined,
        remark: successTx.remarks || undefined,
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
        consignee: successTx.name,
        awbTagNumber: successTx.awb_tag_number || awb,
        pieces: successTx.pieces || parseInt(pcs),
        kg: successTx.kg || parseFloat(kg),
        route: successTx.detail.split(' · ')[4] || route,
        contentType: successTx.detail.split(' · ')[5] || contentType,
        amount: successTx.amount,
        paymentMode: successTx.mode,
        paymentNarration: successTx.paymentNarration,
        bankName: successTx.bank || undefined,
        remark: successTx.remarks || undefined,
      };
      printCargoReceipt(data);
    }
  };

  const formInputClass = "w-full h-12 px-4 text-[14px] rounded-[var(--radius-sm)] bg-[var(--color-input-bg)] text-[var(--color-input-text)] border border-[var(--color-border)] font-sans focus:outline-none focus:border-[var(--color-accent-amber)] focus:ring-2 focus:ring-[var(--glow-amber)] transition-all";

  const renderLabel = (icon: any, text: string) => {
    const Icon = icon;
    return (
      <div className="flex items-center space-x-1.5 mb-1.5">
        <Icon size={14} style={{ color: 'var(--color-light-muted)' }} />
        <label className="text-[13px] font-sans font-semibold text-[var(--color-light-muted)]">{text}</label>
      </div>
    );
  };

  // --- SUB-PANEL: COMPLETED RECEIPT SCREEN ---
  if (successTx) {
    return (
      <div className="p-4 space-y-4 max-w-md mx-auto">
        <div className="border-b border-[var(--color-border)] pb-2 mb-2">
          <span className="text-[14px] font-sans font-semibold text-[var(--color-foreground)]">Cargo Receipt Portal</span>
        </div>

        <div 
          className="bg-[rgba(16,185,129,0.05)] border border-[var(--color-success)] rounded-[var(--radius-md)] text-center p-8 flex flex-col items-center animate-in fade-in zoom-in-95 duration-200"
        >
          <div className="animate-pulse">
            <CheckCircle size={40} className="text-[var(--color-success)] mb-3" />
          </div>
          <div className="text-[15px] font-semibold font-sans text-[var(--color-success)] mb-1">
            {successTx.mode === 'Debt' ? 'Corporate Debt Invoice Saved!' : 'Cargo entry saved successfully!'}
          </div>
          <div className="text-[12px] font-mono text-[var(--color-muted)] mb-6">
            REF: {successTx.id}
          </div>
          
          <div className="w-full bg-[var(--color-surface-card)] rounded-[var(--radius-md)] p-4 mb-8 border border-[var(--color-border)] text-left space-y-3 shadow-md">
             <div className="flex justify-center mb-4 p-4 bg-white rounded">
               <QRCode id={successTx.id} size={150} />
             </div>
             <div className="flex justify-between border-b border-[var(--color-border)] pb-2">
               <span className="text-[13px] font-sans text-[var(--color-muted)]">Consignee</span>
               <span className="text-[14px] font-sans font-medium text-[var(--color-foreground)]">{successTx.name}</span>
             </div>
             <div className="flex justify-between border-b border-[var(--color-border)] pb-2">
               <span className="text-[13px] font-sans text-[var(--color-muted)]">AWB / Tag No</span>
               <span className="text-[14px] font-sans font-semibold text-[var(--color-accent-amber)]">{successTx.awb_tag_number}</span>
             </div>
             <div className="flex justify-between border-b border-[var(--color-border)] pb-2">
               <span className="text-[13px] font-sans text-[var(--color-muted)]">Weight / Route</span>
               <span className="text-[14px] font-sans font-medium text-[var(--color-foreground)]">
                 {successTx.kg} KG — {successTx.detail.split(' · ')[4]}
               </span>
             </div>
             <div className="flex justify-between border-b border-[var(--color-border)] pb-2">
               <span className="text-[13px] font-sans text-[var(--color-muted)]">Content</span>
               <span className="text-[14px] font-sans font-medium text-[var(--color-foreground)]">
                 {successTx.detail.split(' · ')[5] || 'Package'}
               </span>
             </div>
             <div className="flex justify-between border-b border-[var(--color-border)] pb-2">
               <span className="text-[13px] font-sans text-[var(--color-muted)]">Amount Charged</span>
               <span className="text-[16px] font-extrabold font-mono text-[var(--color-accent-amber)]">{fmt(successTx.amount)}</span>
             </div>
             <div className="flex justify-between pt-1">
                <span className="text-[13px] font-sans text-[var(--color-muted)]">Payment billing</span>
                <span className={`text-[13px] font-sans font-bold px-2 py-0.5 rounded ${successTx.mode === 'Debt' ? 'bg-[rgba(239,68,68,0.1)] text-[var(--color-error)]' : 'bg-[rgba(16,185,129,0.1)] text-[var(--color-success)]'}`}>
                  {successTx.mode === 'Debt' ? 'B2B MONTHLY DEBT' : successTx.mode}
                </span>
             </div>
          </div>

          <div className="flex w-full space-x-3">
            <button onClick={handleReset} className="flex-1 py-3.5 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)] text-[var(--color-foreground)] text-[14px] font-sans font-semibold rounded-[var(--radius-sm)] border border-[var(--color-border)] transition-colors cursor-pointer focus:outline-none">
              New Entry
            </button>
            <button onClick={handlePrintReceipt} className="flex-1 py-3.5 bg-[var(--color-accent-amber)] hover:bg-opacity-95 text-[#0D1117] text-[14px] font-bold font-sans rounded-[var(--radius-sm)] shadow-[var(--shadow-button)] transition-opacity cursor-pointer focus:outline-none border-none">
              Print Slip
            </button>
          </div>
          
          <button
            onClick={handleDownloadReceipt}
            style={{
              width: '100%', padding: '11px',
              background: 'transparent',
              border: '1.5px solid rgba(245,158,11,0.3)',
              borderRadius: 'var(--radius-sm)', cursor: 'pointer',
              fontSize: 11, fontFamily: 'monospace',
              fontWeight: 700, color: 'var(--color-accent-amber)',
              display: 'flex', alignItems: 'center',
              justifyContent: 'center', gap: 6,
              marginTop: 10,
            }}
          >
            ↓ DOWNLOAD PDF RECEIPT
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 pb-24 h-full" style={{ width: '100%', boxSizing: 'border-box' }}>
      
      {/* SECTION SELECTOR / HUB MODE NAVIGATION */}
      <div className="flex bg-[var(--color-obsidian)] rounded-lg p-1 border border-[var(--color-border)] mb-6 max-w-lg mx-auto">
        <button
          onClick={() => setActivePortal('retail')}
          className={`flex-1 py-3 text-[14px] font-sans font-bold rounded-md transition-all cursor-pointer ${
            activePortal === 'retail' 
              ? 'bg-[var(--color-accent-amber)] text-[#030712] shadow-md' 
              : 'text-[var(--color-light-muted)] hover:text-white'
          }`}
        >
          📦 Retail Cargo Entry
        </button>
        <button
          onClick={() => setActivePortal('corporate')}
          className={`flex-1 py-3 text-[14px] font-sans font-bold rounded-md transition-all cursor-pointer relative ${
            activePortal === 'corporate' 
              ? 'bg-[var(--color-accent-amber)] text-[#030712] shadow-md' 
              : 'text-[var(--color-light-muted)] hover:text-white'
          }`}
        >
          🏢 Corporate Contract (B2B)
          {pendingIntakes.length > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-600 text-white font-mono text-[10px] w-5 h-5 rounded-full flex items-center justify-center border-2 border-[var(--color-obsidian)] animate-bounce font-bold">
              {pendingIntakes.length}
            </span>
          )}
        </button>
      </div>

      {/* RETAIL CARGO LAYOUT */}
      {activePortal === 'retail' && (
        <div className="grid gap-6 md:grid-cols-[1fr_280px]">
          <div>
            <div className="flex flex-col mb-4">
              <h1 className="text-[18px] font-sans font-bold text-[var(--color-foreground)] leading-tight">New Cargo Retail Entry</h1>
              <p className="text-[12px] font-sans text-[var(--color-muted)]">Log immediate cargo entries with retail cash, transfer or local options.</p>
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
                  {availableAirlines.map(a => (
                    <option key={a} value={a}>{a}</option>
                  ))}
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
                  <div className="text-[11px] font-sans font-semibold text-[var(--color-accent-amber)] mt-1 text-right">Range detected</div>
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

            <div
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '12px 14px', margin: '24px 0 16px 0',
                background: 'linear-gradient(90deg, rgba(245,158,11,0.06) 0%, transparent 100%)',
                borderLeft: '3px solid var(--color-accent-amber)',
                borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
              }}
            >
              <span style={{
                fontSize: 12, fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: '0.05em',
                color: 'var(--color-accent-amber)'
              }}>Payment Details</span>
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
                    className="ehi-input pl-10"
                  />
                </div>
              </div>

              <div>
                {renderLabel(CreditCard, "Receipt / Payment Mode")}
                <div className="flex bg-[var(--color-surface-3)] rounded-[var(--radius-sm)] p-1 border border-[var(--color-border)] mb-3">
                  {['Cash', 'Transfer', 'POS'].map(m => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMode(m as any)}
                      style={{
                        background: mode === m ? 'var(--color-surface-1)' : 'transparent',
                        color: mode === m ? 'var(--color-accent-amber)' : 'var(--color-muted)',
                        border: 'none',
                      }}
                      className={`flex-1 py-2 text-[13px] font-sans font-semibold rounded-[var(--radius-xs)] shadow-sm transition-all focus:outline-none cursor-pointer`}
                    >
                      {m}
                    </button>
                  ))}
                </div>

                <div className="flex items-center justify-center space-x-3 my-3">
                   <div className="flex-1 h-px bg-[var(--color-border)]" />
                   <div className="text-[11px] font-mono text-[var(--color-muted)] tracking-wider">OR</div>
                   <div className="flex-1 h-px bg-[var(--color-border)]" />
                </div>

                <button
                  type="button"
                  onClick={() => setMode('Debt')}
                  className={`w-full py-2.5 text-[13px] font-sans font-semibold rounded-[var(--radius-sm)] border transition-colors cursor-pointer focus:outline-none ${mode === 'Debt' ? 'bg-[rgba(239,68,68,0.1)] border-[var(--color-error)] text-[var(--color-error)] shadow-sm' : 'bg-transparent border-[var(--color-border-strong)] text-[var(--color-error)] hover:bg-[rgba(239,68,68,0.05)]'}`}
                >
                  Log as Credit Sale (Debt)
                </button>
                
                {mode === 'Debt' && (
                  <div className="mt-2 text-[12px] font-sans text-[var(--color-error)] bg-[rgba(239,68,68,0.05)] p-2.5 rounded-[var(--radius-sm)] border border-[rgba(239,68,68,0.1)]">
                    This sale will be logged as a credit. Collect payment before dispatch or arrange with management.
                  </div>
                )}
              </div>
              
              {mode === 'Transfer' && (
                <div className="animate-in fade-in slide-in-from-top-2 duration-200">
                  {renderLabel(Landmark, "Bank")}
                  <select 
                    value={bank}
                    onChange={(e) => setBank(e.target.value)}
                    className={formInputClass}
                  >
                    {BANKS.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                  <PaymentNarrationBox narrationCode={narrationCode} />
                </div>
              )}

              {mode === 'POS' && (
                <div className="animate-in fade-in slide-in-from-top-2 duration-200">
                  {renderLabel(CreditCard, "POS Terminal / Bank")}
                  <select
                    value={bank}
                    onChange={(e) => setBank(e.target.value)}
                    className={formInputClass}
                  >
                    {BANKS.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
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
                onClick={handleRetailSubmit}
                disabled={!isRetailFormValid || submitting}
                className={`w-full py-4 rounded-[var(--radius-sm)] font-sans font-bold text-[16px] flex items-center justify-center gap-2 transition-all focus:outline-none ${
                  submitting ? 'opacity-80 cursor-wait bg-[var(--color-accent-amber)] text-[#030712]' :
                  !isRetailFormValid ? 'bg-[var(--color-surface-3)] text-[var(--color-muted)] cursor-not-allowed border border-[var(--color-border)]' :
                  'bg-[var(--color-accent-amber)] text-[#030712] cursor-pointer hover:bg-opacity-95'
                }`}
              >
                {submitting && <Loader2 size={18} className="animate-spin" />}
                {submitting ? 'LOGGING...' : 'LOG CARGO ENTRY'}
              </button>
            </div>
          </div>

          <aside className="hidden md:block">
            <div style={{
              position: 'sticky', top: 16,
              background: 'var(--color-surface-1)',
              border: '1.5px solid var(--color-border-strong)',
              borderRadius: 'var(--radius-md)', padding: 20,
              boxShadow: 'var(--shadow-card)',
            }}>
              <div style={{
                fontSize: 10, fontFamily: 'monospace',
                color: 'var(--color-muted)',
                textTransform: 'uppercase', letterSpacing: '0.1em',
                marginBottom: 16, fontWeight: 700
              }}>
                ENTRY SUMMARY
              </div>
              <div style={{ fontSize: 13, fontFamily: 'monospace', lineHeight: 2.2, color: 'var(--color-foreground)' }}>
                <div className="flex justify-between border-b border-[var(--color-border)] pb-1 mb-1"><span style={{ color: 'var(--color-muted)' }}>Consignee</span><span className="truncate ml-4 font-semibold text-[var(--color-foreground)]" style={{ maxWidth: '140px' }}>{actualConsignee || '—'}</span></div>
                <div className="flex justify-between border-b border-[var(--color-border)] pb-1 mb-1"><span style={{ color: 'var(--color-muted)' }}>AWB</span><span className="font-bold text-[var(--color-accent-amber)]">{awb || '—'}</span></div>
                <div className="flex justify-between border-b border-[var(--color-border)] pb-1 mb-1"><span style={{ color: 'var(--color-muted)' }}>Route</span><span className="font-semibold text-[var(--color-foreground)]">{route}</span></div>
                <div className="flex justify-between border-b border-[var(--color-border)] pb-1 mb-1"><span style={{ color: 'var(--color-muted)' }}>Content</span><span className="font-semibold text-[var(--color-foreground)]">{contentType}</span></div>
                <div className="flex justify-between"><span style={{ color: 'var(--color-muted)' }}>Pcs / KG</span><span className="font-semibold text-[var(--color-foreground)]">{pcs || '—'} / {kg || '—'}</span></div>
              </div>
              <div style={{
                borderTop: '1.5px dashed var(--color-border-strong)',
                paddingTop: 16, marginTop: 16,
              }}>
                <div style={{
                  fontSize: 10, fontFamily: 'monospace',
                  color: 'var(--color-muted)', marginBottom: 6,
                  fontWeight: 700, letterSpacing: '0.05em'
                }}>AMOUNT</div>
                <div style={{
                  fontSize: 28, fontWeight: 800, fontFamily: 'monospace',
                  color: parsedAmount > 0 ? 'var(--color-accent-amber)' : 'var(--color-muted)',
                }}>
                  {parsedAmount > 0 ? '₦' + parsedAmount.toLocaleString('en-NG') : '₦0'}
                </div>
                <div style={{
                  fontSize: 11, fontFamily: 'monospace',
                  color: 'var(--color-muted)', marginTop: 6,
                  fontWeight: 600,
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
      )}

      {/* CORPORATE SYSTEM PORTAL */}
      {activePortal === 'corporate' && (
        <div className="space-y-6">
          
          {/* CORPORATE MENU ROUTING */}
          <div className="flex border-b border-[var(--color-border)] text-[13px] font-sans font-bold gap-4 py-1">
            <button
              onClick={() => setCorpSubTab('intake')}
              className={`pb-2.5 px-1 transition-all cursor-pointer ${
                corpSubTab === 'intake' 
                  ? 'text-[var(--color-accent-amber)] border-b-2 border-[var(--color-accent-amber)]' 
                  : 'text-[var(--color-light-muted)] hover:text-white'
              }`}
            >
              📋 Phase 1: Field Intake Book
            </button>
            <button
              onClick={() => setCorpSubTab('weighing')}
              className={`pb-2.5 px-1 transition-all cursor-pointer flex items-center gap-1.5 ${
                corpSubTab === 'weighing' 
                  ? 'text-[var(--color-accent-amber)] border-b-2 border-[var(--color-accent-amber)]' 
                  : 'text-[var(--color-light-muted)] hover:text-white'
              }`}
            >
              ⚖️ Phase 2: Yard Gate Weigh Scale
              {pendingIntakes.length > 0 && (
                <span className="bg-red-600 text-white font-bold text-[10px] px-1.5 py-0.5 rounded-full">
                  {pendingIntakes.length} pending
                </span>
              )}
            </button>
          </div>

          {/* DYNAMIC SUBTABS VIEW */}
          {corpSubTab === 'intake' && (
            <div className="grid gap-6 md:grid-cols-2 max-w-5xl mx-auto">
              
              {/* PHASE 1 INPUT FORM */}
              <div className="bg-[var(--color-surface-card)] border border-[var(--color-border-strong)] p-5 rounded-[var(--radius-md)]">
                <div className="flex items-center gap-2 mb-4 border-b border-[var(--color-border)] pb-2.5">
                  <PlusCircle size={18} className="text-[var(--color-accent-amber)]" />
                  <h3 className="text-[14px] font-sans font-bold text-[var(--color-foreground)] uppercase tracking-wider">Log Corporate Pick-Up (No Pricing)</h3>
                </div>

                {successMessage && (
                  <div className="p-3 mb-4 text-[12px] font-sans font-bold text-[#fafafa] bg-emerald-950 border border-emerald-500 rounded animate-bounce">
                    ✓ {successMessage}
                  </div>
                )}

                <div className="space-y-4">
                  <div>
                    {renderLabel(UserIcon, "B2B Corporate Client")}
                    <select
                      value={intakeConsignee}
                      onChange={(e) => setIntakeConsignee(e.target.value)}
                      className={formInputClass}
                    >
                      {corpClients.map(c => (
                        <option key={c.id} value={c.company_name}>{c.company_name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    {renderLabel(Plane, "Carrier Airline")}
                    <select 
                      value={intakeAirline}
                      onChange={(e) => setIntakeAirline(e.target.value)}
                      className={formInputClass}
                    >
                      {availableAirlines.map(a => (
                        <option key={a} value={a}>{a}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    {renderLabel(Hash, "AWB Tag / Waybill Number")}
                    <input 
                      type="text"
                      placeholder="e.g. AWB-ARAM-924"
                      value={intakeAwb}
                      onChange={(e) => setIntakeAwb(e.target.value)}
                      className={`${formInputClass} font-mono`}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      {renderLabel(Package, "Pcs (Boxes/Parcels)")}
                      <input 
                        type="number"
                        min="1"
                        value={intakePcs}
                        onChange={(e) => setIntakePcs(e.target.value)}
                        className={formInputClass}
                      />
                    </div>
                    <div>
                      {renderLabel(MapPin, "Destination Route")}
                      <select 
                        value={intakeRoute}
                        onChange={(e) => setIntakeRoute(e.target.value)}
                        className={formInputClass}
                      >
                        {CARGO_ROUTES.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      {renderLabel(Layers, "Cargo Content Type")}
                      <select 
                        value={intakeContentType}
                        onChange={(e) => setIntakeContentType(e.target.value)}
                        className={formInputClass}
                      >
                        {CONTENT_TYPES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div>
                      {renderLabel(MessageSquare, "Field Client Phone (WhatsApp)")}
                      <input 
                        type="tel"
                        placeholder="e.g. 08011223344"
                        value={intakeSenderPhone}
                        onChange={(e) => setIntakeSenderPhone(e.target.value)}
                        className={formInputClass}
                      />
                    </div>
                  </div>

                  <div className="bg-[rgba(245,158,11,0.03)] border border-[rgba(245,158,11,0.1)] p-3 rounded text-[11px] font-sans text-[var(--color-light-muted)] space-y-1">
                    <p className="font-semibold text-[var(--color-accent-amber)]">⚠️ INTENTIONAL BUSINESS LOGIC:</p>
                    <p>No pricing or weights can be registered during Field Intake lookup. Definitive weights and billing calculations are strictly delayed until verified scale weighings are finalized inside the Gate Yard Clerk terminal.</p>
                  </div>

                  <button
                    onClick={handleLogFieldIntake}
                    className="w-full h-12 mt-4 cursor-pointer bg-[var(--color-accent-amber)] text-[#030712] font-semibold text-[14px] rounded-[var(--radius-sm)] flex items-center justify-center gap-2 hover:bg-opacity-95 transition-all text-center"
                  >
                    🚀 LOG INTAKE FOR WEIGHING
                  </button>
                </div>
              </div>

              {/* LIST OF PENDING INTAKES FOR CURRENT SESSION */}
              <div className="space-y-4">
                <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] p-4 rounded-[var(--radius-md)]">
                  <h4 className="text-[13px] font-sans font-bold text-[var(--color-foreground)] mb-3">Today's Registered Pick-ups ({pendingIntakes.length})</h4>
                  
                  {pendingIntakes.length === 0 ? (
                    <div className="text-center py-10 text-[var(--color-muted)] text-[12px] font-sans">
                      No pending field intakes currently recorded. Use the intake book form on the left.
                    </div>
                  ) : (
                    <div className="divide-y divide-[var(--color-border)] max-h-[380px] overflow-y-auto pr-1">
                      {pendingIntakes.map(pi => (
                        <div key={pi.id} className="py-2.5 flex items-center justify-between text-[12px]">
                          <div>
                            <div className="font-bold text-[var(--color-foreground)] flex items-center gap-1.5">
                              <span>🏢 {pi.consignee}</span>
                              <span className="font-semibold px-1.5 py-0.5 rounded bg-[rgba(245,158,11,0.08)] text-[var(--color-accent-amber)] font-mono text-[9px]">{pi.id}</span>
                            </div>
                            <div className="text-[var(--color-light-muted)] mt-0.5">
                              {pi.airline} · {pi.awb} · {pi.pieces} pcs · <span className="text-amber-500 font-semibold">{pi.route}</span>
                            </div>
                          </div>
                          <span className="text-[11px] font-mono text-[var(--color-muted)]">{pi.time}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="p-4 rounded-md border border-[var(--color-border)] bg-[var(--color-obsidian)] text-[11px] font-serif text-[var(--color-light-muted)] italic leading-relaxed">
                  "Every pickup record entered here syncs dynamically with our centralized database architecture. Scale weighing operates in strict sequence at the major gateyard commercial weighing scales."
                </div>
              </div>
            </div>
          )}

          {/* PHASE 2 SUBTAB: YARD GATE WEIGH SCALE */}
          {corpSubTab === 'weighing' && (
            <div className="grid gap-6 md:grid-cols-[1.5fr_1fr] max-w-6xl mx-auto">
              
              {/* DETAILED PENDING GRID/QUEUE */}
              <div className="bg-[var(--color-surface-card)] border border-[var(--color-border-strong)] p-5 rounded-[var(--radius-md)]">
                <div className="flex items-center justify-between mb-4 pb-2 border-b border-[var(--color-border)]">
                  <div className="flex items-center gap-2">
                    <Scale size={18} className="text-[var(--color-accent-amber)]" />
                    <h3 className="text-[14px] font-sans font-bold text-[var(--color-foreground)] uppercase tracking-wider">Gateyard Scale Booking Queue</h3>
                  </div>
                  <span className="text-[11px] font-mono text-[var(--color-muted)]">Active scales stabilized</span>
                </div>

                {pendingIntakes.length === 0 ? (
                  <div className="text-center py-20 text-[var(--color-muted)] text-[13px] font-sans">
                     <p className="font-semibold text-white mb-1">Scale Yard Queue Empty</p>
                     <p className="max-w-md mx-auto text-[11px]">All corporate shipments have been weighed and routed. Check Phase 1 Logbook or the main Ledger.</p>
                  </div>
                ) : (
                  <div className="grid gap-3 max-h-[500px] overflow-y-auto pr-1">
                     {pendingIntakes.map(pi => {
                       const isSelected = selectedIntake?.id === pi.id;
                       
                       // Client custom rate lookup for preview badges
                       const matchingC = corpClients.find(c => c.company_name === pi.consignee);
                       const clientRate = matchingC 
                         ? corpRates.find(r => r.corporate_client_id === matchingC.id && r.route_name === pi.route)
                         : null;
                       const finalRate = clientRate ? clientRate.rate_per_kg : 500;

                       return (
                         <div 
                           key={pi.id}
                           onClick={() => {
                             setSelectedIntake(pi);
                             setGateWeight('');
                             setCustomRateOverwrite('');
                           }}
                           className={`p-3.5 rounded-md border text-[13px] transition-colors cursor-pointer flex items-center justify-between ${
                             isSelected 
                               ? 'bg-[rgba(245,158,11,0.05)] border-[var(--color-accent-amber)] shadow-lg' 
                               : 'bg-[var(--color-input-bg)] border-[var(--color-border)] hover:border-gray-600'
                           }`}
                         >
                           <div className="space-y-1">
                             <div className="flex items-center gap-2">
                               <span className="font-bold text-white text-[14px]">🏢 {pi.consignee}</span>
                               <span className="text-[10px] font-mono font-bold px-1.5 bg-slate-800 text-[var(--color-light-muted)] rounded">{pi.id}</span>
                             </div>
                             <div className="text-[12px] text-[var(--color-light-muted)] space-x-2">
                               <span>Waybill: <strong className="text-amber-500 font-mono">{pi.awb}</strong></span>
                               <span>•</span>
                               <span>Route: <strong className="text-gray-300">{pi.route}</strong></span>
                               <span>•</span>
                               <span>Pcs: <strong>{pi.pieces}</strong></span>
                             </div>
                           </div>
                           
                           <div className="flex items-center gap-3">
                             <div className="text-right text-[11px] font-mono">
                               <div className="text-[var(--color-light-muted)]">Negotiated Rate</div>
                               <div className="font-bold text-[var(--color-accent-amber)]">₦{finalRate}/KG</div>
                             </div>
                             <ArrowRight size={16} className={isSelected ? "text-[var(--color-accent-amber)]" : "text-gray-600"} />
                           </div>
                         </div>
                       );
                     })}
                  </div>
                )}
              </div>

              {/* INTEGRATED SCALE WEIGHT & CALCULATION WORKSPACE */}
              <div>
                {selectedIntake ? (
                  <div className="bg-[var(--color-surface-card)] border border-[var(--color-border-strong)] p-6 rounded-[var(--radius-md)] text-zinc-300 flex flex-col h-auto">
                    <div className="flex items-center justify-between mb-6 pb-2 border-b border-[rgba(255,255,255,0.05)]">
                      <div className="text-[13px] font-bold text-[var(--color-accent-amber)] uppercase tracking-wider">
                        SCALE WEIGHING CONSOLE
                      </div>
                    </div>

                    <div className="bg-[var(--color-surface-2)] p-4 rounded-lg border border-[rgba(255,255,255,0.05)] space-y-2 text-[12px] mb-6">
                      <div className="flex justify-between items-center py-1 border-b border-[rgba(255,255,255,0.05)]">
                        <span className="text-[var(--color-muted)] font-medium">Arrived Client</span>
                        <span className="font-bold text-[var(--color-foreground)]">{selectedIntake.consignee}</span>
                      </div>
                      <div className="flex justify-between items-center py-1 border-b border-[rgba(255,255,255,0.05)]">
                        <span className="text-[var(--color-muted)] font-medium">Shipment Route</span>
                        <span className="font-bold text-[var(--color-accent-amber)]">{selectedIntake.route}</span>
                      </div>
                      <div className="flex justify-between items-center py-1 border-b border-[rgba(255,255,255,0.05)]">
                        <span className="text-[var(--color-muted)] font-medium">Carrier Waybill</span>
                        <span className="font-bold text-[var(--color-foreground)] font-mono">{selectedIntake.awb}</span>
                      </div>
                      <div className="flex justify-between items-center py-1">
                        <span className="text-[var(--color-muted)] font-medium">Total Containers</span>
                        <span className="font-bold text-[var(--color-foreground)]">{selectedIntake.pieces} pieces</span>
                      </div>
                    </div>

                    {/* SCALE SIMULATION FOR INTEGRATION LOOKS POPULAR */}
                    <div className="mb-6">
                      <label className="text-[11px] font-medium text-[var(--color-muted)] block mb-1.5">Commercial Scale Verified Weight (KG)</label>
                      <div className="relative">
                        <input 
                          type="number"
                          step="0.1"
                          placeholder="Scale Reading"
                          value={gateWeight}
                          onChange={(e) => setGateWeight(e.target.value)}
                          className="w-full h-12 pl-4 pr-10 text-[16px] font-bold text-[var(--color-accent-amber)] rounded-md bg-[var(--color-bg)] border border-[rgba(255,255,255,0.1)] font-mono focus:outline-none focus:border-[var(--color-accent-amber)] transition-colors"
                        />
                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--color-muted)] font-bold text-[12px] font-sans">KG</span>
                      </div>
                    </div>

                    {/* DYNAMIC CONTRACT PRICING ENGINE */}
                    <div className="flex flex-col space-y-4">
                      <div className="bg-[var(--color-bg)] p-4 rounded-lg border border-[rgba(255,255,255,0.05)] space-y-3 font-mono text-[12px]">
                        <div className="flex justify-between items-center">
                          <span className="text-[var(--color-muted)]">Negotiated Rate</span>
                          <span className="font-bold text-[var(--color-foreground)]">
                            ₦{
                              (() => {
                                const matchC = corpClients.find(c => c.company_name === selectedIntake.consignee);
                                const matchR = matchC ? corpRates.find(r => r.corporate_client_id === matchC.id && r.route_name === selectedIntake.route) : null;
                                return matchR ? matchR.rate_per_kg : '500.00 (Baseline)';
                              })()
                            }/KG
                          </span>
                        </div>

                        {/* RBAC OVERWRITE PRICING LOCK */}
                        {isAuthorizedRole ? (
                          <div className="pt-2 border-t border-[rgba(255,255,255,0.05)]">
                            <label className="text-[10px] text-[var(--color-muted)] block mb-1.5">Admin Custom Rate Overwrite (₦/KG):</label>
                            <input 
                              type="number"
                              placeholder="Leave empty for default"
                              value={customRateOverwrite}
                              onChange={(e) => setCustomRateOverwrite(e.target.value)}
                              className="w-full h-9 px-3 text-[12px] bg-[var(--color-surface-2)] text-[var(--color-foreground)] border border-[rgba(255,255,255,0.05)] rounded focus:outline-none focus:border-[var(--color-accent-amber)] transition-colors"
                            />
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 text-[10px] bg-[var(--color-surface-2)] text-[var(--color-muted)] p-2 rounded italic">
                            <ShieldAlert size={12} />
                            <span>Rates locked by Accounting rules.</span>
                          </div>
                        )}

                        <div className="pt-3 mt-1 border-t border-[rgba(255,255,255,0.1)] flex justify-between items-center">
                          <span className="text-[12px] font-sans text-[var(--color-muted)] font-medium uppercase tracking-wider">Computed Bill</span>
                          <span className="text-[18px] text-[var(--color-accent-amber)] font-bold">
                            ₦{
                              (() => {
                                const matchC = corpClients.find(c => c.company_name === selectedIntake.consignee);
                                const matchR = matchC ? corpRates.find(r => r.corporate_client_id === matchC.id && r.route_name === selectedIntake.route) : null;
                                const rate = customRateOverwrite 
                                  ? parseFloat(customRateOverwrite) 
                                  : matchR 
                                    ? matchR.rate_per_kg 
                                    : 500;
                                const weight = parseFloat(gateWeight) || 0;
                                return (weight * rate).toLocaleString('en-NG', { maximumFractionDigits: 2 });
                              })()
                            }
                          </span>
                        </div>
                      </div>

                      <div className="text-[11px] text-[#ef4444] bg-[rgba(239,68,68,0.03)] p-2 rounded border border-[rgba(239,68,68,0.1)] leading-snug">
                        ⚡ PL/pgSQL database trigger will automatically book this finalized amount to the client's monthly master debt profile balance.
                      </div>
                    </div>

                    <button
                      onClick={handleFinalizeWeighing}
                      disabled={!gateWeight || isWeighingSubmitting}
                      className="w-full h-12 mt-5 cursor-pointer bg-[var(--color-accent-amber)] text-[#030712] font-semibold text-[14px] rounded flex items-center justify-center gap-2 hover:bg-opacity-95 transition-all text-center"
                    >
                      {isWeighingSubmitting ? <Loader2 size={16} className="animate-spin" /> : '✓ FINALIZE GATE INVOICE'}
                    </button>
                  </div>
                ) : (
                  <div className="bg-[var(--color-surface-card)] border border-[var(--color-border-strong)] p-12 rounded-[var(--radius-md)] text-center text-[var(--color-muted)]">
                     <Scale size={32} className="mx-auto text-zinc-700 mb-3" />
                     <p className="text-[13px] font-sans font-semibold text-zinc-400">Scale Diagnostic Standby</p>
                     <p className="text-[11px] font-sans max-w-xs mx-auto mt-1">Select any corporate pick-up booking from the left queue to place items on the commercial yard scale.</p>
                  </div>
                )}

                <div className="bg-[var(--color-surface-2)] p-4 rounded border border-[var(--color-border)]">
                   <h5 className="text-[12px] font-bold text-white mb-2 flex items-center gap-1">
                     <ShieldAlert size={14} className="text-yellow-600" />
                     B2B Scaling Rules
                   </h5>
                   <p className="text-[11px] text-[var(--color-light-muted)] leading-relaxed">
                     Weights verified on our gate scale are definitive (no manual estimation allowed). Payment modes on corporate custom accounts automatically bill monthly to prevent yard queuing blocks.
                   </p>
                </div>
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
};
