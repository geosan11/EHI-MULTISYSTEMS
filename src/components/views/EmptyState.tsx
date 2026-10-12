import { FolderOpen } from 'lucide-react';
import type { ReactNode } from 'react';

interface EmptyStateAction {
  label: string;
  onClick: () => void;
}

interface EmptyStateProps {
  message?: string;
  icon?: ReactNode;
  title?: string;
  subtext?: string;
  actions?: EmptyStateAction[];
}

export const EmptyState = ({ message = "No data available.", icon, title, subtext, actions }: EmptyStateProps) => {
  return (
    <div className="flex flex-col items-center justify-center p-8 py-12 text-center bg-[var(--color-surface-card)] rounded-xl border border-dashed border-[var(--color-surface-2)]">
      <div className="mb-3 text-[var(--color-muted)]">
        {icon || <FolderOpen size={36} strokeWidth={1.5} />}
      </div>
      {title ? (
        <>
          <p className="text-[14px] font-semibold text-[var(--color-foreground)] font-sans">{title}</p>
          <p className="text-[12px] text-[var(--color-muted)] font-sans mt-1 mb-4 max-w-xs">{subtext ?? message}</p>
        </>
      ) : (
        <p className="text-[14px] font-mono text-[var(--color-muted)] max-w-xs">{message}</p>
      )}
      {actions && actions.length > 0 && (
        <div className="flex gap-2 flex-wrap justify-center">
          {actions.map(({ label, onClick }) => (
            <button
              key={label}
              onClick={onClick}
              className="px-3 py-1.5 bg-[rgba(251,191,36,0.1)] border border-[rgba(251,191,36,0.3)] text-[var(--color-accent-amber)] text-[11px] font-bold rounded-lg"
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
