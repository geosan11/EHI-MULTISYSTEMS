const fs = require('fs');
let content = fs.readFileSync('src/components/views/TransactionLedger.tsx', 'utf8');

// 1. Add import
if (!content.includes('PartialRetrievalModal')) {
  content = content.replace(
    'import { LiveCreditFeed } from "../LiveCreditFeed";',
    'import { LiveCreditFeed } from "../LiveCreditFeed";\nimport { PartialRetrievalModal } from "./PartialRetrievalModal";'
  );
}

// 2. Add state
if (!content.includes('retrievalModalEntry')) {
  content = content.replace(
    'const [viewingDetail, setViewingDetail] = useState<Entry | null>(null);',
    'const [viewingDetail, setViewingDetail] = useState<Entry | null>(null);\n  const [retrievalModalEntry, setRetrievalModalEntry] = useState<Entry | null>(null);'
  );
}

// 3. Replace handleMarkRetrievedAndDeposit body
const oldHandle = /const handleMarkRetrievedAndDeposit = async \(entry: Entry\) => {[\s\S]*?showToast\(\{ message: 'Failed to complete retrieval deposit: ' \+ err.message, type: 'error' \}\);\s*\n\s*}\s*\n\s*};/m;

const newHandle = `const handleMarkRetrievedAndDeposit = (entry: Entry) => {
    setRetrievalModalEntry(entry);
  };

  const executeRetrieval = async (data: { isPartial: boolean, refundAmount: number, retrievedPieces: number, retrievedKg: number }) => {
    if (!retrievalModalEntry) return;
    const entry = retrievalModalEntry;
    const customerName = entry.name;
    const amount = data.refundAmount;

    try {
      if (!data.isPartial) {
        // 1. Mark cargo retrieved in cargo_entries
        const { error: cargoErr } = await supabase
          .from('cargo_entries')
          .update({
            retrieved: true,
            retrieved_at: new Date().toISOString(),
            retrieved_by: user.name,
            retrieval_note: \`Retrieved goods refund ₦\${amount} credited to wallet\`,
            status: 'Retrieved',
          })
          .eq('entry_ref', entry.id);

        if (cargoErr) console.warn('Cargo update warning:', cargoErr);
      } else {
        // Log partial retrieval shadow transaction in cargo_entries
        const partialId = \`RET-\${Date.now()}-\${entry.id.slice(-6)}\`;
        const { error: cargoErr } = await supabase
          .from('cargo_entries')
          .insert({
            entry_ref: partialId,
            hub_id: user.hub_id,
            client_name: customerName,
            content_type: 'Partial Retrieval',
            pieces: data.retrievedPieces,
            kg: data.retrievedKg,
            amount: amount,
            mode: 'Wallet',
            status: 'Retrieved',
            retrieved: true,
            retrieved_at: new Date().toISOString(),
            retrieved_by: user.name,
            retrieval_note: \`Partial retrieval of \${data.retrievedPieces}pcs (\${data.retrievedKg}kg) from \${entry.id}\`,
            entered_by: user.id
          });
      }

      // 2. Find or create customer wallet
      const { data: existingWallets } = await supabase
        .from('customer_wallets')
        .select('*')
        .ilike('customer_name', customerName.trim());

      let wallet = existingWallets && existingWallets.length > 0 ? existingWallets[0] : null;
      let walletId = wallet?.id;
      let balBefore = wallet ? wallet.balance : 0;
      let balAfter = balBefore + amount;

      if (wallet) {
        await supabase.from('customer_wallets').update({
          balance: balAfter,
          total_topped_up: (wallet.total_topped_up || 0) + amount,
          updated_at: new Date().toISOString(),
        }).eq('id', wallet.id);
      } else {
        const { data: newW, error: insertErr } = await supabase.from('customer_wallets').insert({
          hub_id: user.hub_id,
          customer_name: customerName,
          opening_balance: amount,
          balance: amount,
          total_topped_up: amount,
          total_used: 0,
          source_type: 'airline_retrieval',
          source_ref: entry.id,
          source_note: \`Credit from \${data.isPartial ? 'partial ' : ''}retrieved cargo \${entry.id}\`,
          status: 'active',
          created_by: user.name,
        }).select('id').single();
        if (insertErr) throw insertErr;
        walletId = newW.id;
      }

      // 3. Log wallet transaction
      await supabase.from('wallet_transactions').insert({
        wallet_id: walletId,
        hub_id: user.hub_id,
        type: 'top_up',
        amount: amount,
        balance_before: balBefore,
        balance_after: balAfter,
        cargo_ref: entry.id,
        description: \`Airline \${data.isPartial ? 'partial ' : ''}retrieval refund for \${entry.id}\`,
        logged_by: user.name,
      });

      // 4. Update optimistic local transaction
      if (!data.isPartial) {
        const updatedTx = { ...entry.raw, retrieved: true, status: 'Retrieved' };
        onUpdateTx(updatedTx);
      } else {
        // Since we don't modify the original, we just show toast and maybe close details
      }
      showToast({ message: \`Successfully deposited ₦\${fmt(amount)} to \${customerName}'s wallet!\`, type: 'success' });
      setViewingDetail(null);
      setRetrievalModalEntry(null);
    } catch (err: any) {
      showToast({ message: 'Failed to complete retrieval deposit: ' + err.message, type: 'error' });
    }
  };`;

content = content.replace(oldHandle, newHandle);

// 4. Render modal at the end
const modalJSX = `{retrievalModalEntry && (
        <PartialRetrievalModal
          entry={retrievalModalEntry.raw}
          onClose={() => setRetrievalModalEntry(null)}
          onConfirm={executeRetrieval}
        />
      )}`;

if (!content.includes('<PartialRetrievalModal')) {
  content = content.replace(
    '{viewingQrTx && (',
    `${modalJSX}\n\n      {viewingQrTx && (`
  );
}

fs.writeFileSync('src/components/views/TransactionLedger.tsx', content);
console.log('Ledger Retrieval Patched');
