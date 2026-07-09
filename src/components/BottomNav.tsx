import { User, TabView } from '../lib/types';
import { HouseIcon, PackageIcon, TrendUpIcon, AirplaneIcon, QrCodeIcon, DotsThreeIcon, TruckIcon } from '@phosphor-icons/react';

export const BottomNav = ({ user, currentTab, onChangeTab }: {
  user: User;
  currentTab: TabView;
  onChangeTab: (t: TabView) => void;
}) => {
  // Role-specific tab sets — max 5 items per role
  const getTabsForRole = (role: string) => {
    const home   = { id: 'Tower' as TabView, title: 'Dashboard', icon: HouseIcon };
    const cargo  = { id: 'Cargo' as TabView, title: 'Cargo', icon: PackageIcon };
    const mkt    = { id: 'Marketing' as TabView, title: 'Marketing', icon: TrendUpIcon };
    const vj     = { id: 'VJ POS' as TabView, title: 'ValueJet', icon: AirplaneIcon };
    const scan   = { id: 'Scan' as TabView, title: 'Scanner', icon: QrCodeIcon };
    const trips  = { id: 'MyTrips' as TabView, title: 'My Trips', icon: TruckIcon };
    const more   = { id: 'More' as TabView, title: 'More', icon: DotsThreeIcon };

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
      case 'office_work':
        return [cargo, mkt, scan, more];
      default:
        return [home, scan, more];
    }
  };

  const tabs = getTabsForRole(user.role);
  const activeIndex = Math.max(0, tabs.findIndex(tab => tab.id === currentTab));

  return (
    <div
      className="relative w-full shrink-0 z-50"
      style={{
        height: 'calc(78px + env(safe-area-inset-bottom))',
        paddingBottom: 'env(safe-area-inset-bottom)',
        overflow: 'visible',
      }}
    >
      {/* Raised sliding bubble — a real button, not decorative, so the
          region where it visually overlaps the pill isn't a dead tap zone */}
      <button
        onClick={() => onChangeTab(tabs[activeIndex].id)}
        aria-label={tabs[activeIndex]?.title}
        aria-current="page"
        className="absolute rounded-full flex items-center justify-center"
        style={{
          left: `calc(16px + (100% - 32px) * ${(activeIndex + 0.5) / tabs.length})`,
          transform: 'translateX(-50%)',
          bottom: 36,
          width: 46,
          height: 46,
          background: 'radial-gradient(circle at 35% 30%, var(--color-accent-amber), var(--color-accent-amber) 60%, #C98E28 100%)',
          boxShadow: '0 8px 20px rgba(240,178,48,0.45), 0 0 0 5px var(--color-obsidian)',
          border: 'none',
          cursor: 'pointer',
          zIndex: 2,
          transition: 'left 300ms cubic-bezier(0.34, 1.4, 0.64, 1), transform 0.1s ease, box-shadow 0.15s ease',
        }}
      >
        {(() => {
          const ActiveIcon = tabs[activeIndex]?.icon;
          return ActiveIcon ? (
            <ActiveIcon size={19} weight="duotone" color="#111827" />
          ) : null;
        })()}
      </button>

      {/* Glass pill */}
      <div
        className="absolute left-4 right-4 bottom-0 flex items-center justify-around rounded-full"
        style={{
          height: 64,
          background: 'var(--color-nav-glass)',
          backdropFilter: 'blur(18px)',
          WebkitBackdropFilter: 'blur(18px)',
          border: '1px solid var(--color-border-strong)',
          boxShadow: 'var(--shadow-nav)',
        }}
      >
        {tabs.map((tab, i) => {
          const isActive = i === activeIndex;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => onChangeTab(tab.id)}
              className="group flex-1 h-full flex flex-col items-center justify-center gap-1 transition-opacity"
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                minWidth: 0,
                opacity: isActive ? 0 : 1,
              }}
              aria-current={isActive ? 'page' : undefined}
              aria-label={tab.title}
            >
              <div style={{ height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon
                  size={17}
                  weight="regular"
                  className="text-[var(--color-muted)] group-hover:text-[var(--color-accent-amber)] transition-colors"
                />
              </div>
              <span
                style={{ fontSize: 9, fontWeight: 500, letterSpacing: '0.01em' }}
                className="text-[var(--color-muted)] group-hover:text-[var(--color-accent-amber)] transition-colors"
              >
                {tab.title}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
