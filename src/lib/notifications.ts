/**
 * EHI Multisystems — WhatsApp Receipt Notifications via Termii
 * Live mode: calls POST /api/notify/whatsapp
 */
import { supabase } from './supabase';

export interface ReceiptNotificationPayload {
  phone: string;
  message: string;
  ref: string;
}

// Normalise Nigerian phone numbers to international format
function normalisePhone(phone: string): string {
  const cleaned = phone.replace(/\s+/g, '').replace(/-/g, '');
  if (cleaned.startsWith('+')) return cleaned;
  if (cleaned.startsWith('234')) return '+' + cleaned;
  if (cleaned.startsWith('0')) return '+234' + cleaned.slice(1);
  return '+234' + cleaned;
}

export async function sendReceiptWhatsApp(
  payload: ReceiptNotificationPayload
): Promise<{ ok: boolean; simulated?: boolean }> {
  const { phone, message, ref } = payload;
  const normalisedPhone = normalisePhone(phone);

  try {
    // /api/notify/* requires an authenticated caller (server/app.ts's
    // requireAuthenticatedUser) -- without this header every call here
    // 401s unconditionally, regardless of whether the session is actually
    // valid, silently dropping every WhatsApp receipt.
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token || '';
    const res = await fetch('/api/notify/whatsapp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ phone: normalisedPhone, message, ref }),
    });
    return { ok: res.ok };
  } catch {
    return { ok: false };
  }
}

// ── Message builders ─────────────────────────────────

export function buildCargoWhatsApp(data: {
  ref: string;
  consignee: string;
  awb: string;
  route: string;
  kg: string | number;
  pcs: string | number;
  amount: number;
  mode: string;
  bank?: string;
  paymentNarration?: string;
  pin?: string;
}): string {
  const payment = data.bank ? `${data.mode} (${data.bank})` : data.mode;
  let text = 
    `✈️ *EHI Multisystems Nigeria Ltd*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `*CARGO RECEIPT*\n` +
    `Ref: \`${data.ref}\`\n\n` +
    `📦 *Consignee:* ${data.consignee}\n` +
    `🏷️ *AWB/Tag:* ${data.awb}\n` +
    `🗺️ *Route:* ${data.route}\n` +
    `⚖️ *Weight:* ${data.kg} KG · ${data.pcs} pcs\n\n` +
    `💰 *Amount: NGN ${Number(data.amount).toLocaleString('en-NG')}*\n` +
    `💳 *Payment:* ${payment}\n`;
    
  if (data.mode === 'Transfer' && data.paymentNarration) {
    text += `📝 *Narration:* ${data.paymentNarration}\n`;
  }

  if (data.pin) {
    text += `━━━━━━━━━━━━━━━━━━━━\n`;
    text += `🔐 *PICKUP PIN:* ${data.pin}\n`;
    text += `_Please share this PIN with the consignee to collect the cargo._\n`;
  }

  text += 
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `Thank you for choosing EHI Multisystems.\n` +
    `_Powered by EHI Logistics Platform_`;

  return text;
}

export function buildExcessBaggageWhatsApp(airlineName: string, data: {
  ref: string;
  passenger: string;
  flight: string;
  totalPieces: number;
  totalKg: number;
  excessKg: number;
  amount: number;
  mode: string;
  paymentNarration?: string;
}, freeAllowanceKg: number, ratePerKg: number): string {
  let text =
    `✈️ *EHI Multisystems — ${airlineName}*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `*EXCESS BAGGAGE RECEIPT*\n` +
    `Ref: \`${data.ref}\`\n\n` +
    `👤 *Passenger:* ${data.passenger}\n` +
    `🛫 *Flight:* ${data.flight}\n\n` +
    `🎒 Total pieces: ${data.totalPieces || 1} pcs\n` +
    `⚖️ Total weight: ${data.totalKg} kg\n` +
    `🟢 Free allowance: ${freeAllowanceKg.toFixed(1)} kg\n` +
    `🔴 Excess charged: ${data.excessKg} kg × ₦${ratePerKg.toLocaleString('en-NG')}\n\n` +
    `💰 *Amount: NGN ${Number(data.amount).toLocaleString('en-NG')}*\n` +
    `💳 *Payment:* ${data.mode}\n`;

  if (data.mode === 'Transfer' && data.paymentNarration) {
    text += `📝 *Narration:* ${data.paymentNarration}\n`;
  }

  text +=
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `Thank you for flying ${airlineName}.\n` +
    `_EHI Multisystems Nigeria Ltd_`;

  return text;
}

export function buildMarketingWhatsApp(data: {
  ref: string;
  customer: string;
  route: string;
  bags: string;
  amount: number;
  mode: string;
  bank?: string;
  paymentNarration?: string;
}): string {
  const payment = data.bank ? `${data.mode} (${data.bank})` : data.mode;
  let text = 
    `📦 *EHI Multisystems Nigeria Ltd*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `*FIELD MARKETING RECEIPT*\n` +
    `Ref: \`${data.ref}\`\n\n` +
    `👤 *Customer:* ${data.customer}\n` +
    `🗺️ *Route:* ${data.route}\n` +
    `🛍️ *Bags:* ${data.bags}\n\n` +
    `💰 *Amount: NGN ${Number(data.amount).toLocaleString('en-NG')}*\n` +
    `💳 *Payment:* ${payment}\n`;

  if (data.mode === 'Transfer' && data.paymentNarration) {
    text += `📝 *Narration:* ${data.paymentNarration}\n`;
  }

  text +=
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `Thank you for your business.\n` +
    `_EHI Multisystems Nigeria Ltd_`;

  return text;
}

export function buildPackageWhatsApp(data: {
  ref: string;
  customer: string;
  destination: string;
  contentType: string;
  amount: number;
  mode: string;
  bank?: string;
  paymentNarration?: string;
}): string {
  const payment = data.bank ? `${data.mode} (${data.bank})` : data.mode;
  let text =
    `📦 *EHI Multisystems Nigeria Ltd*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `*PACKAGE / PARCEL RECEIPT*\n` +
    `Ref: \`${data.ref}\`\n\n` +
    `👤 *Customer:* ${data.customer}\n` +
    `📍 *Destination:* ${data.destination}\n` +
    `📦 *Type:* ${data.contentType}\n\n` +
    `💰 *Amount: NGN ${Number(data.amount).toLocaleString('en-NG')}*\n` +
    `💳 *Payment:* ${payment}\n`;

  if (data.mode === 'Transfer' && data.paymentNarration) {
    text += `📝 *Narration:* ${data.paymentNarration}\n`;
  }

  text +=
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `Thank you for your business.\n` +
    `_EHI Multisystems Nigeria Ltd_`;

  return text;
}
