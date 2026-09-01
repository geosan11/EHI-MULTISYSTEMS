import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { ICON } from '../../lib/ui';

// Drawer / bottom-sheet primitive. The app has no such component today --
// mobile sheets are faked per-file with `items-end` + `rounded-t-2xl`.
// Shares the .ehi-scrim backdrop, portal, scroll-lock and Esc-to-close with Modal.

const SIZE = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
} as const;

export const Sheet = ({
  isOpen,
  onClose,
  side = 'bottom',
  size = 'md',
  title,
  children,
  className = '',
}: {
  isOpen: boolean;
  onClose: () => void;
  side?: 'bottom' | 'right';
  size?: keyof typeof SIZE;
  title?: string;
  children: ReactNode;
  className?: string;
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const panelPos =
    side === 'bottom'
      ? 'inset-x-0 bottom-0 w-full rounded-t-2xl animate-in slide-in-from-bottom-4'
      : 'inset-y-0 right-0 h-full rounded-l-2xl animate-in slide-in-from-right-4';

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex ehi-scrim animate-in fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`absolute bg-[var(--color-surface-card)] border border-[var(--color-border)] shadow-[var(--shadow-modal)] flex flex-col max-h-[92vh] ${
          side === 'right' ? 'w-full' : ''
        } ${SIZE[size]} ${side === 'right' ? '' : 'mx-auto'} ${panelPos} ${className}`}
      >
        {title && (
          <div className="flex items-center justify-between gap-3 p-4 border-b border-[var(--color-border)] shrink-0">
            <h2 className="text-[14px] font-bold text-[var(--color-foreground)] tracking-tight">{title}</h2>
            <button
              onClick={onClose}
              aria-label="Close"
              className="p-1 rounded-full text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"
            >
              <X size={ICON.md} />
            </button>
          </div>
        )}
        <div className="overflow-y-auto flex-1">{children}</div>
      </div>
    </div>,
    document.body,
  );
};
