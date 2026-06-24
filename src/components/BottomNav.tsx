import { User, TabView } from '../lib/types';
import { LayoutDashboard, Package, TrendingUp, Plane, QrCode, Cpu, MoreHorizontal, Truck, CreditCard } from 'lucide-react';

export const BottomNav = ({ user, currentTab, onChangeTab }: { user: User; currentTab: TabView; onChangeTab: (t: TabView) => void }) => {
  const allTabs: { id: TabView; title: string, icon: any; roles: string[] }[] = [
    { id: 'Tower', title: 'Home', icon: LayoutDashboard, roles: ['super_admin', 'admin', 'cargo_agent', 'vj_agent', 'accountant', 'auditor'] },
    { id: 'Cargo', title: 'Cargo', icon: Package, roles: ['super_admin', 'admin', 'cargo_agent'] },
    { id: 'Marketing', title: 'Marketing', icon: TrendingUp, roles: ['super_admin', 'admin', 'marketing_agent'] },
    { id: 'VJ POS', title: 'ValueJet', icon: Plane, roles: ['super_admin', 'admin', 'vj_agent'] },
    { id: 'MyTrips', title: 'My Trips', icon: Truck, roles: ['driver'] },
    { id: 'Scan', title: 'Scanner', icon: QrCode, roles: ['super_admin', 'admin', 'cargo_agent', 'vj_agent', 'marketing_agent', 'driver'] },
    { id: 'IT Debug', title: 'IT Debug', icon: Cpu, roles: ['super_admin', 'admin'] },
    { id: 'Credit & Debit', title: 'Credit & Debit', icon: CreditCard, roles: ['super_admin', 'admin', 'accountant'] },
    { id: 'More', title: 'More', icon: MoreHorizontal, roles: ['super_admin', 'admin', 'accountant', 'auditor'] },
  ];

  const visibleTabs = allTabs.filter(t => t.roles.includes(user.role));

  const activeColor = 'var(--color-accent-amber)';

  return (
    <div
      className="w-full flex items-center justify-around shrink-0 z-50"
      style={{
        background: 'var(--color-nav-bg)',
        borderTop: '1px solid var(--color-border-strong)',
        boxShadow: 'var(--shadow-nav)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        height: 'calc(62px + env(safe-area-inset-bottom))',
      }}
    >
      {visibleTabs.map(tab => {
        const isActive = currentTab === tab.id;
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            onClick={() => onChangeTab(tab.id)}
            className="group flex-1 h-full flex flex-col items-center justify-center relative gap-0.5 transition-colors hover:text-[var(--color-accent-amber)]"
            style={{ background: 'none', border: 'none', cursor: 'pointer' }}
          >
            <div style={{ height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon
                size={isActive ? 20 : 18}
                strokeWidth={1.5}
                style={{
                  transition: 'all 0.2s',
                  position: 'relative', zIndex: 1,
                }}
                className={isActive ? 'text-[var(--color-accent-amber)]' : 'text-[var(--color-muted)] group-hover:text-[var(--color-accent-amber)]'}
              />
            </div>
            <span
              style={{
                fontSize: 10, fontWeight: isActive ? 600 : 500,
                transition: 'all 0.2s',
              }}
              className={isActive ? 'text-[var(--color-accent-amber)]' : 'text-[var(--color-muted)] group-hover:text-[var(--color-accent-amber)]'}
            >
              {tab.title}
            </span>
          </button>
        );
      })}
    </div>
  );
};

