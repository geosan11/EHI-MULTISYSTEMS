export const FiIcon = ({ name, className = '', size }: { name: string; className?: string; size?: number }) => (
  <i className={`fi fi-br-${name} ${className}`} style={size ? { fontSize: size } : {}} />
);
