import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  const [isClosing, setIsClosing] = useState(false);
  const firedRef = useRef(false);

  useEffect(() => {
    if (!isSubmitting) firedRef.current = false;
  }, [isSubmitting]);

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  const handleClose = (action: () => void) => {
    if (isClosing || isSubmitting) return;
    setIsClosing(true);
    setTimeout(() => {
      action();
    }, 200);
  };

  const handleConfirmClick = () => {
    if (firedRef.current || isSubmitting || isClosing) return;
    firedRef.current = true;
    onConfirm();
  };

  // Portaled directly into document.body -- not nested inside whatever
  // page/tab/form wrapper happens to render this component. Any ancestor
  // that sets transform/filter/will-change/perspective silently turns
  // itself into a CSS containing block for this modal's own
  // `position: fixed`, breaking its centering (this already happened twice:
  // once via EHIApp.tsx's .page-transition, once via CargoForm.tsx's own
  // root wrapper). Matches Modal.tsx's own fix for the same class of bug.
  return createPortal(
    <div
      className={`fixed inset-0 w-screen h-screen bg-black/75 backdrop-blur-md z-[999999] flex items-center justify-center p-3 sm:p-4 select-none ${
        isClosing ? 'animate-modal-backdrop-out' : 'animate-modal-backdrop-in'
      }`}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose(onCancel);
      }}
    >
      <div
        className={`bg-[var(--color-obsidian)] border border-[var(--color-border)] rounded-xl w-full max-w-md h-auto max-h-[85vh] flex flex-col overflow-hidden shadow-2xl ${
          isClosing ? 'animate-modal-slide-out' : 'animate-modal-slide-in'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface-card)] shrink-0">
          <h3 className="text-[14px] font-bold font-sans text-[var(--color-foreground)] tracking-wide">
            {title}
          </h3>
          <button
            onClick={() => handleClose(onCancel)}
            disabled={isSubmitting}
            className="p-1 hover:bg-[var(--color-surface-2)] rounded text-[var(--color-muted)] transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content -- Hugs content when short, scrolls ONLY if details grow large */}
        <div className="px-4 py-2 overflow-y-auto flex-1 min-h-0 divide-y divide-[var(--color-border)]">
          {details.map((detail, idx) => (
            <div key={idx} className="flex justify-between items-center py-2.5">
              <span className="text-[11px] font-mono text-[var(--color-muted)] uppercase tracking-wider shrink-0">{detail.label}</span>
              <span className={`text-[13px] font-sans font-bold text-right truncate max-w-[65%] ml-2 ${detail.label.toLowerCase().includes('amount') ? 'text-[var(--color-success)]' : 'text-[var(--color-foreground)]'}`}>
                {detail.label.toLowerCase().includes('amount') && typeof detail.value === 'number' ? `₦${fmt(detail.value)}` : detail.value}
              </span>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="p-3.5 border-t border-[var(--color-border)] bg-[var(--color-surface-card)] flex gap-3 shrink-0">
          <button
            onClick={() => handleClose(onCancel)}
            disabled={isSubmitting}
            className="flex-1 h-10 rounded-lg bg-[var(--color-surface-2)] text-[var(--color-foreground)] text-[13px] font-bold hover:bg-[var(--color-surface-1)] transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirmClick}
            disabled={isSubmitting}
            className="flex-1 h-10 flex items-center justify-center gap-2 rounded-lg text-[13px] font-bold transition-colors bg-[var(--color-accent-amber)] text-[var(--color-on-accent)] hover:bg-[var(--color-accent-amber)]/90 cursor-pointer"
          >
            {isSubmitting ? (
              <span className="w-5 h-5 border-2 border-[var(--color-obsidian)] border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <CheckCircle2 size={16} />
                {confirmText}
              </>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
