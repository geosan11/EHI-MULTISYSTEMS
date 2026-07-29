const SIZES = {
  md: { track: 'w-[52px] h-[28px]', knob: 'w-[22px] h-[22px]', travel: 24 },
  sm: { track: 'w-[34px] h-[18px]', knob: 'w-[14px] h-[14px]', travel: 16 },
};

export const GlassToggle = ({
  checked,
  onChange,
  size = 'md',
}: {
  checked: boolean;
  onChange: () => void;
  size?: keyof typeof SIZES;
}) => {
  const { track, knob, travel } = SIZES[size];
  return (
    <button
      type="button"
      onClick={onChange}
      role="switch"
      aria-checked={checked}
      className={`relative ${track} rounded-full p-0.5 transition-all duration-300 ease-in-out cursor-pointer outline-none shrink-0`}
      style={{
        background: checked
          ? 'linear-gradient(90deg, rgba(251,191,36,0.20) 0%, rgba(217,119,6,0.30) 100%)'
          : 'var(--color-surface-2)',
        border: checked ? '1px solid rgba(251,191,36,0.40)' : '1px solid var(--color-border-strong)',
        boxShadow: checked ? '0 0 12px rgba(252,191,73,0.25)' : 'var(--shadow-xs)',
      }}
    >
      {checked && (
        <span className="absolute inset-0 rounded-full bg-amber-400/5 blur-[4px] animate-pulse" />
      )}
      <span
        className={`block ${knob} rounded-full transition-all duration-300 ease-in-out shadow-md border ${
          checked
            ? 'bg-gradient-to-br from-amber-300 to-amber-500 border-amber-300/80 shadow-[0_2px_6px_rgba(252,191,73,0.4)]'
            : ''
        }`}
        style={{
          transform: checked ? `translateX(${travel}px)` : 'translateX(0)',
          ...(checked ? {} : { background: 'var(--color-surface-card)', borderColor: 'var(--color-border-strong)' }),
        }}
      />
    </button>
  );
};
