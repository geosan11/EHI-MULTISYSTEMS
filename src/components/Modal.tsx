import React, { useState, useEffect, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { ICON } from '../lib/ui';

const SIZE_MAXW: Record<string, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
};

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode | ((closeWithAnimation: () => void) => ReactNode);
  /** Optional header bar with a title and a standard close control. */
  title?: string;
  /** Max width of the panel. Ignored if `containerClassName` is passed. Default 'lg'. */
  size?: keyof typeof SIZE_MAXW;
  /** Hide the auto close button (only relevant when `title` is set). */
  hideClose?: boolean;
  /** Close when Escape is pressed. Default true. */
  closeOnEsc?: boolean;
  backdropClassName?: string;
  containerClassName?: string;
  overlayZIndex?: string;
}

/**
 * Reusable Animated Modal Component.
 * - Slides UP when opened/clicked.
 * - Slides DOWN when closed or canceled.
 */
export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  children,
  title,
  size = 'lg',
  hideClose = false,
  closeOnEsc = true,
  backdropClassName = 'ehi-scrim',
  containerClassName,
  overlayZIndex = 'z-[99999]',
}) => {
  const [isRendered, setIsRendered] = useState(isOpen);
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      const onKey = (e: KeyboardEvent) => {
        if (closeOnEsc && e.key === 'Escape') handleClose();
      };
      window.addEventListener('keydown', onKey);
      return () => {
        document.body.style.overflow = prevOverflow;
        window.removeEventListener('keydown', onKey);
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, closeOnEsc]);

  useEffect(() => {
    if (isOpen) {
      setIsRendered(true);
      setIsClosing(false);
    } else if (isRendered && !isClosing) {
      handleClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleClose = () => {
    if (isClosing) return;
    setIsClosing(true);
    setTimeout(() => {
      setIsRendered(false);
      setIsClosing(false);
      onClose();
    }, 200); // matches CSS exit duration
  };

  if (!isRendered) return null;

  const container =
    containerClassName ??
    `w-full ${SIZE_MAXW[size] ?? SIZE_MAXW.lg} bg-[var(--color-surface-card)] rounded-2xl border border-[var(--color-border)] shadow-[var(--shadow-modal)] overflow-hidden h-auto max-h-[85vh] flex flex-col`;

  // Rendered via a portal directly into document.body -- not nested inside
  // whatever page/tab wrapper happens to render this component. A modal
  // nested in the normal component tree inherits any ancestor's CSS
  // (transform/filter/will-change all silently turn an ancestor into a
  // containing block for this modal's own `position: fixed`, breaking its
  // positioning) -- exactly what happened with .page-transition. Portaling
  // to body makes this immune to that regardless of what CSS any future
  // page wrapper adds. Matches the pattern already used correctly elsewhere
  // in this codebase (HtmlPrintReceipt.tsx / HtmlPrintWaybill.tsx).
  return createPortal(
    <div
      className={`fixed inset-0 w-screen h-screen ${overlayZIndex} flex items-center justify-center p-4 ${backdropClassName} ${
        isClosing ? 'animate-modal-backdrop-out' : 'animate-modal-backdrop-in'
      }`}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`${isClosing ? 'animate-modal-slide-out' : 'animate-modal-slide-in'} ${container}`}
      >
        {title && (
          <div className="flex items-center justify-between gap-3 p-4 border-b border-[var(--color-border)] shrink-0">
            <h2 className="text-[14px] font-bold text-[var(--color-foreground)] tracking-tight truncate">
              {title}
            </h2>
            {!hideClose && (
              <button
                onClick={handleClose}
                aria-label="Close"
                className="p-1 -mr-1 rounded-full text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer shrink-0"
              >
                <X size={ICON.md} />
              </button>
            )}
          </div>
        )}
        {typeof children === 'function' ? children(handleClose) : children}
      </div>
    </div>,
    document.body
  );
};
