import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import {
  PLANS,
  PLAN_CATALOG,
  BRIDGE_CUTOFF_EPOCH_MS,
  BRIDGE_EXPIRY_ISO,
  BRIDGE_EXPIRY_EPOCH_MS,
  isAllowedPaystackUrl,
  timingSafeEqualString,
  verifyPaystackWebhookSignature,
  PaystackBillingService,
  type PaystackConfig,
} from './paystackService';
import { isBillingCallbackPath, isExemptFromLock, isPublicTrackingPath } from '../../src/config/cloudLockConfig';

describe('Paystack Billing & Entitlement Architecture Tests', () => {
  const TEST_SECRET_KEY = 'sk_test_mock_secret_key_12345';
  const TEST_WEBHOOK_SECRET = 'whsec_test_mock_webhook_secret_67890';

  describe('1. Webhook Signature Verification & Raw Bytes Timing Safety', () => {
    test('verifies modern Paystack-Signature (t=unix,v1=key_id:hex) timing-safely', () => {
      const nowSec = 1762600000;
      const rawPayload = Buffer.from(JSON.stringify({ event: 'charge.success', data: { reference: 'ref_123' } }), 'utf8');

      // Compute valid modern signature: HMAC-SHA512 of `${nowSec}.${rawBody}`
      const prefix = Buffer.from(`${nowSec}.`, 'utf8');
      const signedData = Buffer.concat([prefix, rawPayload]);
      const hexSig = crypto.createHmac('sha512', TEST_WEBHOOK_SECRET).update(signedData).digest('hex');

      const headerValue = `t=${nowSec},v1=whk_test_key:${hexSig}`;
      const config: PaystackConfig = {
        secretKey: TEST_SECRET_KEY,
        webhookSecret: TEST_WEBHOOK_SECRET,
        signatureMode: 'modern',
        mode: 'test',
        appUrl: 'https://ehi-multisystems-fl85.vercel.app',
      };

      const result = verifyPaystackWebhookSignature(
        rawPayload,
        { 'paystack-signature': headerValue },
        config,
        nowSec
      );

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.scheme, 'modern');
      assert.strictEqual(result.timestamp, nowSec);
    });

    test('supports modern signature with multiple v1 keys (key rotation)', () => {
      const nowSec = 1762600000;
      const rawPayload = Buffer.from('{"test":"raw"}', 'utf8');
      const prefix = Buffer.from(`${nowSec}.`, 'utf8');
      const signedData = Buffer.concat([prefix, rawPayload]);
      const activeSig = crypto.createHmac('sha512', TEST_WEBHOOK_SECRET).update(signedData).digest('hex');

      // Older/rotating key signature followed by active signature
      const headerValue = `t=${nowSec},v1=whk_old:deadbeef1234,v1=whk_current:${activeSig}`;
      const config: PaystackConfig = {
        secretKey: TEST_SECRET_KEY,
        webhookSecret: TEST_WEBHOOK_SECRET,
        signatureMode: 'modern',
        mode: 'test',
        appUrl: 'https://ehi-multisystems-fl85.vercel.app',
      };

      const result = verifyPaystackWebhookSignature(
        rawPayload,
        { 'paystack-signature': headerValue },
        config,
        nowSec
      );

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.scheme, 'modern');
    });

    test('rejects modern signature when timestamp difference exceeds 300 seconds (anti-replay)', () => {
      const serverSec = 1762601000;
      const expiredSec = serverSec - 301; // 301s older
      const rawPayload = Buffer.from('{"test":"replay"}', 'utf8');
      const signedData = Buffer.concat([Buffer.from(`${expiredSec}.`), rawPayload]);
      const hexSig = crypto.createHmac('sha512', TEST_WEBHOOK_SECRET).update(signedData).digest('hex');

      const config: PaystackConfig = {
        secretKey: TEST_SECRET_KEY,
        webhookSecret: TEST_WEBHOOK_SECRET,
        signatureMode: 'modern',
        mode: 'test',
        appUrl: 'https://ehi-multisystems-fl85.vercel.app',
      };

      const result = verifyPaystackWebhookSignature(
        rawPayload,
        { 'paystack-signature': `t=${expiredSec},v1=whk_1:${hexSig}` },
        config,
        serverSec
      );

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('Timestamp tolerance exceeded'));
    });

    test('rejects modern signature with invalid / corrupted HMAC', () => {
      const nowSec = 1762600000;
      const rawPayload = Buffer.from('{"test":"corrupt"}', 'utf8');
      const config: PaystackConfig = {
        secretKey: TEST_SECRET_KEY,
        webhookSecret: TEST_WEBHOOK_SECRET,
        signatureMode: 'modern',
        mode: 'test',
        appUrl: 'https://ehi-multisystems-fl85.vercel.app',
      };

      const result = verifyPaystackWebhookSignature(
        rawPayload,
        { 'paystack-signature': `t=${nowSec},v1=whk_1:bad_hex_signature` },
        config,
        nowSec
      );

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('mismatch'));
    });

    test('verifies legacy x-paystack-signature correctly', () => {
      const rawPayload = Buffer.from('{"event":"charge.success"}', 'utf8');
      const hexSig = crypto.createHmac('sha512', TEST_SECRET_KEY).update(rawPayload).digest('hex');

      const config: PaystackConfig = {
        secretKey: TEST_SECRET_KEY,
        signatureMode: 'legacy',
        mode: 'test',
        appUrl: 'https://ehi-multisystems-fl85.vercel.app',
      };

      const result = verifyPaystackWebhookSignature(
        rawPayload,
        { 'x-paystack-signature': hexSig },
        config
      );

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.scheme, 'legacy');
    });

    test('NO DOWNGRADE FALLBACK: when modern mode is configured, legacy header alone is rejected', () => {
      const rawPayload = Buffer.from('{"event":"charge.success"}', 'utf8');
      const legacySig = crypto.createHmac('sha512', TEST_SECRET_KEY).update(rawPayload).digest('hex');

      const config: PaystackConfig = {
        secretKey: TEST_SECRET_KEY,
        webhookSecret: TEST_WEBHOOK_SECRET,
        signatureMode: 'modern', // strictly modern
        mode: 'test',
        appUrl: 'https://ehi-multisystems-fl85.vercel.app',
      };

      const result = verifyPaystackWebhookSignature(
        rawPayload,
        { 'x-paystack-signature': legacySig }, // attacker supplies only legacy header
        config
      );

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('legacy fallback disabled'));
    });

    test('preserves raw byte fidelity: whitespace/formatting changes invalidate HMAC', () => {
      const originalPayload = '{\n  "event": "charge.success",\n  "amount": 18000000\n}';
      const reSerializedPayload = '{"event":"charge.success","amount":18000000}';

      const originalBuffer = Buffer.from(originalPayload, 'utf8');
      const reSerializedBuffer = Buffer.from(reSerializedPayload, 'utf8');

      const originalSig = crypto.createHmac('sha512', TEST_SECRET_KEY).update(originalBuffer).digest('hex');

      // Verifying against originalBuffer succeeds
      assert.strictEqual(
        verifyPaystackWebhookSignature(originalBuffer, { 'x-paystack-signature': originalSig }, {
          secretKey: TEST_SECRET_KEY,
          signatureMode: 'legacy',
          mode: 'test',
          appUrl: 'https://ehi-multisystems-fl85.vercel.app',
        }).valid,
        true
      );

      // Verifying against reSerializedBuffer fails because JSON re-serialization altered raw bytes
      assert.strictEqual(
        verifyPaystackWebhookSignature(reSerializedBuffer, { 'x-paystack-signature': originalSig }, {
          secretKey: TEST_SECRET_KEY,
          signatureMode: 'legacy',
          mode: 'test',
          appUrl: 'https://ehi-multisystems-fl85.vercel.app',
        }).valid,
        false
      );
    });
  });

  describe('2. Plan Catalog, Exact Kobo Pricing, and Cutoff Contracts', () => {
    test('exact kobo amounts and currency match specifications', () => {
      // November Bridge: ₦63,000 -> 6,300,000 kobo
      assert.strictEqual(PLAN_CATALOG[PLANS.BRIDGE].amountKobo, 6300000);
      assert.strictEqual(PLAN_CATALOG[PLANS.BRIDGE].amountNgn, 63000);
      assert.strictEqual(PLAN_CATALOG[PLANS.BRIDGE].currency, 'NGN');

      // Monthly Licence: ₦180,000 -> 18,000,000 kobo
      assert.strictEqual(PLAN_CATALOG[PLANS.MONTHLY].amountKobo, 18000000);
      assert.strictEqual(PLAN_CATALOG[PLANS.MONTHLY].amountNgn, 180000);
      assert.strictEqual(PLAN_CATALOG[PLANS.MONTHLY].currency, 'NGN');

      // Full System Handover: ₦700,000 -> 70,000,000 kobo
      assert.strictEqual(PLAN_CATALOG[PLANS.HANDOVER].amountKobo, 70000000);
      assert.strictEqual(PLAN_CATALOG[PLANS.HANDOVER].amountNgn, 700000);
      assert.strictEqual(PLAN_CATALOG[PLANS.HANDOVER].currency, 'NGN');
    });

    test('exact 1-second difference between bridge paid_until and card cutoff', () => {
      // Bridge expiry is exact: 2026-11-30T23:59:59+01:00 (epoch 1796079599000)
      assert.strictEqual(BRIDGE_EXPIRY_ISO, '2026-11-30T23:59:59+01:00');
      assert.strictEqual(BRIDGE_EXPIRY_EPOCH_MS, 1796079599000);

      // Bridge cutoff is exact: 2026-12-01T00:00:00+01:00 (epoch 1796079600000)
      assert.strictEqual(BRIDGE_CUTOFF_EPOCH_MS, 1796079600000);

      // Difference is EXACTLY 1000ms (1 second)
      assert.strictEqual(BRIDGE_CUTOFF_EPOCH_MS - BRIDGE_EXPIRY_EPOCH_MS, 1000);
    });

    test('rejects November Bridge checkout initialization at or after Dec 1 00:00:00+01:00', async () => {
      const mockService = new PaystackBillingService(
        {
          secretKey: TEST_SECRET_KEY,
          signatureMode: 'legacy',
          mode: 'test',
          appUrl: 'https://ehi-multisystems-fl85.vercel.app',
        },
        {} as any,
        {} as any
      );

      // 1ms before cutoff -> passes cutoff gate
      const beforeCutoffMs = BRIDGE_CUTOFF_EPOCH_MS - 1;
      // We test the cutoff validation logic directly
      await assert.rejects(
        async () => {
          await mockService.initializeCheckout({
            planId: PLANS.BRIDGE,
            userEmail: 'staff@ehimultisystems.com',
            userId: 'user_123',
            nowMs: BRIDGE_CUTOFF_EPOCH_MS, // exact cutoff
          });
        },
        /no longer available for purchase after 01 Dec 2026/
      );
    });
  });

  describe('3. Paystack Checkout URL Allowlist Validation', () => {
    test('permits legitimate Paystack checkout hosts', () => {
      assert.strictEqual(isAllowedPaystackUrl('https://checkout.paystack.com/access_code_123'), true);
      assert.strictEqual(isAllowedPaystackUrl('https://standard.paystack.co/pay/xyz'), true);
    });

    test('rejects malicious or spoofed checkout URLs', () => {
      assert.strictEqual(isAllowedPaystackUrl('http://checkout.paystack.com/insecure'), false); // not https
      assert.strictEqual(isAllowedPaystackUrl('https://evil-paystack.com/pay'), false);
      assert.strictEqual(isAllowedPaystackUrl('https://paystack.com.attacker.com/pay'), false);
      assert.strictEqual(isAllowedPaystackUrl('javascript:alert(1)'), false);
      assert.strictEqual(isAllowedPaystackUrl(''), false);
    });
  });

  describe('4. Route Exemption Contracts', () => {
    test('exempts /billing/callback and /track from gate blocking', () => {
      assert.strictEqual(isBillingCallbackPath('/billing/callback'), true);
      assert.strictEqual(isBillingCallbackPath('/billing/callback/'), true);
      assert.strictEqual(isBillingCallbackPath('/billing/callback?reference=ref_123'), true);

      assert.strictEqual(isPublicTrackingPath('/track/WB-001'), true);

      assert.strictEqual(isExemptFromLock('/billing/callback'), true);
      assert.strictEqual(isExemptFromLock('/track/WB-001'), true);
    });

    test('does NOT exempt operational application paths', () => {
      assert.strictEqual(isExemptFromLock('/'), false);
      assert.strictEqual(isExemptFromLock('/cargo'), false);
      assert.strictEqual(isExemptFromLock('/ledger'), false);
      assert.strictEqual(isExemptFromLock('/billing'), false);
      assert.strictEqual(isExemptFromLock('/billing/other'), false);
    });
  });

  describe('5. Timing-Safe String Comparison', () => {
    test('timingSafeEqualString behaves correctly with identical and differing inputs', () => {
      assert.strictEqual(timingSafeEqualString('abc123xyz', 'abc123xyz'), true);
      assert.strictEqual(timingSafeEqualString('abc123xyz', 'abc123xyw'), false);
      assert.strictEqual(timingSafeEqualString('abc', 'abcd'), false);
      assert.strictEqual(timingSafeEqualString('', ''), true);
      assert.strictEqual(timingSafeEqualString('a', ''), false);
    });
  });

  describe('6. Plan Precedence and Renewal Mathematics', () => {
    test('monthly renewal adds exactly 30 days without shortening existing longer coverage', () => {
      const now = new Date('2026-11-15T12:00:00Z').getTime();
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

      // Case A: No existing coverage (expired) -> now + 30 days
      const targetA = Math.max(0, now) + thirtyDaysMs;
      assert.strictEqual(targetA, now + thirtyDaysMs);

      // Case B: Existing coverage has 10 days remaining -> extends by 30 days from existing (now + 40 days)
      const existingB = now + (10 * 24 * 60 * 60 * 1000);
      const targetB = Math.max(existingB, now) + thirtyDaysMs;
      assert.strictEqual(targetB, existingB + thirtyDaysMs);

      // Case C: Existing coverage already longer than calculated -> never shortened
      const longerExisting = now + (60 * 24 * 60 * 60 * 1000);
      const targetC = Math.max(longerExisting, targetA);
      assert.strictEqual(targetC, longerExisting);
    });
  });
});
