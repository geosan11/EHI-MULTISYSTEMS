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

// Paystack reference specification: allowed characters are strictly alphanumeric, dash, dot, equals
// Underscores are NOT permitted by Paystack's documented reference specification.
export const PAYSTACK_REFERENCE_REGEX = /^[a-zA-Z0-9.\-=]+$/;

export function isValidPaystackReference(ref: string): boolean {
  if (!ref || typeof ref !== 'string') return false;
  if (ref.includes('_')) return false;
  return PAYSTACK_REFERENCE_REGEX.test(ref);
}

export function generatePaystackReference(planId: string): string {
  const safePlan = planId.replace(/[^a-zA-Z0-9]/g, '-');
  const safeUuid = crypto.randomUUID();
  const ref = `ehi-${safePlan}-${safeUuid}`;
  if (!isValidPaystackReference(ref)) {
    throw new Error(`Generated reference ${ref} violates Paystack allowed character specification`);
  }
  return ref;
}

// Allowlisted Paystack checkout hostnames
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

export interface EntitlementTargetCalculation {
  paidUntil: string | null;
  isPermanent: boolean;
  isActive: boolean;
  status: string;
  requiresManualResolution?: boolean;
  message?: string;
}

/**
 * Pure calculation helper for entitlement renewals and precedence.
 * Enforces:
 * 1. Full Handover: permanent = true, paidUntil = null. Never downgrades.
 * 2. Bridge: exact cutoff 2026-11-30T23:59:59+01:00. If after cutoff, requires manual resolution.
 *    Never shortens longer existing coverage or permanent buyout.
 * 3. Monthly: GREATEST(COALESCE(existing, now), now + 30 days) minimum rule.
 *    No stacking onto existing! Guarantees at least 30 days coverage from payment time,
 *    never shortens existing longer coverage, and never downgrades permanent status.
 */
export function calculateTargetEntitlement(
  plan: PlanId,
  existing: {
    paidUntil?: string | null;
    isPermanent?: boolean;
  },
  nowMs: number = Date.now()
): EntitlementTargetCalculation {
  if (plan === PLANS.HANDOVER) {
    return {
      paidUntil: null,
      isPermanent: true,
      isActive: true,
      status: 'active',
    };
  }

  if (plan === PLANS.BRIDGE) {
    if (nowMs > BRIDGE_EXPIRY_EPOCH_MS) {
      return {
        paidUntil: existing.paidUntil ?? null,
        isPermanent: existing.isPermanent ?? false,
        isActive: existing.isPermanent ? true : (existing.paidUntil ? new Date(existing.paidUntil).getTime() > nowMs : false),
        status: 'manual_resolution_required',
        requiresManualResolution: true,
        message: 'Late bridge payment confirmed after 2026-11-30T23:59:59+01:00. Manual billing resolution required, no automatic refund.',
      };
    }
    if (existing.isPermanent) {
      return { paidUntil: null, isPermanent: true, isActive: true, status: 'active' };
    }
    const existingMs = existing.paidUntil ? new Date(existing.paidUntil).getTime() : 0;
    const targetMs = Math.max(existingMs, BRIDGE_EXPIRY_EPOCH_MS);
    return {
      paidUntil: new Date(targetMs).toISOString(),
      isPermanent: false,
      isActive: true,
      status: 'active',
    };
  }

  if (plan === PLANS.MONTHLY) {
    if (existing.isPermanent) {
      return { paidUntil: null, isPermanent: true, isActive: true, status: 'active' };
    }
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const minTargetMs = nowMs + thirtyDaysMs;
    const existingMs = existing.paidUntil ? new Date(existing.paidUntil).getTime() : 0;
    const targetMs = Math.max(existingMs, minTargetMs);
    return {
      paidUntil: new Date(targetMs).toISOString(),
      isPermanent: false,
      isActive: true,
      status: 'active',
    };
  }

  throw new Error(`Unrecognized plan: ${plan}`);
}

export interface WebhookVerificationResult {
  valid: boolean;
  scheme: 'modern' | 'legacy' | 'none';
  error?: string;
  timestamp?: number;
}

