import { Wifi, WifiOff, LogOut, Sun, Moon, ChevronDown } from 'lucide-react';
import { User } from '../lib/types';
import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Theme } from '../lib/useTheme';

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
      default: return 'Agent';
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

        {/* Brand */}
        <div className="flex items-center gap-2.5 ehi-header-brand">
          <div
            style={{
              width: 36, height: 36,
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(245,158,11,0.12)',
              border: '1px solid rgba(245,158,11,0.25)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <span style={{
              fontSize: 12, fontWeight: 900,
              color: 'var(--color-accent-amber)',
              fontFamily: 'monospace', letterSpacing: '-0.02em',
            }}>EHI</span>
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-foreground)' }}>
              EHI Multisystems
            </div>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              background: 'rgba(245,158,11,0.12)',
              border: '1px solid rgba(245,158,11,0.2)',
              borderRadius: 'var(--radius-full)',
              padding: '1px 8px', marginTop: 2,
            }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-accent-amber)' }}>
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
              ? <Sun size={16} color="var(--color-accent-amber)" />
              : <Moon size={16} color="var(--color-light-muted)" />
            }
          </button>

          {/* Wifi */}
          <button
            onClick={onToggleWifi}
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
              ? <WifiOff size={16} color="var(--color-error)" />
              : <Wifi size={16} color="var(--color-muted)" />
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
                    style={{
                      width: '100%', padding: '12px 14px',
                      background: 'transparent', border: 'none',
                      display: 'flex', alignItems: 'center', gap: 10,
                      cursor: 'pointer', color: 'var(--color-error)',
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.08)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <LogOut size={15} />
                    <span style={{ fontSize: 13 }}>Sign Out</span>
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

