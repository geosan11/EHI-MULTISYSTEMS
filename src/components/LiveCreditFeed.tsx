import React, { useState } from 'react';
import { CustomerWallet, Transaction } from '../lib/types';
import { fmt, tnow } from '../lib/helpers';
import { Wallet, RefreshCw, ArrowUpRight, ArrowDownLeft, Sparkles, ChevronRight, ChevronLeft, Plus, History } from 'lucide-react';

interface LiveCreditFeedProps {
  wallets: CustomerWallet[];
  transactions: Transaction[];
  onOpenTopUp?: (customerName?: string) => void;
  onOpenWalletsView?: () => void;
  onFilterByCustomer?: (customerName: string) => void;
}

export const LiveCreditFeed: React.FC<LiveCreditFeedProps> = ({
  wallets,
  transactions,
  onOpenTopUp,
  onOpenWalletsView,
  onFilterByCustomer,
}) => {
  const [collapsed, setCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<'wallets' | 'activity'>('wallets');

  const totalLiability = wallets.reduce((sum, w) => sum + (w.balance || 0), 0);
  const activeWalletsCount = wallets.filter((w) => (w.balance || 0) > 0).length;

  // Extract recent retrieval and wallet deduction activities from transactions
  const walletActivities = transactions
    .filter((t) => (t as any).wallet_id || (t as any).wallet_deduction_amount > 0 || t.mode === 'Wallet' || t.detail?.toUpperCase().includes('RETRIVAL') || t.detail?.toUpperCase().includes('RETRIEVAL') || t.detail?.toUpperCase().includes('REFUND') || (t as any).retrieved)
    .slice(0, 25);

  if (collapsed) {
    return (
      <div className="w-10 bg-[var(--color-surface-1)] border-l border-[var(--color-border)] flex flex-col items-center py-4 space-y-4 shrink-0 transition-all">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="p-2 text-[var(--color-accent-amber)] hover:bg-[var(--color-surface-2)] rounded-lg transition-colors cursor-pointer"
          title="Expand Live Customer Credit Feed"
        >
          <ChevronLeft size={18} />
        </button>
        <div className="writing-mode-vertical text-[10px] font-mono font-bold tracking-widest text-[var(--color-accent-amber)] uppercase rotate-180 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[var(--color-accent-amber)] animate-pulse" />
          Prepaid Credit Feed (₦{fmt(totalLiability)})
        </div>
      </div>
    );
  }

  return (
    <div className="w-64 bg-[var(--color-surface-1)] border-l border-[var(--color-border)] flex flex-col h-full shrink-0 shadow-2xl transition-all">
      {/* Feed Header */}
      <div className="p-2 bg-[var(--color-surface-2)] border-b border-[var(--color-border)] flex items-center justify-between">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="w-2 h-2 rounded-full bg-[var(--color-accent-amber)] animate-ping shrink-0" />
          <div>
            <div className="text-[10px] font-mono font-bold text-[var(--color-accent-amber)] flex items-center gap-1">
              LIVE CREDIT & RETRIEVAL FEED
              <Sparkles size={10} className="text-[var(--color-accent-amber)]" />
            </div>
            <div className="text-[9px] font-mono text-[var(--color-muted)]">
              Liability: <span className="text-[var(--color-foreground)] font-bold">₦{fmt(totalLiability)}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {onOpenTopUp && (
            <button
              type="button"
              onClick={() => onOpenTopUp()}
              className="p-1.5 bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] rounded-lg font-bold hover:opacity-90 cursor-pointer"
              title="Top-Up Customer Credit"
            >
              <Plus size={14} />
            </button>
          )}
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            className="p-1 text-[var(--color-muted)] hover:text-[var(--color-foreground)] rounded-lg cursor-pointer"
            title="Collapse Feed"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex border-b border-[var(--color-border)] bg-[var(--color-obsidian)] p-1 gap-1">
        <button
          type="button"
          onClick={() => setActiveTab('wallets')}
          className={`flex-1 py-1 text-[10px] font-mono font-bold rounded transition-colors cursor-pointer flex items-center justify-center gap-1 ${
            activeTab === 'wallets'
              ? 'bg-[var(--color-surface-2)] text-[var(--color-accent-amber)] border border-[rgba(245,158,11,0.2)]'
              : 'text-[var(--color-muted)] hover:text-[var(--color-foreground)]'
          }`}
        >
          <Wallet size={11} /> Wallets ({activeWalletsCount})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('activity')}
          className={`flex-1 py-1 text-[10px] font-mono font-bold rounded transition-colors cursor-pointer flex items-center justify-center gap-1 ${
            activeTab === 'activity'
              ? 'bg-[var(--color-surface-2)] text-[var(--color-accent-amber)] border border-[rgba(245,158,11,0.2)]'
              : 'text-[var(--color-muted)] hover:text-[var(--color-foreground)]'
          }`}
        >
          <History size={11} /> Live Stream ({walletActivities.length})
        </button>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {activeTab === 'wallets' ? (
          wallets.length > 0 ? (
            wallets.map((w) => (
              <div
                key={w.id}
                className="p-2 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)] border border-[var(--color-border)] rounded-lg space-y-1.5 transition-all group"
              >
                <div className="flex items-start justify-between gap-1">
                  <div className="min-w-0">
                    <button
                      type="button"
                      onClick={() => onFilterByCustomer && onFilterByCustomer(w.customer_name)}
                      className="text-[11px] font-bold font-sans text-[var(--color-foreground)] hover:text-[var(--color-accent-amber)] truncate text-left block cursor-pointer leading-tight"
                    >
                      {w.customer_name}
                    </button>
                    {w.customer_phone && (
                      <div className="text-[9px] font-mono text-[var(--color-muted)] mt-0.5">
                        {w.customer_phone}
                      </div>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[11px] font-mono font-bold text-[var(--color-accent-amber)] leading-tight">
                      ₦{fmt(w.balance)}
                    </div>
                    <div className="text-[8px] font-mono text-[var(--color-success)] uppercase">
                      Credit
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 pt-1 border-t border-[var(--color-border)] text-[10px] font-mono">
                  {onOpenTopUp && (
                    <button
                      type="button"
                      onClick={() => onOpenTopUp(w.customer_name)}
                      className="flex-1 py-1 bg-[rgba(245,158,11,0.1)] hover:bg-[var(--color-accent-amber)] text-[var(--color-accent-amber)] hover:text-[var(--color-obsidian)] rounded-lg font-bold text-center transition-colors cursor-pointer"
                    >
                      + Top Up
                    </button>
                  )}
                  {onFilterByCustomer && (
                    <button
                      type="button"
                      onClick={() => onFilterByCustomer(w.customer_name)}
                      className="flex-1 py-1 bg-[var(--color-surface-3)] hover:bg-[var(--color-border)] text-[var(--color-foreground)] rounded-lg text-center transition-colors cursor-pointer"
                    >
                      Filter Ledger
                    </button>
                  )}
                </div>
              </div>
            ))
          ) : (
            <div className="py-12 text-center text-[11px] font-mono text-[var(--color-muted)] space-y-2">
              <Wallet size={24} className="mx-auto text-[var(--color-muted)] opacity-50" />
              <div>No customer credit wallets yet.</div>
              {onOpenTopUp && (
                <button
                  type="button"
                  onClick={() => onOpenTopUp()}
                  className="px-3 py-1.5 bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] font-bold rounded-lg text-[11px] cursor-pointer"
                >
                  Create First Wallet
                </button>
              )}
            </div>
          )
        ) : (
          /* Live Stream Activity Feed */
          walletActivities.length > 0 ? (
            walletActivities.map((tx) => {
              const deductionAmt = (tx as any).wallet_deduction_amount || (tx.mode === 'Wallet' ? tx.amount : 0);
              const isRetrieval = tx.detail?.toUpperCase().includes('RETRIVAL') || tx.detail?.toUpperCase().includes('RETRIEVAL') || tx.detail?.toUpperCase().includes('REFUND') || (tx as any).retrieved;

              return (
                <div
                  key={tx.id}
                  className={`p-2.5 rounded-xl border space-y-1.5 transition-all ${
                    isRetrieval
                      ? 'bg-[rgba(16,185,129,0.06)] border-[rgba(16,185,129,0.25)]'
                      : 'bg-[rgba(245,158,11,0.06)] border-[rgba(245,158,11,0.25)]'
                  }`}
                >
                  <div className="flex items-center justify-between text-[11px] font-mono">
                    <span className="font-bold flex items-center gap-1">
                      {isRetrieval ? (
                        <>
                          <ArrowDownLeft size={13} className="text-[var(--color-success)]" />
                          <span className="text-[var(--color-success)]">RETRIEVAL REFUND</span>
                        </>
                      ) : (
                        <>
                          <ArrowUpRight size={13} className="text-[var(--color-accent-amber)]" />
                          <span className="text-[var(--color-accent-amber)]">WALLET DEDUCTION</span>
                        </>
                      )}
                    </span>
                    <span className="text-[var(--color-muted)]">{tx.time || tnow()}</span>
                  </div>

                  <div className="text-[12px] font-bold font-sans text-[var(--color-foreground)] truncate">
                    {tx.name}
                  </div>

                  <div className="text-[10px] font-mono text-[var(--color-muted)] truncate">
                    Waybill: {tx.awb_tag_number || tx.id} · {tx.detail}
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t border-[rgba(255,255,255,0.05)] text-[11px] font-mono font-bold">
                    <span className="text-[var(--color-muted)] text-[10px]">
                      {isRetrieval ? 'Credited to Wallet:' : 'Deducted from Wallet:'}
                    </span>
                    <span className={isRetrieval ? 'text-[var(--color-success)]' : 'text-[var(--color-accent-amber)]'}>
                      {isRetrieval ? `+₦${fmt(tx.amount)}` : `-₦${fmt(deductionAmt)}`}
                    </span>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="py-12 text-center text-[11px] font-mono text-[var(--color-muted)]">
              No recent wallet activity recorded in this shift.
            </div>
          )
        )}
      </div>

      {/* Feed Footer */}
      {onOpenWalletsView && (
        <div className="p-3 bg-[var(--color-surface-2)] border-t border-[var(--color-border)] text-center">
          <button
            type="button"
            onClick={onOpenWalletsView}
            className="w-full py-2 bg-[var(--color-surface-3)] hover:bg-[var(--color-border)] text-[var(--color-foreground)] text-[11px] font-mono font-bold rounded-xl border border-[var(--color-border)] transition-colors cursor-pointer"
          >
            Manage All Wallets & Receipts →
          </button>
        </div>
      )}
    </div>
  );
};