/**
 * Verifies Paystack Webhook Signature timing-safely over exact raw bytes.
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

  private assertRequiredSecrets(): void {
    if (!this.config.secretKey) {
      throw new Error('PAYSTACK_SECRET_KEY is not configured on server');
    }
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      throw new Error('Supabase configuration (VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) is missing on server');
    }
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
    // 0. Catch missing secrets before initializing any transaction
    this.assertRequiredSecrets();

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

    // Generate safe dashed Paystack reference: ehi-<plan>-<safeUUID> (alphanumeric and dashes, NO underscores)
    const reference = generatePaystackReference(params.planId);

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

    if (!isValidPaystackReference(reference)) {
      return { success: false, reference, error: 'Invalid reference format: reference contains disallowed characters' };
    }

    // Catch missing secrets before proceeding
    if (!this.config.secretKey) {
      return { success: false, reference, error: 'PAYSTACK_SECRET_KEY is not configured on server' };
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
        error: `TRANSACTION_NOT_FOUND: Transaction reference not found in database: ${reference}`,
      };
    }

    // Mode and account validation: prevent cross-tenant or test transactions unlocking production
    if (tx.account_id !== 'EHI') {
      return {
        success: false,
        reference,
        error: `Account mismatch: transaction is bound to ${tx.account_id}, expected EHI`,
      };
    }

    if (tx.mode !== this.config.mode) {
      return {
        success: false,
        reference,
        error: `Mode mismatch: transaction mode is ${tx.mode}, server mode is ${this.config.mode}`,
      };
    }

    // If already granted, validate mode/account before returning current status
    if (tx.entitlement_granted) {
      const { data: ent } = await admin
        .from('ehi_entitlement')
        .select('is_active, is_permanent, paid_until, status, mode')
        .eq('company_id', 'EHI')
        .single();

      if (ent && ent.mode !== this.config.mode) {
        return {
          success: false,
          reference,
          error: `Mode mismatch: entitlement mode is ${ent.mode}, server mode is ${this.config.mode}`,
        };
      }

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

    // Mode validation: Prevent test transactions unlocking live environments
    if (verifiedDomain && (verifiedDomain !== tx.mode || verifiedDomain !== this.config.mode)) {
      return {
        success: false,
        reference,
        error: `Mode mismatch: transaction is ${tx.mode}, server is ${this.config.mode}, Paystack verified domain is ${verifiedDomain}`,
      };
    }

    // Metadata account verification
    if (paystackData.metadata?.account_id && paystackData.metadata.account_id !== 'EHI') {
      return {
        success: false,
        reference,
        error: `Account mismatch in metadata: expected EHI, got ${paystackData.metadata.account_id}`,
      };
    }

    // 4. Invoke Atomic Grant RPC
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
   * Bound status read selects minimal fields only.
   * Strictly rejects mismatching PAYSTACK_MODE.
   */
  async getEntitlement(): Promise<{
    isActive: boolean;
    isPermanent: boolean;
    plan: string;
    paidUntil: string | null;
    status: string;
    mode: string;
    serverTime: string;
  }> {
    const admin = this.getSupabaseAdmin();
    const { data: ent, error } = await admin
      .from('ehi_entitlement')
      .select('company_id, plan, is_active, is_permanent, paid_until, mode, status')
      .eq('company_id', 'EHI')
      .single();

    if (error || !ent) {
      return {
        isActive: false,
        isPermanent: false,
        plan: 'bridge',
        paidUntil: null,
        status: 'expired',
        mode: this.config.mode,
        serverTime: new Date().toISOString(),
      };
    }

    // Strictly reject mismatching mode: test entitlement must NEVER unlock production
    if (ent.mode !== this.config.mode) {
      return {
        isActive: false,
        isPermanent: false,
        plan: ent.plan,
        paidUntil: ent.paid_until,
        status: 'mode_mismatch',
        mode: ent.mode,
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
      mode: ent.mode,
      serverTime: new Date().toISOString(),
    };
  }
}
