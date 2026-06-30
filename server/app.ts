import 'dotenv/config';
import express from 'express';
import paystackRoutes from './paystack';
import notificationRoutes from './notifications';
import eodRoutes from './eod';
import geminiRoutes from './gemini';
import { parseBankAlert } from './emailParser';

const rateLimiter = (maxReqs: number, windowMs: number) => {
  const store = new Map<string, { count: number; resetAt: number }>();
  return (req: any, res: any, next: any) => {
    const key = req.ip || 'unknown';
    const now = Date.now();
    const entry = store.get(key);
    if (!entry || now > entry.resetAt) {
      store.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (entry.count >= maxReqs) {
      return res.status(429).json({ error: 'Too many requests' });
    }
    entry.count++;
    next();
  };
};

async function requireAdminCaller(req: any, res: any): Promise<{ admin: any; supabaseUrl: string; serviceKey: string } | null> {
  const token = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
  if (!token) { res.status(401).json({ error: 'Unauthorized' }); return null; }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    res.status(503).json({ error: 'Service key or Supabase URL not configured on server' });
    return null;
  }

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: { user }, error } = await admin.auth.getUser(token);

    if (error || !user) { res.status(401).json({ error: 'Invalid token' }); return null; }

    const { data: profile } = await admin.from('user_profiles').select('role').eq('id', user.id).single();
    if (!profile || !['super_admin', 'admin'].includes(profile.role)) {
      res.status(403).json({ error: 'Forbidden' }); return null;
    }
    return { admin, supabaseUrl, serviceKey };
  } catch (err: any) {
    res.status(500).json({ error: 'Auth check failed: ' + err.message }); return null;
  }
}

export function createApp() {
  const app = express();

  app.use(express.json({ limit: '2mb' }));

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
  });

  const notifyLimiter = rateLimiter(30, 60_000);
  const adminLimiter = rateLimiter(10, 60_000);

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
  app.use('/api/notify', notifyLimiter, notificationRoutes);
  app.use('/api/eod', eodRoutes);
  app.use('/api/gemini', geminiRoutes);

  app.post('/api/admin/create-staff', adminLimiter, async (req, res) => {
    const adminCtx = await requireAdminCaller(req, res);
    if (!adminCtx) return;
    const { adminClient } = { adminClient: adminCtx.admin };

    const { name, email, password, role, hub_id, hub_type, phone } = req.body;
    if (!name || !email || !password || !role || !hub_id) {
      return res.status(400).json({ error: 'Missing required fields: name, email, password, role, hub_id' });
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
        .upsert({ id: authData.user.id, email: email, name, role, hub_id, hub_type: hub_type || 'Cargo Station', phone: phone || null, active: true });

      if (profileError) {
        console.error('Profile update failed:', profileError.message);
      }

      return res.json({ id: authData.user.id, email: authData.user.email });
    } catch (err: any) {
      console.error('create-staff error:', err);
      return res.status(500).json({ error: err.message || 'Server error' });
    }
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

  app.post('/api/validate-payment/parse', (req, res) => {
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

  app.post('/api/validate-payment/inbound', (req, res) => {
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

  return app;
}
