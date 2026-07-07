import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { User } from '../../lib/types';
import { RefreshCw, Search, Printer, AlertTriangle, CheckCircle2 } from 'lucide-react';

interface PrintLog {
  id: string;
  cargo_ref: string;
  awb_tag_number: string;
  printed_by_name: string;
  hub_name: string;
  print_method: string;
  pieces_printed: number;
  created_at: string;
  departed?: boolean;
}

export default function TagPrintHistory({ user }: { user: User }) {
  const [logs, setLogs] = useState<PrintLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const isAdmin = ['super_admin', 'admin'].includes(user.role);

      // 1. Fetch the print logs, scoped to this hub for non-admins
      let q = supabase
        .from('tag_print_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);

      if (!isAdmin) {
        q = q.eq('hub_name', user.hub);
      }

      const { data, error } = await q;
      if (error) throw error;

      const printLogs: PrintLog[] = data || [];

      // 2. Extract unique cargo_refs to check tracking events
      const cargoRefs = [...new Set(printLogs.map(l => l.cargo_ref))];

      let departedRefs = new Set<string>();

      if (cargoRefs.length > 0) {
        const { data: events, error: eventError } = await supabase
          .from('tracking_events')
          .select('cargo_ref')
          .in('cargo_ref', cargoRefs)
          .eq('event_type', 'DEPART');

        if (!eventError && events) {
          events.forEach(e => departedRefs.add(e.cargo_ref));
        }
      }

      setLogs(printLogs.map(log => ({ ...log, departed: departedRefs.has(log.cargo_ref) })));
    } catch (err) {
      console.error('Error fetching print logs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [user.hub, user.role]);

  const filteredLogs = logs.filter(l =>
    l.awb_tag_number?.toLowerCase().includes(search.toLowerCase()) ||
    l.cargo_ref.toLowerCase().includes(search.toLowerCase()) ||
    l.printed_by_name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-sans font-bold text-[var(--color-foreground)] flex items-center gap-2">
            <Printer size={20} className="text-[var(--color-accent-amber)]" />
            Tag Print History
          </h2>
          <p className="text-sm font-sans text-[var(--color-muted)] mt-1">
            Monitor waybill and POS tag prints. Flags prints missing departure scans.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)]" />
            <input
              type="text"
              placeholder="Search Ref, AWB or Agent..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 pr-4 py-2 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md text-[13px] font-sans focus:outline-none focus:border-[var(--color-accent-amber)]"
            />
          </div>
          <button
            onClick={fetchLogs}
            className="p-2 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)] border border-[var(--color-border)] rounded-md transition-colors"
            title="Refresh logs"
          >
            <RefreshCw size={16} className={`text-[var(--color-foreground)] ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left border-collapse">
            <thead>
              <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)]">
                <th className="px-4 py-3 text-[12px] font-sans font-semibold text-[var(--color-muted)] uppercase tracking-wider">Date & Time</th>
                <th className="px-4 py-3 text-[12px] font-sans font-semibold text-[var(--color-muted)] uppercase tracking-wider">Method</th>
                <th className="px-4 py-3 text-[12px] font-sans font-semibold text-[var(--color-muted)] uppercase tracking-wider">Ref / AWB</th>
                <th className="px-4 py-3 text-[12px] font-sans font-semibold text-[var(--color-muted)] uppercase tracking-wider">Printed By</th>
                <th className="px-4 py-3 text-[12px] font-sans font-semibold text-[var(--color-muted)] uppercase tracking-wider">Hub</th>
                <th className="px-4 py-3 text-[12px] font-sans font-semibold text-[var(--color-muted)] uppercase tracking-wider">Pieces</th>
                <th className="px-4 py-3 text-[12px] font-sans font-semibold text-[var(--color-muted)] uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-[13px] font-sans text-[var(--color-muted)]">
                    Loading logs...
                  </td>
                </tr>
              ) : filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-[13px] font-sans text-[var(--color-muted)]">
                    No print logs found
                  </td>
                </tr>
              ) : (
                filteredLogs.map(log => (
                  <tr key={log.id} className="border-b border-[var(--color-border)] hover:bg-[var(--color-surface-2)] transition-colors">
                    <td className="px-4 py-3 text-[13px] font-mono text-[var(--color-foreground)]">
                      {new Date(log.created_at).toLocaleString('en-GB')}
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-1 bg-[var(--color-surface-3)] border border-[var(--color-border)] text-[11px] font-mono uppercase tracking-wider rounded text-[var(--color-foreground)]">
                        {log.print_method === 'pdf' ? 'PDF TAG' : 'POS 🖨️'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-mono text-[13px] text-[var(--color-foreground)]">{log.cargo_ref.slice(0, 8)}...</div>
                      <div className="font-mono text-[11px] text-[var(--color-muted)] mt-0.5">{log.awb_tag_number}</div>
                    </td>
                    <td className="px-4 py-3 text-[13px] font-sans text-[var(--color-foreground)]">
                      {log.printed_by_name}
                    </td>
                    <td className="px-4 py-3 text-[13px] font-sans text-[var(--color-muted)]">
                      {log.hub_name}
                    </td>
                    <td className="px-4 py-3 text-[13px] font-mono text-[var(--color-foreground)]">
                      {log.pieces_printed} PCS
                    </td>
                    <td className="px-4 py-3">
                      {log.departed ? (
                        <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-[rgba(16,185,129,0.1)] text-[var(--color-success)] text-[12px] font-sans font-medium rounded">
                          <CheckCircle2 size={14} /> Departed
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-[rgba(239,68,68,0.1)] text-[var(--color-error)] text-[12px] font-sans font-medium rounded" title="Printed but not yet departed. Potential fraud risk.">
                          <AlertTriangle size={14} /> Unscanned
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
