const fs = require('fs');

let content = fs.readFileSync('src/components/views/Settings.tsx', 'utf8');

// 1. Add DATABASE to tabs
content = content.replace(
  "(['CONNECTION','PAYMENTS','NOTIFICATIONS','COMPANY'] as const)",
  "(['CONNECTION','PAYMENTS','NOTIFICATIONS','COMPANY','DATABASE'] as const)"
);

// 2. Add handleMigrateOrphans function right before handleAddHub (around line 235)
const handleMigrateOrphans = `
  const [migrating, setMigrating] = useState(false);
  const handleMigrateOrphans = async () => {
    if (!window.confirm("WARNING: This will assign ALL historical transactions with NO hub to 'Lagos'. Are you sure?")) return;
    setMigrating(true);
    
    // Cargo Entries
    const { error: e1 } = await supabase.from('cargo_entries').update({ hub_id: 'LOS/Lagos' }).is('hub_id', null);
    // Pending Corporate Intakes
    const { error: e2 } = await supabase.from('pending_corporate_intakes').update({ hub_id: 'LOS/Lagos' }).is('hub_id', null);
    // Package Desk
    const { error: e3 } = await supabase.from('package_desk').update({ hub_id: 'LOS/Lagos' }).is('hub_id', null);
    // Marketing
    const { error: e4 } = await supabase.from('marketing_shipments').update({ hub_id: 'LOS/Lagos' }).is('hub_id', null);
    // Excess Baggage
    const { error: e5 } = await supabase.from('excess_baggage').update({ hub_id: 'LOS/Lagos' }).is('hub_id', null);
    
    if (e1 || e2 || e3 || e4 || e5) {
      showToast({ message: 'Migration completed with some errors.', type: 'error' });
    } else {
      showToast({ message: 'Success! All orphan transactions migrated to Lagos.', type: 'success' });
    }
    setMigrating(false);
  };
`;

content = content.replace("const [newHubName, setNewHubName] = useState('');", handleMigrateOrphans + "\n  const [newHubName, setNewHubName] = useState('');");

// 3. Add DATABASE tab content
const databaseTab = `
            {/* DATABASE TAB */}
            {configTab === 'DATABASE' && (
              <div className="space-y-4">
                <div className="p-4 rounded border border-red-500 bg-red-500/10">
                  <h4 className="text-[12px] font-bold text-red-500 mb-2 uppercase">Fix Historical Data Visibility</h4>
                  <p className="text-[11px] text-[var(--color-muted)] mb-4">
                    Before Hub Isolation was introduced, some transactions were recorded without a specific Hub ID. 
                    This causes them to be invisible to agents (e.g. Lagos agents) and missing from Sales Analysis.
                    Click below to safely assign all past orphan transactions to "Lagos".
                  </p>
                  <button
                    onClick={handleMigrateOrphans}
                    disabled={migrating}
                    className="w-full py-2.5 bg-red-500 hover:bg-red-600 text-white text-[12px] font-bold rounded flex justify-center items-center gap-2 cursor-pointer transition-colors"
                  >
                    {migrating ? 'MIGRATING...' : 'MIGRATE ORPHAN TRANSACTIONS TO LAGOS'}
                  </button>
                </div>
              </div>
            )}
`;

content = content.replace("{/* COMPANY TAB */}", databaseTab + "\n            {/* COMPANY TAB */}");

fs.writeFileSync('src/components/views/Settings.tsx', content);
console.log('Patched Settings.tsx');
