import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import {
  PLANS,
  PLAN_CATALOG,
  BRIDGE_CUTOFF_EPOCH_MS,
  BRIDGE_EXPIRY_ISO,
  BRIDGE_EXPIRY_EPOCH_MS,
  PAYSTACK_REFERENCE_REGEX,
  isValidPaystackReference,
  generatePaystackReference,
  calculateTargetEntitlement,
  isAllowedPaystackUrl,
  timingSafeEqualString,
  verifyPaystackWebhookSignature,
  PaystackBillingService,
  type PaystackConfig,
} from './paystackService';
import { createWebhookHandler, createBillingRouter } from './billingRoutes';
import { isBillingCallbackPath, isExemptFromLock, isPublicTrackingPath } from '../../src/config/cloudLockConfig';

describe('Paystack Billing & Entitlement Architecture Tests', () => {
  const TEST_SECRET_KEY = 'sk_test_mock_secret_key_12345';
  const TEST_WEBHOOK_SECRET = 'whsec_test_mock_webhook_secret_67890';

  describe('1. Webhook Signature Verification & Raw Bytes Timing Safety', () => {
    test('verifies modern Paystack-Signature (t=unix,v1=key_id:hex) timing-safely', () => {
      const nowSec = 1762600000;
      const rawPayload = Buffer.from(JSON.stringify({ event: 'charge.success', data: { reference: 'ehi-november-bridge-1234' } }), 'utf8');

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
        signatureMode: 'modern',
        mode: 'test',
        appUrl: 'https://ehi-multisystems-fl85.vercel.app',
      };

      const result = verifyPaystackWebhookSignature(
        rawPayload,
        { 'x-paystack-signature': legacySig },
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

      assert.strictEqual(
        verifyPaystackWebhookSignature(originalBuffer, { 'x-paystack-signature': originalSig }, {
          secretKey: TEST_SECRET_KEY,
          signatureMode: 'legacy',
          mode: 'test',
          appUrl: 'https://ehi-multisystems-fl85.vercel.app',
        }).valid,
        true
      );

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

  describe('2. Paystack Reference Specification & Generation Contracts', () => {
    test('generatePaystackReference produces safe dashed references matching Paystack specification', () => {
      const ref = generatePaystackReference(PLANS.BRIDGE);
      assert.ok(ref.startsWith('ehi-november-bridge-'));
      assert.strictEqual(PAYSTACK_REFERENCE_REGEX.test(ref), true);
      assert.strictEqual(ref.includes('_'), false, 'Reference must never contain underscores');
    });

    test('isValidPaystackReference strictly permits alphanumeric, dash, dot, equals and rejects underscores', () => {
      assert.strictEqual(isValidPaystackReference('ehi-monthly-licence-a1b2-c3d4'), true);
      assert.strictEqual(isValidPaystackReference('ref.123-abc=xyz'), true);
      assert.strictEqual(isValidPaystackReference('ehi_monthly_licence'), false, 'Underscores are forbidden');
      assert.strictEqual(isValidPaystackReference('ref with space'), false, 'Spaces are forbidden');
      assert.strictEqual(isValidPaystackReference('ref$bad'), false, 'Special characters are forbidden');
      assert.strictEqual(isValidPaystackReference(''), false);
    });
  });

  describe('3. Plan Catalog, Exact Pricing, and Cutoff Contracts', () => {
    test('exact kobo amounts and currency match specifications', () => {
      assert.strictEqual(PLAN_CATALOG[PLANS.BRIDGE].amountKobo, 6300000);
      assert.strictEqual(PLAN_CATALOG[PLANS.BRIDGE].amountNgn, 63000);
      assert.strictEqual(PLAN_CATALOG[PLANS.BRIDGE].currency, 'NGN');

      assert.strictEqual(PLAN_CATALOG[PLANS.MONTHLY].amountKobo, 18000000);
      assert.strictEqual(PLAN_CATALOG[PLANS.MONTHLY].amountNgn, 180000);
      assert.strictEqual(PLAN_CATALOG[PLANS.MONTHLY].currency, 'NGN');

      assert.strictEqual(PLAN_CATALOG[PLANS.HANDOVER].amountKobo, 70000000);
      assert.strictEqual(PLAN_CATALOG[PLANS.HANDOVER].amountNgn, 700000);
      assert.strictEqual(PLAN_CATALOG[PLANS.HANDOVER].currency, 'NGN');
    });

    test('exact 1-second difference between bridge paid_until and card cutoff', () => {
      assert.strictEqual(BRIDGE_EXPIRY_ISO, '2026-11-30T23:59:59+01:00');
      assert.strictEqual(BRIDGE_EXPIRY_EPOCH_MS, 1796079599000);
      assert.strictEqual(BRIDGE_CUTOFF_EPOCH_MS, 1796079600000);
      assert.strictEqual(BRIDGE_CUTOFF_EPOCH_MS - BRIDGE_EXPIRY_EPOCH_MS, 1000);
    });

    test('rejects November Bridge checkout initialization at or after Dec 1 00:00:00+01:00', async () => {
      process.env.VITE_SUPABASE_URL = 'https://mock.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock_service_key';

      const mockService = new PaystackBillingService(
        {
          secretKey: TEST_SECRET_KEY,
          signatureMode: 'legacy',
          mode: 'test',
          appUrl: 'https://ehi-multisystems-fl85.vercel.app',
        },
        {} as any,
        {
          from: () => ({
            insert: async () => ({ error: null }),
          }),
        } as any
      );

      await assert.rejects(
        async () => {
          await mockService.initializeCheckout({
            planId: PLANS.BRIDGE,
            userEmail: 'staff@ehimultisystems.com',
            userId: 'user_123',
            nowMs: BRIDGE_CUTOFF_EPOCH_MS,
          });
        },
        /no longer available for purchase after 01 Dec 2026/
      );
    });
  });

  describe('4. Plan Precedence and Renewal Mathematics (NOW() + 30 Days Minimum Rule)', () => {
    test('monthly renewal enforces GREATEST(COALESCE(existing, now), now + 30 days) and NO stacking', () => {
      const now = new Date('2026-11-15T12:00:00Z').getTime();
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

      // Case A: Expired or first purchase -> sets exactly now + 30 days
      const resultA = calculateTargetEntitlement(PLANS.MONTHLY, { paidUntil: null }, now);
      assert.strictEqual(resultA.paidUntil, new Date(now + thirtyDaysMs).toISOString());
      assert.strictEqual(resultA.isActive, true);
      assert.strictEqual(resultA.isPermanent, false);

      // Case B: Existing coverage has 10 days remaining -> resets to at least now + 30 days, NOT now + 40 days
      const existing10DaysLeft = new Date(now + 10 * 24 * 60 * 60 * 1000).toISOString();
      const resultB = calculateTargetEntitlement(PLANS.MONTHLY, { paidUntil: existing10DaysLeft }, now);
      assert.strictEqual(
        resultB.paidUntil,
        new Date(now + thirtyDaysMs).toISOString(),
        'Must equal now + 30 days, guaranteeing minimum rule without stacking existing + 30'
      );

      // Case C: Existing coverage has 60 days remaining -> never shortens existing longer coverage
      const existing60Days = new Date(now + 60 * 24 * 60 * 60 * 1000).toISOString();
      const resultC = calculateTargetEntitlement(PLANS.MONTHLY, { paidUntil: existing60Days }, now);
      assert.strictEqual(resultC.paidUntil, existing60Days, 'Must preserve existing longer coverage');

      // Case D: Permanent buyout already active -> permanent never downgraded
      const resultD = calculateTargetEntitlement(PLANS.MONTHLY, { isPermanent: true }, now);
      assert.strictEqual(resultD.isPermanent, true);
      assert.strictEqual(resultD.paidUntil, null);
    });

    test('full system handover grants permanent buyout and cannot be downgraded', () => {
      const result = calculateTargetEntitlement(PLANS.HANDOVER, { paidUntil: '2026-12-31T23:59:59Z' });
      assert.strictEqual(result.isPermanent, true);
      assert.strictEqual(result.paidUntil, null);
      assert.strictEqual(result.isActive, true);
    });

    test('bridge plan confirmed after cutoff requires manual resolution without automatic refund', () => {
      const afterCutoffMs = BRIDGE_CUTOFF_EPOCH_MS + 5000;
      const result = calculateTargetEntitlement(PLANS.BRIDGE, {}, afterCutoffMs);
      assert.strictEqual(result.requiresManualResolution, true);
      assert.strictEqual(result.status, 'manual_resolution_required');
      assert.ok(result.message?.includes('Manual billing resolution required'));
    });
  });

  describe('5. Paystack Checkout URL Allowlist Validation', () => {
    test('permits legitimate Paystack checkout hosts', () => {
      assert.strictEqual(isAllowedPaystackUrl('https://checkout.paystack.com/access_code_123'), true);
      assert.strictEqual(isAllowedPaystackUrl('https://standard.paystack.co/pay/xyz'), true);
    });

    test('rejects malicious or spoofed checkout URLs', () => {
      assert.strictEqual(isAllowedPaystackUrl('http://checkout.paystack.com/insecure'), false);
      assert.strictEqual(isAllowedPaystackUrl('https://evil-paystack.com/pay'), false);
      assert.strictEqual(isAllowedPaystackUrl('https://paystack.com.attacker.com/pay'), false);
      assert.strictEqual(isAllowedPaystackUrl('javascript:alert(1)'), false);
      assert.strictEqual(isAllowedPaystackUrl(''), false);
    });
  });

  describe('6. Timing-Safe String Comparison', () => {
    test('timingSafeEqualString behaves correctly with identical and differing inputs', () => {
      assert.strictEqual(timingSafeEqualString('abc123xyz', 'abc123xyz'), true);
      assert.strictEqual(timingSafeEqualString('abc123xyz', 'abc123xyw'), false);
      assert.strictEqual(timingSafeEqualString('abc', 'abcd'), false);
      assert.strictEqual(timingSafeEqualString('', ''), true);
      assert.strictEqual(timingSafeEqualString('a', ''), false);
    });
  });

  describe('7. Service Mock Lifecycle: Validation & Mismatch Rejection', () => {
    const validRef = 'ehi-monthly-licence-valid-uuid-1234';

    test('verifyAndApplyGrant catches missing required secrets upfront', async () => {
      const serviceNoKey = new PaystackBillingService(
        { secretKey: '', signatureMode: 'modern', mode: 'test', appUrl: 'https://example.com' },
        {} as any,
        {} as any
      );
      const res = await serviceNoKey.verifyAndApplyGrant(validRef);
      assert.strictEqual(res.success, false);
      assert.ok(res.error?.includes('PAYSTACK_SECRET_KEY is not configured'));
    });

    test('rejects amount mismatch between transaction record and Paystack confirmation', async () => {
      const mockSupabase: any = {
        from: (table: string) => ({
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  reference: validRef,
                  account_id: 'EHI',
                  plan: PLANS.MONTHLY,
                  amount_kobo: 18000000,
                  currency: 'NGN',
                  mode: 'test',
                  entitlement_granted: false,
                },
                error: null,
              }),
            }),
          }),
        }),
      };

      const mockHttp: any = {
        get: async () => ({
          data: {
            data: {
              status: 'success',
              amount: 6300000, // mismatch: expected 18000000
              currency: 'NGN',
              reference: validRef,
              domain: 'test',
              id: 999,
            },
          },
        }),
      };

      const service = new PaystackBillingService(
        { secretKey: TEST_SECRET_KEY, signatureMode: 'modern', mode: 'test', appUrl: 'https://example.com' },
        mockHttp,
        mockSupabase
      );

      const res = await service.verifyAndApplyGrant(validRef);
      assert.strictEqual(res.success, false);
      assert.ok(res.error?.includes('Amount mismatch'));
    });

    test('rejects currency mismatch when Paystack confirms non-NGN currency', async () => {
      const mockSupabase: any = {
        from: () => ({
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  reference: validRef,
                  account_id: 'EHI',
                  plan: PLANS.MONTHLY,
                  amount_kobo: 18000000,
                  currency: 'NGN',
                  mode: 'test',
                  entitlement_granted: false,
                },
                error: null,
              }),
            }),
          }),
        }),
      };

      const mockHttp: any = {
        get: async () => ({
          data: {
            data: {
              status: 'success',
              amount: 18000000,
              currency: 'USD', // mismatch: non-NGN
              reference: validRef,
              domain: 'test',
              id: 999,
            },
          },
        }),
      };

      const service = new PaystackBillingService(
        { secretKey: TEST_SECRET_KEY, signatureMode: 'modern', mode: 'test', appUrl: 'https://example.com' },
        mockHttp,
        mockSupabase
      );

      const res = await service.verifyAndApplyGrant(validRef);
      assert.strictEqual(res.success, false);
      assert.ok(res.error?.includes('Invalid currency'));
    });

    test('rejects mode mismatch: test transaction verified in live server mode', async () => {
      const mockSupabase: any = {
        from: () => ({
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  reference: validRef,
                  account_id: 'EHI',
                  plan: PLANS.MONTHLY,
                  amount_kobo: 18000000,
                  currency: 'NGN',
                  mode: 'test', // test mode tx
                  entitlement_granted: false,
                },
                error: null,
              }),
            }),
          }),
        }),
      };

      const liveService = new PaystackBillingService(
        { secretKey: 'sk_live_123', signatureMode: 'modern', mode: 'live', appUrl: 'https://example.com' },
        {} as any,
        mockSupabase
      );

      const res = await liveService.verifyAndApplyGrant(validRef);
      assert.strictEqual(res.success, false);
      assert.ok(res.error?.includes('Mode mismatch'));
    });

    test('already-granted shortcut validates mode and account before returning status', async () => {
      const mockSupabase: any = {
        from: (table: string) => ({
          select: () => ({
            eq: () => ({
              single: async () => {
                if (table === 'billing_transactions') {
                  return {
                    data: {
                      reference: validRef,
                      account_id: 'OTHER_CORP', // wrong account
                      plan: PLANS.MONTHLY,
                      amount_kobo: 18000000,
                      currency: 'NGN',
                      mode: 'test',
                      entitlement_granted: true, // shortcut flag
                    },
                    error: null,
                  };
                }
                return { data: { is_active: true, mode: 'test' }, error: null };
              },
            }),
          }),
        }),
      };

      const service = new PaystackBillingService(
        { secretKey: TEST_SECRET_KEY, signatureMode: 'modern', mode: 'test', appUrl: 'https://example.com' },
        {} as any,
        mockSupabase
      );

      const res = await service.verifyAndApplyGrant(validRef);
      assert.strictEqual(res.success, false);
      assert.ok(res.error?.includes('Account mismatch'));
    });

    test('getEntitlement rejects mismatching PAYSTACK_MODE (test entitlement in live environment)', async () => {
      const mockSupabase: any = {
        from: () => ({
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  company_id: 'EHI',
                  plan: 'monthly-licence',
                  is_active: true,
                  is_permanent: false,
                  paid_until: '2026-12-31T00:00:00Z',
                  mode: 'test', // test mode in DB
                  status: 'active',
                },
                error: null,
              }),
            }),
          }),
        }),
      };

      const liveService = new PaystackBillingService(
        { secretKey: 'sk_live_123', signatureMode: 'modern', mode: 'live', appUrl: 'https://example.com' },
        {} as any,
        mockSupabase
      );

      const entitlement = await liveService.getEntitlement();
      assert.strictEqual(entitlement.isActive, false);
      assert.strictEqual(entitlement.status, 'mode_mismatch');
    });
  });

  describe('8. Webhook Route Lifecycle: Fail-Closed Raw Bytes & 5xx Retries', () => {
    test('fails closed with HTTP 400 when raw body buffer is unavailable or pre-parsed', async () => {
      const handler = createWebhookHandler();
      let status = 0;
      let body: any = null;

      const mockRes: any = {
        status: (s: number) => {
          status = s;
          return {
            json: (b: any) => {
              body = b;
            },
          };
        },
      };

      // Request where body is parsed JSON object and rawBody is missing
      const mockReq: any = {
        method: 'POST',
        headers: {},
        body: { event: 'charge.success' }, // not a buffer
        rawBody: undefined,
      };

      await handler(mockReq, mockRes);
      assert.strictEqual(status, 400);
      assert.ok(body.error?.includes('Raw body buffer unavailable'));
    });

    test('returns HTTP 500 on transient verification or database failures so Paystack retries', async () => {
      const failingService: any = {
        verifyAndApplyGrant: async () => {
          throw new Error('Database connection timeout');
        },
      };

      const handler = createWebhookHandler(failingService);
      let status = 0;
      let body: any = null;

      const mockRes: any = {
        status: (s: number) => {
          status = s;
          return {
            json: (b: any) => {
              body = b;
            },
          };
        },
      };

      const raw = Buffer.from(JSON.stringify({ event: 'charge.success', data: { reference: 'ehi-monthly-licence-ref' } }));
      const hexSig = crypto.createHmac('sha512', TEST_SECRET_KEY).update(raw).digest('hex');

      process.env.PAYSTACK_SECRET_KEY = TEST_SECRET_KEY;
      process.env.PAYSTACK_SIGNATURE_MODE = 'legacy';

      const mockReq: any = {
        method: 'POST',
        headers: { 'x-paystack-signature': hexSig },
        rawBody: raw,
      };

      await handler(mockReq, mockRes);
      assert.strictEqual(status, 500, 'Must return 500 on transient error so Paystack retries');
      assert.strictEqual(body.received, false);
      assert.ok(body.error?.includes('Database connection timeout'));
    });

    test('returns HTTP 200 when payment is durably granted', async () => {
      const successService: any = {
        verifyAndApplyGrant: async () => ({
          success: true,
          reference: 'ehi-monthly-licence-ref',
          plan: 'monthly-licence',
          isActive: true,
        }),
      };

      const handler = createWebhookHandler(successService);
      let status = 0;
      let body: any = null;

      const mockRes: any = {
        status: (s: number) => {
          status = s;
          return {
            json: (b: any) => {
              body = b;
            },
          };
        },
      };

      const raw = Buffer.from(JSON.stringify({ event: 'charge.success', data: { reference: 'ehi-monthly-licence-ref' } }));
      const hexSig = crypto.createHmac('sha512', TEST_SECRET_KEY).update(raw).digest('hex');

      process.env.PAYSTACK_SECRET_KEY = TEST_SECRET_KEY;
      process.env.PAYSTACK_SIGNATURE_MODE = 'legacy';

      const mockReq: any = {
        method: 'POST',
        headers: { 'x-paystack-signature': hexSig },
        rawBody: raw,
      };

      await handler(mockReq, mockRes);
      assert.strictEqual(status, 200);
      assert.strictEqual(body.received, true);
      assert.strictEqual(body.grant.isActive, true);
    });

    test('returns HTTP 200 for safely ignored unrelated events', async () => {
      const handler = createWebhookHandler();
      let status = 0;
      let body: any = null;

      const mockRes: any = {
        status: (s: number) => {
          status = s;
          return {
            json: (b: any) => {
              body = b;
            },
          };
        },
      };

      const raw = Buffer.from(JSON.stringify({ event: 'transfer.success', data: {} }));
      const hexSig = crypto.createHmac('sha512', TEST_SECRET_KEY).update(raw).digest('hex');

      process.env.PAYSTACK_SECRET_KEY = TEST_SECRET_KEY;
      process.env.PAYSTACK_SIGNATURE_MODE = 'legacy';

      const mockReq: any = {
        method: 'POST',
        headers: { 'x-paystack-signature': hexSig },
        rawBody: raw,
      };

      await handler(mockReq, mockRes);
      assert.strictEqual(status, 200);
      assert.strictEqual(body.received, true);
      assert.strictEqual(body.ignoredEvent, 'transfer.success');
    });
  });

  describe('9. Route Authorization & Binding Verification', () => {
    test('enforces that verify/:reference forbids non-initiator and non-admin staff', async () => {
      const mockSupabase: any = {
        from: (table: string) => ({
          select: () => ({
            eq: () => ({
              single: async () => {
                if (table === 'billing_transactions') {
                  return {
                    data: {
                      reference: 'ehi-monthly-licence-owned-by-user-1',
                      account_id: 'EHI',
                      initiated_by: 'user_1', // initiated by user_1
                      mode: 'test',
                    },
                    error: null,
                  };
                }
                return { data: null, error: null };
              },
            }),
          }),
        }),
      };

      const router = createBillingRouter({} as any, mockSupabase);

      // We extract the verify/:reference handler from the router stack
      const verifyLayer = router.stack.find((layer: any) => layer.route?.path === '/verify/:reference');
      assert.ok(verifyLayer, 'verify/:reference route must exist');

      // The route has handlers: requireActiveStaffUser and the route logic
      const routeHandlers = verifyLayer.route.stack.map((s: any) => s.handle);
      const mainHandler = routeHandlers[routeHandlers.length - 1];

      let statusCode = 0;
      let responseBody: any = null;

      const res: any = {
        status: (s: number) => {
          statusCode = s;
          return {
            json: (b: any) => {
              responseBody = b;
            },
          };
        },
      };

      // Case A: Staff caller is user_2 (regular cargo agent, not admin, not initiator)
      const reqOtherStaff: any = {
        params: { reference: 'ehi-monthly-licence-owned-by-user-1' },
        staff: { id: 'user_2', email: 'agent2@ehi.com', role: 'cargo_agent', active: true },
      };

      await mainHandler(reqOtherStaff, res);
      assert.strictEqual(statusCode, 403);
      assert.ok(responseBody.error?.includes('not authorized to verify'));

      // Case B: Staff caller is admin -> allowed
      let adminAllowed = false;
      const mockBillingService: any = {
        verifyAndApplyGrant: async () => ({ success: true, reference: 'ref' }),
      };
      const routerWithMock = createBillingRouter(mockBillingService, mockSupabase);
      const adminHandler = routerWithMock.stack.find((l: any) => l.route?.path === '/verify/:reference').route.stack.slice(-1)[0].handle;

      const reqAdmin: any = {
        params: { reference: 'ehi-monthly-licence-owned-by-user-1' },
        staff: { id: 'admin_user', email: 'admin@ehi.com', role: 'admin', active: true },
      };

      const adminRes: any = {
        status: () => ({ json: () => {} }),
        json: () => {
          adminAllowed = true;
        },
      };

      await adminHandler(reqAdmin, adminRes);
      assert.strictEqual(adminAllowed, true, 'Admin must be authorized to verify any transaction');
    });
  });
});
