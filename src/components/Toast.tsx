import { useEffect } from 'react';
import { CheckCircle, AlertCircle, Clock } from 'lucide-react';

export interface ToastProps {
  message: string;
  type: 'success' | 'error' | 'warning';
  onClose?: () => void;
}

export const Toast = ({ message, type, onClose }: ToastProps) => {
  useEffect(() => {
    if (!onClose) return;
    const timer = setTimeout(() => {
      onClose();
    }, 3500);
    return () => clearTimeout(timer);
  }, [onClose]);

  const config = {
    success: { icon: CheckCircle, color: 'var(--color-success)' },
    error: { icon: AlertCircle, color: 'var(--color-error)' },
    warning: { icon: Clock, color: 'var(--color-accent-amber)' },
  };

  const Icon = config[type].icon;

  return (
    <div className="absolute bottom-[80px] left-4 right-4 bg-[var(--color-surface-1)] border border-[var(--color-border)] shadow-2xl rounded p-3 flex items-center space-x-3 z-50 animate-in slide-in-from-bottom-5 fade-in duration-200">
      <Icon size={16} color={config[type].color} />
      <span className="text-[11px] font-mono text-[var(--color-foreground)] flex-1">{message}</span>
    </div>
  );
};
