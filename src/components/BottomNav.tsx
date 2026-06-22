import { User, TabView } from '../lib/types';
import { motion } from 'motion/react';
import { FiIcon } from './FiIcon';

export const BottomNav = ({ user, currentTab, onChangeTab }: { user: User; currentTab: TabView; onChangeTab: (t: TabView) => void }) => {
  const allTabs: { id: TabView; title: string, icon: string; accent: string; roles: string[] }[] = [
    { id: 'Tower', title: 'Home', icon: 'home', accent: 'var(--color-foreground)', roles: ['super_admin', 'admin', 'cargo_agent', 'vj_agent', 'accountant', 'auditor'] },
    { id: 'Cargo', title: 'Cargo', icon: 'box-alt', accent: 'var(--color-accent-amber)', roles: ['super_admin', 'admin', 'cargo_agent'] },
    { id: 'Marketing', title: 'Marketing', icon: 'chart-line-up', accent: 'var(--color-success)', roles: ['super_admin', 'admin', 'marketing_agent'] },
    { id: 'VJ POS', title: 'ValueJet', icon: 'plane', accent: 'var(--color-accent-cobalt)', roles: ['super_admin', 'admin', 'vj_agent'] },
    { id: 'MyTrips', title: 'My Trips', icon: 'truck-side', accent: 'var(--color-foreground)', roles: ['driver'] },
    { id: 'Scan', title: 'Scanner', icon: 'qr-scan', accent: 'var(--color-success)', roles: ['super_admin', 'admin', 'cargo_agent', 'vj_agent', 'marketing_agent', 'driver'] },
    { id: 'More', title: 'More', icon: 'apps', accent: 'var(--color-foreground)', roles: ['super_admin', 'admin', 'accountant', 'auditor'] },
  ];

  const visibleTabs = allTabs.filter(t => t.roles.includes(user.role));

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
            className="flex-1 h-full flex flex-col items-center justify-center relative gap-0.5"
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
                  background: tab.accent === 'white'
                    ? 'rgba(255,255,255,0.10)'
                    : `color-mix(in srgb, ${tab.accent} 20%, transparent)`,
                  border: tab.accent === 'white'
                    ? '1px solid rgba(255,255,255,0.12)'
                    : `1px solid color-mix(in srgb, ${tab.accent} 30%, transparent)`,
                }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              />
            )}
            <FiIcon
              name={tab.icon}
              size={isActive ? 20 : 18}
              style={{
                color: isActive ? tab.accent : 'var(--color-muted)',
                transition: 'all 0.2s',
                position: 'relative', zIndex: 1,
              }}
            />
            <span
              style={{
                fontSize: 10, fontWeight: isActive ? 700 : 500,
                color: isActive ? tab.accent : 'var(--color-muted)',
                transition: 'all 0.2s',
              }}
            >
              {tab.title}
            </span>
          </button>
        );
      })}
    </div>
  );
};

