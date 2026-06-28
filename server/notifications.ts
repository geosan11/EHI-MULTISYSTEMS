import { Router } from 'express';
import axios from 'axios';

const router = Router();

// ── SHARED TERMII SENDER ──────────────────────────────────────
async function sendTermii(phone: string, message: string, channel: 'whatsapp' | 'generic' = 'whatsapp') {
  const apiKey = process.env.TERMII_API_KEY;
  if (!apiKey) {
    console.log(`[DEMO ${channel.toUpperCase()}] → ${phone}\n${message}`);
    return { ok: true, demo: true };
  }
  const res = await axios.post(
    'https://api.ng.termii.com/api/sms/send',
    { to: phone, from: 'EHI Logistics', sms: message, type: 'unicode', channel, api_key: apiKey },
    { headers: { 'Content-Type': 'application/json' }, timeout: 8000 }
  );
  return { ok: true, termii: res.data };
}

// Try WhatsApp first, fall back to SMS if WhatsApp fails
async function sendWithFallback(phone: string, message: string): Promise<{ ok: boolean; channel: string }> {
  try {
    await sendTermii(phone, message, 'whatsapp');
    return { ok: true, channel: 'whatsapp' };
  } catch {
    try {
      await sendTermii(phone, message, 'generic');
      return { ok: true, channel: 'sms' };
    } catch (err: any) {
      console.error('Both WhatsApp and SMS failed:', err?.response?.data || err.message);
      return { ok: false, channel: 'none' };
    }
  }
}

// POST /api/notify/whatsapp
router.post('/whatsapp', async (req, res) => {
  const { phone, message, ref } = req.body;
  if (!phone || !message) return res.status(400).json({ error: 'phone and message required' });
  try {
    const result = await sendWithFallback(phone, message);
    return res.json({ ok: result.ok, channel: result.channel, ref });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/notify/pickup-pin
router.post('/pickup-pin', async (req, res) => {
  const { senderPhone, consigneePhone, pin, entryRef, route } = req.body;
  if (!pin || !entryRef) return res.status(400).json({ error: 'pin and entryRef required' });

  const message = `✈️ EHI Multisystems Nigeria\n\nYour cargo *${entryRef}* to *${route || 'destination'}* has been booked.\n\n🔐 PICKUP PIN: *${pin}*\n\nShare this PIN with the consignee. They must present it at the destination hub to collect the cargo.`;

  // Fire and forget — run in background
  Promise.all([
    senderPhone ? sendWithFallback(senderPhone, message) : Promise.resolve(),
    consigneePhone ? sendWithFallback(consigneePhone, message) : Promise.resolve(),
  ]).catch(() => {});

  return res.json({ ok: true });
});

// POST /api/notify/scan-status
// Called by Scanner after ARRIVE, DEPART, or DELIVER scan
router.post('/scan-status', async (req, res) => {
  const { event, cargoRef, consigneeName, consigneePhone, senderPhone, hubName, pin } = req.body;
  if (!event || !cargoRef) return res.status(400).json({ error: 'event and cargoRef required' });

  let consigneeMsg = '';
  let senderMsg    = '';

  if (event === 'ARRIVE') {
    consigneeMsg =
      `✅ EHI Multisystems Nigeria\n\n` +
      `Your cargo *${cargoRef}* has arrived at *${hubName}*.\n\n` +
      (pin ? `🔐 PICKUP PIN: *${pin}*\n\nPlease visit the hub with this PIN to collect your cargo.` : `Please visit the hub to collect your cargo.`);
    senderMsg =
      `✅ EHI Multisystems Nigeria\n\n` +
      `Cargo *${cargoRef}* addressed to *${consigneeName}* has arrived at *${hubName}*.`;
  } else if (event === 'DELIVER') {
    consigneeMsg =
      `🎉 EHI Multisystems Nigeria\n\n` +
      `Cargo *${cargoRef}* has been successfully delivered to *${consigneeName}*.\n\nThank you for choosing EHI Multisystems.`;
    senderMsg =
      `🎉 EHI Multisystems Nigeria\n\n` +
      `Your cargo *${cargoRef}* has been delivered to *${consigneeName}* at *${hubName}*.`;
  } else if (event === 'DEPART') {
    senderMsg =
      `✈️ EHI Multisystems Nigeria\n\n` +
      `Cargo *${cargoRef}* has departed from *${hubName}* and is now in transit.`;
  }

  // Fire and forget
  const sends: Promise<any>[] = [];
  if (consigneeMsg && consigneePhone) sends.push(sendWithFallback(consigneePhone, consigneeMsg));
  if (senderMsg && senderPhone)       sends.push(sendWithFallback(senderPhone, senderMsg));
  Promise.all(sends).catch(() => {});

  return res.json({ ok: true, event, sent: sends.length });
});

// POST /api/notify/eod-summary
// Sends EOD revenue summary to manager phone
router.post('/eod-summary', async (req, res) => {
  const { managerPhone, hubName, date, cargoTotal, vjTotal, mktTotal, grossTotal, cashTotal, transferTotal, posTotal, debtTotal, lockedBy } = req.body;
  if (!managerPhone || !hubName) return res.status(400).json({ error: 'managerPhone and hubName required' });

  const fmt = (n: number) => `NGN ${Number(n || 0).toLocaleString('en-NG')}`;

  const message =
    `📊 *EHI Multisystems — EOD Report*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `Hub: *${hubName}*\n` +
    `Date: *${date}*\n` +
    `Locked by: ${lockedBy}\n\n` +
    `📦 Cargo Revenue:    ${fmt(cargoTotal)}\n` +
    `✈️ ValueJet Revenue: ${fmt(vjTotal)}\n` +
    `🛍️ Marketing Revenue: ${fmt(mktTotal)}\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `💰 *GROSS TOTAL: ${fmt(grossTotal)}*\n\n` +
    `💵 Cash:     ${fmt(cashTotal)}\n` +
    `🏦 Transfer: ${fmt(transferTotal)}\n` +
    `💳 POS:      ${fmt(posTotal)}\n` +
    `📋 Debt:     ${fmt(debtTotal)}\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `_EHI Multisystems Nigeria Ltd_`;

  try {
    const result = await sendWithFallback(managerPhone, message);
    return res.json({ ok: result.ok, channel: result.channel });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
