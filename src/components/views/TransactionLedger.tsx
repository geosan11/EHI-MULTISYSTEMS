import { useState, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Transaction, User, Expense } from "../../lib/types";
import { fmt, tnow, isStandalonePWA, getHubCode, getShiftBoundary } from "../../lib/helpers";
import { MIN_PACKAGE_AMOUNT } from "../../lib/constants";
import { useContentTypes } from "../../lib/contentTypes";
import { useBanks } from "../../lib/banks";
import { BackButton } from "../BackButton";
import {
  Edit2,
  X,
  Check,
  Filter,
  Search,
  QrCode,
  CheckSquare,
  Package,
  Plane,
  TrendingUp,
  Minus,
  ChevronRight,
  Download,
  Printer,
  HandCoins,
  Clock,
} from "lucide-react";
import { QRCode } from "../QRCode";
import TagPrintHistory from "./TagPrintHistory";
import { supabase } from "../../lib/supabase";
import { useToast } from "../../lib/ToastContext";
import { useConfirm } from "../../lib/ConfirmContext";

type Entry = {
  id: string;
  time: string;
  type: string;
  name: string;
  detail: string;
  amount: number;
  mode: string;
  status: string;
  source: "transaction" | "expense";
  raw: any;
  paymentConfirmed?: boolean;
  posApprovalCode?: string;
};

