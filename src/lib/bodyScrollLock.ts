// Ref-counted body scroll lock, shared by every overlay that wants to stop
// the page behind it from scrolling (Modal, ConfirmDialog, ...).
//
// The old per-component pattern saved `document.body.style.overflow` on mount
// and restored that saved value on unmount. Stacked overlays broke it: a
// ConfirmDialog opened over a Modal saved `'hidden'` (the Modal's own lock),
// then if the Modal unmounted first, the ConfirmDialog's cleanup restored
// `'hidden'` and the page was permanently unscrollable. Counting locks fixes
// that -- the body only unlocks when the last holder releases.

let lockCount = 0;
let savedOverflow: string | null = null;

export function lockBodyScroll(): void {
  if (lockCount === 0) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  lockCount += 1;
}

export function unlockBodyScroll(): void {
  if (lockCount === 0) return;
  lockCount -= 1;
  if (lockCount === 0) {
    document.body.style.overflow = savedOverflow ?? '';
    savedOverflow = null;
  }
}
