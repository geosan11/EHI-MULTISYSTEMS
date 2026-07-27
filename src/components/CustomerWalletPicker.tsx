import React, { useState } from 'react';
import { CustomerWallet } from '../lib/types';
import { fmt } from '../lib/helpers';
import { Search, Wallet, Plus, Check, UserCheck, X } from 'lucide-react';

interface CustomerWalletPickerProps {
  wallets: CustomerWallet[];
  selectedWallet: CustomerWallet | null;
  onSelectWallet: (wallet: CustomerWallet | null) => void;
  onOpenCreateModal?: (initialName?: string) => void;
  currentCustomerName?: string;
}

export const CustomerWalletPicker: React.FC<CustomerWalletPickerProps> = ({
  wallets,
  selectedWallet,
  onSelectWallet,
  onOpenCreateModal,
  currentCustomerName = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [searchTerm, setSearchTerm] = useState(currentCustomerName);

  const closeModal = () => {
    if (isClosing) return;
    setIsClosing(true);
    setTimeout(() => {
      setIsOpen(false);
      setIsClosing(false);
    }, 200);
  };

  const filtered = wallets.filter(
    (w) =>
      w.customer_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (w.customer_phone && w.customer_phone.includes(searchTerm))
  );

  return (
    <div className="relative w-full">
      {selectedWallet ? (
        <div className="p-3 bg-[rgba(245,158,11,0.08)] border border-[var(--color-accent-amber)] rounded-xl flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] flex items-center justify-center font-bold shrink-0">
              <Wallet size={16} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[12px] font-bold font-sans text-[var(--color-foreground)] truncate">
                  {selectedWallet.customer_name}
                </span>
                <span className="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded bg-[rgba(16,185,129,0.15)] text-[var(--color-success)] uppercase">
                  Active Credit
                </span>
              </div>
              <div className="text-[11px] font-mono text-[var(--color-accent-amber)] font-bold">
                Available: ₦{fmt(selectedWallet.balance)}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setIsOpen(true)}
              className="px-2.5 py-1 text-[11px] font-mono font-semibold text-[var(--color-muted)] hover:text-[var(--color-foreground)] bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)] rounded-lg border border-[var(--color-border)] transition-colors cursor-pointer"
            >
              Change
            </button>
            <button
              type="button"
              onClick={() => onSelectWallet(null)}
              className="p-1 text-[var(--color-muted)] hover:text-[var(--color-error)] rounded-lg transition-colors cursor-pointer"
              title="Deselect wallet"
            >
              <X size={15} />
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsOpen(true)}
            className="flex-1 py-2.5 px-3 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)] border border-[var(--color-border)] rounded-xl flex items-center justify-between text-left transition-all cursor-pointer group"
          >
            <div className="flex items-center gap-2">
              <Wallet size={16} className="text-[var(--color-accent-amber)] group-hover:scale-110 transition-transform" />
              <span className="text-[12px] font-sans font-medium text-[var(--color-foreground)]">
                {currentCustomerName ? `Select Wallet for "${currentCustomerName}"` : 'Select / Search Customer Wallet'}
              </span>
            </div>
            <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-[var(--color-surface-3)] text-[var(--color-accent-amber)] border border-[rgba(245,158,11,0.2)]">
              {wallets.length} Active
            </span>
          </button>
          {onOpenCreateModal && (
            <button
              type="button"
              onClick={() => onOpenCreateModal(currentCustomerName)}
              className="p-2.5 bg-[rgba(245,158,11,0.1)] hover:bg-[var(--color-accent-amber)] text-[var(--color-accent-amber)] hover:text-[var(--color-obsidian)] border border-[rgba(245,158,11,0.25)] rounded-xl transition-all cursor-pointer shrink-0"
              title="Create New Credit Wallet"
            >
              <Plus size={16} />
            </button>
          )}
        </div>
      )}

      {/* Wallet Search Modal / Dropdown Overlay */}
      {isOpen && (
        <div
          className={`fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 ${
            isClosing ? 'animate-modal-backdrop-out' : 'animate-modal-backdrop-in'
          }`}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div className={`w-full max-w-md bg-[var(--color-surface-1)] border border-[var(--color-border-strong)] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] ${
            isClosing ? 'animate-modal-slide-out' : 'animate-modal-slide-in'
          }`}>
            {/* Modal Header */}
            <div className="p-4 bg-[var(--color-surface-2)] border-b border-[var(--color-border)] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Wallet className="text-[var(--color-accent-amber)]" size={18} />
                <h3 className="text-[14px] font-mono font-bold text-[var(--color-foreground)]">
                  Customer Credit Wallets
                </h3>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="p-1 text-[var(--color-muted)] hover:text-[var(--color-foreground)] rounded-lg cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Search Input */}
            <div className="p-3 border-b border-[var(--color-border)] bg-[var(--color-obsidian)]">
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)]" />
                <input
                  type="text"
                  placeholder="Search customer name or phone..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-[var(--color-surface-2)] text-[12px] font-mono text-[var(--color-foreground)] border border-[var(--color-border)] rounded-xl focus:border-[var(--color-accent-amber)] outline-none"
                  autoFocus
                />
              </div>
            </div>

            {/* Wallet List */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {filtered.length > 0 ? (
                filtered.map((w) => {
                  const isSelected = selectedWallet?.id === w.id;
                  return (
                    <button
                      key={w.id}
                      type="button"
                      onClick={() => {
                        onSelectWallet(w);
                        setIsOpen(false);
                      }}
                      className={`w-full p-3 rounded-xl border text-left flex items-center justify-between transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-[rgba(245,158,11,0.12)] border-[var(--color-accent-amber)]'
                          : 'bg-[var(--color-surface-2)] border-[var(--color-border)] hover:border-[var(--color-accent-amber)]'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="text-[13px] font-bold font-sans text-[var(--color-foreground)] truncate">
                          {w.customer_name}
                        </div>
                        {w.customer_phone && (
                          <div className="text-[10px] font-mono text-[var(--color-muted)]">
                            {w.customer_phone}
                          </div>
                        )}
                        <div className="text-[10px] font-mono text-[var(--color-muted)] mt-0.5">
                          Source: {w.source_type.replace('_', ' ')}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[13px] font-mono font-bold text-[var(--color-accent-amber)]">
                          ₦{fmt(w.balance)}
                        </div>
                        <div className="text-[9px] font-mono text-[var(--color-success)] uppercase">
                          Available
                        </div>
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="py-8 text-center space-y-3">
                  <div className="text-[12px] font-mono text-[var(--color-muted)]">
                    No active credit wallet found for "{searchTerm}"
                  </div>
                  {onOpenCreateModal && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsOpen(false);
                        onOpenCreateModal(searchTerm);
                      }}
                      className="px-4 py-2 bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] text-[12px] font-mono font-bold rounded-xl shadow-md cursor-pointer hover:opacity-90 inline-flex items-center gap-1.5"
                    >
                      <Plus size={14} /> Create Wallet for "{searchTerm || 'Customer'}"
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-3 bg-[var(--color-surface-2)] border-t border-[var(--color-border)] flex items-center justify-between text-[11px] font-mono text-[var(--color-muted)]">
              <span>{wallets.length} total active wallets</span>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="px-3 py-1 bg-[var(--color-surface-3)] text-[var(--color-foreground)] rounded-lg border border-[var(--color-border)] cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
