const fs = require('fs');

// 1. types.ts
let typesContent = fs.readFileSync('src/lib/types.ts', 'utf8');
if (!typesContent.includes('editedBy?: string;')) {
  typesContent = typesContent.replace(
    'enteredByName?: string;',
    'enteredByName?: string;\n  editedBy?: string;\n  debtClearedBy?: string;'
  );
  fs.writeFileSync('src/lib/types.ts', typesContent);
}

// 2. TransactionLedger.tsx
let ledgerContent = fs.readFileSync('src/components/views/TransactionLedger.tsx', 'utf8');

if (!ledgerContent.includes('finalTx.editedBy = user.name;')) {
  ledgerContent = ledgerContent.replace(
    'const finalTx: Transaction = { ...editingTx, pieces, kg, amount };',
    'const finalTx: Transaction = { ...editingTx, pieces, kg, amount };\n    finalTx.editedBy = user.name;'
  );
}

// Display audit log
const auditJSX = `
                            {/* Audit Log */}
                            <div className="pt-2 border-t border-[var(--color-border)] mt-2">
                              <div className="text-[10px] font-mono text-[var(--color-muted)] flex items-center gap-4">
                                {d.raw?.enteredByName && <span>Entered By: <span className="text-[var(--color-foreground)]">{d.raw.enteredByName}</span></span>}
                                {d.raw?.editedBy && <span>Edited By: <span className="text-[var(--color-accent-amber)]">{d.raw.editedBy}</span></span>}
                                {d.raw?.debtClearedBy && <span>Debt Cleared By: <span className="text-[var(--color-success)]">{d.raw.debtClearedBy}</span></span>}
                              </div>
                            </div>
`;

if (!ledgerContent.includes('Audit Log')) {
  ledgerContent = ledgerContent.replace(
    '{canEditRemarks && (',
    `${auditJSX}\n                            {canEditRemarks && (`
  );
}
fs.writeFileSync('src/components/views/TransactionLedger.tsx', ledgerContent);

// 3. EHIApp.tsx
let appContent = fs.readFileSync('src/components/EHIApp.tsx', 'utf8');
if (!appContent.includes('edited_by: tx.editedBy,')) {
  appContent = appContent.replace(
    'payment_history: tx.paymentHistory || null,',
    'payment_history: tx.paymentHistory || null,\n                edited_by: tx.editedBy || null,\n                debt_cleared_by: tx.debtClearedBy || null,'
  );
}
fs.writeFileSync('src/components/EHIApp.tsx', appContent);

// 4. DebtorsTab.tsx
let debtorsContent = fs.readFileSync('src/components/views/DebtorsTab.tsx', 'utf8');
if (!debtorsContent.includes('debtClearedBy: user?.name')) {
  debtorsContent = debtorsContent.replace(
    "mode: remaining <= 0 ? 'Debt Paid' : 'Debt'",
    "mode: remaining <= 0 ? 'Debt Paid' : 'Debt',\n        debtClearedBy: user?.name"
  );
}
fs.writeFileSync('src/components/views/DebtorsTab.tsx', debtorsContent);

console.log('Audit patched');
