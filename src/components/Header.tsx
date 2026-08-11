import { Wifi, WifiOff, LogOut, Sun, Moon, ChevronDown, RefreshCw, Building2 } from 'lucide-react';
import { User } from '../lib/types';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Theme } from '../lib/useTheme';
import { getHubCode } from '../lib/helpers';

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
}) => {
  const [showDropdown, setShowDropdown] = useState(false);

  const getRoleDisplay = (role: string) => {
    switch(role) {
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
    switch(role) {
      case 'super_admin': return { bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.3)', text: 'var(--color-accent-amber)' };
      case 'admin':       return { bg: 'rgba(59,130,246,0.12)', border: 'rgba(59,130,246,0.3)', text: 'var(--color-accent-cobalt)' };
      case 'cargo_agent': return { bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.3)', text: 'var(--color-success)' };
      case 'baggage_agent': return { bg: 'rgba(139,92,246,0.12)', border: 'rgba(139,92,246,0.3)', text: 'var(--color-purple)' };
      case 'accountant':  return { bg: 'rgba(20,184,166,0.12)', border: 'rgba(20,184,166,0.3)', text: '#14b8a6' };
      case 'auditor':     return { bg: 'rgba(249,115,22,0.12)', border: 'rgba(249,115,22,0.3)', text: '#f97316' };
      case 'driver':      return { bg: 'rgba(100,116,139,0.12)', border: 'rgba(100,116,139,0.3)', text: '#64748b' };
      case 'marketing_agent': return { bg: 'rgba(16,185,129,0.10)', border: 'rgba(16,185,129,0.25)', text: 'var(--color-success)' };
      default:            return { bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.2)', text: 'var(--color-accent-amber)' };
    }
  };

  return (
    <div
      className="flex flex-col w-full shrink-0 z-40 relative"
    >
      <div
        className="ehi-header-row flex items-center justify-between px-4 py-3 min-h-[60px]"
        style={{
          background: 'var(--color-nav-bg)',
          borderBottom: '1px solid var(--color-border)',
        }}
      >

        {/* Brand -- the real logo asset (same file SideNav uses on desktop) */}
        <div className="flex items-center gap-2.5 ehi-header-brand">
          <img
            src={ehiLogo}
            alt="EHI Multisystems"
            style={{ height: 40, width: 'auto', objectFit: 'contain' }}
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

        {/* Right controls -- ehi-header-controls floats this cluster as a
            fixed overlay on desktop (see index.css), matching SideNav's
            floating treatment instead of sitting in the header's flow. */}
        <div className="ehi-header-controls flex items-center gap-1.5 ml-auto">

          {/* User info */}
          <div className="text-right mr-0.5 hidden sm:block">
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-foreground)' }}>
              {user.name}
            </div>
            <div style={{ fontSize: 9, color: 'var(--color-muted)' }}>
              {getHubCode(user.hub)}
            </div>
          </div>

          {/* Theme toggle — Frosted Glass Lens Orb */}
          <button
            onClick={onToggleTheme}
            className="group relative transition-all duration-200 hover:scale-105 active:scale-95 active:translate-y-0.5 cursor-pointer"
            title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            style={{
              width: 28, height: 28,
              borderRadius: 'var(--radius-full)',
              background: 'radial-gradient(circle at 40% 35%, rgba(255,255,255,0.30) 0%, rgba(255,255,255,0.08) 60%, rgba(100,110,130,0.18) 100%)',
              border: '1px solid rgba(255,255,255,0.40)',
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
                position: 'absolute', width: 17, height: 17, borderRadius: '50%',
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
              ? <Sun size={12} strokeWidth={2} style={{ color: '#451a03', position: 'relative', zIndex: 1 }} className="group-hover:rotate-45 transition-transform duration-300" />
              : <Moon size={12} strokeWidth={2} style={{ color: '#ffffff', position: 'relative', zIndex: 1 }} className="group-hover:-rotate-12 transition-transform duration-300" />
            }
          </button>

          {/* Pending Sync Badge */}
          {pendingCount > 0 && (
            <button
              onClick={() => {
                if (onManualSync) onManualSync();
              }}
              title="Click to force sync offline entries"
              className="px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 bg-[rgba(245,158,11,0.15)] border border-[rgba(245,158,11,0.35)] text-[var(--color-accent-amber)] font-mono text-[10px] font-bold animate-pulse cursor-pointer hover:bg-[rgba(245,158,11,0.30)] hover:scale-105 active:scale-95 transition-all shadow-md"
            >
              <RefreshCw size={11} className="animate-spin" />
              <span>{pendingCount} Queued</span>
            </button>
          )}

          {/* Wifi — Frosted Glass Lens Orb */}
          <button
            onClick={onToggleWifi}
            className="group relative transition-all duration-200 hover:scale-105 active:scale-95 active:translate-y-0.5 cursor-pointer"
            style={{
              width: 28, height: 28,
              borderRadius: 'var(--radius-full)',
              background: 'radial-gradient(circle at 40% 35%, rgba(255,255,255,0.30) 0%, rgba(255,255,255,0.08) 60%, rgba(100,110,130,0.18) 100%)',
              border: isOffline ? '1px solid rgba(239,68,68,0.55)' : '1px solid rgba(255,255,255,0.40)',
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
                position: 'absolute', width: 17, height: 17, borderRadius: '50%',
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
              ? <WifiOff size={11} strokeWidth={2.5} style={{ color: '#ffffff', position: 'relative', zIndex: 1 }} className="group-hover:scale-110 transition-transform duration-200" />
              : <Wifi size={11} strokeWidth={2.5} style={{ color: '#052e16', position: 'relative', zIndex: 1 }} className="group-hover:scale-110 transition-transform duration-200" />
            }
          </button>

          {/* Avatar — Frosted Amber Glass Lens Orb */}
          <div className="relative">
            <button
              onClick={() => setShowDropdown(!showDropdown)}
              className="group relative transition-all duration-200 hover:scale-105 active:scale-95 active:translate-y-0.5 cursor-pointer"
              style={{
                width: 30, height: 30,
                borderRadius: 'var(--radius-full)',
                background: 'radial-gradient(circle at 40% 35%, rgba(255,255,255,0.35) 0%, rgba(251,191,36,0.2) 60%, rgba(180,83,9,0.3) 100%)',
                border: showDropdown ? '1.5px solid rgba(253,230,138,0.9)' : '1px solid rgba(255,255,255,0.45)',
                boxShadow: showDropdown
                  ? '0 0 0 3px rgba(251,191,36,0.35), 0 5px 14px rgba(251,191,36,0.6)'
                  : '0 3px 11px rgba(251,191,36,0.45), inset 0 0 0 1px rgba(255,255,255,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                position: 'relative', overflow: 'hidden', backdropFilter: 'blur(8px)',
              }}
            >
              {/* Inner Amber Glowing Core */}
              <div
                className="transition-all duration-300 group-hover:scale-110"
                style={{
                  position: 'absolute', width: 20, height: 20, borderRadius: '50%',
                  background: 'radial-gradient(circle at 40% 35%, #fde68a 0%, #fbbf24 60%, #b45309 100%)',
                  boxShadow: '0 0 11px rgba(251,191,36,0.8)',
                }}
              />
              {/* Top specular lens highlight */}
              <div style={{
                position: 'absolute', top: '10%', left: '18%',
                width: '50%', height: '26%',
                background: 'radial-gradient(ellipse, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0) 100%)',
                borderRadius: '50%', filter: 'blur(0.4px)', pointerEvents: 'none',
              }} />
              <span style={{ fontSize: 11, fontWeight: 800, color: '#451a03', position: 'relative', zIndex: 1 }} className="group-hover:scale-110 transition-transform duration-200">
                {user.name.charAt(0).toUpperCase()}
              </span>
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
                    background: 'linear-gradient(135deg, rgba(245,158,11,0.06) 0%, transparent 100%)',
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

