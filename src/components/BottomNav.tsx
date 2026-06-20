import { LayoutDashboard, Package, Plane, QrCode, MoreHorizontal, Truck, TrendingUp } from 'lucide-react';
import { User, TabView } from '../lib/types';

export const BottomNav = ({ user, currentTab, onChangeTab }: { user: User; currentTab: TabView; onChangeTab: (t: TabView) => void }) => {
  const allTabs: { id: TabView; icon: any; accent: string; roles: string[] }[] = [
    { id: 'Tower', icon: LayoutDashboard, accent: 'white', roles: ['super_admin', 'admin', 'cargo_agent', 'vj_agent', 'accountant', 'auditor'] },
    { id: 'Cargo', icon: Package, accent: 'var(--color-accent-amber)', roles: ['super_admin', 'admin', 'cargo_agent'] },
    { id: 'Marketing', icon: TrendingUp, accent: 'var(--color-success)', roles: ['super_admin', 'admin', 'marketing_agent'] },
    { id: 'VJ POS', icon: Plane, accent: 'var(--color-accent-cobalt)', roles: ['super_admin', 'admin', 'vj_agent'] },
    { id: 'Accounting', icon: LayoutDashboard, accent: 'var(--color-accent-cobalt)', roles: ['accountant', 'auditor'] },
    { id: 'MyTrips', icon: Truck, accent: 'white', roles: ['driver'] },
    { id: 'Scan', icon: QrCode, accent: 'var(--color-success)', roles: ['super_admin', 'admin', 'cargo_agent', 'vj_agent', 'marketing_agent', 'driver'] },
    { id: 'More', icon: MoreHorizontal, accent: 'white', roles: ['super_admin', 'admin', 'accountant', 'auditor'] },
  ];

  const visibleTabs = allTabs.filter(t => t.roles.includes(user.role));

  return (
    <div className="w-full h-[60px] bg-[#0F1827] flex items-center justify-around border-t border-[rgba(255,255,255,0.07)] shrink-0 absolute bottom-0">
      {visibleTabs.map(tab => {
        const Icon = tab.icon;
        const isActive = currentTab === tab.id;
        
        return (
          <button
            key={tab.id}
            onClick={() => onChangeTab(tab.id)}
            className="flex-1 h-full flex flex-col items-center justify-center relative focus:outline-none"
          >
            {isActive && (
              <div 
                className="absolute top-0 left-0 right-0 h-[2px]" 
                style={{ backgroundColor: tab.accent }} 
              />
            )}
            <Icon 
              size={18} 
              color={isActive ? tab.accent : 'var(--color-muted)'} 
              className="mb-1"
            />
            <span 
              className="text-[9px] font-mono"
              style={{ color: isActive ? tab.accent : 'var(--color-muted)' }}
            >
              {tab.id}
            </span>
          </button>
        );
      })}
    </div>
  );
};
