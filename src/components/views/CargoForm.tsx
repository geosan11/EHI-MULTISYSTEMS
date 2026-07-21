import { CARGO_ROUTES } from "../../lib/constants";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Transaction, User, Expense, CustomerWallet } from "../../lib/types";
import { fmt, roundMoney, tnow, generatePickupPin, normalizeAirlineName, getHubCode, upperOnChange, isStandalonePWA } from "../../lib/helpers";
import { chargeWalletForSale } from "../../lib/walletPayment";
import { matchWallet } from "../../lib/customerIdentity";
import { WalletRemainderSelector } from "../WalletRemainderSelector";
import { useHubRoutes, useValidatedRouteSelection } from "../../lib/hubRoutes";
import { useAirlines, addAirlineIfMissing } from "../../lib/airlines";
import { useContentTypes } from "../../lib/contentTypes";
import { useSpecialGoodsRates, resolveSpecialGoodsRate } from "../../lib/specialGoodsRates";
import { useMinimumCharges, resolveMinimumCharge } from "../../lib/minimumCharges";
import { useBanks } from "../../lib/banks";
import { useEnterToNextField } from "../../lib/useEnterToNextField";
import { isTagAlreadyDelivered } from "../../lib/scanLogic";
import { getNextTag } from "../../lib/tagPool";
import { CustomerWalletPicker } from "../CustomerWalletPicker";
import {
  CheckCircle,
  Loader2,
  User as UserIcon,
  Plane,
  Hash,
  Package,
  MapPin,
  Layers,
  Banknote,
  CreditCard,
  Landmark,
  MessageSquare,
  Scale,
  Users,
  ShieldAlert,
  PlusCircle,
  Trash2,
  Edit3,
  Coins,
  Search,
  ArrowRight,
  Table,
  DollarSign,
  Building,
  Copy,
  ClipboardList,
  AlertTriangle,
  Rocket,
  Zap,
  Bluetooth,
  Lock,
  Calendar,
} from "lucide-react";
import {
  sendReceiptWhatsApp,
  buildCargoWhatsApp,
} from "../../lib/notifications";
import { supabase } from "../../lib/supabase";
import { useToast } from "../../lib/ToastContext";
import { useConfirm } from "../../lib/ConfirmContext";

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
  minimum_amount?: number;
}

interface PendingWeighingIntake {
  id: string;
  consignee: string;
  corporate_client_id: string;
  pieces: number;
  route: string;
  contentType: string;
  airline: string;
  awb: string;
  created_at: string;
  sender_phone?: string;
  time: string;
  isCorporate?: boolean;
  sender?: string;
  content_type?: string;
}

const LOCAL_SERIAL_KEY = () => {
  const today = new Date().toISOString().split("T")[0];
  return `ehi_cargo_serial_${today}`;
};

function getLocalSerial(): number {
  try {
    if (typeof window === "undefined" || !window.localStorage) return 1;
    const stored = localStorage.getItem(LOCAL_SERIAL_KEY());
    return stored ? parseInt(stored) : 1;
  } catch (e) {
    return 1;
  }
}

function incrementLocalSerial(): number {
  const key = LOCAL_SERIAL_KEY();
  try {
    if (typeof window === "undefined" || !window.localStorage) return getLocalSerial();
    const next = getLocalSerial() + 1;
    localStorage.setItem(key, String(next));

    const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
    localStorage.removeItem(`ehi_cargo_serial_${yesterday}`);

    return next;
  } catch (e) {
    return getLocalSerial();
  }
}

import { QRCode } from "../QRCode";
import { ReviewEntryModal } from "./ReviewEntryModal";
import { PaymentNarrationBox } from "../PaymentNarrationBox";

