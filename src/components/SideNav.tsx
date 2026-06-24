import {
  LayoutDashboard, Package, TrendingUp, Plane, QrCode,
  MoreHorizontal, Truck, LogOut, Sun, Moon, Cpu, CreditCard
} from 'lucide-react';
import { User, TabView } from '../lib/types';
import { Theme } from '../lib/useTheme';

export const SideNav = ({
  user, currentTab, onChangeTab, onLogout, theme, onToggleTheme
}: {
  user: User;
  currentTab: TabView;
  onChangeTab: (t: TabView) => void;
  onLogout: () => void;
  theme: Theme;
  onToggleTheme: () => void;
}) => {
  const allTabs: {
    id: TabView; icon: any; label: string; roles: string[];
  }[] = [
    { id: 'Tower',     icon: LayoutDashboard,  label: 'Control Tower', roles: ['super_admin','admin','cargo_agent','vj_agent','accountant','auditor'] },
    { id: 'Cargo',     icon: Package,          label: 'Cargo Entry',   roles: ['super_admin','admin','cargo_agent'] },
    { id: 'Marketing', icon: TrendingUp,       label: 'Marketing',     roles: ['super_admin','admin','marketing_agent'] },
    { id: 'VJ POS',    icon: Plane,            label: 'ValueJet POS',  roles: ['super_admin','admin','vj_agent'] },
    { id: 'Scan',      icon: QrCode,           label: 'QR Scanner',    roles: ['super_admin','admin','cargo_agent','vj_agent','marketing_agent','driver'] },
    { id: 'MyTrips',   icon: Truck,            label: 'My Trips',      roles: ['driver'] },
    { id: 'IT Debug',  icon: Cpu,              label: 'IT Debug',      roles: ['super_admin','admin'] },
    { id: 'Credit & Debit', icon: CreditCard, label: 'Credit & Debit', roles: ['super_admin','admin', 'accountant'] },
    { id: 'More',      icon: MoreHorizontal,   label: 'More',          roles: ['super_admin','admin','accountant','auditor'] },
  ];

  const visibleTabs = allTabs.filter(t => t.roles.includes(user.role));

  const activeColor = 'var(--color-accent-amber)';

  return (
    <aside
      className="ehi-sidenav"
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: 'var(--sidebar-width)',
        background: 'var(--color-nav-bg, var(--color-obsidian))',
        borderRight: '1px solid var(--color-nav-border, var(--color-border))',
        flexShrink: 0,
        height: '100vh',
        overflowY: 'auto',
        overflowX: 'hidden',
        transition: 'width 0.2s ease',
      }}
    >
      {/* Brand */}
      <div style={{
        padding: '20px 12px 16px',
        borderBottom: '1px solid var(--color-border, var(--color-border))',
      }}>
        <div className="flex items-center lg:gap-3" style={{ minHeight: 40 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 9,
            background: 'rgba(245,158,11,0.12)',
            border: '1px solid rgba(245,158,11,0.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <span style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11, fontWeight: 800, color: '#F59E0B',
            }}>EHI</span>
          </div>
          <div className="ehi-sidebar-brand">
            <div style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11, fontWeight: 800,
              color: 'var(--color-foreground, #F1F5F9)',
              letterSpacing: '0.04em',
            }}>
              MULTISYSTEMS
            </div>
            <div style={{
              fontSize: 8, fontFamily: 'monospace',
              color: 'var(--color-muted, #64748B)',
              letterSpacing: '0.1em', textTransform: 'uppercase',
              marginTop: 1,
            }}>
              Logistics Platform
            </div>
          </div>
        </div>

        <div className="ehi-sidebar-brand" style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-foreground, #F1F5F9)' }}>
            {user.name}
          </div>
          <div style={{
            fontSize: 9, fontFamily: 'monospace',
            color: 'var(--color-accent-amber)',
            textTransform: 'uppercase', letterSpacing: '0.06em',
            marginTop: 2,
          }}>
            {user.hub}
          </div>
        </div>
      </div>

      <nav style={{ flex: 1, padding: '8px 0' }}>
        {visibleTabs.map(tab => {
          const Icon = tab.icon;
          const isActive = currentTab === tab.id;

          return (
            <button
              key={tab.id}
              onClick={() => onChangeTab(tab.id)}
              className={`group ${isActive ? '' : 'hover:bg-[rgba(255,255,255,0.02)]'}`}
              style={{
                width: '100%',
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '11px 14px',
                background: 'transparent',
                border: 'none',
                borderLeft: isActive
                  ? `2px solid ${activeColor}`
                  : '2px solid transparent',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                textAlign: 'left',
              }}
            >
              <div style={{ width: 20, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                <Icon
                  size={isActive ? 20 : 18}
                  strokeWidth={1.5}
                  style={{ flexShrink: 0, transition: 'all 0.15s ease' }}
                  className={isActive ? 'text-[var(--color-accent-amber)]' : 'text-[var(--color-muted)] group-hover:text-[var(--color-accent-amber)]'}
                />
              </div>
              <span
                className={`ehi-sidebar-text ${isActive ? 'text-[var(--color-accent-amber)]' : 'text-[var(--color-muted)] group-hover:text-[var(--color-accent-amber)]'} transition-colors`}
                style={{
                  fontSize: 13,
                  fontWeight: isActive ? 600 : 500,
                }}
              >
                {tab.label}
              </span>
            </button>
          );
        })}
      </nav>

      <div style={{
        padding: '12px 8px',
        borderTop: '1px solid var(--color-border, rgba(255,255,255,0.07))',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px'
      }}>
        <button
          onClick={onToggleTheme}
          className="group hover:bg-[var(--color-surface-2)] transition-colors"
          style={{
            width: '100%', padding: '9px 14px',
            background: 'transparent', border: 'none',
            display: 'flex', alignItems: 'center', gap: 12,
            cursor: 'pointer', borderRadius: 6,
          }}
        >
          {theme === 'dark' 
            ? <Sun size={18} strokeWidth={1.5} className="text-[var(--color-muted)] group-hover:text-[var(--color-accent-amber)] transition-colors" /> 
            : <Moon size={18} strokeWidth={1.5} className="text-[var(--color-muted)] group-hover:text-[var(--color-accent-amber)] transition-colors" />
          }
          <span
            className="ehi-sidebar-text text-left text-[var(--color-foreground)] group-hover:text-[var(--color-accent-amber)] transition-colors"
            style={{ fontSize: 12 }}
          >
            {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
          </span>
        </button>

        <button
          onClick={onLogout}
          className="group hover:bg-[var(--color-surface-2)] transition-colors"
          style={{
            width: '100%', padding: '9px 14px',
            background: 'transparent', border: 'none',
            display: 'flex', alignItems: 'center', gap: 12,
            cursor: 'pointer', borderRadius: 6,
          }}
        >
          <LogOut size={18} strokeWidth={1.5} className="text-[var(--color-muted)] group-hover:text-[var(--color-accent-amber)] transition-colors" />
          <span
            className="ehi-sidebar-text text-[var(--color-foreground)] group-hover:text-[var(--color-accent-amber)] transition-colors"
            style={{ fontSize: 12 }}
          >
            Sign Out
          </span>
        </button>
      </div>
    </aside>
  );
};
