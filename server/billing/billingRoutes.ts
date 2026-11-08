/**
 * Express Router for Paystack Billing and Entitlement Endpoints
 */

import express, { Request, Response, NextFunction } from 'express';
import {
  PaystackBillingService,
  verifyPaystackWebhookSignature,
  getPaystackConfig,
  PlanId,
} from './paystackService.js';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface AuthenticatedStaffUser {
  id: string;
  email: string;
  role: string;
  active: boolean;
}

export interface AuthenticatedRequest extends Request {
  staff?: AuthenticatedStaffUser;
  rawBody?: Buffer;
}

/**
 * Middleware ensuring caller is an authenticated staff user with active = true in user_profiles.
 */
export async function requireActiveStaffUser(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();

    if (!token) {
      res.status(401).json({ error: 'Unauthorized: missing authorization bearer token' });
      return;
    }

    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      res.status(503).json({ error: 'Supabase configuration missing on server' });
      return;
    }

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const {
      data: { user },
      error: authErr,
    } = await adminClient.auth.getUser(token);

    if (authErr || !user) {
      res.status(401).json({ error: 'Invalid or expired session' });
      return;
    }

    // Enforce active user_profiles membership
    const { data: profile, error: profileErr } = await adminClient
      .from('user_profiles')
      .select('id, email, name, role, active')
      .eq('id', user.id)
      .single();

    if (profileErr || !profile) {
      res.status(403).json({ error: 'Staff profile not found' });
      return;
    }

    if (profile.active !== true) {
      res.status(403).json({ error: 'Deactivated staff accounts are not permitted to access billing operations' });
      return;
    }

    req.staff = {
      id: user.id,
      email: user.email || profile.email || '',
      role: profile.role,
      active: profile.active,
    };

    next();
  } catch (err: any) {
    console.error('requireActiveStaffUser authentication error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Staff authentication verification failed' });
    }
  }
}

export function createBillingRouter(
  billingService: PaystackBillingService = new PaystackBillingService(),
  supabaseClient: SupabaseClient | null = null
) {
  const router = express.Router();

  const getAdminClient = (): SupabaseClient => {
    if (supabaseClient) return supabaseClient;
    const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    if (!supabaseUrl || !serviceKey) {
      throw new Error('Supabase configuration missing on server');
    }
    return createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  };

  /**
   * Authoritative company entitlement status.
   * Requires active staff authentication to prevent unauthorized reconnaissance.
   */
  router.get('/entitlement', requireActiveStaffUser, async (_req: AuthenticatedRequest, res: Response) => {
    try {
      const entitlement = await billingService.getEntitlement();
      res.json(entitlement);
    } catch (err: any) {
      console.error('Failed to get entitlement:', err);
      res.status(500).json({ error: 'Failed to retrieve entitlement status' });
    }
  });

  /**
   * Initializes a Paystack checkout transaction for active authenticated staff.
   */
  router.post('/initialize', requireActiveStaffUser, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { planId } = req.body;
      if (!planId) {
        res.status(400).json({ error: 'Missing required planId' });
        return;
      }

      const staff = req.staff;
      if (!staff || !staff.id || !staff.email) {
        res.status(401).json({ error: 'Unable to identify active staff caller for checkout' });
        return;
      }

      const result = await billingService.initializeCheckout({
        planId: planId as PlanId,
        userEmail: staff.email,
        userId: staff.id,
      });

      res.json(result);
    } catch (err: any) {
      console.error('Billing initialization error:', err);
      res.status(400).json({ error: err.message || 'Failed to initialize checkout' });
    }
  });

  /**
   * Server-side transaction verification and authoritative atomic grant.
   * Requires authenticated active staff caller.
   * Enforces that the caller is either the user who initiated the checkout or an admin.
   * Prevents arbitrary verification API abuse.
   */
  router.get('/verify/:reference', requireActiveStaffUser, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { reference } = req.params;
      if (!reference) {
        res.status(400).json({ error: 'Missing transaction reference' });
        return;
      }

      const staff = req.staff!;
      const admin = getAdminClient();

      // Look up transaction to verify ownership / account binding
      const { data: tx, error: txErr } = await admin
        .from('billing_transactions')
        .select('initiated_by, account_id, mode, status, entitlement_granted')
        .eq('reference', reference)
        .single();

      if (txErr || !tx) {
        res.status(404).json({ error: `Transaction reference not found: ${reference}` });
        return;
      }

      if (tx.account_id !== 'EHI') {
        res.status(403).json({ error: 'Forbidden: transaction belongs to a different account' });
        return;
      }

      const isInitiator = tx.initiated_by === staff.id;
      const isAdmin = ['super_admin', 'admin'].includes(staff.role);

      if (!isInitiator && !isAdmin) {
        res.status(403).json({
          error: 'Forbidden: you are not authorized to verify a transaction initiated by another staff member',
        });
        return;
      }

      const result = await billingService.verifyAndApplyGrant(reference);
      if (!result.success && !result.requiresManualResolution) {
        res.status(400).json(result);
        return;
      }

      res.json(result);
    } catch (err: any) {
      console.error('Billing verification error:', err);
      res.status(500).json({ error: err.message || 'Verification failed' });
    }
  });

  return router;
}

