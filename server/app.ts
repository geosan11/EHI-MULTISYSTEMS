import 'dotenv/config';
import express from 'express';
import crypto from 'crypto';
import * as Sentry from '@sentry/node';
import paystackRoutes from './paystack.js';
import notificationRoutes from './notifications.js';
import eodRoutes from './eod.js';
import geminiRoutes from './gemini.js';
import qzRoutes from './qz.js';
import { parseBankAlert } from './emailParser.js';

// Same DSN as the client (VITE_SENTRY_DSN reads fine server-side too --
// the VITE_ prefix only controls client bundling, same pattern already
// used for VITE_SUPABASE_URL elsewhere in this file). Skipped entirely
// if unset. No tracesSampleRate -- error capture only, deliberately,
// same reasoning as the client-side init in main.tsx.
if (process.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.VITE_SENTRY_DSN,
    environment: process.env.NODE_ENV || 'production',
  });
}

// Distributed rate limiter — see supabase/migrations/20260702_rate_limiting.sql
// for why this replaced the old in-memory Map version: on Vercel, concurrent
// serverless invocations each get their own process memory, so an in-memory
// counter doesn't actually enforce a shared limit. This checks a shared table
// instead via a single atomic INSERT ... ON CONFLICT DO UPDATE (see the
// migration for why that replaced an earlier FOR UPDATE draft). Costs a
// network round trip per check (~120ms, Supabase is EU West) — only wire
// this onto low-frequency, deliberate actions, not hot-path UI calls.
const rateLimiter = (name: string, maxReqs: number, windowMs: number) => {
  return async (req: any, res: any, next: any) => {
    try {
      const supabaseUrl = process.env.VITE_SUPABASE_URL;
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!supabaseUrl || !serviceKey) {
        // Not configured — fail open, same philosophy as before.
        return next();
      }

      const { createClient } = await import('@supabase/supabase-js');
      const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

      const ip = req.ip || 'unknown';
      const key = `${name}:${ip}`;

      const { data: allowed, error } = await admin.rpc('check_rate_limit', {
        p_key: key,
        p_max: maxReqs,
        p_window_ms: windowMs,
      });

      if (error) {
        // Fail open — a broken rate limiter should never block a legitimate request
        console.error('Rate limiter check failed (failing open):', error);
        return next();
      }

      if (allowed === false) {
        return res.status(429).json({ error: 'Too many requests' });
      }

      next();
    } catch (err) {
      // Fail open — a broken rate limiter should never block a legitimate request
      console.error('Rate limiter error (failing open):', err);
      next();
    }
  };
};

// Cryptographically random temp password for bulk-created accounts — CSV
// input should never carry plaintext passwords, so one is generated per
// row instead. Mixed character classes, 12 chars: comfortably clears any
// reasonable password policy without producing something unreadable when
// an admin has to relay it to a new hire over WhatsApp/SMS.
function generateTempPassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O — easy to misread when relayed by phone
  const lower = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789'; // no 0/1 — same reasoning
  const all = upper + lower + digits;
  const pick = (set: string) => set[crypto.randomInt(set.length)];
  const chars = [pick(upper), pick(lower), pick(digits)];
  for (let i = chars.length; i < 12; i++) chars.push(pick(all));
  // Shuffle so the fixed-class characters aren't always in the same position
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

async function requireAdminCaller(req: any, res: any): Promise<{ admin: any; supabaseUrl: string; serviceKey: string; callerRole: string; callerId: string } | null> {
  try {
    const token = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
    if (!token) { res.status(401).json({ error: 'Unauthorized' }); return null; }

    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      res.status(503).json({ error: 'Service key or Supabase URL not configured on server' });
      return null;
    }

    const { createClient } = await import('@supabase/supabase-js');
    const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: { user }, error } = await admin.auth.getUser(token);

    if (error || !user) { res.status(401).json({ error: 'Invalid token: ' + (error?.message || 'no user') }); return null; }

    const { data: profile, error: profileErr } = await admin.from('user_profiles').select('role').eq('id', user.id).single();
    if (profileErr) { res.status(500).json({ error: 'Failed to load caller profile: ' + profileErr.message }); return null; }
    if (!profile || !['super_admin', 'admin'].includes(profile.role)) {
      res.status(403).json({ error: 'Forbidden' }); return null;
    }
    return { admin, supabaseUrl, serviceKey, callerRole: profile.role, callerId: user.id };
  } catch (err: any) {
    console.error('requireAdminCaller error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Auth check failed: ' + (err?.message || 'unknown error') });
    }
    return null;
  }
}

