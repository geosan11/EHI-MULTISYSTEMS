import express from 'express';
import axios from 'axios';

const router = express.Router();

const TERMII_API_KEY = process.env.TERMII_API_KEY;

export async function sendSMS(to: string, message: string): Promise<boolean> {
  try {
    let phone = to.replace(/\D/g, '');
    if (phone.startsWith('0')) phone = '234' + phone.slice(1);
    if (!phone.startsWith('234')) phone = '234' + phone;

    await axios.post('https://api.ng.termii.com/api/sms/send', {
      to: phone,
      from: 'EHI-Cargo',
      sms: message,
      type: 'plain',
      api_key: TERMII_API_KEY,
      channel: 'generic',
    });
    return true;
  } catch {
    console.error('SMS failed — continuing without SMS');
    return false;
  }
}

router.post('/shipment-created', async (req, res) => {
  const { phone, waybillId, route, bags, amount } = req.body;
  const message = `EHI Multisystems: Your waybill ${waybillId} has been created. ${bags} to ${route}. Amount: ₦${amount.toLocaleString()}. Track: ehi-multisystems.vercel.app/track/${waybillId}`;
  sendSMS(phone, message);
  res.json({ success: true });
});

router.post('/shipment-arrived', async (req, res) => {
  const { phone, waybillId, hub } = req.body;
  const message = `EHI Multisystems: Your shipment ${waybillId} has arrived at ${hub}. Please present your waybill for collection.`;
  sendSMS(phone, message);
  res.json({ success: true });
});

router.post('/eod', async (req, res) => {
  const { phone, date, cargoRevenue, vjRevenue, marketingRevenue, airRevenue } = req.body;
  const total = cargoRevenue + vjRevenue + marketingRevenue + airRevenue;
  const message = `EHI EOD ${date}: Cargo ₦${cargoRevenue.toLocaleString()} | VJ ₦${vjRevenue.toLocaleString()} | Mkt ₦${marketingRevenue.toLocaleString()} | Air ₦${airRevenue.toLocaleString()} | TOTAL ₦${total.toLocaleString()}`;
  sendSMS(phone, message);
  res.json({ success: true });
});

export default router;
