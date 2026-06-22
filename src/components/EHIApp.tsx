import { useState, useEffect, lazy, Suspense, useRef, useCallback } from 'react';
import { User, TabView, Transaction, Expense } from '../lib/types';
import { processSyncQueue, writeWithOfflineSupport, cleanupOldQueue } from '../lib/sync';
import { useTheme } from '../lib/useTheme';
import { Header } from './Header';
import { BottomNav } from './BottomNav';
import { SideNav } from './SideNav';
import { Toast, ToastProps } from './Toast';
import { supabase, getConnectionMode } from '../lib/supabase';
import { randCargo, randBaggage, randMarketingEntry } from '../lib/helpers';
import { Loader2 } from 'lucide-react';
import { Dashboard } from './views/Dashboard';
import { CargoForm } from './views/CargoForm';
import { ValueJetForm } from './views/ValueJetForm';

import { SEED_TRANSACTIONS } from '../lib/constants';

const Analytics = lazy(() => import('./views/Analytics').then(m => ({ default: m.Analytics })));
const More = lazy(() => import('./views/More').then(m => ({ default: m.More })));
const MarketingWorkspace = lazy(() => import('./views/MarketingWorkspace').then(m => ({ default: m.MarketingWorkspace })));
const Scanner = lazy(() => import('./views/Scanner').then(m => ({ default: m.Scanner })));
const MyTrips = lazy(() => import('./views/MyTrips').then(m => ({ default: m.MyTrips })));

