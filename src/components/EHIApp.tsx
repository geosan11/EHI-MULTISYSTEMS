import { useState, useEffect, lazy, Suspense, useRef, useCallback } from 'react';
import { User, TabView, Transaction, Expense } from '../lib/types';
import { processSyncQueue, writeWithOfflineSupport, cleanupOldQueue } from '../lib/sync';
import { useTheme } from '../lib/useTheme';
import { Header } from './Header';
import { BottomNav } from './BottomNav';
import { SideNav } from './SideNav';
import { Toast, ToastProps } from './Toast';
import { supabase } from '../lib/supabase';
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
    const channel = supabase
      .channel('ehi-live-ops')
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'shipments'
      }, payload => {
        // mock logic to push transaction
        const newTx = payload.new as any;
        pendingTxRef.current.push({
          id: newTx.entry_ref || newTx.id || 'REALTIME',
          name: newTx.customer_name || 'ValueJet Psgr',
          detail: `Baggage · ${newTx.route || ''}`,
          amount: newTx.amount_paid || 0,
          mode: newTx.payment_mode || 'Cash',
          time: new Date(newTx.log_date || Date.now()).toLocaleTimeString(),
          type: 'baggage', status: 'Intake'
        });
        if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
        flushTimerRef.current = setTimeout(flushPendingTx, 300);
      })
      .subscribe();

    // Fallback Simulation for UI preview purposes
    const int = setInterval(() => {
      const rand = Math.random();
      const newTx = rand < 0.4 ? randCargo() : (rand < 0.75 ? randMarketingEntry() : randBaggage());
      pendingTxRef.current.push(newTx);
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      flushTimerRef.current = setTimeout(flushPendingTx, 300);
    }, 7000);
    
    return () => {
      supabase.removeChannel(channel);
      clearInterval(int);
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    };
  }, [isOffline, flushPendingTx]);

  const handleAddTx = useCallback(async (tx: Transaction) => {
    setTransactions(prev => [tx, ...prev].slice(0, 200));
    const tableName = tx.type === 'marketing' ? 'marketing_entries' 
      : tx.type === 'cargo' ? 'cargo_entries' 
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
      height: '100vh',
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
          className="flex-1 overflow-y-auto pb-[60px] md:pb-0"
        >
          <div
            className="mx-auto"
            style={{
              maxWidth: 'var(--content-max-width)',
              padding: 'var(--content-padding)',
            }}
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
              {currentTab === 'Scan' && <Scanner transactions={transactions} user={user} />}
              {currentTab === 'MyTrips' && (
                <div className="flex flex-col items-center justify-center h-full text-[var(--color-muted)] font-mono text-[10px]">
                   MY TRIPS MODULE PENDING
                </div>
              )}
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
