import React, { useState, useEffect, ReactNode } from 'react';

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
  backdropClassName = 'bg-black/80 backdrop-blur-md',
  containerClassName = 'w-full max-w-lg bg-[var(--color-surface-card)] rounded-2xl border border-[var(--color-border)] shadow-2xl overflow-hidden',
  overlayZIndex = 'z-50',
}) => {
  const [isRendered, setIsRendered] = useState(isOpen);
  const [isClosing, setIsClosing] = useState(false);

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

  return (
    <div
      className={`fixed inset-0 ${overlayZIndex} flex items-center justify-center p-4 ${backdropClassName} ${
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
    </div>
  );
};
