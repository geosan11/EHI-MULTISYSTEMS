import { useState } from 'react';
import { AlertTriangle, HelpCircle } from 'lucide-react';

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
}

interface ConfirmDialogProps extends ConfirmOptions {
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog = ({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) => {
  const [isClosing, setIsClosing] = useState(false);
  const isDanger = tone === 'danger';
  const Icon = isDanger ? AlertTriangle : HelpCircle;

  const handleAction = (callback: () => void) => {
    if (isClosing) return;
    setIsClosing(true);
    setTimeout(() => {
      callback();
    }, 200);
  };

  return (
    <div
      className={`fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center p-4 ${
        isClosing ? 'animate-modal-backdrop-out' : 'animate-modal-backdrop-in'
      }`}
      role="alertdialog"
      aria-modal="true"
      aria-label={title || 'Confirm'}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleAction(onCancel);
      }}
    >
      <div className={`w-full max-w-sm bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-strong)] shadow-2xl overflow-hidden ${
        isClosing ? 'animate-modal-slide-out' : 'animate-modal-slide-in'
      }`}>
        <div className="p-5 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Icon size={18} className={isDanger ? 'text-[var(--color-error)]' : 'text-[var(--color-accent-amber)]'} />
            {title && (
              <h3 className="text-[13px] font-bold text-[var(--color-foreground)] uppercase font-mono">{title}</h3>
            )}
          </div>
          <p className="text-[13px] text-[var(--color-light-muted)] font-sans leading-relaxed">{message}</p>
        </div>
        <div className="flex border-t border-[var(--color-border)]">
          <button
            onClick={() => handleAction(onCancel)}
            aria-label={cancelLabel}
            className="flex-1 h-12 text-[13px] font-bold font-mono text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] transition-colors border-none bg-transparent cursor-pointer border-r border-[var(--color-border)]"
          >
            {cancelLabel}
          </button>
          <button
            onClick={() => handleAction(onConfirm)}
            aria-label={confirmLabel}
            className={
              isDanger
                ? 'flex-1 h-12 text-[13px] font-bold font-mono border-none cursor-pointer transition-colors text-[var(--color-error)] hover:bg-[var(--glow-error)] bg-transparent'
                : 'flex-1 h-12 text-[13px] font-bold font-mono border-none cursor-pointer transition-colors text-[var(--color-accent-amber)] hover:bg-[var(--glow-amber)] bg-transparent'
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
