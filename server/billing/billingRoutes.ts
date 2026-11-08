/**
 * Express Router for Paystack Billing and Entitlement Endpoints
 */

import express, { Request, Response } from 'express';
import {
  PaystackBillingService,
  verifyPaystackWebhookSignature,
  getPaystackConfig,
  PlanId,
} from './paystackService.js';
import { requireAuthenticatedUser } from '../app.js';

export function createBillingRouter(billingService: PaystackBillingService = new PaystackBillingService()) {
  const router = express.Router();

  /**
   * Authoritative company entitlement status.
   * Can be queried by BillingGate to check if cloud instance is unlocked.
   */
  router.get('/entitlement', async (_req: Request, res: Response) => {
    try {
      const entitlement = await billingService.getEntitlement();
      res.json(entitlement);
    } catch (err: any) {
      console.error('Failed to get entitlement:', err);
      res.status(500).json({ error: 'Failed to retrieve entitlement status' });
    }
  });

  /**
   * Initializes a Paystack checkout transaction for authenticated staff.
   */
  router.post('/initialize', requireAuthenticatedUser, async (req: any, res: Response) => {
    try {
      const { planId } = req.body;
      if (!planId) {
        res.status(400).json({ error: 'Missing required planId' });
        return;
      }

      // Extract user info from req.user set by requireAuthenticatedUser or lookup
      const token = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
      const supabaseUrl = process.env.VITE_SUPABASE_URL;
      const anonKey = process.env.VITE_SUPABASE_ANON_KEY;

      if (!supabaseUrl || !anonKey) {
        res.status(503).json({ error: 'Supabase configuration missing' });
        return;
      }

      const { createClient } = await import('@supabase/supabase-js');
      const client = createClient(supabaseUrl, anonKey);
      const { data: { user }, error: authErr } = await client.auth.getUser(token);

      if (authErr || !user || !user.email) {
        res.status(401).json({ error: 'Unable to authenticate staff caller for checkout' });
        return;
      }

      const result = await billingService.initializeCheckout({
        planId: planId as PlanId,
        userEmail: user.email,
        userId: user.id,
      });

      res.json(result);
    } catch (err: any) {
      console.error('Billing initialization error:', err);
      res.status(400).json({ error: err.message || 'Failed to initialize checkout' });
    }
  });

  /**
   * Server-side transaction verification and authoritative atomic grant.
   * Called by the callback page or manual verification trigger.
   */
  router.get('/verify/:reference', async (req: Request, res: Response) => {
    try {
      const { reference } = req.params;
      if (!reference) {
        res.status(400).json({ error: 'Missing transaction reference' });
        return;
      }

      const result = await billingService.verifyAndApplyGrant(reference);
      if (!result.success) {
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
    }

    if (!rawBody || rawBody.length === 0) {
      res.status(400).json({ error: 'Missing or empty request body' });
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

    // Acknowledge receipt to Paystack
    if (event === 'charge.success' && reference) {
      try {
        const grantResult = await billingService.verifyAndApplyGrant(reference);
        res.status(200).json({ received: true, grant: grantResult });
        return;
      } catch (grantErr: any) {
        console.error('Webhook grant processing error for ref:', reference, grantErr);
        // Paystack recommends returning 200 once signature is valid to prevent endless retries,
        // but log clearly for manual reconciliation.
        res.status(200).json({ received: true, error: grantErr.message });
        return;
      }
    }

    res.status(200).json({ received: true, ignoredEvent: event });
  };
}
