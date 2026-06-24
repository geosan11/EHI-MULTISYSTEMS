import { useEffect } from 'react';
import { CheckCircle, AlertCircle, Clock, Info } from 'lucide-react';

export interface ToastProps {
  message: string;
  type: 'success' | 'error' | 'warning' | 'info';
  onClose?: () => void;
}

export const Toast = ({ message, type, onClose }: ToastProps) => {
  useEffect(() => {
    if (!onClose) return;
    const timer = setTimeout(() => {
      onClose();
    }, 4000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const config = {
    success: { icon: CheckCircle, color: 'var(--color-success)', bg: 'rgba(16,185,129,0.1)', border: 'rgba(16,185,129,0.3)' },
    error: { icon: AlertCircle, color: 'var(--color-error)', bg: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.3)' },
    warning: { icon: Clock, color: 'var(--color-accent-amber)', bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.3)' },
    info: { icon: Info, color: 'var(--color-accent-cobalt)', bg: 'rgba(59,130,246,0.1)', border: 'rgba(59,130,246,0.3)' },
  };

  const Icon = config[type].icon;

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 w-[90%] max-w-sm z-[9999] pointer-events-none animate-in slide-in-from-top-4 fade-in duration-300">
      <div 
        className="ehi-card p-3 flex items-center space-x-3 backdrop-blur-md"
        style={{ 
          backgroundColor: 'var(--color-surface-card)', 
          borderColor: config[type].border,
          boxShadow: `0 4px 12px ${config[type].bg}`
        }}
      >
        <div className="p-1 rounded-full flex-shrink-0" style={{ backgroundColor: config[type].bg }}>
          <Icon size={16} color={config[type].color} />
        </div>
        <span className="text-[13px] font-medium font-sans text-[var(--color-foreground)] flex-1">{message}</span>
      </div>
    </div>
  );
};
