import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';

interface PaymentNarrationBoxProps {
  narrationCode: string;
}

export const PaymentNarrationBox: React.FC<PaymentNarrationBoxProps> = ({ narrationCode }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(narrationCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!narrationCode) return null;

  return (
    <div className="mt-4 p-4 border border-[var(--color-accent-amber)] rounded-lg bg-[rgba(251,191,36,0.05)] animate-in fade-in slide-in-from-top-2">
      <div className="text-[10px] font-bold text-[var(--color-accent-amber)] uppercase tracking-wider mb-2">
        PAYMENT NARRATION — share with customer
      </div>
      <div className="flex items-center justify-between bg-[var(--color-surface-1)] p-3 rounded border border-[rgba(251,191,36,0.2)]">
        <span className="font-mono text-lg font-bold text-[var(--color-foreground)] tracking-widest">{narrationCode}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center space-x-1 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)] text-[var(--color-muted)] hover:text-[var(--color-foreground)] px-3 py-1.5 rounded transition-colors text-[11px] font-bold"
        >
          {copied ? (
            <>
              <Check size={14} className="text-[var(--color-success)]" />
              <span className="text-[var(--color-success)]">Copied ✓</span>
            </>
          ) : (
            <>
              <Copy size={14} />
              <span>COPY</span>
            </>
          )}
        </button>
      </div>
      <div className="text-[11px] text-[var(--color-muted)] mt-2">
        Ask customer to type this exactly as the transfer narration / description when sending payment
      </div>
    </div>
  );
};
