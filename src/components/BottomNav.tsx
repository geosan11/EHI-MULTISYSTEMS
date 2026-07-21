import { User, TabView } from '../lib/types';
import { getHubCode } from '../lib/helpers';
import { HouseIcon, PackageIcon, TrendUpIcon, AirplaneIcon, QrCodeIcon, DotsThreeIcon, TruckIcon, BuildingIcon } from '@phosphor-icons/react';

const VIEW_ICON: Record<string, any> = {
  Tower: HouseIcon, Cargo: PackageIcon, Marketing: TrendUpIcon, Packages: PackageIcon,
  Scan: QrCodeIcon, Incoming: PackageIcon, OutboundArrivals: PackageIcon, MyTrips: TruckIcon, More: DotsThreeIcon,
  GAT: BuildingIcon,
};
const VIEW_TITLE: Record<string, string> = {
  Tower: 'Dashboard', Cargo: 'Cargo', Marketing: 'Marketing', Packages: 'Packages',
  Scan: 'Scanner', Incoming: 'Incoming', OutboundArrivals: 'Outbound Arrivals', MyTrips: 'My Trips', More: 'More',
  GAT: 'GAT',
};

export const BottomNav = ({ user, currentTab, onChangeTab }: {
  user: User;
  currentTab: TabView;
  onChangeTab: (t: TabView) => void;
}) => {
  // A super-admin-set view_overrides is an exact replacement list -- when
  // present, show everything in it (no 5-item curation: the admin picked
  // this set deliberately for this specific person) instead of the normal
  // per-role curated set below.
  const userHubCode = getHubCode(user.hub_code || user.hub);

  if (user.view_overrides != null) {
    const overrideTabs = user.view_overrides
      // GAT (General Aviation Terminal / MM1) is a Lagos-only physical
      // counter -- even an explicit per-user override shouldn't surface it
      // to someone stationed at a different hub.
      .filter((id) => id !== 'GAT' || userHubCode === 'LOS')
      .map((id) => {
        const isBaggage = id.startsWith('Baggage:');
        return {
          id: id as TabView,
          title: isBaggage ? id.slice('Baggage:'.length) : (VIEW_TITLE[id] || id),
          icon: isBaggage ? AirplaneIcon : (VIEW_ICON[id] || DotsThreeIcon),
        };
      });
    return <BottomNavTabs tabs={overrideTabs} currentTab={currentTab} onChangeTab={onChangeTab} />;
  }

  // Role-specific tab sets — max 5 items per role
  const getTabsForRole = (role: string) => {
    const home   = { id: 'Tower' as TabView, title: 'Dashboard', icon: HouseIcon };
    const cargo  = { id: 'Cargo' as TabView, title: 'Cargo', icon: PackageIcon };
    const gat    = { id: 'GAT' as TabView, title: 'GAT', icon: BuildingIcon };
    const mkt    = { id: 'Marketing' as TabView, title: 'Marketing', icon: TrendUpIcon };
    const baggage = { id: `Baggage:${user.assigned_airline || ''}` as TabView, title: user.assigned_airline || 'Baggage', icon: AirplaneIcon };
    const scan   = { id: 'Scan' as TabView, title: 'Scanner', icon: QrCodeIcon };
    const trips  = { id: 'MyTrips' as TabView, title: 'My Trips', icon: TruckIcon };
    const more   = { id: 'More' as TabView, title: 'More', icon: DotsThreeIcon };

    switch (role) {
      case 'super_admin':
        // All revenue streams visible — Baggage airlines accessible via More
        return [home, cargo, gat, mkt, scan, more];
      case 'admin':
        return [home, cargo, gat, mkt, scan, more];
      case 'cargo_agent':
        return [home, cargo, gat, scan, more];
      case 'baggage_agent':
        // No assigned airline yet (e.g. a bulk-imported account awaiting
        // setup) -- omit the tab rather than link to a dead `Baggage:`
        // (empty name) that matches no configured airline.
        return user.assigned_airline ? [home, baggage, scan, more] : [home, scan, more];
      case 'marketing_agent':
        return [home, mkt, scan, more];
      case 'driver':
        return [home, trips, scan];
      case 'accountant':
        return [home, scan, more];
      case 'auditor':
        return [home, scan, more];
      case 'office_work':
        return [cargo, gat, mkt, scan, more];
      default:
        return [home, scan, more];
    }
  };

  const tabs = getTabsForRole(user.role);
  // GAT is a second physical Lagos counter, not a separate hub -- only
  // relevant to users actually stationed at the Lagos hub, regardless of
  // role.
  const finalTabs = userHubCode === 'LOS' ? tabs : tabs.filter((t) => t.id !== 'GAT');
  return <BottomNavTabs tabs={finalTabs} currentTab={currentTab} onChangeTab={onChangeTab} />;
};

type NavTab = { id: TabView; title: string; icon: any };

const BottomNavTabs = ({ tabs, currentTab, onChangeTab }: {
  tabs: NavTab[];
  currentTab: TabView;
  onChangeTab: (t: TabView) => void;
}) => {
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
