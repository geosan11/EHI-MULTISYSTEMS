import { useState, useEffect } from 'react';
import { ArrowLeft, Shield, Download, Search, Loader } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { User } from '../../lib/types';
import { EmptyState } from './EmptyState';

interface AuditLogEntry {
  id: string;
  userId: string;
  userName: string;
  action: string;
  tableName: string;
  recordId: string;
  timestamp: string;
  description: string;
  hub: string;
  oldValues?: string;
  newValues?: string;
}

export const AuditLog = ({ onBack, user }: { onBack: () => void; user?: User }) => {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<AuditLogEntry | null>(null);
  const [filterAction, setFilterAction] = useState('all');
  const [searchText, setSearchText] = useState('');

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('audit_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);

      if (data && !error) {
        setLogs(data.map((r: any) => ({
          id: r.id,
          userId: r.user_id || '',
          userName: r.user_name,
          action: r.action,
          tableName: r.table_name || '',
          recordId: r.record_id || '',
          timestamp: new Date(r.created_at).toLocaleString('en-NG'),
          description: r.description,
          hub: r.hub || '',
          oldValues: r.old_values ? JSON.stringify(r.old_values, null, 2) : undefined,
          newValues: r.new_values ? JSON.stringify(r.new_values, null, 2) : undefined,
        })));
      }
    } catch (err) {
      console.error('Failed to fetch audit log:', err);
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const retryFetch = () => {
    setFetchError(false);
    fetchLogs();
  };

  const filtered = logs.filter(log => {
    const matchesAction = filterAction === 'all' || log.action === filterAction;
    const matchesSearch = log.userName.toLowerCase().includes(searchText.toLowerCase()) ||
                          log.description.toLowerCase().includes(searchText.toLowerCase()) ||
                          log.recordId.toLowerCase().includes(searchText.toLowerCase());
    return matchesAction && matchesSearch;
  });

  const handleExportCSV = () => {
    if (filtered.length === 0) return;
    const headers = ['Timestamp', 'User', 'Hub', 'Action', 'Table', 'Record ID', 'Description'];
    const rows = filtered.map(l => [
      `"${l.timestamp}"`, `"${l.userName}"`, `"${l.hub}"`,
      `"${l.action}"`, `"${l.tableName}"`, `"${l.recordId}"`, `"${l.description}"`
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ehi_audit_log_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const actionColor = (action: string) => {
    switch (action) {
      case 'CREATE': return 'text-[var(--color-success)] bg-[rgba(16,185,129,0.1)]';
      case 'UPDATE': return 'text-[var(--color-accent-cobalt)] bg-[rgba(59,130,246,0.1)]';
      case 'DELETE': return 'text-[var(--color-error)] bg-[rgba(239,68,68,0.1)]';
      case 'LOGIN': return 'text-[var(--color-accent-amber)] bg-[rgba(245,158,11,0.1)]';
      case 'EOD_LOCK': return 'text-purple-400 bg-[rgba(168,85,247,0.1)]';
      default: return 'text-[var(--color-muted)] bg-[var(--color-surface-2)]';
    }
  };

  return (
    <div className="flex flex-col min-h-full bg-[var(--color-obsidian)]">
      <div className="ehi-page-body px-4 pt-4 text-[var(--color-foreground)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-2 mb-4">
        <button onClick={onBack} className="flex items-center space-x-1 text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors">
          <ArrowLeft size={16} /><span className="text-[11px] font-mono">Back</span>
        </button>
        <span className="text-[10px] font-mono text-purple-400 tracking-widest font-bold">● AUDIT TRAIL</span>
      </div>

      <div className="flex justify-between items-center mb-4">
        <div>
          <h2 className="text-[14px] font-bold">Platform Audit Log</h2>
          <p className="text-[10px] font-mono text-[var(--color-muted)]">{filtered.length} entries</p>
        </div>
        <button onClick={handleExportCSV} disabled={filtered.length === 0} className="flex items-center gap-1.5 bg-[var(--color-surface-card)] border border-[var(--color-border)] text-[11px] font-mono px-3 py-1.5 rounded hover:border-[var(--color-success)] transition-colors disabled:opacity-40">
          <Download size={12} /> Export CSV
        </button>
      </div>

      <div className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)]" />
          <input type="text" value={searchText} onChange={e => setSearchText(e.target.value)} placeholder="Search by user, action, record..." className="w-full pl-8 ehi-input text-[12px]" />
        </div>
        <select value={filterAction} onChange={e => setFilterAction(e.target.value)} className="ehi-input text-[12px]">
          <option value="all">All Actions</option>
          <option value="LOGIN">Login</option>
          <option value="CREATE">Create</option>
          <option value="UPDATE">Update</option>
          <option value="DELETE">Delete</option>
          <option value="EOD_LOCK">EOD Lock</option>
          <option value="SETTINGS_CHANGE">Settings</option>
          <option value="PAYMENT_CONFIRM">Payment</option>
        </select>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Loader size={24} className="animate-spin text-[var(--color-accent-amber)]" />
          <p className="text-[12px] font-mono text-[var(--color-muted)]">Loading audit trail...</p>
        </div>
      ) : fetchError ? (
        <EmptyState
          icon={<Shield size={36} strokeWidth={1.5} />}
          title="Couldn't load the audit trail"
          subtext="Check your connection and try again."
          actions={[{ label: 'Retry', onClick: retryFetch }]}
        />
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 border-2 border-dashed border-[var(--color-border)] rounded-xl">
          <Shield size={32} className="opacity-20" />
          <p className="text-[12px] font-mono text-[var(--color-muted)]">No audit entries found</p>
          <p className="text-[10px] font-mono text-[var(--color-muted)] opacity-60">Actions like logins, cargo entries, and EOD locks will appear here</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(log => (
            <div key={log.id} onClick={() => setSelectedEntry(log)} className="p-3 ehi-card cursor-pointer hover:border-[rgba(255,255,255,0.15)] transition-colors">
              <div className="flex justify-between items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className={`text-[8px] font-bold uppercase px-2 py-0.5 rounded font-mono ${actionColor(log.action)}`}>{log.action}</span>
                    <span className="text-[9px] font-mono text-[var(--color-muted)] truncate">{log.userName}</span>
                    {log.hub && <span className="text-[9px] font-mono text-[var(--color-muted)] opacity-60">· {log.hub}</span>}
                  </div>
                  <p className="text-[12px] text-[var(--color-foreground)] leading-snug">{log.description}</p>
                </div>
                <span className="text-[9px] font-mono text-[var(--color-muted)] shrink-0 text-right">{log.timestamp}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedEntry && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="ehi-card max-w-sm w-full">
            <div className="p-4 border-b border-[var(--color-border)] flex justify-between items-center">
              <span className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded font-mono ${actionColor(selectedEntry.action)}`}>{selectedEntry.action}</span>
              <button onClick={() => setSelectedEntry(null)} aria-label="Close" className="text-[var(--color-muted)] font-mono">✕</button>
            </div>
            <div className="p-4 space-y-3 text-[12px]">
              <div className="grid grid-cols-2 gap-2">
                <div><p className="ehi-label">User</p><p className="font-medium">{selectedEntry.userName}</p></div>
                <div><p className="ehi-label">Hub</p><p className="font-medium">{selectedEntry.hub || '—'}</p></div>
                <div><p className="ehi-label">Table</p><p className="font-mono text-[11px]">{selectedEntry.tableName || '—'}</p></div>
                <div><p className="ehi-label">Record</p><p className="font-mono text-[11px]">{selectedEntry.recordId || '—'}</p></div>
              </div>
              <div><p className="ehi-label">Description</p><p className="text-[var(--color-muted)]">{selectedEntry.description}</p></div>
              <div><p className="ehi-label">Timestamp</p><p className="font-mono text-[11px]">{selectedEntry.timestamp}</p></div>
              {selectedEntry.newValues && (
                <div><p className="ehi-label">Changes</p><pre className="text-[9px] bg-[var(--color-surface-2)] p-2 rounded overflow-auto max-h-24 text-[var(--color-muted)]">{selectedEntry.newValues}</pre></div>
              )}
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
};
