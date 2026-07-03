import { useState, useEffect, lazy, Suspense, useRef, useCallback } from 'react';
import { User, TabView, Transaction, Expense } from '../lib/types';
import { processSyncQueue, writeWithOfflineSupport, cleanupOldQueue } from '../lib/sync';
import { useTheme } from '../lib/useTheme';
import { Header } from './Header';
import { BottomNav } from './BottomNav';
import { SideNav } from './SideNav';
import { Toast, ToastProps } from './Toast';
import { supabase, writeAuditLog } from '../lib/supabase';
import { Loader2 } from 'lucide-react';
import { Dashboard } from './views/Dashboard';
import { CargoForm } from './views/CargoForm';
import { ValueJetForm } from './views/ValueJetForm';
import { Analytics } from './views/Analytics';
import { More } from './views/More';
import { TransactionLedger } from './views/TransactionLedger';
import { MarketingWorkspace } from './views/MarketingWorkspace';
import { Scanner } from './views/Scanner';
import { MyTrips } from './views/MyTrips';
import { ITDashboard } from './views/ITDashboard';
import { CreditDebit } from './views/CreditDebit';
import { ErrorBoundary } from './ErrorBoundary';

export const EHIApp = ({ user, onLogout }: { user: User; onLogout: () => void }) => {
  const getDefaultTab = (role: string): TabView => {
    if (role === 'marketing_agent') return 'Marketing';
    if (role === 'driver') return 'MyTrips';
    return 'Tower';
  };
  const [currentTab, setCurrentTab] = useState<TabView>(getDefaultTab(user.role));
  const [streamLedger, setStreamLedger] = useState<'cargo' | 'baggage' | 'marketing' | null>(null);
  const [globalDateRange, setGlobalDateRange] = useState({
    start: new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0]
  });
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [toast, setToast] = useState<ToastProps | null>(null);
  
  const { theme, toggle } = useTheme();

  const pendingTxRef = useRef<Transaction[]>([]);
  const pendingExpenseRef = useRef<Expense[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transactionsRef = useRef<Transaction[]>([]);

  // Keep a ref mirror of transactions for synchronous dedup checks in realtime handlers
  useEffect(() => { transactionsRef.current = transactions; }, [transactions]);

  const showToast = useCallback((props: Omit<ToastProps, 'onClose'>) => {
    setToast({ ...props, onClose: () => setToast(null) });
  }, []);

  useEffect(() => {
    cleanupOldQueue();
    const handleOnline = async () => {
      setIsOffline(false);
      const count = await processSyncQueue();
      if (count > 0) {
        showToast({ message: `${count} transaction(s) synced to server`, type: 'success' });
        setPendingSyncCount(0);
      }
    };
    const handleOffline = () => setIsOffline(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Dashboard empty state CTA buttons dispatch this event
    const handleEhiNav = (e: Event) => {
      const tab = (e as CustomEvent).detail as TabView;
      if (tab) setCurrentTab(tab);
    };
    window.addEventListener('ehi-nav', handleEhiNav);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('ehi-nav', handleEhiNav);
    };
  }, [showToast]);

  const flushPendingTx = useCallback(() => {
    if (pendingTxRef.current.length === 0) return;
    setTransactions(prev =>
      [...pendingTxRef.current, ...prev].slice(0, 200)
    );
    pendingTxRef.current = [];
  }, []);

  // Fetch Initial Data
  useEffect(() => {
    if (isOffline) return;
    
    const fetchInitial = async () => {
      try {
        const isAdmin = ['super_admin','admin','accountant','auditor'].includes(user.role);
        // Deliberately narrower than isAdmin -- pickup PIN visibility is
        // specifically admin/super_admin/accountant, not auditor.
        const canSeePin = ['admin', 'super_admin', 'accountant'].includes(user.role);

        const addHubFilter = (q: any) =>
          (!isAdmin && user.hub_id) ? q.eq('hub_id', user.hub_id) : q;

        const startDate = new Date(globalDateRange.start);
        startDate.setHours(0,0,0,0);
        const endDate = new Date(globalDateRange.end);
        endDate.setHours(23,59,59,999);
        
        const startISO = startDate.toISOString();
        const endISO = endDate.toISOString();

        const [cargoRes, vjRes, mktRes, expRes] = await Promise.all([
          addHubFilter(supabase.from('cargo_entries').select(`entry_ref,consignee_name,airline,awb_tag_number,total_pcs,total_kg,route,content_type,amount,receipt_mode,created_at,status,bank,hub_id${canSeePin ? ',pickup_pin' : ''}`).gte('created_at', startISO).lte('created_at', endISO).order('created_at', { ascending: false }).limit(500)),
          addHubFilter(supabase.from('manifests').select('transaction_id,passenger_name,flight_no,destination,excess_kg,amount,payment_mode,created_at,bank,hub_id,total_kg,pnr,passenger_phone').gte('created_at', startISO).lte('created_at', endISO).order('created_at', { ascending: false }).limit(500)),
          addHubFilter(supabase.from('marketing_entries').select('entry_ref,customer_name,route,qty_big_bag,qty_med_bag,qty_small_bag,amount_paid,payment_mode,created_at,hub_id,bank,entered_by,user_profiles(name)').gte('created_at', startISO).lte('created_at', endISO).order('created_at', { ascending: false }).limit(500)),
          addHubFilter(supabase.from('expenses').select('*').gte('created_at', startISO).lte('created_at', endISO).order('created_at', { ascending: false }).limit(500))
        ]);

        if (cargoRes.error) console.error('Cargo fetch error:', cargoRes.error);

        const allTx: Transaction[] = [];

        if (cargoRes.data) {
          cargoRes.data.forEach(r => {
            allTx.push({
              id: r.entry_ref || r.id,
              name: r.consignee_name || 'Cargo',
              detail: `${r.airline || ''} · ${r.awb_tag_number || ''} · ${r.total_pcs || 1}pcs · ${r.total_kg || 0}kg · ${r.route || ''} · ${r.content_type || 'Package'}`,
              amount: r.amount || 0,
              mode: r.receipt_mode || 'Cash',
              time: new Date(r.created_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' }),
              type: 'cargo',
              status: r.status || 'Intake',
              awb_tag_number: r.awb_tag_number,
              kg: r.total_kg,
              pieces: r.total_pcs,
              pickupPin: r.pickup_pin || undefined,
              created_at: r.created_at,
              airline: r.airline,
              bank: r.bank,
              route: r.route,
              hub_id: r.hub_id,
              contentType: r.content_type,
            });
          });
        }

        if (vjRes.data) {
          vjRes.data.forEach(r => {
            allTx.push({
              id: r.transaction_id || r.id,
              name: r.passenger_name || 'VJ Passenger',
              detail: `${r.flight_no || ''} · ${r.destination || ''} · ${r.excess_kg || 0}kg excess`,
              amount: r.amount || 0,
              mode: r.payment_mode || 'POS',
              time: new Date(r.created_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' }),
              type: 'baggage',
              status: 'Delivered',
              created_at: r.created_at,
              bank: r.bank,
              hub_id: r.hub_id,
              destination: r.destination,
              excessKg: r.excess_kg,
              totalKg: r.total_kg,
              flight: r.flight_no,
              pnr: r.pnr || undefined,
              kg: r.excess_kg,
            });
          });
        }

        if (mktRes.data) {
          mktRes.data.forEach((r: any) => {
            // user_profiles comes back as an object when entered_by matched a real
            // user, or an array depending on the relationship — handle both shapes.
            const enteredByName = Array.isArray(r.user_profiles) ? r.user_profiles[0]?.name : r.user_profiles?.name;
            allTx.push({
              id: r.entry_ref || r.id,
              name: r.customer_name || 'Customer',
              detail: `${r.route || ''} · ${r.qty_big_bag || 0}BB ${r.qty_med_bag || 0}MB ${r.qty_small_bag || 0}SB`,
              amount: r.amount_paid || 0,
              mode: r.payment_mode || 'Cash',
              time: new Date(r.created_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' }),
              type: 'marketing',
              status: 'Intake',
              created_at: r.created_at,
              bank: r.bank,
              hub_id: r.hub_id,
              route: r.route,
              enteredByName: enteredByName || undefined,
            });
          });
        }

        if (expRes.data) {
          const fetchedExpenses = expRes.data.map((e: any) => ({
            id: e.id,
            type: e.category || 'General',
            amount: e.amount,
            description: e.description,
            time: e.created_at,
            status: e.status || 'pending',
            logged_by: e.logged_by || undefined,
          }));
          setExpenses(prev => {
            // Same reasoning as the transactions merge below: a date-range
            // change can refire this fetch before an optimistically-added
            // expense (handleAddExpense) has actually landed in Supabase.
            // Without this, that expense would silently vanish from the UI.
            const stillPending = pendingExpenseRef.current.filter(
              p => !fetchedExpenses.some((f: any) => f.id === p.id)
            );
            pendingExpenseRef.current = stillPending;
            const combined = [...stillPending, ...fetchedExpenses];
            const unique = combined.filter((v, i, a) => a.findIndex(x => x.id === v.id) === i);
            return unique.sort((a, b) => new Date(b.time || 0).getTime() - new Date(a.time || 0).getTime());
          });
        }

        allTx.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
        
        setTransactions(prev => {
          // Instead of merging unconditionally, we just set to what we fetched to respect the date filter.
          // But we keep locally pending transactions.
          const localOnly = pendingTxRef.current.filter(p => !allTx.some(t => t.id === p.id));
          const combined = [...localOnly, ...allTx];
          combined.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
          return combined.slice(0, 1000);
        });
      } catch (err) {
        console.error("Failed to fetch initial tx:", err);
      }
    };
    
    fetchInitial();
  }, [isOffline, globalDateRange, user.role, user.hub_id]);

  // Supabase real-time
  useEffect(() => {
    if (isOffline) return;

    const isAdmin = ['super_admin','admin','accountant','auditor'].includes(user.role);
    const canSeePin = ['admin', 'super_admin', 'accountant'].includes(user.role);
    // Postgres changes filter — non-admins only receive their own hub's rows
    const hubFilter = (!isAdmin && user.hub_id) ? `hub_id=eq.${user.hub_id}` : undefined;

    // Only open the channels this role actually has a use for. Every user
    // was previously opening all 3 channels regardless of role, which at
    // scale (Supabase Pro includes 500 concurrent Realtime connections)
    // means a driver or single-stream agent spends 3 connections for data
    // Dashboard.tsx's own showCargo/showVJ/showMktg logic already hides
    // from them. Mirrors that exact same gating so nobody's visible data
    // changes — this only removes waste, not functionality.
    const needsCargo = isAdmin || user.role === 'cargo_agent';
    const needsVJ = isAdmin || user.role === 'vj_agent';
    const needsMarketing = isAdmin || user.role === 'marketing_agent';

    // Guard against pushing a row that already exists locally (e.g. our own insert)
    const pushUnique = (tx: Transaction) => {
      const exists =
        pendingTxRef.current.some(p => p.id === tx.id) ||
        transactionsRef.current.some(p => p.id === tx.id);
      if (exists) return;
      pendingTxRef.current.push(tx);
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      flushTimerRef.current = setTimeout(flushPendingTx, 300);
    };

    const cargoChannel = needsCargo ? supabase
      .channel('ehi-cargo-live')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'cargo_entries', filter: hubFilter },
        payload => {
          const r = payload.new as any;
          pushUnique({
            id: r.entry_ref || r.id,
            name: r.consignee_name || 'Cargo',
            detail: `${r.airline || ''} · ${r.awb_tag_number || ''} · ${r.total_pcs || 1}pcs · ${r.total_kg || 0}kg · ${r.route || ''} · ${r.content_type || 'Package'}`,
            amount: r.amount || 0,
            mode: r.receipt_mode || 'Cash',
            time: new Date().toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' }),
            type: 'cargo',
            status: r.status || 'Intake',
            awb_tag_number: r.awb_tag_number,
            kg: r.total_kg,
            pieces: r.total_pcs,
            created_at: r.created_at,
            hub_id: r.hub_id,
            route: r.route,
            airline: r.airline,
            // Realtime sends the full row regardless of the original
            // query's column list, so gate this client-side too --
            // canSeePin is already in scope from the fetchInitial closure.
            pickupPin: canSeePin ? (r.pickup_pin || undefined) : undefined,
          });
        }
      )
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'cargo_entries', filter: hubFilter },
        payload => {
          const r = payload.new as any;
          setTransactions(prev => prev.map(t =>
            t.id === (r.entry_ref || r.id) ? {
              ...t,
              status: r.status || t.status,
              mode: r.receipt_mode || t.mode,
              paymentConfirmed: r.payment_confirmed,
              posApprovalCode: r.pos_approval_code
            } : t
          ));
        }
      )
      .subscribe() : null;

    const vjChannel = needsVJ ? supabase
      .channel('ehi-vj-live')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'manifests', filter: hubFilter },
        payload => {
          const r = payload.new as any;
          pushUnique({
            id: r.transaction_id || r.id,
            name: r.passenger_name || 'VJ Passenger',
            detail: `${r.flight_no || ''} · ${r.destination || ''} · +${r.excess_kg || 0}kg excess`,
            amount: r.amount || 0,
            mode: r.payment_mode || 'POS',
            time: new Date().toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' }),
            type: 'baggage',
            status: 'Delivered',
            created_at: r.created_at,
            hub_id: r.hub_id,
            destination: r.destination,
            excessKg: r.excess_kg,
            totalKg: r.total_kg,
            flight: r.flight_no,
            kg: r.excess_kg,
          });
        }
      )
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'manifests', filter: hubFilter },
        payload => {
          const r = payload.new as any;
          setTransactions(prev => prev.map(t =>
            t.id === (r.transaction_id || r.id) ? {
              ...t,
              mode: r.payment_mode || t.mode,
              paymentConfirmed: r.payment_confirmed,
              posApprovalCode: r.pos_approval_code
            } : t
          ));
        }
      )
      .subscribe() : null;

    const marketingChannel = needsMarketing ? supabase
      .channel('ehi-marketing-live')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'marketing_entries', filter: hubFilter },
        payload => {
          const r = payload.new as any;
          pushUnique({
            id: r.entry_ref || r.id,
            name: r.customer_name || 'Customer',
            detail: `${r.route || ''} · ${r.qty_big_bag || 0}BB ${r.qty_med_bag || 0}MB ${r.qty_small_bag || 0}SB`,
            amount: r.amount_paid || 0,
            mode: r.payment_mode || 'Cash',
            time: new Date().toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' }),
            type: 'marketing',
            status: 'Intake',
            created_at: r.created_at,
            hub_id: r.hub_id,
            route: r.route,
          });
        }
      )
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'marketing_entries', filter: hubFilter },
        payload => {
          const r = payload.new as any;
          setTransactions(prev => prev.map(t =>
            t.id === (r.entry_ref || r.id) ? {
              ...t,
              mode: r.payment_mode || t.mode,
              paymentConfirmed: r.payment_confirmed,
              status: r.status || t.status,
            } : t
          ));
        }
      )
      .subscribe() : null;

    return () => {
      if (cargoChannel) supabase.removeChannel(cargoChannel);
      if (vjChannel) supabase.removeChannel(vjChannel);
      if (marketingChannel) supabase.removeChannel(marketingChannel);
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    };
  }, [isOffline, flushPendingTx, user.hub_id, user.role]);

  const handleAddTx = useCallback(async (tx: Transaction) => {
    setTransactions(prev => {
      const idx = prev.findIndex(t => t.id === tx.id);
      if (idx !== -1) {
        const next = [...prev];
        next[idx] = tx;
        return next;
      }
      return [tx, ...prev].slice(0, 200);
    });
    const tableName = tx.type === 'marketing' ? 'marketing_entries' 
      : tx.type === 'cargo' ? 'cargo_entries' 
      : tx.type === 'baggage' ? 'manifests' 
      : 'shipments';
    
    let hubId = user.hub_id;
    if (!hubId) {
      // Fallback: fetch hub_id from db based on user.hub
      const { data: hubData } = await supabase.from('hubs').select('id').eq('name', user.hub).single();
      if (hubData) {
        hubId = hubData.id;
      }
    }

    // Map internal Transaction type to Supabase table schema
    let payload: any = { id: tx.id };
    
    if (tx.type === 'marketing') {
      const parts = tx.detail.split(' · ');
      const route = (tx as any).route || parts[0] || '';
      const bagsStr = parts[1] || '';
      // Read direct fields first (faster, no regex needed)
      const bb = (tx as any)._bb ?? parseInt(bagsStr.match(/(\d+)\s*BB/)?.[1] || '0');
      const mb = (tx as any)._mb ?? parseInt(bagsStr.match(/(\d+)\s*MB/)?.[1] || '0');
      const sb = (tx as any)._sb ?? parseInt(bagsStr.match(/(\d+)\s*SB/)?.[1] || '0');

      payload = {
        id: tx.id,
        entry_ref: tx.id,
        customer_name: tx.name,
        route: route,
        qty_big_bag: bb,
        qty_med_bag: mb,
        qty_small_bag: sb,
        amount_paid: tx.amount,
        payment_mode: tx.mode,
        bank: tx.bank,
        hub_id: hubId,
        entered_by: user.id && user.id.includes('-') && user.id.length > 30 ? user.id : undefined, // Ensure valid UUID
        created_at: new Date().toISOString()
      };
    } else if (tx.type === 'cargo') {
      const parts = tx.detail.split(' · ');
      // parts[0] = airline (already in tx.airline, skip)
      const awbFromDetail = parts[1] || '';
      const pcsStr = parts[2] || '';
      const kgStr = parts[3] || '';
      const route = parts[4] || '';
      const content = parts[5] || '';
      
      payload = {
        id: tx.id,
        entry_ref: tx.id,
        consignee_name: tx.name,
        route: route,
        total_pcs: parseInt(pcsStr) || 1,
        total_kg: Math.round(parseFloat(kgStr) || 0),
        content_type: content,
        awb_tag_number: awbFromDetail,
        amount: tx.amount,
        receipt_mode: tx.mode,
        bank: tx.bank,
        hub_id: hubId,
        airline: (tx as any).airline || parts[0] || 'Unknown',
        remark: (tx as any).remarks || null,
        pickup_pin: (tx as any).pickupPin || null,
        consignee_phone: (tx as any).consigneePhone || null,
        entered_by: user.id && user.id.includes('-') && user.id.length > 30 ? user.id : undefined,
        created_at: new Date().toISOString()
      };
    } else if (tx.type === 'baggage') {
      const excessKg  = Math.round(tx.excessKg || (tx as any).excessKg || 0);
      const totalKg   = Math.round(tx.totalKg  || (tx as any).totalKg  || excessKg);
      const dest      = tx.destination || (tx as any).destination || '';
      const flightNo  = tx.flight      || (tx as any).flight      || tx.detail?.split(' · ')[0] || '';
      const pnr       = tx.pnr         || (tx as any).pnr         || null;

      payload = {
        id: tx.id,
        transaction_id: tx.id,
        passenger_name: tx.name,
        passenger_phone: (tx as any).phone || null,
        flight_no: flightNo,
        destination: dest,
        pnr: pnr,
        excess_kg: excessKg,
        total_kg: totalKg,
        free_allowance_kg: 20,
        rate_per_kg: 1000,
        amount: tx.amount,
        payment_mode: tx.mode,
        bank: tx.bank,
        hub_id: hubId,
        entered_by: user.id && user.id.includes('-') && user.id.length > 30 ? user.id : undefined,
        created_at: new Date().toISOString()
      };
    } else {
      payload = { ...tx, created_at: new Date().toISOString(), hub_id: hubId };
    }

    const { offline, error } = await writeWithOfflineSupport(tableName as any, payload);
    
    if (offline) {
      setPendingSyncCount(prev => prev + 1);
      showToast({ message: error ? `Error: ${error}` : 'Saved offline — syncs when reconnected', type: 'warning' });
    }
    // Write audit log
    writeAuditLog({
      user_id: user.id,
      user_name: user.name,
      action: 'CREATE',
      table_name: tableName,
      record_id: tx.id,
      description: `New ${tx.type} entry: ${tx.name} — ₦${tx.amount.toLocaleString()}`,
      hub: user.hub,
      hub_id: user.hub_id,
      new_values: { amount: tx.amount, mode: tx.mode, type: tx.type },
    }).catch(() => {});
  }, [user.hub_id, user.id, showToast]);

  const handleUpdateTx = useCallback(async (tx: Transaction) => {
    setTransactions(prev => prev.map(t => t.id === tx.id ? tx : t));

    const table = tx.type === 'cargo' ? 'cargo_entries'
                : tx.type === 'baggage' ? 'manifests'
                : 'marketing_entries';

    // Each table uses different column names — cargo_entries uses receipt_mode,
    // manifests and marketing_entries use payment_mode. Do not unify these.
    const idCol      = table === 'manifests' ? 'transaction_id' : 'entry_ref';
    const modeCol    = table === 'cargo_entries' ? 'receipt_mode' : 'payment_mode';

    const updatePayload: Record<string, any> = {
      [modeCol]: tx.mode,
      bank: tx.bank,
      status: tx.status,
    };
    if (tx.paymentConfirmed !== undefined) updatePayload.payment_confirmed = tx.paymentConfirmed;
    if (tx.posApprovalCode)               updatePayload.pos_approval_code  = tx.posApprovalCode;
    if (tx.confirmedBy)                   updatePayload.confirmed_by        = tx.confirmedBy;
    if (tx.confirmedAt)                   updatePayload.confirmed_at        = tx.confirmedAt;

    const { error } = await supabase.from(table).update(updatePayload).eq(idCol, tx.id);
    if (error) showToast({ message: `Update failed: ${error.message}`, type: 'error' });
    if (!error && tx.paymentConfirmed) {
      writeAuditLog({
        user_id: user.id,
        user_name: user.name,
        action: 'PAYMENT_CONFIRM',
        table_name: table,
        record_id: tx.id,
        description: `Payment confirmed for ${tx.name} — ₦${tx.amount?.toLocaleString()} (${tx.mode})`,
        hub: user.hub,
        hub_id: user.hub_id,
        new_values: { payment_confirmed: true, mode: tx.mode },
      }).catch(() => {});
    }
  }, [showToast, user.hub, user.hub_id, user.id, user.name]);

  const handleAddExpense = useCallback(async (expense: Expense) => {
    setExpenses(prev => [expense, ...prev]);
    pendingExpenseRef.current.push(expense);
    const today = new Date().toISOString().split('T')[0];
    // expense.time may be "14:30" (no date) — only use it as a date if it looks like one
    const parsedDate = /^\d{4}-\d{2}-\d{2}/.test(expense.time) ? expense.time.split(' ')[0] : today;
    const payload = {
      id: expense.id,
      category: expense.type,
      amount: expense.amount,
      description: expense.description,
      date: parsedDate,
      time: expense.time,
      hub: user.hub,
      hub_id: user.hub_id || null,
      logged_by: user.name,
      logged_by_id: user.id && user.id.includes('-') && user.id.length > 30 ? user.id : null,
      status: expense.status || 'pending',
      requires_approval: expense.amount > 20000
    };
    const { offline, error } = await writeWithOfflineSupport('expenses', payload);
    if (offline) {
      setPendingSyncCount(prev => prev + 1);
      showToast({ message: 'Expense saved offline — syncs when reconnected', type: 'warning' });
    } else if (error) {
      showToast({ message: `Failed to save expense: ${error}`, type: 'error' });
    }
  }, [user.hub, user.hub_id, user.id, user.name, showToast]);

  const handleToggleWifi = useCallback(() => {
    setIsOffline(prev => {
      const offline = !prev;
      if (!offline && pendingSyncCount > 0) {
        showToast({ message: `${pendingSyncCount} transaction(s) synced to Supabase`, type: 'success' });
        setPendingSyncCount(0);
      }
      return offline;
    });
  }, [pendingSyncCount, showToast]);

  return (
    <div style={{
      display: 'flex',
      height: '100dvh',
      width: '100vw',
      maxWidth: '100vw',
      background: 'var(--color-background)',
      overflow: 'hidden',
      fontFamily: "'Inter', system-ui, sans-serif",
    }}>
      <SideNav
        user={user}
        currentTab={currentTab}
        onChangeTab={setCurrentTab}
        onLogout={onLogout}
        theme={theme}
        onToggleTheme={toggle}
      />

      <div
        className="ehi-main-content"
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          overflow: 'hidden',
        }}
      >
        {/* Header — mobile only */}
        <Header
          user={user}
          isOffline={isOffline}
          pendingCount={pendingSyncCount}
          onToggleWifi={handleToggleWifi}
          onLogout={onLogout}
          theme={theme}
          onToggleTheme={toggle}
        />

        <main
          className="flex-1 overflow-y-auto overflow-x-hidden"
          style={{ display: 'flex', flexDirection: 'column' }}
        >
          <div
            className="mx-auto w-full flex-1 flex flex-col"
            style={{ maxWidth: 'var(--content-max-width)' }}
          >
            <ErrorBoundary>
              {currentTab === 'Tower' && (
                (user.role === 'super_admin' || user.role === 'admin' || user.role === 'accountant') ? (
                  <Analytics user={user} transactions={transactions} expenses={expenses} />
                ) : (
                  <Dashboard user={user} transactions={transactions} />
                )
              )}
              {currentTab === 'Cargo' && (
                <CargoForm
                  onAddTx={handleAddTx}
                  user={user}
                  transactions={transactions}
                  onShowHistory={() => setStreamLedger('cargo')}
                />
              )}
              {currentTab === 'Marketing' && (
                <MarketingWorkspace
                  user={user}
                  transactions={transactions}
                  expenses={expenses}
                  onAddTx={handleAddTx}
                  onAddExpense={handleAddExpense}
                  onShowHistory={() => setStreamLedger('marketing')}
                />
              )}
              {currentTab === 'VJ POS' && (
                <ValueJetForm
                  onAddTx={handleAddTx}
                  user={user}
                  onShowHistory={() => setStreamLedger('baggage')}
                />
              )}
              {currentTab === 'Scan' && <Scanner transactions={transactions} user={user} showToast={showToast} />}
              {currentTab === 'MyTrips' && <MyTrips user={user} />}
              {currentTab === 'IT Debug' && <ITDashboard user={user} />}
              {currentTab === 'Credit & Debit' && <CreditDebit user={user} transactions={transactions} />}
              {currentTab === 'More' && (
                <More 
                  user={user} 
                  transactions={transactions} 
                  expenses={expenses}
                  onLogout={onLogout} 
                  onAddTx={handleAddTx}
                  onFullUpdateTx={handleUpdateTx}
                  onChangeTab={setCurrentTab}
                  onAddExpense={handleAddExpense}
                  dateRange={globalDateRange}
                  onDateRangeChange={setGlobalDateRange}
                  onEOD={() => {
                    showToast({ message: 'EOD Report Dispatched — Saved to Drive · Emailed to management', type: 'success' });
                  }}
                />
              )}
            </ErrorBoundary>
          </div>
        </main>
      </div>

      <div className="ehi-bottomnav-wrapper fixed bottom-0 left-0 right-0 w-full z-50 bg-[var(--color-nav-bg)]">
        <BottomNav user={user} currentTab={currentTab} onChangeTab={setCurrentTab} />
      </div>

      {/* Per-stream view-only ledger overlay */}
      {streamLedger && (
        <div className="fixed inset-0 z-50 flex flex-col bg-[var(--color-obsidian)]">
          <TransactionLedger
            user={user}
            transactions={transactions.filter(t => t.type === streamLedger)}
            onBack={() => setStreamLedger(null)}
            onUpdateTx={handleUpdateTx}
            defaultTypeFilter={streamLedger}
            viewOnly={user.role !== 'super_admin' && !user.can_edit_ledger}
            dateRange={globalDateRange}
            onDateRangeChange={setGlobalDateRange}
          />
        </div>
      )}

      {toast && <Toast {...toast} />}
    </div>
  );
};
