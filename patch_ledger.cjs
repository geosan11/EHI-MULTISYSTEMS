const fs = require('fs');

let content = fs.readFileSync('src/components/views/TransactionLedger.tsx', 'utf8');

// 1. Add 'Office Work' to the type filters dropdown
content = content.replace(
  '<option value="Expense">Expense</option>',
  '<option value="Expense">Expense</option>\n                    <option value="Office Work">Office Work</option>'
);

// 2. Update the filtering logic
const oldFilter = `if (typeFilter !== "All" && e.type !== typeFilter.toLowerCase())
      return false;`;

const newFilter = `if (typeFilter !== "All") {
      if (typeFilter === "Office Work") {
        if (e.raw?.clientType !== 'Office Work') return false;
      } else if (e.type !== typeFilter.toLowerCase()) {
        return false;
      }
    }`;

content = content.replace(oldFilter, newFilter);

fs.writeFileSync('src/components/views/TransactionLedger.tsx', content);
console.log('Ledger patched');
