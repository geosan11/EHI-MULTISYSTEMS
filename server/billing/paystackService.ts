/**
 * Paystack Automatic Billing and Entitlement Service
 *
 * Implements server-side transaction initialization, raw webhook signature verification
 * (both modern timestamped Paystack-Signature and legacy x-paystack-signature),
 * Paystack verification API validation, and authoritative atomic singleton grants.
 */

import crypto from 'crypto';
import axios, { type AxiosInstance } from 'axios';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const PLANS = {
  BRIDGE: 'november-bridge',
  MONTHLY: 'monthly-licence',
  HANDOVER: 'system-handover',
} as const;

export type PlanId = (typeof PLANS)[keyof typeof PLANS];

export interface PlanConfig {
  id: PlanId;
  name: string;
  amountKobo: number; // in NGN kobo
  amountNgn: number;
  currency: 'NGN';
}

export const PLAN_CATALOG: Record<PlanId, PlanConfig> = {
  [PLANS.BRIDGE]: {
    id: PLANS.BRIDGE,
    name: 'November Cloud Bridge',
    amountKobo: 6300000, // ₦63,000
    amountNgn: 63000,
    currency: 'NGN',
  },
  [PLANS.MONTHLY]: {
    id: PLANS.MONTHLY,
    name: 'Monthly System Licence',
    amountKobo: 18000000, // ₦180,000
    amountNgn: 180000,
    currency: 'NGN',
  },
  [PLANS.HANDOVER]: {
    id: PLANS.HANDOVER,
    name: 'Full System Handover',
    amountKobo: 70000000, // ₦700,000
    amountNgn: 700000,
    currency: 'NGN',
  },
};

// Exact boundary timestamps
export const BRIDGE_CUTOFF_EPOCH_MS = 1796079600000; // 2026-12-01T00:00:00+01:00
export const BRIDGE_EXPIRY_ISO = '2026-11-30T23:59:59+01:00';
export const BRIDGE_EXPIRY_EPOCH_MS = 1796079599000; // Exact 1 second before cutoff

// Allowlisted Paystack checkout hostname
export const ALLOWED_PAYSTACK_HOSTS = [
  'checkout.paystack.com',
  'standard.paystack.co',
];

export interface PaystackConfig {
  secretKey: string;
  publicKey?: string;
  webhookSecret?: string;
  signatureMode: 'modern' | 'legacy' | 'auto';
  mode: 'test' | 'live';
  appUrl: string;
}

export function getPaystackConfig(): PaystackConfig {
  const secretKey = process.env.PAYSTACK_SECRET_KEY || '';
  const publicKey = process.env.PAYSTACK_PUBLIC_KEY || '';
  const webhookSecret = process.env.PAYSTACK_WEBHOOK_SECRET || '';
  const envMode = process.env.PAYSTACK_MODE;

  // Determine mode from env or key prefix
  let mode: 'test' | 'live' = 'test';
  if (envMode === 'live' || secretKey.startsWith('sk_live_')) {
    mode = 'live';
  }

  // Signature mode: modern, legacy, or auto
  let signatureMode: 'modern' | 'legacy' | 'auto' = 'auto';
  const configuredSigMode = process.env.PAYSTACK_SIGNATURE_MODE?.toLowerCase();
  if (configuredSigMode === 'modern') {
    signatureMode = 'modern';
  } else if (configuredSigMode === 'legacy') {
    signatureMode = 'legacy';
  } else {
    // If webhookSecret is explicitly provided, default to modern
    signatureMode = webhookSecret ? 'modern' : 'legacy';
  }

  const appUrl = (process.env.APP_URL || 'https://ehi-multisystems-fl85.vercel.app').replace(/\/$/, '');

  return {
    secretKey,
    publicKey,
    webhookSecret,
    signatureMode,
    mode,
    appUrl,
  };
}

/**
 * Validates that a returned Paystack checkout URL belongs to the allowlisted Paystack checkout domains.
 */
