import { useState, useMemo, useEffect } from 'react';
import { User, Transaction } from '../../lib/types';
import { fmt, sanitizeSpreadsheetAoA } from '../../lib/helpers';
import { supabase } from '../../lib/supabase';
import { Calendar, FileText, Download, Printer, ChevronRight, Filter, Loader2 } from 'lucide-react';
import { BackButton } from '../BackButton';
import { DepartmentSalesAnalysisView } from '../DepartmentSalesAnalysis';
import { DepartmentSalesAnalysis, computeDepartmentSalesAnalysis, computeReportDateRange } from '../../lib/salesAnalysis';
import * as XLSX from 'xlsx';

const REPORT_TYPES = [
  { id: 'revenue',       label: 'Revenue Summary',                  desc: 'Stream, mode, and total breakdown' },
  { id: 'airline_sales', label: 'Airline Performance (Sales & KG)', desc: 'Total Sales (₦) and Total Weight (KG) per Airline' },
  { id: 'routes',        label: 'Route Profitability',              desc: 'Cargo + marketing by destination' },
  { id: 'customers',     label: 'Top Consignees',                   desc: 'Highest revenue customers' },
  { id: 'debtors',       label: 'Debtor Aging',                     desc: 'Outstanding balances 0-30/31-60/61-90/90+' },
  { id: 'staff',         label: 'Staff Productivity',               desc: 'Entries and revenue per agent, all departments combined' },
  { id: 'sales_cargo',      label: 'Cargo Sales Analysis',      desc: 'Owed, collected, and top route per agent -- Cargo only' },
  { id: 'sales_marketing',  label: 'Marketing Sales Analysis',  desc: 'Owed, collected, and top route per agent -- Marketing only' },
  { id: 'sales_baggage',    label: 'Baggage Sales Analysis',    desc: 'Owed, collected, and top destination per agent -- Baggage only' },
  { id: 'sales_package',    label: 'Package Sales Analysis',    desc: 'Owed, collected, and top destination per agent -- Package only' },
  { id: 'hubs',          label: 'Hub Comparison',                   desc: 'Per-hub revenue (admin only)' },
  { id: 'b2b_sales',     label: 'Office Work (B2B) Sales',          desc: 'All Office Work client transactions' },
];

const PRESETS = [
  { id: 'today',     label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'week',      label: 'Last 7 Days' },
  { id: 'month',     label: 'This Month' },
  { id: 'last_month',label: 'Last Month' },
  { id: 'quarter',   label: 'This Quarter' },
  { id: 'ytd',       label: 'Year to Date' },
  { id: 'custom',    label: 'Custom Range' },
];

