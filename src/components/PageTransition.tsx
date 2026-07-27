import { ReactNode } from 'react';

/**
 * PageTransition
 * Wraps page-level content with a CSS scroll-slide-up animation.
 * Pass a unique `pageKey` (e.g. the route/tab name) so React re-mounts
 * the wrapper — and therefore re-fires the animation — whenever it changes.
 */
export const PageTransition = ({
  pageKey,
  children,
  className = '',
}: {
  pageKey: string;
  children: ReactNode;
  className?: string;
}) => (
  <div
    key={pageKey}
    className={`page-transition ${className}`}
    style={{ display: 'contents' }}
  >
    {children}
  </div>
);