export function isAllowedPaystackUrl(urlStr: string): boolean {
  if (!urlStr) return false;
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== 'https:') return false;
    return ALLOWED_PAYSTACK_HOSTS.some(
      (host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`)
    );
  } catch {
    return false;
  }
}

/**
 * Timing-safe string/buffer comparison to prevent timing attacks.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export interface WebhookVerificationResult {
  valid: boolean;
  scheme: 'modern' | 'legacy' | 'none';
  error?: string;
  timestamp?: number;
}

/**
 * Verifies Paystack Webhook Signature timing-safely over exact raw bytes.
 *
 * Supports BOTH:
 * 1. Modern Paystack-Signature: `t=unix,v1=key_id:hex_signature` (or multiple `v1=...`)
 *    HMAC-SHA512 of `t + "." + rawBody` using `PAYSTACK_WEBHOOK_SECRET` (`whsec_...`).
 *    Anti-replay tolerance: 300 seconds.
 * 2. Legacy x-paystack-signature: hex HMAC-SHA512 of `rawBody` using `PAYSTACK_SECRET_KEY` (`sk_...`).
 *
 * Strict policy: If modern signature mode is configured, legacy fallback is NEVER allowed.
 */
export function verifyPaystackWebhookSignature(
  rawBody: Buffer,
  headers: Record<string, string | string[] | undefined>,
  config: PaystackConfig,
  currentUnixTimeSec: number = Math.floor(Date.now() / 1000)
): WebhookVerificationResult {
  const getHeader = (name: string): string => {
    const val = headers[name.toLowerCase()] ?? headers[name];
    if (Array.isArray(val)) return val[0] || '';
    return typeof val === 'string' ? val : '';
  };

  const modernHeader = getHeader('paystack-signature');
  const legacyHeader = getHeader('x-paystack-signature');

  // Enforce explicit modern mode
  if (config.signatureMode === 'modern') {
    if (!modernHeader) {
      return {
        valid: false,
        scheme: 'none',
        error: 'Missing required modern Paystack-Signature header (legacy fallback disabled)',
      };
    }
    return verifyModernSignature(rawBody, modernHeader, config.webhookSecret, currentUnixTimeSec);
  }

  // Enforce explicit legacy mode
  if (config.signatureMode === 'legacy') {
    if (!legacyHeader) {
      return {
        valid: false,
        scheme: 'none',
        error: 'Missing required x-paystack-signature header',
      };
    }
    return verifyLegacySignature(rawBody, legacyHeader, config.secretKey);
  }

  // Auto mode: check modern first if present, otherwise legacy
  if (modernHeader && config.webhookSecret) {
    return verifyModernSignature(rawBody, modernHeader, config.webhookSecret, currentUnixTimeSec);
  }

  if (legacyHeader && config.secretKey) {
    return verifyLegacySignature(rawBody, legacyHeader, config.secretKey);
  }

  return {
    valid: false,
    scheme: 'none',
    error: 'No valid signature header or matching signing secret configured',
  };
}

function verifyModernSignature(
  rawBody: Buffer,
  headerValue: string,
  webhookSecret: string | undefined,
  currentUnixSec: number
): WebhookVerificationResult {
  if (!webhookSecret) {
    return {
      valid: false,
      scheme: 'modern',
      error: 'PAYSTACK_WEBHOOK_SECRET is not configured on server',
    };
  }

  // Header format: t=1760270400,v1=whk_id:hex_sig (may have multiple v1=)
  const parts = headerValue.split(',').map((p) => p.trim());
  let timestampStr = '';
  const signatures: string[] = [];

  for (const part of parts) {
    if (part.startsWith('t=')) {
      timestampStr = part.substring(2);
    } else if (part.startsWith('v1=')) {
      const v1Content = part.substring(3);
      // v1 is either key_id:hex_signature or raw hex_signature
      const colonIdx = v1Content.indexOf(':');
      const hexSig = colonIdx !== -1 ? v1Content.substring(colonIdx + 1) : v1Content;
      if (hexSig) signatures.push(hexSig);
    }
  }

  if (!timestampStr) {
    return {
      valid: false,
      scheme: 'modern',
      error: 'Malformed Paystack-Signature: missing timestamp t=',
    };
  }

  const timestamp = parseInt(timestampStr, 10);
  if (isNaN(timestamp)) {
    return {
      valid: false,
      scheme: 'modern',
      error: 'Malformed Paystack-Signature: timestamp is not a number',
    };
  }

  // Anti-replay check: 300s tolerance
  const timeDiff = Math.abs(currentUnixSec - timestamp);
  if (timeDiff > 300) {
    return {
      valid: false,
      scheme: 'modern',
      timestamp,
      error: `Timestamp tolerance exceeded: difference ${timeDiff}s > 300s`,
    };
  }

  if (signatures.length === 0) {
    return {
      valid: false,
      scheme: 'modern',
      timestamp,
      error: 'Malformed Paystack-Signature: missing v1 signature',
    };
  }

  // Construct signed payload: t + "." + rawBody
  const prefixBuf = Buffer.from(`${timestamp}.`, 'utf8');
  const signedPayload = Buffer.concat([prefixBuf, rawBody]);

  const computedSig = crypto
    .createHmac('sha512', webhookSecret)
    .update(signedPayload)
    .digest('hex');

  const matches = signatures.some((expectedSig) =>
    timingSafeEqualString(computedSig.toLowerCase(), expectedSig.toLowerCase())
  );

  if (!matches) {
    return {
      valid: false,
      scheme: 'modern',
      timestamp,
      error: 'Modern webhook signature mismatch',
    };
  }

  return {
    valid: true,
    scheme: 'modern',
    timestamp,
  };
}

function verifyLegacySignature(
  rawBody: Buffer,
  headerValue: string,
  secretKey: string
): WebhookVerificationResult {
  if (!secretKey) {
    return {
      valid: false,
      scheme: 'legacy',
      error: 'PAYSTACK_SECRET_KEY is not configured on server',
    };
  }

  const expectedSig = headerValue.trim().toLowerCase();
  const computedSig = crypto
    .createHmac('sha512', secretKey)
    .update(rawBody)
    .digest('hex')
    .toLowerCase();

  const matches = timingSafeEqualString(computedSig, expectedSig);

  if (!matches) {
    return {
      valid: false,
      scheme: 'legacy',
      error: 'Legacy webhook signature mismatch',
    };
  }

  return {
    valid: true,
    scheme: 'legacy',
  };
}

/**
 * Service class handling Paystack API interactions and database integration.
 */
export class PaystackBillingService {
  private config: PaystackConfig;
  private httpClient: AxiosInstance;
  private supabase: SupabaseClient | null;

  constructor(
    config: PaystackConfig = getPaystackConfig(),
    httpClient: AxiosInstance = axios,
    supabase: SupabaseClient | null = null
  ) {
    this.config = config;
    this.httpClient = httpClient;
    this.supabase = supabase;
  }

  private getSupabaseAdmin(): SupabaseClient {
    if (this.supabase) return this.supabase;
    const url = process.env.VITE_SUPABASE_URL || '';
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    if (!url || !serviceKey) {
      throw new Error('Supabase admin credentials not configured on server');
    }
    return createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  /**
   * Initializes a Paystack checkout transaction.
   *
   * 1. Validates plan existence.
   * 2. Checks November Bridge cutoff (rejects if now >= Dec 1 midnight+01).
   * 3. Generates cryptographically unique reference.
   * 4. Inserts initialized transaction record into database.
   * 5. Calls Paystack POST /transaction/initialize.
   * 6. Validates returned authorization_url against allowlist.
   */
  async initializeCheckout(params: {
    planId: PlanId;
    userEmail: string;
    userId: string;
    nowMs?: number;
  }): Promise<{
    reference: string;
    authorizationUrl: string;
    plan: PlanConfig;
  }> {
    const nowMs = params.nowMs ?? Date.now();
    const plan = PLAN_CATALOG[params.planId];
    if (!plan) {
      throw new Error(`Invalid plan: ${params.planId}`);
    }

    // Bridge cutoff check
    if (params.planId === PLANS.BRIDGE && nowMs >= BRIDGE_CUTOFF_EPOCH_MS) {
      throw new Error(
        'The November Cloud Bridge plan is no longer available for purchase after 01 Dec 2026.'
      );
    }

    if (!params.userEmail || !params.userEmail.includes('@')) {
      throw new Error('A valid staff email address is required for checkout billing.');
    }

    // Generate random reference
    const randomHex = crypto.randomBytes(8).toString('hex');
    const reference = `ehi_${params.planId.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}_${randomHex}`;

    // 1. Insert transaction into durable database
    const admin = this.getSupabaseAdmin();
    const { error: insertErr } = await admin.from('billing_transactions').insert({
      reference,
      account_id: 'EHI',
      plan: plan.id,
      amount_kobo: plan.amountKobo,
      currency: 'NGN',
      mode: this.config.mode,
      status: 'initialized',
      initiated_by: params.userId,
      initiated_at: new Date(nowMs).toISOString(),
    });

    if (insertErr) {
      console.error('Failed to record billing_transaction before checkout init:', insertErr);
      throw new Error(`Failed to initialize billing transaction: ${insertErr.message}`);
    }

    // 2. Call Paystack API
    const callbackUrl = `${this.config.appUrl}/billing/callback`;
    const paystackPayload = {
      reference,
      amount: plan.amountKobo,
      email: params.userEmail,
      currency: 'NGN',
      callback_url: callbackUrl,
      metadata: {
        account_id: 'EHI',
        plan: plan.id,
        mode: this.config.mode,
        user_id: params.userId,
      },
    };

    let responseData: any;
    try {
      const response = await this.httpClient.post(
        'https://api.paystack.co/transaction/initialize',
        paystackPayload,
        {
          headers: {
            Authorization: `Bearer ${this.config.secretKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 15000,
        }
      );
      responseData = response.data;
    } catch (apiErr: any) {
      console.error('Paystack transaction/initialize API error:', apiErr?.response?.data || apiErr.message);
      // Update transaction status to failed
      await admin
        .from('billing_transactions')
        .update({ status: 'failed', grant_notes: `API Error: ${apiErr.message}` })
        .eq('reference', reference);
      throw new Error(`Paystack initialization failed: ${apiErr?.response?.data?.message || apiErr.message}`);
    }

    if (!responseData?.status || !responseData?.data?.authorization_url) {
      await admin
        .from('billing_transactions')
        .update({ status: 'failed', grant_notes: 'Missing authorization_url from Paystack' })
        .eq('reference', reference);
      throw new Error('Paystack did not return a valid checkout URL.');
    }

    const authorizationUrl = responseData.data.authorization_url;
    if (!isAllowedPaystackUrl(authorizationUrl)) {
      console.error('Paystack returned disallowed checkout host URL:', authorizationUrl);
      await admin
        .from('billing_transactions')
        .update({ status: 'failed', grant_notes: `Disallowed host in authorization_url: ${authorizationUrl}` })
        .eq('reference', reference);
      throw new Error('Received invalid checkout host URL from payment gateway.');
    }

    return {
      reference,
      authorizationUrl,
      plan,
    };
  }

  /**
   * Verifies a transaction with Paystack and applies atomic grant.
   */
  async verifyAndApplyGrant(reference: string): Promise<{
    success: boolean;
    reference: string;
    plan?: string;
    isActive?: boolean;
    isPermanent?: boolean;
    paidUntil?: string | null;
    status?: string;
    requiresManualResolution?: boolean;
    message?: string;
    error?: string;
  }> {
    if (!reference || typeof reference !== 'string') {
      return { success: false, reference: '', error: 'Missing reference' };
    }

    const admin = this.getSupabaseAdmin();

    // 1. Fetch transaction record from database
    const { data: tx, error: fetchErr } = await admin
      .from('billing_transactions')
      .select('*')
      .eq('reference', reference)
      .single();

    if (fetchErr || !tx) {
      return {
        success: false,
        reference,
        error: `Transaction reference not found in database: ${reference}`,
      };
    }

    // If already granted, return current status
    if (tx.entitlement_granted) {
      const { data: ent } = await admin
        .from('ehi_entitlement')
        .select('*')
        .eq('company_id', 'EHI')
        .single();
      return {
        success: true,
        reference,
        plan: tx.plan,
        isActive: ent?.is_active ?? true,
        isPermanent: ent?.is_permanent ?? false,
        paidUntil: ent?.paid_until ?? null,
        status: ent?.status ?? 'active',
      };
    }

    // 2. Call Paystack verify endpoint
    let paystackData: any;
    try {
      const response = await this.httpClient.get(
        `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
        {
          headers: {
            Authorization: `Bearer ${this.config.secretKey}`,
          },
          timeout: 15000,
        }
      );
      paystackData = response.data?.data;
    } catch (apiErr: any) {
      console.error(`Paystack verify API call failed for ${reference}:`, apiErr?.response?.data || apiErr.message);
      return {
        success: false,
        reference,
        error: `Failed to verify with Paystack: ${apiErr?.response?.data?.message || apiErr.message}`,
      };
    }

    if (!paystackData) {
      return { success: false, reference, error: 'Empty transaction data from Paystack' };
    }

    // 3. Server-side validation before grant
    const verifiedStatus = paystackData.status; // 'success'
    const verifiedAmount = paystackData.amount; // kobo
    const verifiedCurrency = paystackData.currency; // 'NGN'
    const verifiedRef = paystackData.reference;
    const verifiedDomain = paystackData.domain; // 'test' | 'live'
    const paystackId = paystackData.id ? String(paystackData.id) : null;

    if (verifiedRef !== reference) {
      return { success: false, reference, error: 'Reference mismatch from Paystack' };
    }

    if (verifiedStatus !== 'success') {
      await admin
        .from('billing_transactions')
        .update({
          status: 'failed',
          paystack_data: paystackData,
          updated_at: new Date().toISOString(),
        })
        .eq('reference', reference);
      return { success: false, reference, error: `Paystack status is not success: ${verifiedStatus}` };
    }

    if (verifiedCurrency !== 'NGN') {
      return { success: false, reference, error: `Invalid currency: ${verifiedCurrency}` };
    }

    if (verifiedAmount !== tx.amount_kobo) {
      return {
        success: false,
        reference,
        error: `Amount mismatch: expected ${tx.amount_kobo} kobo, got ${verifiedAmount} kobo`,
      };
    }

    // Domain / Mode validation: Prevent test transactions unlocking live environments
    if (verifiedDomain && verifiedDomain !== tx.mode) {
      return {
        success: false,
        reference,
        error: `Mode mismatch: transaction is ${tx.mode}, Paystack verified domain is ${verifiedDomain}`,
      };
    }

    // 4. Invoke Atomic Security-Definer Grant RPC
    const { data: rpcResult, error: rpcErr } = await admin.rpc('apply_billing_grant_atomic', {
      p_reference: reference,
      p_paystack_data: paystackData,
      p_verified_amount_kobo: verifiedAmount,
      p_verified_currency: verifiedCurrency,
      p_paystack_status: verifiedStatus,
      p_mode: tx.mode,
      p_paystack_id: paystackId,
    });

    if (rpcErr) {
      console.error('apply_billing_grant_atomic RPC failed:', rpcErr);
      return {
        success: false,
        reference,
        error: `Database atomic grant failed: ${rpcErr.message}`,
      };
    }

    if (!rpcResult?.success) {
      return {
        success: false,
        reference,
        requiresManualResolution: rpcResult?.requires_manual_resolution ?? false,
        error: rpcResult?.error || 'Grant rejected',
        message: rpcResult?.message,
      };
    }

    return {
      success: true,
      reference,
      plan: rpcResult.plan,
      isActive: rpcResult.is_active,
      isPermanent: rpcResult.is_permanent,
      paidUntil: rpcResult.paid_until,
      status: rpcResult.status,
    };
  }

  /**
   * Reads current authoritative entitlement from database singleton.
   */
  async getEntitlement(): Promise<{
    isActive: boolean;
    isPermanent: boolean;
    plan: string;
    paidUntil: string | null;
    status: string;
    serverTime: string;
  }> {
    const admin = this.getSupabaseAdmin();
    const { data: ent, error } = await admin
      .from('ehi_entitlement')
      .select('*')
      .eq('company_id', 'EHI')
      .single();

    if (error || !ent) {
      return {
        isActive: false,
        isPermanent: false,
        plan: 'bridge',
        paidUntil: null,
        status: 'expired',
        serverTime: new Date().toISOString(),
      };
    }

    // Check if non-permanent plan has expired relative to server time
    let isActive = ent.is_active;
    if (isActive && !ent.is_permanent && ent.paid_until) {
      const paidUntilEpoch = new Date(ent.paid_until).getTime();
      if (Date.now() > paidUntilEpoch) {
        isActive = false;
      }
    }

    return {
      isActive,
      isPermanent: ent.is_permanent,
      plan: ent.plan,
      paidUntil: ent.paid_until,
      status: isActive ? 'active' : ent.status,
      serverTime: new Date().toISOString(),
    };
  }
}