export const Reports = ({ user, transactions, onBack }: { user: User; transactions: Transaction[]; onBack?: () => void }) => {
  const [selectedReport, setSelectedReport] = useState<string | null>(null);
  const [preset, setPreset] = useState('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo,   setCustomTo]   = useState('');
  const [generating, setGenerating] = useState(false);
  const [hubNames, setHubNames] = useState<Record<string, string>>({});
  const [fetchedTx, setFetchedTx] = useState<Transaction[]>([]);
  const [isLoadingTx, setIsLoadingTx] = useState(false);
  const [corpClientsMap, setCorpClientsMap] = useState<Record<string, string>>({});

  useEffect(() => {
    supabase.from('hubs').select('id, name, code').then(({ data }) => {
      if (data) {
        const map: Record<string, string> = {};
        data.forEach((h: any) => { map[h.id] = `${h.code}/${h.name}`; });
        setHubNames(map);
      }
    });
    supabase.from('corporate_clients').select('id, company_name').then(({ data }) => {
      if (data) {
        const map: Record<string, string> = {};
        data.forEach((c: any) => { map[c.id] = c.company_name; });
        setCorpClientsMap(map);
      }
    });
  }, []);

  // Compute date range
  const dateRange = useMemo(() => computeReportDateRange(preset, customFrom, customTo), [preset, customFrom, customTo]);

  // Fetch transactions based on dateRange
  useEffect(() => {
    let isMounted = true;
    const fetchTransactions = async () => {
      setIsLoadingTx(true);
      const fromISO = dateRange.from.toISOString();
      const toISO = dateRange.to.toISOString();
      
      const isAdmin = ['super_admin','admin','accountant','auditor'].includes(user.role);
      const addHubFilter = (q: any) => (!isAdmin && user.hub_id) ? q.eq('hub_id', user.hub_id) : q;

      try {
        const [cargoRes, vjRes, mktRes, pkgRes, profilesRes] = await Promise.all([
          addHubFilter(supabase.from('cargo_entries').select('entry_ref,consignee_name,airline,awb_tag_number,total_pcs,total_kg,route,content_type,amount,receipt_mode,created_at,status,bank,hub_id,corporate_client_id,client_type,entered_by,amount_paid,retrieved_amount').gte('created_at', fromISO).lte('created_at', toISO)),
          addHubFilter(supabase.from('manifests').select('transaction_id,passenger_name,flight_no,destination,excess_kg,amount,payment_mode,created_at,bank,hub_id,total_kg,pnr,passenger_phone,entered_by,amount_paid,retrieved_amount').gte('created_at', fromISO).lte('created_at', toISO)),
          addHubFilter(supabase.from('marketing_entries').select('entry_ref,customer_name,route,qty_big_bag,qty_med_bag,qty_small_bag,amount_paid,payment_mode,created_at,hub_id,bank,entered_by,debt_amount_paid,retrieved_amount').gte('created_at', fromISO).lte('created_at', toISO)),
          addHubFilter(supabase.from('package_entries').select('entry_ref,customer_name,destination,content_type,total_pcs,total_kg,contents,amount,payment_mode,created_at,hub_id,bank,entered_by,status,amount_paid,debt_paid,retrieved_amount').gte('created_at', fromISO).lte('created_at', toISO)),
          supabase.from('user_profiles').select('id,name')
        ]);

        const profileLookup: Record<string, string> = {};
        if (profilesRes.data) {
          profilesRes.data.forEach((p: any) => {
            if (p.id) profileLookup[p.id] = p.name || '';
          });
        }

        const allTx: Transaction[] = [];

        if (cargoRes.data) {
          cargoRes.data.forEach((r: any) => {
            const enteredByName = r.entered_by ? (profileLookup[r.entered_by] || r.entered_by) : undefined;
            allTx.push({
              id: r.entry_ref,
              name: r.consignee_name || 'Consignee',
              detail: `${r.airline || 'Airline'} · ${r.awb_tag_number || ''} · ${r.total_pcs || 1}pcs · ${r.total_kg || 0}kg · ${r.route || ''} · ${r.content_type || 'Package'}`,
              amount: r.amount || 0,
              // Same 'Debt Paid' derivation EHIApp.tsx's fetchInitial uses --
              // receipt_mode itself never changes off 'Debt' when a debt is
              // cleared (only amount_paid moves), so without this every
              // cleared cargo debt still showed as outstanding here forever.
              mode: r.receipt_mode === 'Debt' && (r.amount_paid || 0) >= (r.amount || 0) ? 'Debt Paid' : (r.receipt_mode || 'Cash'),
              time: new Date(r.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
              type: 'cargo',
              status: r.status,
              created_at: r.created_at,
              bank: r.bank,
              hub_id: r.hub_id,
              route: r.route,
              awb_tag_number: r.awb_tag_number,
              airline: r.airline,
              pieces: r.total_pcs || 1,
              kg: r.total_kg || 0,
              contentType: r.content_type,
              clientType: r.client_type || undefined,
              enteredByName: enteredByName || undefined,
              amountPaid: r.amount_paid || 0,
              raw: { corporate_client_id: r.corporate_client_id, retrieved_amount: r.retrieved_amount }
            });
          });
        }

        if (vjRes.data) {
          vjRes.data.forEach((r: any) => {
            const enteredByName = r.entered_by ? (profileLookup[r.entered_by] || r.entered_by) : undefined;
            allTx.push({
              id: r.transaction_id,
              name: r.passenger_name || 'Passenger',
              detail: `${r.flight_no || ''} · ${r.destination || ''} · ${r.total_pcs || 1}pcs · +${r.excess_kg || 0}kg excess`,
              amount: r.amount || 0,
              // Same 'Debt Paid' derivation as cargo above.
              mode: r.payment_mode === 'Debt' && (r.amount_paid || 0) >= (r.amount || 0) ? 'Debt Paid' : (r.payment_mode || 'Cash'),
              time: new Date(r.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
              type: 'baggage',
              status: r.status || 'Received',
              created_at: r.created_at,
              bank: r.bank,
              hub_id: r.hub_id,
              airline: r.airline || 'ValueJet',
              destination: r.destination,
              flight: r.flight_no,
              pnr: r.pnr || undefined,
              pieces: r.total_pcs || 1,
              excessKg: r.excess_kg || 0,
              totalKg: r.total_kg || 0,
              kg: r.excess_kg || 0,
              enteredByName: enteredByName || undefined,
              amountPaid: r.amount_paid || 0,
              raw: { retrieved_amount: r.retrieved_amount },
            });
          });
        }

        if (mktRes.data) {
          mktRes.data.forEach((r: any) => {
            const enteredByName = r.entered_by ? (profileLookup[r.entered_by] || r.entered_by) : undefined;
            allTx.push({
              id: r.entry_ref || r.id,
              name: r.customer_name || 'Customer',
              detail: `${r.route || 'Local'} · BB:${r.qty_big_bag||0} MB:${r.qty_med_bag||0} SB:${r.qty_small_bag||0}`,
              amount: r.amount_paid || 0,
              // marketing_entries.amount_paid is the sale total, NOT how
              // much of a debt sale has been paid off -- that's
              // debt_amount_paid (matches EHIApp.tsx's fetchInitial, which
              // uses the same two columns the same way).
              mode: r.payment_mode === 'Debt' && (r.debt_amount_paid || 0) >= (r.amount_paid || 0) ? 'Debt Paid' : (r.payment_mode || 'Cash'),
              time: new Date(r.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
              type: 'marketing',
              status: r.status || 'Received',
              created_at: r.created_at,
              bank: r.bank,
              hub_id: r.hub_id,
              route: r.route,
              enteredByName: enteredByName || undefined,
              amountPaid: r.debt_amount_paid || 0,
              raw: { retrieved_amount: r.retrieved_amount },
            });
          });
        }

        if (pkgRes.data) {
          pkgRes.data.forEach((r: any) => {
            const enteredByName = r.entered_by ? (profileLookup[r.entered_by] || r.entered_by) : undefined;
            allTx.push({
              id: r.entry_ref || r.id,
              name: r.customer_name || 'Customer',
              detail: `${r.destination || 'Destination'} · ${r.content_type || 'Package'} · ${r.total_pcs || 1}pcs · ${r.total_kg || 0}kg`,
              amount: r.amount || 0,
              // Same 'Debt Paid' derivation EHIApp.tsx's fetchInitial uses
              // for package_entries (debt_paid flag OR amount_paid caught up).
              mode: r.payment_mode === 'Debt' && (r.debt_paid === true || (r.amount_paid || 0) >= (r.amount || 0)) ? 'Debt Paid' : (r.payment_mode || 'Cash'),
              time: new Date(r.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
              type: 'package',
              status: r.status || 'Received',
              created_at: r.created_at,
              bank: r.bank,
              hub_id: r.hub_id,
              route: r.destination,
              destination: r.destination,
              contentType: r.content_type,
              pieces: r.total_pcs || 1,
              kg: r.total_kg || 0,
              contents: r.contents || undefined,
              enteredByName: enteredByName || undefined,
              amountPaid: r.amount_paid || 0,
              raw: { retrieved_amount: r.retrieved_amount },
            });
          });
        }
        
        if (isMounted) {
          setFetchedTx(allTx.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()));
        }
      } catch (err) {
        console.error("Failed to fetch report transactions", err);
      } finally {
        if (isMounted) setIsLoadingTx(false);
      }
    };

    fetchTransactions();
    return () => { isMounted = false; };
  }, [dateRange, user]);

  // Filter transactions to date range (we now just use the fetchedTx, which are already filtered by the DB)
  const filteredTx = useMemo(() => {
    return fetchedTx;
  }, [fetchedTx]);

  // ── Report computations ─────────────────────────

  const revenueReport = useMemo(() => {
    const cargo     = filteredTx.filter(t => t.type === 'cargo');
    const marketing = filteredTx.filter(t => t.type === 'marketing');
    const vj        = filteredTx.filter(t => t.type === 'baggage');
    return {
      streams: [
        { name: 'Air Cargo',          count: cargo.length,     amount: cargo.reduce((s,t) => s+t.amount, 0) },
        { name: 'Field Marketing',    count: marketing.length, amount: marketing.reduce((s,t) => s+t.amount, 0) },
        { name: 'Excess Baggage',     count: vj.length,        amount: vj.reduce((s,t) => s+t.amount, 0) },
      ],
      modes: [
        { name: 'Cash',     amount: filteredTx.filter(t => t.mode === 'Cash').reduce((s,t) => s+t.amount, 0) },
        { name: 'Transfer', amount: filteredTx.filter(t => t.mode === 'Transfer').reduce((s,t) => s+t.amount, 0) },
        { name: 'POS',      amount: filteredTx.filter(t => t.mode === 'POS').reduce((s,t) => s+t.amount, 0) },
        { name: 'Credit (Debt)', amount: filteredTx.filter(t => t.mode === 'Debt').reduce((s,t) => s+t.amount, 0) },
      ],
      total: filteredTx.reduce((s,t) => s+t.amount, 0),
    };
  }, [filteredTx]);

  const routeReport = useMemo(() => {
    const map: Record<string, { revenue: number; count: number; cargo: number; mktg: number }> = {};
    filteredTx.filter(t => t.type === 'cargo' || t.type === 'marketing').forEach(t => {
      const route = t.route || t.detail?.split('·')[0]?.trim() || 'Unknown';
      if (!map[route]) map[route] = { revenue: 0, count: 0, cargo: 0, mktg: 0 };
      map[route].revenue += t.amount;
      map[route].count   += 1;
      if (t.type === 'cargo') map[route].cargo += t.amount; else map[route].mktg += t.amount;
    });
    return Object.entries(map)
      .map(([route, d]) => ({ route, ...d }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [filteredTx]);

  const customerReport = useMemo(() => {
    const map: Record<string, { revenue: number; transactions: number; lastSeen: string }> = {};
    filteredTx.forEach(t => {
      const name = (t.name || 'Unknown').trim();
      if (!map[name]) map[name] = { revenue: 0, transactions: 0, lastSeen: t.time || '' };
      map[name].revenue      += t.amount;
      map[name].transactions += 1;
      if (t.time && t.time > map[name].lastSeen) map[name].lastSeen = t.time;
    });
    return Object.entries(map)
      .map(([name, d]) => ({ name, ...d }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 20);
  }, [filteredTx]);

  const debtorReport = useMemo(() => {
    const debts = filteredTx.filter(t => t.mode === 'Debt');
    const buckets = { 'Current': 0, 'Overdue': 0, 'Critical': 0, 'Write-off risk': 0 };
    const items: Array<{ name: string; amount: number; age: number; bucket: string }> = [];
    
    debts.forEach(t => {
      const agedays = Math.floor(
        (Date.now() - new Date(t.created_at || (t as any).date || Date.now()).getTime())
        / (1000 * 60 * 60 * 24)
      );
      const bucket = agedays <= 30 ? 'Current' : agedays <= 60 ? 'Overdue' : agedays <= 90 ? 'Critical' : 'Write-off risk';
      buckets[bucket as keyof typeof buckets] += t.amount;
      items.push({ name: t.name, amount: t.amount, age: agedays, bucket });
    });
    
    return { buckets, items: items.sort((a, b) => b.age - a.age), total: debts.reduce((s,t) => s+t.amount, 0) };
  }, [filteredTx]);

  const staffReport = useMemo(() => {
    const map: Record<string, { entries: number; revenue: number; collected: number; owed: number; cargo: number; mktg: number; vj: number; pkg: number }> = {};
    filteredTx.forEach(t => {
      const agent = (t.enteredByName || 'Unknown Agent').trim();
      if (!map[agent]) map[agent] = { entries: 0, revenue: 0, collected: 0, owed: 0, cargo: 0, mktg: 0, vj: 0, pkg: 0 };
      map[agent].entries += 1;
      // Gross value of business this agent brought in -- unchanged from before.
      map[agent].revenue += t.amount;
      if (t.type === 'cargo')     map[agent].cargo += t.amount;
      if (t.type === 'marketing') map[agent].mktg  += t.amount;
      if (t.type === 'baggage')   map[agent].vj    += t.amount;
      if (t.type === 'package')   map[agent].pkg   += t.amount;

      // Collected -- actual liquid cash, excluding unpaid Debt AND the
      // original entry once it flips to 'Debt Paid' on clearance (that
      // money is already counted once via its own DC- shadow collection
      // entry -- same double-count guard as TransactionLedger.tsx's
      // totalAmount and Analytics.tsx's validLiquidTxs).
      if (t.mode !== 'Debt' && t.mode !== 'Debt Paid') {
        map[agent].collected += t.amount;
      }

      // Owed -- true remaining balance net of any partial payment or
      // retrieval credit, same formula DebtorsTab.tsx/Analytics.tsx's
      // debtOutstanding use. A DC- collection entry is attributed to
      // whoever cleared the debt (may differ from the original agent),
      // so this only ever accrues on the original still-open Debt entry.
      if (t.mode === 'Debt') {
        const remaining = t.amount - (t.amountPaid || 0) - ((t.raw as any)?.retrieved_amount || 0);
        map[agent].owed += Math.max(0, remaining);
      }
    });
    return Object.entries(map).map(([role, d]) => ({ role, ...d })).sort((a, b) => b.revenue - a.revenue).slice(0, 20);
  }, [filteredTx]);

  // Layer 1 -- collective totals across every agent, shown before the
  // per-agent breakdown so whoever's reading gets the big picture first.
  const staffCollective = useMemo(() => staffReport.reduce((acc, s) => ({
    entries: acc.entries + s.entries,
    revenue: acc.revenue + s.revenue,
    collected: acc.collected + s.collected,
    owed: acc.owed + s.owed,
  }), { entries: 0, revenue: 0, collected: 0, owed: 0 }), [staffReport]);

  const cargoSalesAnalysis = useMemo(() => computeDepartmentSalesAnalysis(filteredTx, 'cargo'), [filteredTx]);
  const marketingSalesAnalysis = useMemo(() => computeDepartmentSalesAnalysis(filteredTx, 'marketing'), [filteredTx]);
  const baggageSalesAnalysis = useMemo(() => computeDepartmentSalesAnalysis(filteredTx, 'baggage'), [filteredTx]);
  const packageSalesAnalysis = useMemo(() => computeDepartmentSalesAnalysis(filteredTx, 'package'), [filteredTx]);

  const hubReport = useMemo(() => {
    const byHub: Record<string, { revenue: number; entries: number }> = {};
    filteredTx.forEach(t => {
      const hid = t.hub_id || 'Unknown';
      if (!byHub[hid]) byHub[hid] = { revenue: 0, entries: 0 };
      byHub[hid].revenue += t.amount;
      byHub[hid].entries += 1;
    });
    return Object.entries(byHub).map(([id, d]) => ({
      hub_id: id,
      hub_name: hubNames[id] || id,
      ...d
    })).sort((a, b) => b.revenue - a.revenue);
  }, [filteredTx, hubNames]);

  const airlineReport = useMemo(() => {
    const map: Record<string, { cargoSales: number; cargoKg: number; baggageSales: number; baggageKg: number; totalSales: number; totalKg: number; count: number }> = {};
    filteredTx.forEach(t => {
      const air = (t.airline || (t.type === 'baggage' ? 'ValueJet' : t.type === 'marketing' ? 'Marketing Desk' : 'Unassigned')).trim();
      if (!map[air]) map[air] = { cargoSales: 0, cargoKg: 0, baggageSales: 0, baggageKg: 0, totalSales: 0, totalKg: 0, count: 0 };
      const st = map[air];
      st.totalSales += t.amount || 0;
      st.count += 1;

      if (t.type === 'cargo') {
        st.cargoSales += t.amount || 0;
        st.cargoKg += (t as any).totalKg || (t as any).kg || 0;
        st.totalKg += (t as any).totalKg || (t as any).kg || 0;
      } else if (t.type === 'baggage') {
        st.baggageSales += t.amount || 0;
        st.baggageKg += (t as any).excessKg || (t as any).kg || 0;
        st.totalKg += (t as any).excessKg || (t as any).kg || 0;
      } else if (t.type === 'package') {
        st.totalKg += (t as any).kg || 0;
      }
    });

    return Object.entries(map)
      .map(([airline, d]) => ({ airline, ...d }))
      .sort((a, b) => b.totalSales - a.totalSales);
  }, [filteredTx]);

  const b2bReport = useMemo(() => {
    const corporateClientNames = Object.values(corpClientsMap).map(n => n.toLowerCase());
    const b2bTxs = filteredTx.filter(t => {
      const isLinked = t.raw?.corporate_client_id != null;
      const nameMatch = corporateClientNames.includes((t.name || '').toLowerCase());
      return t.type === 'cargo' && (isLinked || nameMatch);
    });

    const byClient: Record<string, { revenue: number; entries: number; routeCount: Set<string> }> = {};
    b2bTxs.forEach(t => {
      const clientId = t.raw?.corporate_client_id;
      const cName = clientId ? (corpClientsMap[clientId] || t.name) : t.name;
      
      if (!byClient[cName]) byClient[cName] = { revenue: 0, entries: 0, routeCount: new Set() };
      byClient[cName].revenue += t.amount;
      byClient[cName].entries += 1;
      if (t.route) byClient[cName].routeCount.add(t.route);
    });

    return {
      items: Object.entries(byClient)
        .map(([name, d]) => ({ name, revenue: d.revenue, entries: d.entries, routes: d.routeCount.size }))
        .sort((a, b) => b.revenue - a.revenue),
      totalRevenue: b2bTxs.reduce((s, t) => s + t.amount, 0),
      totalEntries: b2bTxs.length
    };
  }, [filteredTx, corpClientsMap]);

  // ── Export functions ─────────────────────────────

  const handleDownloadExcel = () => {
    let wsData: any[][] = [];
    if (selectedReport === 'revenue') {
      wsData = [
        ['EHI MULTISYSTEMS - REVENUE SUMMARY'],
        ['Period:', dateRange.from.toLocaleDateString(), 'to', dateRange.to.toLocaleDateString()],
        [],
        ['Category', 'Count', 'Amount (NGN)'],
        ...revenueReport.streams.map(s => [s.name, s.count, s.amount]),
        [],
        ['Payment Modes'],
        ...revenueReport.modes.map(m => [m.name, '', m.amount]),
        [],
        ['TOTAL REVENUE', '', revenueReport.total]
      ];
    } else if (selectedReport === 'routes') {
      wsData = [
        ['EHI MULTISYSTEMS - ROUTE PROFITABILITY'],
        ['Period:', dateRange.from.toLocaleDateString(), 'to', dateRange.to.toLocaleDateString()],
        [],
        ['Route', 'Transactions', 'Air Cargo (NGN)', 'Marketing (NGN)', 'Total Revenue (NGN)'],
        ...routeReport.map(r => [r.route, r.count, r.cargo, r.mktg, r.revenue])
      ];
    } else if (selectedReport === 'customers') {
      wsData = [
        ['EHI MULTISYSTEMS - TOP CONSIGNEES'],
        ['Period:', dateRange.from.toLocaleDateString(), 'to', dateRange.to.toLocaleDateString()],
        [],
        ['Customer Name', 'Transactions', 'Last Seen', 'Total Revenue (NGN)'],
        ...customerReport.map(c => [c.name, c.transactions, c.lastSeen, c.revenue])
      ];
    } else if (selectedReport === 'debtors') {
      wsData = [
        ['EHI MULTISYSTEMS - DEBTOR AGING'],
        ['Period:', dateRange.from.toLocaleDateString(), 'to', dateRange.to.toLocaleDateString()],
        [],
        ['Customer Name', 'Age (Days)', 'Bucket', 'Amount (NGN)'],
        ...debtorReport.items.map(d => [d.name, d.age, d.bucket, d.amount])
      ];
    } else if (selectedReport === 'staff') {
      wsData = [
        ['EHI MULTISYSTEMS - STAFF PRODUCTIVITY'],
        ['Period:', dateRange.from.toLocaleDateString(), 'to', dateRange.to.toLocaleDateString()],
        [],
        ['ALL AGENTS COMBINED'],
        ['Total Entries', 'Total Sales (NGN)', 'Total Collected (NGN)', 'Total Owed (NGN)'],
        [staffCollective.entries, staffCollective.revenue, staffCollective.collected, staffCollective.owed],
        [],
        ['PER-AGENT DETAIL'],
        ['Agent Name', 'Owed (NGN)', 'Entries', 'Total Sales (NGN)', 'Collected (NGN)', 'Cargo', 'Mktg', 'Baggage', 'Package'],
        ...staffReport.map(s => [s.role, s.owed, s.entries, s.revenue, s.collected, s.cargo, s.mktg, s.vj, s.pkg])
      ];
    } else if (selectedReport.startsWith('sales_')) {
      const deptData: Record<string, { label: string; routeLabel: string; data: DepartmentSalesAnalysis }> = {
        sales_cargo:     { label: 'CARGO SALES ANALYSIS',     routeLabel: 'Route',       data: cargoSalesAnalysis },
        sales_marketing: { label: 'MARKETING SALES ANALYSIS', routeLabel: 'Route',       data: marketingSalesAnalysis },
        sales_baggage:   { label: 'BAGGAGE SALES ANALYSIS',   routeLabel: 'Destination', data: baggageSalesAnalysis },
        sales_package:   { label: 'PACKAGE SALES ANALYSIS',   routeLabel: 'Destination', data: packageSalesAnalysis },
      };
      const d = deptData[selectedReport];
      wsData = [
        [`EHI MULTISYSTEMS - ${d.label}`],
        ['Period:', dateRange.from.toLocaleDateString(), 'to', dateRange.to.toLocaleDateString()],
        [],
        ['ALL AGENTS COMBINED'],
        ['Total Agents', 'Total Entries', 'Total Sales (NGN)', 'Total Collected (NGN)', 'Total Owed (NGN)', 'Cash (NGN)', 'Transfer (NGN)', 'POS/Card (NGN)', 'Wallet (NGN)'],
        [d.data.collective.agentCount, d.data.collective.entries, d.data.collective.revenue, d.data.collective.collected, d.data.collective.owed, d.data.collective.cash, d.data.collective.transfer, d.data.collective.pos, d.data.collective.wallet],
        [],
        ['PER-AGENT DETAIL'],
        ['Agent Name', 'Owed (NGN)', 'Entries', 'Sales Value (NGN)', 'Collected (NGN)', 'Cash (NGN)', 'Transfer (NGN)', 'POS/Card (NGN)', 'Wallet (NGN)', `Top ${d.routeLabel}`, `Top ${d.routeLabel} Count`],
        ...d.data.agents.map(s => [s.role, s.owed, s.entries, s.revenue, s.collected, s.cash, s.transfer, s.pos, s.wallet, s.topRoute || '', s.topRouteCount])
      ];
    } else if (selectedReport === 'hubs') {
      wsData = [
        ['EHI MULTISYSTEMS - HUB COMPARISON'],
        ['Period:', dateRange.from.toLocaleDateString(), 'to', dateRange.to.toLocaleDateString()],
        [],
        ['Hub Code/Name', 'Entries', 'Total Revenue (NGN)'],
        ...hubReport.map(h => [h.hub_name, h.entries, h.revenue])
      ];
    } else if (selectedReport === 'b2b_sales') {
      wsData = [
        ['EHI MULTISYSTEMS - OFFICE WORK (B2B) SALES'],
        ['Period:', dateRange.from.toLocaleDateString(), 'to', dateRange.to.toLocaleDateString()],
        [],
        ['Office Work Client', 'Entries', 'Routes Used', 'Total Revenue (NGN)'],
        ...b2bReport.items.map(b => [b.name, b.entries, b.routes, b.revenue]),
        [],
        ['TOTAL B2B REVENUE', '', '', b2bReport.totalRevenue]
      ];
    }

    if (wsData.length === 0) return;

    const ws = XLSX.utils.aoa_to_sheet(sanitizeSpreadsheetAoA(wsData));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Report");
    XLSX.writeFile(wb, `EHI_Report_${selectedReport}_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const exportToPdf = async () => {
    setGenerating(true);
    // Dynamic import — PDF report generator
    const { downloadReportPDF } = await import('./ReportPDF');
    await downloadReportPDF({
      reportType:    selectedReport!,
      reportLabel:   REPORT_TYPES.find(r => r.id === selectedReport)?.label || '',
      hubName:       user.hub,
      generatedBy:   user.name,
      dateRange,
      revenue:       selectedReport === 'revenue'   ? revenueReport  : null,
      routes:        selectedReport === 'routes'    ? routeReport    : null,
      customers:     selectedReport === 'customers' ? customerReport : null,
      debtors:       selectedReport === 'debtors'   ? debtorReport   : null,
      staff:         selectedReport === 'staff'     ? staffReport    : null,
      hubs:          selectedReport === 'hubs'      ? hubReport      : null,
    });
    setGenerating(false);
  };

  // ── Render ───────────────────────────────────────

  return (
    <div>
      <div className="ehi-page-body px-4 pt-4 space-y-4">
      <div className="flex items-center gap-3 border-b border-[var(--color-border)] pb-2">
        {onBack && <BackButton onClick={onBack} />}
        <div>
          <div className="text-[9px] font-mono text-[var(--color-muted)] tracking-[0.12em] uppercase">▸ REPORTS CENTRE</div>
          <div className="text-[11px] font-mono text-[var(--color-accent-amber)] mt-0.5">{user.hub}</div>
        </div>
      </div>

      {!selectedReport ? (
        // ── Report selection grid ──
        <div className="grid gap-3 md:grid-cols-2">
          {REPORT_TYPES
            .filter(r => r.id !== 'hubs' || user.role === 'super_admin' || user.role === 'admin')
            .map(r => (
            <button
              key={r.id}
              onClick={() => setSelectedReport(r.id)}
              className="ehi-card text-left p-4 flex items-start gap-3 bg-[var(--color-surface-card)] hover:bg-[var(--color-surface-2)] transition-colors cursor-pointer"
            >
              <div className="w-9 h-9 rounded-[var(--radius-sm)] bg-[rgba(245,158,11,0.12)] flex items-center justify-center shrink-0">
                <FileText size={16} className="text-[var(--color-accent-amber)]" />
              </div>
              <div className="flex-1">
                <div className="text-[14px] font-bold text-[var(--color-foreground)]">{r.label}</div>
                <div className="text-[11px] text-[var(--color-muted)] mt-0.5">{r.desc}</div>
              </div>
              <ChevronRight size={16} className="text-[var(--color-muted)] mt-1" />
            </button>
          ))}
        </div>
      ) : (
        // ── Report viewer ──
        <div className="space-y-4">
          <button
            onClick={() => setSelectedReport(null)}
            className="text-[11px] text-[var(--color-muted)] bg-transparent border-none cursor-pointer hover:text-[var(--color-foreground)] transition-colors"
          >
            ← Back to reports
          </button>

          {/* Date range selector */}
          <div className="ehi-card p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Calendar size={13} className="text-[var(--color-accent-amber)]" />
              <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--color-accent-amber)] font-bold">Date Range</span>
            </div>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(110px,1fr))] gap-2">
              {PRESETS.map(p => (
                <button
                  key={p.id}
                  onClick={() => setPreset(p.id)}
                  className={`min-w-0 truncate px-3 py-2 text-[11px] font-mono border rounded-[var(--radius-sm)] transition-colors cursor-pointer ${
                    preset === p.id
                      ? 'bg-[var(--color-accent-amber)] text-[#0B0F19] border-[var(--color-accent-amber)] font-bold'
                      : 'bg-[var(--color-surface-2)] text-[var(--color-muted)] border-[var(--color-border)] font-medium hover:bg-[var(--color-surface-3)] hover:text-[var(--color-foreground)]'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {preset === 'custom' && (
              <div className="flex gap-2">
                <input type="datetime-local" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="ehi-input" />
                <input type="datetime-local" value={customTo}   onChange={e => setCustomTo(e.target.value)} className="ehi-input" />
              </div>
            )}
          </div>

          {/* Report content area */}
          <div className="ehi-card p-4">
            <div className="text-[14px] font-bold text-[var(--color-foreground)] mb-3">
              {REPORT_TYPES.find(r => r.id === selectedReport)?.label}
            </div>

            {isLoadingTx ? (
              <div className="flex justify-center py-12">
                <Loader2 size={24} className="animate-spin text-[var(--color-accent-amber)]" />
              </div>
            ) : (
              <>
                {selectedReport === 'revenue' && <RevenueReportView data={revenueReport} />}
                {selectedReport === 'airline_sales' && (
                  <div className="space-y-4">
                    <div className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded overflow-hidden">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-[var(--color-surface-2)] font-mono text-[10px] text-[var(--color-muted)] uppercase">
                          <tr>
                            <th className="p-3">Airline / Carrier</th>
                            <th className="p-3 text-right">Cargo Sales (₦)</th>
                            <th className="p-3 text-right">Cargo KG</th>
                            <th className="p-3 text-right">Baggage Sales (₦)</th>
                            <th className="p-3 text-right">Baggage KG</th>
                            <th className="p-3 text-right">Total Sales (₦)</th>
                            <th className="p-3 text-right">Total Weight (KG)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--color-border)] font-mono text-[12px]">
                          {airlineReport.map((a, i) => (
                            <tr key={i} className="hover:bg-[var(--color-surface-2)]">
                              <td className="p-3 font-bold text-[var(--color-foreground)]">{a.airline}</td>
                              <td className="p-3 text-right text-[var(--color-light-muted)]">₦{fmt(a.cargoSales)}</td>
                              <td className="p-3 text-right text-[var(--color-light-muted)]">{fmt(a.cargoKg)} kg</td>
                              <td className="p-3 text-right text-[var(--color-light-muted)]">₦{fmt(a.baggageSales)}</td>
                              <td className="p-3 text-right text-[var(--color-light-muted)]">{fmt(a.baggageKg)} kg</td>
                              <td className="p-3 text-right font-bold text-[var(--color-success)]">₦{fmt(a.totalSales)}</td>
                              <td className="p-3 text-right font-bold text-[var(--color-accent-amber)]">{fmt(a.totalKg)} kg</td>
                            </tr>
                          ))}
                          {airlineReport.length === 0 && (
                            <tr><td colSpan={7} className="p-6 text-center text-[var(--color-muted)]">No airline transactions found for this period.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                {selectedReport === 'routes'    && <RouteReportView data={routeReport} />}
                {selectedReport === 'customers' && <CustomerReportView data={customerReport} />}
                {selectedReport === 'debtors'   && <DebtorReportView data={debtorReport} />}
                {selectedReport === 'staff'     && <StaffReportView data={staffReport} collective={staffCollective} />}
                {selectedReport === 'sales_cargo'     && <DepartmentSalesAnalysisView data={cargoSalesAnalysis} deptLabel="Cargo" routeLabel="Route" />}
                {selectedReport === 'sales_marketing' && <DepartmentSalesAnalysisView data={marketingSalesAnalysis} deptLabel="Marketing" routeLabel="Route" />}
                {selectedReport === 'sales_baggage'   && <DepartmentSalesAnalysisView data={baggageSalesAnalysis} deptLabel="Baggage" routeLabel="Destination" />}
                {selectedReport === 'sales_package'   && <DepartmentSalesAnalysisView data={packageSalesAnalysis} deptLabel="Package" routeLabel="Destination" />}
                {selectedReport === 'hubs'      && (
                  <div className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded overflow-hidden">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-[var(--color-surface-2)] font-mono text-[10px] text-[var(--color-muted)]">
                        <tr><th className="p-3">Hub Code/Name</th><th className="p-3 text-right">Entries</th><th className="p-3 text-right">Revenue</th></tr>
                      </thead>
                      <tbody>
                        {hubReport.map((h, i) => (
                          <tr key={i} className="border-t border-[var(--color-border)]">
                            <td className="p-3">{h.hub_name}</td>
                            <td className="p-3 text-right font-mono text-[var(--color-muted)]">{h.entries}</td>
                            <td className="p-3 text-right font-mono font-bold text-[var(--color-accent-cobalt)]">₦{h.revenue.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {selectedReport === 'b2b_sales' && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded p-4">
                        <p className="text-[10px] font-mono text-[var(--color-muted)] mb-1">TOTAL B2B REVENUE</p>
                        <p className="text-xl font-bold font-mono text-[var(--color-accent-amber)]">₦{b2bReport.totalRevenue.toLocaleString()}</p>
                      </div>
                      <div className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded p-4">
                        <p className="text-[10px] font-mono text-[var(--color-muted)] mb-1">TOTAL B2B ENTRIES</p>
                        <p className="text-xl font-bold font-mono text-[var(--color-foreground)]">{b2bReport.totalEntries}</p>
                      </div>
                    </div>

                    <div className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded overflow-hidden">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-[var(--color-surface-2)] font-mono text-[10px] text-[var(--color-muted)]">
                          <tr><th className="p-3">Client</th><th className="p-3 text-center">Routes</th><th className="p-3 text-center">Entries</th><th className="p-3 text-right">Revenue</th></tr>
                        </thead>
                        <tbody>
                          {b2bReport.items.map((b, i) => (
                            <tr key={i} className="border-t border-[var(--color-border)]">
                              <td className="p-3 font-medium">{b.name}</td>
                              <td className="p-3 text-center font-mono text-[var(--color-muted)]">{b.routes}</td>
                              <td className="p-3 text-center font-mono text-[var(--color-muted)]">{b.entries}</td>
                              <td className="p-3 text-right font-mono font-bold text-[var(--color-accent-amber)]">₦{b.revenue.toLocaleString()}</td>
                            </tr>
                          ))}
                          {b2bReport.items.length === 0 && (
                            <tr><td colSpan={4} className="p-6 text-center text-[var(--color-muted)] text-sm">No Office Work transactions found for this period.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Export buttons */}
          <div className="flex gap-2">
            <button 
              onClick={handleDownloadExcel}
              className="flex-1 p-3 bg-transparent border border-[var(--color-success)] text-[var(--color-success)] rounded-[var(--radius-md)] font-bold text-[12px] cursor-pointer flex items-center justify-center gap-1.5 hover:bg-[rgba(16,185,129,0.1)] transition-colors"
            >
              <Download size={14} /> EXCEL
            </button>
            <button 
              onClick={exportToPdf} 
              disabled={generating}
              className={`flex-[2] p-3 rounded-[var(--radius-md)] font-extrabold text-[13px] cursor-pointer flex items-center justify-center gap-2 transition-opacity ${generating ? 'opacity-60' : 'opacity-100 hover:opacity-90'}`}
              style={{
                background: 'linear-gradient(135deg, var(--color-accent-amber) 0%, #C87900 100%)',
                color: '#0D1117', border: 'none',
              }}
            >
              {generating ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
              {generating ? 'GENERATING...' : 'DOWNLOAD PDF'}
            </button>
          </div>
        </div>
      )}
      </div>
    </div>
  );
};

// ── Report View Components ────────────────────────────

const RevenueReportView = ({ data }: { data: any }) => (
  <div className="space-y-4">
    <div>
      <div className="text-[10px] text-[var(--color-muted)] mb-1.5 uppercase font-bold tracking-wider">By Stream</div>
      {data.streams.map((s: any) => (
        <div key={s.name} className="flex justify-between py-2 border-b border-[var(--color-border)]">
          <span className="text-[12px] text-[var(--color-foreground)] font-medium">{s.name}</span>
          <div className="text-right">
            <div className="text-[13px] font-mono font-bold text-[var(--color-foreground)]">₦{fmt(s.amount)}</div>
            <div className="text-[10px] text-[var(--color-muted)]">{s.count} entries</div>
          </div>
        </div>
      ))}
    </div>
    <div>
      <div className="text-[10px] text-[var(--color-muted)] mb-1.5 uppercase font-bold tracking-wider">By Payment Mode</div>
      {data.modes.map((m: any) => (
        <div key={m.name} className="flex justify-between py-1.5 border-b border-[var(--color-border)] border-dashed last:border-0">
          <span className="text-[12px] text-[var(--color-foreground)]">{m.name}</span>
          <span className="text-[12px] font-mono font-bold text-[var(--color-foreground)]">₦{fmt(m.amount)}</span>
        </div>
      ))}
    </div>
    <div className="pt-3 border-t border-[var(--color-accent-amber)] flex justify-between items-center">
      <span className="text-[12px] font-bold text-[var(--color-accent-amber)] tracking-wider">TOTAL</span>
      <span className="text-[16px] font-mono font-bold text-[var(--color-accent-amber)]">₦{fmt(data.total)}</span>
    </div>
  </div>
);

const RouteReportView = ({ data }: { data: any[] }) => (
  <div className="space-y-1">
    {data.map((r, i) => (
      <div key={r.route} className="flex items-center gap-3 py-2.5 border-b border-[var(--color-border)] last:border-0">
        <span className="text-[10px] text-[var(--color-muted)] min-w-[20px] font-mono">#{i + 1}</span>
        <div className="flex-1">
          <div className="text-[13px] font-bold text-[var(--color-foreground)]">{r.route}</div>
          <div className="text-[10px] text-[var(--color-muted)]">
            Cargo: ₦{fmt(r.cargo)} · Mktg: ₦{fmt(r.mktg)} · {r.count} entries
          </div>
        </div>
        <span className="text-[13px] font-mono font-bold text-[var(--color-accent-amber)]">₦{fmt(r.revenue)}</span>
      </div>
    ))}
  </div>
);

const CustomerReportView = ({ data }: { data: any[] }) => (
  <div className="space-y-1">
    {data.map((c, i) => (
      <div key={c.name} className="flex items-center gap-3 py-2.5 border-b border-[var(--color-border)] last:border-0">
        <span className="text-[10px] text-[var(--color-muted)] min-w-[20px] font-mono">#{i + 1}</span>
        <div className="flex-1">
          <div className="text-[13px] font-bold text-[var(--color-foreground)]">{c.name}</div>
          <div className="text-[10px] text-[var(--color-muted)]">{c.transactions} transactions · Last: {c.lastSeen}</div>
        </div>
        <span className="text-[13px] font-mono font-bold text-[var(--color-accent-amber)]">₦{fmt(c.revenue)}</span>
      </div>
    ))}
  </div>
);

const DebtorReportView = ({ data }: { data: any }) => (
  <div className="space-y-4">
    <div className="grid grid-cols-[repeat(auto-fit,minmax(100px,1fr))] gap-2">
      {Object.entries(data.buckets).map(([bucket, amount]) => (
        <div key={bucket} className="min-w-0 p-2.5 bg-[var(--color-surface-2)] rounded-[var(--radius-sm)] text-center border border-[var(--color-border)]">
          <div className="text-[9px] text-[var(--color-muted)] uppercase tracking-wider font-bold mb-1 truncate">{bucket}</div>
          <div className={`text-[13px] font-mono font-bold ${bucket === 'Write-off risk' ? 'text-[var(--color-error)]' : 'text-[var(--color-foreground)]'}`}>
            ₦{fmt(amount as number)}
          </div>
        </div>
      ))}
    </div>
    <div className="space-y-1">
      {data.items.slice(0, 15).map((d: any, i: number) => (
        <div key={i} className="flex justify-between py-2 border-b border-[var(--color-border)] last:border-0">
          <div>
            <div className="text-[12px] font-bold text-[var(--color-foreground)]">{d.name}</div>
            <div className="text-[10px] text-[var(--color-muted)]">Bucket: {d.bucket} · {d.age} days old</div>
          </div>
          <span className="text-[13px] font-mono font-bold text-[var(--color-error)]">₦{fmt(d.amount)}</span>
        </div>
      ))}
    </div>
    <div className="pt-3 border-t border-[var(--color-error)] flex justify-between items-center">
      <span className="text-[12px] font-bold text-[var(--color-error)] tracking-wider">TOTAL OUTSTANDING</span>
      <span className="text-[16px] font-mono font-bold text-[var(--color-error)]">₦{fmt(data.total)}</span>
    </div>
  </div>
);

// Layer 1 (collective, all agents rolled up) then Layer 2 (per-agent
// detail) -- the big picture before the drill-down, matching how this
// report actually gets read: whoever's reviewing it wants the total
// picture first, then to check individual agents against it.
const StaffReportView = ({ data, collective }: { data: any[]; collective: { entries: number; revenue: number; collected: number; owed: number } }) => (
  <div className="space-y-5">
    {/* Layer 1 — Collective */}
    <div className="rounded-[var(--radius-md)] border border-[var(--color-accent-amber)] bg-[rgba(245,158,11,0.06)] p-3">
      <div className="text-[10px] text-[var(--color-accent-amber)] mb-2.5 uppercase font-bold tracking-wider">All Agents Combined</div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-[9px] text-[var(--color-muted)] uppercase tracking-wider">Total Sales</div>
          <div className="text-[15px] font-mono font-bold text-[var(--color-foreground)]">₦{fmt(collective.revenue)}</div>
        </div>
        <div>
          <div className="text-[9px] text-[var(--color-muted)] uppercase tracking-wider">Total Collected</div>
          <div className="text-[15px] font-mono font-bold text-[var(--color-success)]">₦{fmt(collective.collected)}</div>
        </div>
        <div>
          <div className="text-[9px] text-[var(--color-muted)] uppercase tracking-wider">Total Owed</div>
          <div className="text-[15px] font-mono font-bold text-[var(--color-error)]">₦{fmt(collective.owed)}</div>
        </div>
        <div>
          <div className="text-[9px] text-[var(--color-muted)] uppercase tracking-wider">Total Entries</div>
          <div className="text-[15px] font-mono font-bold text-[var(--color-foreground)]">{collective.entries}</div>
        </div>
      </div>
    </div>

    {/* Layer 2 — Per-agent detail, owed first per row (the thing management
        cares about most), then name, then the breakdown. */}
    <div className="space-y-2.5">
      {data.map(s => (
        <div key={s.role} className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
          <div className="flex justify-between items-start mb-2">
            <div>
              <div className="text-[9px] text-[var(--color-muted)] uppercase tracking-wider mb-0.5">Owed</div>
              <div className={`text-[16px] font-mono font-bold ${s.owed > 0 ? 'text-[var(--color-error)]' : 'text-[var(--color-muted)]'}`}>₦{fmt(s.owed)}</div>
            </div>
            <div className="text-right">
              <div className="text-[13px] font-bold text-[var(--color-foreground)]">{s.role}</div>
              <div className="text-[10px] text-[var(--color-muted)]">{s.entries} entries</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 pt-2 border-t border-[var(--color-border)] border-dashed">
            <div className="flex justify-between">
              <span className="text-[10px] text-[var(--color-muted)]">Total Sales</span>
              <span className="text-[11px] font-mono font-bold text-[var(--color-foreground)]">₦{fmt(s.revenue)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[10px] text-[var(--color-muted)]">Collected</span>
              <span className="text-[11px] font-mono font-bold text-[var(--color-success)]">₦{fmt(s.collected)}</span>
            </div>
            {s.cargo > 0 && (
              <div className="flex justify-between">
                <span className="text-[10px] text-[var(--color-muted)]">Cargo</span>
                <span className="text-[11px] font-mono text-[var(--color-foreground)]">₦{fmt(s.cargo)}</span>
              </div>
            )}
            {s.mktg > 0 && (
              <div className="flex justify-between">
                <span className="text-[10px] text-[var(--color-muted)]">Marketing</span>
                <span className="text-[11px] font-mono text-[var(--color-foreground)]">₦{fmt(s.mktg)}</span>
              </div>
            )}
            {s.vj > 0 && (
              <div className="flex justify-between">
                <span className="text-[10px] text-[var(--color-muted)]">Baggage</span>
                <span className="text-[11px] font-mono text-[var(--color-foreground)]">₦{fmt(s.vj)}</span>
              </div>
            )}
            {s.pkg > 0 && (
              <div className="flex justify-between">
                <span className="text-[10px] text-[var(--color-muted)]">Package</span>
                <span className="text-[11px] font-mono text-[var(--color-foreground)]">₦{fmt(s.pkg)}</span>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  </div>
);

const HubReportView = ({ data }: { data: any[] }) => (
  <div className="space-y-1">
    {data.map(h => (
      <div key={h.hub} className="flex justify-between py-2.5 border-b border-[var(--color-border)] last:border-0">
        <div>
          <div className="text-[13px] font-bold text-[var(--color-foreground)]">{h.hub}</div>
          <div className="text-[10px] text-[var(--color-muted)]">{h.entries} entries</div>
        </div>
        <span className="text-[13px] font-mono font-bold text-[var(--color-accent-amber)]">₦{fmt(h.revenue)}</span>
      </div>
    ))}
  </div>
);
