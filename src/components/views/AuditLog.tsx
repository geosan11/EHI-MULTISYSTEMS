import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Shield, Download, Search } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { User } from '../../lib/types';
import { EmptyState } from './EmptyState';
import { Button, PageHeader, Spinner } from '../ui';
import { sanitizeSpreadsheetAoA } from '../../lib/helpers';

interface AuditLogEntry {
  id: string;
  userId: string;
  userName: string;
  action: string;
  tableName: string;
  recordId: string;
  timestamp: string;
  timestampIso: string;
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

  const PAGE_SIZE = 200;
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('audit_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE);

      if (data && !error) {
        setLogs(data.map((r: any) => ({
          id: r.id,
          userId: r.user_id || '',
          userName: r.user_name,
          action: r.action,
          tableName: r.table_name || '',
          recordId: r.record_id || '',
          timestamp: new Date(r.created_at).toLocaleString('en-NG'),
          timestampIso: r.created_at,
          description: r.description,
          hub: r.hub || '',
          oldValues: r.old_values ? JSON.stringify(r.old_values, null, 2) : undefined,
          newValues: r.new_values ? JSON.stringify(r.new_values, null, 2) : undefined,
        })));
        setHasMore(data.length === PAGE_SIZE);
      }
    } catch (err) {
      console.error('Failed to fetch audit log:', err);
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  };

  // The log was hard-capped at 200 rows total with no way to see anything
  // older -- for any moderately active hub that's just a few hours of
  // activity, making "who did what" invisible beyond the very recent past.
  // Loads the next page strictly older than the oldest entry currently
  // shown, so this composes correctly regardless of how many pages have
  // already been loaded.
  const loadMore = async () => {
    if (logs.length === 0 || loadingMore) return;
    setLoadingMore(true);
    try {
      const oldestIso = logs[logs.length - 1]?.timestampIso;
      let query = supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(PAGE_SIZE);
      if (oldestIso) query = query.lt('created_at', oldestIso);
      const { data, error } = await query;
      if (data && !error) {
        setLogs(prev => [...prev, ...data.map((r: any) => ({
          id: r.id,
          userId: r.user_id || '',
          userName: r.user_name,
          action: r.action,
          tableName: r.table_name || '',
          recordId: r.record_id || '',
          timestamp: new Date(r.created_at).toLocaleString('en-NG'),
          timestampIso: r.created_at,
          description: r.description,
          hub: r.hub || '',
          oldValues: r.old_values ? JSON.stringify(r.old_values, null, 2) : undefined,
          newValues: r.new_values ? JSON.stringify(r.new_values, null, 2) : undefined,
        }))]);
        setHasMore(data.length === PAGE_SIZE);
      }
    } catch (err) {
      console.error('Failed to load more audit log entries:', err);
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  useEffect(() => {
    if (!selectedEntry) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelectedEntry(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedEntry]);

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

  const handleExportExcel = async () => {
    if (filtered.length === 0) return;
    const [XLSX, { autoFitWorksheetColumns }] = await Promise.all([
      import('xlsx'),
      import('../../lib/excelExport'),
    ]);
    const headers = ['Timestamp', 'User', 'Hub', 'Action', 'Table', 'Record ID', 'Description', 'Old Values', 'New Values'];
    const rows = filtered.map(l => [
      l.timestamp, l.userName, l.hub, l.action, l.tableName, l.recordId, l.description,
      l.oldValues || '', l.newValues || '',
    ]);
    // sanitizeSpreadsheetAoA (same helper the ledger's own exports use) guards
    // user_name/description/old-new values against being opened as a live
    // formula in Excel/Sheets -- these are all free text ultimately traceable
    // back to something someone typed.
    const ws = XLSX.utils.aoa_to_sheet(sanitizeSpreadsheetAoA([headers, ...rows]));
    autoFitWorksheetColumns(ws);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Audit Log');
    XLSX.writeFile(wb, `ehi_audit_log_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const actionColor = (action: string) => {
    switch (action) {
      case 'CREATE':
      case 'RETRIEVAL_APPROVE':
      case 'DEBT_COLLECTION': return 'text-[var(--color-success-fg)] bg-[var(--color-success-bg)]';
      case 'UPDATE': return 'text-[var(--color-info-fg)] bg-[var(--color-info-bg)]';
      case 'DELETE':
      case 'UNRETRIEVE': return 'text-[var(--color-error-fg)] bg-[var(--color-error-bg)]';
      case 'LOGIN':
      case 'RETRIEVAL': return 'text-[var(--color-amber-fg)] bg-[var(--color-amber-bg)]';
      case 'EOD_LOCK': return 'text-[var(--color-purple-fg)] bg-[var(--color-purple-bg)]';
      default: return 'text-[var(--color-muted)] bg-[var(--color-surface-2)]';
    }
  };

  return (
    <div className="flex flex-col min-h-full bg-[var(--color-canvas)]">
      <div className="ehi-page-body px-4 pt-4 text-[var(--color-foreground)]">
      <PageHeader
        title="Platform Audit Log"
        subtitle={`${filtered.length} entries`}
        onBack={onBack}
        sticky={false}
        actions={
          <Button variant="secondary" size="sm" iconLeft={Download} onClick={handleExportExcel} disabled={filtered.length === 0}>
            Export Excel
          </Button>
        }
      />

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
          <option value="RETRIEVAL">Retrieval</option>
          <option value="UNRETRIEVE">Unretrieve</option>
          <option value="RETRIEVAL_APPROVE">Retrieval Approved</option>
          <option value="DEBT_COLLECTION">Debt Collection</option>
        </select>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Spinner size="xl" />
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
            <div key={log.id} onClick={() => setSelectedEntry(log)} className="p-3 ehi-card cursor-pointer hover:border-[var(--color-border-strong)] transition-colors">
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
          {hasMore && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="w-full py-2.5 text-[11px] font-mono text-[var(--color-muted)] border border-dashed border-[var(--color-border)] rounded-lg hover:border-[var(--color-accent-amber)] hover:text-[var(--color-accent-amber)] transition-colors disabled:opacity-40"
            >
              {loadingMore ? 'Loading older entries...' : 'Load older entries'}
            </button>
          )}
        </div>
      )}

      {selectedEntry && createPortal(
        <div
          className="fixed inset-0 ehi-scrim flex items-center justify-center p-4 z-50"
          onClick={(e) => { if (e.target === e.currentTarget) setSelectedEntry(null); }}
        >
          <div className="ehi-card max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
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
              {selectedEntry.oldValues && (
                <div><p className="ehi-label">Before</p><pre className="text-[9px] bg-[var(--color-surface-2)] p-2 rounded overflow-auto max-h-24 text-[var(--color-muted)]">{selectedEntry.oldValues}</pre></div>
              )}
              {selectedEntry.newValues && (
                <div><p className="ehi-label">{selectedEntry.oldValues ? 'After' : 'Changes'}</p><pre className="text-[9px] bg-[var(--color-surface-2)] p-2 rounded overflow-auto max-h-24 text-[var(--color-muted)]">{selectedEntry.newValues}</pre></div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
      </div>
    </div>
  );
};
