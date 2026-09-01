import { useEffect, useState } from 'react';
import { CheckCircle, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastData {
  id: string;
  message: string;
  type: ToastType;
  title?: string;
}

interface ToastCardProps extends ToastData {
  onDismiss: (id: string) => void;
}

// Errors and warnings stay up longer than success/info -- the whole point of
// this component is that a failure should give the user enough time to
// actually read it, not flash past in the same 4s a "Saved!" gets.
const TOAST_CONFIG: Record<
  ToastType,
  { icon: typeof CheckCircle; label: string; color: string; bg: string; border: string; glow: string; duration: number }
> = {
  success: { 
    icon: CheckCircle, 
    label: 'Payment processed', 
    color: '#10b981', 
    bg: 'rgba(16, 185, 129, 0.07)', 
    border: 'rgba(16, 185, 129, 0.25)', 
    glow: 'rgba(16, 185, 129, 0.15)', 
    duration: 3500 
  },
  error: { 
    icon: AlertCircle, 
    label: 'Something went wrong', 
    color: '#f87171', 
    bg: 'rgba(239, 68, 68, 0.07)', 
    border: 'rgba(239, 68, 68, 0.25)', 
    glow: 'rgba(239, 68, 68, 0.15)', 
    duration: 7000 
  },
  warning: { 
    icon: AlertTriangle, 
    label: 'Connection failed', 
    color: '#fbbf24', 
    bg: 'rgba(251, 191, 36, 0.07)', 
    border: 'rgba(251, 191, 36, 0.25)', 
    glow: 'rgba(251, 191, 36, 0.15)', 
    duration: 5000 
  },
  info: { 
    icon: Info, 
    label: 'Update available', 
    color: '#60a5fa', 
    bg: 'rgba(96, 165, 250, 0.07)', 
    border: 'rgba(96, 165, 250, 0.25)', 
    glow: 'rgba(96, 165, 250, 0.15)', 
    duration: 4000 
  },
};

const ToastCard = ({ id, message, type, title, onDismiss }: ToastCardProps) => {
  const [leaving, setLeaving] = useState(false);
  const cfg = TOAST_CONFIG[type];
  const Icon = cfg.icon;

  const dismiss = () => {
    setLeaving(true);
    setTimeout(() => onDismiss(id), 180);
  };

  useEffect(() => {
    const timer = setTimeout(dismiss, cfg.duration);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      role="alert"
      className={`w-full pointer-events-auto overflow-hidden rounded-[20px] border backdrop-blur-xl transition-all duration-300 ${
        leaving
          ? 'animate-out fade-out translate-y-[-10px] scale-95 opacity-0'
          : 'animate-in fade-in slide-in-from-top-4 duration-300'
      }`}
      style={{
        backgroundColor: 'var(--toast-bg, ' + cfg.bg + ')',
        borderColor: 'var(--toast-border, ' + cfg.border + ')',
        boxShadow: `0 10px 30px -10px ${cfg.glow}, var(--shadow-sm)`,
      }}
    >
      <div className="flex items-center gap-3.5 p-3.5">
        <div
          className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center border"
          style={{ 
            backgroundColor: 'var(--toast-icon-bg, rgba(255,255,255,0.08))',
            borderColor: 'var(--toast-icon-border, rgba(255,255,255,0.04))'
          }}
        >
          <Icon size={16} color={cfg.color} strokeWidth={2.5} />
        </div>
        <div className="flex-1 min-w-0">
          <div
            className="text-[12px] font-sans font-extrabold tracking-wide"
            style={{ color: 'var(--toast-title-color, ' + cfg.color + ')' }}
          >
            {title || cfg.label}
          </div>
          <div 
            className="text-[12.5px] font-sans font-medium leading-snug break-words mt-0.5 opacity-90"
            style={{ color: 'var(--toast-text-color, var(--color-foreground))' }}
          >
            {message}
          </div>
        </div>
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="shrink-0 -mr-1 p-1.5 rounded-full text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:bg-white/10 transition-colors cursor-pointer"
        >
          <X size={14} />
        </button>
      </div>
      <div className="h-[2px] w-full bg-[var(--color-border-subtle)]">
        <div
          className="h-full"
          style={{
            backgroundColor: cfg.color,
            animation: leaving ? 'none' : `ehi-toast-shrink ${cfg.duration}ms linear forwards`,
          }}
        />
      </div>
    </div>
  );
};

export const ToastStack = ({
  toasts,
  onDismiss,
}: {
  toasts: ToastData[];
  onDismiss: (id: string) => void;
}) => {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed top-4 inset-x-0 z-[99999999] flex flex-col items-center gap-2 px-4 pointer-events-none">
      <div className="w-full max-w-sm flex flex-col gap-2">
        {toasts.map((t) => (
          <ToastCard key={t.id} {...t} onDismiss={onDismiss} />
        ))}
      </div>
    </div>
  );
};