export const TransactionLedger = ({
  user,
  transactions,
  expenses = [],
  onBack,
  onUpdateTx,
  defaultTypeFilter,
  viewOnly = false,
  dateRange,
  onDateRangeChange,
}: {
  user: User;
  transactions: Transaction[];
  expenses?: Expense[];
  onBack: () => void;
  onUpdateTx: (tx: Transaction) => void;
  defaultTypeFilter?: 'cargo' | 'baggage' | 'marketing' | null;
  viewOnly?: boolean;
  dateRange?: { start: string; end: string };
  onDateRangeChange?: (range: { start: string; end: string }) => void;
}) => {
  const contentTypes = useContentTypes();
  const banks = useBanks();
  const [showPrintHistory, setShowPrintHistory] = useState(false);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  // Marketing entries store bag counts inside the composed `detail` string,
  // not as discrete Transaction fields, so the edit modal keeps its own
  // working copy (seeded by parsing `detail` in handleEditClick) and
  // reassembles `detail` from it in handleSaveEdit.
  const [editBagCounts, setEditBagCounts] = useState({ bb: '0', mb: '0', sb: '0' });
  // Pieces/weight/amount are edited as plain strings, not numbers, and only
  // parsed in handleSaveEdit -- binding a number input's value directly to a
  // number forces every keystroke through parseFloat/parseInt and back into
  // the input, which silently eats a trailing decimal point (typing "99."
  // re-renders as "99", so the next digit lands after the whole number
  // instead of after the point) and made editing an existing amount unreliable.
  const [pieceInput, setPieceInput] = useState('');
  const [kgInput, setKgInput] = useState('');
  const [amountInput, setAmountInput] = useState('');
  const [viewingQrTx, setViewingQrTx] = useState<Entry | null>(null);
  const [viewingDetail, setViewingDetail] = useState<Entry | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState(defaultTypeFilter || "All");
  const [modeFilter, setModeFilter] = useState("All");
  const [timeFilter, setTimeFilter] = useState<"All" | "Morning" | "Afternoon" | "Evening" | "Custom">("All");
  const [timeStart, setTimeStart] = useState("");
  const [timeEnd, setTimeEnd] = useState("");
  const [posCodeInput, setPosCodeInput] = useState<{ id: string; code: string }>({ id: '', code: '' });
  const [vjFlightFilter, setVjFlightFilter] = useState("All");
  const [vjDestFilter, setVjDestFilter] = useState("All");
  // 'current' = only entries within the current operational shift (7PM–7PM).
  // 'all' = unfiltered by shift (shows all loaded transactions as before).
  const [shiftFilter, setShiftFilter] = useState<'current' | 'all'>('current');
  const { showToast } = useToast();
  const confirm = useConfirm();

  // Current shift boundary — hub shift_start_hour from user object, default 19
  const shiftHour: number = (user as any).shift_start_hour ?? 19;
  const shiftBoundary = useMemo(() => getShiftBoundary(shiftHour), [shiftHour]);

  const entries = useMemo(() => {
    const list: Entry[] = [
      ...transactions.map((t) => ({
        ...t,
        source: "transaction" as const,
        raw: t,
        _sortTime: t.created_at ? new Date(t.created_at).getTime() : 0,
      })),
      ...expenses.map((e) => ({
        id: e.id,
        time: e.time,
        type: "expense",
        name: e.type || 'Expense',
        detail: e.logged_by ? `${e.description} (Logged by: ${e.logged_by})` : e.description,
        amount: e.amount,
        mode: e.mode || "Expense",
        status: e.status || "N/A",
        source: "expense" as const,
        raw: e,
        paymentConfirmed: e.posApprovalCode ? true : false,
        posApprovalCode: e.posApprovalCode,
        _sortTime: e.time ? new Date(e.time).getTime() : 0,
      })),
    ];
    return list.sort((a: any, b: any) => {
      const timeA = a._sortTime || 0;
      const timeB = b._sortTime || 0;
      
      // If both have timestamps, sort descending
      if (timeA && timeB) {
        return timeB - timeA;
      }
      
      // Fallback to alphabetical sorting by time string if both lack timestamps
      if (a.time > b.time) return -1;
      if (a.time < b.time) return 1;
      return 0;
    });
  }, [transactions, expenses]);

  const filteredEntries = useMemo(() => entries.filter((e) => {
    if (typeFilter !== "All" && e.type !== typeFilter.toLowerCase())
      return false;

    if (typeFilter.toLowerCase() === 'baggage' && e.source === 'transaction') {
      const tx = e.raw as Transaction;
      if (vjFlightFilter !== "All" && tx.flight !== vjFlightFilter) return false;
      if (vjDestFilter !== "All" && tx.destination !== vjDestFilter) return false;
    }

    if (modeFilter !== "All") {
      if (modeFilter === "Revenue") {
        if (e.source === "expense" || e.mode === "Debt") return false;
      } else if (modeFilter === "Expense") {
        if (e.source !== "expense") return false;
      } else if (modeFilter === "Unverified") {
        if (!((e.mode === 'Cash' || e.mode === 'Transfer') && !e.raw.paymentConfirmed)) return false;
      } else {
        if (e.mode.toLowerCase() !== modeFilter.toLowerCase()) return false;
      }
    }

    if (timeFilter !== "All") {
      const tm = ((): { hour: number; minute: number } | null => {
        if (e.raw?.created_at) {
          const d = new Date(e.raw.created_at);
          if (!isNaN(d.getTime())) return { hour: d.getHours(), minute: d.getMinutes() };
        }
        if ((e as any)._sortTime && (e as any)._sortTime > 0) {
          const d = new Date((e as any)._sortTime);
          if (!isNaN(d.getTime())) return { hour: d.getHours(), minute: d.getMinutes() };
        }
        if (e.time) {
          const match = e.time.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
          if (match) {
            let h = parseInt(match[1], 10);
            const m = parseInt(match[2], 10);
            const ampm = match[3]?.toUpperCase();
            if (ampm === 'PM' && h < 12) h += 12;
            if (ampm === 'AM' && h === 12) h = 0;
            return { hour: h, minute: m };
          }
        }
        return null;
      })();

      if (tm) {
        const totalMins = tm.hour * 60 + tm.minute;
        if (timeFilter === "Morning") {
          // 06:00 to 11:59 (360 to 719 mins)
          if (totalMins < 360 || totalMins >= 720) return false;
        } else if (timeFilter === "Afternoon") {
          // 12:00 to 16:59 (720 to 1019 mins)
          if (totalMins < 720 || totalMins >= 1020) return false;
        } else if (timeFilter === "Evening") {
          // 17:00 to 23:59 (1020 to 1439 mins)
          if (totalMins < 1020) return false;
        } else if (timeFilter === "Custom") {
          if (timeStart) {
            const [sh, sm] = timeStart.split(':').map(Number);
            const startMins = (sh || 0) * 60 + (sm || 0);
            if (totalMins < startMins) return false;
          }
          if (timeEnd) {
            const [eh, em] = timeEnd.split(':').map(Number);
            const endMins = (eh || 0) * 60 + (em || 0);
            if (totalMins > endMins) return false;
          }
        }
      }
    }

    // Shift filter — only show entries inside the current operational shift
    // when shiftFilter === 'current'. This is the key fix that replaces the
    // implicit "today since midnight" assumption with the real 7PM–7PM window.
    if (shiftFilter === 'current') {
      const { start, end } = shiftBoundary;
      const entryTime = e.raw?.created_at
        ? new Date(e.raw.created_at)
        : (e as any)._sortTime
        ? new Date((e as any)._sortTime)
        : null;
      if (entryTime && (entryTime < start || entryTime >= end)) return false;
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const raw = e.raw as any;
      const text =
        `${e.id} ${e.time} ${e.type} ${e.name} ${e.detail} ${e.mode} ${raw.awb_tag_number || ''} ${raw.route || ''}`.toLowerCase();
      if (!text.includes(q)) return false;
    }

    return true;
  }), [entries, typeFilter, modeFilter, timeFilter, timeStart, timeEnd, searchQuery, shiftFilter, shiftBoundary, vjFlightFilter, vjDestFilter]);

  const handleEditClick = (e: Entry, evt: React.MouseEvent) => {
    evt.stopPropagation();
    if (e.source === "transaction") {
      const tx = { ...e.raw } as Transaction;
      setEditingTx(tx);
      setPieceInput(String(tx.pieces ?? ''));
      setKgInput(String(tx.kg ?? ''));
      setAmountInput(String(tx.amount ?? ''));
      if (tx.type === 'marketing') {
        const bagsStr = tx.detail?.split(' · ')[1] || '';
        setEditBagCounts({
          bb: bagsStr.match(/(\d+)\s*BB/)?.[1] || '0',
          mb: bagsStr.match(/(\d+)\s*MB/)?.[1] || '0',
          sb: bagsStr.match(/(\d+)\s*SB/)?.[1] || '0',
        });
      }
    }
  };

  const handleSaveEdit = () => {
    if (!editingTx) return;
    const pieces = parseInt(pieceInput) || 0;
    const kg = parseFloat(kgInput) || 0;
    const amount = parseFloat(amountInput) || 0;
    const bb = parseInt(editBagCounts.bb) || 0;
    const mb = parseInt(editBagCounts.mb) || 0;
    const sb = parseInt(editBagCounts.sb) || 0;
    if (amount < 0 || pieces < 0 || kg < 0 || bb < 0 || mb < 0 || sb < 0) {
      showToast({ message: 'Amount, pieces, weight, and bag counts cannot be negative.', type: 'warning' });
      return;
    }
    if (editingTx.type === 'package' && amount < MIN_PACKAGE_AMOUNT) {
      showToast({ message: `Package/Parcel transactions must have an amount of at least ₦${MIN_PACKAGE_AMOUNT.toLocaleString()}`, type: 'warning' });
      return;
    }
    // Details fields (name, route, pieces, weight, etc.) are edited as
    // discrete fields, but `detail` is the composed string the rest of the
    // app (ledger rows, receipts) displays -- rebuild it here so the
    // optimistic local update stays consistent with what a refetch from
    // Supabase will later reconstruct (see EHIApp.tsx's fetchInitial).
    const finalTx: Transaction = { ...editingTx, pieces, kg, amount };
    if (finalTx.type === 'cargo') {
      finalTx.detail = `${finalTx.airline || ''} · ${finalTx.awb_tag_number || ''} · ${pieces}pcs · ${kg}kg · ${finalTx.route || ''} · ${finalTx.contentType || ''}`;
    } else if (finalTx.type === 'baggage') {
      finalTx.detail = `${finalTx.flight || ''} · ${finalTx.destination || ''} · ${pieces}pcs · +${finalTx.excessKg || 0}kg excess`;
    } else if (finalTx.type === 'marketing') {
      finalTx.detail = `${finalTx.route || ''} · ${bb}BB ${mb}MB ${sb}SB`;
      (finalTx as any)._bb = bb;
      (finalTx as any)._mb = mb;
      (finalTx as any)._sb = sb;
    } else if (finalTx.type === 'package') {
      finalTx.detail = `${finalTx.destination || ''} · ${finalTx.contentType || 'Package'} · ${pieces}pcs · ${kg}kg${finalTx.contents ? ` · ${finalTx.contents}` : ''}`;
    }
    onUpdateTx(finalTx);
    setEditingTx(null);
  };

  const handleReprintReceipt = async (width: '58mm' | '80mm') => {
    if (!viewingDetail || !viewingDetail.raw) return;
    const tx = viewingDetail.raw;
    if (tx.type !== 'cargo' && tx.type !== 'baggage' && tx.type !== 'marketing' && tx.type !== 'package') return;

    try {
      // printViaBluetooth connects to the printer FIRST, before this
      // callback (which compiles the receipt -- loading logo images,
      // drawing canvas, generating a QR code) ever runs, so compiling
      // can't burn through the click's Bluetooth permission window.
      const { printViaBluetooth } = await import('../../lib/escpos');
      await printViaBluetooth(async () => {
        if (tx.type === 'cargo') {
          const { compileCargoReceiptStream } = await import('../../lib/escposCargoReceiptPrinting');
          return await compileCargoReceiptStream({
            entryRef: tx.id,
            serialNumber: 0,
            date: tx.time,
            hubName: tx.hub || user.hub,
            agentName: tx.enteredByName || user.name,
            airline: tx.airline || "Unknown",
            consignee: tx.consignee || tx.name,
            awbTagNumber: tx.awb_tag_number || "N/A",
            pieces: tx.pieces || 1,
            kg: tx.kg || 1,
            route: tx.route || "Unknown",
            contentType: tx.detail?.split(" · ")[5] || "General Goods",
            amount: tx.amount,
            paymentMode: tx.mode,
            bankName: tx.bank,
            pickupPin: tx.pickupPin,
            trackingUrl: `https://app.ehimultisystems.com/track/${tx.id}`,
          }, width);
        } else if (tx.type === 'baggage') {
          const { compileBaggageReceiptStream } = await import('../../lib/escposBaggagePrinting');
          return await compileBaggageReceiptStream({
            airlineName: tx.airline || 'ValueJet',
            entryRef: tx.id,
            date: tx.time,
            originState: tx.hub || user.hub,
            agentName: tx.enteredByName || user.name,
            passengerName: tx.name,
            flight: tx.flight || "Unknown",
            destination: tx.destination || "Unknown",
            totalPieces: tx.pieces || 1,
            totalWeightKg: tx.totalKg || tx.kg || 0,
            freeAllowanceKg: (tx.totalKg || 0) - (tx.excessKg || 0),
            excessChargeKg: tx.excessKg || 0,
            ratePerKg: (tx.excessKg || 0) > 0 ? Math.round(tx.amount / tx.excessKg!) : 0,
            amount: tx.amount,
            paymentMode: tx.mode,
            trackingUrl: `https://app.ehimultisystems.com/track/${tx.id}`,
          }, width);
        } else if (tx.type === 'package') {
          const { compilePackageReceiptStream } = await import('../../lib/escposPackagePrinting');
          return await compilePackageReceiptStream({
            entryRef: tx.entryRef || tx.id,
            date: tx.time,
            agentName: tx.enteredByName || user.name,
            customerName: tx.name,
            phone: tx.consigneePhone || tx.phone,
            destination: tx.destination || tx.route || 'Destination',
            contentType: tx.contentType || 'Package',
            pieces: tx.pieces || 1,
            kg: tx.kg || 0,
            contents: (tx as any).contents,
            amount: tx.amount,
            paymentMode: tx.mode,
            paymentNarration: tx.paymentNarration,
            bankName: tx.bank,
            trackingUrl: `https://app.ehimultisystems.com/track/${tx.id}`,
          }, width);
        } else {
          // tx.type === 'marketing' -- guaranteed by the early return above
          const { compileMarketingReceiptStream } = await import('../../lib/escposMarketingPrinting');
          const parts = tx.detail?.split(' · ') || [];
          let route = parts[0] || 'Unknown';
          let big = 0, med = 0, small = 0;
          if (parts[1]) {
            // MarketingWorkspace stores bag counts as e.g. "2BB 1MB 3SB"
            // (see handleAddEntry) -- any subset present, space-separated,
            // no comma. Match each code independently rather than one
            // fixed "X Big, Y Med, Z Sml" pattern, which never matched the
            // actual stored format and made every reprinted marketing
            // receipt show an empty Bag Breakdown regardless of what was
            // actually sold.
            const bigMatch = parts[1].match(/(\d+)BB/);
            const medMatch = parts[1].match(/(\d+)MB/);
            const smallMatch = parts[1].match(/(\d+)SB/);
            big = bigMatch ? parseInt(bigMatch[1]) : 0;
            med = medMatch ? parseInt(medMatch[1]) : 0;
            small = smallMatch ? parseInt(smallMatch[1]) : 0;
          }
          return await compileMarketingReceiptStream({
            entryRef: tx.id,
            date: tx.time,
            agentName: tx.enteredByName || user.name,
            customerName: tx.name,
            phone: tx.remarks || '',
            route: route,
            bigBags: big,
            medBags: med,
            smallBags: small,
            amount: tx.amount,
            paymentMode: tx.mode,
            paymentNarration: tx.paymentNarration,
            bankName: tx.bank,
            trackingUrl: `https://app.ehimultisystems.com/track/${tx.id}`,
          }, width);
        }
      });
    } catch (error: any) {
      console.error('Error printing receipt:', error);
      showToast({ message: error?.message || 'Error connecting to Bluetooth printer. Ensure it is paired and on.', type: 'error' });
    }
  };

  // Opens the same PDF receipt already used by CargoForm/ExcessBaggageForm's
  // point-of-sale success screens, rebuilt from the historical Transaction --
  // unlike handleReprintReceipt above, this needs no Bluetooth printer, just
  // a normal browser tab (to view, save, print on any printer, or email).
  const handleReprintReceiptPDF = async () => {
    if (!viewingDetail || !viewingDetail.raw) return;
    const tx = viewingDetail.raw;
    if (tx.type !== 'cargo' && tx.type !== 'baggage' && tx.type !== 'package') return;

    try {
      if (tx.type === 'cargo') {
        const { printCargoReceipt } = await import('./CargoReceipt');
        await printCargoReceipt({
          entryRef: tx.id,
          serialNumber: 0,
          date: tx.time,
          hubName: tx.hub || user.hub,
          agentName: tx.enteredByName || user.name,
          airline: tx.airline || 'Unknown',
          consignee: tx.consignee || tx.name,
          awbTagNumber: tx.awb_tag_number || 'N/A',
          pieces: tx.pieces || 1,
          kg: tx.kg || 1,
          route: tx.route || 'Unknown',
          contentType: tx.detail?.split(' · ')[5] || 'General Goods',
          amount: tx.amount,
          paymentMode: tx.mode,
          bankName: tx.bank,
          paymentNarration: tx.paymentNarration,
          remark: tx.remarks,
          pickupPin: tx.pickupPin,
        });
      } else if (tx.type === 'package') {
        const { downloadPackageReceipt } = await import('./PackageReceipt');
        await downloadPackageReceipt({
          entryRef: tx.entryRef || tx.id,
          date: `${tx.created_at ? new Date(tx.created_at).toLocaleDateString('en-GB') : new Date().toLocaleDateString('en-GB')} ${tx.time || tnow()}`,
          agentName: tx.enteredByName || user.name,
          customerName: tx.name,
          phone: tx.consigneePhone || tx.phone,
          destination: tx.destination || tx.route || 'Destination',
          contentType: tx.contentType || 'Package',
          pieces: tx.pieces || 1,
          kg: tx.kg || 0,
          contents: (tx as any).contents,
          amount: tx.amount,
          paymentMode: tx.mode,
          paymentNarration: tx.paymentNarration,
          bankName: tx.bank,
        });
      } else {
        const { printBaggageReceipt } = await import('./ExcessBaggageReceipt');
        await printBaggageReceipt({
          airlineName: tx.airline || 'ValueJet',
          entryRef: tx.id,
          date: tx.time,
          hubName: tx.hub || user.hub,
          agentName: tx.enteredByName || user.name,
          passengerName: tx.name,
          flightNumber: tx.flight || 'Unknown',
          destination: tx.destination || 'Unknown',
          totalPieces: tx.pieces || 1,
          totalBaggage: tx.totalKg || tx.kg || 0,
          freeAllowance: (tx.totalKg || 0) - (tx.excessKg || 0),
          excessKg: tx.excessKg || 0,
          ratePerKg: (tx.excessKg || 0) > 0 ? Math.round(tx.amount / tx.excessKg!) : 0,
          amount: tx.amount,
          paymentMode: tx.mode,
          paymentNarration: tx.paymentNarration,
          bankName: tx.bank,
        });
      }
    } catch (error: any) {
      console.error('Error generating PDF receipt:', error);
      showToast({ message: error?.message || 'Failed to generate PDF receipt.', type: 'error' });
    }
  };

  const handleReprintTag = async (width: '58mm' | '80mm') => {
    // Change: use wired PDF tag printing (opens PDF in new tab / OS print dialog)
    if (!viewingDetail || !viewingDetail.raw) return;
    // Open the tab synchronously, in direct response to the click --
    // window.open() called after the awaits below (dynamic import, QR
    // generation, PDF rendering) loses the user-gesture context that
    // mobile browsers require, and gets silently blocked. Skipped
    // entirely in an installed/standalone PWA though: window.open() there
    // hands off to a separate browser process immediately (see
    // isStandalonePWA's comment in helpers.ts) -- that hand-off IS the
    // "jumps out to the browser" bug, and closing the window afterward
    // once openPdfOrDownload detects standalone mode doesn't undo it.
    const preOpenedWindow = isStandalonePWA() ? null : window.open('', '_blank');
    try {
      const tx = { ...viewingDetail.raw };

      if (tx.type === 'package') {
        const { printPackageTagPDF } = await import('./PackageTagPDF');
        const data = {
          id: tx.awb_tag_number || tx.entryRef || tx.id,
          name: tx.name,
          destination: tx.destination || tx.route || 'Destination',
          contentType: tx.contentType || 'Package',
          pieces: tx.pieces || 1,
          kg: tx.kg || 0,
          contents: (tx as any).contents,
          hubName: user?.hub || 'EHI Station',
          date: `${tx.created_at ? new Date(tx.created_at).toLocaleDateString('en-GB') : new Date().toLocaleDateString('en-GB')} ${tx.time || tnow()}`,
        };

        await printPackageTagPDF(data, preOpenedWindow);

        try {
          await supabase.from('tag_print_log').insert({
            cargo_ref: tx.id,
            awb_tag_number: data.id,
            printed_by: user.id,
            printed_by_name: user.name,
            hub_id: user.hub_id,
            hub_name: user.hub || 'Unknown',
            print_method: 'pdf',
            pieces_printed: tx.pieces || 1,
          });
        } catch (err) {
          console.error('Failed to log tag print', err);
        }
        return;
      }

      // Marketing entries print one bag-aware tag per bag (BB/MB/SB
      // badges), matching what MarketingWorkspace's own "TAGS" buttons
      // produce right after creating the entry. This used to route
      // through the generic CargoTagPDF instead -- collapsing every bag
      // into a single undifferentiated "PIECE 1 of N" tag with no bag-type
      // info -- so a tag reprinted from the ledger looked like a
      // completely different document than the one printed at creation
      // time.
      if (tx.type === 'marketing') {
        const { printMarketingTagPDF } = await import('./MarketingTagPDF');
        const parts = tx.detail?.split(' · ') || [];
        const route = parts[0] || tx.route || 'Unknown';
        // Same stored format as handleReprintReceipt above -- e.g. "2BB
        // 1MB 3SB", not "2 Big, 1 Med, 3 Sml".
        const bigMatch = parts[1]?.match(/(\d+)BB/);
        const medMatch = parts[1]?.match(/(\d+)MB/);
        const smallMatch = parts[1]?.match(/(\d+)SB/);
        const big = bigMatch ? parseInt(bigMatch[1]) : 0;
        const med = medMatch ? parseInt(medMatch[1]) : 0;
        const small = smallMatch ? parseInt(smallMatch[1]) : 0;

        const data = {
          id: tx.awb_tag_number || tx.entryRef || tx.id,
          name: tx.name,
          route,
          airline: tx.airline,
          hubName: user?.hub || 'EHI Cargo Station',
          date: `${tx.created_at ? new Date(tx.created_at).toLocaleDateString('en-GB') : new Date().toLocaleDateString('en-GB')} ${tx.time || tnow()}`,
          bigBags: big,
          medBags: med,
          smallBags: small,
        };

        await printMarketingTagPDF(data, preOpenedWindow);

        try {
          await supabase.from('tag_print_log').insert({
            cargo_ref: tx.id,
            awb_tag_number: data.id,
            printed_by: user.id,
            printed_by_name: user.name,
            hub_id: user.hub_id,
            hub_name: user.hub || 'Unknown',
            print_method: 'pdf',
            pieces_printed: big + med + small || 1,
          });
        } catch (err) {
          console.error('Failed to log tag print', err);
        }
        return;
      }

      const { printCargoTagPDF } = await import('./CargoTagPDF');
      const route = tx.route || (tx.detail ? tx.detail.split(' · ')[4] : 'Unknown') || 'Unknown';
      const data = {
        id: tx.awb_tag_number || tx.entryRef || tx.id,
        name: tx.name,
        route: route || 'Unknown',
        pieces: tx.pieces || 1,
        weight: tx.kg || 0,
        airline: tx.airline,
        hubName: user?.hub || 'EHI Cargo Station',
        date: `${tx.created_at ? new Date(tx.created_at).toLocaleDateString('en-GB') : new Date().toLocaleDateString('en-GB')} ${tx.time || tnow()}`,
        contentType: tx.contentType || (tx.detail ? tx.detail.split(' · ')[5] : undefined),
      };

      await printCargoTagPDF(data, preOpenedWindow);

      try {
        await supabase.from('tag_print_log').insert({
          cargo_ref: tx.id,
          awb_tag_number: data.id,
          printed_by: user.id,
          printed_by_name: user.name,
          hub_id: user.hub_id,
          hub_name: user.hub || 'Unknown',
          print_method: 'pdf',
          pieces_printed: tx.pieces || 1,
        });
      } catch (err) {
        console.error('Failed to log tag print', err);
      }
    } catch (error) {
      console.error('Error opening tag PDF:', error);
      preOpenedWindow?.close();
      showToast({ message: 'Failed to open tag PDF for printing', type: 'error' });
    }
  };

  const handleReprintTagPDF = async () => {
    if (!viewingDetail || !viewingDetail.raw) return;
    if (viewingDetail.raw.type !== 'cargo' && viewingDetail.raw.type !== 'marketing' && viewingDetail.raw.type !== 'package') {
      showToast({ message: 'PDF Tag only available for cargo, marketing, and package entries', type: 'info' });
      return;
    }
    const preOpenedWindow = isStandalonePWA() ? null : window.open('', '_blank');
    try {
      const tx = { ...viewingDetail.raw };

      if (tx.type === 'package') {
        const { printPackageTagPDF } = await import('./PackageTagPDF');
        const data = {
          id: tx.awb_tag_number || tx.entryRef || tx.id,
          name: tx.name,
          destination: tx.destination || tx.route || 'Destination',
          contentType: tx.contentType || 'Package',
          pieces: tx.pieces || 1,
          kg: tx.kg || 0,
          contents: (tx as any).contents,
          hubName: user?.hub || 'EHI Station',
          date: `${tx.created_at ? new Date(tx.created_at).toLocaleDateString('en-GB') : new Date().toLocaleDateString('en-GB')} ${tx.time || tnow()}`,
        };

        await printPackageTagPDF(data, preOpenedWindow);

        try {
          await supabase.from('tag_print_log').insert({
            cargo_ref: tx.id,
            awb_tag_number: data.id,
            printed_by: user.id,
            printed_by_name: user.name,
            hub_id: user.hub_id,
            hub_name: user.hub || 'Unknown',
            print_method: 'pdf',
            pieces_printed: tx.pieces || 1,
          });
        } catch (err) {
          console.error('Failed to log tag print', err);
        }
        return;
      }

      // Same bag-aware format as handleReprintTag above -- see its comment
      // for why marketing entries can't use the generic CargoTagPDF.
      if (tx.type === 'marketing') {
        const { printMarketingTagPDF } = await import('./MarketingTagPDF');
        const parts = tx.detail?.split(' · ') || [];
        const route = parts[0] || tx.route || 'Unknown';
        const bigMatch = parts[1]?.match(/(\d+)BB/);
        const medMatch = parts[1]?.match(/(\d+)MB/);
        const smallMatch = parts[1]?.match(/(\d+)SB/);
        const big = bigMatch ? parseInt(bigMatch[1]) : 0;
        const med = medMatch ? parseInt(medMatch[1]) : 0;
        const small = smallMatch ? parseInt(smallMatch[1]) : 0;

        const data = {
          id: tx.awb_tag_number || tx.entryRef || tx.id,
          name: tx.name,
          route,
          airline: tx.airline,
          hubName: user?.hub || 'EHI Cargo Station',
          date: `${tx.created_at ? new Date(tx.created_at).toLocaleDateString('en-GB') : new Date().toLocaleDateString('en-GB')} ${tx.time || tnow()}`,
          bigBags: big,
          medBags: med,
          smallBags: small,
        };

        await printMarketingTagPDF(data, preOpenedWindow);

        try {
          await supabase.from('tag_print_log').insert({
            cargo_ref: tx.id,
            awb_tag_number: data.id,
            printed_by: user.id,
            printed_by_name: user.name,
            hub_id: user.hub_id,
            hub_name: user.hub || 'Unknown',
            print_method: 'pdf',
            pieces_printed: big + med + small || 1,
          });
        } catch (err) {
          console.error('Failed to log tag print', err);
        }
        return;
      }

      const { printCargoTagPDF } = await import('./CargoTagPDF');
      const route = tx.route || (tx.detail ? tx.detail.split(' · ')[4] : 'Unknown') || 'Unknown';
      const data = {
        id: tx.awb_tag_number || tx.entryRef || tx.id,
        name: tx.name,
        route: route,
        pieces: tx.pieces || 1,
        weight: tx.kg || 0,
        airline: tx.airline,
        hubName: user?.hub || 'EHI Cargo Station',
        date: `${tx.created_at ? new Date(tx.created_at).toLocaleDateString('en-GB') : new Date().toLocaleDateString('en-GB')} ${tx.time || tnow()}`,
        contentType: tx.contentType || (tx.detail ? tx.detail.split(' · ')[5] : undefined),
      };

      await printCargoTagPDF(data, preOpenedWindow);

      try {
        await supabase.from('tag_print_log').insert({
          cargo_ref: tx.id,
          awb_tag_number: data.id,
          printed_by: user.id,
          printed_by_name: user.name,
          hub_id: user.hub_id,
          hub_name: user.hub || 'Unknown',
          print_method: 'pdf',
          pieces_printed: tx.pieces || 1,
        });
      } catch (err) {
        console.error('Failed to log tag print', err);
      }
    } catch (err) {
      console.error('Error printing tag PDF:', err);
      preOpenedWindow?.close();
      showToast({ message: 'Failed to open tag PDF', type: 'error' });
    }
  };

  const toggleConfirm = (e: Entry, evt: React.MouseEvent) => {
    evt.stopPropagation();
    if (e.source !== 'transaction') return;
    // Maker-checker: whoever logged the sale can't be the one confirming
    // the money actually came in. PaymentValidation.tsx's Transfer confirm
    // already enforced this; Cash/Transfer are unified here now, so both
    // get the same rule.
    if (!e.raw.paymentConfirmed && e.raw.enteredByName && e.raw.enteredByName === user.name) {
      showToast({ message: "You can't confirm a payment you personally logged.", type: 'warning' });
      return;
    }
    const updated = { ...e.raw };
    if (!e.raw.paymentConfirmed) {
      updated.paymentConfirmed = true;
      updated.confirmedAt = new Date().toISOString();
      updated.confirmedBy = user.name;
    } else {
      updated.paymentConfirmed = false;
      updated.confirmedAt = undefined;
      updated.confirmedBy = undefined;
    }
    onUpdateTx(updated);
  };

  const savePosCode = (e: Entry, evt: React.MouseEvent) => {
    evt.stopPropagation();
    if (e.source !== 'transaction') return;
    if (!posCodeInput.code.trim()) return;
    const updated = { ...e.raw };
    updated.posApprovalCode = posCodeInput.code.trim();
    updated.paymentConfirmed = true;
    updated.confirmedAt = new Date().toISOString();
    updated.confirmedBy = user.name;
    onUpdateTx(updated);
    setPosCodeInput({ id: '', code: '' });
  };

  const handleClearDebt = async (e: Entry, evt?: React.MouseEvent) => {
    if (evt) evt.stopPropagation();
    if (e.source !== 'transaction') return;
    const tx = e.raw as Transaction;
    const remaining = tx.amount - (tx.amountPaid || 0);
    if (remaining <= 0) return;

    const ok = await confirm({
      title: 'Clear Outstanding Debt?',
      message: `Are you sure you want to mark the remaining debt of ${fmt(remaining)} for ${tx.name} as fully paid?`,
      confirmLabel: 'Clear Debt',
      tone: 'danger',
    });
    if (!ok) return;

    const historyEntry = {
      amount: remaining,
      mode: 'Cash' as const,
      by: user.name || 'Unknown',
      at: new Date().toISOString()
    };
    
    const updated: Transaction = {
      ...tx,
      amountPaid: tx.amount,
      paymentHistory: [...(tx.paymentHistory || []), historyEntry],
      mode: 'Debt Paid',
      paymentConfirmed: true,
      confirmedBy: user.name || 'Unknown',
      confirmedAt: new Date().toISOString(),
      ...(tx.type === 'package' ? {
        debtPaid: true,
        debtPaidAt: new Date().toISOString()
      } : {})
    };

    onUpdateTx(updated);
    showToast({ message: 'Debt cleared successfully', type: 'success' });
    if (viewingDetail && viewingDetail.id === tx.id) {
      setViewingDetail({
        ...viewingDetail,
        mode: 'Debt Paid',
        raw: updated
      });
    }
  };

  // Edit allowed only when not view-only AND user has can_print_ledger or is super_admin
  const canEdit = !viewOnly &&
    ['accountant', 'admin', 'super_admin'].includes(user.role) &&
    (user.role === 'super_admin' || user.can_print_ledger === true);

  const isAccountantOrAdmin = canEdit;
  const canEditRemarks = user.role === 'super_admin' || user.can_edit_remarks === true;
  // Separate from canEdit -- PIN visibility is admin/super_admin/
  // accountant regardless of the can_print_ledger flag, which is a
  // different, edit-specific permission.
  const canSeePin = ['admin', 'super_admin', 'accountant'].includes(user.role);

  const unverifiedCash = filteredEntries.filter(e => e.mode === 'Cash' && !e.raw.paymentConfirmed);
  const unconfirmedTransfer = filteredEntries.filter(e => e.mode === 'Transfer' && !e.raw.paymentConfirmed);

  const selectAllCash = () => {
    let skipped = 0;
    unverifiedCash.forEach(e => {
      if (e.source !== 'transaction') return;
      // Same maker-checker rule as toggleConfirm -- skip rows the current
      // user logged themselves rather than aborting the whole batch.
      if (e.raw.enteredByName && e.raw.enteredByName === user.name) {
        skipped++;
        return;
      }
      const updated = { ...e.raw };
      updated.paymentConfirmed = true;
      updated.confirmedAt = new Date().toISOString();
      updated.confirmedBy = user.name;
      onUpdateTx(updated);
    });
    if (skipped > 0) {
      showToast({ message: `Skipped ${skipped} entr${skipped === 1 ? 'y' : 'ies'} you personally logged.`, type: 'warning' });
    }
  };

  const totalAmount = filteredEntries.reduce((acc, e) => acc + (e.source === 'expense' ? -e.amount : e.amount), 0);
  const cashAmount = filteredEntries.filter(e => e.mode === 'Cash').reduce((acc, e) => acc + (e.source === 'expense' ? -e.amount : e.amount), 0);

  const tableRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: filteredEntries.length,
    getScrollElement: () => tableRef.current,
    // 56 was a rough guess and undershoots real rows -- the Customer/Detail
    // cell can wrap onto 2-3 lines depending on content length, so actual
    // rows run closer to 70-90px. Without measureElement wired below (via
    // the <tr> ref), the virtualizer never corrects for that drift: its
    // estimated total height ends up smaller than the real rendered
    // content, so getVirtualItems() can under-fill the scroll container
    // and leave later rows unreachable even though they're still in
    // filteredEntries.
    estimateSize: () => 72,
    overscan: 10,
  });

  const transferAmount = filteredEntries.filter(e => e.mode === 'Transfer').reduce((acc, e) => acc + (e.source === 'expense' ? -e.amount : e.amount), 0);
  const posAmount = filteredEntries.filter(e => e.mode === 'POS').reduce((acc, e) => acc + (e.source === 'expense' ? -e.amount : e.amount), 0);

  const vjFlights = useMemo(() => {
    if (defaultTypeFilter !== 'baggage') return [];
    const set = new Set<string>();
    entries.forEach(e => {
      if (e.source === 'transaction' && e.raw.type === 'baggage' && e.raw.flight) {
        set.add(e.raw.flight);
      }
    });
    return Array.from(set).sort();
  }, [entries, defaultTypeFilter]);

  const vjDests = useMemo(() => {
    if (defaultTypeFilter !== 'baggage') return [];
    const set = new Set<string>();
    entries.forEach(e => {
      if (e.source === 'transaction' && e.raw.type === 'baggage' && e.raw.destination) {
        set.add(e.raw.destination);
      }
    });
    return Array.from(set).sort();
  }, [entries, defaultTypeFilter]);

  return (
    <div className="flex flex-col h-full pb-4 bg-[var(--color-obsidian)] text-[var(--color-foreground)] relative animate-in slide-in-from-right overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-[var(--color-border)] flex flex-col md:flex-row gap-4 items-start md:items-center justify-between shrink-0">
        <div className="flex items-center space-x-4">
          <BackButton onClick={onBack} label="Back" />
          <span className="text-[10px] font-mono text-[var(--color-accent-amber)] tracking-widest font-bold">
            {defaultTypeFilter === 'cargo' ? '● CARGO LEDGER'
             : defaultTypeFilter === 'baggage' ? '● EXCESS BAGGAGE LEDGER'
             : defaultTypeFilter === 'marketing' ? '● MARKETING LEDGER'
             : '● MASTER LEDGER'}
            {viewOnly && <span className="ml-2 text-[var(--color-muted)] tracking-normal normal-case">view only</span>}
          </span>
        </div>
        
        <div className="flex items-center flex-wrap gap-3">
          {defaultTypeFilter === 'baggage' && (
            <div className="flex items-center gap-2">
              <select
                value={vjFlightFilter}
                onChange={e => setVjFlightFilter(e.target.value)}
                className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-md text-[10px] font-mono text-[var(--color-foreground)] px-2 py-1.5 focus:outline-none focus:border-[var(--color-accent-amber)]"
              >
                <option value="All">All Flights</option>
                {vjFlights.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
              <select
                value={vjDestFilter}
                onChange={e => setVjDestFilter(e.target.value)}
                className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-md text-[10px] font-mono text-[var(--color-foreground)] px-2 py-1.5 focus:outline-none focus:border-[var(--color-accent-amber)]"
              >
                <option value="All">All Dests</option>
                {vjDests.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          )}

          {/* Download entries currently in view -- respects whatever
              date range / type / mode / search filters are active
              (filteredEntries), not just "today". Always rendered, so the
              Master Ledger (opened with no defaultTypeFilter) gets an
              export option too, not just the per-stream ledgers. */}
          <button
            onClick={() => {
              if (defaultTypeFilter === 'baggage') {
                import('./ExcessBaggageLedgerPDF').then(({ downloadBaggageLedgerPDF }) => {
                  const txs = filteredEntries
                    .filter(e => e.source === 'transaction')
                    .map(e => e.raw as Transaction);
                  // This is the aggregate master ledger across every
                  // configured airline (unlike the per-airline "Daily PDF"
                  // button on the ticketing form itself), so it uses a
                  // generic title/no single airline logo rather than
                  // whichever airline happens to be first in the list.
                  downloadBaggageLedgerPDF({
                    airlineName: 'Excess Baggage',
                    date: `${new Date().toLocaleDateString('en-GB')} ${tnow()}`,
                    hubName: user.hub || 'EHI Hub',
                    transactions: txs,
                    filters: {
                      flight: vjFlightFilter === 'All' ? '' : vjFlightFilter,
                      destination: vjDestFilter === 'All' ? '' : vjDestFilter
                    }
                  });
                });
              } else {
                import('../../lib/helpers').then(({ downloadDailyCSV }) => {
                  // Whatever is currently filtered/date-scoped in the ledger
                  // UI, not a re-derived "today" slice -- downloadDailyCSV no
                  // longer re-filters internally.
                  const txs = filteredEntries
                    .filter(e => e.source === 'transaction')
                    .map(e => e.raw as Transaction);
                  // Master Ledger (no defaultTypeFilter) can contain a mix
                  // of cargo/baggage/marketing/package entries at once, so
                  // it falls back to the generic 'mixed' column layout.
                  downloadDailyCSV(defaultTypeFilter || 'mixed', txs, user.hub || 'EHI Hub');
                });
              }
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-lg text-[10px] font-mono text-[var(--color-muted)] hover:text-[var(--color-success)] hover:border-[var(--color-success)] transition-colors"
          >
            <Download size={11} /> {defaultTypeFilter === 'baggage' ? 'Download PDF' : 'Download CSV'}
          </button>

          {(user.role === 'super_admin' || user.role === 'admin' || user.role === 'accountant' || user.role === 'auditor') && (
            <button
              onClick={() => setShowPrintHistory(!showPrintHistory)}
              className={`flex items-center gap-1.5 px-3 py-1.5 border rounded-lg text-[10px] font-mono transition-colors ${
                showPrintHistory 
                  ? 'bg-[var(--color-accent-amber)] border-[var(--color-accent-amber)] text-black'
                  : 'bg-[var(--color-surface-card)] border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-accent-amber)] hover:border-[var(--color-accent-amber)]'
              }`}
            >
              <Printer size={11} /> {showPrintHistory ? 'Close Print Logs' : 'Print Logs'}
            </button>
          )}
        </div>
      </div>

      {showPrintHistory ? (
        <div className="flex-1 overflow-y-auto p-4 md:p-6 no-scrollbar relative z-10">
          <TagPrintHistory user={user} />
        </div>
      ) : (
        <>
          {/* Shift scope toggle — Current Shift (7PM–7PM) vs All Time */}
          <div className="px-4 pt-2 flex gap-2 shrink-0">
            {(['current', 'all'] as const).map((scope) => (
              <button
                key={scope}
                onClick={() => setShiftFilter(scope)}
                className={`px-3 py-1 rounded-full text-[10px] font-mono font-bold transition-all border ${
                  shiftFilter === scope
                    ? 'bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] border-[var(--color-accent-amber)]'
                    : 'bg-transparent text-[var(--color-muted)] border-[var(--color-border)] hover:border-[var(--color-accent-amber)] hover:text-[var(--color-accent-amber)]'
                }`}
              >
                {scope === 'current' ? 'Current Shift' : 'All Time'}
              </button>
            ))}
            {shiftFilter === 'current' && (
              <span className="text-[9px] font-mono text-[var(--color-muted)] self-center">
                {new Date(shiftBoundary.start).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase()}
                {' → '}
                {new Date(shiftBoundary.end).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase()}
              </span>
            )}
          </div>

          {/* Summary Strip */}
          <div className="px-4 py-2 bg-[var(--color-surface-card)] border-b border-[var(--color-border)] flex gap-2 overflow-x-auto no-scrollbar whitespace-nowrap shrink-0">
        <div className="px-2 py-1 rounded-full bg-[var(--color-border)] text-[10px] font-mono border border-[var(--color-border)] text-[var(--color-foreground)]">
          Total: <span className="font-bold">{fmt(totalAmount)}</span>
        </div>
        <div 
          className="px-2 py-1 rounded-full bg-[rgba(16,185,129,0.1)] text-[10px] font-mono border border-[rgba(16,185,129,0.2)] text-[var(--color-success)] cursor-pointer"
          onClick={() => setModeFilter("Cash")}
        >
          Cash: <span className="font-bold">{fmt(cashAmount)}</span>
          {isAccountantOrAdmin && unverifiedCash.length > 0 && (
            <span className="text-[var(--color-accent-amber)] ml-1">({unverifiedCash.length} unverified)</span>
          )}
        </div>
        <div 
          className="px-2 py-1 rounded-full bg-[rgba(59,130,246,0.1)] text-[10px] font-mono border border-[rgba(59,130,246,0.2)] text-[var(--color-accent-cobalt)] cursor-pointer"
          onClick={() => setModeFilter("Transfer")}
        >
          Transfer: <span className="font-bold">{fmt(transferAmount)}</span>
          {isAccountantOrAdmin && unconfirmedTransfer.length > 0 && (
            <span className="text-[var(--color-accent-amber)] ml-1">({unconfirmedTransfer.length} unconfirmed)</span>
          )}
        </div>
        <div 
          className="px-2 py-1 rounded-full bg-[rgba(245,158,11,0.1)] text-[10px] font-mono border border-[rgba(245,158,11,0.2)] text-[var(--color-accent-amber)] cursor-pointer"
          onClick={() => setModeFilter("POS")}
        >
          POS: <span className="font-bold">{fmt(posAmount)}</span>
        </div>
      </div>

      {/* Filters */}
      <div className="p-2.5 md:p-3 border-b border-[var(--color-border)] flex flex-col md:flex-row gap-2 shrink-0">
        <div className="flex-1 relative">
          <Search
            size={12}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-muted)]"
          />
          <input
            id="ledger-search"
            name="search"
            type="text"
            placeholder="Search entries, dates, amounts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-8 pl-7 pr-3 ehi-card text-[11px] font-sans text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-blue)]"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          {dateRange && onDateRangeChange && (
            <div className="flex items-center gap-1 ehi-card overflow-hidden h-8 px-1.5 font-mono text-[10px]">
              <input
                id="ledger-date-start"
                name="date-start"
                type="date"
                value={dateRange.start}
                onChange={(e) => onDateRangeChange({ ...dateRange, start: e.target.value })}
                className="bg-transparent text-[var(--color-foreground)] border-none focus:outline-none h-full w-[126px]"
              />
              <span className="text-[var(--color-muted)]">to</span>
              <input
                id="ledger-date-end"
                name="date-end"
                type="date"
                value={dateRange.end}
                onChange={(e) => onDateRangeChange({ ...dateRange, end: e.target.value })}
                className="bg-transparent text-[var(--color-foreground)] border-none focus:outline-none h-full w-[126px]"
              />
            </div>
          )}
          <div className="flex items-center ehi-card overflow-hidden h-8 px-1 font-mono text-[10px]">
            <Filter size={10} className="text-[var(--color-muted)] mx-1.5 shrink-0" />
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="bg-transparent text-[var(--color-foreground)] border-none focus:outline-none cursor-pointer h-full"
            >
              <option value="All">All Types</option>
              <option value="Cargo">Cargo</option>
              <option value="Baggage">Baggage</option>
              <option value="Marketing">Marketing</option>
              <option value="Expense">Expense</option>
            </select>
          </div>

          <div className="flex items-center ehi-card overflow-hidden h-8 px-1.5 font-mono text-[10px]">
            <select
              value={modeFilter}
              onChange={(e) => setModeFilter(e.target.value)}
              className="bg-transparent text-[var(--color-foreground)] border-none focus:outline-none cursor-pointer h-full"
            >
              <option value="All">All Modes</option>
              <option value="Revenue">Revenue Only</option>
              <option value="Expense">Expense Only</option>
              <option value="Cash">Cash</option>
              <option value="Transfer">Transfer</option>
              <option value="POS">POS</option>
              <option value="Debt">Debt</option>
              <option value="Unverified">Unverified</option>
            </select>
          </div>

          <div className="flex items-center ehi-card overflow-hidden h-8 px-1.5 font-mono text-[10px]">
            <Clock size={10} className="text-[var(--color-muted)] mr-1 shrink-0" />
            <select
              value={timeFilter}
              onChange={(e) => setTimeFilter(e.target.value as any)}
              className="bg-transparent text-[var(--color-foreground)] border-none focus:outline-none cursor-pointer h-full"
            >
              <option value="All">All Time</option>
              <option value="Morning">Morning (06:00 - 12:00)</option>
              <option value="Afternoon">Afternoon (12:00 - 17:00)</option>
              <option value="Evening">Evening (17:00 - 24:00)</option>
              <option value="Custom">Custom Time</option>
            </select>
          </div>

          {timeFilter === "Custom" && (
            <div className="flex items-center gap-1 ehi-card overflow-hidden h-8 px-1.5 font-mono text-[10px]">
              <input
                id="ledger-time-start"
                name="time-start"
                type="time"
                value={timeStart}
                onChange={(e) => setTimeStart(e.target.value)}
                className="bg-transparent text-[var(--color-foreground)] border-none focus:outline-none h-full w-[80px]"
              />
              <span className="text-[var(--color-muted)]">to</span>
              <input
                id="ledger-time-end"
                name="time-end"
                type="time"
                value={timeEnd}
                onChange={(e) => setTimeEnd(e.target.value)}
                className="bg-transparent text-[var(--color-foreground)] border-none focus:outline-none h-full w-[80px]"
              />
            </div>
          )}
        </div>
      </div>

      {/* Bulk Cash Verification Header */}
      {modeFilter === 'Cash' && unverifiedCash.length > 0 && isAccountantOrAdmin && (
        <div className="px-4 py-3 bg-[rgba(245,158,11,0.05)] border-b border-[rgba(245,158,11,0.2)] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-[11px] font-sans text-[var(--color-accent-amber)]">
            <CheckSquare size={14} className="cursor-pointer" onClick={selectAllCash} />
            <span>Select all Cash entries for today —</span>
            <button 
              onClick={selectAllCash}
              className="ml-2 bg-[var(--color-success)] text-[var(--color-obsidian)] px-2 py-1 rounded font-bold hover:bg-emerald-600 transition-colors"
            >
              CONFIRM SELECTED
            </button>
          </div>
        </div>
      )}

      {/* Table Container */}
      <div ref={tableRef} className="flex-1 overflow-auto p-4 pb-4 relative">
        <div className="ehi-card overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left font-mono text-[10px]">
            <thead className="bg-[var(--color-surface-card)]">
              <tr className="text-[var(--color-muted)] border-b border-[var(--color-border)] uppercase">
                {(isAccountantOrAdmin || !viewOnly) && <th className="py-3 px-3 w-[36px]"></th>}
                {canSeePin && <th className="py-3 px-2 w-[64px] font-medium">PIN</th>}
                <th className="py-3 px-2 w-[150px] font-medium">ID</th>
                <th className="py-3 px-2 w-[72px] font-medium">Date</th>
                <th className="py-3 px-2 font-medium min-w-[120px]">Customer / Detail</th>
                <th className="py-3 px-2 w-[72px] font-medium text-center">Status</th>
                <th className="py-3 px-2 w-[80px] font-medium text-right">Amount</th>
                <th className="py-3 px-2 w-[56px] font-medium text-center">Mode</th>
                <th className="py-3 px-3 w-[32px] font-medium text-center"></th>
              </tr>
            </thead>
            <tbody>
              {filteredEntries.length === 0 ? (
                <tr>
                  <td
                    colSpan={(isAccountantOrAdmin || !viewOnly) ? (canSeePin ? 9 : 8) : (canSeePin ? 8 : 7)}
                    className="py-8 text-center text-[var(--color-muted)]"
                  >
                    No entries found matching filters.
                  </td>
                </tr>
              ) : (
                <>
                  {rowVirtualizer.getVirtualItems().length > 0 && (
                    <tr style={{ height: rowVirtualizer.getVirtualItems()[0].start }}>
                      <td colSpan={(isAccountantOrAdmin || !viewOnly) ? (canSeePin ? 9 : 8) : (canSeePin ? 8 : 7)} />
                    </tr>
                  )}
                  {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const e = filteredEntries[virtualRow.index];
                    
                    // Parse date and time safely from created_at or fallback to time string
                    let displayDate = '';
                    let displayTime = '';
                    const dtStr = (e as any).created_at || (e.raw && e.raw.created_at) || e.time;
                    try {
                      const d = new Date(dtStr);
                      if (!isNaN(d.getTime())) {
                        displayDate = d.toLocaleDateString('en-NG', { day: '2-digit', month: 'short' });
                        displayTime = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
                      } else {
                        // Fallback if it's just a raw time string like "05:14 PM"
                        displayDate = 'Today'; // Default fallback
                        displayTime = e.time;
                      }
                    } catch {
                      displayDate = 'Unknown';
                      displayTime = e.time;
                    }

                  // Status colour
                  const statusColor =
                    e.status === 'Delivered' ? 'text-[var(--color-success)] bg-[rgba(16,185,129,0.12)]' :
                    ['In-Transit','Dispatched','Departure'].includes(e.status) ? 'text-[var(--color-accent-cobalt)] bg-[rgba(59,130,246,0.12)]' :
                    e.status === 'Arrived' ? 'text-[var(--color-accent-amber)] bg-[rgba(245,158,11,0.12)]' :
                    e.status === 'Cancelled' ? 'text-[var(--color-error)] bg-[rgba(239,68,68,0.12)]' :
                    'text-[var(--color-muted)] bg-[rgba(255,255,255,0.06)]';

                  return (
                  <tr
                    key={e.id}
                    ref={rowVirtualizer.measureElement}
                    data-index={virtualRow.index}
                    onClick={() => setViewingDetail(e)}
                    className={`border-b border-[var(--color-border)] hover:bg-[var(--color-border)] transition-colors cursor-pointer group ${
                      e.raw?.retrieved ? 'opacity-50' : ''
                    }`}
                  >
                    {(isAccountantOrAdmin || !viewOnly) && (
                      <td className="py-2.5 px-3">
                        {(e.mode === 'Cash' || e.mode === 'POS' || e.mode === 'Transfer') && isAccountantOrAdmin && (
                          <div onClick={(evt) => evt.stopPropagation()}>
                            {e.mode === 'POS' && !e.posApprovalCode ? (
                              posCodeInput.id === e.id ? (
                                <div className="flex items-center gap-1">
                                  <input
                                    id={`pos-code-${e.id}`}
                                    name={`pos-code-${e.id}`}
                                    autoFocus
                                    type="text"
                                    className="w-16 bg-[var(--color-surface-1)] border border-[var(--color-accent-amber)] rounded px-1 py-0.5 text-[9px] text-[var(--color-foreground)] outline-none"
                                    placeholder="Code"
                                    value={posCodeInput.code}
                                    onChange={evt => setPosCodeInput({ id: e.id, code: evt.target.value })}
                                    onKeyDown={evt => { if(evt.key === 'Enter') savePosCode(e, evt as any); }}
                                  />
                                  <button onClick={(evt) => savePosCode(e, evt)} className="text-[var(--color-success)]"><Check size={12}/></button>
                                </div>
                              ) : (
                                <button
                                  onClick={(evt) => { evt.stopPropagation(); setPosCodeInput({ id: e.id, code: '' }); }}
                                  className="text-[var(--color-accent-amber)] hover:underline whitespace-nowrap text-[9px]"
                                >
                                  Enter code
                                </button>
                              )
                            ) : (
                              <button
                                onClick={(evt) => toggleConfirm(e, evt)}
                                className="flex items-center justify-center text-[var(--color-accent-amber)] hover:text-amber-400"
                              >
                                {e.raw.paymentConfirmed ? (
                                  <div className="w-4 h-4 bg-[var(--color-accent-amber)] rounded flex items-center justify-center">
                                    <Check size={12} className="text-white" strokeWidth={3} />
                                  </div>
                                ) : (
                                  <div className="w-4 h-4 border border-[var(--color-accent-amber)] rounded" />
                                )}
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    )}
                    {canSeePin && (
                      <td className="py-2.5 px-3 font-mono text-[11px] text-[var(--color-accent-amber)]">
                        {e.raw.pickupPin || '—'}
                      </td>
                    )}
                    {/* ID */}
                    <td className="py-2.5 px-2 text-[var(--color-light-muted)]">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <div className={`w-5 h-5 rounded flex items-center justify-center shrink-0 ${
                          e.type === 'cargo' ? 'bg-[rgba(59,130,246,0.15)] text-[var(--color-accent-cobalt)]' :
                          e.type === 'baggage' ? 'bg-[rgba(245,158,11,0.15)] text-[var(--color-accent-amber)]' :
                          e.type === 'marketing' ? 'bg-[rgba(16,185,129,0.15)] text-[var(--color-success)]' :
                          'bg-[rgba(239,68,68,0.15)] text-[var(--color-error)]'
                        }`}>
                          {e.type === 'cargo' && <Package size={10} />}
                          {e.type === 'baggage' && <Plane size={10} />}
                          {e.type === 'marketing' && <TrendingUp size={10} />}
                          {e.source === 'expense' && <Minus size={10} />}
                        </div>
                        <span className="truncate min-w-0" title={e.id}>{e.id}</span>
                      </div>
                    </td>
                    {/* Date + Time */}
                    <td className="py-2.5 px-2 whitespace-nowrap">
                      <div className="text-[10px] font-mono text-[var(--color-foreground)] font-medium">{displayDate}</div>
                      <div className="text-[9px] font-mono text-[var(--color-muted)] mt-0.5">{displayTime}</div>
                    </td>
                    {/* Customer + Detail */}
                    <td className="py-2.5 px-2">
                      {/* Row-level badges for special transaction types */}
                      <div className="flex flex-wrap gap-1 mb-0.5">
                        {e.raw?.is_debt_clearance && (
                          <span className="px-1.5 py-0.5 rounded text-[8px] font-bold font-mono bg-[rgba(59,130,246,0.15)] text-[var(--color-accent-cobalt)] border border-[rgba(59,130,246,0.3)]">
                            COLLECTION
                          </span>
                        )}
                        {e.raw?.retrieved && (
                          <span className="px-1.5 py-0.5 rounded text-[8px] font-bold font-mono bg-[rgba(239,68,68,0.12)] text-[var(--color-error)] border border-[rgba(239,68,68,0.25)] line-through">
                            RETRIEVED
                          </span>
                        )}
                        {e.raw?.linked_as_office_work && (
                          <span className="px-1.5 py-0.5 rounded text-[8px] font-bold font-mono bg-[rgba(139,92,246,0.15)] text-[#a78bfa] border border-[rgba(139,92,246,0.3)]">
                            OFFICE WORK
                          </span>
                        )}
                        {e.raw?.wallet_id && (
                          <span className="px-1.5 py-0.5 rounded text-[8px] font-bold font-mono bg-[rgba(245,158,11,0.12)] text-[var(--color-accent-amber)] border border-[rgba(245,158,11,0.25)]">
                            WALLET
                          </span>
                        )}
                      </div>
                      <div className={`font-sans font-bold text-[12px] leading-snug ${e.source === "expense" ? "text-[var(--color-error)]" : "text-[var(--color-foreground)]"}`}>
                        {e.name}
                      </div>
                      <div className="text-[9px] text-[var(--color-muted)] mt-0.5 leading-snug line-clamp-2">
                        {e.detail}
                      </div>
                      {e.raw.remarks && (
                        <div className="text-[9px] text-[var(--color-success)] font-sans italic mt-1 leading-snug">
                          Remarks: {e.raw.remarks}
                        </div>
                      )}
                    </td>
                    {/* Status */}
                    <td className="py-2.5 px-2 text-center">
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[8px] font-bold font-mono whitespace-nowrap ${statusColor}`}>
                        {e.source === 'expense' ? 'Expense' : (e.status || 'Intake')}
                      </span>
                    </td>
                    {/* Amount */}
                    <td className={`py-2.5 px-2 text-right font-bold font-mono text-[11px] whitespace-nowrap ${e.source === "expense" ? "text-[var(--color-error)]" : "text-[var(--color-success)]"}`}>
                      {e.source === "expense" ? "-" : ""}{fmt(e.amount)}
                    </td>
                    {/* Mode */}
                    <td className="py-2.5 px-2 text-center" onClick={(evt) => evt.stopPropagation()}>
                      <div className="flex flex-col items-center gap-0.5">
                        <div className="flex items-center gap-1.5 justify-center">
                          <span className={`px-1.5 py-0.5 rounded font-sans text-[9px] font-medium flex items-center gap-1 ${
                            e.mode === "Cash" ? "bg-[rgba(16,185,129,0.15)] text-[var(--color-success)]" :
                            e.mode === "Transfer" ? "bg-[rgba(59,130,246,0.15)] text-[var(--color-accent-cobalt)]" :
                            e.mode === "POS" ? "bg-[rgba(245,158,11,0.15)] text-[var(--color-accent-amber)]" :
                            e.mode === "Expense" ? "bg-[rgba(239,68,68,0.15)] text-[var(--color-error)]" :
                            e.mode === "Debt Paid" ? "bg-[rgba(16,185,129,0.15)] text-[var(--color-success)]" :
                            e.mode === "Wallet" ? "bg-[rgba(245,158,11,0.12)] text-[var(--color-accent-amber)] border border-[rgba(245,158,11,0.3)]" :
                            "border border-[var(--color-error)] text-[var(--color-error)]"
                          }`}>
                            {e.mode === "Debt" ? "Debt" : e.mode === "Debt Paid" ? "Debt Cleared" : e.mode === "Wallet" ? "💰 Wallet" : e.mode}
                            {e.raw.paymentConfirmed && e.mode !== 'Debt' && e.mode !== 'Expense' && e.mode !== 'Debt Paid' && (
                              <Check size={10} strokeWidth={3} className="text-current opacity-80" />
                            )}
                            {!e.raw.paymentConfirmed && e.mode !== 'Debt' && e.mode !== 'Expense' && e.mode !== 'Debt Paid' && (
                              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent-amber)] animate-pulse" />
                            )}
                          </span>

                          {e.mode === "Debt" && (
                            <button
                              onClick={(evt) => {
                                evt.stopPropagation();
                                handleClearDebt(e, evt);
                              }}
                              className="p-1 rounded bg-[rgba(16,185,129,0.15)] text-[var(--color-success)] hover:bg-[var(--color-success)] hover:text-[#030712] transition-colors focus:outline-none flex items-center gap-0.5"
                              title="Clear Outstanding Debt"
                            >
                              <HandCoins size={13} />
                            </button>
                          )}
                        </div>
                        {e.mode === 'POS' && e.posApprovalCode && (
                          <span className="text-[8px] text-[var(--color-muted)]">**{e.posApprovalCode.slice(-4)}</span>
                        )}
                      </div>
                    </td>
                    {/* Chevron */}
                    <td className="py-2.5 px-3 text-center">
                      <ChevronRight size={14} className="text-[var(--color-muted)] group-hover:text-[var(--color-foreground)] transition-colors ml-auto" />
                    </td>
                  </tr>
                  );
                  })}
                  {(() => {
                    const items = rowVirtualizer.getVirtualItems();
                    const lastItem = items[items.length - 1];
                    const paddingBottom = rowVirtualizer.getTotalSize() - (lastItem ? lastItem.end : 0);
                    return paddingBottom > 0 ? (
                      <tr style={{ height: paddingBottom }}><td colSpan={(isAccountantOrAdmin || !viewOnly) ? (canSeePin ? 9 : 8) : (canSeePin ? 8 : 7)} /></tr>
                    ) : null;
                  })()}
                </>
              )}
            </tbody>
          </table>
          </div>
        </div>
      </div>

      {/* Detail Popup Overlay */}
      </>)}
      {viewingDetail && (
        <div 
          className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center animate-in fade-in"
          onClick={() => setViewingDetail(null)}
        >
          <div 
            className="bg-[var(--color-surface-card)] sm:border sm:border-[var(--color-surface-2)] sm:rounded-xl w-full sm:max-w-md max-h-[85vh] sm:max-h-[90vh] shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-8 sm:slide-in-from-bottom-4 rounded-t-2xl sm:rounded-b-xl"
            onClick={evt => evt.stopPropagation()}
          >
            {/* Handle bar for mobile */}
            <div className="w-full flex justify-center py-2 sm:hidden shrink-0">
              <div className="w-12 h-1.5 bg-[var(--color-muted)] rounded-full" />
            </div>

            <div className="p-4 sm:p-5 flex justify-between items-start shrink-0 border-b border-[var(--color-border)]">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  viewingDetail.type === 'cargo' ? 'bg-blue-500/20 text-blue-400' :
                  viewingDetail.type === 'baggage' ? 'bg-amber-500/20 text-amber-400' :
                  viewingDetail.type === 'marketing' ? 'bg-emerald-500/20 text-emerald-400' :
                  'bg-red-500/20 text-red-400'
                }`}>
                  {viewingDetail.type === 'cargo' && <Package size={20} />}
                  {viewingDetail.type === 'baggage' && <Plane size={20} />}
                  {viewingDetail.type === 'marketing' && <TrendingUp size={20} />}
                  {viewingDetail.source === 'expense' && <Minus size={20} />}
                </div>
                <div>
                  <h3 className="font-mono text-[var(--color-accent-amber)] text-[14px] font-bold">{viewingDetail.id}</h3>
                  <span className="text-[10px] text-[var(--color-muted)] uppercase tracking-wider">{viewingDetail.type}</span>
                </div>
              </div>
              <button 
                onClick={() => setViewingDetail(null)}
                className="text-[var(--color-muted)] hover:text-[var(--color-foreground)] p-1 rounded-full bg-[var(--color-border)]"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
              {/* Customer Section */}
              <section>
                <h4 className="text-[10px] font-mono text-[var(--color-muted)] uppercase mb-2">Details</h4>
                <div className="bg-[var(--color-surface-1)] rounded-lg p-3 border border-[var(--color-border)]">
                  <div className={`font-sans font-bold text-lg mb-1 ${viewingDetail.source === 'expense' ? 'text-[var(--color-error)]' : 'text-[var(--color-foreground)]'}`}>
                    {viewingDetail.name}
                  </div>
                  <div className="text-[12px] text-[var(--color-light-muted)] leading-relaxed">
                    {viewingDetail.detail}
                  </div>
                  {viewingDetail.raw.phone && (
                    <div className="text-[11px] text-[var(--color-muted)] mt-2 font-mono">
                      📞 {viewingDetail.raw.phone}
                    </div>
                  )}
                  {viewingDetail.raw.remarks && (
                    <div className="mt-2 pt-2 border-t border-[var(--color-border)] flex flex-col gap-0.5">
                      <span className="text-[10px] font-mono text-[var(--color-muted)] uppercase">Remarks</span>
                      <span className="text-[12px] text-[var(--color-foreground)] italic font-sans">{viewingDetail.raw.remarks}</span>
                    </div>
                  )}
                </div>
              </section>

              {/* Payment Section */}
              <section>
                <h4 className="text-[10px] font-mono text-[var(--color-muted)] uppercase mb-2">Payment Info</h4>
                <div className="bg-[var(--color-surface-1)] rounded-lg p-3 border border-[var(--color-border)] space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] text-[var(--color-muted)]">Amount</span>
                    <span className={`text-xl font-bold font-mono ${viewingDetail.source === 'expense' ? 'text-[var(--color-error)]' : 'text-[var(--color-success)]'}`}>
                      {viewingDetail.source === 'expense' ? '-' : ''}₦{viewingDetail.amount.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex items-center justify-between border-t border-[var(--color-border)] pt-3">
                    <span className="text-[12px] text-[var(--color-muted)]">Mode</span>
                    <span className={`px-2 py-0.5 rounded font-sans text-[11px] font-bold ${
                      viewingDetail.mode === "Cash" ? "bg-[rgba(16,185,129,0.15)] text-[var(--color-success)]" : 
                      viewingDetail.mode === "Transfer" ? "bg-[rgba(59,130,246,0.15)] text-[var(--color-accent-cobalt)]" : 
                      viewingDetail.mode === "POS" ? "bg-[rgba(245,158,11,0.15)] text-[var(--color-accent-amber)]" : 
                      viewingDetail.mode === "Expense" ? "bg-[rgba(239,68,68,0.15)] text-[var(--color-error)]" : 
                      "border border-[var(--color-error)] text-[var(--color-error)]"
                    }`}>
                      {viewingDetail.mode === "Debt" ? "Debt" : viewingDetail.mode}
                    </span>
                  </div>
                  
                  {viewingDetail.mode === 'Transfer' && viewingDetail.raw.bank && (
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] text-[var(--color-muted)]">Bank</span>
                      <span className="text-[12px] text-[var(--color-foreground)] font-medium">{viewingDetail.raw.bank}</span>
                    </div>
                  )}
                  {viewingDetail.mode === 'Transfer' && viewingDetail.raw.paymentNarration && (
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] text-[var(--color-muted)]">Narration Ref</span>
                      <span className="text-[10px] font-mono bg-[var(--color-surface-2)] px-1.5 py-0.5 rounded text-[var(--color-foreground)]">{viewingDetail.raw.paymentNarration}</span>
                    </div>
                  )}
                  {viewingDetail.mode === 'POS' && viewingDetail.posApprovalCode && (
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] text-[var(--color-muted)]">Approval Code</span>
                      <span className="text-[12px] font-mono font-bold text-[var(--color-foreground)] tracking-widest">{viewingDetail.posApprovalCode}</span>
                    </div>
                  )}

                  <div className="mt-2 pt-3 border-t border-[var(--color-border)]">
                    {viewingDetail.mode === 'Debt' ? (
                      <div className="text-[11px] text-[var(--color-error)] flex items-center gap-1.5 font-sans">
                        <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-error)]" />
                        Outstanding — not yet paid
                      </div>
                    ) : viewingDetail.mode === 'Debt Paid' ? (
                      <div className="text-[11px] text-[var(--color-success)] flex items-center gap-1.5 font-medium font-sans">
                        <Check size={14} />
                        Debt Cleared by {viewingDetail.raw.confirmedBy || (viewingDetail.raw.paymentHistory && viewingDetail.raw.paymentHistory[viewingDetail.raw.paymentHistory.length - 1]?.by) || 'System'}
                      </div>
                    ) : viewingDetail.raw.paymentConfirmed ? (
                      <div className="text-[11px] text-[var(--color-success)] flex items-center gap-1.5 font-medium font-sans">
                        <Check size={14} />
                        {viewingDetail.mode === 'Transfer' && viewingDetail.raw.bankReference
                          ? `Confirmed via bank alert at ${viewingDetail.raw.confirmedAt || ''}`
                          : viewingDetail.mode === 'POS'
                          ? `Approval code ${viewingDetail.posApprovalCode} verified`
                          : `Verified by ${viewingDetail.raw.confirmedBy || 'system'} at ${viewingDetail.raw.confirmedAt || ''}`
                        }
                      </div>
                    ) : (
                      <div className="text-[11px] text-[var(--color-accent-amber)] flex items-center gap-1.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent-amber)] animate-pulse" />
                        {viewingDetail.mode === 'POS' ? "Enter approval code to confirm" :
                         "Pending verification"}
                      </div>
                    )}
                  </div>
                </div>
              </section>

              {/* Status Section */}
              {viewingDetail.source === 'transaction' && (
                <section>
                  <h4 className="text-[10px] font-mono text-[var(--color-muted)] uppercase mb-2">Status & Tracking</h4>
                  <div className="bg-[var(--color-surface-1)] rounded-lg p-3 border border-[var(--color-border)] flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${
                        viewingDetail.status === "Delivered" ? "bg-emerald-500" : 
                        ["In-Transit", "Departure", "Dispatched"].includes(viewingDetail.status) ? "bg-blue-500" : 
                        viewingDetail.status === "Arrived" ? "bg-amber-500" : "bg-slate-400"
                      }`} />
                      <span className="text-[13px] font-bold text-[var(--color-foreground)]">{viewingDetail.status}</span>
                    </div>
                    {(viewingDetail.raw.hub || viewingDetail.raw.destination) && (
                      <div className="text-[11px] text-[var(--color-muted)] flex items-center gap-1.5 mt-1 font-sans">
                        <span>{getHubCode(viewingDetail.raw.hub) || 'Origin'}</span>
                        <ChevronRight size={10} />
                        <span>{getHubCode(viewingDetail.raw.destination) || 'Destination'}</span>
                      </div>
                    )}
                  </div>
                </section>
              )}

              {/* Timestamps */}
              <section className="text-[10px] font-mono text-[var(--color-muted)] space-y-1 pb-4">
                <div>Logged at: {viewingDetail.time} {viewingDetail.raw.enteredByName ? `by ${viewingDetail.raw.enteredByName}` : (viewingDetail.raw.loggedBy ? `by ${viewingDetail.raw.loggedBy}` : '')}</div>
                {viewingDetail.mode === 'Debt Paid' && (
                  <div>Cleared by: {viewingDetail.raw.confirmedBy || (viewingDetail.raw.paymentHistory && viewingDetail.raw.paymentHistory[viewingDetail.raw.paymentHistory.length - 1]?.by) || 'System'} {viewingDetail.raw.confirmedAt ? `at ${new Date(viewingDetail.raw.confirmedAt).toLocaleString('en-NG')}` : ''}</div>
                )}
                {viewingDetail.raw.paymentConfirmed && viewingDetail.raw.confirmedAt && viewingDetail.mode !== 'Debt Paid' && (
                  <div>Confirmed at: {viewingDetail.raw.confirmedAt}</div>
                )}
              </section>
            </div>

            {/* Actions Footer */}
            <div className="p-4 bg-[var(--color-obsidian)] border-t border-[var(--color-border)] flex flex-col gap-2 shrink-0">
              {viewingDetail.source === 'transaction' && (
                <>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => setViewingQrTx(viewingDetail)}
                      className="flex-1 py-2.5 flex items-center justify-center gap-2 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)] text-[var(--color-foreground)] rounded-lg transition-colors border border-[var(--color-border)] text-[12px] font-medium"
                    >
                      <QrCode size={14} /> Scan
                    </button>
                    {viewingDetail.mode === 'Debt' && !viewOnly && (
                      <button 
                        onClick={(evt) => handleClearDebt(viewingDetail, evt)}
                        className="flex-1 py-2.5 flex items-center justify-center gap-2 bg-[rgba(16,185,129,0.1)] hover:bg-[rgba(16,185,129,0.2)] text-[var(--color-success)] rounded-lg transition-colors border border-[rgba(16,185,129,0.2)] text-[12px] font-bold"
                      >
                        <CheckSquare size={14} /> Clear Debt
                      </button>
                    )}
                    {viewingDetail.mode !== 'Debt' && !viewingDetail.raw.paymentConfirmed && isAccountantOrAdmin && (
                      <button 
                        onClick={(evt) => toggleConfirm(viewingDetail, evt)}
                        className="flex-1 py-2.5 flex items-center justify-center gap-2 bg-[rgba(16,185,129,0.1)] hover:bg-[rgba(16,185,129,0.2)] text-[var(--color-success)] rounded-lg transition-colors border border-[rgba(16,185,129,0.2)] text-[12px] font-bold"
                      >
                        <CheckSquare size={14} /> Confirm
                      </button>
                    )}
                    {(canEdit || canEditRemarks) && (
                      <button
                        onClick={(evt) => handleEditClick(viewingDetail, evt)}
                        className="flex-1 py-2.5 flex items-center justify-center gap-2 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)] text-[var(--color-foreground)] rounded-lg transition-colors border border-[var(--color-border)] text-[12px] font-medium"
                      >
                        <Edit2 size={14} /> Edit
                      </button>
                    )}
                  </div>
                  {(user.can_print_ledger || user.role === 'super_admin') && (
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={() => handleReprintReceipt('80mm')}
                        className="flex-1 py-2.5 flex items-center justify-center gap-2 bg-[var(--color-accent-amber)] hover:bg-opacity-90 text-[#0D1117] rounded-lg transition-colors border-none text-[12px] font-bold shadow-[var(--shadow-button)]"
                      >
                        <Printer size={14} /> Receipt (80)
                      </button>
                      <button
                        onClick={() => handleReprintReceipt('58mm')}
                        className="flex-1 py-2.5 flex items-center justify-center gap-2 bg-[var(--color-accent-amber)] hover:bg-opacity-90 text-[#0D1117] rounded-lg transition-colors border-none text-[12px] font-bold shadow-[var(--shadow-button)]"
                      >
                        <Printer size={14} /> Receipt (58)
                      </button>
                      {(viewingDetail.raw.type === 'cargo' || viewingDetail.raw.type === 'marketing' || viewingDetail.raw.type === 'package') && (
                        <>
                          <button
                            onClick={() => handleReprintTag('80mm')}
                            className="flex-1 py-2.5 flex items-center justify-center gap-2 bg-[var(--color-accent-amber)] hover:bg-opacity-90 text-[#0D1117] rounded-lg transition-colors border-none text-[12px] font-bold shadow-[var(--shadow-button)]"
                          >
                            <Printer size={14} /> Print Tag
                          </button>
                          <button
                            onClick={() => handleReprintTagPDF()}
                            className="flex-1 py-2.5 flex items-center justify-center gap-2 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)] text-[var(--color-foreground)] rounded-lg transition-colors border border-[var(--color-border)] text-[12px] font-medium"
                            title="Open 100×80mm PDF tag (for USB / die-cut label printers)"
                          >
                            <Printer size={14} /> Tag PDF
                          </button>
                        </>
                      )}
                    </div>
                  )}
                  {(user.can_print_ledger || user.role === 'super_admin') && (viewingDetail.raw.type === 'cargo' || viewingDetail.raw.type === 'baggage' || viewingDetail.raw.type === 'package') && (
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={() => handleReprintReceiptPDF()}
                        className="flex-1 py-2.5 flex items-center justify-center gap-2 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)] text-[var(--color-foreground)] rounded-lg transition-colors border border-[var(--color-border)] text-[12px] font-medium"
                        title="Open PDF receipt (for regular printers, or to save/email)"
                      >
                        <Printer size={14} /> PDF Receipt
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal Dialog */}
      {editingTx && (
        <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-[2px] flex items-center justify-center p-4 animate-in fade-in" onClick={() => setEditingTx(null)}>
          <div className="bg-[var(--color-surface-card)] border border-[var(--color-surface-2)] rounded-xl w-full max-w-sm max-h-[85vh] sm:max-h-[90vh] shadow-xl flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-[var(--color-border)] flex justify-between items-center bg-[var(--color-surface-card)] shrink-0">
              <h3 className="font-bold font-sans text-[var(--color-foreground)]">
                Edit Transaction
              </h3>
              <button
                onClick={() => setEditingTx(null)}
                className="text-[var(--color-muted)] hover:text-[var(--color-foreground)] p-1 cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="text-[12px] font-mono text-[var(--color-muted)] bg-[var(--color-border)] p-2 rounded">
                Ref:{" "}
                <span className="text-[var(--color-foreground)]">
                  {editingTx.id}
                </span>
              </div>

              <h4 className="text-[10px] font-mono text-[var(--color-muted)] uppercase tracking-wide -mb-2">
                Details
              </h4>

              {editingTx.type === 'cargo' && (
                <>
                  <div className="space-y-1">
                    <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">
                      Consignee Name
                    </label>
                    <input
                      id="edit-tx-cargo-name"
                      name="edit-tx-cargo-name"
                      type="text"
                      disabled={!canEdit}
                      value={editingTx.name}
                      onChange={(e) => setEditingTx({ ...editingTx, name: e.target.value })}
                      className="w-full h-10 px-3 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-lg text-[var(--color-foreground)] font-sans text-[16px] focus:outline-none focus:border-[var(--color-accent-amber)] disabled:opacity-60"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">
                      Airline
                    </label>
                    <input
                      id="edit-tx-airline"
                      name="edit-tx-airline"
                      type="text"
                      disabled={!canEdit}
                      value={editingTx.airline || ''}
                      onChange={(e) => setEditingTx({ ...editingTx, airline: e.target.value })}
                      className="w-full h-10 px-3 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-lg text-[var(--color-foreground)] font-sans text-[16px] focus:outline-none focus:border-[var(--color-accent-amber)] disabled:opacity-60"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">
                        Route
                      </label>
                      <input
                        id="edit-tx-cargo-route"
                        name="edit-tx-cargo-route"
                        type="text"
                        disabled={!canEdit}
                        value={editingTx.route || ''}
                        onChange={(e) => setEditingTx({ ...editingTx, route: e.target.value })}
                        className="w-full h-10 px-3 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-lg text-[var(--color-foreground)] font-sans text-[14px] focus:outline-none focus:border-[var(--color-accent-amber)] disabled:opacity-60"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">
                        Content Type
                      </label>
                      <input
                        id="edit-tx-content-type"
                        name="edit-tx-content-type"
                        type="text"
                        disabled={!canEdit}
                        value={editingTx.contentType || ''}
                        onChange={(e) => setEditingTx({ ...editingTx, contentType: e.target.value })}
                        className="w-full h-10 px-3 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-lg text-[var(--color-foreground)] font-sans text-[14px] focus:outline-none focus:border-[var(--color-accent-amber)] disabled:opacity-60"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">
                        Pieces
                      </label>
                      <input
                        id="edit-tx-pieces"
                        name="edit-tx-pieces"
                        type="number"
                        min="0"
                        disabled={!canEdit}
                        value={pieceInput}
                        onChange={(e) => setPieceInput(e.target.value)}
                        className="w-full h-10 px-3 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-lg text-[var(--color-foreground)] font-mono text-[16px] focus:outline-none focus:border-[var(--color-accent-amber)] disabled:opacity-60"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">
                        Weight (KG)
                      </label>
                      <input
                        id="edit-tx-kg"
                        name="edit-tx-kg"
                        type="number"
                        min="0"
                        disabled={!canEdit}
                        value={kgInput}
                        onChange={(e) => setKgInput(e.target.value)}
                        className="w-full h-10 px-3 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-lg text-[var(--color-foreground)] font-mono text-[16px] focus:outline-none focus:border-[var(--color-accent-amber)] disabled:opacity-60"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">
                      Remarks
                    </label>
                    <textarea
                      id="edit-tx-remarks"
                      name="edit-tx-remarks"
                      rows={2}
                      disabled={!(canEdit || canEditRemarks)}
                      value={editingTx.remarks || ''}
                      onChange={(e) => setEditingTx({ ...editingTx, remarks: e.target.value.toUpperCase() })}
                      className="w-full px-3 py-2 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-lg text-[var(--color-foreground)] font-sans text-[14px] focus:outline-none focus:border-[var(--color-accent-amber)] resize-none disabled:opacity-60"
                      placeholder="E.G. SENT BY ROAD"
                    />
                  </div>
                  {editingTx.awb_tag_number && (
                    <div className="text-[11px] font-mono text-[var(--color-muted)] bg-[var(--color-border)] p-2 rounded">
                      AWB / Tag:{" "}
                      <span className="text-[var(--color-foreground)]">{editingTx.awb_tag_number}</span>
                    </div>
                  )}
                </>
              )}

              {editingTx.type === 'baggage' && (
                <>
                  <div className="space-y-1">
                    <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">
                      Passenger Name
                    </label>
                    <input
                      id="edit-tx-baggage-name"
                      name="edit-tx-baggage-name"
                      type="text"
                      value={editingTx.name}
                      onChange={(e) => setEditingTx({ ...editingTx, name: e.target.value })}
                      className="w-full h-10 px-3 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-lg text-[var(--color-foreground)] font-sans text-[16px] focus:outline-none focus:border-[var(--color-accent-amber)]"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">
                        Flight
                      </label>
                      <input
                        id="edit-tx-flight"
                        name="edit-tx-flight"
                        type="text"
                        value={editingTx.flight || ''}
                        onChange={(e) => setEditingTx({ ...editingTx, flight: e.target.value })}
                        className="w-full h-10 px-3 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-lg text-[var(--color-foreground)] font-mono text-[16px] focus:outline-none focus:border-[var(--color-accent-amber)]"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">
                        Destination
                      </label>
                      <input
                        id="edit-tx-destination"
                        name="edit-tx-destination"
                        type="text"
                        value={editingTx.destination || ''}
                        onChange={(e) => setEditingTx({ ...editingTx, destination: e.target.value })}
                        className="w-full h-10 px-3 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-lg text-[var(--color-foreground)] font-sans text-[14px] focus:outline-none focus:border-[var(--color-accent-amber)]"
                      />
                    </div>
                  </div>
                </>
              )}

              {editingTx.type === 'marketing' && (
                <>
                  <div className="space-y-1">
                    <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">
                      Customer Name
                    </label>
                    <input
                      id="edit-tx-marketing-name"
                      name="edit-tx-marketing-name"
                      type="text"
                      value={editingTx.name}
                      onChange={(e) => setEditingTx({ ...editingTx, name: e.target.value })}
                      className="w-full h-10 px-3 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-lg text-[var(--color-foreground)] font-sans text-[16px] focus:outline-none focus:border-[var(--color-accent-amber)]"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">
                      Route
                    </label>
                    <input
                      id="edit-tx-marketing-route"
                      name="edit-tx-marketing-route"
                      type="text"
                      value={editingTx.route || ''}
                      onChange={(e) => setEditingTx({ ...editingTx, route: e.target.value })}
                      className="w-full h-10 px-3 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-lg text-[var(--color-foreground)] font-sans text-[14px] focus:outline-none focus:border-[var(--color-accent-amber)]"
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="space-y-1">
                      <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">
                        Big Bags
                      </label>
                      <input
                        id="edit-tx-bb"
                        name="edit-tx-bb"
                        type="number"
                        min="0"
                        value={editBagCounts.bb}
                        onChange={(e) => setEditBagCounts({ ...editBagCounts, bb: e.target.value })}
                        className="w-full h-10 px-2 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-lg text-[var(--color-foreground)] font-mono text-[14px] text-center focus:outline-none focus:border-[var(--color-accent-amber)]"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">
                        Med Bags
                      </label>
                      <input
                        id="edit-tx-mb"
                        name="edit-tx-mb"
                        type="number"
                        min="0"
                        value={editBagCounts.mb}
                        onChange={(e) => setEditBagCounts({ ...editBagCounts, mb: e.target.value })}
                        className="w-full h-10 px-2 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-lg text-[var(--color-foreground)] font-mono text-[14px] text-center focus:outline-none focus:border-[var(--color-accent-amber)]"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">
                        Small Bags
                      </label>
                      <input
                        id="edit-tx-sb"
                        name="edit-tx-sb"
                        type="number"
                        min="0"
                        value={editBagCounts.sb}
                        onChange={(e) => setEditBagCounts({ ...editBagCounts, sb: e.target.value })}
                        className="w-full h-10 px-2 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-lg text-[var(--color-foreground)] font-mono text-[14px] text-center focus:outline-none focus:border-[var(--color-accent-amber)]"
                      />
                    </div>
                  </div>
                </>
              )}

              {editingTx.type === 'package' && (
                <>
                  <div className="space-y-1">
                    <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">
                      Customer Name
                    </label>
                    <input
                      id="edit-tx-package-name"
                      name="edit-tx-package-name"
                      type="text"
                      value={editingTx.name}
                      onChange={(e) => setEditingTx({ ...editingTx, name: e.target.value })}
                      className="w-full h-10 px-3 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-lg text-[var(--color-foreground)] font-sans text-[16px] focus:outline-none focus:border-[var(--color-accent-amber)]"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">
                        Destination
                      </label>
                      <input
                        id="edit-tx-package-destination"
                        name="edit-tx-package-destination"
                        type="text"
                        value={editingTx.destination || ''}
                        onChange={(e) => setEditingTx({ ...editingTx, destination: e.target.value })}
                        className="w-full h-10 px-3 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-lg text-[var(--color-foreground)] font-sans text-[14px] focus:outline-none focus:border-[var(--color-accent-amber)]"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">
                        Content Type
                      </label>
                      <select
                        id="edit-tx-package-content-type"
                        name="edit-tx-package-content-type"
                        value={editingTx.contentType || 'Package'}
                        onChange={(e) => setEditingTx({ ...editingTx, contentType: e.target.value })}
                        className="w-full h-10 px-3 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-lg text-[var(--color-foreground)] font-sans text-[14px] focus:outline-none focus:border-[var(--color-accent-amber)]"
                      >
                        <option value="Package">Package</option>
                        <option value="Parcel">Parcel</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">
                        Pieces
                      </label>
                      <input
                        id="edit-tx-package-pcs"
                        name="edit-tx-package-pcs"
                        type="number"
                        min="0"
                        value={pieceInput}
                        onChange={(e) => setPieceInput(e.target.value)}
                        className="w-full h-10 px-3 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-lg text-[var(--color-foreground)] font-mono text-[16px] focus:outline-none focus:border-[var(--color-accent-amber)]"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">
                        Weight (KG)
                      </label>
                      <input
                        id="edit-tx-package-kg"
                        name="edit-tx-package-kg"
                        type="number"
                        min="0"
                        value={kgInput}
                        onChange={(e) => setKgInput(e.target.value)}
                        className="w-full h-10 px-3 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-lg text-[var(--color-foreground)] font-mono text-[16px] focus:outline-none focus:border-[var(--color-accent-amber)]"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">
                      Contents
                    </label>
                    <select
                      id="edit-tx-package-contents"
                      name="edit-tx-package-contents"
                      value={editingTx.contents || contentTypes[0]}
                      onChange={(e) => setEditingTx({ ...editingTx, contents: e.target.value })}
                      className="w-full h-10 px-3 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-lg text-[var(--color-foreground)] font-sans text-[14px] focus:outline-none focus:border-[var(--color-accent-amber)]"
                    >
                      {contentTypes.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </>
              )}

              <h4 className="text-[10px] font-mono text-[var(--color-muted)] uppercase tracking-wide -mb-2 pt-2 border-t border-[var(--color-border)]">
                Payment
              </h4>

              <div className="space-y-1">
                <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">
                  Amount (₦)
                </label>
                <input
                  id="edit-tx-amount"
                  name="edit-tx-amount"
                  type="number"
                  min="0"
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  className="w-full h-10 px-3 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-lg text-[var(--color-foreground)] font-mono text-[16px] focus:outline-none focus:border-[var(--color-accent-amber)]"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">
                  Payment Mode
                </label>
                <select
                  value={editingTx.mode}
                  onChange={(e) =>
                    setEditingTx({ ...editingTx, mode: e.target.value as any })
                  }
                  className="w-full h-10 px-3 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-lg text-[var(--color-foreground)] font-sans text-[16px] focus:outline-none focus:border-[var(--color-accent-amber)]"
                >
                  <option value="Cash">Cash</option>
                  <option value="Transfer">Bank Transfer</option>
                  <option value="POS">POS / Card</option>
                  <option value="Debt">Debt</option>
                </select>
              </div>

              {editingTx.mode === "Transfer" && (
                <div className="space-y-1">
                  <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">
                    Bank
                  </label>
                  <select
                    value={editingTx.bank || ""}
                    onChange={(e) =>
                      setEditingTx({ ...editingTx, bank: e.target.value })
                    }
                    className="w-full h-10 px-3 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-lg text-[var(--color-foreground)] font-sans text-[16px] focus:outline-none focus:border-[var(--color-accent-amber)]"
                  >
                    <option value="">Select Bank</option>
                    {banks.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
              )}

              <div className="space-y-1">
                <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">
                  Status
                </label>
                <select
                  value={editingTx.status}
                  onChange={(e) =>
                    setEditingTx({
                      ...editingTx,
                      status: e.target.value as any,
                    })
                  }
                  className="w-full h-10 px-3 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-lg text-[var(--color-foreground)] font-sans text-[16px] focus:outline-none focus:border-[var(--color-accent-amber)]"
                >
                  <option value="Intake">Intake</option>
                  <option value="Dispatched">Dispatched</option>
                  <option value="Delivered">Delivered</option>
                  <option value="Cancelled">Cancelled</option>
                </select>
              </div>
            </div>

            <div className="p-4 border-t border-[var(--color-border)] bg-[var(--color-surface-card)] flex justify-end shrink-0">
              <button
                onClick={handleSaveEdit}
                className="h-9 px-4 bg-[var(--color-success)] hover:bg-emerald-600 text-[var(--color-obsidian)] font-bold font-sans text-[13px] rounded-lg cursor-pointer flex items-center gap-1.5 transition-colors"
              >
                <Check size={14} />
                <span>Save Changes</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* QR Code Modal Dialog */}
      {viewingQrTx && (
        <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-[2px] flex items-center justify-center p-4 animate-in fade-in" onClick={() => setViewingQrTx(null)}>
          <div className="bg-[var(--color-surface-card)] border border-[var(--color-surface-2)] rounded-xl w-full max-w-sm shadow-xl flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-[var(--color-border)] flex justify-between items-center bg-[var(--color-surface-card)]">
              <h3 className="font-bold font-sans text-[var(--color-foreground)]">
                Scan to View
              </h3>
              <button
                onClick={() => setViewingQrTx(null)}
                className="text-[var(--color-muted)] hover:text-[var(--color-foreground)] p-1 cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-8 flex flex-col items-center justify-center space-y-4 bg-[var(--color-obsidian)]">
              <div className="bg-white p-4 rounded-xl shadow-inner">
                <QRCode id={viewingQrTx.id} size={200} />
              </div>
              <div className="text-center">
                <p className="text-[14px] font-bold text-[var(--color-foreground)] mb-1">
                  {viewingQrTx.id}
                </p>
                <p className="text-[12px] text-[var(--color-muted)]">
                  {viewingQrTx.name}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
