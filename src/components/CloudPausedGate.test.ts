import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACTIVATION_ISO,
  ACTIVATION_EPOCH_MS,
  BRIDGE_CUTOFF_ISO,
  BRIDGE_CUTOFF_EPOCH_MS,
  MAX_TIMEOUT_MS,
  FORCED_RELOAD_KEY,
  CLOUD_PAUSED_TITLE,
  CLOUD_PAUSED_BODY,
  GATE_CONTAINER_ID,
  PRICING_CARDS,
  isCloudLockActive,
  isBridgeCardVisible,
  isPublicTrackingPath,
  isPaymentConfigured,
  calculateNextTransitionDelay,
  clampTimeoutDelay,
} from '../config/cloudLockConfig';
import { CloudLockScheduler } from '../lib/cloudLockSchedule';
import {
  getOrCreateGateContainer,
  applySiblingInert,
  shouldBlockKey,
  trapFocus,
} from '../lib/cloudLockDom';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Scheduled Cloud Lock Configuration & Boundary Contracts', () => {
  describe('Exact Timestamps, Epochs and Copy Integrity', () => {
    test('exact ISO strings and epoch millisecond boundaries match specifications', () => {
      // 2026-11-09T07:58:00+01:00 == 2026-11-09T06:58:00.000Z
      assert.strictEqual(ACTIVATION_ISO, '2026-11-09T07:58:00+01:00');
      assert.strictEqual(ACTIVATION_EPOCH_MS, 1794207480000);
      assert.strictEqual(new Date(ACTIVATION_ISO).getTime(), ACTIVATION_EPOCH_MS);

      // 2026-12-01T00:00:00+01:00 == 2026-11-30T23:00:00.000Z
      assert.strictEqual(BRIDGE_CUTOFF_ISO, '2026-12-01T00:00:00+01:00');
      assert.strictEqual(BRIDGE_CUTOFF_EPOCH_MS, 1796079600000);
      assert.strictEqual(new Date(BRIDGE_CUTOFF_ISO).getTime(), BRIDGE_CUTOFF_EPOCH_MS);
    });

    test('exact user-specified title and body with em dash and neutral claims', () => {
      const EXPECTED_TITLE = 'EHI MULTISYSTEMS \u2014 CLOUD INSTANCE PAUSED';
      const EXPECTED_BODY =
        'The complimentary station run has concluded. All cargo records are safely backed up and intact. Choose a service arrangement below to continue.';

      assert.strictEqual(CLOUD_PAUSED_TITLE, EXPECTED_TITLE);
      assert.strictEqual(CLOUD_PAUSED_BODY, EXPECTED_BODY);
      assert.ok(CLOUD_PAUSED_TITLE.includes('\u2014'), 'Title contains unicode em dash');
    });

    test('retains FORCED_RELOAD_KEY byte-identical to maintain release compatibility', () => {
      assert.strictEqual(
        FORCED_RELOAD_KEY,
        'ehi_forced_reload_subscription_notice_20261106',
        'Sentinel key must remain untouched'
      );
    });

    test('removes fake backup status panels, grace-period claims, and unrequested contact actions', () => {
      const gateSource = fs.readFileSync(path.join(__dirname, 'CloudPausedGate.tsx'), 'utf8');
      const configSource = fs.readFileSync(
        path.join(__dirname, '../config/cloudLockConfig.ts'),
        'utf8'
      );

      // No fake reassurance panels
      assert.strictEqual(gateSource.includes('Status Verification Panel'), false);
      assert.strictEqual(gateSource.includes('Infrastructure Scope'), false);
      assert.strictEqual(gateSource.includes('Local Storage State'), false);
      assert.strictEqual(gateSource.includes('grace period'), false);
      assert.strictEqual(gateSource.includes('grace-period'), false);
      assert.strictEqual(gateSource.includes('automatically resume upon billing clearance'), false);

      // No unrequested contact button actions
      assert.strictEqual(gateSource.includes('WhatsApp'), false);
      assert.strictEqual(gateSource.includes('tel:'), false);
      assert.strictEqual(gateSource.includes('mailto:'), false);

      // Retains required neutral locked indicators
      assert.ok(gateSource.includes('Terminal interaction locked'));
      assert.ok(gateSource.includes('Administrative clearance required'));
      assert.ok(gateSource.includes('Offline sync engine operational'));
    });
  });

  describe('Boundary Tests: Activation & December Cutoff', () => {
    test('activation boundary: -1ms, exact epoch, +1ms', () => {
      // 1ms before activation -> inactive
      assert.strictEqual(isCloudLockActive(ACTIVATION_EPOCH_MS - 1), false);
      assert.strictEqual(
        calculateNextTransitionDelay(ACTIVATION_EPOCH_MS - 1, ACTIVATION_EPOCH_MS, BRIDGE_CUTOFF_EPOCH_MS),
        1
      );

      // Exactly at activation -> active
      assert.strictEqual(isCloudLockActive(ACTIVATION_EPOCH_MS), true);
      assert.strictEqual(isBridgeCardVisible(ACTIVATION_EPOCH_MS), true);
      assert.strictEqual(
        calculateNextTransitionDelay(ACTIVATION_EPOCH_MS, ACTIVATION_EPOCH_MS, BRIDGE_CUTOFF_EPOCH_MS),
        BRIDGE_CUTOFF_EPOCH_MS - ACTIVATION_EPOCH_MS
      );

      // 1ms after activation -> active
      assert.strictEqual(isCloudLockActive(ACTIVATION_EPOCH_MS + 1), true);
      assert.strictEqual(isBridgeCardVisible(ACTIVATION_EPOCH_MS + 1), true);
    });

    test('December 1 cutoff boundary: last ms Nov 30, exact cutoff, +1ms', () => {
      // Last ms of Nov 30 -> Bridge card still visible (3 cards layout)
      const lastMsNov30 = BRIDGE_CUTOFF_EPOCH_MS - 1;
      assert.strictEqual(isBridgeCardVisible(lastMsNov30), true);
      assert.strictEqual(
        calculateNextTransitionDelay(lastMsNov30, ACTIVATION_EPOCH_MS, BRIDGE_CUTOFF_EPOCH_MS),
        1
      );

      // Verify active cards layout count before cutoff: exactly 3 cards
      const activeCardsBefore = [
        ...(isBridgeCardVisible(lastMsNov30) ? [PRICING_CARDS.bridge] : []),
        PRICING_CARDS.monthly,
        PRICING_CARDS.handover,
      ];
      assert.strictEqual(activeCardsBefore.length, 3);
      assert.strictEqual(activeCardsBefore[0].id, 'november-bridge');
      assert.strictEqual(activeCardsBefore[1].id, 'monthly-licence');
      assert.strictEqual(activeCardsBefore[2].id, 'system-handover');

      // Exact Dec 1 00:00:00+01:00 -> Bridge card hidden (2 cards layout)
      assert.strictEqual(isBridgeCardVisible(BRIDGE_CUTOFF_EPOCH_MS), false);
      assert.strictEqual(
        calculateNextTransitionDelay(BRIDGE_CUTOFF_EPOCH_MS, ACTIVATION_EPOCH_MS, BRIDGE_CUTOFF_EPOCH_MS),
        null
      );

      // Verify active cards layout count after cutoff: exactly 2 cards
      const activeCardsAtCutoff = [
        ...(isBridgeCardVisible(BRIDGE_CUTOFF_EPOCH_MS) ? [PRICING_CARDS.bridge] : []),
        PRICING_CARDS.monthly,
        PRICING_CARDS.handover,
      ];
      assert.strictEqual(activeCardsAtCutoff.length, 2);
      assert.strictEqual(activeCardsAtCutoff[0].id, 'monthly-licence');
      assert.strictEqual(activeCardsAtCutoff[1].id, 'system-handover');

      // 1ms after cutoff -> Bridge card hidden, no further transitions
      assert.strictEqual(isBridgeCardVisible(BRIDGE_CUTOFF_EPOCH_MS + 1), false);
      assert.strictEqual(
        calculateNextTransitionDelay(BRIDGE_CUTOFF_EPOCH_MS + 1, ACTIVATION_EPOCH_MS, BRIDGE_CUTOFF_EPOCH_MS),
        null
      );
    });

    test('timeout clamping to 32-bit signed integer (MAX_TIMEOUT_MS)', () => {
      assert.strictEqual(MAX_TIMEOUT_MS, 2147483647);
      assert.strictEqual(clampTimeoutDelay(MAX_TIMEOUT_MS + 500000), MAX_TIMEOUT_MS);
      assert.strictEqual(clampTimeoutDelay(5000), 5000);
      assert.strictEqual(clampTimeoutDelay(0), 0);
      assert.strictEqual(clampTimeoutDelay(-10), 0);
    });
  });

  describe('Public Tracking Exclusion Route Verification', () => {
    test('explicitly excludes /track and /track/:waybillId including deep links and queries', () => {
      assert.strictEqual(isPublicTrackingPath('/track'), true);
      assert.strictEqual(isPublicTrackingPath('/track/'), true);
      assert.strictEqual(isPublicTrackingPath('/track/WB-2026-001'), true);
      assert.strictEqual(isPublicTrackingPath('/track/EHI-LAG-99221'), true);
      assert.strictEqual(isPublicTrackingPath('/track/EHI-LAG-99221?print=1'), true);
      assert.strictEqual(isPublicTrackingPath('/track/EHI-LAG-99221#status'), true);
    });

    test('does NOT exclude arbitrary /tracking prefix or operational routes', () => {
      assert.strictEqual(isPublicTrackingPath('/tracking'), false);
      assert.strictEqual(isPublicTrackingPath('/tracking/12345'), false);
      assert.strictEqual(isPublicTrackingPath('/trackpad'), false);
      assert.strictEqual(isPublicTrackingPath('/cargo'), false);
      assert.strictEqual(isPublicTrackingPath('/ledger'), false);
      assert.strictEqual(isPublicTrackingPath('/reports'), false);
      assert.strictEqual(isPublicTrackingPath('/'), false);
      assert.strictEqual(isPublicTrackingPath(''), false);
    });
  });

  describe('Pricing Structure & Centralized Placeholders', () => {
    test('November Cloud Bridge card parameters', () => {
      const bridge = PRICING_CARDS.bridge;
      assert.strictEqual(bridge.title, 'November Cloud Bridge');
      assert.strictEqual(bridge.priceFormatted, '₦63,000');
      assert.strictEqual(bridge.billingFrequency, 'one-time');
      assert.strictEqual(bridge.badge, 'NON-RENEWABLE');
      assert.ok((bridge.validity || bridge.subtitle)?.includes('30 Nov 2026'));
      assert.strictEqual(bridge.paystackPlaceholderUrl, 'https://example.invalid/paystack/november-bridge');
    });

    test('Monthly System Licence breakdown adds up exactly with mandatory note', () => {
      const monthly = PRICING_CARDS.monthly;
      assert.strictEqual(monthly.title, 'Monthly System Licence');
      assert.strictEqual(monthly.priceFormatted, '₦180,000');
      assert.strictEqual(monthly.billingFrequency, '/ month');

      const breakdown = monthly.breakdown!;
      assert.strictEqual(breakdown.length, 3);
      assert.strictEqual(breakdown[0].label, 'Software Usage Licence');
      assert.strictEqual(breakdown[0].amountFormatted, '₦117,000');
      assert.strictEqual(breakdown[1].label, 'Supabase');
      assert.strictEqual(breakdown[1].amountFormatted, '₦35,000');
      assert.strictEqual(breakdown[2].label, 'Vercel');
      assert.strictEqual(breakdown[2].amountFormatted, '₦28,000');

      // Verify numerical sum: 117,000 + 35,000 + 28,000 = 180,000
      const total = 117000 + 35000 + 28000;
      assert.strictEqual(total, 180000);

      // Exact mandatory note
      const EXPECTED_NOTE = 'Remote software uptime & cloud hosting only. No on-site visits.';
      assert.strictEqual(monthly.note, EXPECTED_NOTE);
      assert.strictEqual(monthly.paystackPlaceholderUrl, 'https://example.invalid/paystack/monthly-licence');
    });

    test('Full System Handover card parameters', () => {
      const handover = PRICING_CARDS.handover;
      assert.strictEqual(handover.title, 'Full System Handover');
      assert.strictEqual(handover.priceFormatted, '₦700,000');
      assert.strictEqual(handover.billingFrequency, 'one-time');
      assert.strictEqual(handover.badge, 'ONE-TIME HANDOVER');
      assert.strictEqual(handover.badgeType, 'neutral');
      assert.strictEqual(handover.paystackPlaceholderUrl, 'https://example.invalid/paystack/system-handover');
    });

    test('centralized placeholder URL detection and validation', () => {
      // Default placeholder fields use genuinely non-routable reserved example.invalid domain
      assert.strictEqual(PRICING_CARDS.bridge.paystackPlaceholderUrl, 'https://example.invalid/paystack/november-bridge');
      assert.strictEqual(PRICING_CARDS.monthly.paystackPlaceholderUrl, 'https://example.invalid/paystack/monthly-licence');
      assert.strictEqual(PRICING_CARDS.handover.paystackPlaceholderUrl, 'https://example.invalid/paystack/system-handover');

      assert.strictEqual(isPaymentConfigured(PRICING_CARDS.bridge.paystackPlaceholderUrl), false);
      assert.strictEqual(isPaymentConfigured(PRICING_CARDS.monthly.paystackPlaceholderUrl), false);
      assert.strictEqual(isPaymentConfigured(PRICING_CARDS.handover.paystackPlaceholderUrl), false);

      // Inactive placeholder forms
      assert.strictEqual(isPaymentConfigured(''), false);
      assert.strictEqual(isPaymentConfigured('#'), false);
      assert.strictEqual(isPaymentConfigured('#placeholder'), false);
      assert.strictEqual(isPaymentConfigured('https://example.invalid/paystack/november-bridge'), false);
      assert.strictEqual(isPaymentConfigured('not-a-url'), false);

      // Live configured URL
      assert.strictEqual(isPaymentConfigured('https://paystack.com/pay/ehi-monthly-licence'), true);
    });

    test('pricing config contains strictly authorized terms without invented promises', () => {
      const configSource = fs.readFileSync(
        path.join(__dirname, '../config/cloudLockConfig.ts'),
        'utf8'
      );

      // No invented commercial promises or benefits
      assert.strictEqual(configSource.includes('automated backup routines'), false);
      assert.strictEqual(configSource.includes('proprietary source ownership'), false);
      assert.strictEqual(configSource.includes('proprietary source code'), false);
      assert.strictEqual(configSource.includes('dedicated cloud tenant'), false);
      assert.strictEqual(configSource.includes('zero future recurring'), false);
      assert.strictEqual(configSource.includes('Zero recurring software'), false);
      assert.strictEqual(configSource.includes('operational autonomy'), false);
      assert.strictEqual(configSource.includes('PERMANENT TRANSFER'), false);
      assert.strictEqual(configSource.includes('checkout.paystack.com/example.invalid'), false);

      // Backup claim is retained ONLY in body
      assert.ok(CLOUD_PAUSED_BODY.includes('All cargo records are safely backed up and intact.'));
      assert.strictEqual(PRICING_CARDS.bridge.features, undefined);
      assert.strictEqual(PRICING_CARDS.monthly.features, undefined);
      assert.strictEqual(PRICING_CARDS.handover.features, undefined);
    });
  });

  describe('CloudLockScheduler State Controller & Fake Timers', () => {
    test('notifies on exact scheduled transition and updates state', () => {
      let virtualTime = ACTIVATION_EPOCH_MS - 50; // 50ms before activation
      let notifiedState: any = null;

      const scheduler = new CloudLockScheduler({
        getCurrentTime: () => virtualTime,
        pollIntervalMs: 1000,
        onScheduleChange: (state) => {
          notifiedState = state;
        },
      });

      assert.strictEqual(scheduler.getState().isLocked, false);
      assert.strictEqual(scheduler.getState().showBridge, true);

      scheduler.start();

      // Jump time to activation
      virtualTime = ACTIVATION_EPOCH_MS;
      scheduler.refresh();

      assert.strictEqual(scheduler.getState().isLocked, true);
      assert.strictEqual(scheduler.getState().showBridge, true);
      assert.notStrictEqual(notifiedState, null);
      assert.strictEqual(notifiedState.isLocked, true);

      // Jump time to cutoff
      virtualTime = BRIDGE_CUTOFF_EPOCH_MS;
      scheduler.refresh();

      assert.strictEqual(scheduler.getState().showBridge, false);
      assert.strictEqual(notifiedState.showBridge, false);

      scheduler.stop();
    });

    test('handles wake-from-sleep jumps via handleWakeOrFocus and refreshes correctly', () => {
      let virtualTime = ACTIVATION_EPOCH_MS - 3600000; // 1 hour before activation
      let changeCount = 0;

      const scheduler = new CloudLockScheduler({
        getCurrentTime: () => virtualTime,
        pollIntervalMs: 60000,
        onScheduleChange: () => {
          changeCount++;
        },
      });

      scheduler.start();
      assert.strictEqual(scheduler.getState().isLocked, false);

      // Laptop sleep: virtual time jumps 3 hours forward past activation
      virtualTime = ACTIVATION_EPOCH_MS + 7200000;

      // Tab wakes up from sleep (e.g. visibilitychange or focus event)
      scheduler.handleWakeOrFocus();

      assert.strictEqual(scheduler.getState().isLocked, true);
      assert.strictEqual(changeCount, 1);

      scheduler.stop();
    });

    test('scheduler cleanup clears timers and detaches listeners without leakage', () => {
      let listenerCount = 0;
      const fakeDoc = {
        addEventListener: () => {
          listenerCount++;
        },
        removeEventListener: () => {
          listenerCount--;
        },
      };
      const fakeWin = {
        addEventListener: () => {
          listenerCount++;
        },
        removeEventListener: () => {
          listenerCount--;
        },
      };

      const originalDoc = globalThis.document;
      const originalWin = globalThis.window;

      try {
        (globalThis as any).document = fakeDoc;
        (globalThis as any).window = fakeWin;

        const scheduler = new CloudLockScheduler({ pollIntervalMs: 5000 });
        scheduler.start();
        assert.ok(listenerCount > 0, 'Listeners should be attached on start');

        scheduler.stop();
        assert.strictEqual(listenerCount, 0, 'All attached listeners must be removed on stop');
      } finally {
        (globalThis as any).document = originalDoc;
        (globalThis as any).window = originalWin;
      }
    });
  });

  describe('Application Wiring & Invariants', () => {
    test('App.tsx mounts CloudPausedGate and removes legacy SubscriptionExpiredModal notice', () => {
      const appSource = fs.readFileSync(path.join(__dirname, '../App.tsx'), 'utf8');

      assert.ok(
        appSource.includes("import { CloudPausedGate } from './components/CloudPausedGate'"),
        'App.tsx must import CloudPausedGate'
      );
      assert.ok(
        appSource.includes('<CloudPausedGate />'),
        'App.tsx must mount <CloudPausedGate />'
      );
      assert.strictEqual(
        appSource.includes('<SubscriptionExpiredModal />'),
        false,
        'Legacy <SubscriptionExpiredModal /> must not be mounted'
      );
    });

    test('main.tsx sentinel key and reload logic remain byte-identical', () => {
      const mainSource = fs.readFileSync(path.join(__dirname, '../main.tsx'), 'utf8');

      assert.ok(
        mainSource.includes("const FORCED_RELOAD_KEY = 'ehi_forced_reload_subscription_notice_20261106';"),
        'main.tsx sentinel key must remain byte-identical'
      );
    });

    test('cloud lock components and schedules make zero network calls', () => {
      const gateSource = fs.readFileSync(path.join(__dirname, 'CloudPausedGate.tsx'), 'utf8');
      const scheduleSource = fs.readFileSync(
        path.join(__dirname, '../lib/cloudLockSchedule.ts'),
        'utf8'
      );
      const configSource = fs.readFileSync(
        path.join(__dirname, '../config/cloudLockConfig.ts'),
        'utf8'
      );

      for (const src of [gateSource, scheduleSource, configSource]) {
        assert.strictEqual(src.includes('fetch('), false, 'No fetch calls permitted');
        assert.strictEqual(src.includes('XMLHttpRequest'), false, 'No XHR calls permitted');
        assert.strictEqual(src.includes('axios'), false, 'No axios calls permitted');
        assert.strictEqual(src.includes('navigator.sendBeacon'), false, 'No beacon calls permitted');
      }
    });
  });

  describe('DOM Inerting & Keyboard Gate Mechanics', () => {
    test('shouldBlockKey blocks Escape, Ctrl+P, and external keystrokes while allowing inside navigation', () => {
      // Escape blocked everywhere
      assert.deepStrictEqual(shouldBlockKey({ key: 'Escape' }, true), {
        preventDefault: true,
        stopPropagation: true,
      });
      assert.deepStrictEqual(shouldBlockKey({ key: 'Escape' }, false), {
        preventDefault: true,
        stopPropagation: true,
      });

      // Ctrl+P / Cmd+P blocked everywhere
      assert.deepStrictEqual(shouldBlockKey({ key: 'p', ctrlKey: true }, true), {
        preventDefault: true,
        stopPropagation: true,
      });
      assert.deepStrictEqual(shouldBlockKey({ key: 'P', metaKey: true }, true), {
        preventDefault: true,
        stopPropagation: true,
      });

      // Outside gate keystroke blocked
      assert.deepStrictEqual(shouldBlockKey({ key: 'a' }, false), {
        preventDefault: true,
        stopPropagation: true,
      });

      // Inside gate navigation allowed (e.g. Tab, ArrowDown, Space)
      assert.deepStrictEqual(shouldBlockKey({ key: 'Tab' }, true), {
        preventDefault: false,
        stopPropagation: true,
      });
      assert.deepStrictEqual(shouldBlockKey({ key: 'ArrowDown' }, true), {
        preventDefault: false,
        stopPropagation: true,
      });
    });

    test('applySiblingInert marks siblings and cleans up on unmount', () => {
      class MockElement {
        tagName: string;
        attrs = new Map<string, string>();
        constructor(tag: string) {
          this.tagName = tag.toUpperCase();
        }
        setAttribute(k: string, v: string) {
          this.attrs.set(k, v);
        }
        getAttribute(k: string) {
          return this.attrs.get(k) ?? null;
        }
        hasAttribute(k: string) {
          return this.attrs.has(k);
        }
        removeAttribute(k: string) {
          this.attrs.delete(k);
        }
      }

      const root = new MockElement('DIV');
      const gate = new MockElement('DIV');
      const mockDoc = {
        body: {
          children: [root, gate],
        },
      } as any;

      const cleanup = applySiblingInert(gate as any, mockDoc);

      assert.strictEqual(root.getAttribute('inert'), '');
      assert.strictEqual(root.getAttribute('aria-hidden'), 'true');
      assert.strictEqual(gate.hasAttribute('inert'), false);

      // Cleanup restores attributes
      cleanup();
      assert.strictEqual(root.hasAttribute('inert'), false);
      assert.strictEqual(root.hasAttribute('aria-hidden'), false);
    });
  });
});
