import {
  LayoutDashboard, Package, TrendingUp, Plane, QrCode,
  MoreHorizontal, Truck, LogOut, Sun, Moon
} from 'lucide-react';
import { User, TabView } from '../lib/types';
import { Theme } from '../lib/useTheme';

type AccentType = 'neutral' | 'amber' | 'cobalt' | 'success';

const accentColor: Record<AccentType, string> = {
  neutral: 'var(--color-foreground)',
  amber: 'var(--color-accent-amber)',
  cobalt: 'var(--color-accent-cobalt)',
  success: 'var(--color-success)',
};

const accentBg: Record<AccentType, string> = {
  neutral: 'var(--color-surface-2)',
  amber: 'rgba(245,158,11,0.10)',
  cobalt: 'rgba(59,130,246,0.10)',
  success: 'rgba(16,185,129,0.10)',
};

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
    id: TabView; icon: any; label: string;
    accent: AccentType; roles: string[];
  }[] = [
    { id: 'Tower',     icon: LayoutDashboard,  label: 'Control Tower', accent: 'neutral', roles: ['super_admin','admin','cargo_agent','vj_agent','accountant','auditor'] },
    { id: 'Cargo',     icon: Package,          label: 'Cargo Entry',   accent: 'amber',   roles: ['super_admin','admin','cargo_agent'] },
    { id: 'Marketing', icon: TrendingUp,       label: 'Marketing',     accent: 'success', roles: ['super_admin','admin','marketing_agent'] },
    { id: 'VJ POS',    icon: Plane,            label: 'ValueJet POS',  accent: 'cobalt',  roles: ['super_admin','admin','vj_agent'] },
    { id: 'Scan',      icon: QrCode,           label: 'QR Scanner',    accent: 'success', roles: ['super_admin','admin','cargo_agent','vj_agent','marketing_agent','driver'] },
    { id: 'MyTrips',   icon: Truck,            label: 'My Trips',      accent: 'neutral', roles: ['driver'] },
    { id: 'More',      icon: MoreHorizontal,   label: 'More',          accent: 'neutral', roles: ['super_admin','admin','accountant','auditor'] },
  ];

  const visibleTabs = allTabs.filter(t => t.roles.includes(user.role));

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
          <div className="hidden lg:block">
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

        <div className="hidden lg:block" style={{ marginTop: 12 }}>
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
          const color = accentColor[tab.accent];

          return (
            <button
              key={tab.id}
              onClick={() => onChangeTab(tab.id)}
              style={{
                width: '100%',
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '11px 14px',
                background: isActive ? accentBg[tab.accent] : 'transparent',
                border: 'none',
                borderLeft: isActive
                  ? `2px solid ${color}`
                  : '2px solid transparent',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                textAlign: 'left',
              }}
            >
              <Icon
                size={18}
                color={isActive ? color : 'var(--color-muted)'}
                strokeWidth={isActive ? 2.5 : 1.5}
                style={{ flexShrink: 0 }}
              />
              <span
                className="hidden lg:block"
                style={{
                  fontSize: 12,
                  fontWeight: isActive ? 700 : 400,
                  color: isActive ? color : 'var(--color-light-muted)',
                  whiteSpace: 'nowrap',
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
          className="hover:bg-[var(--color-surface-2)] transition-colors"
          style={{
            width: '100%', padding: '9px 14px',
            background: 'transparent', border: 'none',
            display: 'flex', alignItems: 'center', gap: 12,
            cursor: 'pointer', borderRadius: 6,
          }}
        >
          {theme === 'dark' ? <Sun size={17} color="var(--color-light-muted)" /> : <Moon size={17} color="var(--color-light-muted)" />}
          <span
            className="hidden lg:block text-left"
            style={{ fontSize: 12, color: 'var(--color-foreground)' }}
          >
            {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
          </span>
        </button>

        <button
          onClick={onLogout}
          className="hover:bg-[rgba(239,68,68,0.1)] transition-colors"
          style={{
            width: '100%', padding: '9px 14px',
            background: 'transparent', border: 'none',
            display: 'flex', alignItems: 'center', gap: 12,
            cursor: 'pointer', borderRadius: 6,
          }}
        >
          <LogOut size={17} color="var(--color-error)" />
          <span
            className="hidden lg:block"
            style={{ fontSize: 12, color: 'var(--color-error)' }}
          >
            Sign Out
          </span>
        </button>
      </div>
    </aside>
  );
};
