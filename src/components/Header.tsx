import { Wifi, WifiOff, LogOut, Sun, Moon, ChevronDown } from 'lucide-react';
import { User } from '../lib/types';
import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Theme } from '../lib/useTheme';

import ehiLogo from '../assets/branding/ehi-logo.png';

export const Header = ({ 
  user, 
  isOffline, 
  pendingCount, 
  onToggleWifi, 
  onLogout,
  theme,
  onToggleTheme
}: { 
  user: User; 
  isOffline: boolean; 
  pendingCount: number; 
  onToggleWifi: () => void; 
  onLogout: () => void;
  theme: Theme;
  onToggleTheme: () => void;
}) => {
  const [showDropdown, setShowDropdown] = useState(false);

  const getRoleDisplay = (role: string) => {
    switch(role) {
      case 'cargo_agent': return 'Cargo Agent';
      case 'vj_agent': return 'ValueJet POS';
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
      case 'vj_agent':    return { bg: 'rgba(139,92,246,0.12)', border: 'rgba(139,92,246,0.3)', text: '#8b5cf6' };
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
              {user.hub}
            </div>
          </div>

          {/* Theme toggle */}
          <button
            onClick={onToggleTheme}
            className="group"
            style={{
              width: 34, height: 34,
              borderRadius: 'var(--radius-sm)',
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            {theme === 'dark'
              ? <Sun size={18} strokeWidth={1.5} className="text-[var(--color-muted)] group-hover:text-[var(--color-accent-amber)] transition-colors" />
              : <Moon size={18} strokeWidth={1.5} className="text-[var(--color-muted)] group-hover:text-[var(--color-accent-amber)] transition-colors" />
            }
          </button>

          {/* Wifi */}
          <button
            onClick={onToggleWifi}
            className="group"
            style={{
              width: 34, height: 34,
              borderRadius: 'var(--radius-sm)',
              background: isOffline ? 'rgba(239,68,68,0.1)' : 'var(--color-surface-2)',
              border: `1px solid ${isOffline ? 'rgba(239,68,68,0.3)' : 'var(--color-border)'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            {isOffline
              ? <WifiOff size={18} strokeWidth={1.5} className="text-[var(--color-error)] group-hover:text-[var(--color-accent-amber)] transition-colors" />
              : <Wifi size={18} strokeWidth={1.5} className="text-[var(--color-muted)] group-hover:text-[var(--color-accent-amber)] transition-colors" />
            }
          </button>

          {/* Avatar + dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowDropdown(!showDropdown)}
              style={{
                width: 36, height: 36,
                borderRadius: 'var(--radius-full)',
                background: 'linear-gradient(135deg, var(--color-accent-amber) 0%, #C87900 100%)',
                border: 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer',
                boxShadow: showDropdown ? '0 0 0 3px var(--glow-amber)' : 'none',
                transition: 'box-shadow 0.15s ease',
                color: '#0D1117', fontSize: 13, fontWeight: 800,
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 800, color: '#0D1117' }}>
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
                      {user.hub}
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

