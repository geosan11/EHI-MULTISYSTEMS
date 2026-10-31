import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertTriangle, RefreshCw, LogIn, ShieldAlert } from 'lucide-react';
import type { PendingSyncSummary } from '../lib/deviceSync';

export interface PendingSyncBannerProps {
  summary: PendingSyncSummary;
  isSyncing?: boolean;
  isSessionExpired?: boolean;
  onSyncNow?: () => Promise<void> | void;
  onSignIn?: () => void;
  className?: string;
}

export const PendingSyncBanner: React.FC<PendingSyncBannerProps> = ({
  summary,
  isSyncing = false,
  isSessionExpired = false,
  onSyncNow,
  onSignIn,
  className = '',
}) => {
  if (summary.pending_total <= 0) {
    return null;
  }

  const { pending_total, quarantined_count, pending_by_table } = summary;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.2 }}
        className={`w-full shrink-0 ${className}`}
        style={{ zIndex: 30 }}
      >
        <div
          style={{
            background: 'linear-gradient(90deg, rgba(251,191,36,0.15) 0%, rgba(217,119,6,0.10) 100%)',
            borderBottom: '1px solid rgba(251,191,36,0.35)',
            boxShadow: 'var(--shadow-xs)',
          }}
          className="px-4 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
        >
          {/* Information & Counts */}
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
              style={{
                background: 'rgba(251,191,36,0.2)',
                color: 'var(--color-accent-amber)',
              }}
            >
              <AlertTriangle size={15} />
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2.5 min-w-0">
              <span className="text-[12px] font-sans font-bold text-[var(--color-foreground)]">
                {pending_total} {pending_total === 1 ? 'record' : 'records'} waiting to sync on this device
              </span>

              {/* Quarantined Count */}
              {quarantined_count > 0 && (
                <span
                  className="inline-flex items-center gap-1 text-[10px] font-mono font-bold px-1.5 py-0.5 rounded"
                  style={{
                    background: 'rgba(244,63,94,0.18)',
                    color: '#fb7185',
                    border: '1px solid rgba(244,63,94,0.35)',
                  }}
                  title="Quarantined records held locally due to permanent validation/schema rejection"
                >
                  <ShieldAlert size={10} />
                  {quarantined_count} quarantined
                </span>
              )}

              {/* Table breakdown preview on larger screens */}
              {pending_by_table && Object.keys(pending_by_table).length > 0 && (
                <span className="hidden md:inline-flex items-center gap-1 text-[10px] font-mono text-[var(--color-muted)]">
                  (
                  {Object.entries(pending_by_table)
                    .map(([tbl, cnt]) => `${tbl.replace('_entries', '')}: ${cnt}`)
                    .join(', ')}
                  )
                </span>
              )}
            </div>
          </div>

          {/* Action Button: Sync now OR Sign in to sync */}
          <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
            {isSessionExpired ? (
              <button
                type="button"
                onClick={onSignIn}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-sans font-bold cursor-pointer transition-all active:scale-95 shadow-sm"
                style={{
                  background: 'var(--color-accent-amber)',
                  color: 'var(--color-on-accent)',
                }}
              >
                <LogIn size={13} />
                <span>Sign in to sync</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onSyncNow}
                disabled={isSyncing}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[11px] font-sans font-bold cursor-pointer transition-all hover:brightness-110 active:scale-95 disabled:opacity-50 shadow-sm"
                style={{
                  background: 'var(--color-accent-amber)',
                  color: 'var(--color-on-accent)',
                }}
              >
                <RefreshCw size={13} className={isSyncing ? 'animate-spin' : ''} />
                <span>{isSyncing ? 'Syncing...' : 'Sync now'}</span>
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
