import React, { useState, useEffect, useMemo } from 'react';
import { Transaction, User } from '../../lib/types';
import { fmt, sanitizeSpreadsheetAoA } from '../../lib/helpers';
import { supabase, fetchAllRows } from '../../lib/supabase';
import { Search, FileDown, Briefcase, Scale, DollarSign, AlertCircle } from 'lucide-react';
import { useToast } from '../../lib/ToastContext';

interface B2BSalesTabProps {
  transactions: Transaction[];
  user: User;
}

export const B2BSalesTab = ({ transactions, user }: B2BSalesTabProps) => {
  const { showToast } = useToast();
  const [query, setQuery] = useState('');
  const [selectedClientId, setSelectedClientId] = useState<string>('All');
  const [corporateClients, setCorporateClients] = useState<{ id: string; company_name: string }[]>([]);

  useEffect(() => {
    supabase.from('corporate_clients').select('id, company_name').order('company_name').then(({ data, error }) => {
      if (data && !error) {
        setCorporateClients(data);
      }
    });
  }, []);

  const clientNameMap = useMemo(() => {
    const map = new Map<string, string>();
    corporateClients.forEach(c => map.set(c.id, c.company_name));
    return map;
  }, [corporateClients]);

  // This tab previously only ever saw `transactions`, which EHIApp.tsx
  // windows to globalDateRange (a trailing few days) -- a corporate client
  // billed on account weeks or months ago simply wasn't fetched at all, no
  // matter what date filter this screen showed (it has none of its own).
  // Dedicated, date-unbounded fetch instead, same pattern DebtorsTab.tsx
  // already uses for the identical "debts can't be date-windowed" problem:
  // fetchAllRows paginates past any single-page cap, and the query is
  // server-side filtered to corporate-linked cargo entries so it never
  // has to pull the whole (much larger) walk-in ledger to find them.
  const [fetchedB2BRows, setFetchedB2BRows] = useState<Transaction[]>([]);
  const [loadingB2B, setLoadingB2B] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        // All 4 departments, not just cargo -- package/baggage/marketing
        // corporate business was previously invisible here even though it
        // carries the same client_type/corporate_client_id linkage (added
        // in 20260926_office_work_all_departments.sql) and is scanned
        // correctly by OfficeWorkReconciliation.tsx's equivalent fetch.
        const [cargoRows, packageRows, baggageRows, marketingRows] = await Promise.all([
          fetchAllRows<any>((from, to) =>
            supabase.from('cargo_entries')
              .select('entry_ref, consignee_name, route, airline, awb_tag_number, total_pcs, total_kg, amount, amount_paid, retrieved_amount, receipt_mode, payment_history, status, created_at, client_type, corporate_client_id')
              .or('corporate_client_id.not.is.null,client_type.eq.Corporate')
              .order('created_at', { ascending: false }).range(from, to)),
          fetchAllRows<any>((from, to) =>
            supabase.from('package_entries')
              .select('entry_ref, customer_name, destination, total_pcs, total_kg, amount, amount_paid, retrieved_amount, payment_mode, payment_history, status, created_at, client_type, corporate_client_id')
              .or('corporate_client_id.not.is.null,client_type.eq.Corporate')
              .order('created_at', { ascending: false }).range(from, to)),
          fetchAllRows<any>((from, to) =>
            supabase.from('manifests')
              .select('transaction_id, passenger_name, destination, airline, total_pcs, excess_kg, amount, amount_paid, retrieved_amount, payment_mode, payment_history, created_at, client_type, corporate_client_id')
              .or('corporate_client_id.not.is.null,client_type.eq.Corporate')
              .order('created_at', { ascending: false }).range(from, to)),
          fetchAllRows<any>((from, to) =>
            supabase.from('marketing_entries')
              .select('entry_ref, customer_name, route, qty_big_bag, qty_med_bag, qty_small_bag, bb_kg, mb_kg, sb_kg, amount_paid, debt_amount_paid, retrieved_amount, payment_mode, payment_history, created_at, client_type, corporate_client_id')
              .or('corporate_client_id.not.is.null,client_type.eq.Corporate')
              .order('created_at', { ascending: false }).range(from, to)),
        ]);
        if (!active) return;
        const merged: Transaction[] = [
          ...cargoRows.map((r: any): Transaction => ({
            id: r.entry_ref, name: r.consignee_name || 'Customer', detail: `${r.airline || ''}`,
            amount: Number(r.amount) || 0, amountPaid: Number(r.amount_paid) || 0,
            paymentHistory: r.payment_history || [], mode: r.receipt_mode || 'Cash',
            pieces: r.total_pcs ?? undefined, kg: r.total_kg ?? undefined,
            time: r.created_at, created_at: r.created_at, type: 'cargo', status: r.status || 'Intake',
            airline: r.airline, route: r.route, awb_tag_number: r.awb_tag_number,
            clientType: r.client_type, corporate_client_id: r.corporate_client_id, raw: r,
          } as Transaction)),
          ...packageRows.map((r: any): Transaction => ({
            id: r.entry_ref, name: r.customer_name || 'Customer', detail: '',
            amount: Number(r.amount) || 0, amountPaid: Number(r.amount_paid) || 0,
            paymentHistory: r.payment_history || [], mode: r.payment_mode || 'Cash',
            pieces: r.total_pcs ?? undefined, kg: r.total_kg ?? undefined,
            time: r.created_at, created_at: r.created_at, type: 'package', status: r.status || 'Intake',
            route: r.destination, clientType: r.client_type, corporate_client_id: r.corporate_client_id, raw: r,
          } as Transaction)),
          ...baggageRows.map((r: any): Transaction => ({
            id: r.transaction_id, name: r.passenger_name || 'Customer', detail: '',
            amount: Number(r.amount) || 0, amountPaid: Number(r.amount_paid) || 0,
            paymentHistory: r.payment_history || [], mode: r.payment_mode || 'Cash',
            // excess_kg, not total_kg -- billable weight for baggage is only
            // the portion over the airline's free allowance.
            pieces: r.total_pcs ?? undefined, kg: r.excess_kg ?? undefined,
            time: r.created_at, created_at: r.created_at, type: 'baggage', status: 'Delivered',
            airline: r.airline, route: r.destination,
            clientType: r.client_type, corporate_client_id: r.corporate_client_id, raw: r,
          } as Transaction)),
          ...marketingRows.map((r: any): Transaction => ({
            id: r.entry_ref, name: r.customer_name || 'Customer', detail: '',
            // amount_paid holds the SALE TOTAL for marketing (inverted
            // convention -- see debt.ts's own comment); debt_amount_paid is
            // what's actually been paid down.
            amount: Number(r.amount_paid) || 0, amountPaid: Number(r.debt_amount_paid) || 0,
            paymentHistory: r.payment_history || [], mode: r.payment_mode || 'Cash',
            pieces: (r.qty_big_bag || 0) + (r.qty_med_bag || 0) + (r.qty_small_bag || 0),
            kg: (r.bb_kg || 0) + (r.mb_kg || 0) + (r.sb_kg || 0),
            time: r.created_at, created_at: r.created_at, type: 'marketing', status: 'Intake',
            route: r.route, clientType: r.client_type, corporate_client_id: r.corporate_client_id, raw: r,
          } as Transaction)),
        ];
        setFetchedB2BRows(merged);
      } catch (err: any) {
        showToast({ message: `Failed to load B2B sales: ${err.message || err}`, type: 'error' });
      } finally {
        if (active) setLoadingB2B(false);
      }
    })();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Merge with the live `transactions` prop, same as DebtorsTab.tsx does for
  // its own dedicated fetch -- prop wins on id collision, so a corporate
  // entry created/edited THIS session shows immediately rather than waiting
  // for the next fetch.
  const b2bTx = useMemo(() => {
    // Keyed by type+id, not id alone -- entry_ref/transaction_id is only
    // unique WITHIN one department table, and now that all 4 are merged,
    // two different departments' ref generators could in principle collide.
    const byKey = new Map<string, Transaction>();
    const key = (t: Transaction) => `${t.type}:${t.id}`;
    fetchedB2BRows.forEach(t => byKey.set(key(t), t));
    transactions.forEach(t => {
      if (['cargo', 'package', 'baggage', 'marketing'].includes(t.type) && (t.clientType === 'Corporate' || !!t.corporate_client_id)) byKey.set(key(t), t);
    });
    return Array.from(byKey.values());
  }, [fetchedB2BRows, transactions]);

  // Filter based on search query and selected corporate client
  const filteredB2BTx = useMemo(() => {
    return b2bTx.filter(t => {
      const cName = t.corporate_client_id ? (clientNameMap.get(t.corporate_client_id) || '') : (t.name || '');
      const matchesSearch = 
        (t.awb_tag_number || '').toLowerCase().includes(query.toLowerCase()) ||
        cName.toLowerCase().includes(query.toLowerCase()) ||
        (t.route || '').toLowerCase().includes(query.toLowerCase()) ||
        (t.airline || '').toLowerCase().includes(query.toLowerCase());

      const matchesClient = selectedClientId === 'All' || t.corporate_client_id === selectedClientId;

      return matchesSearch && matchesClient;
    });
  }, [b2bTx, query, selectedClientId, clientNameMap]);

  // Computed summary metrics
  const metrics = useMemo(() => {
    let totalKg = 0;
    let totalRevenue = 0;
    let totalPaid = 0;

    filteredB2BTx.forEach(t => {
      // Calculate parsed weight
      const weight = t.kg || 0;
      totalKg += weight;

      // Revenue billed
      totalRevenue += t.amount || 0;

      // Paid portion -- Debt-mode also nets off retrieved_amount, matching
      // DebtorsTab.tsx/OfficeWorkReconciliation.tsx's identical "remaining
      // owed" formula; without it, a Debt entry partly settled via a
      // retrieval (rather than a direct payment) overstated what's still
      // outstanding here even though those two other screens report it
      // correctly for the same row.
      if (t.mode === 'Debt') {
        totalPaid += (t.amountPaid || 0) + ((t.raw as any)?.retrieved_amount || 0);
      } else {
        totalPaid += t.amount || 0; // Cash/POS/Transfer are 100% paid
      }
    });

    const totalOutstanding = Math.max(0, totalRevenue - totalPaid);

    return {
      count: filteredB2BTx.length,
      totalKg,
      totalRevenue,
      totalPaid,
      totalOutstanding,
      avgRatePerKg: totalKg > 0 ? totalRevenue / totalKg : 0
    };
  }, [filteredB2BTx]);

  const handleExportExcel = async () => {
    if (filteredB2BTx.length === 0) {
      showToast({ message: 'No B2B sales data available to download.', type: 'warning' });
      return;
    }

    const [XLSX, { autoFitWorksheetColumns }] = await Promise.all([
      import('xlsx'),
      import('../../lib/excelExport'),
    ]);

    const headers = ['Ref ID', 'Date', 'Client Name', 'AWB/Tag', 'Airline', 'Route', 'Pieces', 'Weight (KG)', 'Billed Amount', 'Amount Paid', 'Outstanding', 'Payment Mode', 'Status', 'Agent'];
    const rows = filteredB2BTx.map(t => {
      const cName = t.corporate_client_id ? (clientNameMap.get(t.corporate_client_id) || t.name) : t.name;
      const outstanding = Math.max(0, t.amount - (t.mode === 'Debt' ? (t.amountPaid || 0) + ((t.raw as any)?.retrieved_amount || 0) : t.amount));
      const paid = t.mode === 'Debt' ? (t.amountPaid || 0) : t.amount;
      return [
        t.id,
        t.created_at ? new Date(t.created_at).toLocaleDateString('en-GB') : (t.time || ''),
        cName || '',
        t.awb_tag_number || '',
        t.airline || '',
        t.route || '',
        t.pieces || 0,
        t.kg || 0,
        t.amount || 0,
        paid,
        outstanding,
        t.mode || '',
        t.status || '',
        t.enteredByName || ''
      ];
    });

    // sanitizeSpreadsheetAoA guards free-text cells (client name, in
    // particular) against being opened as a live formula in Excel/Sheets,
    // same as every other export screen (Reports.tsx/AirlinePerformance.tsx/
    // Analytics.tsx/ExpensesTab.tsx) already does.
    const ws = XLSX.utils.aoa_to_sheet(sanitizeSpreadsheetAoA([headers, ...rows]));
    autoFitWorksheetColumns(ws);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'B2B Sales');
    XLSX.writeFile(wb, `EHI_B2B_Sales_Ledger_${new Date().toISOString().slice(0, 10)}.xlsx`);
    showToast({ message: 'Excel export downloaded successfully.', type: 'success' });
  };

  return (
    <div className="space-y-4">
      {/* METRICS DASHBOARD GRID */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-[var(--color-surface-2)] p-4 rounded-xl border border-[var(--color-border)] flex items-center space-x-3">
          <div className="p-2.5 rounded-lg bg-[rgba(251,191,36,0.1)] text-[var(--color-accent-amber)]">
            <Briefcase size={20} />
          </div>
          <div>
            <div className="text-[10px] text-[var(--color-muted)] font-sans uppercase font-medium">B2B Shipments</div>
            <div className="text-[18px] font-sans font-bold text-[var(--color-foreground)]">{metrics.count}</div>
          </div>
        </div>

        <div className="bg-[var(--color-surface-2)] p-4 rounded-xl border border-[var(--color-border)] flex items-center space-x-3">
          <div className="p-2.5 rounded-lg bg-[rgba(59,130,246,0.1)] text-[#3b82f6]">
            <Scale size={20} />
          </div>
          <div>
            <div className="text-[10px] text-[var(--color-muted)] font-sans uppercase font-medium">Total Tonnage</div>
            <div className="text-[18px] font-sans font-bold text-[var(--color-foreground)]">{metrics.totalKg.toLocaleString()} KG</div>
          </div>
        </div>

        <div className="bg-[var(--color-surface-2)] p-4 rounded-xl border border-[var(--color-border)] flex items-center space-x-3">
          <div className="p-2.5 rounded-lg bg-[rgba(16,185,129,0.1)] text-[var(--color-success)]">
            <DollarSign size={20} />
          </div>
          <div>
            <div className="text-[10px] text-[var(--color-muted)] font-sans uppercase font-medium">Billed Revenue</div>
            <div className="text-[18px] font-sans font-bold text-[var(--color-foreground)]">₦{metrics.totalRevenue.toLocaleString()}</div>
          </div>
        </div>

        <div className="bg-[var(--color-surface-2)] p-4 rounded-xl border border-[var(--color-border)] flex items-center space-x-3">
          <div className="p-2.5 rounded-lg bg-[rgba(239,68,68,0.1)] text-[var(--color-error)]">
            <AlertCircle size={20} />
          </div>
          <div>
            <div className="text-[10px] text-[var(--color-muted)] font-sans uppercase font-medium">Outstanding Balance</div>
            <div className="text-[18px] font-sans font-bold text-[var(--color-foreground)]">₦{metrics.totalOutstanding.toLocaleString()}</div>
          </div>
        </div>
      </div>

      {/* FILTER CONTROLS BAR */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-[var(--color-bg)] p-3 rounded-lg border border-[var(--color-border)]">
        <div className="flex-1 flex flex-col md:flex-row gap-2.5">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)]" />
            <input
              type="text"
              placeholder="Search by AWB, client, route, airline..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-lg pl-9 pr-3 py-2 text-[12px] text-[var(--color-foreground)] placeholder-[var(--color-muted)] focus:outline-none focus:border-[var(--color-accent-amber)] focus:ring-1 focus:ring-[var(--color-accent-amber)] transition-all"
            />
          </div>

          <div className="w-full md:w-[200px]">
            <select
              value={selectedClientId}
              onChange={(e) => setSelectedClientId(e.target.value)}
              className="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-[12px] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)] transition-colors"
            >
              <option value="All">All Corporate Clients</option>
              {corporateClients.map(c => (
                <option key={c.id} value={c.id}>{c.company_name}</option>
              ))}
            </select>
          </div>
        </div>

        <button
          onClick={handleExportExcel}
          className="bg-[var(--color-accent-amber)] hover:bg-amber-600 text-black px-4 py-2 rounded-lg text-[12px] font-bold font-sans flex items-center justify-center space-x-1.5 transition-colors shrink-0"
        >
          <FileDown size={14} />
          <span>Export Ledger</span>
        </button>
      </div>

      {/* SALES LIST TABLE */}
      <div className="bg-[var(--color-surface-2)] rounded-xl border border-[var(--color-border)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[var(--color-bg)] border-b border-[var(--color-border)]">
                <th className="p-3 text-[10px] uppercase font-semibold text-[var(--color-muted)] tracking-wider">AWB / Tag</th>
                <th className="p-3 text-[10px] uppercase font-semibold text-[var(--color-muted)] tracking-wider">Date</th>
                <th className="p-3 text-[10px] uppercase font-semibold text-[var(--color-muted)] tracking-wider">Client Name</th>
                <th className="p-3 text-[10px] uppercase font-semibold text-[var(--color-muted)] tracking-wider">Route/Airline</th>
                <th className="p-3 text-[10px] uppercase font-semibold text-[var(--color-muted)] tracking-wider text-right">Qty</th>
                <th className="p-3 text-[10px] uppercase font-semibold text-[var(--color-muted)] tracking-wider text-right">KG</th>
                <th className="p-3 text-[10px] uppercase font-semibold text-[var(--color-muted)] tracking-wider text-right">Billed Amount</th>
                <th className="p-3 text-[10px] uppercase font-semibold text-[var(--color-muted)] tracking-wider text-right">Outstanding</th>
                <th className="p-3 text-[10px] uppercase font-semibold text-[var(--color-muted)] tracking-wider text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)] text-[12px] font-sans">
              {filteredB2BTx.map(t => {
                const cName = t.corporate_client_id ? (clientNameMap.get(t.corporate_client_id) || t.name) : t.name;
                const outstanding = Math.max(0, t.amount - (t.mode === 'Debt' ? (t.amountPaid || 0) + ((t.raw as any)?.retrieved_amount || 0) : t.amount));
                
                return (
                  <tr key={t.id} className="hover:bg-[rgba(255,255,255,0.01)] transition-colors">
                    <td className="p-3 font-mono text-[11px] font-bold text-[var(--color-foreground)]">{t.awb_tag_number || 'No Tag'}</td>
                    <td className="p-3 text-[var(--color-muted)] font-mono text-[11px]">
                      {t.created_at ? new Date(t.created_at).toLocaleDateString('en-GB') : (t.time || '-')}
                    </td>
                    <td className="p-3 font-medium text-[var(--color-foreground)]">{cName}</td>
                    <td className="p-3 text-[var(--color-light-muted)]">
                      <div className="font-medium">{t.route || '-'}</div>
                      <div className="text-[9px] font-mono text-[var(--color-muted)]">{t.airline || '-'}</div>
                    </td>
                    <td className="p-3 text-right font-mono font-medium text-[var(--color-light-muted)]">{t.pieces || 0}</td>
                    <td className="p-3 text-right font-mono font-medium text-[var(--color-foreground)]">{t.kg || 0} KG</td>
                    <td className="p-3 text-right font-mono font-bold text-[var(--color-accent-amber)]">₦{t.amount?.toLocaleString()}</td>
                    <td className="p-3 text-right font-mono">
                      {outstanding > 0 ? (
                        <span className="text-[var(--color-error)] font-bold">₦{outstanding.toLocaleString()}</span>
                      ) : (
                        <span className="text-[var(--color-success)] font-medium">₦0</span>
                      )}
                    </td>
                    <td className="p-3 text-center">
                      <span className={`inline-block text-[9px] font-mono px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                        outstanding === 0
                          ? 'bg-[rgba(16,185,129,0.1)] text-[var(--color-success)] border border-[var(--color-success)]'
                          : 'bg-[rgba(239,68,68,0.1)] text-[var(--color-error)] border border-[var(--color-error)]'
                      }`}>
                        {outstanding === 0 ? 'Paid' : 'On Credit'}
                      </span>
                    </td>
                  </tr>
                );
              })}

              {loadingB2B && filteredB2BTx.length === 0 && (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-[12px] text-[var(--color-muted)] italic">
                    Loading full corporate sales history…
                  </td>
                </tr>
              )}

              {!loadingB2B && filteredB2BTx.length === 0 && (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-[12px] text-[var(--color-muted)] italic">
                    No B2B sales entries match the criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
