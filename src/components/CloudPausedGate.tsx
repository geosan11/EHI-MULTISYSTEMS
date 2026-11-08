import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { EHILogo } from './EHILogo';
import { AlertTriangle, ShieldCheck, Database, Lock } from 'lucide-react';
import { lockBodyScroll, unlockBodyScroll } from '../lib/bodyScrollLock';

/**
 * Byte-identical sentinel key for the one-time hard refresh release check.
 * Retained semantically and byte-identical to maintain release compatibility without rearming.
 */
export const FORCED_RELOAD_KEY = 'ehi_forced_reload_subscription_notice_20261106';

/**
 * Exact title and body copy specified by user.
 * Note: Display claims supplied by user, NOT independently verified.
 */
export const CLOUD_PAUSED_TITLE = 'EHI MULTISYSTEMS \u2014 CLOUD INSTANCE PAUSED';
export const CLOUD_PAUSED_BODY =
  'Subscription renewal for Vercel & Supabase production hosting (Invoice Date: 28 Oct 2026 \u2014 \u20a663,000) is overdue. All station cargo records are safely backed up and intact. Service will resume automatically upon billing clearance.';

export const GATE_CONTAINER_ID = 'ehi-cloud-paused-gate-root';

export function getOrCreateGateContainer(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  let el = document.getElementById(GATE_CONTAINER_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = GATE_CONTAINER_ID;
    document.body.appendChild(el);
  }
  return el;
}

/**
 * Non-dismissible frontend gate displaying cloud instance paused status.
 * - Displays on every app refresh / load for operational routes.
 * - Non-dismissible: NO dismiss/close button, NO Escape key dismissal, NO backdrop dismissal, NO bypass control.
 * - Prevents staff cargo processing, receipt printing, and ledger access via pointer or keyboard.
 * - Frontend-only gate: underlying operational UI stays mounted for background sync and offline data integrity.
 * - Public tracking route (/track) is excluded and remains fully accessible.
 * - All display claims supplied by user, NOT independently verified.
 */
