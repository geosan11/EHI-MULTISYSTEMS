const fs = require('fs');

let content = fs.readFileSync('src/components/views/DebtorsTab.tsx', 'utf8');

// 1. Update state type
content = content.replace(
  "const [paymentMode, setPaymentMode] = useState<'Cash' | 'Transfer'>('Cash');",
  "const [paymentMode, setPaymentMode] = useState<'Cash' | 'Transfer' | 'POS'>('Cash');"
);

// 2. Add POS to dropdown
content = content.replace(
  '<option value="Cash">Cash</option>\n                                         <option value="Transfer">Transfer</option>',
  '<option value="Cash">Cash</option>\n                                         <option value="Transfer">Transfer</option>\n                                         <option value="POS">POS</option>'
);

fs.writeFileSync('src/components/views/DebtorsTab.tsx', content);
console.log('Debtors Tab patched');
