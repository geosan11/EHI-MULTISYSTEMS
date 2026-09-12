import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Printer } from 'lucide-react';
import { lockBodyScroll, unlockBodyScroll } from '../lib/bodyScrollLock';

interface PrintRangeModalProps {
  totalCount: number;
  itemLabel?: string;
  initialFrom?: number;
  initialTo?: number;
  onConfirm: (range: { from: number; to: number }) => void;
  onCancel: () => void;
}

// Deliberately "dumb" -- hands back a 1-indexed, inclusive {from, to} and
// nothing else. What that range MEANS (slice a plain array, or replace a
// Set-based multi-select) is entirely the caller's business, which is what
// lets CargoForm.tsx's batch and GatPrintQueue.tsx's queue -- two different
// selection models -- share this one component instead of each growing
// their own copy.
export const PrintRangeModal = ({
  totalCount,
  itemLabel = 'items',
  initialFrom = 1,
  initialTo,
  onConfirm,
  onCancel,
}: PrintRangeModalProps) => {
  const [from, setFrom] = useState(String(initialFrom));
  const [to, setTo] = useState(String(initialTo ?? totalCount));
  const [isClosing, setIsClosing] = useState(false);
  // Ref, not the isClosing state -- see ConfirmDialog.tsx's identical
  // comment: the keydown handler below is bound once (deps []), so reading
  // state there would always see its first-render value.
  const closingRef = useRef(false);

  const handleAction = (callback: () => void) => {
    if (closingRef.current) return;
    closingRef.current = true;
    setIsClosing(true);
    setTimeout(callback, 200);
  };

  useEffect(() => {
    lockBodyScroll();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleAction(onCancel);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      unlockBodyScroll();
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fromNum = parseInt(from, 10);
  const toNum = parseInt(to, 10);
  const invalid =
    !Number.isFinite(fromNum) || !Number.isFinite(toNum) ||
    fromNum < 1 || toNum > totalCount || fromNum > toNum;
  const count = invalid ? 0 : toNum - fromNum + 1;
  const isFullRange = !invalid && fromNum === 1 && toNum === totalCount;

  const handleConfirm = () => {
    if (invalid) return;
    handleAction(() => onConfirm({ from: fromNum, to: toNum }));
  };

  return createPortal(
    <div
      className={`fixed inset-0 z-[9999] ehi-scrim flex items-center justify-center p-4 ${
        isClosing ? 'animate-modal-backdrop-out' : 'animate-modal-backdrop-in'
      }`}
      role="dialog"
      aria-modal="true"
      aria-label="Select print range"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleAction(onCancel);
      }}
    >
      <div
        className={`w-full max-w-sm bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-strong)] shadow-2xl overflow-hidden ${
          isClosing ? 'animate-modal-slide-out' : 'animate-modal-slide-in'
        }`}
      >
        <div className="p-5 flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <Printer size={18} className="text-[var(--color-accent-amber)]" />
            <h3 className="text-[13px] font-bold text-[var(--color-foreground)] uppercase font-mono">
              Select {itemLabel} to Print
            </h3>
          </div>

          <p className="text-[11px] font-mono text-[var(--color-muted)]">
            {totalCount} {itemLabel} available, in the order they were added. Choosing a range replaces any current selection.
          </p>

          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="text-[11px] font-mono text-[var(--color-muted)] block mb-1.5">From</label>
              <input
                type="number"
                min={1}
                max={totalCount}
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="w-full h-10 px-3 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-lg text-[13px] font-mono text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-cobalt)]"
              />
            </div>
            <div className="text-[var(--color-muted)] pt-6">–</div>
            <div className="flex-1">
              <label className="text-[11px] font-mono text-[var(--color-muted)] block mb-1.5">To</label>
              <input
                type="number"
                min={1}
                max={totalCount}
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="w-full h-10 px-3 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-lg text-[13px] font-mono text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-cobalt)]"
              />
            </div>
          </div>

          <button
            type="button"
            onClick={() => { setFrom('1'); setTo(String(totalCount)); }}
            className="self-start text-[11px] font-mono font-bold text-[var(--color-accent-amber)] hover:underline"
          >
            All {totalCount} {itemLabel}
          </button>

          {invalid ? (
            <p className="text-[11px] font-mono text-[var(--color-error)]">
              Enter a valid range between 1 and {totalCount}.
            </p>
          ) : (
            <p className="text-[11px] font-mono text-[var(--color-success)]">
              {isFullRange ? `All ${totalCount} ${itemLabel} will print.` : `${count} ${itemLabel} will print (of ${totalCount}).`}
            </p>
          )}
        </div>

        <div className="flex border-t border-[var(--color-border)]">
          <button
            onClick={() => handleAction(onCancel)}
            className="flex-1 h-12 text-[13px] font-bold font-mono text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] transition-colors border-none bg-transparent cursor-pointer border-r border-[var(--color-border)]"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={invalid}
            className="flex-1 h-12 text-[13px] font-bold font-mono border-none cursor-pointer transition-colors text-[var(--color-accent-amber)] hover:bg-[var(--glow-amber)] bg-transparent disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Print Range
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
