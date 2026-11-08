/**
 * Centralized Scheduled Cloud Lock Configuration and Pricing Data.
 *
 * Activation: EXACT absolute 2026-11-09T07:58:00+01:00 (06:58 UTC) -> epoch 1794207480000
 * November Bridge Cutoff: EXACT absolute 2026-12-01T00:00:00+01:00 (Nov 30 23:00 UTC) -> epoch 1796079600000
 */

export const ACTIVATION_ISO = '2026-11-09T07:58:00+01:00';
export const ACTIVATION_EPOCH_MS = 1794207480000;

export const BRIDGE_CUTOFF_ISO = '2026-12-01T00:00:00+01:00';
export const BRIDGE_CUTOFF_EPOCH_MS = 1796079600000;

/**
 * Maximum safe 32-bit signed integer delay for setTimeout (2^31 - 1 = 2147483647 ms, ~24.85 days).
 * Node/browsers wrap setTimeout delays larger than 2147483647 to 1 ms immediately.
 */
export const MAX_TIMEOUT_MS = 2147483647;

/**
 * Byte-identical sentinel key for the one-time hard refresh release check.
 * Retained semantically and byte-identical to maintain release compatibility without rearming.
 */
export const FORCED_RELOAD_KEY = 'ehi_forced_reload_subscription_notice_20261106';

/**
 * Exact user-specified title and body copy.
 * Note: Display claims supplied by user, NOT independently verified.
 * No grace-period or automatic clearance claims.
 */
export const CLOUD_PAUSED_TITLE = 'EHI MULTISYSTEMS \u2014 CLOUD INSTANCE PAUSED';
export const CLOUD_PAUSED_BODY =
  'The complimentary station run has concluded. All cargo records are safely backed up and intact. Choose a service arrangement below to continue.';

export const GATE_CONTAINER_ID = 'ehi-cloud-paused-gate-root';

export type PlanId = 'november-bridge' | 'monthly-licence' | 'system-handover';

export interface PricingBreakdownItem {
  label: string;
  amountFormatted: string;
}

export interface PricingCardConfig {
  id: PlanId;
  title: string;
  badge?: string;
  badgeType: 'warning' | 'primary' | 'neutral';
  priceFormatted: string;
  billingFrequency: string;
  validity?: string;
  subtitle?: string;
  breakdown?: PricingBreakdownItem[];
  note?: string;
  features?: string[];
  paystackPlaceholderUrl: string;
}

/**
 * CENTRALIZED placeholder Paystack URLs / checkout configuration.
 * Minimal pricing cards with user-authorized terms ONLY:
 * - Exact prices and one-time/monthly frequencies
 * - Bridge nonrenewable validity through 30 Nov 2026
 * - Monthly licence breakdown with exact remote-only note
 * - Neutral ONE-TIME HANDOVER badge
 * - Non-routable reserved RFC 2606 example.invalid placeholder URLs (disabled until configured)
 * - Zero speculative promises or unverified feature checklists.
 */
export const PRICING_CARDS: {
  bridge: PricingCardConfig;
  monthly: PricingCardConfig;
  handover: PricingCardConfig;
} = {
  bridge: {
    id: 'november-bridge',
    title: 'November Cloud Bridge',
    badge: 'NON-RENEWABLE',
    badgeType: 'warning',
    priceFormatted: '₦63,000',
    billingFrequency: 'one-time',
    validity: 'Valid through 30 Nov 2026',
    subtitle: 'Valid through 30 Nov 2026',
    // Reserved non-routable RFC 2606 URL; disabled until configured
    paystackPlaceholderUrl: 'https://example.invalid/paystack/november-bridge',
  },
  monthly: {
    id: 'monthly-licence',
    title: 'Monthly System Licence',
    badgeType: 'primary',
    priceFormatted: '₦180,000',
    billingFrequency: '/ month',
    breakdown: [
      { label: 'Software Usage Licence', amountFormatted: '₦117,000' },
      { label: 'Supabase', amountFormatted: '₦35,000' },
      { label: 'Vercel', amountFormatted: '₦28,000' },
    ],
    note: 'Remote software uptime & cloud hosting only. No on-site visits.',
    // Reserved non-routable RFC 2606 URL; disabled until configured
    paystackPlaceholderUrl: 'https://example.invalid/paystack/monthly-licence',
  },
  handover: {
    id: 'system-handover',
    title: 'Full System Handover',
    badge: 'ONE-TIME HANDOVER',
    badgeType: 'neutral',
    priceFormatted: '₦700,000',
    billingFrequency: 'one-time',
    // Reserved non-routable RFC 2606 URL; disabled until configured
    paystackPlaceholderUrl: 'https://example.invalid/paystack/system-handover',
  },
};

/**
 * Checks whether the current time is at or past the exact absolute activation timestamp.
 * Evaluates Date.now() >= epoch millisecond (not local clock hour/day).
 */
export function isCloudLockActive(nowMs: number = Date.now()): boolean {
  return nowMs >= ACTIVATION_EPOCH_MS;
}

/**
 * Checks whether the November Cloud Bridge card should still be displayed.
 * Hidden automatically at EXACT 2026-12-01T00:00:00+01:00 (epoch 1796079600000).
 */
export function isBridgeCardVisible(nowMs: number = Date.now()): boolean {
  return nowMs < BRIDGE_CUTOFF_EPOCH_MS;
}

/**
 * Route check: Public tracking /track and /track/:waybillId explicitly excluded.
 * Does NOT match arbitrary /tracking prefix or other operational paths.
 */
export function isPublicTrackingPath(pathname: string): boolean {
  if (!pathname) return false;
  const cleanPath = pathname.split(/[?#]/)[0].trim();
  return cleanPath === '/track' || cleanPath.startsWith('/track/');
}

/**
 * Route check: Billing callback page /billing/callback explicitly excluded from gate blocking overlay.
 */
export function isBillingCallbackPath(pathname: string): boolean {
  if (!pathname) return false;
  const cleanPath = pathname.split(/[?#]/)[0].trim();
  return cleanPath === '/billing/callback' || cleanPath.startsWith('/billing/callback/');
}

/**
 * Route check: Returns true if the path is exempt from CloudPausedGate blocking.
 */
export function isExemptFromLock(pathname: string): boolean {
  return isPublicTrackingPath(pathname) || isBillingCallbackPath(pathname);
}

/**
 * Verifies whether a configured checkout URL is active or a disabled placeholder.
 */
export function isPaymentConfigured(url: string | null | undefined): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  if (trimmed === '' || trimmed === '#' || trimmed.startsWith('#')) return false;
  if (trimmed.includes('example.invalid') || trimmed.includes('example.com')) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Computes millisecond delay to the next scheduled transition.
 * Returns null if all scheduled transitions have elapsed.
 */
export function calculateNextTransitionDelay(
  nowMs: number,
  activationMs: number = ACTIVATION_EPOCH_MS,
  cutoffMs: number = BRIDGE_CUTOFF_EPOCH_MS
): number | null {
  if (nowMs < activationMs) {
    return activationMs - nowMs;
  }
  if (nowMs < cutoffMs) {
    return cutoffMs - nowMs;
  }
  return null;
}

/**
 * Clamps a timeout delay to the maximum safe 32-bit signed integer value.
 */
export function clampTimeoutDelay(delayMs: number): number {
  if (delayMs <= 0) return 0;
  return Math.min(delayMs, MAX_TIMEOUT_MS);
}
