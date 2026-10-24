import {
  Wifi,
  WifiOff,
  LogOut,
  Sun,
  Moon,
  ChevronDown,
  RefreshCw,
  Building2,
  LayoutDashboard,
  BookOpen,
  HandCoins,
  Wallet,
  Radar,
  QrCode,
  ShieldCheck,
} from 'lucide-react';
import { User } from '../lib/types';
import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Theme } from '../lib/useTheme';
import { getHubCode } from '../lib/helpers';
import { useConfirm } from '../lib/ConfirmContext';
import { canAccessTab } from '../lib/permissions';

import ehiLogo from '../assets/branding/ehi-logo.png';

export const Header = ({
  user,
  isOffline,
  pendingCount,
  onToggleWifi,
  onLogout,
  theme,
  onToggleTheme,
  onManualSync,
  stateWideView,
  onToggleStateWideView,
  docked = false,
  onCloseOverlay,
}: {
  user: User;
  isOffline: boolean;
  pendingCount: number;
  onToggleWifi: () => void;
  onLogout: () => void;
  theme: Theme;
  onToggleTheme: () => void;
  onManualSync?: () => void;
  // Own-hub vs state-wide (own hub + sibling hubs, e.g. Lagos HQ + Lagos
  // Cargo) ledger scope. undefined when the user has no sibling hubs or is
  // an admin role that already sees every hub -- the toggle has nothing to
  // offer either way, so it's left out of the menu entirely.
  stateWideView?: boolean;
  onToggleStateWideView?: () => void;
  // Desktop shell uses a sticky full-width top bar (.ehi-header-row) with
  // controls in-flow. The Master Ledger stream overlay portals a full-screen
  // layer that needs its own header row -- `docked` keeps the same controls
  // inline there without relying on the shell sticky bar.
  docked?: boolean;
  onCloseOverlay?: () => void;
}) => {
  const [showDropdown, setShowDropdown] = useState(false);
  const confirm = useConfirm();
  const navigate = useNavigate();
  const location = useLocation();

  const quickNavItems = useMemo(() => {
    const candidates = [
      {
        id: 'tower',
        label: 'Overview',
        path: '/tower',
        perm: 'Tower',
        icon: LayoutDashboard,
      },
      {
        id: 'ledger',
        label: 'Master Ledger',
        path: '/more/ledger',
        perm: 'More:TransactionLedger',
        icon: BookOpen,
      },
      {
        id: 'debt',
        label: 'Debt & Retrievals',
        path: '/more/debt-collection-log',
        perm: 'More:DebtCollectionLog',
        icon: HandCoins,
      },
      {
        id: 'wallets',
        label: 'Wallets',
        path: '/more/customer-wallets',
        perm: 'More:CustomerWallets',
        icon: Wallet,
      },
      {
        id: 'radar',
        label: 'Flight Radar',
        path: '/flight-radar',
        perm: 'FlightRadar',
        icon: Radar,
      },
      {
        id: 'scan',
        label: 'QR Scanner',
        path: '/scan',
        perm: 'Scan',
        icon: QrCode,
      },
      {
        id: 'pod',
        label: 'POD Log',
        path: '/more/pod-log',
        perm: 'More:PODLog',
        icon: ShieldCheck,
      },
    ];
    return candidates.filter((item) => canAccessTab(user, item.perm, []));
  }, [user]);

  const getRoleDisplay = (role: string) => {
    switch (role) {
      case 'cargo_agent': return 'Cargo Agent';
      case 'baggage_agent': return user.assigned_airline ? `${user.assigned_airline} POS` : 'Baggage POS';
      case 'marketing_agent': return 'Marketing';
      case 'super_admin': return 'Super Admin';
      case 'admin': return 'Admin';
      case 'accountant': return 'Accountant';
      case 'auditor': return 'Auditor';
      case 'driver': return 'Driver';
      default: return 'Agent';
    }
  };

  const getRoleColor = (role: string): { bg: string; border: string; text: string } => {
    switch (role) {
      case 'super_admin': return { bg: 'rgba(251,191,36,0.12)', border: 'rgba(251,191,36,0.3)', text: 'var(--color-accent-amber)' };
      case 'admin': return { bg: 'rgba(59,130,246,0.12)', border: 'rgba(59,130,246,0.3)', text: 'var(--color-accent-cobalt)' };
      case 'cargo_agent': return { bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.3)', text: 'var(--color-success)' };
      case 'baggage_agent': return { bg: 'rgba(139,92,246,0.12)', border: 'rgba(139,92,246,0.3)', text: 'var(--color-purple)' };
      case 'accountant': return { bg: 'rgba(20,184,166,0.12)', border: 'rgba(20,184,166,0.3)', text: '#14b8a6' };
      case 'auditor': return { bg: 'rgba(249,115,22,0.12)', border: 'rgba(249,115,22,0.3)', text: '#f97316' };
      case 'driver': return { bg: 'rgba(100,116,139,0.12)', border: 'rgba(100,116,139,0.3)', text: '#64748b' };
      case 'marketing_agent': return { bg: 'rgba(16,185,129,0.10)', border: 'rgba(16,185,129,0.25)', text: 'var(--color-success)' };
      default: return { bg: 'rgba(251,191,36,0.12)', border: 'rgba(251,191,36,0.2)', text: 'var(--color-accent-amber)' };
    }
  };

  return (
    <div
      className="flex flex-col w-full shrink-0 z-40 relative"
    >
      <div
        className="ehi-header-row flex items-center justify-between gap-3 px-4 py-2.5 min-h-[56px] flex-wrap"
        style={{
          background: 'var(--color-nav-bg)',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        {/* Left & Center Navigation Area */}
        <div className="flex items-center gap-2.5 min-w-0 flex-wrap">
          {/* Brand -- the real logo asset (same file SideNav uses on desktop) */}
          <div className="flex items-center gap-2.5 ehi-header-brand shrink-0">
            <img
              src={ehiLogo}
              alt="EHI Multisystems"
              className="rounded-xl shadow-sm"
              style={{ height: 36, width: 'auto', objectFit: 'contain' }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
            <div>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                background: getRoleColor(user.role).bg,
                border: `1px solid ${getRoleColor(user.role).border}`,
                borderRadius: 'var(--radius-full)',
                padding: '1px 8px', marginTop: 2,
              }}>
                <span style={{ fontSize: 10, fontWeight: 600, color: getRoleColor(user.role).text }}>
                  {getRoleDisplay(user.role)}
                </span>
              </div>
            </div>
          </div>

          {/* Dynamic Slot for Ledger Left Controls (Back button + Title & Entry count) */}
          <div
            data-ehi-header-left-slot
            className="flex items-center gap-2.5 min-w-0 empty:hidden"
          />

          {/* Progressive-Disclosure Quick Navigation Rail */}
          {quickNavItems.length > 0 && (
            <nav
              aria-label="Quick Navigation"
              className="hidden md:flex items-center gap-1 p-1 rounded-full bg-[var(--color-surface-1)] border border-[var(--color-border)] shadow-inner"
            >
              {quickNavItems.map((item) => {
                const Icon = item.icon;
                const isActive =
                  !docked &&
                  (location.pathname === item.path ||
                    location.pathname.startsWith(item.path + '/'));
                return (
                  <button
                    key={item.id}
                    type="button"
                    title={item.label}
                    onClick={() => {
                      if (onCloseOverlay) onCloseOverlay();
                      navigate(item.path);
                    }}
                    className={`group relative h-7 px-2.5 rounded-full flex items-center justify-center transition-all duration-300 ease-out cursor-pointer select-none ${
                      isActive
                        ? 'bg-[rgba(251,191,36,0.16)] text-[var(--color-accent-amber)] border border-[rgba(251,191,36,0.38)] shadow-sm'
                        : 'text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-surface-hover)] border border-transparent'
                    }`}
                  >
                    <Icon
                      size={13}
                      strokeWidth={isActive ? 2.2 : 1.8}
                      className="shrink-0 transition-transform duration-200 group-hover:scale-110"
                    />
                    <span
                      className={`font-mono text-[10px] font-bold tracking-tight whitespace-nowrap overflow-hidden transition-all duration-300 ease-out ${
                        isActive
                          ? 'max-w-[140px] opacity-100 ml-1.5'
                          : 'max-w-0 opacity-0 ml-0 group-hover:max-w-[140px] group-hover:opacity-100 group-hover:ml-1.5 group-focus-visible:max-w-[140px] group-focus-visible:opacity-100 group-focus-visible:ml-1.5'
                      }`}
                    >
                      {item.label}
                    </span>
                  </button>
                );
              })}
            </nav>
          )}
        </div>

        {/* Right controls -- sit in the sticky top bar on desktop
            (.ehi-header-controls is in-flow; see index.css). */}
        <div className="ehi-header-controls flex items-center gap-2 ml-auto flex-wrap justify-end">
          {/* Dynamic Slot for Ledger Secondary Navigation Controls (Filters, Export, Debt Log, 80mm, Manifest) */}
          <div
            data-ehi-header-right-slot
            className="flex items-center gap-1.5 flex-wrap justify-end empty:hidden pr-1 border-r border-[var(--color-border)]"
          />

          {/* Theme toggle — Frosted Glass Lens Orb */}
          <button
            onClick={onToggleTheme}
            className="group relative transition-all duration-200 hover:scale-105 active:scale-95 active:translate-y-0.5 cursor-pointer shrink-0"
            title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            style={{
              width: 32, height: 32,
              borderRadius: 'var(--radius-full)',
              // Light nav bar is near-white -- a white frosted orb with a white
              // border vanished on it, so light mode gets a tinted fill + a dark
              // hairline. Dark mode keeps the original white-glass look.
              background: theme === 'dark'
                ? 'radial-gradient(circle at 40% 35%, rgba(255,255,255,0.30) 0%, rgba(255,255,255,0.08) 60%, rgba(100,110,130,0.18) 100%)'
                : 'radial-gradient(circle at 40% 35%, rgba(255,255,255,0.95) 0%, rgba(226,232,240,0.75) 60%, rgba(148,163,184,0.45) 100%)',
              border: theme === 'dark'
                ? '1px solid rgba(255,255,255,0.40)'
                : '1px solid rgba(15,23,42,0.18)',
              boxShadow: theme === 'dark'
                ? '0 3px 9px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(255,255,255,0.2)'
                : '0 3px 9px rgba(0,0,0,0.12), inset 0 0 0 1px rgba(255,255,255,0.6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              position: 'relative', overflow: 'hidden', backdropFilter: 'blur(8px)',
            }}
          >
            {/* Radiant Glowing Inner Core */}
            <div
              className="transition-all duration-300 group-hover:scale-110"
              style={{
                position: 'absolute', width: 19, height: 19, borderRadius: '50%',
                background: theme === 'dark'
                  ? 'radial-gradient(circle at 40% 35%, #fde68a 0%, #fbbf24 60%, #b45309 100%)'
                  : 'radial-gradient(circle at 40% 35%, #60a5fa 0%, #3b82f6 60%, #1d4ed8 100%)',
                boxShadow: theme === 'dark' ? '0 0 9px rgba(251,191,36,0.7)' : '0 0 9px rgba(59,130,246,0.7)',
              }}
            />
            {/* Top specular lens highlight */}
            <div style={{
              position: 'absolute', top: '10%', left: '18%',
              width: '50%', height: '26%',
              background: 'radial-gradient(ellipse, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0) 100%)',
              borderRadius: '50%', filter: 'blur(0.4px)', pointerEvents: 'none',
            }} />
            {theme === 'dark'
              ? <Sun size={13} strokeWidth={2} style={{ color: '#451a03', position: 'relative', zIndex: 1 }} className="group-hover:rotate-45 transition-transform duration-300" />
              : <Moon size={13} strokeWidth={2} style={{ color: '#ffffff', position: 'relative', zIndex: 1 }} className="group-hover:-rotate-12 transition-transform duration-300" />
            }
          </button>

          {/* Pending Sync Badge */}
          {pendingCount > 0 && (
            <button
              onClick={() => {
                if (onManualSync) onManualSync();
              }}
              title="Click to force sync offline entries"
              className="px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 bg-[rgba(251,191,36,0.15)] border border-[rgba(251,191,36,0.35)] text-[var(--color-accent-amber)] font-mono text-[10px] font-bold animate-pulse cursor-pointer hover:bg-[rgba(251,191,36,0.30)] hover:scale-105 active:scale-95 transition-all shadow-md shrink-0"
            >
              <RefreshCw size={11} className="animate-spin" />
              <span>{pendingCount} Queued</span>
            </button>
          )}

          {/* Wifi — Frosted Glass Lens Orb */}
          <button
            onClick={async () => {
              if (!isOffline) {
                const ok = await confirm({
                  title: 'Switch to Offline Mode?',
                  message: 'Live network sync will pause and new entries will queue locally on this device until you reconnect.',
                  confirmLabel: 'Switch Offline',
                  tone: 'danger',
                });
                if (!ok) return;
              }
              onToggleWifi();
            }}
            title={isOffline ? 'Offline Mode Active — Tap to Reconnect' : 'Network Online — Tap to Switch to Offline Mode'}
            className="group relative transition-all duration-200 hover:scale-105 active:scale-95 active:translate-y-0.5 cursor-pointer shrink-0"
            style={{
              width: 32, height: 32,
              borderRadius: 'var(--radius-full)',
              background: theme === 'dark'
                ? 'radial-gradient(circle at 40% 35%, rgba(255,255,255,0.30) 0%, rgba(255,255,255,0.08) 60%, rgba(100,110,130,0.18) 100%)'
                : 'radial-gradient(circle at 40% 35%, rgba(255,255,255,0.95) 0%, rgba(226,232,240,0.75) 60%, rgba(148,163,184,0.45) 100%)',
              border: isOffline
                ? '1px solid rgba(239,68,68,0.55)'
                : theme === 'dark' ? '1px solid rgba(255,255,255,0.40)' : '1px solid rgba(15,23,42,0.18)',
              boxShadow: isOffline
                ? '0 3px 11px rgba(239,68,68,0.45), inset 0 0 0 1px rgba(255,255,255,0.2)'
                : '0 3px 9px rgba(0,0,0,0.4), inset 0 0 0 1px rgba(255,255,255,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              position: 'relative', overflow: 'hidden', backdropFilter: 'blur(8px)',
            }}
          >
            {/* Inner Glowing Core */}
            <div
              className="transition-all duration-300 group-hover:scale-110"
              style={{
                position: 'absolute', width: 19, height: 19, borderRadius: '50%',
                background: isOffline
                  ? 'radial-gradient(circle at 40% 35%, #fca5a5 0%, #ef4444 60%, #991b1b 100%)'
                  : 'radial-gradient(circle at 40% 35%, #86efac 0%, #22c55e 60%, #15803d 100%)',
                boxShadow: isOffline ? '0 0 9px rgba(239,68,68,0.7)' : '0 0 9px rgba(34,197,94,0.7)',
              }}
            />
            {/* Top specular lens highlight */}
            <div style={{
              position: 'absolute', top: '10%', left: '18%',
              width: '50%', height: '26%',
              background: 'radial-gradient(ellipse, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0) 100%)',
              borderRadius: '50%', filter: 'blur(0.4px)', pointerEvents: 'none',
            }} />
            {isOffline
              ? <WifiOff size={12} strokeWidth={2.5} style={{ color: '#ffffff', position: 'relative', zIndex: 1 }} className="group-hover:scale-110 transition-transform duration-200" />
              : <Wifi size={12} strokeWidth={2.5} style={{ color: '#052e16', position: 'relative', zIndex: 1 }} className="group-hover:scale-110 transition-transform duration-200" />
            }
          </button>

          {/* User Logo / Avatar Icon with Progressive Disclosure that Expands on Hover */}
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setShowDropdown(!showDropdown)}
              title={`${user.name} (${getRoleDisplay(user.role)} · ${getHubCode(user.hub)})`}
              className="group relative h-8 p-1 rounded-full flex items-center transition-all duration-300 ease-out active:scale-95 cursor-pointer select-none"
              style={{
                background: theme === 'dark'
                  ? 'linear-gradient(135deg, rgba(255,255,255,0.14) 0%, rgba(251,191,36,0.12) 100%)'
                  : 'linear-gradient(135deg, rgba(255,255,255,0.95) 0%, rgba(254,243,199,0.75) 100%)',
                border: showDropdown
                  ? '1.5px solid rgba(251,191,36,0.9)'
                  : theme === 'dark' ? '1px solid rgba(255,255,255,0.28)' : '1px solid rgba(180,83,9,0.3)',
                boxShadow: showDropdown
                  ? '0 0 0 3px rgba(251,191,36,0.25), 0 4px 12px rgba(251,191,36,0.4)'
                  : '0 2px 8px rgba(0,0,0,0.18), inset 0 0 0 1px rgba(255,255,255,0.2)',
                backdropFilter: 'blur(8px)',
              }}
            >
              {/* Frosted Amber Glass Orb */}
              <div
                className="relative w-6 h-6 rounded-full flex items-center justify-center shrink-0 overflow-hidden transition-transform duration-300 group-hover:scale-105"
                style={{
                  background: 'radial-gradient(circle at 40% 35%, #fde68a 0%, #fbbf24 60%, #b45309 100%)',
                  boxShadow: '0 0 10px rgba(251,191,36,0.75)',
                }}
              >
                {/* Top specular lens highlight */}
                <div style={{
                  position: 'absolute', top: '10%', left: '18%',
                  width: '50%', height: '26%',
                  background: 'radial-gradient(ellipse, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0) 100%)',
                  borderRadius: '50%', filter: 'blur(0.4px)', pointerEvents: 'none',
                }} />
                <span style={{ fontSize: 11, fontWeight: 800, color: '#451a03', position: 'relative', zIndex: 1 }}>
                  {user.name.charAt(0).toUpperCase()}
                </span>
              </div>

              {/* Progressive Disclosure User Details (Expands on Hover or Dropdown Open) */}
              <div
                className={`flex items-center overflow-hidden whitespace-nowrap transition-all duration-300 ease-out ${
                  showDropdown
                    ? 'max-w-[200px] opacity-100 pl-2 pr-1.5'
                    : 'max-w-0 opacity-0 pl-0 pr-0 group-hover:max-w-[200px] group-hover:opacity-100 group-hover:pl-2 group-hover:pr-1.5 group-focus-visible:max-w-[200px] group-focus-visible:opacity-100 group-focus-visible:pl-2 group-focus-visible:pr-1.5'
                }`}
              >
                <div className="text-left leading-tight mr-1.5">
                  <div className="text-[11px] font-bold text-[var(--color-foreground)] truncate max-w-[130px]">
                    {user.name}
                  </div>
                  <div className="flex items-center gap-1 text-[9px] font-mono text-[var(--color-muted)]">
                    <span style={{ color: getRoleColor(user.role).text, fontWeight: 700 }}>
                      {getRoleDisplay(user.role)}
                    </span>
                    <span>·</span>
                    <span>{getHubCode(user.hub)}</span>
                  </div>
                </div>
                <ChevronDown
                  size={12}
                  className={`text-[var(--color-muted)] shrink-0 transition-transform duration-200 ${
                    showDropdown ? 'rotate-180 text-[var(--color-accent-amber)]' : ''
                  }`}
                />
              </div>
            </button>

            {showDropdown && (
              <>
                {/* Invisible full-viewport click-outside-to-close catcher --
                    portaled to document.body so it always covers the TRUE
                    viewport regardless of any ancestor CSS (transform/
                    filter/will-change) that would otherwise make some
                    ancestor a containing block for this position:fixed div,
                    silently shrinking it to that ancestor's own bounds and
                    breaking click-outside detection with no visual sign
                    anything's wrong. The visible dropdown menu below is
                    left as-is -- it's position:absolute, anchored to its
                    own position:relative parent, which this bug class
                    doesn't affect. */}
                {createPortal(
                  <div className="fixed inset-0 z-10" onClick={() => setShowDropdown(false)} />,
                  document.body
                )}
                <div
                  style={{
                    position: 'absolute', right: 0, top: 36, width: 200,
                    background: 'var(--color-surface-1)',
                    border: '1px solid var(--color-border-strong)',
                    borderRadius: 'var(--radius-md)',
                    boxShadow: 'var(--shadow-dropdown)',
                    zIndex: 20, overflow: 'hidden',
                  }}
                >
                  <div style={{
                    padding: '12px 14px',
                    borderBottom: '1px solid var(--color-border)',
                    background: 'linear-gradient(135deg, rgba(251,191,36,0.06) 0%, transparent 100%)',
                  }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-foreground)' }}>
                      {user.name}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--color-accent-amber)', marginTop: 2 }}>
                      {getHubCode(user.hub)}
                    </div>
                  </div>
                  {onToggleStateWideView && (
                    <button
                      onClick={() => { onToggleStateWideView(); setShowDropdown(false); }}
                      className="group hover:bg-[rgba(59,130,246,0.06)] transition-colors"
                      style={{
                        width: '100%', padding: '12px 14px',
                        background: 'transparent', border: 'none',
                        borderBottom: '1px solid var(--color-border)',
                        display: 'flex', alignItems: 'center', gap: 10,
                        cursor: 'pointer', textAlign: 'left',
                      }}
                      title={stateWideView ? 'Showing your hub + sibling hubs in your state. Click to scope to your own hub only.' : 'Showing only your own hub. Click to include sibling hubs in your state.'}
                    >
                      <Building2 size={18} strokeWidth={1.5} className="text-[var(--color-accent-cobalt)] shrink-0" />
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-foreground)' }}>
                          {stateWideView ? 'State-wide view' : 'My hub only'}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--color-muted)', marginTop: 1 }}>
                          {stateWideView ? 'Tap to scope to your own hub' : 'Tap to include sibling hubs'}
                        </div>
                      </div>
                    </button>
                  )}
                  <button
                    onClick={() => { setShowDropdown(false); onLogout(); }}
                    className="group hover:bg-[rgba(239,68,68,0.05)] transition-colors"
                    style={{
                      width: '100%', padding: '12px 14px',
                      background: 'transparent', border: 'none',
                      display: 'flex', alignItems: 'center', gap: 10,
                      cursor: 'pointer', color: 'var(--color-error)',
                    }}
                  >
                    <LogOut size={18} strokeWidth={1.5} className="text-[var(--color-error)] shrink-0" />
                    <span className="text-[var(--color-error)]" style={{ fontSize: 13, fontWeight: 500 }}>Sign Out</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Offline banner */}
      <AnimatePresence>
        {isOffline && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            style={{
              background: 'rgba(239,68,68,0.1)',
              borderTop: '1px solid rgba(239,68,68,0.2)',
              color: 'var(--color-error)',
              fontSize: 11, fontWeight: 600,
              textAlign: 'center', padding: '6px 16px',
              display: 'flex', alignItems: 'center',
              justifyContent: 'center', gap: 6,
            }}
          >
            <WifiOff size={12} className="text-[var(--color-error)] opacity-80" />
            Offline — entries queued for sync
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

