import { User, TabView } from '../lib/types';
import { motion } from 'motion/react';
import { FiIcon } from './FiIcon';

export const BottomNav = ({ user, currentTab, onChangeTab }: { user: User; currentTab: TabView; onChangeTab: (t: TabView) => void }) => {
  const allTabs: { id: TabView; title: string, icon: string; accent: string; roles: string[] }[] = [
    { id: 'Tower', title: 'Home', icon: 'home', accent: 'white', roles: ['super_admin', 'admin', 'cargo_agent', 'vj_agent', 'accountant', 'auditor'] },
    { id: 'Cargo', title: 'Cargo', icon: 'box-alt', accent: 'var(--color-accent-amber)', roles: ['super_admin', 'admin', 'cargo_agent'] },
    { id: 'Marketing', title: 'Marketing', icon: 'chart-line-up', accent: 'var(--color-success)', roles: ['super_admin', 'admin', 'marketing_agent'] },
    { id: 'VJ POS', title: 'ValueJet', icon: 'plane', accent: 'var(--color-accent-cobalt)', roles: ['super_admin', 'admin', 'vj_agent'] },
    { id: 'Accounting', title: 'Accounting', icon: 'home', accent: 'var(--color-accent-cobalt)', roles: ['accountant', 'auditor'] },
    { id: 'MyTrips', title: 'My Trips', icon: 'truck-side', accent: 'white', roles: ['driver'] },
    { id: 'Scan', title: 'Scanner', icon: 'qr-scan', accent: 'var(--color-success)', roles: ['super_admin', 'admin', 'cargo_agent', 'vj_agent', 'marketing_agent', 'driver'] },
    { id: 'More', title: 'More', icon: 'apps', accent: 'white', roles: ['super_admin', 'admin', 'accountant', 'auditor'] },
  ];

  const visibleTabs = allTabs.filter(t => t.roles.includes(user.role));

  return (
    <div className="w-full h-[64px] bg-[var(--color-obsidian)] flex items-center justify-around border-t border-[rgba(255,255,255,0.07)] shrink-0 z-50">
      {visibleTabs.map(tab => {
        const isActive = currentTab === tab.id;
        
        return (
          <button
            key={tab.id}
            onClick={() => onChangeTab(tab.id)}
            className="flex-1 h-full flex flex-col items-center justify-center relative focus:outline-none"
          >
            {isActive && (
              <motion.div 
                layoutId="activeTabBorder"
                className="absolute bottom-0 left-[25%] right-[25%] h-[4px] z-[5] rounded-t-full shadow-[0_-2px_10px_rgba(255,255,255,0.2)]" 
                style={{ backgroundColor: tab.accent }} 
                transition={{ type: "spring", stiffness: 350, damping: 30 }}
              />
            )}
            <FiIcon 
              name={tab.icon}
              size={isActive ? 20 : 18}
              className="mb-1 transition-all"
              style={{ color: isActive ? tab.accent : 'var(--color-muted)' }}
            />
            <span 
              className="text-[11px] font-sans font-medium"
              style={{ color: isActive ? tab.accent : 'var(--color-muted)' }}
            >
              {tab.title}
            </span>
          </button>
        );
      })}
    </div>
  );
};

