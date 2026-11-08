import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { EHILogo } from './EHILogo';
import { AlertTriangle, Lock, CheckCircle2, ShieldAlert, Loader2 } from 'lucide-react';
import { lockBodyScroll, unlockBodyScroll } from '../lib/bodyScrollLock';
import {
  CLOUD_PAUSED_TITLE,
  CLOUD_PAUSED_BODY,
  FORCED_RELOAD_KEY,
  PRICING_CARDS,
  isPublicTrackingPath,
  isBillingCallbackPath,
  isExemptFromLock,
  isPaymentConfigured,
  PricingCardConfig,
  PlanId,
} from '../config/cloudLockConfig';
import { useCloudLockSchedule } from '../lib/cloudLockSchedule';
import { useBillingEntitlement } from '../hooks/useBillingEntitlement';
import { initializeBillingCheckout } from '../lib/billingApi';
import {
  getOrCreateGateContainer,
  applySiblingInert,
  shouldBlockKey,
  trapFocus,
} from '../lib/cloudLockDom';

export {
  CLOUD_PAUSED_TITLE,
  CLOUD_PAUSED_BODY,
  FORCED_RELOAD_KEY,
  PRICING_CARDS,
  isCloudLockActive,
  isBridgeCardVisible,
  isPublicTrackingPath,
  isBillingCallbackPath,
  isExemptFromLock,
} from '../config/cloudLockConfig';

/**
 * Non-dismissible frontend gate displaying scheduled cloud instance lock.
 * - Displays when Date.now() >= 2026-11-09T07:58:00+01:00 on operational routes.
 * - Auto-unlocks when authoritative server entitlement is confirmed active.
 * - Non-dismissible while locked: NO close button, NO Escape key, NO backdrop dismissal.
 * - Prevents operational cargo processing, receipt printing, and ledger access via pointer and keyboard.
 * - Sibling elements and dynamic portals are made inert; operational keyboard shortcuts are stopped.
 * - Underlying background sync and auth remain mounted and operational.
 * - Public tracking (/track) and billing callback (/billing/callback) are explicitly excluded.
 */
