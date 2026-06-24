import { FolderOpen } from 'lucide-react';

interface EmptyStateProps {
  message?: string;
  icon?: React.ReactNode;
}

export const EmptyState = ({ message = "No data available.", icon }: EmptyStateProps) => {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center opacity-70">
      <div className="mb-3 text-[var(--color-muted)]">
        {icon || <FolderOpen size={48} strokeWidth={1} />}
      </div>
      <p className="text-[14px] font-mono text-[var(--color-muted)] max-w-xs">{message}</p>
    </div>
  );
};
