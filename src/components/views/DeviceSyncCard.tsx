import { useEffect, useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Laptop,
  AlertTriangle,
  CheckCircle2,
  Clock,
  RefreshCw,
  AlertCircle,
  ShieldAlert,
  HardDrive,
  User as UserIcon,
  MapPin,
  HelpCircle,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import {
  evaluateDeviceStatus,
  type DeviceSyncStatusRow,
  type DeviceEvaluation,
  type DeviceHealthStatus,
} from '../../lib/deviceSync';

interface DeviceSyncCardProps {
  onRefreshTrigger?: () => void;
}

// Helper to format relative time
function formatRelativeTime(isoString: string | null): string {
  if (!isoString) return 'Never';
  const time = new Date(isoString).getTime();
  if (isNaN(time)) return 'Invalid date';

  const diffMs = Date.now() - time;
  if (diffMs < 0) return 'Just now';

  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;

  const diffDays = Math.floor(diffHour / 24);
  return `${diffDays}d ago`;
}

// Helper to format date in Lagos time (Africa/Lagos)
function formatLagosDateTime(isoString: string | null): string {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString('en-NG', {
      timeZone: 'Africa/Lagos',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return '—';
  }
}

export const DeviceSyncCard = ({ onRefreshTrigger }: DeviceSyncCardProps) => {
  const [devices, setDevices] = useState<DeviceSyncStatusRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDeviceStatuses = useCallback(async () => {
    try {
      // One server-side call: hub/staff names are resolved in the RPC so auditors
      // don't depend on RLS access to user_profiles/hubs.
      const { data: deviceRows, error: devErr } = await supabase.rpc('list_device_sync_status');
      if (devErr) throw devErr;

      const resolved = ((deviceRows || []) as any[]).map((dev) => ({
        ...dev,
        staff_name: dev.staff_name || dev.staff_email || undefined,
      })) as DeviceSyncStatusRow[];

      setDevices(resolved);
      setError(null);
    } catch (err: any) {
      console.warn('Failed to fetch device sync statuses:', err);
      setError(err.message || 'Unable to load device sync statuses');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchDeviceStatuses();

    // Realtime listener for status changes
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase
      .channel('device_sync_status_channel')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'device_sync_status' },
        () => {
          // Debounce bursts of realtime events into a single refetch
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => fetchDeviceStatuses(), 2000);
        }
      )
      .subscribe();

    // Periodic refresh every 30s to update relative times & status transitions
    const interval = setInterval(() => {
      fetchDeviceStatuses();
    }, 30_000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, [fetchDeviceStatuses]);

  const handleManualRefresh = async () => {
    setRefreshing(true);
    await fetchDeviceStatuses();
    if (onRefreshTrigger) onRefreshTrigger();
  };

  // Evaluated statuses for each device
  const evaluatedDevices = useMemo(() => {
    const now = new Date();
    return devices.map((d) => ({
      device: d,
      evaluation: evaluateDeviceStatus(d, now),
    }));
  }, [devices]);

  // Aggregate metrics
  const summaryMetrics = useMemo(() => {
    let redCount = 0;
    let amberCount = 0;
    let greenCount = 0;
    let totalQuarantined = 0;
    let totalPending = 0;

    for (const { device, evaluation } of evaluatedDevices) {
      if (evaluation.status === 'red') redCount++;
      else if (evaluation.status === 'amber') amberCount++;
      else greenCount++;

      totalQuarantined += device.quarantined_count || 0;
      totalPending += device.pending_total || 0;
    }

    return {
      total: evaluatedDevices.length,
      redCount,
      amberCount,
      greenCount,
      totalQuarantined,
      totalPending,
    };
  }, [evaluatedDevices]);

  return (
    <div
      style={{
        background: 'var(--color-surface-card)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        padding: 16,
        boxShadow: 'var(--shadow-card)',
      }}
      className="shrink-0 flex flex-col gap-4 overflow-hidden"
    >
      {/* Header & Metrics */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--color-border)] pb-3">
        <div className="flex items-center gap-2.5">
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(251,191,36,0.12)',
              border: '1px solid rgba(251,191,36,0.25)',
              color: 'var(--color-accent-amber)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Laptop size={17} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-[13px] font-sans font-bold text-[var(--color-foreground)]">
                Device Sync
              </h3>
              <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-[var(--color-surface-3)] text-[var(--color-muted)]">
                {summaryMetrics.total} {summaryMetrics.total === 1 ? 'counter device' : 'counter devices'}
              </span>
            </div>
            <p className="text-[11px] text-[var(--color-muted)] font-sans">
              Real-time sync visibility & offline queues across counter terminals
            </p>
          </div>
        </div>

        {/* Action & Metric Pills */}
        <div className="flex items-center gap-2 flex-wrap">
          {summaryMetrics.redCount > 0 && (
            <span
              className="px-2 py-0.5 rounded text-[10px] font-mono font-bold flex items-center gap-1"
              style={{
                background: 'rgba(239,68,68,0.15)',
                color: 'var(--color-error)',
                border: '1px solid rgba(239,68,68,0.3)',
              }}
            >
              <AlertCircle size={11} />
              {summaryMetrics.redCount} Attention
            </span>
          )}

          {summaryMetrics.amberCount > 0 && (
            <span
              className="px-2 py-0.5 rounded text-[10px] font-mono font-bold flex items-center gap-1"
              style={{
                background: 'rgba(251,191,36,0.15)',
                color: 'var(--color-accent-amber)',
                border: '1px solid rgba(251,191,36,0.3)',
              }}
            >
              <Clock size={11} />
              {summaryMetrics.amberCount} Pending Sync
            </span>
          )}

          {/* Quarantined Records shown separately */}
          {summaryMetrics.totalQuarantined > 0 && (
            <span
              className="px-2 py-0.5 rounded text-[10px] font-mono font-bold flex items-center gap-1"
              style={{
                background: 'rgba(244,63,94,0.15)',
                color: '#fb7185',
                border: '1px solid rgba(244,63,94,0.35)',
              }}
              title="Quarantined records held locally due to permanent schema/validation error"
            >
              <ShieldAlert size={11} />
              {summaryMetrics.totalQuarantined} Quarantined
            </span>
          )}

          <button
            onClick={handleManualRefresh}
            disabled={refreshing}
            className="p-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-hover)] text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors cursor-pointer disabled:opacity-50"
            title="Refresh device sync status"
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Content Area */}
      {loading ? (
        <div className="py-8 flex flex-col items-center justify-center gap-2 text-[var(--color-muted)] text-[12px] font-sans">
          <RefreshCw size={16} className="animate-spin text-[var(--color-accent-amber)]" />
          <span>Checking device statuses...</span>
        </div>
      ) : error ? (
        <div className="p-4 rounded-lg bg-[rgba(239,68,68,0.08)] border border-[rgba(239,68,68,0.2)] text-[12px] text-[var(--color-error)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle size={15} />
            <span>{error}</span>
          </div>
          <button
            onClick={handleManualRefresh}
            className="text-[11px] font-bold underline cursor-pointer"
          >
            Retry
          </button>
        </div>
      ) : evaluatedDevices.length === 0 ? (
        <div className="py-8 text-center bg-[var(--color-surface-2)] rounded-lg border border-dashed border-[var(--color-border)] flex flex-col items-center justify-center p-4">
          <HardDrive size={28} className="text-[var(--color-muted)] mb-2 opacity-50" />
          <p className="text-[13px] font-semibold text-[var(--color-foreground)]">
            No Counter Devices Reported
          </p>
          <p className="text-[11px] text-[var(--color-muted)] mt-0.5">
            Counter devices report their sync status on app open, reconnect, and after each sync attempt.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto -mx-4 sm:mx-0">
          <div className="min-w-[620px] px-4 sm:px-0">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-[10px] font-mono uppercase text-[var(--color-muted)] tracking-wider">
                  <th className="py-2 px-2 font-semibold">Status</th>
                  <th className="py-2 px-2 font-semibold">Device</th>
                  <th className="py-2 px-2 font-semibold">Hub & Staff</th>
                  <th className="py-2 px-2 font-semibold">Last Seen</th>
                  <th className="py-2 px-2 font-semibold">Pending</th>
                  <th className="py-2 px-2 font-semibold">Quarantined</th>
                  <th className="py-2 px-2 font-semibold">Oldest Pending</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {evaluatedDevices.map(({ device, evaluation }) => {
                  const isRed = evaluation.status === 'red';
                  const isAmber = evaluation.status === 'amber';
                  const isGreen = evaluation.status === 'green';

                  const statusColor = isRed
                    ? 'var(--color-error)'
                    : isAmber
                    ? 'var(--color-accent-amber)'
                    : 'var(--color-success)';

                  const statusBg = isRed
                    ? 'rgba(239,68,68,0.12)'
                    : isAmber
                    ? 'rgba(251,191,36,0.12)'
                    : 'rgba(16,185,129,0.12)';

                  const statusLabel = isRed
                    ? 'Stale / Delayed'
                    : isAmber
                    ? 'Pending Sync'
                    : 'In Sync';

                  return (
                    <tr
                      key={device.device_id}
                      className="hover:bg-[var(--color-surface-hover)] transition-colors text-[12px] font-sans"
                    >
                      {/* Health Status */}
                      <td className="py-3 px-2 whitespace-nowrap">
                        <div
                          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono font-bold"
                          style={{
                            background: statusBg,
                            color: statusColor,
                            border: `1px solid ${statusColor}33`,
                          }}
                          title={evaluation.reasons.join('\n')}
                        >
                          <div
                            className={`w-1.5 h-1.5 rounded-full ${isRed ? 'animate-pulse' : ''}`}
                            style={{ background: statusColor }}
                          />
                          {statusLabel}
                        </div>
                        {evaluation.reasons.length > 0 && !isGreen && (
                          <div
                            className="text-[9px] font-mono text-[var(--color-muted)] mt-1 max-w-[170px] truncate"
                            title={evaluation.reasons.join(' · ')}
                          >
                            {evaluation.reasons[0]}
                          </div>
                        )}
                      </td>

                      {/* Device ID */}
                      <td className="py-3 px-2">
                        <div
                          className="font-mono text-[11px] font-semibold text-[var(--color-foreground)] cursor-help"
                          title={`Device ID: ${device.device_id}`}
                        >
                          {device.device_id.length > 14
                            ? `${device.device_id.slice(0, 10)}...${device.device_id.slice(-4)}`
                            : device.device_id}
                        </div>
                        <div className="text-[10px] font-mono text-[var(--color-muted)] mt-0.5">
                          Synced: {formatRelativeTime(device.last_successful_sync_at)}
                        </div>
                      </td>

                      {/* Hub & Staff */}
                      <td className="py-3 px-2">
                        <div className="flex items-center gap-1 text-[var(--color-foreground)] font-semibold text-[11px]">
                          <MapPin size={11} className="text-[var(--color-accent-amber)] shrink-0" />
                          <span>{device.hub_name || device.hub_code || 'Unknown Hub'}</span>
                        </div>
                        <div className="flex items-center gap-1 text-[10px] text-[var(--color-muted)] mt-0.5 truncate max-w-[140px]">
                          <UserIcon size={10} className="shrink-0" />
                          <span title={device.staff_email || device.staff_name || ''}>
                            {device.staff_name || 'Counter Staff'}
                          </span>
                        </div>
                      </td>

                      {/* Last Seen */}
                      <td className="py-3 px-2 whitespace-nowrap">
                        <div
                          className="font-mono text-[11px]"
                          style={{ color: isRed && evaluation.reasons.some(r => r.includes('business hours')) ? 'var(--color-error)' : 'var(--color-foreground)' }}
                        >
                          {formatRelativeTime(device.last_seen_at)}
                        </div>
                        <div className="text-[9px] font-mono text-[var(--color-muted)] mt-0.5">
                          {formatLagosDateTime(device.last_seen_at)}
                        </div>
                      </td>

                      {/* Pending Records */}
                      <td className="py-3 px-2 whitespace-nowrap">
                        {device.pending_total > 0 ? (
                          <div>
                            <span
                              className="font-mono font-bold text-[11px] px-1.5 py-0.5 rounded"
                              style={{
                                background: 'rgba(251,191,36,0.15)',
                                color: 'var(--color-accent-amber)',
                              }}
                            >
                              {device.pending_total} pending
                            </span>

                            {/* Table Breakdown */}
                            {device.pending_by_table &&
                              Object.keys(device.pending_by_table).length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {Object.entries(device.pending_by_table).map(([tbl, count]) => (
                                    <span
                                      key={tbl}
                                      className="text-[9px] font-mono px-1 py-0.2 rounded bg-[var(--color-surface-3)] text-[var(--color-muted)]"
                                      title={`${count} in ${tbl}`}
                                    >
                                      {tbl.replace('_entries', '')}: {count}
                                    </span>
                                  ))}
                                </div>
                              )}
                          </div>
                        ) : (
                          <span className="font-mono text-[11px] text-[var(--color-muted)] flex items-center gap-1">
                            <CheckCircle2 size={12} className="text-[var(--color-success)]" />
                            0
                          </span>
                        )}
                      </td>

                      {/* Quarantined Records Shown Separately */}
                      <td className="py-3 px-2 whitespace-nowrap">
                        {device.quarantined_count > 0 ? (
                          <span
                            className="font-mono font-bold text-[11px] px-1.5 py-0.5 rounded flex items-center gap-1 w-fit"
                            style={{
                              background: 'rgba(244,63,94,0.15)',
                              color: '#fb7185',
                              border: '1px solid rgba(244,63,94,0.3)',
                            }}
                            title="Quarantined records held on device due to non-retryable error (synced=2)"
                          >
                            <ShieldAlert size={11} />
                            {device.quarantined_count}
                          </span>
                        ) : (
                          <span className="font-mono text-[11px] text-[var(--color-muted)]">
                            0
                          </span>
                        )}
                      </td>

                      {/* Oldest Pending */}
                      <td className="py-3 px-2 whitespace-nowrap">
                        {device.oldest_pending_at ? (
                          <div>
                            <span
                              className="font-mono text-[11px]"
                              style={{
                                color:
                                  isRed && evaluation.reasons.some((r) => r.includes('>4h limit'))
                                    ? 'var(--color-error)'
                                    : 'var(--color-muted)',
                                fontWeight:
                                  isRed && evaluation.reasons.some((r) => r.includes('>4h limit'))
                                    ? 'bold'
                                    : 'normal',
                              }}
                            >
                              {formatRelativeTime(device.oldest_pending_at)}
                            </span>
                            <div className="text-[9px] font-mono text-[var(--color-muted)] mt-0.5">
                              {formatLagosDateTime(device.oldest_pending_at)}
                            </div>
                          </div>
                        ) : (
                          <span className="font-mono text-[11px] text-[var(--color-muted)]">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
