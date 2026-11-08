/**
 * SubscriptionExpiredModal has been superseded by CloudPausedGate.
 * Exported for backwards compatibility without mounting the legacy dismissible notice modal.
 */
export {
  CloudPausedGate,
  CloudPausedGate as SubscriptionExpiredModal,
  FORCED_RELOAD_KEY,
  CLOUD_PAUSED_TITLE,
  CLOUD_PAUSED_BODY,
} from './CloudPausedGate';
