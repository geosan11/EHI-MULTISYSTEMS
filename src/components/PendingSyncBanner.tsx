import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertTriangle, RefreshCw, LogIn, ShieldAlert, RotateCcw } from 'lucide-react';
import type { PendingSyncSummary } from '../lib/deviceSync';

export interface PendingSyncBannerProps {
  summary: PendingSyncSummary;
  isSyncing?: boolean;
  isSessionExpired?: boolean;
  onSyncNow?: () => Promise<void> | void;
  /** Non-destructive re-auth (renew session). Omit on the login screen: the form is the action. */
  onSignIn?: () => void;
  /** Admins only: re-queue quarantined records. When omitted, quarantined records say "needs admin". */
  onRequeueQuarantined?: () => Promise<void> | void;
  className?: string;
}

export const PendingSyncBanner: React.FC<PendingSyncBannerProps> = ({
  summary,
  isSyncing = false,
  isSessionExpired = false,
  onSyncNow,
  onSignIn,
  onRequeueQuarantined,
  className = '',
}) => {
  const { pending_total, quarantined_count, pending_by_table } = summary;

  if (pending_total <= 0 && quarantined_count <= 0) {
    return null;
  }

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
        {pending_total > 0 && (
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
              !onSignIn ? (
                <span className="text-[11px] font-sans font-bold text-[var(--color-accent-amber)]">Sign in below to sync</span>
              ) : <button
                type="button"
                onClick={onSignIn}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-sans font-bold cursor-pointer transition-all active:scale-95 shadow-sm"
                style={{
                  background: 'var(--color-accent-amber)',
                  color: 'var(--color-on-accent)',
                }}
              >
                <LogIn size={13} />
                <span>Renew session</span>
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
        )}
        {quarantined_count > 0 && (
          <div
            className="px-4 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
            style={{
              background: 'rgba(244,63,94,0.10)',
              borderBottom: '1px solid rgba(244,63,94,0.30)',
            }}
          >
            <span
              className="inline-flex items-center gap-1.5 text-[11px] font-sans font-bold"
              style={{ color: '#fb7185' }}
              title="Quarantined records are held locally after a permanent validation/schema rejection and are not retried by Sync now"
            >
              <ShieldAlert size={13} />
              {quarantined_count} quarantined {quarantined_count === 1 ? 'record' : 'records'}
              <span className="font-normal text-[var(--color-muted)]">
                {onRequeueQuarantined ? '— re-queue after the cause is fixed' : '— needs admin'}
              </span>
            </span>
            {onRequeueQuarantined && (
              <button
                type="button"
                onClick={() => onRequeueQuarantined()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-sans font-bold cursor-pointer transition-all active:scale-95 self-end sm:self-auto"
                style={{ background: 'rgba(244,63,94,0.2)', color: '#fb7185', border: '1px solid rgba(244,63,94,0.4)' }}
              >
                <RotateCcw size={12} />
                <span>Re-queue</span>
              </button>
            )}
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
};