export async function requireAuthenticatedUser(req: any, res: any, next: any) {
  try {
    const token = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
    if (!token) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) { res.status(503).json({ error: 'Supabase not configured on server' }); return; }

    const { createClient } = await import('@supabase/supabase-js');
    const client = createClient(supabaseUrl, anonKey);
    const { data: { user }, error } = await client.auth.getUser(token);
    if (error || !user) { res.status(401).json({ error: 'Invalid session' }); return; }

    next();
  } catch (err: any) {
    console.error('requireAuthenticatedUser error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Auth check failed' });
  }
}

// Inbound email webhooks can't carry a user JWT -- they authenticate with
// a static shared secret instead. Configure INBOUND_WEBHOOK_SECRET in
// Vercel and paste the same value into the email provider's webhook URL
// as ?secret=... (or an X-Webhook-Secret header). Requests without a
// matching secret are rejected before any parsing happens. If the env
// var is unset the endpoint is DISABLED (503), never open.
function requireWebhookSecret(req: any, res: any): boolean {
  const configured = process.env.INBOUND_WEBHOOK_SECRET;
  if (!configured) {
    res.status(503).json({ error: 'Inbound webhook not configured on server' });
    return false;
  }
  const supplied = (req.query?.secret as string) || req.headers['x-webhook-secret'];
  if (supplied !== configured) {
    res.status(401).json({ error: 'Invalid webhook secret' });
    return false;
  }
  return true;
}

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);

  app.use(express.json({ limit: '2mb' }));

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
  });

  const notifyLimiter = rateLimiter('notify', 30, 60_000);
  const adminLimiter = rateLimiter('admin', 10, 60_000);

  app.get('/api/config', (req, res) => {
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
    if (supabaseUrl && supabaseAnonKey) {
      res.json({ configured: true, supabaseUrl, supabaseAnonKey });
    } else {
      res.json({ configured: false });
    }
  });

  app.use('/api/paystack', paystackRoutes);
  app.use('/api/notify', notifyLimiter, requireAuthenticatedUser, notificationRoutes);
  app.use('/api/eod', requireAuthenticatedUser, eodRoutes);
  app.use('/api/gemini', notifyLimiter, requireAuthenticatedUser, geminiRoutes);
  app.use('/api/qz', requireAuthenticatedUser, qzRoutes);

  app.post('/api/admin/create-staff', adminLimiter, async (req, res) => {
    const adminCtx = await requireAdminCaller(req, res);
    if (!adminCtx) return;
    const { adminClient } = { adminClient: adminCtx.admin };

    const { name, email, password, role, hub_id, hub_type, phone, assigned_airline } = req.body;
    if (!name || !email || !password || !role || !hub_id) {
      return res.status(400).json({ error: 'Missing required fields: name, email, password, role, hub_id' });
    }

    if (adminCtx.callerRole === 'admin' && role === 'super_admin') {
      return res.status(403).json({ error: 'Admins cannot create super_admin accounts.' });
    }

    try {
      const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name, role, hub_type, hub_id }
      });

      if (authError || !authData.user) {
        return res.status(400).json({ error: authError?.message || 'Failed to create auth user' });
      }

      const { error: profileError } = await adminClient
        .from('user_profiles')
        .upsert({ id: authData.user.id, email: email, name, role, hub_id, hub_type: hub_type || 'Cargo Station', phone: phone || null, assigned_airline: assigned_airline || null, active: true });

      if (profileError) {
        console.error('Profile creation failed, rolling back auth user:', profileError.message);
        // Without this, a failed profile insert leaves a Supabase Auth user
        // with NO row in user_profiles -- that person can never log in
        // ("Account exists but profile not set up"), the admin was told
        // this succeeded, and there was no way to clean it up short of the
        // Supabase dashboard. Delete the orphan immediately instead of
        // leaving it behind.
        try {
          await adminClient.auth.admin.deleteUser(authData.user.id);
        } catch (cleanupErr: any) {
          console.error(`Failed to roll back orphaned auth user ${authData.user.id}:`, cleanupErr?.message || cleanupErr);
          return res.status(500).json({
            error: `Profile creation failed AND automatic cleanup failed. An orphaned auth account (${email}) may exist -- remove it manually in the Supabase dashboard before retrying. Original error: ${profileError.message}`,
          });
        }
        return res.status(400).json({ error: `Failed to set up staff profile: ${profileError.message}. No account was created.` });
      }

      return res.json({ id: authData.user.id, email: authData.user.email });
    } catch (err: any) {
      console.error('create-staff error:', err);
      return res.status(500).json({ error: err.message || 'Server error' });
    }
  });

  app.post('/api/admin/create-staff-bulk', adminLimiter, async (req, res) => {
    const adminCtx = await requireAdminCaller(req, res);
    if (!adminCtx) return;
    const { admin: adminClient } = adminCtx;

    const { staff } = req.body;
    if (!Array.isArray(staff) || staff.length === 0) {
      return res.status(400).json({ error: 'Missing or empty staff array' });
    }
    // Chunk cap, not a total-import cap — the client sends multiple requests
    // for a larger CSV. Keeps a single request comfortably inside a 60s
    // Vercel function timeout even in the worst case (~50 sequential
    // createUser + upsert pairs), rather than one giant request that risks
    // FUNCTION_INVOCATION_TIMEOUT partway through with no partial results.
    if (staff.length > 50) {
      return res.status(400).json({ error: 'Max 50 rows per request — the client should chunk larger files' });
    }

    const { data: hubs } = await adminClient.from('hubs').select('id, code').eq('active', true);
    const hubByCode = new Map((hubs || []).map((h: any) => [String(h.code).toUpperCase(), h.id]));

    // super_admin is deliberately not a selectable role here, same reasoning
    // as the update-staff fix: granting the top role should be a conscious
    // one-at-a-time action, never something a CSV typo can do to N rows at once.
    const VALID_ROLES = ['admin', 'cargo_agent', 'baggage_agent', 'marketing_agent', 'driver', 'accountant', 'auditor'];

    const results: Array<{ row: number; email: string; success: boolean; tempPassword?: string; error?: string }> = [];

    for (let i = 0; i < staff.length; i++) {
      const row = staff[i] || {};
      const rowNum = Number(row.row) || i + 1; // client passes original CSV row number for clean error reporting across chunks
      const name = String(row.name || '').trim();
      const email = String(row.email || '').trim().toLowerCase();
      const role = String(row.role || '').trim();
      const hubCode = String(row.hub_code || '').trim().toUpperCase();
      const phone = String(row.phone || '').trim();

      if (!name || !email || !role || !hubCode) {
        results.push({ row: rowNum, email, success: false, error: 'Missing required field (need name, email, role, hub_code)' });
        continue;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        results.push({ row: rowNum, email, success: false, error: 'Invalid email format' });
        continue;
      }
      if (!VALID_ROLES.includes(role)) {
        results.push({ row: rowNum, email, success: false, error: `Invalid role "${role}". Must be one of: ${VALID_ROLES.join(', ')}` });
        continue;
      }
      const hub_id = hubByCode.get(hubCode);
      if (!hub_id) {
        results.push({ row: rowNum, email, success: false, error: `Unknown or inactive hub code "${hubCode}"` });
        continue;
      }

      const tempPassword = generateTempPassword();

      try {
        const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
          email,
          password: tempPassword,
          email_confirm: true,
          user_metadata: { name, role, hub_id },
        });
        if (authError || !authData.user) {
          results.push({ row: rowNum, email, success: false, error: authError?.message || 'Failed to create auth user' });
          continue;
        }

        const { error: profileError } = await adminClient
          .from('user_profiles')
          .upsert({ id: authData.user.id, email, name, role, hub_id, hub_type: row.hub_type || 'Cargo Station', phone: phone || null, active: true });

        if (profileError) {
          results.push({ row: rowNum, email, success: false, error: `Auth account created but profile failed: ${profileError.message}` });
          continue;
        }

        results.push({ row: rowNum, email, success: true, tempPassword });
      } catch (err: any) {
        results.push({ row: rowNum, email, success: false, error: err.message || 'Unexpected error' });
      }
    }

    const successCount = results.filter(r => r.success).length;
    return res.json({ results, successCount, failureCount: results.length - successCount });
  });

  app.post('/api/admin/set-staff-active', adminLimiter, async (req, res) => {
    const adminCtx = await requireAdminCaller(req, res);
    if (!adminCtx) return;
    const { admin: adminClient } = adminCtx;

    const { userId, active } = req.body;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });

    try {
      const { error } = await adminClient.from('user_profiles').update({ active }).eq('id', userId);
      if (error) return res.status(400).json({ error: error.message });

      if (!active) {
        await adminClient.auth.admin.updateUserById(userId, { ban_duration: '876600h' });
      } else {
        await adminClient.auth.admin.updateUserById(userId, { ban_duration: 'none' });
      }
      return res.json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/update-staff', adminLimiter, async (req, res) => {
    const adminCtx = await requireAdminCaller(req, res);
    if (!adminCtx) return;
    const { admin: adminClient } = adminCtx;

    const { userId, updates } = req.body;
    if (!userId || !updates) return res.status(400).json({ error: 'Missing userId or updates' });

    // Only an existing super_admin may grant super_admin to someone else.
    // Without this check, any admin (the next tier down, which already has
    // Staff Management access) could self-escalate or promote an arbitrary
    // account to super_admin via this generic update path.
    if (updates.role === 'super_admin' && adminCtx.callerRole !== 'super_admin') {
      return res.status(403).json({ error: 'Only a super_admin can grant the super_admin role.' });
    }

    // view_overrides is the "master control" lever for per-staff view
    // access -- an admin (who already has Staff Management access) must
    // not be able to grant themselves or anyone else extra views, or
    // strip another admin's, via this generic update path.
    if ('view_overrides' in updates && adminCtx.callerRole !== 'super_admin') {
      return res.status(403).json({ error: 'Only a super_admin can edit view access.' });
    }

    if ('can_edit_remarks' in updates && adminCtx.callerRole !== 'super_admin') {
      return res.status(403).json({ error: 'Only a super_admin can edit remarks editing permission.' });
    }

    try {
      const { error } = await adminClient.from('user_profiles').update(updates).eq('id', userId);
      if (error) return res.status(400).json({ error: error.message });
      return res.json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // Deliberately errors so this flows through the real catch-all error
  // handler below (the same path any actual forwarded server error takes)
  // rather than calling Sentry.captureException directly, which would only
  // prove the SDK loaded — not that the pipeline that matters actually
  // works. Explicit next(err), not a bare throw: Express 4 (unlike 5) does
  // not auto-forward a rejected async handler to error middleware, so a
  // bare throw here would just hang the request instead of testing
  // anything. A 500 response is the expected, correct outcome of calling
  // this, not a bug.
  app.post('/api/admin/test-sentry', adminLimiter, async (req, res, next) => {
    const adminCtx = await requireAdminCaller(req, res);
    if (!adminCtx) return;
    next(new Error('[TEST] Manual Sentry verification from IT Debug panel — safe to ignore, no action needed'));
  });

  app.post('/api/validate-payment/parse', notifyLimiter, requireAuthenticatedUser, (req, res) => {
    try {
      const { emailText } = req.body;
      if (!emailText) {
        return res.status(400).json({ error: 'Missing emailText' });
      }
      const parsed = parseBankAlert(emailText);
      res.json(parsed);
    } catch (e: any) {
      res.status(400).json({ error: e.message || 'Failed to parse bank alert' });
    }
  });

  app.post('/api/validate-payment/inbound', notifyLimiter, (req, res) => {
    if (!requireWebhookSecret(req, res)) return;
    try {
      const { TextBody, HtmlBody } = req.body;
      const emailText = TextBody || (HtmlBody ? HtmlBody.replace(/<[^>]+>/g, '') : '');
      if (!emailText) {
        return res.status(400).json({ error: 'Missing email body' });
      }
      const parsed = parseBankAlert(emailText);
      res.json(parsed);
    } catch (e: any) {
      res.status(400).json({ error: e.message || 'Failed to parse inbound email' });
    }
  });

  // Catch-all for any /api/* path that didn't match a registered route above —
  // without this, an unmatched sub-path falls through to Express's default
  // 404 page (HTML, not JSON), which the client can't parse for a useful message.
  app.use('/api', (req, res) => {
    res.status(404).json({ error: `No API route matches ${req.method} ${req.originalUrl}` });
  });

  // Global error handler — MUST be registered last, and MUST have exactly
  // 4 parameters for Express to recognise it as an error handler. This is
  // the final safety net: any error thrown anywhere above that wasn't
  // caught by a route's own try/catch lands here instead of producing
  // Express's raw, non-JSON default error response.
  app.use((err: any, req: any, res: any, next: any) => {
    console.error('Unhandled API error:', err);
    Sentry.captureException(err);
    if (res.headersSent) return next(err);
    res.status(err.status || err.statusCode || 500).json({
      error: err.message || 'Unexpected server error',
    });
  });

  return app;
}