export const CloudPausedGate: React.FC = () => {
  const dialogRef = useRef<HTMLDivElement>(null);

  const [isOpen] = useState(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        // Do not display on the pass about to trigger the one-time hard refresh
        if (!localStorage.getItem(FORCED_RELOAD_KEY)) {
          return false;
        }
      }
    } catch {
      // Storage unavailable / restricted, allow normal in-memory display
    }
    return true;
  });

  const isPublicTrack = typeof window !== 'undefined' && window.location.pathname.startsWith('/track');

  const [container, setContainer] = useState<HTMLElement | null>(() => {
    if (typeof window === 'undefined' || isPublicTrack) return null;
    return getOrCreateGateContainer();
  });

  useEffect(() => {
    if (!container && typeof document !== 'undefined' && !isPublicTrack && isOpen) {
      setContainer(getOrCreateGateContainer());
    }
  }, [container, isPublicTrack, isOpen]);

  // Inert management for all sibling elements (including dynamic portals)
  useEffect(() => {
    if (!isOpen || isPublicTrack || typeof document === 'undefined') return;

    const gateContainer = getOrCreateGateContainer();
    if (!gateContainer) return;

    lockBodyScroll();

    const markSiblingsInert = () => {
      const children = Array.from(document.body.children);
      for (const child of children) {
        if (child === gateContainer) continue;
        if (child.tagName === 'SCRIPT' || child.tagName === 'STYLE' || child.tagName === 'LINK') continue;
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

    markSiblingsInert();

    // Observe document.body so any dynamic portals (toasts, modals, sheets) escaping inert are immediately caught
    const observer = new MutationObserver(() => {
      markSiblingsInert();
    });
    observer.observe(document.body, { childList: true });

    // Focus the alertdialog
    dialogRef.current?.focus();

    return () => {
      observer.disconnect();
      unlockBodyScroll();

      // Clean up attributes applied to siblings
      const children = Array.from(document.body.children);
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

      if (gateContainer && gateContainer.parentNode && gateContainer.childNodes.length === 0) {
        gateContainer.parentNode.removeChild(gateContainer);
      }
    };
  }, [isOpen, isPublicTrack]);

  // Capture-phase key, pointer, and focus blocking
  useEffect(() => {
    if (!isOpen || isPublicTrack || typeof window === 'undefined') return;

    const handleKeyCapture = (e: KeyboardEvent) => {
      // Escape is always blocked - NO Escape dismissal
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        return;
      }

      // Block Ctrl+P / Cmd+P to prevent receipt / screen printing
      if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        return;
      }

      const gateContainer = getOrCreateGateContainer();
      // If event originated outside gate container (e.g. global window listeners, barcode scanner bursts)
      if (!gateContainer || !gateContainer.contains(e.target as Node)) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        return;
      }

      // Prevent Tab from moving focus outside the alertdialog
      if (e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        return;
      }
    };

    const handlePointerCapture = (e: Event) => {
      const gateContainer = getOrCreateGateContainer();
      // Allow interactions within the gate container (e.g. reading, vertical scrolling of the notice)
      if (gateContainer && gateContainer.contains(e.target as Node)) {
        return;
      }
      // Any pointer interaction targeting outside the gate container is completely stopped
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    };

    const handleFocusCapture = (e: FocusEvent) => {
      const dialog = dialogRef.current;
      if (dialog && e.target && !dialog.contains(e.target as Node)) {
        e.preventDefault();
        dialog.focus();
      }
    };

    window.addEventListener('keydown', handleKeyCapture, { capture: true });
    window.addEventListener('keypress', handleKeyCapture, { capture: true });
    window.addEventListener('keyup', handleKeyCapture, { capture: true });

    window.addEventListener('pointerdown', handlePointerCapture, { capture: true });
    window.addEventListener('mousedown', handlePointerCapture, { capture: true });
    window.addEventListener('mouseup', handlePointerCapture, { capture: true });
    window.addEventListener('click', handlePointerCapture, { capture: true });
    window.addEventListener('touchstart', handlePointerCapture, { capture: true });
    window.addEventListener('touchend', handlePointerCapture, { capture: true });
    window.addEventListener('contextmenu', handlePointerCapture, { capture: true });

    window.addEventListener('focusin', handleFocusCapture, { capture: true });

    return () => {
      window.removeEventListener('keydown', handleKeyCapture, { capture: true });
      window.removeEventListener('keypress', handleKeyCapture, { capture: true });
      window.removeEventListener('keyup', handleKeyCapture, { capture: true });

      window.removeEventListener('pointerdown', handlePointerCapture, { capture: true });
      window.removeEventListener('mousedown', handlePointerCapture, { capture: true });
      window.removeEventListener('mouseup', handlePointerCapture, { capture: true });
      window.removeEventListener('click', handlePointerCapture, { capture: true });
      window.removeEventListener('touchstart', handlePointerCapture, { capture: true });
      window.removeEventListener('touchend', handlePointerCapture, { capture: true });
      window.removeEventListener('contextmenu', handlePointerCapture, { capture: true });

      window.removeEventListener('focusin', handleFocusCapture, { capture: true });
    };
  }, [isOpen, isPublicTrack]);

  if (!isOpen || isPublicTrack || !container) {
    return null;
  }

  return createPortal(
    <div
      id="ehi-cloud-paused-backdrop"
      className="fixed inset-0 w-screen h-screen z-[999999] flex items-center justify-center p-4 sm:p-6 overflow-y-auto"
      style={{
        backgroundColor: 'rgba(7, 9, 14, 0.95)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        zIndex: 999999,
      }}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby="cloud-paused-title"
        aria-describedby="cloud-paused-description"
        className="relative w-full max-w-xl rounded-2xl shadow-2xl overflow-hidden focus:outline-none p-6 sm:p-8 flex flex-col gap-6 text-left my-auto"
        style={{
          backgroundColor: 'var(--color-surface-sunken, #0b0d13)',
          border: '1px solid var(--color-border-strong, rgba(255, 255, 255, 0.14))',
          boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.9), 0 0 0 1px rgba(255, 255, 255, 0.08)',
        }}
      >
        {/* Accent top gradient line: EHI Gold and Cobalt */}
        <div
          className="absolute top-0 left-0 right-0 h-1.5"
          style={{
            background: 'linear-gradient(90deg, #F59E0B 0%, #025AAA 50%, #F59E0B 100%)',
          }}
        />

        {/* Top brand & badges */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex items-center gap-3">
            <EHILogo width={38} height={28} className="shrink-0" />
            <span
              className="text-[12px] font-mono font-bold uppercase tracking-wider"
              style={{ color: '#F59E0B' }}
            >
              EHI Cloud Gateway
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono font-bold uppercase tracking-wider"
              style={{
                backgroundColor: 'rgba(245, 158, 11, 0.12)',
                border: '1px solid rgba(245, 158, 11, 0.35)',
                color: '#F59E0B',
              }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              Service Suspended
            </span>
            <span
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-mono font-bold uppercase tracking-wider"
              style={{
                backgroundColor: 'rgba(2, 90, 170, 0.15)',
                border: '1px solid rgba(2, 90, 170, 0.4)',
                color: '#60A5FA',
              }}
            >
              Production
            </span>
          </div>
        </div>

        {/* Title and main description */}
        <div className="flex items-start gap-4">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
            style={{
              backgroundColor: 'rgba(245, 158, 11, 0.12)',
              border: '1px solid rgba(245, 158, 11, 0.3)',
            }}
          >
            <AlertTriangle size={24} style={{ color: '#F59E0B' }} />
          </div>

          <div className="flex-1 min-w-0">
            <h1
              id="cloud-paused-title"
              className="text-lg sm:text-xl font-bold font-mono tracking-tight leading-snug"
              style={{ color: 'var(--color-foreground, #f1f5f9)' }}
            >
              {CLOUD_PAUSED_TITLE}
            </h1>
            <p
              id="cloud-paused-description"
              className="mt-3 text-[14px] sm:text-[15px] font-normal leading-relaxed"
              style={{ color: 'var(--color-text-secondary, #c3ccd9)' }}
            >
              {CLOUD_PAUSED_BODY}
            </p>
          </div>
        </div>

        {/* Status Verification Panel */}
        <div
          className="rounded-xl p-4 sm:p-5 flex flex-col gap-3.5"
          style={{
            backgroundColor: 'var(--color-surface-1, #1a1f2e)',
            border: '1px solid var(--color-border, rgba(255, 255, 255, 0.08))',
          }}
        >
          <div className="flex items-center justify-between text-xs font-mono pb-2 border-b border-white/5">
            <span className="text-[var(--color-muted,#8b97a8)] uppercase tracking-wider">
              Infrastructure Scope
            </span>
            <span className="text-[var(--color-foreground,#f1f5f9)] font-semibold">
              Vercel Edge &amp; Supabase Database
            </span>
          </div>

          <div className="flex items-center justify-between text-xs font-mono pb-2 border-b border-white/5">
            <span className="text-[var(--color-muted,#8b97a8)] uppercase tracking-wider">
              Invoice Clearance
            </span>
            <span className="text-amber-400 font-semibold">
              28 Oct 2026 &bull; &#8358;63,000 (Past Due)
            </span>
          </div>

          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-[var(--color-muted,#8b97a8)] uppercase tracking-wider flex items-center gap-1.5">
              <ShieldCheck size={14} className="text-green-400" />
              Local Storage State
            </span>
            <span className="text-green-400 font-semibold flex items-center gap-1">
              Station Records Intact &amp; Backed Up
            </span>
          </div>
        </div>

        {/* Informational reassurance notice */}
        <div
          className="p-3.5 rounded-lg flex items-start gap-3 text-xs"
          style={{
            backgroundColor: 'rgba(2, 90, 170, 0.1)',
            border: '1px solid rgba(2, 90, 170, 0.25)',
            color: '#93C5FD',
          }}
        >
          <Database size={16} className="shrink-0 mt-0.5 text-blue-400" />
          <div className="leading-relaxed">
            All offline IndexedDB queues, customer waybill records, and local ledger balances remain safely preserved. Operational console access and cloud synchronization endpoints will resume automatically once invoice clearance is verified.
          </div>
        </div>

        {/* Lockout notice without dismiss */}
        <div
          className="pt-2 flex items-center justify-between text-[11px] font-mono text-[var(--color-muted,#8b97a8)] border-t border-white/5"
        >
          <span className="flex items-center gap-1.5">
            <Lock size={12} className="text-amber-400" />
            Terminal interaction locked
          </span>
          <span className="italic">
            Administrative billing clearance required
          </span>
        </div>
      </div>
    </div>,
    container
  );
};
