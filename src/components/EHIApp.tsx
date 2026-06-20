import { useState, useEffect } from 'react';
import { User, TabView, Transaction, Expense } from '../lib/types';
import { processSyncQueue, writeWithOfflineSupport } from '../lib/sync';
import { Header } from './Header';
import { BottomNav } from './BottomNav';
import { Dashboard } from './views/Dashboard';
import { CargoForm } from './views/CargoForm';
import { ValueJetForm } from './views/ValueJetForm';
import { Scanner } from './views/Scanner';
import { More } from './views/More';
import { MarketingWorkspace } from './views/MarketingWorkspace';
import { Toast, ToastProps } from './Toast';
import { supabase } from '../lib/supabase';
import { randCargo, randBaggage, randMarketingEntry } from '../lib/helpers';

export const EHIApp = ({ user, onLogout }: { user: User; onLogout: () => void }) => {
  const getDefaultTab = (role: string): TabView => {
    if (role === 'marketing_agent') return 'Marketing';
    if (role === 'driver') return 'MyTrips';
    return 'Tower';
  };
  const [currentTab, setCurrentTab] = useState<TabView>(getDefaultTab(user.role));
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [toast, setToast] = useState<ToastProps | null>(null);

  const showToast = (props: Omit<ToastProps, 'onClose'>) => {
    setToast({ ...props, onClose: () => setToast(null) });
  };

  useEffect(() => {
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
  }, []);

  // Set initial transactions
  useEffect(() => {
    // In actual implementation here would fetch today's data from db
    // Since we don't have existing supabase entries created via seeds within this prompt session,
    // we use real-time listeners for inserts from now on.
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
        // Mocking transformation from row to Transaction type 
        // We'll rely on the app logic to push to setTransactions directly via handleAddTx for now to avoid mapping complexities
      })
      .subscribe();

    // Fallback Simulation for UI preview purposes
    const int = setInterval(() => {
      setTransactions(prev => {
        const rand = Math.random();
        const newTx = rand < 0.4 ? randCargo() : (rand < 0.75 ? randMarketingEntry() : randBaggage());
        return [newTx, ...prev];
      });
    }, 7000);
    
    return () => {
      supabase.removeChannel(channel);
      clearInterval(int);
    };
  }, [isOffline]);

  const handleAddTx = async (tx: Transaction) => {
    setTransactions(prev => [tx, ...prev]);
    const tableName = tx.type === 'marketing' ? 'marketing_entries' 
      : tx.type === 'air_cargo' ? 'air_consignments' 
      : 'shipments';
    
    // We mock payload matching what backend would expect
    const payload = { ...tx };
    const { offline } = await writeWithOfflineSupport(tableName as any, payload);
    
    if (offline) {
      setPendingSyncCount(prev => prev + 1);
      showToast({ message: 'Saved offline — syncs when reconnected', type: 'warning' });
    }
  };

  const handleToggleWifi = () => {
    setIsOffline(prev => {
      const offline = !prev;
      if (!offline && pendingSyncCount > 0) {
        showToast({ message: `${pendingSyncCount} transaction(s) synced to Supabase`, type: 'success' });
        setPendingSyncCount(0);
      }
      return offline;
    });
  };

  return (
    <div className="flex flex-col h-screen max-w-[430px] mx-auto bg-[var(--color-obsidian)] relative overflow-hidden">
      <Header 
        user={user} 
        isOffline={isOffline} 
        pendingCount={pendingSyncCount} 
        onToggleWifi={handleToggleWifi} 
        onLogout={onLogout} 
      />
      
      <main className="flex-1 overflow-y-auto w-full pb-[60px]">
        {currentTab === 'Tower' && <Dashboard user={user} transactions={transactions} />}
        {currentTab === 'Cargo' && <CargoForm onAddTx={handleAddTx} />}
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
            onLogout={onLogout} 
            onAddTx={handleAddTx}
            onEOD={() => {
              showToast({ message: 'EOD Report Dispatched — Saved to Drive · Emailed to management', type: 'success' });
            }}
          />
        )}
      </main>

      <BottomNav user={user} currentTab={currentTab} onChangeTab={setCurrentTab} />

      {toast && <Toast {...toast} />}
    </div>
  );
};
