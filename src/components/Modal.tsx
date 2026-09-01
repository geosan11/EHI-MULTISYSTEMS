import React, { useState, useEffect, ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode | ((closeWithAnimation: () => void) => ReactNode);
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
  backdropClassName = 'ehi-scrim',
  containerClassName = 'w-full max-w-lg bg-[var(--color-surface-card)] rounded-2xl border border-[var(--color-border)] shadow-2xl overflow-hidden h-auto max-h-[85vh] flex flex-col',
  overlayZIndex = 'z-[99999]',
}) => {
  const [isRendered, setIsRendered] = useState(isOpen);
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = prevOverflow;
      };
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setIsRendered(true);
      setIsClosing(false);
    } else if (isRendered && !isClosing) {
      handleClose();
    }
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
        className={`${
          isClosing ? 'animate-modal-slide-out' : 'animate-modal-slide-in'
        } ${containerClassName}`}
      >
        {typeof children === 'function' ? children(handleClose) : children}
      </div>
    </div>,
    document.body
  );
};
