import { supabase } from './supabase';
import { Transaction, User } from './types';

export type DepartmentType = 'cargo' | 'baggage' | 'marketing' | 'package';

export interface DepartmentAgentRow {
  role: string;
  entries: number;
  revenue: number;
  collected: number;
  owed: number;
  cash: number;
  transfer: number;
  pos: number;
  wallet: number;
  topRoute: string | null;
  topRouteCount: number;
}

export interface DepartmentSalesAnalysis {
  agents: DepartmentAgentRow[];
  collective: { agentCount: number; entries: number; revenue: number; collected: number; owed: number; cash: number; transfer: number; pos: number; wallet: number };
}

// Same "real revenue"/owed formulas Reports.tsx's staffReport uses (collected
// excludes unpaid Debt and the 'Debt Paid' entries already counted once via
// their own DC- shadow collection entry; owed nets amountPaid and any
// retrieval credit off the original amount), scoped to one department at a
// time and with a top-route/destination added. Shared between the admin
// Reports screen and each department's own self-serve modal so the two
// can never drift apart. cargo/marketing set t.route directly; package
// aliases route to its destination in the fetch mapping below; baggage
// only ever sets destination -- the fallback covers all four without
// branching per type.
export function computeDepartmentSalesAnalysis(txs: Transaction[], deptType: DepartmentType): DepartmentSalesAnalysis {
  const deptTxs = txs.filter(t => t.type === deptType);

  const map: Record<string, {
    entries: number; revenue: number; collected: number; owed: number;
    cash: number; transfer: number; pos: number; wallet: number;
    routeCounts: Record<string, number>;
  }> = {};

  deptTxs.forEach(t => {
    const agent = (t.enteredByName || 'Unknown Agent').trim();
    if (!map[agent]) map[agent] = { entries: 0, revenue: 0, collected: 0, owed: 0, cash: 0, transfer: 0, pos: 0, wallet: 0, routeCounts: {} };
    map[agent].entries += 1;
    map[agent].revenue += t.amount;
    if (t.mode !== 'Debt' && t.mode !== 'Debt Paid') {
      map[agent].collected += t.amount;
    }
    // Per-mode split of the same "collected" figure above -- Debt/Debt Paid
    // are deliberately excluded here too, same reasoning as collected: an
    // unpaid Debt isn't cash/transfer/pos/wallet in hand yet, and a cleared
    // 'Debt Paid' entry's real payment mode lives on its own DC- shadow
    // collection entry instead (which does carry Cash/Transfer/POS and gets
    // counted here when that shadow entry is iterated).
    if (t.mode === 'Cash') map[agent].cash += t.amount;
    else if (t.mode === 'Transfer') map[agent].transfer += t.amount;
    else if (t.mode === 'POS') map[agent].pos += t.amount;
    else if (t.mode === 'Wallet') map[agent].wallet += t.amount;
    if (t.mode === 'Debt') {
      const remaining = t.amount - (t.amountPaid || 0) - ((t.raw as any)?.retrieved_amount || 0);
      map[agent].owed += Math.max(0, remaining);
    }
    const routeKey = (t.route || (t as any).destination || '').toString().trim();
    if (routeKey) map[agent].routeCounts[routeKey] = (map[agent].routeCounts[routeKey] || 0) + 1;
  });

  const agents: DepartmentAgentRow[] = Object.entries(map)
    .map(([role, d]) => {
      const top = Object.entries(d.routeCounts).sort((a, b) => b[1] - a[1])[0];
      return {
        role,
        entries: d.entries,
        revenue: d.revenue,
        collected: d.collected,
        owed: d.owed,
        cash: d.cash,
        transfer: d.transfer,
        pos: d.pos,
        wallet: d.wallet,
        topRoute: top ? top[0] : null,
        topRouteCount: top ? top[1] : 0,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);

  const collective = agents.reduce((acc, a) => ({
    agentCount: acc.agentCount,
    entries: acc.entries + a.entries,
    revenue: acc.revenue + a.revenue,
    collected: acc.collected + a.collected,
    owed: acc.owed + a.owed,
    cash: acc.cash + a.cash,
    transfer: acc.transfer + a.transfer,
    pos: acc.pos + a.pos,
    wallet: acc.wallet + a.wallet,
  }), { agentCount: agents.length, entries: 0, revenue: 0, collected: 0, owed: 0, cash: 0, transfer: 0, pos: 0, wallet: 0 });

  return { agents, collective };
}

// Same preset -> {from, to} math as Reports.tsx's own dateRange useMemo --
// pulled out here so the department self-serve modal computes date ranges
// identically instead of maintaining a second copy that could drift.
export function computeReportDateRange(preset: string, customFrom: string, customTo: string): { from: Date; to: Date } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let from: Date, to: Date;
  switch (preset) {
    case 'today':      from = today;                                                to = now; break;
    case 'yesterday':  from = new Date(today.getTime() - 86400000);                 to = today; break;
    case 'week':       from = new Date(today.getTime() - 7 * 86400000);             to = now; break;
    case 'month':      from = new Date(now.getFullYear(), now.getMonth(), 1);       to = now; break;
    case 'last_month': from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                       to = new Date(now.getFullYear(), now.getMonth(), 0); break;
    case 'quarter':    from = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1); to = now; break;
    case 'ytd':        from = new Date(now.getFullYear(), 0, 1);                    to = now; break;
    case 'custom':     from = customFrom ? new Date(customFrom) : today;
                       to = customTo ? new Date(customTo) : now; break;
    default:           from = today; to = now;
  }
  return { from, to };
}