/**
 * Webhook handler with timing-safe raw bytes verification.
 * Fails closed if exact raw bytes are unavailable.
 * Returns 5xx on transient/server failures so Paystack retries.
 * Returns 200 only when durably processed or safely ignored.
 */
export function createWebhookHandler(billingService: PaystackBillingService = new PaystackBillingService()) {
  return async (req: any, res: Response) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method Not Allowed' });
      return;
    }

    // Retrieve raw body buffer
    let rawBody: Buffer | null = null;
    if (Buffer.isBuffer(req.rawBody)) {
      rawBody = req.rawBody;
    } else if (Buffer.isBuffer(req.body)) {
      rawBody = req.body;
    } else if (typeof req.body === 'string') {
      rawBody = Buffer.from(req.body, 'utf8');
    } else if (req.readable && !req.readableEnded) {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
        }
        rawBody = Buffer.concat(chunks);
      } catch (streamErr) {
        console.error('Failed to read raw request stream in webhook handler:', streamErr);
      }
    }

    // Fail closed if exact raw bytes are missing or if body was already pre-parsed into an object
    if (!rawBody || rawBody.length === 0) {
      res.status(400).json({
        error: 'Raw body buffer unavailable for HMAC verification. Request must preserve exact unparsed raw bytes.',
      });
      return;
    }

    const config = getPaystackConfig();
    const verification = verifyPaystackWebhookSignature(rawBody, req.headers, config);

    if (!verification.valid) {
      console.warn('Paystack webhook rejected: signature verification failed.', verification.error);
      res.status(400).json({ error: verification.error || 'Invalid signature' });
      return;
    }

    let payload: any;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      res.status(400).json({ error: 'Malformed JSON payload' });
      return;
    }

    const event = payload?.event;
    const reference = payload?.data?.reference;

    // Process charge.success
    if (event === 'charge.success' && reference) {
      try {
        const grantResult = await billingService.verifyAndApplyGrant(reference);

        if (grantResult.success || grantResult.requiresManualResolution) {
          // Durably processed (active grant, idempotent grant, or recorded late bridge needing manual resolution)
          res.status(200).json({ received: true, grant: grantResult });
          return;
        }

        // If grantResult was not successful due to transient/server failure, return 500 so Paystack retries
        console.error('Webhook verification/grant rejected transiently for ref:', reference, grantResult.error);
        res.status(500).json({
          received: false,
          error: grantResult.error || 'Transient payment verification failure, retry requested',
        });
        return;
      } catch (grantErr: any) {
        console.error('Webhook grant processing exception for ref:', reference, grantErr);
        res.status(500).json({
          received: false,
          error: grantErr.message || 'Transient database/server error, retry requested',
        });
        return;
      }
    }

    // Safely ignored unrelated event (e.g. transfer.success, subscription.create)
    res.status(200).json({ received: true, ignoredEvent: event });
  };
}
