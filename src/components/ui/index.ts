// Shared UI primitives. Prefer these over hand-rolled buttons / inputs /
// cards / modals. Each wraps the existing .ehi-* classes and Phase 0 tokens
// -- no new visual language.

export { Button } from './Button';
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button';

export { TextField, Select, Textarea } from './Field';
export type { TextFieldProps, SelectFieldProps, TextareaFieldProps } from './Field';

export { Card } from './Card';
export type { CardProps } from './Card';

export { Badge } from './Badge';
export type { BadgeTone } from './Badge';

export { Tabs } from './Tabs';
export type { TabItem } from './Tabs';

export { PageHeader } from './PageHeader';
export { Spinner } from './Spinner';
export { Skeleton, SkeletonText } from './Skeleton';
export { Sheet } from './Sheet';

// Pre-existing primitives, re-exported for a single import point.
export { AnimatedNumber } from './AnimatedNumber';
export { GlassToggle } from './GlassToggle';
export { StatusBadge, flightStatusMeta } from './StatusBadge';
export type { FlightStatus } from './StatusBadge';
