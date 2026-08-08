import { ArrowLeft } from "lucide-react";

// Every view screen used to hand-roll its own back button -- 27 separate
// copies with icon sizes ranging 12-20px and inconsistent (often
// nonexistent) padding, several small enough that users reported struggling
// to see or tap them. One shared, deliberately larger touch target instead.
//
// Originally transparent/borderless (only a hover background), which solved
// the touch-target-size problem but not visual affordance -- on a touch
// device there's no hover state to reveal it's clickable at all, so it read
// as plain text/an icon, not a button, until tapped. Now has a visible
// background/border by default, matching the app's standard secondary-
// button look, so it reads as tappable without relying on hover.
export const BackButton = ({
  onClick,
  label,
  className = "",
}: {
  onClick: () => void;
  label?: string;
  className?: string;
}) => (
  <button
    onClick={onClick}
    aria-label="Back"
    className={`flex items-center gap-1.5 h-9 px-3 rounded-xl bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-accent-amber)] hover:text-[var(--color-accent-amber)] transition-colors cursor-pointer shrink-0 ${className}`}
  >
    <ArrowLeft size={18} strokeWidth={2.25} />
    {label && <span className="text-[11px] font-mono font-bold">{label}</span>}
  </button>
);