export const CargoForm = ({
  onAddTx,
  user: propUser,
  transactions = [],
  onShowHistory,
  customerWallets: passedWallets,
  setCustomerWallets: passedSetWallets,
}: {
  onAddTx: (tx: Transaction) => void;
  user: User;
  transactions?: Transaction[];
  onShowHistory?: () => void;
  customerWallets?: CustomerWallet[];
  setCustomerWallets?: React.Dispatch<React.SetStateAction<CustomerWallet[]>>;
}) => {
  const isAdmin = ['super_admin', 'admin', 'accountant'].includes(propUser.role);
  const [adminSelectedHub, setAdminSelectedHub] = useState(propUser.hub_id || 'LOS/Lagos');
  const user = isAdmin ? { ...propUser, hub_id: adminSelectedHub, hub: adminSelectedHub } : propUser;

  // Navigation tabs between Regular & Corporate Billing
  const [activePortal, setActivePortal] = useState<"retail" | "corporate">(
    "retail",
  );
  // "directory" was a third value here with a full handler pair
  // (handleCreateCorpAccount/handleSaveRouteRate) that wrote ONLY to
  // localStorage -- but no button anywhere ever called setCorpSubTab
  // ("directory"), so that whole path was unreachable dead code, and
  // creating a corporate client or setting a contract rate through the
  // UI already happens correctly (synced to Supabase) via
  // PricingConfiguration.tsx. Removed rather than wired up, since wiring
  // it up would have exposed a second, localStorage-only path for the
  // same actions -- the exact "looks saved but isn't" bug already fixed
  // elsewhere this session for Phase 1 intakes.
  const [corpSubTab, setCorpSubTab] = useState<"intake" | "weighing">("intake");
  const { showToast } = useToast();
  const confirm = useConfirm();
  const routes = useHubRoutes();
  const contentTypes = useContentTypes();
  const banks = useBanks();

  const generateAwb = () => `AWB-${Math.floor(100000 + Math.random() * 900000)}`;

  // --- STANDARD RETAIL STATES ---
  const [serialNumber, setSerialNumber] = useState<number>(getLocalSerial);
  // Starts blank (not "Other") so the field is immediately typeable -- see
  // the consigneeOptions/datalist combobox below, which lets staff either
  // pick a known corporate client or type a new/walk-in name directly,
  // without a forced dropdown pick or an auto-select effect fighting it.
  const [consignee, setConsignee] = useState("");
  const [airline, setAirline] = useState("Arik Air");
  const [customAirline, setCustomAirline] = useState("");
  const [customConsignee, setCustomConsignee] = useState("");

  // This is now a REAL, already-allocated number, not a non-destructive
  // preview -- popped from the local tag pool (src/lib/tagPool.ts), which
  // is a pure local operation, so it works offline too. Popping a pooled
  // number doesn't touch the shared server counter (that already happened
  // when the block was reserved), so an abandoned/reset form just leaves
  // this one number unused within this device's own pool -- not "stolen"
  // from another agent the way calling next_awb_number() directly would be.
  const [awb, setAwb] = useState('');
  const fetchAwbPreview = async () => {
    const hubCode = getHubCode(user.hub_code || user.hub);
    const poolKey = `${hubCode}-CG`;
    const tag = await getNextTag(poolKey, `EHI-${hubCode}-CG`);
    setAwb(tag || '');
  };
  useEffect(() => { fetchAwbPreview(); }, []);

  const [pcs, setPcs] = useState("1");
  const [kg, setKg] = useState("");
  const [showRetailReview, setShowRetailReview] = useState(false);
  const [route, setRoute] = useState(routes[0]);
  useValidatedRouteSelection(routes, route, setRoute);
  const [contentType, setContentType] = useState(contentTypes[0] as string);
  const [customContentType, setCustomContentType] = useState("");
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<string>(
    "Cash",
  );
  const [corporateMode, setCorporateMode] = useState<string>("Debt");
  const [bank, setBank] = useState(banks[0] as string);
  const [remark, setRemark] = useState("");
  const [senderPhone, setSenderPhone] = useState("");
  const [consigneePhone, setConsigneePhone] = useState("");

  const [narrationCode, setNarrationCode] = useState<string>("");

  useEffect(() => {
    if (mode === "Transfer" && !narrationCode) {
      import("../../lib/helpers").then(({ generatePaymentNarration }) => {
        // serialNumber is a device-local daily counter (localStorage,
        // resets independently per browser) -- two devices at the same hub
        // both processing their own transaction #5 of the day would
        // generate the IDENTICAL narration code, a guaranteed collision,
        // not just a probabilistic one. Matches the random-serial approach
        // PackageForm/MarketingWorkspace/ExcessBaggageForm already use.
        setNarrationCode(generatePaymentNarration(user.hub_code || user.hub, Math.floor(Math.random() * 9000) + 1000));
      });
    }
    // Only regenerate when mode switches TO Transfer — not on every narrationCode change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const [standardRates, setStandardRates] = useState<Record<string, number>>(
    {},
  );
  // Hub-specific pricing overrides, most-specific first: an exact
  // hub+airline+route rate, then this hub's default for the route
  // regardless of airline. Both are scoped to this hub only (retail intake
  // always happens at the agent's own hub, same as cargo_entries.hub_id) --
  // fetched once alongside standardRates, which remains the last-resort
  // company-wide fallback (see resolveRate below).
  const [hubAirlineRouteRates, setHubAirlineRouteRates] = useState<Record<string, number>>({});
  const [hubRouteRates, setHubRouteRates] = useState<Record<string, number>>({});

  useEffect(() => {
    const fetchRates = async () => {
      try {
        const { data, error } = await supabase.from('standard_cargo_rates').select('route_name, rate_per_kg');
        if (data && data.length > 0 && !error) {
          const rates: Record<string, number> = {};
          data.forEach((r: any) => { rates[r.route_name] = Number(r.rate_per_kg); });
          setStandardRates(rates);
          localStorage.setItem("ehi_standard_cargo_rates", JSON.stringify(rates));
        } else {
          // No server rows and no cache: leave standardRates empty rather
          // than synthesizing a flat 500/route default. resolveRate()'s
          // company-wide tier must be able to tell "nothing configured"
          // (undefined) apart from "someone actually set 500" -- a synthetic
          // default here would be indistinguishable from a real rate, and
          // once cached to localStorage would keep silently reappearing on
          // this device even after real rates exist server-side, for any
          // route/hub combo that never got an override.
          const saved = localStorage.getItem("ehi_standard_cargo_rates");
          if (saved) setStandardRates(JSON.parse(saved));
        }
      } catch (err) {
        const saved = localStorage.getItem("ehi_standard_cargo_rates");
        if (saved) setStandardRates(JSON.parse(saved));
      }
    };
    fetchRates();

    // Rates change rarely (an admin edits them occasionally), but an agent
    // can stay on this tab for a full shift without ever re-triggering this
    // mount-time fetch -- a rate changed mid-shift wouldn't show up until
    // they navigate away and back or reload. A realtime channel here would
    // add another persistent connection per active cargo agent on top of
    // the ones already budgeted in EHIApp.tsx for the entry-stream data,
    // for data that doesn't need push latency -- refetch on refocus (covers
    // alt-tabbing away and back) plus a bounded interval backstop (covers
    // staying continuously foregrounded) instead.
    const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
    const interval = setInterval(fetchRates, REFRESH_INTERVAL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') fetchRates(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', fetchRates);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', fetchRates);
    };
  }, []);

  useEffect(() => {
    if (!user.hub_id) return;
    const fetchHubRates = async () => {
      const [airlineRes, hubRes] = await Promise.all([
        supabase.from('hub_airline_route_rates').select('airline, route_name, rate_per_kg').eq('hub_id', user.hub_id),
        supabase.from('hub_route_rates').select('route_name, rate_per_kg').eq('hub_id', user.hub_id),
      ]);
      if (airlineRes.data && !airlineRes.error) {
        const rates: Record<string, number> = {};
        airlineRes.data.forEach((r: any) => { rates[`${r.airline}|${r.route_name}`] = Number(r.rate_per_kg); });
        setHubAirlineRouteRates(rates);
      }
      if (hubRes.data && !hubRes.error) {
        const rates: Record<string, number> = {};
        hubRes.data.forEach((r: any) => { rates[r.route_name] = Number(r.rate_per_kg); });
        setHubRouteRates(rates);
      }
    };
    fetchHubRates();

    // Same staleness reasoning as the standardRates effect above -- see
    // that comment for why this is a poll+refocus backstop rather than a
    // realtime subscription.
    const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
    const interval = setInterval(fetchHubRates, REFRESH_INTERVAL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') fetchHubRates(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', fetchHubRates);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', fetchHubRates);
    };
  }, [user.hub_id]);

  const specialGoodsRates = useSpecialGoodsRates();
  const minimumCharges = useMinimumCharges();

  // Rate lookup for retail cargo pricing, highest priority first: a
  // special-goods kg-tier rate for this content type + airline (set in
  // Special Goods Rates, only applies when the content type is flagged),
  // then the normal 3-tier cascade -- exact hub+airline+route override,
  // then this hub's default for the route (any airline), then the
  // company-wide standard_cargo_rates value. Returns null (not a guessed
  // number) when nothing is configured at any tier -- staff must then price
  // the entry manually rather than the form silently assuming a rate no one
  // actually set (the previous `standardRates[route] || 500` behavior this
  // replaces could silently under/overcharge for any route/hub that simply
  // hadn't been configured yet).
  const resolveRate = (forAirline: string, forRoute: string, forContentType: string, forKg: number): number | null => {
    const special = resolveSpecialGoodsRate(specialGoodsRates, forContentType, forAirline, forKg, user.hub_id);
    if (special != null) return special;
    const exact = hubAirlineRouteRates[`${forAirline}|${forRoute}`];
    if (exact != null) return exact;
    const hubDefault = hubRouteRates[forRoute];
    if (hubDefault != null) return hubDefault;
    const company = standardRates[forRoute];
    if (company != null) return company;
    return null;
  };

  // Resolved once here (rather than only inside handleRetailSubmit, where it
  // used to live) so both the render-time price preview and the submit
  // handler agree on the same airline name used for the rate lookup.
  const actualAirline = airline === "Other" && customAirline.trim() ? customAirline.trim() : airline;
  // Same reasoning as actualAirline above -- hoisted so the preview and
  // submit paths (and the special-goods/minimum-charge lookups both use)
  // agree on one value instead of each re-deriving it.
  const actualContentType = contentType === "Other" ? customContentType : contentType;

  // Compute auto-price from KG × rate, floored by any matching minimum
  // charge bracket for this airline+route — used to pre-fill the amount
  // field. Derived without setState so there is no extra re-render on every
  // keystroke.
  const autoAmount = useMemo(() => {
    const w = Math.round(parseFloat(kg)) || 0;
    if (w <= 0) return "";
    const rate = resolveRate(actualAirline, route, actualContentType, w);
    const minCharge = resolveMinimumCharge(minimumCharges, actualAirline, route, w);
    if (rate == null && minCharge == null) return "";
    const computed = rate != null ? roundMoney(w * rate) : 0;
    const final = minCharge != null ? Math.max(computed, minCharge) : computed;
    return final.toString();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kg, route, actualContentType, actualAirline, standardRates, hubRouteRates, hubAirlineRouteRates, specialGoodsRates, minimumCharges]);

  // Which of the two overrides (if any) determined autoAmount -- surfaced
  // as a badge near the price preview so staff aren't confused by a number
  // that doesn't match kg × the route rate they're used to seeing.
  const priceOverrideInfo = useMemo(() => {
    const w = Math.round(parseFloat(kg)) || 0;
    if (w <= 0) return null;
    const specialRate = resolveSpecialGoodsRate(specialGoodsRates, actualContentType, actualAirline, w, user.hub_id);
    const minCharge = resolveMinimumCharge(minimumCharges, actualAirline, route, w);
    const perKgAmount = specialRate != null ? roundMoney(w * specialRate) : null;
    if (minCharge != null && (perKgAmount == null || minCharge > perKgAmount)) {
      return { type: 'minimum' as const, amount: minCharge };
    }
    if (specialRate != null) {
      return { type: 'special' as const, rate: specialRate };
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kg, route, actualContentType, actualAirline, specialGoodsRates, minimumCharges]);

  const availableAirlines = useAirlines();

  useEffect(() => {
    if (availableAirlines.length > 0 && !availableAirlines.includes(airline)) {
      setAirline(availableAirlines[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableAirlines]);

  const [successTx, setSuccessTx] = useState<Transaction | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const successRef = useRef<HTMLDivElement>(null);
  const formRootRef = useRef<HTMLDivElement>(null);
  useEnterToNextField(formRootRef);

  useEffect(() => {
    if (successTx && successRef.current) {
      // Scroll the nearest scrollable ancestor, not window — avoids iOS jank
      successRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [successTx]);

  // --- CARGO DESK DAY CLOSE ---
  // A wholly separate close from EODReconciliation.tsx's shared aggregate --
  // that screen assumes a rigid midnight-to-midnight boundary, which breaks
  // for cargo shifts that span overnight (e.g. 10pm-6am). This lets staff
  // pick the actual period being closed (which can cross midnight) instead,
  // persisted via cargo_day_close so the exact boundary is auditable later.
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [closingDay, setClosingDay] = useState(false);
  const [periodStart, setPeriodStart] = useState<string>('');
  const [periodEnd, setPeriodEnd] = useState<string>('');
  const [lastCloseEnd, setLastCloseEnd] = useState<string | null>(null);
  const [closeSummaryLoading, setCloseSummaryLoading] = useState(false);
  const [closeEntries, setCloseEntries] = useState<Array<{
    amount: number; receipt_mode: string; route: string | null; consignee_name: string;
    airline: string | null; awb_tag_number: string | null; total_pcs: number; total_kg: number;
    content_type: string | null; bank: string | null;
  }>>([]);
  const [closeExpenses, setCloseExpenses] = useState<Expense[]>([]);

  // datetime-local <-> Date, local time (no timezone suffix) -- toISOString()
  // would shift the displayed value by the browser's UTC offset.
  const toLocalInputValue = (d: Date) => {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  // Default the range when the modal opens: start picks up from this hub's
  // last close (continuous, non-overlapping periods with no gap), falling
  // back to today-midnight if this hub has never closed a cargo period.
  useEffect(() => {
    if (!showCloseModal) return;
    let active = true;
    (async () => {
      const { data } = await supabase
        .from('cargo_day_close')
        .select('period_end')
        .eq('hub_id', user.hub_id)
        .order('period_end', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!active) return;
      const now = new Date();
      let defaultStart: Date;
      if (data?.period_end) {
        defaultStart = new Date(data.period_end);
      } else {
        defaultStart = new Date();
        defaultStart.setHours(0, 0, 0, 0);
      }
      setLastCloseEnd(data?.period_end || null);
      setPeriodStart(toLocalInputValue(defaultStart));
      setPeriodEnd(toLocalInputValue(now));
    })();
    return () => { active = false; };
  }, [showCloseModal, user.hub_id]);

  // Reload the summary whenever the picked range changes -- datetime-local
  // inputs only fire onChange on commit (not per keystroke), so no debounce
  // is needed here.
  useEffect(() => {
    if (!showCloseModal || !periodStart || !periodEnd) return;
    const startD = new Date(periodStart);
    const endD = new Date(periodEnd);
    if (isNaN(startD.getTime()) || isNaN(endD.getTime())) return;
    let active = true;
    setCloseSummaryLoading(true);
    (async () => {
      const startISO = startD.toISOString();
      const endISO = endD.toISOString();
      const [entriesRes, expRes] = await Promise.all([
        supabase.from('cargo_entries')
          .select('amount,receipt_mode,route,consignee_name,airline,awb_tag_number,total_pcs,total_kg,content_type,bank,created_at')
          .eq('hub_id', user.hub_id)
          .gte('created_at', startISO).lt('created_at', endISO)
          .order('created_at', { ascending: true }).limit(1000),
        supabase.from('expenses')
          .select('*')
          .eq('hub_id', user.hub_id)
          .gte('created_at', startISO).lt('created_at', endISO)
          .limit(1000),
      ]);
      if (!active) return;
      setCloseEntries((entriesRes.data || []) as any);
      setCloseExpenses((expRes.data || []) as Expense[]);
      setCloseSummaryLoading(false);
    })();
    return () => { active = false; };
  }, [showCloseModal, periodStart, periodEnd, user.hub_id]);

  const closeTotalSales = closeEntries.reduce((s, t) => s + t.amount, 0);
  const closeCashSales = closeEntries.reduce((s, t) => s + (t.receipt_mode === 'Cash' ? t.amount : 0), 0);
  const closePosSales = closeEntries.reduce((s, t) => s + (t.receipt_mode === 'POS' ? t.amount : 0), 0);
  const closeTransferSales = closeEntries.reduce((s, t) => s + (t.receipt_mode === 'Transfer' ? t.amount : 0), 0);
  const closeDebtSales = closeEntries.reduce((s, t) => s + (t.receipt_mode === 'Debt' ? t.amount : 0), 0);
  const closeDebtCashRecoveredToday = closeEntries.reduce((sum: number, t: any) => {
    if (!t.payment_history || !Array.isArray(t.payment_history)) return sum;
    const todays = t.payment_history.filter((p: any) => p.mode === 'Cash' && p.at && new Date(p.at) >= new Date(periodStart) && new Date(p.at) <= new Date(periodEnd));
    return sum + todays.reduce((s: number, p: any) => s + (p.amount || 0), 0);
  }, 0);
  const closeDebtTotalRecoveredToday = closeEntries.reduce((sum: number, t: any) => {
    if (!t.payment_history || !Array.isArray(t.payment_history)) return sum;
    const todays = t.payment_history.filter((p: any) => p.at && new Date(p.at) >= new Date(periodStart) && new Date(p.at) <= new Date(periodEnd));
    return sum + todays.reduce((s: number, p: any) => s + (p.amount || 0), 0);
  }, 0);
  const closeTotalExpenses = closeExpenses.reduce((s, e) => s + e.amount, 0);
  const closePhysicalCash = closeCashSales + closeDebtCashRecoveredToday;
  const closeBalanceCash = closePhysicalCash - closeTotalExpenses;
  const closeRouteCounts: Record<string, number> = {};
  closeEntries.forEach(t => { const r = t.route || 'Unknown'; closeRouteCounts[r] = (closeRouteCounts[r] || 0) + 1; });

  const handleCloseDay = async () => {
    if (closingDay) return;
    const startD = new Date(periodStart);
    const endD = new Date(periodEnd);
    if (isNaN(startD.getTime()) || isNaN(endD.getTime())) {
      showToast({ message: 'Please enter valid start and end times.', type: 'warning' });
      return;
    }
    const startISO = startD.toISOString();
    const endISO = endD.toISOString();
    if (endD <= startD) {
      showToast({ message: 'End time must be after start time.', type: 'warning' });
      return;
    }
    const ok = await confirm({
      title: 'Close Cargo Desk period?',
      message: `Close the cargo period from ${startD.toLocaleString('en-GB')} to ${endD.toLocaleString('en-GB')}? This cannot be undone.`,
      confirmLabel: 'Close Period',
      tone: 'danger',
    });
    if (!ok) return;
    setClosingDay(true);
    try {
      const { error } = await supabase.from('cargo_day_close').upsert({
        hub_id: user.hub_id,
        hub: user.hub,
        period_start: startISO,
        period_end: endISO,
        total_sales: closeTotalSales,
        cash_sales: closeCashSales,
        pos_sales: closePosSales,
        transfer_sales: closeTransferSales,
        debt_sales: closeDebtSales,
        total_expenses: closeTotalExpenses,
        balance_cash: closeBalanceCash,
        entry_count: closeEntries.length,
        route_counts: closeRouteCounts,
        closed_by: user.name,
        closed_at: new Date().toISOString(),
      }, { onConflict: 'hub_id,period_end' });
      if (error) throw error;
      showToast({ message: 'Cargo period closed successfully', type: 'success' });
      setShowCloseModal(false);
    } catch (err: any) {
      showToast({ message: 'Failed to close period: ' + err.message, type: 'error' });
    } finally {
      setClosingDay(false);
    }
  };

  // --- B2B CORPORATE PERSISTED STATES ---
  const [corpClients, setCorpClients] = useState<CorporateClient[]>(() => {
    try {
      if (typeof window === "undefined" || !window.localStorage) return [];
      const saved = localStorage.getItem("ehi_corporate_clients_v2");
      if (saved) return JSON.parse(saved);
      return [];
    } catch (e) {
      return [];
    }
  });

  // Real values always come from the corporate_route_rates fetch below --
  // no local seed. A prior placeholder seed here used fake IDs ("corp_1"
  // .."corp_3") that could never match a real client's Postgres UUID, which
  // meant every corporate shipment silently billed at the fallback rate
  // instead of its negotiated one until the fetch below was added.
  const [corpRates, setCorpRates] = useState<CorporateRouteRate[]>([]);

  const [pendingIntakes, setPendingIntakes] = useState<PendingWeighingIntake[]>(
    () => {
      try {
        if (typeof window === "undefined" || !window.localStorage) return [];
        const saved = localStorage.getItem("ehi_pending_intakes_v2");
        if (saved) return JSON.parse(saved);
        return [];
      } catch (e) {
        return [];
      }
    },
  );

  // --- PHASE 1 STATE FIELDS ---
  const [intakeConsignee, setIntakeConsignee] = useState(
    corpClients[0]?.company_name || "Aramex",
  );
  const [intakeAirline, setIntakeAirline] = useState("Arik Air");

  useEffect(() => {
    if (availableAirlines.length > 0) {
      if (!availableAirlines.includes(intakeAirline)) {
        setIntakeAirline(availableAirlines[0]);
      }
    }
  }, [availableAirlines]);

  // Load real corporate clients from Supabase — overrides the local seed when data exists
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        // No 'active' column exists on corporate_clients (nothing in the app
        // exposes a way to deactivate one) -- filtering on it made this
        // query error and silently fall back to an empty/stale list.
        const { data } = await supabase
          .from('corporate_clients')
          .select('id, company_name, contact_phone, accumulated_monthly_debt')
          .order('company_name');
        if (active && data && data.length > 0) {
          const mapped = data.map((c: any) => ({
            id: c.id,
            company_name: c.company_name,
            contact_phone: c.contact_phone || '',
            accumulated_monthly_debt: c.accumulated_monthly_debt ?? 0,
          }));
          setCorpClients(mapped);
        }
      } catch { /* keep local seed if offline */ }
    })();
    return () => { active = false; };
  }, []);

  // Customer Wallets state for detecting prepaid credit balances at point of consignment
  const [internalWallets, setInternalWallets] = useState<CustomerWallet[]>([]);
  const customerWallets = passedWallets && passedWallets.length > 0 ? passedWallets : internalWallets;
  const setCustomerWallets = passedSetWallets || setInternalWallets;

  useEffect(() => {
    if (passedWallets && passedWallets.length > 0) return;
    let active = true;
    (async () => {
      try {
        const { data } = await supabase
          .from('customer_wallets')
          .select('*')
          .gt('balance', 0);
        if (active && data) setInternalWallets(data as CustomerWallet[]);
      } catch { /* keep local if offline */ }
    })();
    return () => { active = false; };
  }, [passedWallets]);

  // Options for the Retail Entry Consignee dropdown -- the real corporate
  // client list from Supabase (kept live-synced above), not a hardcoded
  // roster. "Other" always stays last so staff can type a one-off name for
  // a walk-in customer who isn't a registered corporate client.
  const consigneeOptions = useMemo(
    () => [...corpClients.map((c) => c.company_name), "Other"],
    [corpClients],
  );

  // Office-work detection: when a retail consignee name closely matches a
  // registered corporate/office-work client, we surface a banner so the
  // staff member can link this entry to that account. This addresses the
  // "forgot to go through the Office Work tab" pattern that was causing
  // retail entries to be silently recorded at the wrong (retail) rate.
  // Normalized (trim/upper/collapse-spaces) match against the corporate
  // roster, returning WHICH kind of match it was. Exact matches are safe to
  // auto-apply; fuzzy (prefix) matches are only ever suggested, because
  // auto-billing a coincidental walk-in as a corporate account is worse than
  // asking. Mirrors the DB's normalize_company_name().
  const officeMatch = useMemo(() => {
    const raw = (consignee === 'Other' ? customConsignee : consignee).trim();
    if (raw.length < 3) return { client: null as any, type: null as 'exact' | 'fuzzy' | null };
    const norm = (s: string) => s.trim().toUpperCase().replace(/\s+/g, ' ');
    const q = norm(raw);
    const exact = corpClients.find(c => norm(c.company_name) === q);
    if (exact) return { client: exact, type: 'exact' as const };
    const fuzzy = corpClients.find(c => norm(c.company_name).startsWith(q) || q.startsWith(norm(c.company_name).slice(0, 4)));
    return fuzzy ? { client: fuzzy, type: 'fuzzy' as const } : { client: null as any, type: null };
  }, [consignee, customConsignee, corpClients]);

  const detectedOfficeClient = officeMatch.client;

  const [linkedAsOfficeWork, setLinkedAsOfficeWork] = useState(false);

  const [selectedWalletOverride, setSelectedWalletOverride] = useState<any>(null);
  const [walletRemainderMode, setWalletRemainderMode] = useState<'Cash' | 'Transfer' | 'POS'>('Cash');
  const [walletRemainderBank, setWalletRemainderBank] = useState('');
  // Active Customer Wallet matching the typed consignee name or manual selection --
  // phone first (reliable identity), falling back to exact name match.
  const activeWallet = useMemo(() => {
    if (selectedWalletOverride) return selectedWalletOverride;
    const nm = (consignee === 'Other' ? customConsignee : consignee);
    return matchWallet(customerWallets, nm, consigneePhone);
  }, [consignee, customConsignee, consigneePhone, customerWallets, selectedWalletOverride]);

  // On each consignee change: auto-link when the match is EXACT (the rush-proof
  // path), otherwise clear so a fuzzy match only shows the suggestion banner.
  // A manual unlink afterward stays until the consignee changes again.
  useEffect(() => {
    setLinkedAsOfficeWork(officeMatch.type === 'exact');
  }, [consignee, customConsignee, officeMatch.type]);

  // When the entry is linked as office work, try to find the corporate route
  // rate for the selected route and pre-fill the amount.
  const officeWorkRate = useMemo(() => {
    if (!linkedAsOfficeWork || !detectedOfficeClient) return null;
    const rate = corpRates.find(
      r => r.corporate_client_id === detectedOfficeClient.id && r.route_name === route
    );
    return rate || null;
  }, [linkedAsOfficeWork, detectedOfficeClient, corpRates, route]);

  // Auto-fill the amount from the contract rate whenever this entry is linked
  // as office work and we have a rate + weight. Keyed on a client|route|kg
  // signature so it fills once per change and does NOT fight a manual edit the
  // agent makes afterward (that edit stays until kg/route/client changes).
  const officePricedSigRef = useRef<string>('');
  useEffect(() => {
    if (!linkedAsOfficeWork || !officeWorkRate) return;
    const w = Math.round(parseFloat(kg)) || 0;
    if (w <= 0) return;
    const sig = `${officeWorkRate.corporate_client_id}|${route}|${w}`;
    if (officePricedSigRef.current === sig) return;
    officePricedSigRef.current = sig;
    const computed = Math.max(w * officeWorkRate.rate_per_kg, officeWorkRate.minimum_amount ?? 0);
    setAmount(String(computed));
  }, [linkedAsOfficeWork, officeWorkRate, kg, route]);

  // Load real corporate contract rates from Supabase — this table was
  // NEVER fetched here at all: corpRates only ever came from localStorage
  // or the hardcoded placeholder seed above, whose corporate_client_id
  // values ("corp_1".."corp_3") can never match a real client's Postgres
  // UUID (corpClients above IS fetched correctly). The contractRateRecord
  // lookup in handleFinalizeWeighing therefore never matched for any real
  // corporate account, and every corporate shipment silently billed at the
  // ₦500/kg fallback instead of its negotiated rate -- with no error
  // anywhere, since falling through to the fallback is the normal,
  // expected behavior for a client with no override on file.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data } = await supabase
          .from('corporate_route_rates')
          .select('id, corporate_client_id, route_name, rate_per_kg, minimum_amount');
        if (active && data && data.length > 0) {
          setCorpRates(data as CorporateRouteRate[]);
        }
      } catch { /* keep local seed if offline */ }
    })();
    return () => { active = false; };
  }, []);

  // Load pending Phase 1 gate intakes from Supabase -- this table used to be
  // localStorage-only despite the italic notice below telling staff it
  // "syncs dynamically with our centralized database architecture." It
  // didn't: a shipment received at the gate had zero server record until
  // Phase 2 finished on that same device, so a cleared browser or a
  // different staff member finishing Phase 2 could never see it. Supabase
  // (hub-scoped by RLS) is now the source of truth; localStorage is just
  // the instant-paint / offline fallback while this fetch is in flight.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data } = await supabase
          .from('pending_corporate_intakes')
          .select('id, consignee, corporate_client_id, pieces, route, content_type, airline, awb, sender_phone, created_at')
          .order('created_at', { ascending: false });
        if (active && data) {
          const mapped: PendingWeighingIntake[] = data.map((r: any) => ({
            id: r.id,
            consignee: r.consignee,
            corporate_client_id: r.corporate_client_id || "",
            pieces: r.pieces,
            route: r.route || "",
            contentType: r.content_type || "",
            airline: r.airline || "",
            awb: r.awb,
            created_at: r.created_at,
            sender_phone: r.sender_phone || undefined,
            time: new Date(r.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }),
            isCorporate: true,
          }));
          setPendingIntakes(mapped);
          localStorage.setItem("ehi_pending_intakes_v2", JSON.stringify(mapped));
        }
      } catch { /* keep local cache if offline */ }
    })();
    return () => { active = false; };
  }, []);

  const [intakeAwb, setIntakeAwb] = useState("");
  const fetchIntakeAwbPreview = async () => {
    const hubCode = getHubCode(user.hub_code || user.hub);
    const poolKey = `${hubCode}-CG`;
    const tag = await getNextTag(poolKey, `EHI-${hubCode}-CG`);
    setIntakeAwb(tag || '');
  };
  useEffect(() => { fetchIntakeAwbPreview(); }, [user.hub_code, user.hub]);
  const [intakePcs, setIntakePcs] = useState("1");
  const [intakeRoute, setIntakeRoute] = useState(routes[0]);
  useValidatedRouteSelection(routes, intakeRoute, setIntakeRoute);
  const [intakeContentType, setIntakeContentType] = useState<string>(
    contentTypes[0],
  );
  const [intakeSenderPhone, setIntakeSenderPhone] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  // --- PHASE 2 STATE FIELDS ---
  const [selectedIntake, setSelectedIntake] =
    useState<PendingWeighingIntake | null>(null);
  const [gateWeight, setGateWeight] = useState("");
  const [customRateOverwrite, setCustomRateOverwrite] = useState("");
  const [isWeighingSubmitting, setIsWeighingSubmitting] = useState(false);

  // Negotiated contract rate for the intake currently on the scale, if one
  // exists -- computed once here and reused by the rate display, the
  // computed-bill display, and handleFinalizeWeighing, instead of each
  // re-deriving it independently (previously three separate copies of the
  // same lookup, one of which used a stale rate at submit time relative to
  // what the screen displayed).
  const contractRateForSelectedIntake = useMemo(() => {
    if (!selectedIntake) return null;
    const client = corpClients.find((c) => c.id === selectedIntake.corporate_client_id);
    if (!client) return null;
    return corpRates.find((r) => r.corporate_client_id === client.id && r.route_name === selectedIntake.route) || null;
  }, [selectedIntake, corpClients, corpRates]);

  // --- SYSTEM HELPERS ---
  const isAuthorizedRole =
    user &&
    ["super_admin", "admin", "accountant", "auditor"].includes(user.role);

  const updateLocalCorpClients = (updated: CorporateClient[]) => {
    setCorpClients(updated);
    localStorage.setItem("ehi_corporate_clients_v2", JSON.stringify(updated));
  };

  const updateLocalPendingIntakes = (updated: PendingWeighingIntake[]) => {
    setPendingIntakes(updated);
    localStorage.setItem("ehi_pending_intakes_v2", JSON.stringify(updated));
  };

  // --- ACTION: LOG FIELD INTAKE (Phase 1) ---
  const handleLogFieldIntake = async () => {
    if (!intakeAwb.trim()) {
      showToast({ message: "Please provide the Air Waybill / Tag Number.", type: "warning" });
      return;
    }
    // parseInt(intakePcs) || 1 at the point of use only catches "0" and
    // non-numeric input (both fall back to 1) -- a negative string like
    // "-5" is truthy and parses to -5, flowing straight into the ledger
    // and the per-piece tag-numbering logic without ever being re-checked
    // at Phase 2 finalize.
    const intakePiecesNum = parseInt(intakePcs);
    if (!Number.isInteger(intakePiecesNum) || intakePiecesNum <= 0) {
      showToast({ message: "Enter a valid piece count of 1 or more.", type: "warning" });
      return;
    }

    // Resolve the stable client ID NOW, while corpClients is guaranteed
    // current -- storing company_name alone (a mutable, editable field)
    // meant a client renamed between intake and finalize would silently
    // fail to match later, and there was no durable link for reporting.
    const matchedClient = corpClients.find((c) => c.company_name === intakeConsignee);

    const newIntake: PendingWeighingIntake = {
      id: `CG-INT-${Math.floor(100 + Math.random() * 900)}`,
      consignee: intakeConsignee,
      corporate_client_id: matchedClient?.id || "",
      pieces: intakePiecesNum,
      route: intakeRoute,
      contentType: intakeContentType,
      airline: intakeAirline,
      awb: intakeAwb.toUpperCase().trim(),
      created_at: new Date().toISOString(),
      sender_phone: intakeSenderPhone.trim() || undefined,
      time: tnow(),
      isCorporate: true,
    };

    const updated = [newIntake, ...pendingIntakes];
    updateLocalPendingIntakes(updated);

    // Write through to Supabase so this record survives a cleared browser
    // and is visible to whoever finishes Phase 2, even on a different
    // device -- see the fetch effect above for the full history here.
    // Best-effort: the local write above already gives this device an
    // instant, working copy, so a failed/offline insert doesn't block the
    // gate agent, it just means this specific record won't show up
    // elsewhere until it's retried.
    try {
      const { error } = await supabase.from('pending_corporate_intakes').insert({
        id: newIntake.id,
        consignee: newIntake.consignee,
        corporate_client_id: newIntake.corporate_client_id || null,
        pieces: newIntake.pieces,
        route: newIntake.route,
        content_type: newIntake.contentType,
        airline: newIntake.airline,
        awb: newIntake.awb,
        sender_phone: newIntake.sender_phone || null,
        hub_id: user.hub_id || null,
        hub: user.hub,
        entered_by: user.name,
        created_at: newIntake.created_at,
      });
      if (error) throw error;
    } catch (err) {
      console.error('Failed to sync Phase 1 intake to Supabase (kept locally, will not appear on other devices until retried):', err);
    }

    // Clear and Toast
    fetchIntakeAwbPreview();
    setIntakePcs("1");
    setIntakeSenderPhone("");
    setSuccessMessage(
      `Phase 1 Pick-up saved for ${newIntake.consignee}. Cargo registered at Gate.`,
    );
    setTimeout(() => setSuccessMessage(""), 4000);
  };

  // --- ACTION: FINALIZE SCALE WEIGHING (Phase 2) ---
  const handleFinalizeWeighing = async () => {
    if (!selectedIntake || !gateWeight) return;
    setIsWeighingSubmitting(true);

    const weightNum = Math.round(parseFloat(gateWeight)) || 0;
    if (weightNum <= 0) {
      showToast({ message: "Please enter a valid verified weight in KG.", type: "warning" });
      setIsWeighingSubmitting(false);
      return;
    }

    if (customRateOverwrite) {
      const overwriteNum = parseFloat(customRateOverwrite);
      if (isNaN(overwriteNum) || overwriteNum <= 0) {
        showToast({ message: "Custom rate must be a positive number greater than zero.", type: "warning" });
        setIsWeighingSubmitting(false);
        return;
      }
    }

    // No contract rate on file and no admin override typed -- previously
    // this silently billed at a hardcoded ₦500/KG baseline with no warning
    // anywhere, indistinguishable from an intentional ₦500 rate. Block and
    // require an explicit override instead of guessing a number that could
    // be wildly wrong for this client/route.
    if (!customRateOverwrite && !contractRateForSelectedIntake) {
      showToast({ message: "No negotiated rate on file for this client/route. Enter an admin rate overwrite before finalizing.", type: "warning" });
      setIsWeighingSubmitting(false);
      return;
    }

    const rateToUse = customRateOverwrite
      ? parseFloat(customRateOverwrite)
      : contractRateForSelectedIntake!.rate_per_kg;

    let computedCost = roundMoney(weightNum * rateToUse);
    if (!customRateOverwrite && contractRateForSelectedIntake && contractRateForSelectedIntake.minimum_amount) {
      const minAmount = Number(contractRateForSelectedIntake.minimum_amount);
      if (minAmount > 0 && computedCost < minAmount) {
        computedCost = minAmount;
      }
    }

    const gateHubCode = getHubCode(user.hub_code || user.hub);
    const gateResolvedId = await getNextTag(`${gateHubCode}-CG`, `EHI-${gateHubCode}-CG`);
    if (!gateResolvedId) {
      showToast({ message: "No tag number available offline. Connect to the internet briefly to reserve more, then try again.", type: "error" });
      setIsWeighingSubmitting(false);
      return;
    }

    // Lock in the commission rate at entry time (see retail submit path for why).
    let gateWeighCommissionRate = 0;
    try {
      const rawCommissions = localStorage.getItem("ehi_airline_commissions");
      if (rawCommissions && selectedIntake.airline) {
        const parsed = JSON.parse(rawCommissions) as Record<string, number>;
        gateWeighCommissionRate = parsed[normalizeAirlineName(selectedIntake.airline)] ?? parsed[selectedIntake.airline] ?? 0;
      }
    } catch (e) {
      // Ignore -- gateWeighCommissionRate stays 0
    }

    // Build central ledger transaction record (Debt contract)
    const finalTxDetail = `${selectedIntake.airline} · ${gateResolvedId} · ${selectedIntake.pieces || 1}pcs · ${weightNum}kg · ${selectedIntake.route} · ${selectedIntake.contentType || selectedIntake.content_type || 'General Goods'}`;

    // Block reusing a physical AWB whose previous consignment already
    // completed delivery -- the same check the retail flow already has.
    // This was missing here entirely: a duplicated physical tag lets two
    // shipments share one tracking history, a common consign-fraud
    // pattern, and corporate gate-weighing had no protection against it.
    // Skipped offline -- see the retail submit path's identical comment.
    if (navigator.onLine && await isTagAlreadyDelivered(selectedIntake.awb)) {
      showToast({
        message: `${selectedIntake.awb} was already delivered on a previous consignment. This tag cannot be reused -- verify the physical AWB before finalizing.`,
        type: "error",
      });
      setIsWeighingSubmitting(false);
      return;
    }

    const txEntry: Transaction = {
      id: gateResolvedId,
      name: selectedIntake.consignee,
      corporate_client_id: selectedIntake.corporate_client_id || undefined,
      // B2B monthly-billed client -- distinct from the retail path above,
      // which sets 'Individual'. This is what accumulates into
      // accumulated_monthly_debt below, not a per-shipment individual debt.
      clientType: "Corporate",
      detail: finalTxDetail,
      amount: computedCost,
      mode: corporateMode,
      remarks: `Gate Weight Finalized (${rateToUse} ₦/KG Contract). Ref Intake ID: ${selectedIntake.id}`,
      time: tnow(),
      type: "cargo",
      status: "Intake",
      awb_tag_number: gateResolvedId,
      airline: selectedIntake.airline,
      commissionRate: gateWeighCommissionRate,
      pieces: selectedIntake.pieces,
      kg: weightNum,
      route: selectedIntake.route,
      contentType: selectedIntake.contentType || selectedIntake.content_type || 'General Goods',
      enteredByName: user.name,
    };

    // 1. Add to central transactions grid
    onAddTx(txEntry);

    // 2. Increment client's monthly accumulated debt balance (only if Debt)
    if (corporateMode === "Debt") {
      const matchingClientObj = corpClients.find((c) => c.id === selectedIntake.corporate_client_id);
      if (matchingClientObj) {
        try {
          const { data: newDebtTotal, error: debtUpdateError } = await supabase.rpc(
            'increment_corporate_debt',
            { p_client_id: matchingClientObj.id, p_amount: computedCost },
          );
          if (debtUpdateError) throw debtUpdateError;
          const updatedClients = corpClients.map((c) =>
            c.id === matchingClientObj.id ? { ...c, accumulated_monthly_debt: newDebtTotal } : c,
          );
          updateLocalCorpClients(updatedClients);
        } catch (err: any) {
          console.error('Failed to persist corporate client debt to Supabase', err);
          showToast({ message: `Transaction saved, but ${matchingClientObj.company_name}'s debt balance failed to update on the server: ${err.message || 'unknown error'}. Reconcile manually.`, type: 'error' });
        }
      }
    }

    // 3. Remove from pending intakes queue
    const filteredPending = pendingIntakes.filter(
      (pi) => pi.id !== selectedIntake.id,
    );
    updateLocalPendingIntakes(filteredPending);
    try {
      await supabase.from('pending_corporate_intakes').delete().eq('id', selectedIntake.id);
    } catch (err) {
      console.error('Failed to remove finalized intake from Supabase (still cleared locally):', err);
    }

    // 4. Trigger printer receipt model & clear states
    setSuccessTx(txEntry);
    
    // Send Whatsapp Receipt for Corporate Debt Client
    if (selectedIntake.sender_phone) {
      sendReceiptWhatsApp({
        phone: selectedIntake.sender_phone,
        ref: txEntry.id,
        message: buildCargoWhatsApp({
          ref: txEntry.id,
          consignee: selectedIntake.consignee,
          awb: selectedIntake.awb,
          route: selectedIntake.route,
          kg: weightNum,
          pcs: selectedIntake.pieces,
          amount: computedCost,
          mode: corporateMode,
        }),
      });
    }

    setSelectedIntake(null);
    setGateWeight("");
    setCustomRateOverwrite("");
    setIsWeighingSubmitting(false);
  };

  // --- RETAIL BILLING SUBMIT ---
  const actualConsignee = consignee === "Other" ? customConsignee : consignee;
  const w = Math.round(parseFloat(kg)) || 0;
  const rate = resolveRate(actualAirline, route, actualContentType, w);
  const minCharge = resolveMinimumCharge(minimumCharges, actualAirline, route, w);
  // null rate/minCharge = nothing configured at any tier (special-goods,
  // hub+airline+route, hub default, company-wide, or a minimum-charge
  // bracket) -- minAmount of 0 here is not "free," it's "no computed
  // floor," and isRetailFormValid below only enforces the >= minAmount
  // check when a real rate or minimum charge was found. When both exist,
  // the minimum charge floors the per-kg computed amount (see autoAmount
  // above, which this mirrors).
  const perKgAmount = rate != null ? roundMoney(w * rate) : null;
  const minAmount = minCharge != null ? Math.max(perKgAmount ?? 0, minCharge) : (perKgAmount ?? 0);
  // Use manual amount if typed, else fall back to auto-computed price
  const effectiveAmount = amount || autoAmount;
  const parsedAmount = parseFloat(effectiveAmount) || 0;

  // w>0 and a positive integer pieces count are both required -- previously
  // neither was checked directly: an empty/zero kg just made minAmount
  // compute to 0, so any manually-typed amount>0 alone passed, and pieces
  // had no validation at all (parseInt(pcs)||1 at submit only catches "0",
  // not a negative string like "-5", which is truthy and would flow
  // straight into the ledger and the per-piece tag-numbering logic).
  const piecesNum = parseInt(pcs);
  const isRetailFormValid = useMemo(
    () =>
      actualConsignee.trim().length > 0 &&
      route.trim().length > 0 &&
      actualContentType.trim().length > 0 &&
      w > 0 &&
      Number.isInteger(piecesNum) && piecesNum > 0 &&
      (rate == null && minCharge == null ? parsedAmount > 0 : parsedAmount >= minAmount && parsedAmount > 0),
    [actualConsignee, route, actualContentType, w, piecesNum, parsedAmount, minAmount, rate, minCharge],
  );

  const handleRetailSubmit = async () => {
    if (!isRetailFormValid || submitting) return;
    setSubmitting(true);

    // New custom airline typed into "Other" -- add it to pricing_config
    // (visible to Airline Commissions, Hub Cargo Rates, Airline Ledger,
    // Marketing Workspace next time each of those fetches) with a default
    // 5% commission. It won't appear in this screen's own dropdown until
    // its next fetch/remount, same as any other config screen.
    if (airline === "Other" && actualAirline && !availableAirlines.includes(actualAirline)) {
      try {
        await addAirlineIfMissing(actualAirline);
      } catch (e) {
        // Ignore
      }
    }

    const pickupPin = generatePickupPin();

    // Lock in the commission rate at entry time so a later change to
    // pricing_config can't silently rewrite historical airline payables.
    let commissionRate = 0;
    try {
      const rawCommissions = localStorage.getItem("ehi_airline_commissions");
      if (rawCommissions) {
        const parsed = JSON.parse(rawCommissions) as Record<string, number>;
        commissionRate = parsed[normalizeAirlineName(actualAirline)] ?? parsed[actualAirline] ?? 0;
      }
    } catch (e) {
      // Ignore -- commissionRate stays 0
    }

    // AWB is EHI-{HUBCODE}-{6-digit per-hub sequence}, e.g. EHI-LOS-001042.
    // The number was already allocated on mount/reset (see fetchAwbPreview
    // above) from the local tag pool -- popped from a block reserved via
    // the atomic reserve_awb_block()/next_awb_number() counter, so it's
    // already guaranteed unique whether or not this device is online right
    // now. Only re-attempt allocation here if that earlier pop somehow
    // came back empty (pool + connectivity both unavailable at mount time).
    const hubCode = getHubCode(user.hub_code || user.hub);
    let resolvedAwb = awb;
    if (!resolvedAwb) {
      resolvedAwb = await getNextTag(`${hubCode}-CG`, `EHI-${hubCode}-CG`);
    }

    // Block reusing a tag whose previous consignment already completed
    // delivery -- a duplicated physical tag makes two shipments share one
    // tracking history and is a common consign-fraud pattern. Skipped
    // offline: this AWB just came from the atomic pool/counter, so it
    // cannot possibly have a prior DELIVER event -- the check would only
    // ever fail on the network call itself while offline.
    if (navigator.onLine && await isTagAlreadyDelivered(resolvedAwb)) {
      showToast({
        message: `${resolvedAwb} was already delivered on a previous consignment. This tag cannot be reused -- generate a new one.`,
        type: "error",
      });
      setSubmitting(false);
      return;
    }

    const nextSerial = incrementLocalSerial();
    setSerialNumber(nextSerial);

    const summaryStr = `${actualAirline} · ${resolvedAwb} · ${pcs}pcs · ${kg}KG · ${route} · ${actualContentType}`;

    const tx: Transaction = {
      id: resolvedAwb,
      name: actualConsignee,
      detail: summaryStr,
      amount: parsedAmount,
      mode,
      bank: mode === "Transfer" || mode === "POS" ? bank : undefined,
      paymentNarration: mode === "Transfer" ? narrationCode : undefined,
      remarks: remark.trim(),
      time: tnow(),
      type: "cargo",
      status: "Intake",
      awb_tag_number: resolvedAwb,
      airline: actualAirline,
      commissionRate,
      pieces: parseInt(pcs) || 1,
      kg: Math.round(parseFloat(kg)) || 0,
      pickupPin,
      consigneePhone: consigneePhone.trim(),
      // Office-work linking: when staff confirm this retail entry belongs to
      // a corporate/office client, flag it so the ledger shows OFFICE WORK
      // badge and the EOD/accountant can correctly attribute it.
      linked_as_office_work: linkedAsOfficeWork || undefined,
      corporate_client_id: linkedAsOfficeWork && detectedOfficeClient ? detectedOfficeClient.id : undefined,
      applied_rate_per_kg: linkedAsOfficeWork && officeWorkRate ? officeWorkRate.rate_per_kg : undefined,
      // Retail walk-in sale -- distinct from the B2B corporate path below,
      // which sets 'Corporate' instead.
      clientType: linkedAsOfficeWork ? "Corporate" : "Individual",
      enteredByName: user.name,
    } as Transaction;

    // Wallet payment — AUTO-SPLIT. Wallet covers what it can; any remainder is
    // collected by the chosen Cash/Transfer/POS method and recorded as the
    // receipt_mode, so the till isn't silently short. EOD nets
    // wallet_deduction_amount out of the cash/transfer/POS totals.
    if (mode === "Wallet" && activeWallet) {
      const charge = await chargeWalletForSale({
        wallet: activeWallet,
        amount: parsedAmount,
        cargoRef: resolvedAwb,
        description: `Cargo Consignment ${resolvedAwb}`,
        loggedBy: user.name,
      });
      if (!charge.ok) {
        showToast({ message: `Wallet deduction failed: ${charge.error}. Entry was not logged.`, type: "error" });
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
        // Book the sale under the remainder method; wallet part stays tracked
        // in wallet_deduction_amount.
        tx.mode = walletRemainderMode;
        tx.bank = (walletRemainderMode === 'Transfer' || walletRemainderMode === 'POS') ? walletRemainderBank.trim() : undefined;
      }
      setCustomerWallets(prev => prev.map(w => w.id === activeWallet.id ? { ...w, balance: charge.newBalance! } : w));
      showToast({
        message: charge.remainder > 0
          ? `₦${fmt(charge.walletDeduction)} from ${activeWallet.customer_name}'s wallet · ₦${fmt(charge.remainder)} by ${walletRemainderMode}. Balance: ₦${fmt(charge.newBalance!)}`
          : `👜 ₦${fmt(charge.walletDeduction)} from ${activeWallet.customer_name}'s wallet. Remaining: ₦${fmt(charge.newBalance!)}`,
        type: "success",
      });
    }

    onAddTx(tx);
    setSuccessTx(tx);
    setSubmitting(false);

    // Call PIN notification API. /api/notify/* requires an authenticated
    // caller (server/app.ts's requireAuthenticatedUser) -- without this
    // header the call 401s unconditionally regardless of session validity,
    // silently dropping every pickup-PIN notification.
    supabase.auth.getSession().then(({ data: sess }) => {
      const token = sess.session?.access_token || '';
      fetch("/api/notify/pickup-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({
          senderPhone: senderPhone.trim(),
          consigneePhone: consigneePhone.trim(),
          pin: pickupPin,
          entryRef: tx.id,
          route,
        }),
      }).catch((e) => console.error("Failed to notify pin:", e));
    });

    if (senderPhone.trim().length > 0) {
      sendReceiptWhatsApp({
        phone: senderPhone.trim(),
        ref: tx.id,
        message: buildCargoWhatsApp({
          ref: tx.id,
          consignee: actualConsignee,
          awb: resolvedAwb,
          route,
          kg,
          pcs,
          amount: parsedAmount,
          mode,
          bank: mode === "Transfer" || mode === "POS" ? bank : undefined,
          paymentNarration: mode === "Transfer" ? narrationCode : undefined,
          pin: pickupPin,
        }),
      });
    }
  };

  const handleReset = () => {
    setConsignee("");
    setCustomConsignee("");
    setAirline(availableAirlines[0] || "Other");
    setCustomAirline("");
    fetchAwbPreview();
    setPcs("1");
    setKg("");
    setRoute(routes[0]);
    setContentType(contentTypes[0] as string);
    setCustomContentType("");
    setAmount("");
    setMode("Cash");
    setBank(banks[0] as string);
    setRemark("");
    setSenderPhone("");
    setConsigneePhone("");
    setSuccessTx(null);
  };

  const handlePrintReceipt = async () => {
    if (successTx) {
      const { printCargoReceipt } = await import("./CargoReceipt");
      const printData = {
        entryRef: successTx.id,
        serialNumber: serialNumber - 1,
        date: `${new Date().toLocaleDateString("en-GB")} ${tnow()}`,
        hubName: user?.hub || "EHI Cargo Station",
        agentName: user?.name || "EHI Agent",
        airline: (() => {
          const txAir = successTx.airline || airline;
          return txAir === "Green Africa"
            ? "Green Africa Airways"
            : txAir === "United Nigeria"
              ? "United Nigeria Airlines"
              : txAir;
        })(),
        consignee: successTx.name,
        awbTagNumber: successTx.awb_tag_number || awb,
        pieces: successTx.pieces || parseInt(pcs),
        kg: successTx.kg || Math.round(parseFloat(kg)),
        route: successTx.detail.split(" · ")[4] || route,
        contentType: successTx.detail.split(" · ")[5] || contentType,
        amount: successTx.amount,
        paymentMode: successTx.mode,
        paymentNarration: successTx.paymentNarration,
        bankName: successTx.bank || undefined,
        remark: successTx.remarks || undefined,
        pickupPin: (successTx as any).pickupPin || undefined,
      };
      printCargoReceipt(printData);
    }
  };

  const handlePrintTagPDF100mm = async () => {
    if (successTx) {
      // Open the tab synchronously, in direct response to the click --
      // window.open() called after the awaits below (dynamic import, QR
      // generation, PDF rendering) loses the user-gesture context that
      // mobile browsers require, and gets silently blocked. Skipped
      // entirely in an installed/standalone PWA though: window.open()
      // there hands off to a separate browser process immediately (see
      // isStandalonePWA's comment in helpers.ts) -- that hand-off IS the
      // "jumps out to the browser" bug, and closing the window afterward
      // once openPdfOrDownload detects standalone mode doesn't undo it.
      // openPdfOrDownload does a same-document forced download instead
      // whenever isStandalonePWA() is true, regardless of what's passed
      // here, so passing null is safe.
      const preOpenedWindow = isStandalonePWA() ? null : window.open('', '_blank');
      // The tab above opens blank and only gets filled in once the PDF
      // finishes generating below, so there's otherwise no visible sign
      // anything is happening in the meantime -- unlike handlePrintReceipt,
      // which opens the tab already pointed at the finished blob.
      showToast({ message: 'Generating tag PDF…', type: 'info' });
      try {
        const { printCargoTagPDF } = await import("./CargoTagPDF");
        await printCargoTagPDF({
          id: successTx.awb_tag_number || awb,
          name: successTx.name,
          route: successTx.detail.split(" · ")[4] || route,
          pieces: successTx.pieces || parseInt(pcs) || 1,
          weight: successTx.kg || Math.round(parseFloat(kg)),
          airline: (() => {
            const txAir = successTx.airline || airline;
            return txAir === "Green Africa"
              ? "Green Africa Airways"
              : txAir === "United Nigeria"
                ? "United Nigeria Airlines"
                : txAir;
          })(),
          hubName: user?.hub || "EHI Cargo Station",
          date: `${new Date().toLocaleDateString("en-GB")} ${tnow()}`,
          contentType: successTx.detail?.split(" · ")[5] || contentType,
        }, preOpenedWindow);
      } catch (err) {
        console.error('Failed to open tag PDF', err);
        preOpenedWindow?.close();
        showToast({ message: 'Failed to open tag PDF', type: 'error' });
        return;
      }

      try {
        await supabase.from('tag_print_log').insert({
          cargo_ref: successTx.id,
          awb_tag_number: successTx.awb_tag_number || awb,
          printed_by: user.id,
          printed_by_name: user.name,
          hub_id: user.hub_id,
          hub_name: user.hub || 'Unknown',
          print_method: 'pdf',
          pieces_printed: successTx.pieces || parseInt(pcs) || 1,
        });
      } catch (err) {
        console.error('Failed to log tag print', err);
      }
    }
  };

  const formInputClass =
    "w-full h-12 px-4 text-[16px] rounded-[var(--radius-sm)] bg-[var(--color-input-bg)] text-[var(--color-input-text)] border border-[var(--color-border)] font-sans focus:outline-none focus:border-[var(--color-accent-amber)] focus:ring-2 focus:ring-[var(--glow-amber)] transition-all";

  const renderLabel = (icon: any, text: string) => {
    const Icon = icon;
    return (
      <div className="flex items-center space-x-1.5 mb-1.5">
        <Icon size={14} style={{ color: "var(--color-light-muted)" }} />
        <label className="text-[13px] font-sans font-semibold text-[var(--color-light-muted)]">
          {text}
        </label>
      </div>
    );
  };

  // --- SUB-PANEL: COMPLETED RECEIPT SCREEN ---
  if (successTx) {
    const printData = {
      entryRef: successTx.id,
      serialNumber: serialNumber - 1,
      date: `${new Date().toLocaleDateString("en-GB")} ${tnow()}`,
      hubName: user?.hub || "EHI Cargo Station",
      agentName: user?.name || "EHI Agent",
      airline: (() => {
        const txAir = successTx.airline || airline;
        return txAir === "Green Africa"
          ? "Green Africa Airways"
          : txAir === "United Nigeria"
            ? "United Nigeria Airlines"
            : txAir;
      })(),
      consignee: successTx.name,
      awbTagNumber: successTx.awb_tag_number || awb,
      pieces: successTx.pieces || parseInt(pcs),
      kg: successTx.kg || Math.round(parseFloat(kg)),
      route: successTx.detail.split(" · ")[4] || route,
      contentType: successTx.detail.split(" · ")[5] || contentType,
      amount: successTx.amount,
      paymentMode: successTx.mode,
      paymentNarration: successTx.paymentNarration,
      bankName: successTx.bank || undefined,
      remark: successTx.remarks || undefined,
      pickupPin: (successTx as any).pickupPin || undefined,
    };

    return (
      <div ref={successRef} className="p-4 space-y-4 max-w-xl mx-auto w-full">
        <div className="border-b border-[var(--color-border)] pb-2 mb-2">
          <span className="text-[14px] font-sans font-semibold text-[var(--color-foreground)]">
            Cargo Receipt Portal
          </span>
        </div>

        <div className="bg-[rgba(16,185,129,0.05)] border border-[var(--color-success)] rounded-[var(--radius-md)] text-center p-8 flex flex-col items-center">
          <CheckCircle
            size={40}
            className="text-[var(--color-success)] mb-3"
          />
          <div className="text-[15px] font-semibold font-sans text-[var(--color-success)] mb-1">
            {successTx.mode === "Debt"
              ? successTx.clientType === "Office Work"
                ? "Office Work Invoice Saved!"
                : "Credit Sale Logged!"
              : "Cargo entry saved successfully!"}
          </div>
          <div className="text-[12px] font-mono text-[var(--color-muted)] mb-6">
            REF: {successTx.id}
          </div>

          <div className="w-full bg-[var(--color-surface-card)] rounded-[var(--radius-md)] p-4 mb-8 border border-[var(--color-border)] text-left space-y-3 shadow-md">
            <div className="flex justify-center mb-4 p-4 bg-white rounded">
              <QRCode id={successTx.id} size={150} />
            </div>

            {/* PICKUP PIN SECTION */}
            {(successTx as any).pickupPin && (
              <div className="my-6 border border-[var(--color-accent-amber)] rounded-[var(--radius-md)] bg-[rgba(245,158,11,0.05)] overflow-hidden">
                <div className="bg-[rgba(245,158,11,0.1)] px-4 py-2 border-b border-[var(--color-accent-amber)] flex justify-between items-center">
                  <span className="text-[12px] font-bold text-[var(--color-accent-amber)] uppercase tracking-wider">
                    Pickup PIN
                  </span>
                  <button
                    onClick={() =>
                      navigator.clipboard.writeText(
                        (successTx as any).pickupPin,
                      )
                    }
                    className="text-[var(--color-accent-amber)] hover:text-[var(--color-foreground)] transition-colors"
                    title="Copy PIN"
                    aria-label="Copy PIN"
                  >
                    <Copy size={14} />
                  </button>
                </div>
                <div className="p-4 text-center">
                  <div className="text-[32px] font-mono font-bold text-[var(--color-foreground)] tracking-[0.5em] ml-[0.25em]">
                    {(successTx as any).pickupPin}
                  </div>
                  <p className="text-[11px] text-[var(--color-muted)] mt-2 font-sans leading-snug max-w-[250px] mx-auto">
                    Share this PIN with the consignee. They must present it at
                    the destination hub to collect the cargo.
                  </p>
                </div>
              </div>
            )}

            <div className="flex justify-between border-b border-[var(--color-border)] pb-2">
              <span className="text-[13px] font-sans text-[var(--color-muted)]">
                Consignee
              </span>
              <span className="text-[14px] font-sans font-medium text-[var(--color-foreground)]">
                {successTx.name}
              </span>
            </div>

            {/* WALLET DEBITED SUMMARY BOX */}
            {successTx.wallet_deduction_amount && (
              <div className="p-3 bg-[rgba(245,158,11,0.08)] border border-[var(--color-accent-amber)] rounded-lg text-left space-y-1.5 my-3 animate-in zoom-in-95">
                <div className="text-[11px] font-mono font-bold text-[var(--color-accent-amber)] flex items-center justify-between">
                  <span>💰 CREDIT WALLET DEBITED</span>
                  <span className="bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] px-1.5 py-0.5 rounded text-[10px] uppercase font-bold">SUCCESS</span>
                </div>
                <div className="flex justify-between text-[12px] font-mono text-[var(--color-foreground)]">
                  <span>Amount Deducted:</span>
                  <span className="font-bold text-[var(--color-error)]">-₦{fmt(successTx.wallet_deduction_amount)}</span>
                </div>
                {(successTx as any).wallet_balance_after != null && (
                  <div className="flex justify-between text-[12px] font-mono border-t border-[rgba(245,158,11,0.2)] pt-1.5 font-bold">
                    <span className="text-[var(--color-muted)]">Remaining Credit Balance:</span>
                    <span className="text-[var(--color-success)] text-[13px]">₦{fmt((successTx as any).wallet_balance_after)}</span>
                  </div>
                )}
              </div>
            )}
            <div className="flex justify-between border-b border-[var(--color-border)] pb-2">
              <span className="text-[13px] font-sans text-[var(--color-muted)]">
                AWB / Tag No
              </span>
              <span className="text-[14px] font-sans font-semibold text-[var(--color-accent-amber)]">
                {successTx.awb_tag_number}
              </span>
            </div>
            <div className="flex justify-between border-b border-[var(--color-border)] pb-2">
              <span className="text-[13px] font-sans text-[var(--color-muted)]">
                Weight / Route
              </span>
              <span className="text-[14px] font-sans font-medium text-[var(--color-foreground)]">
                {successTx.kg} KG — {successTx.detail.split(" · ")[4]}
              </span>
            </div>
            <div className="flex justify-between border-b border-[var(--color-border)] pb-2">
              <span className="text-[13px] font-sans text-[var(--color-muted)]">
                Content
              </span>
              <span className="text-[14px] font-sans font-medium text-[var(--color-foreground)]">
                {successTx.detail.split(" · ")[5] || "Package"}
              </span>
            </div>
            <div className="flex justify-between border-b border-[var(--color-border)] pb-2">
              <span className="text-[13px] font-sans text-[var(--color-muted)]">
                Amount Charged
              </span>
              <span className="text-[16px] font-extrabold font-mono text-[var(--color-accent-amber)]">
                {fmt(successTx.amount)}
              </span>
            </div>
            <div className="flex justify-between pt-1">
              <span className="text-[13px] font-sans text-[var(--color-muted)]">
                Payment billing
              </span>
              <span
                className={`text-[13px] font-sans font-bold px-2 py-0.5 rounded ${successTx.mode === "Debt" ? "bg-[rgba(239,68,68,0.1)] text-[var(--color-error)]" : "bg-[rgba(16,185,129,0.1)] text-[var(--color-success)]"}`}
              >
                {successTx.mode === "Debt"
                  ? successTx.clientType === "Office Work"
                    ? "B2B MONTHLY DEBT"
                    : "INDIVIDUAL DEBT"
                  : successTx.mode}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 mb-3">
            <button
              onClick={handlePrintReceipt}
              className="py-3.5 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)] text-[var(--color-foreground)] text-[12px] font-sans font-semibold rounded-[var(--radius-sm)] border border-[var(--color-border)] transition-colors cursor-pointer focus:outline-none flex items-center justify-center gap-1.5"
            >
              PDF Receipt
            </button>
          </div>

          <div className="grid grid-cols-1 gap-3 mb-3">
            <button
              onClick={handlePrintTagPDF100mm}
              className="py-3.5 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)] text-[var(--color-foreground)] text-[12px] font-sans font-semibold rounded-[var(--radius-sm)] border border-[var(--color-border)] transition-colors cursor-pointer focus:outline-none"
              title="Fixed 100mm x 80mm label -- for the XP-402B and similar gap/die-cut label printers"
            >
              Tag PDF (100×80mm Label)
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-3">
            <button
              onClick={() => {
                import('../../lib/escpos').then(async ({ printViaBluetooth }) => {
                  await printViaBluetooth(async () => {
                    const m = await import('../../lib/escposCargoReceiptPrinting');
                    const thermalPrintData = {
                      ...printData,
                      trackingUrl: `https://app.ehimultisystems.com/track/${successTx.id}`,
                    };
                    return await m.compileCargoReceiptStream(thermalPrintData, '80mm');
                  });
                }).catch((err: any) => {
                  console.error('Bluetooth print failed:', err);
                  showToast({ message: err?.message || 'Bluetooth print failed. Ensure the printer is paired and powered on.', type: 'error' });
                });
              }}
              className="py-2.5 bg-[var(--color-accent-amber)] hover:bg-opacity-95 text-[#0D1117] text-[12px] font-bold font-sans rounded-[var(--radius-sm)] shadow-[var(--shadow-button)] transition-opacity cursor-pointer focus:outline-none border-none flex flex-col items-center justify-center leading-tight"
            >
              <Bluetooth size={14} className="mb-0.5" />
              <span>POS Print (80mm)</span>
            </button>
            <button
              onClick={() => {
                import('../../lib/escpos').then(async ({ printViaBluetooth }) => {
                  await printViaBluetooth(async () => {
                    const m = await import('../../lib/escposCargoReceiptPrinting');
                    const thermalPrintData = {
                      ...printData,
                      trackingUrl: `https://app.ehimultisystems.com/track/${successTx.id}`,
                    };
                    return await m.compileCargoReceiptStream(thermalPrintData, '58mm');
                  });
                }).catch((err: any) => {
                  console.error('Bluetooth print failed:', err);
                  showToast({ message: err?.message || 'Bluetooth print failed. Ensure the printer is paired and powered on.', type: 'error' });
                });
              }}
              className="py-2.5 bg-[var(--color-accent-amber)] hover:bg-opacity-85 text-[#0D1117] text-[12px] font-bold font-sans rounded-[var(--radius-sm)] shadow-[var(--shadow-button)] transition-opacity cursor-pointer focus:outline-none border-none flex flex-col items-center justify-center leading-tight"
            >
              <Bluetooth size={14} className="mb-0.5" />
              <span>POS Print (58mm)</span>
            </button>
          </div>

          <button
            onClick={handleReset}
            className="w-full py-3.5 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)] text-[var(--color-foreground)] text-[14px] font-sans font-semibold rounded-[var(--radius-sm)] border border-[var(--color-border)] transition-colors cursor-pointer focus:outline-none"
          >
            New Entry
          </button>

        </div>
      </div>
    );
  }

  return (
    <div
      ref={formRootRef}
      className="pb-24"
      style={{ width: "100%", boxSizing: "border-box", transform: 'translateZ(0)', WebkitTransform: 'translateZ(0)' }}
    >
      {/* SECTION SELECTOR / HUB MODE NAVIGATION */}
      <div className="px-4 pt-4">

      {isAdmin && (
        <div className="mb-4 p-3 bg-[var(--color-surface-2)] rounded-lg border border-[var(--color-accent-amber)] border-opacity-30 animate-in fade-in">
           <label className="text-[10px] uppercase font-bold text-[var(--color-accent-amber)] mb-1 block flex items-center gap-1">
             <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
             Admin: Global Hub Context
           </label>
           <select value={adminSelectedHub} onChange={(e) => setAdminSelectedHub(e.target.value)} className="w-full bg-[var(--color-obsidian)] text-[var(--color-foreground)] font-bold text-[13px] p-2 rounded border border-[var(--color-border)] focus:border-[var(--color-accent-amber)] focus:outline-none cursor-pointer">
             {CARGO_ROUTES.map(route => <option key={route} value={route}>{route}</option>)}
           </select>
        </div>
      )}

      <div className="flex items-center justify-end mb-3">
        <button
          onClick={() => setShowCloseModal(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--color-surface-2)] border border-[var(--color-border-strong)] rounded-lg text-[11px] font-mono font-semibold text-[var(--color-foreground)] hover:bg-[var(--color-surface-3)] hover:border-[var(--color-accent-amber)] hover:text-[var(--color-accent-amber)] transition-colors shadow-[var(--shadow-xs)]"
        >
          <Lock size={14} /> <span>CLOSE CARGO PERIOD</span>
        </button>
      </div>
      <div className="flex bg-[var(--color-obsidian)] rounded-lg p-1 border border-[var(--color-border)] mb-6 max-w-lg mx-auto">
        <button
          onClick={() => setActivePortal("retail")}
          className={`flex-1 flex items-center justify-center gap-2 py-3 text-[14px] font-sans font-bold rounded-md transition-all cursor-pointer ${
            activePortal === "retail"
              ? "bg-[var(--color-accent-amber)] text-[#030712] shadow-md"
              : "text-[var(--color-light-muted)] hover:text-[var(--color-foreground)]"
          }`}
        >
          <Package size={16} /> Retail Cargo Entry
        </button>
        <button
          onClick={() => setActivePortal("corporate")}
          className={`flex-1 flex items-center justify-center gap-2 py-3 text-[14px] font-sans font-bold rounded-md transition-all cursor-pointer relative ${
            activePortal === "corporate"
              ? "bg-[var(--color-accent-amber)] text-[#030712] shadow-md"
              : "text-[var(--color-light-muted)] hover:text-[var(--color-foreground)]"
          }`}
        >
          <Users size={16} /> Office Work (B2B)
          {pendingIntakes.length > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-600 text-white font-mono text-[10px] w-5 h-5 rounded-full flex items-center justify-center border-2 border-[var(--color-obsidian)] font-bold">
              {pendingIntakes.length}
            </span>
          )}
        </button>
      </div>
      </div>{/* end px-4 pt-4 wrapper */}

      {/* RETAIL CARGO LAYOUT */}
      {activePortal === "retail" && (
        <div className="p-4 grid gap-6 md:grid-cols-[1fr_280px] items-start">
          <div>
            <div className="flex items-center justify-between gap-3 mb-4">
              <div className="min-w-0 flex-1">
                <h1 className="text-[18px] font-sans font-bold text-[var(--color-foreground)] leading-tight">
                  New Cargo Retail Entry
                </h1>
                <p className="text-[12px] font-sans text-[var(--color-muted)]">
                  Log immediate cargo entries with retail cash, transfer or local
                  options.
                </p>
              </div>
              {onShowHistory && (
                <button
                  onClick={onShowHistory}
                  className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-[var(--color-surface-2)] border border-[var(--color-border-strong)] rounded-lg text-[11px] font-mono font-semibold text-[var(--color-foreground)] hover:bg-[var(--color-surface-3)] hover:border-[var(--color-accent-amber)] hover:text-[var(--color-accent-amber)] transition-colors shadow-[var(--shadow-xs)]"
                >
                  <ClipboardList size={14} /> <span>History</span>
                </button>
              )}
            </div>

            <div className="space-y-4">
              <div>
                {renderLabel(UserIcon, "Consignee")}
                <div className="flex flex-col space-y-2">
                  <input
                    id="retail-consignee"
                    name="consignee"
                    list="consignee-datalist"
                    placeholder="Type or select consignee name"
                    value={consignee}
                    onChange={(e) => setConsignee(e.target.value)}
                    className={formInputClass}
                  />
                  <datalist id="consignee-datalist">
                    {consigneeOptions.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                  {consignee === "Other" && (
                    <input
                      id="retail-custom-consignee"
                      name="custom-consignee"
                      placeholder="Enter Consignee Name"
                      value={customConsignee}
                      onChange={upperOnChange(setCustomConsignee)}
                      className={formInputClass}
                    />
                  )}
                  <input
                    id="retail-sender-phone"
                    name="sender-phone"
                    type="tel"
                    placeholder="Sender phone (optional) -- include country code for foreign customers (e.g. +44, +1, +233)"
                    value={senderPhone}
                    onChange={(e) => setSenderPhone(e.target.value)}
                    className={formInputClass}
                  />
                  <input
                    id="retail-consignee-phone"
                    name="consignee-phone"
                    type="tel"
                    placeholder="Consignee phone (optional) -- include country code for foreign customers (e.g. +44, +1, +233)"
                    value={consigneePhone}
                    onChange={(e) => setConsigneePhone(e.target.value)}
                    className={formInputClass}
                  />
                  {/* Active Customer Wallet Banner */}
                  {activeWallet && (
                    <div className="mt-2 p-2.5 rounded-lg border border-[var(--color-accent-amber)] bg-[rgba(245,158,11,0.08)] flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Coins size={16} className="text-[var(--color-accent-amber)] shrink-0" />
                        <div className="min-w-0">
                          <div className="text-[11px] font-mono font-bold text-[var(--color-accent-amber)]">
                            💰 WALLET BALANCE DETECTED
                          </div>
                          <div className="text-[10px] font-mono text-[var(--color-muted)]">
                            {activeWallet.customer_name} has <span className="font-bold text-[var(--color-foreground)]">₦{fmt(activeWallet.balance)}</span> available credit
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setMode("Wallet")}
                        className={`px-2.5 py-1 rounded text-[10px] font-mono font-bold cursor-pointer transition-colors ${
                          mode === "Wallet"
                            ? "bg-[var(--color-accent-amber)] text-[var(--color-obsidian)]"
                            : "border border-[var(--color-accent-amber)] text-[var(--color-accent-amber)] hover:bg-[var(--color-accent-amber)] hover:text-[var(--color-obsidian)]"
                        }`}
                      >
                        {mode === "Wallet" ? "Using Wallet" : "Use Wallet"}
                      </button>
                    </div>
                  )}

                  {/* Office-work detection banner */}
                  {detectedOfficeClient && !linkedAsOfficeWork && (
                    <div className="mt-2 p-3 rounded-lg border border-[var(--color-accent-amber)] bg-[rgba(245,158,11,0.08)] flex items-start gap-3">
                      <AlertTriangle size={16} className="text-[var(--color-accent-amber)] shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-mono font-bold text-[var(--color-accent-amber)]">
                          Office Work Client Detected
                        </div>
                        <div className="text-[10px] font-mono text-[var(--color-muted)] mt-0.5">
                          <span className="font-semibold text-[var(--color-foreground)]">{detectedOfficeClient.company_name}</span> is a registered corporate account.
                          {officeWorkRate
                            ? ` Contract rate for ${route}: ₦${officeWorkRate.rate_per_kg}/kg`
                            : ' No contract rate configured for this route — amount stays manual.'}
                        </div>
                        <div className="flex gap-2 mt-2">
                          <button
                            type="button"
                            onClick={() => {
                              setLinkedAsOfficeWork(true);
                              // Auto-apply contract rate if one exists
                              if (officeWorkRate && kg) {
                                const w = Math.round(parseFloat(kg)) || 0;
                                if (w > 0) {
                                  const computed = Math.max(
                                    w * officeWorkRate.rate_per_kg,
                                    officeWorkRate.minimum_amount ?? 0
                                  );
                                  setAmount(String(computed));
                                }
                              }
                            }}
                            className="px-3 py-1 rounded bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] text-[10px] font-bold font-mono"
                          >
                            Yes, Link as Office Work
                          </button>
                          <button
                            type="button"
                            onClick={() => setLinkedAsOfficeWork(false)}
                            className="px-3 py-1 rounded border border-[var(--color-border)] text-[var(--color-muted)] text-[10px] font-mono"
                          >
                            No, Keep as Retail
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                  {linkedAsOfficeWork && detectedOfficeClient && (
                    <div className="mt-2 p-2 rounded border border-[rgba(139,92,246,0.4)] bg-[rgba(139,92,246,0.08)] flex items-center gap-2">
                      <span className="text-[9px] font-bold font-mono text-[#a78bfa] uppercase tracking-wider">OFFICE WORK</span>
                      <span className="text-[10px] font-mono text-[var(--color-muted)] flex-1">{detectedOfficeClient.company_name}</span>
                      <button type="button" onClick={() => setLinkedAsOfficeWork(false)} className="text-[9px] font-mono text-[var(--color-muted)] hover:text-[var(--color-error)]">
                        unlink
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div>
                {renderLabel(Plane, "Airline")}
                <select
                  value={airline}
                  onChange={(e) => { setAirline(e.target.value); setAmount(""); }}
                  className={formInputClass}
                >
                  {availableAirlines.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
                {airline === "Other" && (
                  <input
                    id="retail-custom-airline"
                    name="custom-airline"
                    placeholder="Enter new airline name"
                    value={customAirline}
                    onChange={upperOnChange(setCustomAirline)}
                    className={`${formInputClass} mt-2`}
                  />
                )}
              </div>

              <div>
                {renderLabel(MapPin, "Route")}
                <select
                  value={route}
                  onChange={(e) => { setRoute(e.target.value); setAmount(""); }}
                  className={formInputClass}
                >
                  {routes.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                {renderLabel(Hash, "AWB / Tag No (Auto-generated)")}
                <input
                  id="retail-awb"
                  name="awb"
                  type="text"
                  value={awb || "Loading…"}
                  readOnly
                  className={`${formInputClass} font-mono bg-opacity-50 cursor-not-allowed`}
                  style={{ backgroundColor: 'var(--color-surface-3)', color: 'var(--color-muted)' }}
                />
              </div>

              <div className="flex space-x-3">
                <div className="flex-1">
                  {renderLabel(Package, "Pcs")}
                  <input
                    id="retail-pcs"
                    name="pcs"
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
                    id="retail-kg"
                    name="kg"
                    type="number"
                    step="1"
                    min="1"
                    value={kg}
                    onChange={(e) => {
                      const cleanVal = e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
                      setKg(cleanVal);
                      setAmount(""); // reset manual override so autoAmount takes over
                    }}
                    className={formInputClass}
                  />
                </div>
              </div>

              <div>
                {renderLabel(Layers, "Content")}
                <select
                  value={contentType}
                  onChange={(e) => setContentType(e.target.value)}
                  className={formInputClass}
                >
                  {contentTypes.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                {contentType === "Other" && (
                  <input
                    id="retail-custom-content"
                    name="custom-content"
                    placeholder="Enter content type"
                    value={customContentType}
                    onChange={upperOnChange(setCustomContentType)}
                    className={`${formInputClass} mt-2`}
                  />
                )}
              </div>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "12px 14px",
                margin: "24px 0 16px 0",
                background:
                  "linear-gradient(90deg, rgba(245,158,11,0.06) 0%, transparent 100%)",
                borderLeft: "3px solid var(--color-accent-amber)",
                borderRadius: "0 var(--radius-sm) var(--radius-sm) 0",
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  color: "var(--color-accent-amber)",
                }}
              >
                Payment Details
              </span>
            </div>

            <div className="space-y-4">
              <div>
                {renderLabel(Banknote, "Amount")}
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-muted)] font-mono text-[18px]">
                    ₦
                  </span>
                  <input
                    id="retail-amount"
                    name="amount"
                    type="number"
                    min="0"
                    value={effectiveAmount}
                    onChange={(e) => setAmount(e.target.value)}
                    onBlur={() => {
                      if (parsedAmount < minAmount) {
                        setAmount(minAmount.toString());
                      }
                    }}
                    className={`ehi-input pl-12 ${parsedAmount < minAmount ? 'border-[var(--color-error)]' : ''}`}
                  />
                </div>
                {rate == null && minCharge == null ? (
                  <div className="text-[10px] text-[var(--color-accent-amber)] mt-1">No rate configured for this hub/airline/route — enter amount manually</div>
                ) : (
                  parsedAmount > 0 && parsedAmount < minAmount && (
                    <div className="text-[10px] text-[var(--color-error)] mt-1">Amount cannot be less than ₦{minAmount.toLocaleString()}</div>
                  )
                )}
                {priceOverrideInfo && (
                  <div className="text-[10px] text-[var(--color-accent-cobalt)] mt-1">
                    {priceOverrideInfo.type === 'special'
                      ? `Special Goods Rate applied: ${fmt(priceOverrideInfo.rate)}/kg`
                      : `Minimum Charge applied: ${fmt(priceOverrideInfo.amount)}`}
                  </div>
                )}
              </div>

              <div>
                {renderLabel(CreditCard, "Receipt / Payment Mode")}
                <div className="flex bg-[var(--color-surface-3)] rounded-[var(--radius-sm)] p-1 border border-[var(--color-border)] mb-3">
                  {["Cash", "Transfer", "POS", "Wallet"].map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMode(m as any)}
                      style={{
                        background:
                          mode === m ? "var(--color-surface-1)" : "transparent",
                        color:
                          mode === m
                            ? "var(--color-accent-amber)"
                            : "var(--color-muted)",
                        border: "none",
                      }}
                      className={`flex-1 py-2 text-[13px] font-sans font-semibold rounded-[var(--radius-xs)] shadow-sm transition-all focus:outline-none cursor-pointer flex items-center justify-center gap-1`}
                    >
                      {m === "Wallet" ? "💰 Wallet" : m}
                    </button>
                  ))}
                </div>

                {mode === "Wallet" && (
                  <div className="mb-3 space-y-2">
                    <CustomerWalletPicker
                      wallets={customerWallets}
                      selectedWallet={activeWallet}
                      onSelectWallet={(w) => setSelectedWalletOverride(w)}
                      currentCustomerName={consignee === 'Other' ? customConsignee : consignee}
                    />
                    {activeWallet && activeWallet.balance < parsedAmount && (
                      <WalletRemainderSelector
                        walletName={activeWallet.customer_name}
                        coverage={activeWallet.balance}
                        remainder={parsedAmount - activeWallet.balance}
                        mode={walletRemainderMode}
                        bank={walletRemainderBank}
                        onModeChange={setWalletRemainderMode}
                        onBankChange={setWalletRemainderBank}
                      />
                    )}
                  </div>
                )}

                <div className="flex items-center justify-center space-x-3 my-3">
                  <div className="flex-1 h-px bg-[var(--color-border)]" />
                  <div className="text-[11px] font-mono text-[var(--color-muted)] tracking-wider">
                    OR
                  </div>
                  <div className="flex-1 h-px bg-[var(--color-border)]" />
                </div>

                <button
                  type="button"
                  onClick={() => setMode("Debt")}
                  className={`w-full py-2.5 text-[13px] font-sans font-semibold rounded-[var(--radius-sm)] border transition-colors cursor-pointer focus:outline-none ${mode === "Debt" ? "bg-[rgba(239,68,68,0.1)] border-[var(--color-error)] text-[var(--color-error)] shadow-sm" : "bg-transparent border-[var(--color-border-strong)] text-[var(--color-error)] hover:bg-[rgba(239,68,68,0.05)]"}`}
                >
                  Log as Credit Sale (Debt)
                </button>

                {mode === "Debt" && (
                  <div className="mt-2 text-[12px] font-sans text-[var(--color-error)] bg-[rgba(239,68,68,0.05)] p-2.5 rounded-[var(--radius-sm)] border border-[rgba(239,68,68,0.1)]">
                    This sale will be logged as a credit. Collect payment before
                    dispatch or arrange with management.
                  </div>
                )}
              </div>

              {mode === "Transfer" && (
                <div>
                  {renderLabel(Landmark, "Bank")}
                  <select
                    value={bank}
                    onChange={(e) => setBank(e.target.value)}
                    className={formInputClass}
                  >
                    {banks.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                  <PaymentNarrationBox narrationCode={narrationCode} />
                </div>
              )}

              {mode === "POS" && (
                <div>
                  {renderLabel(CreditCard, "POS Terminal / Bank")}
                  <select
                    value={bank}
                    onChange={(e) => setBank(e.target.value)}
                    className={formInputClass}
                  >
                    {banks.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                {renderLabel(MessageSquare, "Remark (Optional)")}
                <input
                  id="retail-remark"
                  name="remark"
                  placeholder="Add notes..."
                  value={remark}
                  onChange={upperOnChange(setRemark)}
                  className={formInputClass}
                />
              </div>
            </div>

            <div className="pt-8">
              <button
                onClick={() => setShowRetailReview(true)}
                disabled={!isRetailFormValid || submitting}
                className={`w-full py-4 rounded-[var(--radius-sm)] font-sans font-bold text-[16px] flex items-center justify-center gap-2 transition-all focus:outline-none ${
                  submitting
                    ? "opacity-80 cursor-wait bg-[var(--color-accent-amber)] text-[#030712]"
                    : !isRetailFormValid
                      ? "bg-[var(--color-surface-3)] text-[var(--color-muted)] cursor-not-allowed border border-[var(--color-border)]"
                      : "bg-[var(--color-accent-amber)] text-[#030712] cursor-pointer hover:bg-opacity-95"
                }`}
              >
                {submitting && <Loader2 size={18} className="animate-spin" />}
                {submitting ? "LOGGING..." : "LOG CARGO ENTRY"}
              </button>
              {showRetailReview && (
                <ReviewEntryModal
                  title="Review Cargo Entry"
                  details={[
                    { label: 'Consignee', value: actualConsignee },
                    { label: 'Route', value: route },
                    { label: 'Content', value: actualContentType },
                    { label: 'Weight', value: `${kg} KG` },
                    { label: 'Amount', value: parsedAmount },
                    { label: 'Payment Mode', value: mode },
                  ]}
                  onConfirm={() => { setShowRetailReview(false); handleRetailSubmit(); }}
                  onCancel={() => setShowRetailReview(false)}
                  confirmText="Log Cargo Entry"
                  isSubmitting={submitting}
                />
              )}
            </div>
          </div>

          <aside className="ehi-desktop-only">
            <div
              style={{
                position: "sticky",
                top: 16,
                background: "var(--color-surface-1)",
                border: "1.5px solid var(--color-border-strong)",
                borderRadius: "var(--radius-md)",
                padding: 20,
                boxShadow: "var(--shadow-card)",
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  fontFamily: "monospace",
                  color: "var(--color-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  marginBottom: 16,
                  fontWeight: 700,
                }}
              >
                ENTRY SUMMARY
              </div>
              <div
                style={{
                  fontSize: 13,
                  fontFamily: "monospace",
                  lineHeight: 2.2,
                  color: "var(--color-foreground)",
                }}
              >
                <div className="flex justify-between border-b border-[var(--color-border)] pb-1 mb-1">
                  <span style={{ color: "var(--color-muted)" }}>Consignee</span>
                  <span
                    className="truncate ml-4 font-semibold text-[var(--color-foreground)]"
                    style={{ maxWidth: "140px" }}
                  >
                    {actualConsignee || "—"}
                  </span>
                </div>
                <div className="flex justify-between border-b border-[var(--color-border)] pb-1 mb-1">
                  <span style={{ color: "var(--color-muted)" }}>AWB</span>
                  <span className="font-bold text-[var(--color-accent-amber)]">
                    {awb || "—"}
                  </span>
                </div>
                <div className="flex justify-between border-b border-[var(--color-border)] pb-1 mb-1">
                  <span style={{ color: "var(--color-muted)" }}>Route</span>
                  <span className="font-semibold text-[var(--color-foreground)]">
                    {route}
                  </span>
                </div>
                <div className="flex justify-between border-b border-[var(--color-border)] pb-1 mb-1">
                  <span style={{ color: "var(--color-muted)" }}>Content</span>
                  <span className="font-semibold text-[var(--color-foreground)]">
                    {actualContentType || "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: "var(--color-muted)" }}>Pcs / KG</span>
                  <span className="font-semibold text-[var(--color-foreground)]">
                    {pcs || "—"} / {kg || "—"}
                  </span>
                </div>
              </div>
              <div
                style={{
                  borderTop: "1.5px dashed var(--color-border-strong)",
                  paddingTop: 16,
                  marginTop: 16,
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    fontFamily: "monospace",
                    color: "var(--color-muted)",
                    marginBottom: 6,
                    fontWeight: 700,
                    letterSpacing: "0.05em",
                  }}
                >
                  AMOUNT
                </div>
                <div
                  style={{
                    fontSize: 28,
                    fontWeight: 800,
                    fontFamily: "monospace",
                    color:
                      parsedAmount > 0
                        ? "var(--color-accent-amber)"
                        : "var(--color-muted)",
                  }}
                >
                  {parsedAmount > 0
                    ? "₦" + parsedAmount.toLocaleString("en-NG")
                    : "₦0"}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    fontFamily: "monospace",
                    color: "var(--color-muted)",
                    marginTop: 6,
                    fontWeight: 600,
                  }}
                >
                  {mode}
                  {mode === "Transfer" && bank ? ` · ${bank}` : ""}
                </div>
              </div>
              <div
                style={{
                  fontSize: 10,
                  fontFamily: "monospace",
                  color: "var(--color-muted)",
                  marginTop: 24,
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                <span>{new Date().toLocaleDateString("en-NG")}</span>
                <span>Entry #{serialNumber}</span>
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* CORPORATE SYSTEM PORTAL */}
      {activePortal === "corporate" && (
        <div className="space-y-6 p-4">
          {/* CORPORATE MENU ROUTING */}
          <div className="flex border-b border-[var(--color-border)] text-[13px] font-sans font-bold gap-4 py-1">
            <button
              onClick={() => setCorpSubTab("intake")}
              className={`pb-2.5 px-1 transition-all cursor-pointer flex items-center gap-1.5 ${
                corpSubTab === "intake"
                  ? "text-[var(--color-accent-amber)] border-b-2 border-[var(--color-accent-amber)]"
                  : "text-[var(--color-light-muted)] hover:text-[var(--color-foreground)]"
              }`}
            >
              <ClipboardList size={14} /> Phase 1: Field Intake Book
            </button>
            <button
              onClick={() => setCorpSubTab("weighing")}
              className={`pb-2.5 px-1 transition-all cursor-pointer flex items-center gap-1.5 ${
                corpSubTab === "weighing"
                  ? "text-[var(--color-accent-amber)] border-b-2 border-[var(--color-accent-amber)]"
                  : "text-[var(--color-light-muted)] hover:text-[var(--color-foreground)]"
              }`}
            >
              <Scale size={14} /> Phase 2: Yard Gate Weigh Scale
              {pendingIntakes.length > 0 && (
                <span className="bg-red-600 text-white font-bold text-[10px] px-1.5 py-0.5 rounded-full">
                  {pendingIntakes.length} pending
                </span>
              )}
            </button>
          </div>

          {/* DYNAMIC SUBTABS VIEW */}
          {corpSubTab === "intake" && (
            <div className="grid gap-6 md:grid-cols-2 max-w-5xl mx-auto">
              {/* PHASE 1 INPUT FORM */}
              <div className="bg-[var(--color-surface-card)] border border-[var(--color-border-strong)] p-5 rounded-[var(--radius-md)]">
                <div className="flex items-center gap-2 mb-4 border-b border-[var(--color-border)] pb-2.5">
                  <PlusCircle
                    size={18}
                    className="text-[var(--color-accent-amber)]"
                  />
                  <h3 className="text-[14px] font-sans font-bold text-[var(--color-foreground)] uppercase tracking-wider">
                    Log Office Work Pick-Up (No Pricing)
                  </h3>
                </div>

                {successMessage && (
                  <div className="p-3 mb-4 text-[12px] font-sans font-bold text-[var(--color-success)] bg-[rgba(16,185,129,0.1)] border border-[var(--color-success)] rounded flex items-center gap-2">
                    <CheckCircle size={14} /> {successMessage}
                  </div>
                )}

                <div className="space-y-4">
                  <div>
                    {renderLabel(UserIcon, "Office Work (B2B) Client")}
                    {/* Deliberately a strict select, not a free-typed datalist
                        like the retail Consignee field below -- billing at
                        finalize looks up the client's contract rate by
                        corporate_client_id (see handleFinalizeWeighing), and
                        a typo'd/unmatched free-typed name here would silently
                        fall back to the flat default rate instead of the
                        client's real negotiated rate, with no warning. */}
                    <select
                      id="intake-consignee"
                      name="intake-consignee"
                      value={intakeConsignee}
                      onChange={(e) => setIntakeConsignee(e.target.value)}
                      className={formInputClass}
                    >
                      {corpClients.map((c) => (
                        <option key={c.id} value={c.company_name}>
                          {c.company_name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    {renderLabel(MessageSquare, "Client Phone (Optional)")}
                    <input
                      type="tel"
                      placeholder="Include country code for foreign customers (e.g. +44, +1, +233)"
                      value={intakeSenderPhone}
                      onChange={(e) => setIntakeSenderPhone(e.target.value)}
                      className={formInputClass}
                    />
                  </div>

                  <div>
                    {renderLabel(Plane, "Carrier Airline")}
                    <select
                      value={intakeAirline}
                      onChange={(e) => setIntakeAirline(e.target.value)}
                      className={formInputClass}
                    >
                      {availableAirlines.map((a) => (
                        <option key={a} value={a}>
                          {a}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    {renderLabel(Hash, "AWB Tag / Waybill Number (Auto-generated)")}
                    <input
                      type="text"
                      value={intakeAwb}
                      readOnly
                      className={`${formInputClass} font-mono bg-opacity-50 cursor-not-allowed`}
                      style={{ backgroundColor: 'var(--color-surface-3)', color: 'var(--color-muted)' }}
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                        {routes.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    {renderLabel(Layers, "Cargo Content Type")}
                    <select
                      value={intakeContentType}
                      onChange={(e) => setIntakeContentType(e.target.value)}
                      className={formInputClass}
                    >
                      {contentTypes.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="bg-[rgba(245,158,11,0.03)] border border-[rgba(245,158,11,0.1)] p-3 rounded text-[11px] font-sans text-[var(--color-light-muted)] space-y-1">
                    <p className="font-semibold text-[var(--color-accent-amber)] flex items-center gap-1.5">
                      <AlertTriangle size={14} /> INTENTIONAL BUSINESS LOGIC:
                    </p>
                    <p>
                      No pricing or weights can be registered during Field
                      Intake lookup. Definitive weights and billing calculations
                      are strictly delayed until verified scale weighings are
                      finalized inside the Gate Yard Clerk terminal.
                    </p>
                  </div>

                  <button
                    onClick={handleLogFieldIntake}
                    className="w-full h-12 mt-4 cursor-pointer bg-[var(--color-accent-amber)] text-[#030712] font-semibold text-[14px] rounded-[var(--radius-sm)] flex items-center justify-center gap-2 hover:bg-opacity-95 transition-all text-center"
                  >
                    <Rocket size={16} /> LOG INTAKE FOR WEIGHING
                  </button>
                </div>
              </div>

              {/* LIST OF PENDING INTAKES FOR CURRENT SESSION */}
              <div className="space-y-4">
                <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] p-4 rounded-[var(--radius-md)]">
                  <h4 className="text-[13px] font-sans font-bold text-[var(--color-foreground)] mb-3">
                    Office Work Pick-up Intakes ({pendingIntakes.length})
                  </h4>

                  {pendingIntakes.length === 0 ? (
                    <div className="text-center py-10 text-[var(--color-muted)] text-[12px] font-sans">
                      No pending field intakes currently recorded. Use the
                      intake book form on the left.
                    </div>
                  ) : (
                    <div className="divide-y divide-[var(--color-border)] max-h-[380px] overflow-y-auto pr-1">
                      {pendingIntakes.map((pi) => (
                        <div
                          key={pi.id}
                          className="py-2.5 flex items-center justify-between text-[12px]"
                        >
                          <div>
                            <div className="font-bold text-[var(--color-foreground)] flex items-center gap-1.5">
                              <span className="flex items-center gap-1">
                                <Building
                                  size={14}
                                  className="text-[var(--color-muted)]"
                                />{" "}
                                {pi.consignee}
                              </span>
                              <span className="font-semibold px-1.5 py-0.5 rounded bg-[rgba(245,158,11,0.08)] text-[var(--color-accent-amber)] font-mono text-[9px]">
                                {pi.id}
                              </span>
                            </div>
                            <div className="text-[var(--color-light-muted)] mt-0.5">
                              {pi.airline} · {pi.awb} · {pi.pieces} pcs ·{" "}
                              <span className="text-[var(--color-accent-amber)] font-semibold">
                                {pi.route}
                              </span>
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <span className="text-[11px] font-mono text-[var(--color-muted)]">
                              {pi.time}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (window.confirm("Delete this pending intake?")) {
                                  const updated = pendingIntakes.filter(x => x.id !== pi.id);
                                  updateLocalPendingIntakes(updated);
                                  Promise.resolve(supabase.from('pending_corporate_intakes').delete().eq('id', pi.id)).catch(console.error);
                                  if (selectedIntake?.id === pi.id) {
                                    setSelectedIntake(null);
                                    setGateWeight("");
                                    setCustomRateOverwrite("");
                                  }
                                }
                              }}
                              className="text-red-500/60 hover:text-red-500 transition-colors p-1"
                              title="Delete pending intake"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="p-4 rounded-md border border-[var(--color-border)] bg-[var(--color-obsidian)] text-[11px] font-serif text-[var(--color-light-muted)] italic leading-relaxed">
                  "Every pickup record entered here is saved to the
                  centralized database and visible to any staff member at
                  this hub. Scale weighing operates in strict sequence at
                  the major gateyard commercial weighing scales."
                </div>
              </div>
            </div>
          )}

          {/* PHASE 2 SUBTAB: YARD GATE WEIGH SCALE */}
          {corpSubTab === "weighing" && (
            <div className="grid gap-6 md:grid-cols-[1.5fr_1fr] max-w-6xl mx-auto">
              {/* DETAILED PENDING GRID/QUEUE */}
              <div className="bg-[var(--color-surface-card)] border border-[var(--color-border-strong)] p-5 rounded-[var(--radius-md)]">
                <div className="flex items-center justify-between mb-4 pb-2 border-b border-[var(--color-border)]">
                  <div className="flex items-center gap-2">
                    <Scale
                      size={18}
                      className="text-[var(--color-accent-amber)]"
                    />
                    <h3 className="text-[14px] font-sans font-bold text-[var(--color-foreground)] uppercase tracking-wider">
                      Gateyard Scale Booking Queue
                    </h3>
                  </div>
                  <span className="text-[11px] font-mono text-[var(--color-muted)]">
                    Active scales stabilized
                  </span>
                </div>

                {pendingIntakes.length === 0 ? (
                  <div className="text-center py-20 text-[var(--color-muted)] text-[13px] font-sans">
                    <p className="font-semibold text-[var(--color-foreground)] mb-1">
                      Scale Yard Queue Empty
                    </p>
                    <p className="max-w-md mx-auto text-[11px]">
                      All Office Work shipments have been weighed and routed.
                      Check Phase 1 Logbook or the main Ledger.
                    </p>
                  </div>
                ) : (
                  <div className="grid gap-3 max-h-[500px] overflow-y-auto pr-1">
                    {pendingIntakes.map((pi) => {
                      const isSelected = selectedIntake?.id === pi.id;

                      // Client custom rate lookup for preview badges
                      const matchingC = corpClients.find(
                        (c) => c.id === pi.corporate_client_id,
                      );
                      const clientRate = matchingC
                        ? corpRates.find(
                            (r) =>
                              r.corporate_client_id === matchingC.id &&
                              r.route_name === pi.route,
                          )
                        : null;
                      const finalRate = clientRate
                        ? clientRate.rate_per_kg
                        : 500;

                      return (
                        <div
                          key={pi.id}
                          onClick={() => {
                            setSelectedIntake(pi);
                            setGateWeight("");
                            setCustomRateOverwrite("");
                          }}
                          className={`p-3.5 rounded-md border text-[13px] transition-colors cursor-pointer flex items-center justify-between ${
                            isSelected
                              ? "bg-[rgba(245,158,11,0.05)] border-[var(--color-accent-amber)] shadow-lg"
                              : "bg-[var(--color-input-bg)] border-[var(--color-border)] hover:border-[var(--color-border-strong)]"
                          }`}
                        >
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-[var(--color-foreground)] text-[14px] flex items-center gap-1.5">
                                <Building
                                  size={16}
                                  className="text-[var(--color-muted)]"
                                />{" "}
                                {pi.consignee}
                              </span>
                              <span className="text-[10px] font-mono font-bold px-1.5 bg-[var(--color-surface-2)] text-[var(--color-light-muted)] rounded">
                                {pi.id}
                              </span>
                            </div>
                            <div className="text-[12px] text-[var(--color-light-muted)] space-x-2">
                              <span>
                                Waybill:{" "}
                                <strong className="text-[var(--color-accent-amber)] font-mono">
                                  {pi.awb}
                                </strong>
                              </span>
                              <span>•</span>
                              <span>
                                Route:{" "}
                                <strong className="text-[var(--color-foreground)]">
                                  {pi.route}
                                </strong>
                              </span>
                              <span>•</span>
                              <span>
                                Pcs: <strong>{pi.pieces}</strong>
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-3">
                            <div className="text-right text-[11px] font-mono">
                              <div className="text-[var(--color-light-muted)]">
                                Negotiated Rate
                              </div>
                              <div className="font-bold text-[var(--color-accent-amber)]">
                                ₦{finalRate}/KG
                              </div>
                            </div>
                            <div className="flex flex-col items-end gap-2">
                              <ArrowRight
                                size={16}
                                className={
                                  isSelected
                                    ? "text-[var(--color-accent-amber)]"
                                    : "text-[var(--color-muted)]"
                                }
                              />
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (window.confirm("Delete this pending intake?")) {
                                    const updated = pendingIntakes.filter(x => x.id !== pi.id);
                                    updateLocalPendingIntakes(updated);
                                    Promise.resolve(supabase.from('pending_corporate_intakes').delete().eq('id', pi.id)).catch(console.error);
                                    if (selectedIntake?.id === pi.id) {
                                      setSelectedIntake(null);
                                      setGateWeight("");
                                      setCustomRateOverwrite("");
                                    }
                                  }
                                }}
                                className="text-red-500/60 hover:text-red-500 transition-colors p-1"
                                title="Delete pending intake"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
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
                  <div className="bg-[var(--color-surface-card)] border border-[var(--color-border-strong)] p-6 rounded-[var(--radius-md)] text-[var(--color-foreground)] flex flex-col h-auto">
                    <div className="flex items-center justify-between mb-6 pb-2 border-b border-[var(--color-border)]">
                      <div className="text-[13px] font-bold text-[var(--color-accent-amber)] uppercase tracking-wider">
                        SCALE WEIGHING CONSOLE
                      </div>
                    </div>

                    <div className="bg-[var(--color-surface-2)] p-4 rounded-lg border border-[var(--color-border)] space-y-2 text-[12px] mb-6">
                      <div className="flex justify-between items-center py-1 border-b border-[var(--color-border)]">
                        <span className="text-[var(--color-muted)] font-medium">
                          Arrived Client
                        </span>
                        <span className="font-bold text-[var(--color-foreground)]">
                          {selectedIntake.consignee}
                        </span>
                      </div>
                      <div className="flex justify-between items-center py-1 border-b border-[var(--color-border)]">
                        <span className="text-[var(--color-muted)] font-medium">
                          Shipment Route
                        </span>
                        <span className="font-bold text-[var(--color-accent-amber)]">
                          {selectedIntake.route}
                        </span>
                      </div>
                      <div className="flex justify-between items-center py-1 border-b border-[var(--color-border)]">
                        <span className="text-[var(--color-muted)] font-medium">
                          Carrier Waybill
                        </span>
                        <span className="font-bold text-[var(--color-foreground)] font-mono">
                          {selectedIntake.awb}
                        </span>
                      </div>
                      <div className="flex justify-between items-center py-1">
                        <span className="text-[var(--color-muted)] font-medium">
                          Total Containers
                        </span>
                        <span className="font-bold text-[var(--color-foreground)]">
                          {selectedIntake.pieces} pieces
                        </span>
                      </div>
                    </div>

                    {/* SCALE SIMULATION FOR INTEGRATION LOOKS POPULAR */}
                    <div className="mb-6">
                      <label htmlFor="cargo-gate-weight" className="text-[11px] font-medium text-[var(--color-muted)] block mb-1.5">
                        Commercial Scale Verified Weight (KG)
                      </label>
                      <div className="relative">
                        <input
                          id="cargo-gate-weight"
                          type="number"
                          step="1"
                          min="1"
                          placeholder="Scale Reading"
                          value={gateWeight}
                          onChange={(e) => {
                            const cleanVal = e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
                            setGateWeight(cleanVal);
                          }}
                          className="w-full h-12 pl-4 pr-12 text-[16px] font-bold text-[var(--color-accent-amber)] rounded-md bg-[var(--color-bg)] border border-[var(--color-surface-2)] font-mono focus:outline-none focus:border-[var(--color-accent-amber)] transition-colors"
                        />
                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--color-muted)] font-bold text-[12px] font-sans">
                          KG
                        </span>
                      </div>
                    </div>

                    {/* DYNAMIC CONTRACT PRICING ENGINE */}
                    <div className="flex flex-col space-y-4">
                      <div className="bg-[var(--color-bg)] p-4 rounded-lg border border-[var(--color-border)] space-y-3 font-mono text-[12px]">
                        <div className="flex justify-between items-center">
                          <span className="text-[var(--color-muted)]">
                            Negotiated Rate
                          </span>
                          <span className="font-bold text-[var(--color-foreground)]">
                            {contractRateForSelectedIntake
                              ? `₦${contractRateForSelectedIntake.rate_per_kg}/KG`
                              : "None on file"}
                          </span>
                        </div>

                        {/* RBAC OVERWRITE PRICING LOCK */}
                        {isAuthorizedRole ? (
                          <div className="pt-2 border-t border-[var(--color-border)]">
                            <label htmlFor="cargo-custom-rate-overwrite" className="text-[10px] text-[var(--color-muted)] block mb-1.5">
                              Admin Custom Rate Overwrite (₦/KG){!contractRateForSelectedIntake ? ' -- required, no contract rate on file' : ''}:
                            </label>
                            <input
                              id="cargo-custom-rate-overwrite"
                              type="number"
                              placeholder={contractRateForSelectedIntake ? "Leave empty for default" : "Enter rate -- no contract on file"}
                              value={customRateOverwrite}
                              onChange={(e) =>
                                setCustomRateOverwrite(e.target.value)
                              }
                              className="w-full h-9 px-3 text-[12px] bg-[var(--color-surface-2)] text-[var(--color-foreground)] border border-[var(--color-border)] rounded focus:outline-none focus:border-[var(--color-accent-amber)] transition-colors"
                            />
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 text-[10px] bg-[var(--color-surface-2)] text-[var(--color-muted)] p-2 rounded italic">
                            <ShieldAlert size={12} />
                            <span>Rates locked by Accounting rules.</span>
                          </div>
                        )}

                        {!contractRateForSelectedIntake && (
                          <div className="text-[10px] text-[var(--color-accent-amber)]">
                            No negotiated rate on file for this client/route -- {isAuthorizedRole ? 'an admin rate overwrite is required to finalize' : 'ask an admin or accountant to set one or finalize this invoice'}. Nothing will be guessed.
                          </div>
                        )}

                        <div className="pt-3 mt-1 border-t border-[var(--color-surface-2)] flex justify-between items-center">
                          <span className="text-[12px] font-sans text-[var(--color-muted)] font-medium uppercase tracking-wider">
                            Computed Bill
                          </span>
                          <span className="text-[18px] text-[var(--color-accent-amber)] font-bold">
                            {(() => {
                              const rate = customRateOverwrite
                                ? parseFloat(customRateOverwrite)
                                : contractRateForSelectedIntake?.rate_per_kg;
                              if (rate == null) return "—";
                              const weight = Math.round(parseFloat(gateWeight)) || 0;
                              let cost = weight * rate;
                              if (!customRateOverwrite && contractRateForSelectedIntake && contractRateForSelectedIntake.minimum_amount) {
                                const minAmount = Number(contractRateForSelectedIntake.minimum_amount);
                                if (minAmount > 0 && cost < minAmount) {
                                  cost = minAmount;
                                }
                              }
                              return `₦${cost.toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;
                            })()}
                          </span>
                        </div>
                      </div>

                      <div className="text-[11px] text-[var(--color-error)] bg-[rgba(239,68,68,0.03)] p-2 rounded border border-[rgba(239,68,68,0.1)] leading-snug flex items-start gap-1.5">
                        <Zap size={14} className="shrink-0 mt-0.5" />
                        <span>
                          If "Debt" is selected, the database trigger will automatically book
                          this finalized amount to the client's monthly master
                          debt profile balance.
                        </span>
                      </div>
                    </div>

                    <div className="mt-4 space-y-1.5">
                      <span className="text-[12px] font-sans font-semibold text-[var(--color-light-muted)]">Payment Mode</span>
                      <select
                        value={corporateMode}
                        onChange={(e) => setCorporateMode(e.target.value)}
                        className={`w-full h-11 px-3 text-sm rounded bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[var(--color-foreground)] font-sans focus:outline-none focus:border-[var(--color-accent-amber)]`}
                      >
                        <option value="Cash">Cash (Paid)</option>
                        <option value="POS">POS (Paid)</option>
                        <option value="Transfer">Bank Transfer (Paid)</option>
                        <option value="Debt">Debt (Add to Monthly Balance)</option>
                      </select>
                    </div>

                    <button
                      onClick={handleFinalizeWeighing}
                      disabled={!gateWeight || isWeighingSubmitting || (!contractRateForSelectedIntake && !customRateOverwrite)}
                      className="w-full h-12 mt-5 cursor-pointer bg-[var(--color-accent-amber)] text-[#030712] font-semibold text-[14px] rounded flex items-center justify-center gap-2 hover:bg-opacity-95 transition-all text-center"
                    >
                      {isWeighingSubmitting ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <>
                          <CheckCircle size={16} /> FINALIZE GATE INVOICE
                        </>
                      )}
                    </button>
                  </div>
                ) : (
                  <div className="bg-[var(--color-surface-card)] border border-[var(--color-border-strong)] p-12 rounded-[var(--radius-md)] text-center text-[var(--color-muted)]">
                    <Scale size={32} className="mx-auto text-[var(--color-muted)] mb-3" />
                    <p className="text-[13px] font-sans font-semibold text-[var(--color-muted)]">
                      Scale Diagnostic Standby
                    </p>
                    <p className="text-[11px] font-sans max-w-xs mx-auto mt-1">
                      Select any Office Work pick-up booking from the left queue
                      to place items on the commercial yard scale.
                    </p>
                  </div>
                )}

                <div className="bg-[var(--color-surface-2)] p-4 rounded border border-[var(--color-border)] mt-4">
                  <h5 className="text-[12px] font-bold text-[var(--color-foreground)] mb-2 flex items-center gap-1">
                    <ShieldAlert size={14} className="text-[var(--color-accent-amber)]" />
                    Office Work Scaling Rules
                  </h5>
                  <p className="text-[11px] text-[var(--color-light-muted)] leading-relaxed">
                    Weights verified on our gate scale are definitive (no manual
                    estimation allowed). Debt payment modes on Office Work custom
                    accounts automatically bill monthly to prevent yard queuing
                    blocks.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {showCloseModal && (
        <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.85)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: 16 }}>
          <div style={{ background: "var(--color-obsidian)", width: "100%", maxWidth: 480, maxHeight: "90vh", borderRadius: 16, border: "1px solid var(--color-surface-2)", padding: "24px 24px 0 24px", position: "relative", display: "flex", flexDirection: "column" }}>
            <button onClick={() => setShowCloseModal(false)} aria-label="Close" style={{ position: "absolute", top: 16, right: 16, color: "var(--color-muted)" }}>×</button>
            <div style={{ overflowY: "auto", flex: 1 }}>
              <div className="text-[10px] font-mono text-[var(--color-accent-amber)] tracking-widest font-bold mb-1">▸ CARGO DESK SALES ANALYSIS</div>
              <div className="text-[12px] text-[var(--color-muted)] mb-4">Agent: <span className="text-[var(--color-foreground)]">{user.name}</span></div>

              <div className="space-y-2 mb-4 border-t border-b border-[var(--color-border)] py-3">
                <div className="text-[10px] font-mono text-[var(--color-muted)] uppercase tracking-wider flex items-center gap-1.5">
                  <Calendar size={12} /> Closing Period
                </div>
                <div className="flex items-center gap-2">
                  <input type="datetime-local" value={periodStart} onChange={e => setPeriodStart(e.target.value)} disabled={!!lastCloseEnd} className="ehi-input text-[12px] disabled:opacity-60 disabled:cursor-not-allowed" />
                  <span className="text-[var(--color-muted)] text-[11px]">to</span>
                  <input type="datetime-local" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} className="ehi-input text-[12px]" />
                </div>
                {lastCloseEnd && (
                  <div className="text-[10px] font-mono text-[var(--color-muted)]">Last close ended: {new Date(lastCloseEnd).toLocaleString('en-GB')}</div>
                )}
                <div className="text-[12px] font-mono font-bold text-[var(--color-accent-amber)]">
                  Closing: {periodStart ? new Date(periodStart).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
                  {' → '}
                  {periodEnd ? new Date(periodEnd).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
                </div>
              </div>

              {closeSummaryLoading ? (
                <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-[var(--color-accent-amber)]" /></div>
              ) : (
                <>
                  <div className="space-y-1.5 text-[13px] font-mono pt-1 mb-4">
                    <div className="flex justify-between"><span className="text-[var(--color-muted)]">Total Sales</span><span className="font-bold text-[var(--color-foreground)]">{fmt(closeTotalSales)}</span></div>
                    <div className="flex justify-between"><span className="text-[var(--color-muted)]">Cash Sales</span><span className="text-[var(--color-foreground)]">{fmt(closeCashSales)}</span></div>
                    {closeDebtCashRecoveredToday > 0 && <div className="flex justify-between text-emerald-400"><span>Debt Recovered (Cash)</span><span>+ {fmt(closeDebtCashRecoveredToday)}</span></div>}
                    <div className="flex justify-between"><span className="text-[var(--color-muted)]">POS</span><span className="text-[var(--color-foreground)]">{fmt(closePosSales)}</span></div>
                    <div className="flex justify-between"><span className="text-[var(--color-muted)]">Bank Transfer</span><span className="text-[var(--color-foreground)]">{fmt(closeTransferSales)}</span></div>
                    {closeDebtSales > 0 && <div className="flex justify-between border-t border-[var(--color-border)] pt-1 mt-1"><span className="text-orange-400 font-sans">Unpaid Credit Sales (Owed)</span><span className="text-orange-400 font-bold">{fmt(closeDebtSales)}</span></div>}
                    {closeDebtTotalRecoveredToday > 0 && <div className="flex justify-between"><span className="text-emerald-400 font-sans">Debt Collected Today</span><span className="text-emerald-400 font-bold">{fmt(closeDebtTotalRecoveredToday)}</span></div>}
                  </div>
                  <div className="bg-[rgba(245,158,11,0.1)] border border-[var(--color-accent-amber)] rounded-xl p-4 mb-6">
                    <div className="flex justify-between items-center">
                      <span className="text-[14px] text-[var(--color-accent-amber)] font-bold font-mono">BAL. CASH</span>
                      <span className={`text-[22px] font-bold font-mono ${closeBalanceCash >= 0 ? 'text-[var(--color-accent-amber)]' : 'text-red-400'}`}>{fmt(Math.abs(closeBalanceCash))}</span>
                    </div>
                    <div className="text-[11px] mt-1 text-[rgba(245,158,11,0.7)]">({fmt(closePhysicalCash)} cash-in-hand − {fmt(closeTotalExpenses)} expenses)</div>
                  </div>
                </>
              )}
            </div>
            <div className="flex gap-3" style={{ paddingTop: 16, paddingBottom: 24, flexShrink: 0 }}>
              <button
                disabled={closeSummaryLoading}
                onClick={() => {
                  import('./CargoReceipt').then(m => m.downloadCargoDailySummary({
                    periodStart: periodStart ? new Date(periodStart).toLocaleString('en-GB') : '',
                    periodEnd: periodEnd ? new Date(periodEnd).toLocaleString('en-GB') : '',
                    agentName: user.name,
                    hubName: user.hub,
                    entries: closeEntries.map(t => ({
                      consignee: t.consignee_name,
                      airline: t.airline || '',
                      awb: t.awb_tag_number || '',
                      route: t.route || '',
                      contentType: t.content_type || '',
                      pieces: t.total_pcs,
                      kg: t.total_kg,
                      amount: t.amount,
                      paymentMode: t.receipt_mode,
                      bank: t.bank || undefined,
                    })),
                    totalSales: closeTotalSales,
                    cashSales: closeCashSales,
                    posSales: closePosSales,
                    transferSales: closeTransferSales,
                    debtSales: closeDebtSales,
                    expenses: closeExpenses.map(e => ({ type: e.type, amount: e.amount, description: e.description })),
                    totalExpenses: closeTotalExpenses,
                    balanceCash: closeBalanceCash,
                  }));
                }}
                style={{ flex: 1, padding: 12, background: "transparent", border: "1px solid rgba(245,158,11,0.4)", borderRadius: 8, color: "var(--color-accent-amber)", fontSize: 11, fontFamily: "monospace", fontWeight: "bold", cursor: "pointer" }}
              >
                DOWNLOAD SUMMARY PDF
              </button>
              <button onClick={handleCloseDay} disabled={closingDay || closeSummaryLoading} style={{ flex: 1, padding: 12, background: "var(--color-accent-amber)", border: "none", borderRadius: 8, color: "#0B0F19", fontSize: 11, fontFamily: "monospace", fontWeight: "bold", cursor: closingDay ? "not-allowed" : "pointer", opacity: closingDay ? 0.6 : 1 }}>
                {closingDay ? 'CLOSING…' : 'CONFIRM & CLOSE PERIOD'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