export const CloudPausedGate: React.FC = () => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const scheduleState = useCloudLockSchedule();
  const { isUnlocked, entitlement } = useBillingEntitlement();

  const [initializingPlan, setInitializingPlan] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const [isEligible] = useState(() => {
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

  const isExempt =
    typeof window !== 'undefined' && isExemptFromLock(window.location.pathname);

  // Gate is active if scheduled epoch arrived, user has no active entitlement, is eligible, and not exempt
  const isGateActive = scheduleState.isLocked && !isUnlocked && isEligible && !isExempt;

  const [container, setContainer] = useState<HTMLElement | null>(() => {
    if (typeof window === 'undefined' || isExempt) return null;
    return getOrCreateGateContainer();
  });

  useEffect(() => {
    if (!container && typeof document !== 'undefined' && isGateActive) {
      setContainer(getOrCreateGateContainer());
    }
  }, [container, isGateActive]);

  // Inert management for sibling elements and dynamic portals
  useEffect(() => {
    if (!isGateActive || typeof document === 'undefined') return;

    const gateContainer = getOrCreateGateContainer();
    if (!gateContainer) return;

    lockBodyScroll();
    const cleanupInert = applySiblingInert(gateContainer, document);

    // Initial focus on alertdialog container
    dialogRef.current?.focus();

    return () => {
      cleanupInert();
      unlockBodyScroll();

      if (gateContainer && gateContainer.parentNode && gateContainer.childNodes.length === 0) {
        gateContainer.parentNode.removeChild(gateContainer);
      }
    };
  }, [isGateActive]);

  // Capture-phase key, pointer, and focus blocking
  useEffect(() => {
    if (!isGateActive || typeof window === 'undefined') return;

    const handleKeyCapture = (e: KeyboardEvent) => {
      const gateContainer = getOrCreateGateContainer();
      const isInsideGate = !!(gateContainer && gateContainer.contains(e.target as Node));

      const decision = shouldBlockKey(e, isInsideGate);

      if (decision.stopPropagation) {
        e.stopPropagation();
        e.stopImmediatePropagation();
      }

      if (decision.preventDefault) {
        e.preventDefault();
      }

      // Accessible Tab trapping inside the gate alertdialog
      if (isInsideGate && e.key === 'Tab') {
        trapFocus(e, dialogRef.current);
      }
    };

    const handlePointerCapture = (e: Event) => {
      const gateContainer = getOrCreateGateContainer();
      // Allow interactions within the gate container (reading, scrolling, inspecting pricing)
      if (gateContainer && gateContainer.contains(e.target as Node)) {
        return;
      }
      // Stop all pointer events targeting outside the gate container
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
  }, [isGateActive]);

  if (!isGateActive || !container) {
    return null;
  }

  // Determine active cards based on cutoff schedule
  const activeCards: PricingCardConfig[] = [
    ...(scheduleState.showBridge ? [PRICING_CARDS.bridge] : []),
    PRICING_CARDS.monthly,
    PRICING_CARDS.handover,
  ];

  const handleCheckout = async (planId: PlanId) => {
    try {
      setInitializingPlan(planId);
      setCheckoutError(null);
      const res = await initializeBillingCheckout(planId);
      if (res.authorizationUrl) {
        window.location.href = res.authorizationUrl;
      }
    } catch (err: any) {
      setCheckoutError(err.message || 'Failed to start Paystack checkout.');
      setInitializingPlan(null);
    }
  };

  return createPortal(
    <div
      id="ehi-cloud-paused-backdrop"
      className="fixed inset-0 w-screen h-screen z-[999999] flex items-center justify-center p-3 sm:p-5 md:p-8 overflow-y-auto"
      style={{
        backgroundColor: 'rgba(5, 7, 11, 0.96)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
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
        className="relative w-full max-w-5xl rounded-2xl shadow-2xl overflow-hidden focus:outline-none p-5 sm:p-7 md:p-8 flex flex-col gap-6 text-left my-auto"
        style={{
          backgroundColor: 'var(--color-surface-sunken, #0b0d13)',
          border: '1px solid var(--color-border-strong, rgba(255, 255, 255, 0.14))',
          boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.9), 0 0 0 1px rgba(255, 255, 255, 0.08)',
        }}
      >
        {/* Accent top gradient line: EHI Gold (#F59E0B) and Cobalt (#025AAA) */}
        <div
          className="absolute top-0 left-0 right-0 h-1.5"
          style={{
            background: 'linear-gradient(90deg, #F59E0B 0%, #025AAA 50%, #F59E0B 100%)',
          }}
        />

        {/* Top brand header & badges */}
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
              Production Instance
            </span>
          </div>
        </div>

        {/* Title and main statement */}
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
              className="mt-2 text-[14px] sm:text-[15px] font-normal leading-relaxed"
              style={{ color: 'var(--color-text-secondary, #c3ccd9)' }}
            >
              {CLOUD_PAUSED_BODY}
            </p>
          </div>
        </div>

        {/* Responsive Pricing Arrangements */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between text-xs font-mono uppercase tracking-wider text-[var(--color-muted,#8b97a8)]">
            <span>Available Service Arrangements</span>
            <span>{activeCards.length} Options Available</span>
          </div>

          {checkoutError && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300 flex items-center gap-2">
              <AlertTriangle size={14} className="shrink-0 text-red-400" />
              <span>{checkoutError}</span>
            </div>
          )}

          <div
            className={`grid gap-4 ${
              activeCards.length === 3
                ? 'grid-cols-1 md:grid-cols-3'
                : 'grid-cols-1 md:grid-cols-2 max-w-3xl mx-auto w-full'
            }`}
          >
            {activeCards.map((card) => {
              const configured = isPaymentConfigured(card.paystackPlaceholderUrl);

              return (
                <div
                  key={card.id}
                  className="rounded-xl p-4 sm:p-5 flex flex-col justify-between transition-all"
                  style={{
                    backgroundColor: 'rgba(15, 20, 28, 0.75)',
                    border:
                      card.id === 'monthly-licence'
                        ? '1px solid rgba(2, 90, 170, 0.5)'
                        : '1px solid rgba(255, 255, 255, 0.08)',
                    boxShadow:
                      card.id === 'monthly-licence'
                        ? '0 8px 24px -6px rgba(2, 90, 170, 0.25)'
                        : 'none',
                  }}
                >
                  <div className="flex flex-col gap-3">
                    {/* Badge and Title */}
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm sm:text-base font-bold font-mono text-white">
                        {card.title}
                      </span>
                      {card.badge && (
                        <span
                          className={`text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                            card.badgeType === 'warning'
                              ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                              : card.badgeType === 'primary'
                              ? 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                              : 'bg-slate-500/15 text-slate-300 border border-slate-500/30'
                          }`}
                        >
                          {card.badge}
                        </span>
                      )}
                    </div>

                    {/* Price and Frequency */}
                    <div className="flex items-baseline gap-1.5 pt-1">
                      <span className="text-2xl sm:text-3xl font-extrabold font-mono text-amber-400">
                        {card.priceFormatted}
                      </span>
                      <span className="text-xs font-mono text-slate-400">
                        {card.billingFrequency}
                      </span>
                    </div>

                    {/* Subtitle or Bridge validity */}
                    {(card.validity || card.subtitle) && (
                      <p className="text-xs text-slate-400 font-medium">
                        {card.validity || card.subtitle}
                      </p>
                    )}

                    {/* Monthly breakdown if present */}
                    {card.breakdown && (
                      <div className="my-2 p-2.5 rounded-lg bg-black/40 border border-white/5 flex flex-col gap-1.5 text-[11px] font-mono">
                        <div className="text-[10px] uppercase text-slate-400 font-bold tracking-wider mb-0.5">
                          Licence Breakdown
                        </div>
                        {card.breakdown.map((item) => (
                          <div
                            key={item.label}
                            className="flex items-center justify-between text-slate-300"
                          >
                            <span>{item.label}</span>
                            <span className="font-semibold text-slate-200">
                              {item.amountFormatted}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Note if present */}
                    {card.note && (
                      <div className="p-2 rounded bg-amber-500/5 border border-amber-500/20 text-[11px] text-amber-300/90 leading-tight">
                        <span className="font-bold">Note: </span>
                        {card.note}
                      </div>
                    )}

                    {/* Monthly Licence Active Notice (Discourage Duplicate Early Checkout) */}
                    {card.id === 'monthly-licence' && entitlement?.isActive && entitlement?.paidUntil && (
                      <div className="p-2 rounded bg-blue-500/10 border border-blue-500/20 text-[11px] text-blue-300">
                        <span className="font-bold">Active Coverage: </span>
                        Valid through {new Date(entitlement.paidUntil).toLocaleDateString()}. Renewing extends by 30 days from that date (no stacking). Early renewal is discouraged unless nearing expiration.
                      </div>
                    )}

                    {/* Features checklist if present */}
                    {card.features && card.features.length > 0 && (
                      <ul className="flex flex-col gap-1.5 pt-2 text-xs text-slate-300">
                        {card.features.map((feat, idx) => (
                          <li key={idx} className="flex items-start gap-2">
                            <CheckCircle2
                              size={14}
                              className="shrink-0 mt-0.5 text-slate-400"
                            />
                            <span>{feat}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {/* Checkout Button & Automatic Billing Notice */}
                  <div className="mt-5 pt-3 border-t border-white/5 flex flex-col gap-2">
                    <button
                      type="button"
                      disabled={initializingPlan !== null}
                      onClick={(e) => {
                        e.preventDefault();
                        handleCheckout(card.id);
                      }}
                      className="w-full py-2.5 px-4 rounded-lg font-mono text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 border border-amber-400/50 shadow-md shadow-amber-500/10 focus:outline-none focus:ring-2 focus:ring-amber-500/50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {initializingPlan === card.id ? (
                        <>
                          <Loader2 size={13} className="text-slate-950 animate-spin" />
                          <span>Connecting to Paystack...</span>
                        </>
                      ) : (
                        <>
                          <Lock size={13} className="text-slate-950" />
                          <span>Proceed to Paystack Checkout</span>
                        </>
                      )}
                    </button>

                    <div className="flex items-center justify-center gap-1.5 text-[11px] font-mono text-amber-400/90 text-center">
                      <ShieldAlert size={12} className="shrink-0" />
                      <span>
                        Automatic unlock via Paystack verification
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Lockout footer without dismiss */}
        <div className="pt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-[var(--color-muted,#8b97a8)] border-t border-white/5">
          <span className="flex items-center gap-1.5">
            <Lock size={12} className="text-amber-400" />
            Terminal interaction locked
          </span>
          <span className="italic">
            Administrative clearance required &bull; Offline sync engine operational
          </span>
        </div>
      </div>
    </div>,
    container
  );
};
