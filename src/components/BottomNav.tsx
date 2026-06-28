import { User, TabView } from '../lib/types';
import { LayoutDashboard, Package, TrendingUp, Plane, QrCode, MoreHorizontal, Truck } from 'lucide-react';

export const BottomNav = ({ user, currentTab, onChangeTab }: {
  user: User;
  currentTab: TabView;
  onChangeTab: (t: TabView) => void;
}) => {
  // Role-specific tab sets — max 5 items per role
  const getTabsForRole = (role: string) => {
    const home   = { id: 'Tower' as TabView, title: 'Dashboard', icon: LayoutDashboard };
    const cargo  = { id: 'Cargo' as TabView, title: 'Cargo', icon: Package };
    const mkt    = { id: 'Marketing' as TabView, title: 'Marketing', icon: TrendingUp };
    const vj     = { id: 'VJ POS' as TabView, title: 'ValueJet', icon: Plane };
    const scan   = { id: 'Scan' as TabView, title: 'Scanner', icon: QrCode };
    const trips  = { id: 'MyTrips' as TabView, title: 'My Trips', icon: Truck };
    const more   = { id: 'More' as TabView, title: 'More', icon: MoreHorizontal };

    switch (role) {
      case 'super_admin':
        // All 3 revenue streams visible — VJ accessible via More
        return [home, cargo, mkt, scan, more];
      case 'admin':
        return [home, cargo, mkt, scan, more];
      case 'cargo_agent':
        return [home, cargo, scan, more];
      case 'vj_agent':
        return [home, vj, scan, more];
      case 'marketing_agent':
        return [home, mkt, scan, more];
      case 'driver':
        return [home, trips, scan];
      case 'accountant':
        return [home, scan, more];
      case 'auditor':
        return [home, scan, more];
      default:
        return [home, scan, more];
    }
  };

  const tabs = getTabsForRole(user.role);

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
      {tabs.map(tab => {
        const isActive = currentTab === tab.id;
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            onClick={() => onChangeTab(tab.id)}
            className="group flex-1 h-full flex flex-col items-center justify-center gap-0.5 transition-colors relative"
            style={{ background: 'none', border: 'none', cursor: 'pointer', minWidth: 0 }}
          >
            <div style={{ height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon
                size={isActive ? 21 : 19}
                strokeWidth={isActive ? 2 : 1.5}
                style={{ transition: 'all 0.2s' }}
                className={isActive
                  ? 'text-[var(--color-accent-amber)]'
                  : 'text-[var(--color-muted)] group-hover:text-[var(--color-accent-amber)]'}
              />
            </div>
            <span
              style={{ fontSize: 10, fontWeight: isActive ? 700 : 500, transition: 'all 0.2s', letterSpacing: '0.01em' }}
              className={isActive
                ? 'text-[var(--color-accent-amber)]'
                : 'text-[var(--color-muted)] group-hover:text-[var(--color-accent-amber)]'}
            >
              {tab.title}
            </span>
            {isActive && (
              <div style={{
                position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)',
                width: 24, height: 2, background: 'var(--color-accent-amber)',
                borderRadius: '2px 2px 0 0',
              }} />
            )}
          </button>
        );
      })}
    </div>
  );
};
