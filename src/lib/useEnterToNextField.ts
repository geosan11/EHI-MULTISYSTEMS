import { useEffect, RefObject } from 'react';

const FOCUSABLE_SELECTOR = 'input:not([type="hidden"]):not([disabled]), select:not([disabled])';

// Scoped to a container ref (not document-wide) so this never interferes
// with the app's existing single-input Enter shortcuts elsewhere (e.g. the
// public tracking search box, Scanner's lookup fields, the ledger's POS-code
// input) -- those live outside whichever form container calls this hook.
export function useEnterToNextField(containerRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return;
      const target = e.target as HTMLElement;
      // Textareas keep Enter as a newline; buttons keep Enter as a click.
      if (target.tagName !== 'INPUT' && target.tagName !== 'SELECT') return;
      if (target instanceof HTMLInputElement) {
        const skipTypes = ['submit', 'button', 'checkbox', 'radio'];
        if (skipTypes.includes(target.type)) return;
      }

      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter(el => el.offsetParent !== null);

      const idx = focusable.indexOf(target);
      if (idx === -1 || idx >= focusable.length - 1) return;

      e.preventDefault();
      focusable[idx + 1].focus();
    };

    container.addEventListener('keydown', handleKeyDown);
    return () => container.removeEventListener('keydown', handleKeyDown);
  }, [containerRef]);
}
