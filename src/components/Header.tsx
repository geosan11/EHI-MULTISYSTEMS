import { Wifi, WifiOff, LogOut } from 'lucide-react';
import { User } from '../lib/types';
import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';

export const Header = ({ 
  user, 
  isOffline, 
  pendingCount, 
  onToggleWifi, 
  onLogout 
}: { 
  user: User; 
  isOffline: boolean; 
  pendingCount: number; 
  onToggleWifi: () => void; 
  onLogout: () => void;
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
    <div className="flex flex-col w-full z-10 shrink-0 border-b border-[rgba(255,255,255,0.07)]">
      <div className="flex items-center justify-between px-4 py-3 bg-[var(--color-obsidian)]">
        <div>
          <div className="text-[14px] font-bold font-sans text-white">EHI Multisystems</div>
          <div className="text-[10px] font-sans font-medium text-[var(--color-accent-amber)] bg-[rgba(245,158,11,0.1)] inline-block px-1.5 py-0.5 rounded mt-0.5">
            {getRoleDisplay(user.role)}
          </div>
        </div>
        
        <div className="flex items-center space-x-3">
          <div className="text-right">
            <div className="text-[12px] font-sans font-medium text-white">{user.name}</div>
            <div className="text-[10px] font-sans text-[var(--color-muted)]">{user.hub}</div>
          </div>
          
          <button onClick={onToggleWifi} className="p-1.5 focus:outline-none">
            {isOffline ? <WifiOff size={18} className="text-[#D97706]" /> : <Wifi size={18} className="text-[var(--color-light-muted)]" />}
          </button>
          
          <div className="relative">
            <button onClick={() => setShowDropdown(!showDropdown)} className="w-9 h-9 rounded-full bg-[var(--color-surface-2)] flex items-center justify-center border border-[rgba(255,255,255,0.07)] focus:outline-none">
              <span className="text-[13px] font-bold font-sans text-white">{user.name.charAt(0)}</span>
            </button>
            
            {showDropdown && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowDropdown(false)} aria-hidden="true" role="presentation" tabIndex={-1} />
                <div className="absolute right-0 top-11 w-48 bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.07)] rounded-xl shadow-xl z-20 overflow-hidden flex flex-col">
                  <div className="px-3 py-3 border-b border-[rgba(255,255,255,0.07)]">
                    <div className="text-[13px] font-bold font-sans text-white">{user.name}</div>
                    <div className="text-[11px] font-sans text-[var(--color-muted)]">{user.hub}</div>
                  </div>
                  <button 
                    onClick={() => { 
                      setShowDropdown(false); 
                      onLogout(); 
                    }}
                    className="px-3 py-3 w-full text-left flex items-center space-x-2 bg-transparent hover:bg-[var(--color-surface-2)] transition-colors text-[var(--color-error)] focus:outline-none"
                  >
                    <LogOut size={16} />
                    <span className="text-[13px] font-sans">Sign Out</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      
      <AnimatePresence>
        {isOffline && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="w-full bg-[#D97706] text-white text-[12px] font-sans font-medium text-center py-1.5 overflow-hidden"
          >
            No Internet — entries will sync when reconnected
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

