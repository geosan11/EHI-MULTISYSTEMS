import React, { useState } from 'react';
import { Modal } from './Modal';
import { EHILogo } from './EHILogo';
import { AlertTriangle } from 'lucide-react';

export const FORCED_RELOAD_KEY = 'ehi_forced_reload_subscription_notice_20261106';

/**
 * Notice-only modal warning operators that the subscription has expired.
 * - Always shows on fresh app load / refresh (in-memory state only; never saves dismissed to storage).
 * - Operators can dismiss it and continue using the app normally until next reload.
 * - Does not block, sign out, or suspend usage.
 * - Suppressed during the one-time forced-reload pass on first launch of this release.
 */
export const SubscriptionExpiredModal: React.FC = () => {
  const [isOpen, setIsOpen] = useState(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        // Do not display on the pass about to trigger the one-time hard refresh
        if (!localStorage.getItem(FORCED_RELOAD_KEY)) {
          return false;
        }
      }
    } catch {
      // Storage unavailable / restricted, allow normal in-memory display
    }
    return true;
  });

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => setIsOpen(false)}
      title="Subscription Notice"
      size="md"
      overlayZIndex="z-[99999]"
    >
      {(close) => (
        <div className="p-5 sm:p-6 flex flex-col gap-5">
          <div className="flex items-start gap-3.5">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
              style={{
                backgroundColor: 'var(--color-amber-bg)',
                border: '1px solid var(--color-amber-border)',
              }}
            >
              <AlertTriangle size={20} style={{ color: 'var(--color-accent-amber)' }} />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5">
                <EHILogo width={32} height={24} className="shrink-0" />
                <span
                  className="text-[11px] font-mono font-bold uppercase tracking-wider"
                  style={{ color: 'var(--color-accent-amber)' }}
                >
                  System Alert
                </span>
              </div>
              <p
                className="text-[14px] font-medium leading-relaxed"
                style={{ color: 'var(--color-foreground)' }}
              >
                Your subscription has expired and your usage will be suspended.
              </p>
            </div>
          </div>

          <div
            className="flex justify-end pt-3"
            style={{ borderTop: '1px solid var(--color-border)' }}
          >
            <button
              type="button"
              onClick={close}
              className="w-full sm:w-auto px-5 py-2.5 rounded-lg text-[13px] font-bold font-mono transition-colors cursor-pointer"
              style={{
                color: 'var(--color-foreground)',
                backgroundColor: 'var(--color-surface-2)',
                border: '1px solid var(--color-border-strong)',
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
};
