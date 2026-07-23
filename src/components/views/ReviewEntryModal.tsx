import React, { useEffect, useRef } from 'react';
import { CheckCircle2, X } from 'lucide-react';
import { fmt } from '../../lib/helpers';

interface ReviewEntryModalProps {
  title: string;
  details: { label: string; value: string | number }[];
  onConfirm: () => void;
  onCancel: () => void;
  confirmText?: string;
  isSubmitting?: boolean;
}

export const ReviewEntryModal: React.FC<ReviewEntryModalProps> = ({
  title,
  details,
  onConfirm,
  onCancel,
  confirmText = 'Confirm & Log Entry',
  isSubmitting = false
}) => {
  // Synchronous double-fire guard, shared by every form that uses this
  // modal (Cargo/Package/Marketing/ExcessBaggage) -- a chattery mouse or a
  // fast double-click/tap could call onConfirm twice before React
  // re-rendered the button's disabled state, submitting the same entry
  // twice. Resets whenever isSubmitting returns to false (a fresh review,
  // or the previous attempt finished/failed).
  const firedRef = useRef(false);
  useEffect(() => {
    if (!isSubmitting) firedRef.current = false;
  }, [isSubmitting]);

  const handleConfirmClick = () => {
    if (firedRef.current || isSubmitting) return;
    firedRef.current = true;
    onConfirm();
  };

  return (
    // Fullscreen on mobile (no surrounding padding, the card fills the
    // viewport) -- a small centered card on a phone leaves the review
    // details cramped into a fraction of the screen. From sm: up it's back
    // to a normal centered modal; shared by every form that uses this
    // (Cargo/Package/Marketing/ExcessBaggage), so all of them get this at once.
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex items-center justify-center sm:p-4">
      <div className="bg-[var(--color-obsidian)] border-0 sm:border border-[var(--color-border)] rounded-none sm:rounded-xl w-full h-full sm:h-auto sm:max-w-md sm:max-h-[90vh] overflow-hidden shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b border-[var(--color-border)] bg-[var(--color-surface-card)] shrink-0">
          <h3 className="text-[14px] font-bold font-sans text-[var(--color-foreground)] tracking-wide">
            {title}
          </h3>
          <button onClick={onCancel} disabled={isSubmitting} className="p-1 hover:bg-[var(--color-surface-2)] rounded text-[var(--color-muted)] transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Content -- tightened (smaller padding/row height) so every
            entry's handful of detail rows fits without scrolling on
            realistic viewports; staff shouldn't have to scroll past
            fields to reach Confirm, or risk missing one they never
            scrolled down to see. flex-1 fills the fullscreen mobile card;
            sm:max-h caps it back down once the card returns to its normal
            centered/auto-height size on larger screens. */}
        <div className="p-3 overflow-y-auto flex-1 sm:flex-none sm:max-h-[55vh]">
          <div className="space-y-1.5">
            {details.map((detail, idx) => (
              <div key={idx} className="flex justify-between items-center py-1.5 border-b border-[var(--color-border)] last:border-0">
                <span className="text-[11px] font-mono text-[var(--color-muted)] uppercase tracking-wider">{detail.label}</span>
                <span className={`text-[13px] font-sans font-bold ${detail.label.toLowerCase().includes('amount') ? 'text-[var(--color-success)]' : 'text-[var(--color-foreground)]'}`}>
                  {detail.label.toLowerCase().includes('amount') && typeof detail.value === 'number' ? `₦${fmt(detail.value)}` : detail.value}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-[var(--color-border)] bg-[var(--color-surface-card)] flex gap-3 shrink-0">
          <button
            onClick={onCancel}
            disabled={isSubmitting}
            className="flex-1 h-11 rounded-lg bg-[var(--color-surface-2)] text-[var(--color-foreground)] text-[13px] font-bold hover:bg-[var(--color-surface-1)] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirmClick}
            disabled={isSubmitting}
            className="flex-1 h-11 flex items-center justify-center gap-2 rounded-lg text-[13px] font-bold transition-colors bg-[var(--color-success)] text-[#030712] hover:bg-[#10b981]"
          >
            {isSubmitting ? (
              <span className="w-5 h-5 border-2 border-[#030712] border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <CheckCircle2 size={16} />
                {confirmText}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