export const EHIApp = ({ user, onLogout }: { user: User; onLogout: () => void }) => {
  const getDefaultTab = (role: string): TabView => {
    if (role === 'marketing_agent') return 'Marketing';
    if (role === 'driver') return 'MyTrips';
    return 'Tower';
  };
  const [currentTab, setCurrentTab] = useState<TabView>(getDefaultTab(user.role));
  const [transactions, setTransactions] = useState<Transaction[]>(SEED_TRANSACTIONS);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [toast, setToast] = useState<ToastProps | null>(null);
  
  const { theme, toggle } = useTheme();

  const pendingTxRef = useRef<Transaction[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [showToast]);

  const flushPendingTx = useCallback(() => {
    if (pendingTxRef.current.length === 0) return;
    setTransactions(prev =>
      [...pendingTxRef.current, ...prev].slice(0, 200)
    );
    pendingTxRef.current = [];
  }, []);

  // Live simulation and Supabase real-time
  useEffect(() => {
    if (isOffline) return;
    
    // Subscribe to real-time changes
    const cargoChannel = supabase
      .channel('ehi-cargo-live')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'cargo_entries' },
        payload => {
          const r = payload.new as any;
          pendingTxRef.current.push({
            id: r.entry_ref || r.id,
            name: r.consignee_name || 'Cargo',
            detail: `${r.awb_tag_number || ''} · ${r.route || ''}`,
            amount: r.amount || 0,
            mode: r.receipt_mode || 'Cash',
            time: new Date().toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' }),
            type: 'cargo',
            status: 'Intake',
            awb_tag_number: r.awb_tag_number,
            kg: r.total_kg,
            pieces: r.total_pcs,
          });
          if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
          flushTimerRef.current = setTimeout(flushPendingTx, 300);
        }
      ).subscribe();

    const vjChannel = supabase
      .channel('ehi-vj-live')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'manifests' },
        payload => {
          const r = payload.new as any;
          pendingTxRef.current.push({
            id: r.transaction_id || r.id,
            name: r.passenger_name || 'VJ Passenger',
            detail: `${r.flight_no || ''} · +${r.excess_kg || 0}kg excess`,
            amount: r.amount || 0,
            mode: r.payment_mode || 'POS',
            time: new Date().toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' }),
            type: 'baggage',
            status: 'Delivered',
          });
          if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
          flushTimerRef.current = setTimeout(flushPendingTx, 300);
        }
      ).subscribe();

    const marketingChannel = supabase
      .channel('ehi-marketing-live')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'marketing_entries' },
        payload => {
          const r = payload.new as any;
          pendingTxRef.current.push({
            id: r.entry_ref || r.id,
            name: r.customer_name || 'Customer',
            detail: `${r.route || ''} · ${r.qty_big_bag || 0}BB ${r.qty_med_bag || 0}MB ${r.qty_small_bag || 0}SB`,
            amount: r.amount_paid || 0,
            mode: r.payment_mode || 'Cash',
            time: new Date().toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' }),
            type: 'marketing',
            status: 'Intake',
          });
          if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
          flushTimerRef.current = setTimeout(flushPendingTx, 300);
        }
      ).subscribe();

    // Only simulate in demo mode — NEVER inject fake data in production
    let int: ReturnType<typeof setInterval> | null = null;
    if (getConnectionMode() === 'demo') {
      int = setInterval(() => {
        const rand = Math.random();
        const newTx = rand < 0.4 ? randCargo()
          : (rand < 0.75 ? randMarketingEntry() : randBaggage());
        pendingTxRef.current.push(newTx);
        if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
        flushTimerRef.current = setTimeout(flushPendingTx, 300);
      }, 7000);
    }
    
    return () => {
      supabase.removeChannel(cargoChannel);
      supabase.removeChannel(vjChannel);
      supabase.removeChannel(marketingChannel);
      if (int) clearInterval(int);
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    };
  }, [isOffline, flushPendingTx]);

  const handleAddTx = useCallback(async (tx: Transaction) => {
    setTransactions(prev => [tx, ...prev].slice(0, 200));
    const tableName = tx.type === 'marketing' ? 'marketing_entries' 
      : tx.type === 'cargo' ? 'cargo_entries' 
      : tx.type === 'baggage' ? 'manifests' 
      : 'shipments';
    
    const payload = { ...tx };
    const { offline } = await writeWithOfflineSupport(tableName as any, payload);
    
    if (offline) {
      setPendingSyncCount(prev => prev + 1);
      showToast({ message: 'Saved offline — syncs when reconnected', type: 'warning' });
    }
  }, [showToast]);

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
      width: '100%',
      background: 'var(--color-background)',
      overflow: 'hidden',
      fontFamily: "'Inter', system-ui, sans-serif",
      transition: 'background-color 0.2s ease'
    }}>
      <SideNav
        user={user}
        currentTab={currentTab}
        onChangeTab={setCurrentTab}
        onLogout={onLogout}
        theme={theme}
        onToggleTheme={toggle}
      />

      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        overflow: 'hidden',
      }}>
        {/* Header — mobile only */}
        <div className="md:hidden">
          <Header
            user={user}
            isOffline={isOffline}
            pendingCount={pendingSyncCount}
            onToggleWifi={handleToggleWifi}
            onLogout={onLogout}
            theme={theme}
            onToggleTheme={toggle}
          />
        </div>

        <main
          className="flex-1 overflow-y-auto md:pb-0"
          style={{ paddingBottom: 'calc(60px + env(safe-area-inset-bottom))' }}
        >
          <div
            className="mx-auto w-full"
            style={{ maxWidth: 'var(--content-max-width)' }}
          >
            <Suspense fallback={
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                height: 200, color: 'var(--color-muted)',
                fontFamily: 'monospace', fontSize: 11,
              }}>
                <Loader2 className="animate-spin text-[var(--color-accent-amber)]" size={32} />
              </div>
            }>
              {currentTab === 'Tower' && (
                (user.role === 'super_admin' || user.role === 'admin' || user.role === 'accountant') ? (
                  <Analytics user={user} transactions={transactions} />
                ) : (
                  <Dashboard user={user} transactions={transactions} />
                )
              )}
              {currentTab === 'Cargo' && <CargoForm onAddTx={handleAddTx} user={user} />}
              {currentTab === 'Marketing' && <MarketingWorkspace user={user} transactions={transactions} expenses={expenses} onAddTx={handleAddTx} onAddExpense={(exp: Expense) => setExpenses(prev => [exp, ...prev])} />}
              {currentTab === 'VJ POS' && <ValueJetForm onAddTx={handleAddTx} />}
              {currentTab === 'Scan' && <Scanner transactions={transactions} user={user} showToast={showToast} />}
              {currentTab === 'MyTrips' && <MyTrips user={user} />}
              {currentTab === 'More' && (
                <More 
                  user={user} 
                  transactions={transactions} 
                  expenses={expenses}
                  onLogout={onLogout} 
                  onAddTx={handleAddTx}
                  onAddExpense={(exp: Expense) => setExpenses(prev => [exp, ...prev])}
                  onEOD={() => {
                    showToast({ message: 'EOD Report Dispatched — Saved to Drive · Emailed to management', type: 'success' });
                  }}
                />
              )}
            </Suspense>
          </div>
        </main>
      </div>

      <div className="md:hidden">
        <BottomNav user={user} currentTab={currentTab} onChangeTab={setCurrentTab} />
      </div>

      {toast && <Toast {...toast} />}
    </div>
  );
};
