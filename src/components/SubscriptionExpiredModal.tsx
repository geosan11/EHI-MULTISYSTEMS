/**
 * Non-dismissible frontend gate displaying cloud instance paused status.
 * - Displays on every app refresh / load for operational routes.
 * - Non-dismissible: NO dismiss/close button, NO Escape key dismissal, NO backdrop dismissal, NO bypass control.
 * - Prevents staff cargo processing, receipt printing, and ledger access via pointer or keyboard.
 * - Frontend-only gate: underlying operational UI stays mounted for background sync and offline data integrity.
 * - All display claims supplied by user, NOT independently verified.
 * - Suppressed during the one-time forced-reload pass on first launch of this release.
 */

export {
  CloudPausedGate,
  CloudPausedGate as SubscriptionExpiredModal,
  FORCED_RELOAD_KEY,
  CLOUD_PAUSED_TITLE,
  CLOUD_PAUSED_BODY,
} from './CloudPausedGate';
