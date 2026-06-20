import express from 'express';
import axios from 'axios';

const router = express.Router();

router.post('/verify', async (req, res) => {
  try {
    const { reference } = req.body;
    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        },
      }
    );
    const txn = response.data.data;
    res.json({
      verified: txn.status === 'success',
      amount: txn.amount / 100,
      payer: txn.customer?.first_name + ' ' + txn.customer?.last_name,
    });
  } catch {
    res.status(400).json({ verified: false, amount: 0, payer: '' });
  }
});

export default router;
