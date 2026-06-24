import { Loader2 } from 'lucide-react';

interface LoadingStateProps {
  message?: string;
  fullScreen?: boolean;
}

export const LoadingState = ({ message = "Loading...", fullScreen = false }: LoadingStateProps) => {
  const containerClass = fullScreen 
    ? "absolute inset-0 flex flex-col items-center justify-center bg-[var(--color-overlay)] z-50 backdrop-blur-sm"
    : "flex flex-col items-center justify-center py-12 w-full";

  return (
    <div className={containerClass}>
      <Loader2 size={32} className="animate-spin text-[var(--color-accent-amber)] mb-3" />
      <p className="text-[13px] font-mono text-[var(--color-foreground)] tracking-widest uppercase">{message}</p>
    </div>
  );
};
