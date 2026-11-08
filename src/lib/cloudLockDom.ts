import { GATE_CONTAINER_ID } from '../config/cloudLockConfig';

export function getOrCreateGateContainer(containerId = GATE_CONTAINER_ID): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  let el = document.getElementById(containerId);
  if (!el) {
    el = document.createElement('div');
    el.id = containerId;
    document.body.appendChild(el);
  }
  return el;
}

/**
 * Marks all sibling elements of the gate container as inert and aria-hidden.
 * Employs a MutationObserver on document.body so dynamic portals (modals, toasts, floating sheets)
 * escaping inert are caught immediately.
 * Returns a teardown function restoring previous attributes.
 */
export function applySiblingInert(
  gateContainer: HTMLElement,
  doc: Document = document
): () => void {
  const markSiblings = () => {
    const children = Array.from(doc.body.children);
    for (const child of children) {
      if (child === gateContainer) continue;
      if (child.tagName === 'SCRIPT' || child.tagName === 'STYLE' || child.tagName === 'LINK') {
        continue;
      }
      if (!child.hasAttribute('inert')) {
        child.setAttribute('inert', '');
        child.setAttribute('data-ehi-gate-inert', 'true');
      }
      if (!child.hasAttribute('aria-hidden')) {
        child.setAttribute('aria-hidden', 'true');
        child.setAttribute('data-ehi-gate-aria', 'true');
      }
    }
  };

  markSiblings();

  let observer: MutationObserver | null = null;
  if (typeof MutationObserver !== 'undefined') {
    observer = new MutationObserver(() => {
      markSiblings();
    });
    observer.observe(doc.body, { childList: true });
  }

  return () => {
    if (observer) {
      observer.disconnect();
    }
    const children = Array.from(doc.body.children);
    for (const child of children) {
      if (child.getAttribute('data-ehi-gate-inert') === 'true') {
        child.removeAttribute('inert');
        child.removeAttribute('data-ehi-gate-inert');
      }
      if (child.getAttribute('data-ehi-gate-aria') === 'true') {
        child.removeAttribute('aria-hidden');
        child.removeAttribute('data-ehi-gate-aria');
      }
    }
  };
}

/**
 * Determines whether a keyboard event should be blocked.
 * Stop propagation is always applied to prevent bubbling to operational listeners (e.g. barcode scanner buffers).
 */
export function shouldBlockKey(
  event: { key: string; ctrlKey?: boolean; metaKey?: boolean },
  isInsideGate: boolean
): { preventDefault: boolean; stopPropagation: boolean } {
  // Always stop propagation to prevent operational key handling
  const stopPropagation = true;

  // Escape is blocked unconditionally - NO dismiss
  if (event.key === 'Escape') {
    return { preventDefault: true, stopPropagation };
  }

  // Ctrl+P / Cmd+P blocked unconditionally to prevent printing
  if ((event.ctrlKey || event.metaKey) && (event.key === 'p' || event.key === 'P')) {
    return { preventDefault: true, stopPropagation };
  }

  // Outside gate: prevent all key defaults
  if (!isInsideGate) {
    return { preventDefault: true, stopPropagation };
  }

  // Inside gate: allow key default (scrolling, tabbing, clicking)
  return { preventDefault: false, stopPropagation };
}

/**
 * Traps focus inside the gate container when Tab or Shift+Tab is pressed.
 */
export function trapFocus(event: KeyboardEvent, container: HTMLElement | null): void {
  if (!container) return;

  const focusable = container.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );

  if (focusable.length === 0) {
    event.preventDefault();
    container.focus();
    return;
  }

  const firstElement = focusable[0];
  const lastElement = focusable[focusable.length - 1];
  const currentActive = document.activeElement;

  if (event.shiftKey) {
    if (currentActive === firstElement || !container.contains(currentActive)) {
      event.preventDefault();
      lastElement.focus();
    }
  } else {
    if (currentActive === lastElement || !container.contains(currentActive)) {
      event.preventDefault();
      firstElement.focus();
    }
  }
}
