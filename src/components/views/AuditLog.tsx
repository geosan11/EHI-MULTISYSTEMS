import { useState } from 'react';
import { ArrowLeft, Shield, Eye, ShieldCheck, Download, Search } from 'lucide-react';

interface AuditLogEntry {
  id: string;
  userId: string;
  userName: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'EOD_LOCK' | 'SETTINGS_CHANGE' | 'ROLE_CHANGE';
  tableName: string;
  recordId: string;
  timestamp: string;
  description: string;
  oldValues?: string;
  newValues?: string;
}

export const AuditLog = ({ 
  onBack 
}: { 
  onBack: () => void;
}) => {
  const [selectedEntry, setSelectedEntry] = useState<AuditLogEntry | null>(null);
  const [filterAction, setFilterAction] = useState<string>('all');
  const [searchText, setSearchText] = useState('');

  const [logs] = useState<AuditLogEntry[]>([
    { id: 'AL-901', userId: 'USR-010', userName: 'Auditor David Obi', action: 'EOD_LOCK', tableName: 'eod_ledgers', recordId: 'EOD-240619', timestamp: '2026-06-20 00:15:32', description: 'Locked and verified daily terminal sales close.', oldValues: '{"locked": false}', newValues: '{"locked": true, "audited_by": "USR-010"}' },
    { id: 'AL-902', userId: 'USR-001', userName: 'Super Admin Sanni', action: 'ROLE_CHANGE', tableName: 'user_profiles', recordId: 'USR-045', timestamp: '2026-06-19 21:04:15', description: 'Privilege elevation for security staff.', oldValues: '{"role": "cargo_agent"}', newValues: '{"role": "auditor"}' },
    { id: 'AL-903', userId: 'USR-001', userName: 'Super Admin Sanni', action: 'SETTINGS_CHANGE', tableName: 'pricing_matrix', recordId: 'PM-LAG-ABV', timestamp: '2026-06-19 18:32:01', description: 'Modified route base pricing for Big Bag Cargo category.', oldValues: '{"bb": 17000}', newValues: '{"bb": 18000}' },
    { id: 'AL-904', userId: 'USR-024', userName: 'Agent Folarin', action: 'CREATE', tableName: 'cargo_entries', recordId: 'CG-98443', timestamp: '2026-06-19 14:12:00', description: 'Logged new airway bill consignment for Madam Uchechi.', oldValues: 'null', newValues: '{"entry_ref": "CG-98443", "amount": 95000}' },
    { id: 'AL-905', userId: 'USR-115', userName: 'Agent Adamu', action: 'CREATE', tableName: 'shipments', recordId: 'MK-524', timestamp: '2026-06-19 11:45:00', description: 'Registered new Field Marketing Bag intake.', oldValues: 'null', newValues: '{"entry_ref": "MK-524", "amount": 25000}' }
  ]);

  const filteredLogs = logs.filter(log => {
    const matchesAction = filterAction === 'all' || log.action === filterAction;
    const matchesSearch = log.userName.toLowerCase().includes(searchText.toLowerCase()) || 
                          log.description.toLowerCase().includes(searchText.toLowerCase()) ||
                          log.id.toLowerCase().includes(searchText.toLowerCase());
    return matchesAction && matchesSearch;
  });

  const handleExportCSV = () => {
    alert('Enterprise system audit logs successfully formatted and exported as CSV statement.');
  };

  return (
    <div className="flex flex-col h-full bg-[var(--color-obsidian)] p-4 text-[var(--color-foreground)] overflow-y-auto pb-[80px] font-sans">
      {/* Header back navigation */}
      <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-2 mb-4">
        <button onClick={onBack} className="flex items-center space-x-1 text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors">
          <ArrowLeft size={16} />
          <span className="text-[11px] font-mono">Back</span>
        </button>
        <span className="text-[10px] font-mono text-purple-400 tracking-widest font-bold">● RECON ENTITY AUDITS</span>
      </div>

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div className="space-y-0.5">
          <div className="text-[9px] font-mono text-slate-400 tracking-[0.15em] uppercase">▸ COMPLIANCE & REVISION SYSTEMS</div>
          <h2 className="text-sm font-black text-[var(--color-foreground)]">Full Platform Revision Audit Trails</h2>
        </div>

        <button 
          onClick={handleExportCSV}
          className="bg-purple-900/40 hover:bg-purple-900/60 border border-purple-500/20 text-purple-300 font-mono text-[10px] uppercase font-bold px-3 py-1.5 rounded flex items-center space-x-1 cursor-pointer"
        >
          <Download size={12} />
          <span>Export CSV Statement</span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="ehi-card mb-6 grid grid-cols-1 md:grid-cols-12 gap-3">
        {/* Search Input */}
        <div className="relative md:col-span-8">
          <Search size={14} className="absolute left-3 top-2.5 text-slate-500" />
          <input 
            type="text"
            placeholder="Search by modifier, log description, or AWB ID..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="w-full bg-black/40 border border-[rgba(255,255,255,0.1)] rounded p-2 pl-9 text-xs focus:outline-none focus:border-purple-500 font-mono"
          />
        </div>

        {/* Action filter */}
        <div className="md:col-span-4">
          <select 
            value={filterAction}
            onChange={(e) => setFilterAction(e.target.value)}
            className="w-full bg-black/40 border border-[rgba(255,255,255,0.1)] rounded p-2 text-xs focus:outline-none focus:border-purple-500 font-mono"
          >
            <option value="all">ALL SECURITY ACTIONS</option>
            <option value="CREATE">CREATE (NEW RECORD)</option>
            <option value="UPDATE">UPDATE (EDITS)</option>
            <option value="SETTINGS_CHANGE">SETTINGS CHANGES</option>
            <option value="ROLE_CHANGE">ROLE ELEVATIONS</option>
            <option value="EOD_LOCK">EOD LOCKS</option>
          </select>
        </div>
      </div>

      {/* Audit Log Table list */}
      <div className="ehi-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="border-b border-[rgba(255,255,255,0.05)] text-slate-400 text-left bg-[rgba(255,255,255,0.01)]">
                <th className="py-3 px-4 font-bold uppercase tracking-wider">Log Timestamp</th>
                <th className="py-3 px-4 font-bold uppercase tracking-wider">Operator ID</th>
                <th className="py-3 px-4 font-bold uppercase tracking-wider">Modification</th>
                <th className="py-3 px-4 font-bold uppercase tracking-wider">Target Entity</th>
                <th className="py-3 px-4 font-bold uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[rgba(255,255,255,0.05)]">
              {filteredLogs.map((log) => (
                <tr key={log.id} className="hover:bg-black/10">
                  <td className="py-3 px-4 text-slate-400 whitespace-nowrap">{log.timestamp}</td>
                  <td className="py-3 px-4 font-semibold text-[var(--color-foreground)] whitespace-nowrap">{log.userName}</td>
                  <td className="py-3 px-4">
                    <span className="text-slate-300 block max-w-[250px] truncate">{log.description}</span>
                  </td>
                  <td className="py-3 px-4">
                    <span className={`px-1.5 py-0.5 rounded text-[9px] uppercase font-bold ${
                      log.action === 'CREATE' ? 'bg-emerald-500/10 text-[var(--color-success)]' :
                      log.action === 'EOD_LOCK' ? 'bg-blue-500/10 text-[var(--color-accent-cobalt)]' :
                      log.action === 'ROLE_CHANGE' || log.action === 'SETTINGS_CHANGE' ? 'bg-amber-500/10 text-[var(--color-accent-amber)]' : 'bg-neutral-800 text-slate-300'
                    }`}>
                      {log.action}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button 
                      onClick={() => setSelectedEntry(log)}
                      className="text-purple-400 hover:text-purple-300 font-mono text-[9.5px] uppercase font-bold p-1 cursor-pointer"
                    >
                      Inspect Diff
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Difference Audit Inspect Modal */}
      {selectedEntry && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 z-55">
          <div className="ehi-card max-w-lg w-full overflow-hidden shadow-2xl">
            <div className="p-4 border-b border-[rgba(255,255,255,0.07)] flex justify-between items-center bg-black/40">
              <span className="text-[9px] font-mono text-purple-400 uppercase font-bold tracking-wider">EHI SECURITY AUDIT LOG DIFFERENCE ANALYSIS</span>
              <button onClick={() => setSelectedEntry(null)} className="text-slate-400 hover:text-[var(--color-foreground)] font-mono text-xs cursor-pointer">✕</button>
            </div>

            <div className="p-5 space-y-4 font-mono text-xs">
              <div className="grid grid-cols-2 gap-4 text-[10px] pb-3 border-b border-solid border-[rgba(255,255,255,0.03)]">
                <div>
                  <span className="text-slate-500 uppercase block">Log Reference:</span>
                  <span className="text-[var(--color-foreground)] font-bold block">{selectedEntry.id}</span>
                </div>
                <div>
                  <span className="text-slate-500 uppercase block">Execution Date:</span>
                  <span className="text-[var(--color-foreground)] font-bold block">{selectedEntry.timestamp}</span>
                </div>
                <div>
                  <span className="text-slate-500 uppercase block">Modifier Account:</span>
                  <span className="text-[var(--color-foreground)] font-bold block">{selectedEntry.userName} ({selectedEntry.userId})</span>
                </div>
                <div>
                  <span className="text-slate-500 uppercase block">Target Ledger database table:</span>
                  <span className="text-purple-400 font-bold block bg-purple-500/10 px-1 py-0.5 rounded w-max mt-0.5">{selectedEntry.tableName}</span>
                </div>
              </div>

              {/* JSON DIff Comparer representation */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <span className="text-[8.5px] font-black text-rose-500/80 uppercase block">− Old Values Ledger</span>
                  <pre className="bg-rose-950/15 border border-rose-500/10 rounded-lg p-3 text-[10px] text-rose-300 leading-relaxed overflow-x-auto whitespace-pre-wrap max-h-[150px]">
                    {selectedEntry.oldValues}
                  </pre>
                </div>
                <div className="space-y-1">
                  <span className="text-[8.5px] font-black text-emerald-500/85 uppercase block">+ New Applied metrics</span>
                  <pre className="bg-emerald-950/15 border border-emerald-500/10 rounded-lg p-3 text-[10px] text-emerald-300 leading-relaxed overflow-x-auto whitespace-pre-wrap max-h-[150px]">
                    {selectedEntry.newValues}
                  </pre>
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <button 
                  onClick={() => setSelectedEntry(null)} 
                  className="bg-purple-900 border border-purple-500/30 text-[var(--color-foreground)] font-mono text-[10.5px] uppercase font-bold px-4 py-2 rounded-lg cursor-pointer"
                >
                  Close evaluation window
                </button>
              </div>

            </div>
          </div>
        </div>
      )}

    </div>
  );
};
