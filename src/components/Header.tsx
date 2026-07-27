import { Wifi, WifiOff, LogOut, Sun, Moon, ChevronDown, RefreshCw } from 'lucide-react';
import { User } from '../lib/types';
import { useState } from 'react';
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
}: { 
  user: User; 
  isOffline: boolean; 
  pendingCount: number; 
  onToggleWifi: () => void; 
  onLogout: () => void;
  theme: Theme;
  onToggleTheme: () => void;
  onManualSync?: () => void;
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
      style={{
        background: 'var(--color-nav-bg)',
        borderBottom: '1px solid var(--color-border)',
      }}
    >
      <div className="flex items-center justify-between px-4 py-3 min-h-[60px]">

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

        {/* Right controls */}
        <div className="flex items-center gap-2 ml-auto">

          {/* User info */}
          <div className="text-right mr-1 hidden sm:block">
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-foreground)' }}>
              {user.name}
            </div>
            <div style={{ fontSize: 10, color: 'var(--color-muted)' }}>
              {getHubCode(user.hub)}
            </div>
          </div>

          {/* Theme toggle — 3D glass orb */}
          <button
            onClick={onToggleTheme}
            className="group relative"
            title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            style={{
              width: 34, height: 34,
              borderRadius: 'var(--radius-sm)',
              background: theme === 'dark'
                ? 'radial-gradient(circle at 38% 30%, rgba(80,90,115,0.9) 0%, rgba(40,48,70,0.95) 55%, rgba(20,26,45,1) 100%)'
                : 'radial-gradient(circle at 38% 30%, rgba(230,235,245,0.95) 0%, rgba(195,205,220,0.90) 55%, rgba(155,168,190,0.95) 100%)',
              border: theme === 'dark' ? '1px solid rgba(255,255,255,0.12)' : '1px solid rgba(255,255,255,0.7)',
              boxShadow: theme === 'dark'
                ? '0 4px 10px rgba(0,0,0,0.55), 0 1px 3px rgba(0,0,0,0.4), inset 0 -2px 4px rgba(0,0,0,0.4), inset 0 1px 3px rgba(255,255,255,0.12)'
                : '0 4px 10px rgba(0,0,0,0.18), 0 1px 3px rgba(0,0,0,0.12), inset 0 -2px 4px rgba(0,0,0,0.10), inset 0 1px 3px rgba(255,255,255,0.80)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', transition: 'all 0.2s ease', overflow: 'hidden', position: 'relative',
            }}
          >
            {/* Top specular reflection */}
            <div style={{
              position: 'absolute', top: '10%', left: '15%',
              width: '55%', height: '28%',
              background: 'radial-gradient(ellipse, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0) 100%)',
              borderRadius: '50%', filter: 'blur(1px)', pointerEvents: 'none',
            }} />
            {/* Bottom shadow rim */}
            <div style={{
              position: 'absolute', bottom: '8%', left: '15%',
              width: '70%', height: '18%',
              background: 'radial-gradient(ellipse, rgba(0,0,0,0.30) 0%, rgba(0,0,0,0) 100%)',
              borderRadius: '50%', filter: 'blur(2px)', pointerEvents: 'none',
            }} />
            {theme === 'dark'
              ? <Sun size={16} strokeWidth={1.5} style={{ color: 'var(--color-muted)', position: 'relative', zIndex: 1 }} className="group-hover:text-[var(--color-accent-amber)] transition-colors duration-200" />
              : <Moon size={16} strokeWidth={1.5} style={{ color: '#4a5568', position: 'relative', zIndex: 1 }} className="group-hover:text-[var(--color-accent-amber)] transition-colors duration-200" />
            }
          </button>

          {/* Pending Sync Badge */}
          {pendingCount > 0 && (
            <button
              onClick={() => {
                if (onManualSync) onManualSync();
              }}
              title="Click to force sync offline entries"
              className="px-2 py-1 rounded flex items-center gap-1 bg-[rgba(245,158,11,0.15)] border border-[rgba(245,158,11,0.3)] text-[var(--color-accent-amber)] font-mono text-[10px] font-bold animate-pulse cursor-pointer hover:bg-[rgba(245,158,11,0.25)] transition-colors"
            >
              <RefreshCw size={11} className="animate-spin" />
              <span>{pendingCount} Queued</span>
            </button>
          )}

          {/* Wifi — 3D glass orb */}
          <button
            onClick={onToggleWifi}
            className="group relative"
            style={{
              width: 34, height: 34,
              borderRadius: 'var(--radius-sm)',
              background: isOffline
                ? 'radial-gradient(circle at 38% 30%, rgba(239,68,68,0.35) 0%, rgba(185,28,28,0.50) 55%, rgba(127,18,18,0.65) 100%)'
                : 'radial-gradient(circle at 38% 30%, rgba(80,90,115,0.9) 0%, rgba(40,48,70,0.95) 55%, rgba(20,26,45,1) 100%)',
              border: isOffline ? '1px solid rgba(239,68,68,0.40)' : '1px solid rgba(255,255,255,0.12)',
              boxShadow: isOffline
                ? '0 4px 12px rgba(239,68,68,0.30), 0 1px 3px rgba(0,0,0,0.4), inset 0 -2px 4px rgba(0,0,0,0.35), inset 0 1px 3px rgba(255,120,120,0.20)'
                : '0 4px 10px rgba(0,0,0,0.55), 0 1px 3px rgba(0,0,0,0.4), inset 0 -2px 4px rgba(0,0,0,0.4), inset 0 1px 3px rgba(255,255,255,0.12)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', overflow: 'hidden', position: 'relative',
            }}
          >
            {/* Top specular reflection */}
            <div style={{
              position: 'absolute', top: '10%', left: '15%',
              width: '55%', height: '28%',
              background: 'radial-gradient(ellipse, rgba(255,255,255,0.45) 0%, rgba(255,255,255,0) 100%)',
              borderRadius: '50%', filter: 'blur(1px)', pointerEvents: 'none',
            }} />
            {/* Bottom shadow rim */}
            <div style={{
              position: 'absolute', bottom: '8%', left: '15%',
              width: '70%', height: '18%',
              background: 'radial-gradient(ellipse, rgba(0,0,0,0.30) 0%, rgba(0,0,0,0) 100%)',
              borderRadius: '50%', filter: 'blur(2px)', pointerEvents: 'none',
            }} />
            {isOffline
              ? <WifiOff size={16} strokeWidth={1.5} style={{ color: 'rgba(252,165,165,0.9)', position: 'relative', zIndex: 1 }} />
              : <Wifi size={16} strokeWidth={1.5} style={{ color: 'var(--color-muted)', position: 'relative', zIndex: 1 }} className="group-hover:text-[var(--color-accent-amber)] transition-colors duration-200" />
            }
          </button>

          {/* Avatar — 3D glass dark amber orb */}
          <div className="relative">
            <button
              onClick={() => setShowDropdown(!showDropdown)}
              style={{
                width: 36, height: 36,
                borderRadius: 'var(--radius-full)',
                background: 'radial-gradient(circle at 38% 30%, #f59e0b 0%, #d97706 50%, #92400e 100%)',
                border: showDropdown ? '1px solid rgba(251,191,36,0.7)' : '1px solid rgba(217,119,6,0.45)',
                boxShadow: showDropdown
                  ? '0 0 0 3px rgba(217,119,6,0.25), 0 4px 14px rgba(217,119,6,0.50), inset 0 -3px 5px rgba(100,40,0,0.55), inset 0 2px 4px rgba(254,215,170,0.65)'
                  : '0 4px 12px rgba(217,119,6,0.45), 0 2px 4px rgba(0,0,0,0.4), inset 0 -3px 5px rgba(100,40,0,0.50), inset 0 2px 4px rgba(254,215,170,0.60)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', transition: 'all 0.2s ease',
                position: 'relative', overflow: 'hidden',
              }}
            >
              {/* Top specular highlight */}
              <div style={{
                position: 'absolute', top: '10%', left: '18%',
                width: '50%', height: '26%',
                background: 'radial-gradient(ellipse, rgba(255,255,255,0.70) 0%, rgba(255,255,255,0) 100%)',
                borderRadius: '50%', filter: 'blur(0.5px)', pointerEvents: 'none',
              }} />
              {/* Bottom shadow rim */}
              <div style={{
                position: 'absolute', bottom: '10%', left: '18%',
                width: '65%', height: '16%',
                background: 'radial-gradient(ellipse, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0) 100%)',
                borderRadius: '50%', filter: 'blur(1.5px)', pointerEvents: 'none',
              }} />
              <span style={{ fontSize: 13, fontWeight: 800, color: '#431407', position: 'relative', zIndex: 1 }}>
                {user.name.charAt(0).toUpperCase()}
              </span>
            </button>

            {showDropdown && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowDropdown(false)} />
                <div
                  style={{
                    position: 'absolute', right: 0, top: 42, width: 200,
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

