import { User, TabView } from '../lib/types';
import { motion } from 'motion/react';
import { FiIcon } from './FiIcon';

export const BottomNav = ({ user, currentTab, onChangeTab }: { user: User; currentTab: TabView; onChangeTab: (t: TabView) => void }) => {
  const allTabs: { id: TabView; title: string, icon: string; roles: string[] }[] = [
    { id: 'Tower', title: 'Home', icon: 'home', roles: ['super_admin', 'admin', 'cargo_agent', 'vj_agent', 'accountant', 'auditor'] },
    { id: 'Cargo', title: 'Cargo', icon: 'box-alt', roles: ['super_admin', 'admin', 'cargo_agent'] },
    { id: 'Marketing', title: 'Marketing', icon: 'chart-line-up', roles: ['super_admin', 'admin', 'marketing_agent'] },
    { id: 'VJ POS', title: 'ValueJet', icon: 'plane', roles: ['super_admin', 'admin', 'vj_agent'] },
    { id: 'MyTrips', title: 'My Trips', icon: 'truck-side', roles: ['driver'] },
    { id: 'Scan', title: 'Scanner', icon: 'qr-scan', roles: ['super_admin', 'admin', 'cargo_agent', 'vj_agent', 'marketing_agent', 'driver'] },
    { id: 'IT Debug', title: 'IT Debug', icon: 'bug', roles: ['super_admin', 'admin'] },
    { id: 'More', title: 'More', icon: 'apps', roles: ['super_admin', 'admin', 'accountant', 'auditor'] },
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
        return (
          <button
            key={tab.id}
            onClick={() => onChangeTab(tab.id)}
            className="flex-1 h-full flex flex-col items-center justify-center relative gap-0.5 transition-colors hover:text-[var(--color-accent-amber)]"
            style={{ background: 'none', border: 'none', cursor: 'pointer' }}
          >
            {/* Active pill background on icon */}
            {isActive && (
              <motion.div
                layoutId="nav-pill"
                style={{
                  position: 'absolute',
                  top: 10,
                  width: 44, height: 28,
                  borderRadius: 'var(--radius-full)',
                  background: `color-mix(in srgb, ${activeColor} 20%, transparent)`,
                  border: `1px solid color-mix(in srgb, ${activeColor} 30%, transparent)`,
                }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              />
            )}
            <FiIcon
              name={tab.icon}
              size={isActive ? 20 : 18}
              style={{
                color: isActive ? activeColor : 'var(--color-muted)',
                transition: 'all 0.2s',
                position: 'relative', zIndex: 1,
              }}
              className={isActive ? '' : 'hover:text-[var(--color-accent-amber)]'}
            />
            <span
              style={{
                fontSize: 10, fontWeight: isActive ? 700 : 500,
                color: isActive ? activeColor : 'var(--color-muted)',
                transition: 'all 0.2s',
              }}
              className={isActive ? '' : 'hover:text-[var(--color-accent-amber)]'}
            >
              {tab.title}
            </span>
          </button>
        );
      })}
    </div>
  );
};

