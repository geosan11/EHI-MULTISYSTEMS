import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Transaction, User } from "../../lib/types";
import {
  CONTENT_TYPES,
  BANKS,
  CARGO_ROUTES,
} from "../../lib/constants";
import { fmt, roundMoney, tnow, generatePickupPin, normalizeAirlineName, getHubCode } from "../../lib/helpers";
import { isTagAlreadyDelivered } from "../../lib/scanLogic";
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
  Download,
} from "lucide-react";
import {
  sendReceiptWhatsApp,
  buildCargoWhatsApp,
} from "../../lib/notifications";
import { supabase } from "../../lib/supabase";
import { useToast } from "../../lib/ToastContext";

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
  corporate_client_id: string;
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
import { PaymentNarrationBox } from "../PaymentNarrationBox";

export const CargoForm = ({
  onAddTx,
  user,
  transactions = [],
  onShowHistory,
}: {
  onAddTx: (tx: Transaction) => void;
  user: User;
  transactions?: Transaction[];
  onShowHistory?: () => void;
}) => {
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

  const generateAwb = () => `AWB-${Math.floor(100000 + Math.random() * 900000)}`;

  // --- STANDARD RETAIL STATES ---
  const [serialNumber, setSerialNumber] = useState<number>(getLocalSerial);
  const [consignee, setConsignee] = useState("Other");
  const [airline, setAirline] = useState("Arik Air");
  const [customAirline, setCustomAirline] = useState("");
  const [customConsignee, setCustomConsignee] = useState("");

  // This is a PREVIEW ONLY -- it shows the agent what the real atomic AWB
  // will likely look like before they submit, without actually consuming
  // a number from the hub's counter (peek_next_awb_number is read-only).
  // The real number is only allocated by next_awb_number() at submit time
  // in handleRetailSubmit, so an abandoned/reset form never wastes a
  // sequence number -- it's just left available for whoever submits next.
  const [awb, setAwb] = useState('');
  const fetchAwbPreview = async () => {
    const hubCode = getHubCode(user.hub_code || user.hub);
    const { data: previewSeq, error } = await supabase.rpc('peek_next_awb_number', { p_hub_code: `${hubCode}-CG` });
    if (!error && previewSeq) {
      setAwb(`EHI-${hubCode}-CG-${String(previewSeq).padStart(6, '0')}`);
    } else {
      setAwb('');
    }
  };
  useEffect(() => { fetchAwbPreview(); }, []);

  const [pcs, setPcs] = useState("1");
  const [kg, setKg] = useState("");
  const [route, setRoute] = useState(CARGO_ROUTES[0]);
  const [contentType, setContentType] = useState(CONTENT_TYPES[0] as string);
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<"Cash" | "Transfer" | "POS" | "Debt">(
    "Cash",
  );
  const [bank, setBank] = useState(BANKS[0] as string);
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
          const saved = localStorage.getItem("ehi_standard_cargo_rates");
          if (saved) setStandardRates(JSON.parse(saved));
          else {
            const initial: Record<string, number> = {};
            CARGO_ROUTES.forEach((r) => (initial[r] = 500));
            setStandardRates(initial);
            localStorage.setItem("ehi_standard_cargo_rates", JSON.stringify(initial));
          }
        }
      } catch (err) {
        const saved = localStorage.getItem("ehi_standard_cargo_rates");
        if (saved) setStandardRates(JSON.parse(saved));
      }
    };
    fetchRates();
  }, []);

  // Compute auto-price from KG × rate — used to pre-fill the amount field.
  // Derived without setState so there is no extra re-render on every keystroke.
  const autoAmount = useMemo(() => {
    const w = Math.round(parseFloat(kg)) || 0;
    const rate = standardRates[route] || 500;
    return w > 0 ? roundMoney(w * rate).toString() : "";
  }, [kg, route, standardRates]);

  const [availableAirlines, setAvailableAirlines] = useState<string[]>([
    "Arik Air",
    "Green Africa Airways",
    "United Nigeria Airlines",
    "Other",
  ]);

  useEffect(() => {
    const loadAirlines = async () => {
      try {
        const { data, error } = await supabase.from('pricing_config')
          .select('config_value')
          .eq('config_key', 'airline_commissions')
          .single();

        if (data && data.config_value && !error) {
          const parsed = data.config_value;
          const keys = Object.keys(parsed);
          if (keys.length > 0) {
            setAvailableAirlines(keys);
            if (!keys.includes(airline)) {
              setAirline(keys[0]);
            }
            localStorage.setItem("ehi_airline_commissions", JSON.stringify(parsed));
          }
        } else {
          const rawCommissions = localStorage.getItem("ehi_airline_commissions");
          if (rawCommissions) {
            const parsed = JSON.parse(rawCommissions);
            const keys = Object.keys(parsed);
            if (keys.length > 0) {
              setAvailableAirlines(keys);
              if (!keys.includes(airline)) {
                setAirline(keys[0]);
              }
            }
          }
        }
      } catch (e) {
        // Ignore
      }
    };
    loadAirlines();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [successTx, setSuccessTx] = useState<Transaction | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const successRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (successTx && successRef.current) {
      // Scroll the nearest scrollable ancestor, not window — avoids iOS jank
      successRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [successTx]);

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

  const [corpRates, setCorpRates] = useState<CorporateRouteRate[]>(() => {
    try {
      if (typeof window === "undefined" || !window.localStorage) {
        const initial = [
          {
            id: "rate_1",
            corporate_client_id: "corp_1",
            route_name: "ABV/Abuja",
            rate_per_kg: 600,
          },
          {
            id: "rate_2",
            corporate_client_id: "corp_1",
            route_name: "BNI/Benin City",
            rate_per_kg: 400,
          },
          {
            id: "rate_3",
            corporate_client_id: "corp_1",
            route_name: "LOS/Lagos",
            rate_per_kg: 350,
          },
          {
            id: "rate_4",
            corporate_client_id: "corp_2",
            route_name: "ABV/Abuja",
            rate_per_kg: 500,
          },
          {
            id: "rate_5",
            corporate_client_id: "corp_2",
            route_name: "BNI/Benin City",
            rate_per_kg: 420,
          },
          {
            id: "rate_6",
            corporate_client_id: "corp_3",
            route_name: "ABV/Abuja",
            rate_per_kg: 650,
          },
          {
            id: "rate_7",
            corporate_client_id: "corp_3",
            route_name: "PHC/Port Harcourt",
            rate_per_kg: 750,
          },
        ];
        return initial;
      }
      const saved = localStorage.getItem("ehi_corporate_route_rates_v2");
      if (saved) return JSON.parse(saved);
      const initial = [
      {
        id: "rate_1",
        corporate_client_id: "corp_1",
        route_name: "ABV/Abuja",
        rate_per_kg: 600,
      },
      {
        id: "rate_2",
        corporate_client_id: "corp_1",
        route_name: "BNI/Benin City",
        rate_per_kg: 400,
      },
      {
        id: "rate_3",
        corporate_client_id: "corp_1",
        route_name: "LOS/Lagos",
        rate_per_kg: 350,
      },
      {
        id: "rate_4",
        corporate_client_id: "corp_2",
        route_name: "ABV/Abuja",
        rate_per_kg: 500,
      },
      {
        id: "rate_5",
        corporate_client_id: "corp_2",
        route_name: "BNI/Benin City",
        rate_per_kg: 420,
      },
      {
        id: "rate_6",
        corporate_client_id: "corp_3",
        route_name: "ABV/Abuja",
        rate_per_kg: 650,
      },
      {
        id: "rate_7",
        corporate_client_id: "corp_3",
        route_name: "PHC/Port Harcourt",
        rate_per_kg: 750,
      },
    ];
    try {
      localStorage.setItem(
        "ehi_corporate_route_rates_v2",
        JSON.stringify(initial),
      );
    } catch (e) {
      /* ignore */
    }
    return initial;
    } catch (e) {
      return [];
    }
  });

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
        const { data } = await supabase
          .from('corporate_clients')
          .select('id, company_name, contact_phone, accumulated_monthly_debt')
          .eq('active', true)
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

  // Options for the Retail Entry Consignee dropdown -- the real corporate
  // client list from Supabase (kept live-synced above), not a hardcoded
  // roster. "Other" always stays last so staff can type a one-off name for
  // a walk-in customer who isn't a registered corporate client.
  const consigneeOptions = useMemo(
    () => [...corpClients.map((c) => c.company_name), "Other"],
    [corpClients],
  );

  // consignee starts on "Other" (see useState above) so the field is never
  // silently defaulted to a hardcoded company name -- once real corporate
  // clients are available (from the localStorage cache on first paint, or
  // the live Supabase fetch above), switch to the first real one so staff
  // aren't stuck manually picking it every time. Skipped if the agent has
  // already started typing a custom name.
  useEffect(() => {
    if (corpClients.length > 0 && consignee === "Other" && !customConsignee) {
      setConsignee(corpClients[0].company_name);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [corpClients]);

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
          .select('id, corporate_client_id, route_name, rate_per_kg');
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
          }));
          setPendingIntakes(mapped);
          localStorage.setItem("ehi_pending_intakes_v2", JSON.stringify(mapped));
        }
      } catch { /* keep local cache if offline */ }
    })();
    return () => { active = false; };
  }, []);

  const [intakeAwb, setIntakeAwb] = useState(generateAwb());
  const [intakePcs, setIntakePcs] = useState("1");
  const [intakeRoute, setIntakeRoute] = useState(CARGO_ROUTES[0]);
  const [intakeContentType, setIntakeContentType] = useState<string>(
    CONTENT_TYPES[0],
  );
  const [intakeSenderPhone, setIntakeSenderPhone] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  // --- PHASE 2 STATE FIELDS ---
  const [selectedIntake, setSelectedIntake] =
    useState<PendingWeighingIntake | null>(null);
  const [gateWeight, setGateWeight] = useState("");
  const [customRateOverwrite, setCustomRateOverwrite] = useState("");
  const [isWeighingSubmitting, setIsWeighingSubmitting] = useState(false);

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
    setIntakeAwb(generateAwb());
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

    // Dynamic Look-up Contract Rates or Fallback baseline (₦500/KG).
    // Uses the stable client ID captured at intake time, not a re-match
    // by company_name -- that name is editable, so a client renamed
    // between intake and this finalize step would have silently broken
    // the old name-based lookup.
    const matchingClientObj = corpClients.find(
      (c) => c.id === selectedIntake.corporate_client_id,
    );
    const contractRateRecord = matchingClientObj
      ? corpRates.find(
          (r) =>
            r.corporate_client_id === matchingClientObj.id &&
            r.route_name === selectedIntake.route,
        )
      : undefined;

    if (customRateOverwrite) {
      const overwriteNum = parseFloat(customRateOverwrite);
      if (isNaN(overwriteNum) || overwriteNum <= 0) {
        showToast({ message: "Custom rate must be a positive number greater than zero.", type: "warning" });
        setIsWeighingSubmitting(false);
        return;
      }
    }

    const rateToUse = customRateOverwrite
      ? parseFloat(customRateOverwrite)
      : contractRateRecord
        ? contractRateRecord.rate_per_kg
        : 500;

    const computedCost = roundMoney(weightNum * rateToUse);

    // Build central ledger transaction record (Debt contract)
    const finalTxDetail = `${selectedIntake.airline} · ${selectedIntake.awb} · ${selectedIntake.pieces}pcs · ${weightNum}KG · ${selectedIntake.route} · ${selectedIntake.contentType}`;

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

    const gateHubCode = getHubCode(user.hub_code || user.hub);
    const { data: gateSeq, error: gateTagError } = await supabase.rpc('next_awb_number', { p_hub_code: `${gateHubCode}-CG` });
    if (gateTagError || !gateSeq) {
      showToast({ message: `Failed to generate reference number: ${gateTagError?.message || 'unknown error'}. Please try again.`, type: "error" });
      setIsWeighingSubmitting(false);
      return;
    }
    const gateResolvedId = `EHI-${gateHubCode}-CG-${String(gateSeq).padStart(6, '0')}`;

    // Block reusing a physical AWB whose previous consignment already
    // completed delivery -- the same check the retail flow already has.
    // This was missing here entirely: a duplicated physical tag lets two
    // shipments share one tracking history, a common consign-fraud
    // pattern, and corporate gate-weighing had no protection against it.
    if (await isTagAlreadyDelivered(selectedIntake.awb)) {
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
      detail: finalTxDetail,
      amount: computedCost,
      mode: "Debt",
      remarks: `Gate Weight Finalized (${rateToUse} ₦/KG Contract). Ref Intake ID: ${selectedIntake.id}`,
      time: tnow(),
      type: "cargo",
      status: "Intake",
      awb_tag_number: selectedIntake.awb,
      airline: selectedIntake.airline,
      commissionRate: gateWeighCommissionRate,
      pieces: selectedIntake.pieces,
      kg: weightNum,
    };

    // 1. Add to central transactions grid
    onAddTx(txEntry);

    // 2. Increment client's monthly accumulated debt balance
    if (matchingClientObj) {
      // Atomic server-side increment (increment_corporate_debt RPC) instead
      // of reading accumulated_monthly_debt from the client-side cache,
      // adding in JS, and writing back the absolute total -- that
      // read-modify-write let two staff finalizing different shipments for
      // the SAME corporate client near-simultaneously both read the same
      // stale balance, and whichever write landed second silently
      // overwrote the first's increment. The transaction itself (onAddTx
      // above) already succeeded either way, so a failure here only warns
      // rather than blocking.
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
          mode: "Debt",
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
  const rate = standardRates[route] || 500;
  const minAmount = roundMoney(w * rate);
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
      contentType.trim().length > 0 &&
      w > 0 &&
      Number.isInteger(piecesNum) && piecesNum > 0 &&
      parsedAmount >= minAmount && parsedAmount > 0,
    [actualConsignee, route, contentType, w, piecesNum, parsedAmount, minAmount],
  );

  const handleRetailSubmit = async () => {
    if (!isRetailFormValid || submitting) return;
    setSubmitting(true);

    const actualAirline = airline === "Other" && customAirline.trim() ? customAirline.trim() : airline;

    // Check if new custom airline needs to be added to db and local state
    if (airline === "Other" && actualAirline) {
      if (!availableAirlines.includes(actualAirline)) {
        const updatedAirlines = [...availableAirlines.filter(a => a !== "Other"), actualAirline, "Other"];
        setAvailableAirlines(updatedAirlines);
        
        try {
          const { data, error } = await supabase.from('pricing_config')
            .select('config_value')
            .eq('config_key', 'airline_commissions')
            .single();

          if (data && data.config_value && !error) {
            const parsed = data.config_value as Record<string, number>;
            parsed[actualAirline] = 5; // Default 5% commission
            await supabase.from('pricing_config').upsert({
              config_key: 'airline_commissions',
              config_value: parsed,
            }, { onConflict: 'config_key' });
            localStorage.setItem("ehi_airline_commissions", JSON.stringify(parsed));
          }
        } catch (e) {
          // Ignore
        }
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
    // The sequence comes from next_awb_number(), an atomic Postgres-side
    // counter per hub_code -- not a client-side "read max, add one" scheme,
    // which would race under concurrent submissions at a busy hub (the same
    // class of bug already fixed once in this project's rate limiter). On
    // failure we surface it directly rather than silently falling back to a
    // random number, which would defeat the whole point of guaranteed
    // per-hub uniqueness.
    const hubCode = getHubCode(user.hub_code || user.hub);
    const { data: awbSeq, error: awbError } = await supabase.rpc('next_awb_number', {
      p_hub_code: `${hubCode}-CG`,
    });
    if (awbError) {
      showToast({ message: `Failed to generate AWB number: ${awbError.message}. Please try again.`, type: "error" });
      setSubmitting(false);
      return;
    }
    const resolvedAwb = `EHI-${hubCode}-CG-${String(awbSeq).padStart(6, '0')}`;

    // Block reusing a tag whose previous consignment already completed
    // delivery -- a duplicated physical tag makes two shipments share one
    // tracking history and is a common consign-fraud pattern.
    if (await isTagAlreadyDelivered(resolvedAwb)) {
      showToast({
        message: `${resolvedAwb} was already delivered on a previous consignment. This tag cannot be reused -- generate a new one.`,
        type: "error",
      });
      setSubmitting(false);
      return;
    }

    const nextSerial = incrementLocalSerial();
    setSerialNumber(nextSerial);

    const summaryStr = `${actualAirline} · ${resolvedAwb} · ${pcs}pcs · ${kg}KG · ${route} · ${contentType}`;

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
      // TODO: capture client_type at entry
    } as Transaction;

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
    setConsignee(consigneeOptions[0] || "Other");
    setCustomConsignee("");
    setAirline(availableAirlines[0] || "Other");
    setCustomAirline("");
    fetchAwbPreview();
    setPcs("1");
    setKg("");
    setRoute(CARGO_ROUTES[0]);
    setContentType(CONTENT_TYPES[0] as string);
    setAmount("");
    setMode("Cash");
    setBank(BANKS[0] as string);
    setRemark("");
    setSenderPhone("");
    setConsigneePhone("");
    setSuccessTx(null);
  };

  const handleDownloadReceipt = async () => {
    if (successTx) {
      const { downloadCargoReceipt } = await import("./CargoReceipt");
      const data = {
        entryRef: successTx.id,
        serialNumber: serialNumber - 1,
        date: new Date().toLocaleDateString("en-GB"),
        hubName: user?.hub || "EHI Cargo Station",
        agentName: user?.name || "EHI Agent",
        airline:
          airline === "Green Africa"
            ? "Green Africa Airways"
            : airline === "United Nigeria"
              ? "United Nigeria Airlines"
              : airline,
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
      downloadCargoReceipt(data);
    }
  };

  const handlePrintReceipt = async () => {
    if (successTx) {
      const { printCargoReceipt } = await import("./CargoReceipt");
      const printData = {
        entryRef: successTx.id,
        serialNumber: serialNumber - 1,
        date: new Date().toLocaleDateString("en-GB"),
        hubName: user?.hub || "EHI Cargo Station",
        agentName: user?.name || "EHI Agent",
        airline:
          airline === "Green Africa"
            ? "Green Africa Airways"
            : airline === "United Nigeria"
              ? "United Nigeria Airlines"
              : airline,
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
      // mobile browsers and installed PWAs require, and gets silently
      // blocked.
      const preOpenedWindow = window.open('', '_blank');
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
          airline:
            airline === "Green Africa"
              ? "Green Africa Airways"
              : airline === "United Nigeria"
                ? "United Nigeria Airlines"
                : airline,
          hubName: user?.hub || "EHI Cargo Station",
          date: new Date().toLocaleDateString("en-GB"),
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
      date: new Date().toLocaleDateString("en-GB"),
      hubName: user?.hub || "EHI Cargo Station",
      agentName: user?.name || "EHI Agent",
      airline:
        airline === "Green Africa"
          ? "Green Africa Airways"
          : airline === "United Nigeria"
            ? "United Nigeria Airlines"
            : airline,
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
              ? "Corporate Debt Invoice Saved!"
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
                  ? "B2B MONTHLY DEBT"
                  : successTx.mode}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-3">
            <button
              onClick={handlePrintReceipt}
              className="py-3.5 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)] text-[var(--color-foreground)] text-[12px] font-sans font-semibold rounded-[var(--radius-sm)] border border-[var(--color-border)] transition-colors cursor-pointer focus:outline-none flex items-center justify-center gap-1.5"
            >
              PDF Receipt
            </button>
            <button
              onClick={handleDownloadReceipt}
              className="py-3.5 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)] text-[var(--color-foreground)] text-[12px] font-sans font-semibold rounded-[var(--radius-sm)] border border-[var(--color-border)] transition-colors cursor-pointer focus:outline-none flex items-center justify-center gap-1.5"
            >
              <Download size={14} /> Download PDF
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
      className="pb-24"
      style={{ width: "100%", boxSizing: "border-box", transform: 'translateZ(0)', WebkitTransform: 'translateZ(0)' }}
    >
      {/* SECTION SELECTOR / HUB MODE NAVIGATION */}
      <div className="px-4 pt-4">
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
          <Users size={16} /> Corporate Contract (B2B)
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
                  <select
                    value={consignee}
                    onChange={(e) => setConsignee(e.target.value)}
                    className={formInputClass}
                  >
                    {consigneeOptions.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  {consignee === "Other" && (
                    <input
                      id="retail-custom-consignee"
                      name="custom-consignee"
                      placeholder="Enter Consignee Name"
                      value={customConsignee}
                      onChange={(e) => setCustomConsignee(e.target.value)}
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
                </div>
              </div>

              <div>
                {renderLabel(Plane, "Airline")}
                <select
                  value={airline}
                  onChange={(e) => setAirline(e.target.value)}
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
                    onChange={(e) => setCustomAirline(e.target.value)}
                    className={`${formInputClass} mt-2`}
                  />
                )}
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

              <div className="flex space-x-3">
                <div className="flex-1">
                  {renderLabel(MapPin, "Route")}
                  <select
                    value={route}
                    onChange={(e) => { setRoute(e.target.value); setAmount(""); }}
                    className={formInputClass}
                  >
                    {CARGO_ROUTES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex-1">
                  {renderLabel(Layers, "Content")}
                  <select
                    value={contentType}
                    onChange={(e) => setContentType(e.target.value)}
                    className={formInputClass}
                  >
                    {CONTENT_TYPES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
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
                {parsedAmount > 0 && parsedAmount < minAmount && (
                  <div className="text-[10px] text-[var(--color-error)] mt-1">Amount cannot be less than ₦{minAmount.toLocaleString()}</div>
                )}
              </div>

              <div>
                {renderLabel(CreditCard, "Receipt / Payment Mode")}
                <div className="flex bg-[var(--color-surface-3)] rounded-[var(--radius-sm)] p-1 border border-[var(--color-border)] mb-3">
                  {["Cash", "Transfer", "POS"].map((m) => (
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
                      className={`flex-1 py-2 text-[13px] font-sans font-semibold rounded-[var(--radius-xs)] shadow-sm transition-all focus:outline-none cursor-pointer`}
                    >
                      {m}
                    </button>
                  ))}
                </div>

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
                    {BANKS.map((b) => (
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
                    {BANKS.map((b) => (
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
                  onChange={(e) => setRemark(e.target.value)}
                  className={formInputClass}
                />
              </div>
            </div>

            <div className="pt-8">
              <button
                onClick={handleRetailSubmit}
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
                    {contentType}
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
                    Log Corporate Pick-Up (No Pricing)
                  </h3>
                </div>

                {successMessage && (
                  <div className="p-3 mb-4 text-[12px] font-sans font-bold text-[var(--color-success)] bg-[rgba(16,185,129,0.1)] border border-[var(--color-success)] rounded flex items-center gap-2">
                    <CheckCircle size={14} /> {successMessage}
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
                        {CARGO_ROUTES.map((r) => (
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
                      {CONTENT_TYPES.map((c) => (
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
                    Today's Registered Pick-ups ({pendingIntakes.length})
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
                          <span className="text-[11px] font-mono text-[var(--color-muted)]">
                            {pi.time}
                          </span>
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
                      All corporate shipments have been weighed and routed.
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
                            <ArrowRight
                              size={16}
                              className={
                                isSelected
                                  ? "text-[var(--color-accent-amber)]"
                                  : "text-[var(--color-muted)]"
                              }
                            />
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
                            ₦
                            {(() => {
                              const matchC = corpClients.find(
                                (c) =>
                                  c.id === selectedIntake.corporate_client_id,
                              );
                              const matchR = matchC
                                ? corpRates.find(
                                    (r) =>
                                      r.corporate_client_id === matchC.id &&
                                      r.route_name === selectedIntake.route,
                                  )
                                : null;
                              return matchR
                                ? matchR.rate_per_kg
                                : "500.00 (Baseline)";
                            })()}
                            /KG
                          </span>
                        </div>

                        {/* RBAC OVERWRITE PRICING LOCK */}
                        {isAuthorizedRole ? (
                          <div className="pt-2 border-t border-[var(--color-border)]">
                            <label htmlFor="cargo-custom-rate-overwrite" className="text-[10px] text-[var(--color-muted)] block mb-1.5">
                              Admin Custom Rate Overwrite (₦/KG):
                            </label>
                            <input
                              id="cargo-custom-rate-overwrite"
                              type="number"
                              placeholder="Leave empty for default"
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

                        <div className="pt-3 mt-1 border-t border-[var(--color-surface-2)] flex justify-between items-center">
                          <span className="text-[12px] font-sans text-[var(--color-muted)] font-medium uppercase tracking-wider">
                            Computed Bill
                          </span>
                          <span className="text-[18px] text-[var(--color-accent-amber)] font-bold">
                            ₦
                            {(() => {
                              const matchC = corpClients.find(
                                (c) =>
                                  c.id === selectedIntake.corporate_client_id,
                              );
                              const matchR = matchC
                                ? corpRates.find(
                                    (r) =>
                                      r.corporate_client_id === matchC.id &&
                                      r.route_name === selectedIntake.route,
                                  )
                                : null;
                              const rate = customRateOverwrite
                                ? parseFloat(customRateOverwrite)
                                : matchR
                                  ? matchR.rate_per_kg
                                  : 500;
                              const weight = Math.round(parseFloat(gateWeight)) || 0;
                              return (weight * rate).toLocaleString("en-NG", {
                                maximumFractionDigits: 2,
                              });
                            })()}
                          </span>
                        </div>
                      </div>

                      <div className="text-[11px] text-[var(--color-error)] bg-[rgba(239,68,68,0.03)] p-2 rounded border border-[rgba(239,68,68,0.1)] leading-snug flex items-start gap-1.5">
                        <Zap size={14} className="shrink-0 mt-0.5" /> 
                        <span>
                          PL/pgSQL database trigger will automatically book
                          this finalized amount to the client's monthly master
                          debt profile balance.
                        </span>
                      </div>
                    </div>

                    <button
                      onClick={handleFinalizeWeighing}
                      disabled={!gateWeight || isWeighingSubmitting}
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
                      Select any corporate pick-up booking from the left queue
                      to place items on the commercial yard scale.
                    </p>
                  </div>
                )}

                <div className="bg-[var(--color-surface-2)] p-4 rounded border border-[var(--color-border)] mt-4">
                  <h5 className="text-[12px] font-bold text-[var(--color-foreground)] mb-2 flex items-center gap-1">
                    <ShieldAlert size={14} className="text-[var(--color-accent-amber)]" />
                    B2B Scaling Rules
                  </h5>
                  <p className="text-[11px] text-[var(--color-light-muted)] leading-relaxed">
                    Weights verified on our gate scale are definitive (no manual
                    estimation allowed). Payment modes on corporate custom
                    accounts automatically bill monthly to prevent yard queuing
                    blocks.
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