// Fetches and maps one department's entries for a date range, scoped to the
// caller's hub unless they hold a role with cross-hub visibility -- mirrors
// Reports.tsx's fetchTransactions block for the matching type (same
// columns, same 'Debt Paid' derivation) but for a single department, since
// the self-serve modal only ever needs the one department it's opened from.
export async function fetchDepartmentSalesTransactions(deptType: DepartmentType, user: User, dateRange: { from: Date; to: Date }): Promise<Transaction[]> {
  const fromISO = dateRange.from.toISOString();
  const toISO = dateRange.to.toISOString();

  const isAdmin = ['super_admin', 'admin', 'accountant', 'auditor'].includes(user.role);
  const addHubFilter = (q: any) => (!isAdmin && user.hub_id) ? q.eq('hub_id', user.hub_id) : q;

  const [profilesRes, deptRes] = await Promise.all([
    supabase.from('user_profiles').select('id,name'),
    deptType === 'cargo'
      ? addHubFilter(supabase.from('cargo_entries').select('entry_ref,consignee_name,airline,awb_tag_number,total_pcs,total_kg,route,content_type,amount,receipt_mode,created_at,status,bank,hub_id,corporate_client_id,client_type,entered_by,amount_paid,retrieved_amount').gte('created_at', fromISO).lte('created_at', toISO))
      : deptType === 'baggage'
      ? addHubFilter(supabase.from('manifests').select('transaction_id,passenger_name,flight_no,destination,excess_kg,amount,payment_mode,created_at,bank,hub_id,total_kg,pnr,passenger_phone,entered_by,amount_paid,retrieved_amount').gte('created_at', fromISO).lte('created_at', toISO))
      : deptType === 'marketing'
      ? addHubFilter(supabase.from('marketing_entries').select('entry_ref,customer_name,route,qty_big_bag,qty_med_bag,qty_small_bag,amount_paid,payment_mode,created_at,hub_id,bank,entered_by,debt_amount_paid,retrieved_amount').gte('created_at', fromISO).lte('created_at', toISO))
      : addHubFilter(supabase.from('package_entries').select('entry_ref,customer_name,destination,content_type,total_pcs,total_kg,contents,amount,payment_mode,created_at,hub_id,bank,entered_by,status,amount_paid,debt_paid,retrieved_amount').gte('created_at', fromISO).lte('created_at', toISO)),
  ]);

  const profileLookup: Record<string, string> = {};
  if (profilesRes.data) {
    profilesRes.data.forEach((p: any) => { if (p.id) profileLookup[p.id] = p.name || ''; });
  }

  const allTx: Transaction[] = [];
  const data = deptRes.data;
  if (!data) return allTx;

  if (deptType === 'cargo') {
    data.forEach((r: any) => {
      const enteredByName = r.entered_by ? (profileLookup[r.entered_by] || r.entered_by) : undefined;
      allTx.push({
        id: r.entry_ref,
        name: r.consignee_name || 'Consignee',
        detail: `${r.airline || 'Airline'} · ${r.awb_tag_number || ''} · ${r.total_pcs || 1}pcs · ${r.total_kg || 0}kg · ${r.route || ''} · ${r.content_type || 'Package'}`,
        amount: r.amount || 0,
        // Same 'Debt Paid' derivation as Reports.tsx's fetchTransactions --
        // receipt_mode itself never changes off 'Debt' when a debt is
        // cleared (only amount_paid moves).
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
  } else if (deptType === 'baggage') {
    data.forEach((r: any) => {
      const enteredByName = r.entered_by ? (profileLookup[r.entered_by] || r.entered_by) : undefined;
      allTx.push({
        id: r.transaction_id,
        name: r.passenger_name || 'Passenger',
        detail: `${r.flight_no || ''} · ${r.destination || ''} · ${r.total_pcs || 1}pcs · +${r.excess_kg || 0}kg excess`,
        amount: r.amount || 0,
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
  } else if (deptType === 'marketing') {
    data.forEach((r: any) => {
      const enteredByName = r.entered_by ? (profileLookup[r.entered_by] || r.entered_by) : undefined;
      allTx.push({
        id: r.entry_ref || r.id,
        name: r.customer_name || 'Customer',
        detail: `${r.route || 'Local'} · BB:${r.qty_big_bag||0} MB:${r.qty_med_bag||0} SB:${r.qty_small_bag||0}`,
        amount: r.amount_paid || 0,
        // marketing_entries.amount_paid is the sale total, NOT how much of a
        // debt sale has been paid off -- that's debt_amount_paid (matches
        // Reports.tsx's fetchTransactions, which uses the same two columns
        // the same way).
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
  } else {
    data.forEach((r: any) => {
      const enteredByName = r.entered_by ? (profileLookup[r.entered_by] || r.entered_by) : undefined;
      allTx.push({
        id: r.entry_ref || r.id,
        name: r.customer_name || 'Customer',
        detail: `${r.destination || 'Destination'} · ${r.content_type || 'Package'} · ${r.total_pcs || 1}pcs · ${r.total_kg || 0}kg`,
        amount: r.amount || 0,
        // Same 'Debt Paid' derivation as Reports.tsx's fetchTransactions for
        // package_entries (debt_paid flag OR amount_paid caught up).
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

  return allTx.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
}
