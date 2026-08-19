import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { User } from '../../lib/types';
import { lagosBusinessDate } from '../../lib/helpers';
import { useToast } from '../../lib/ToastContext';
import { BackButton } from '../BackButton';
import { EmptyState } from './EmptyState';
import { Modal } from '../Modal';
import { StatusBadge, flightStatusMeta, FlightStatus } from '../ui/StatusBadge';
import { Radar, RefreshCw, Plane, Package2, Loader2 } from 'lucide-react';

interface BoardEntry { type: string; id: string; awb?: string; name?: string }
interface CachedStatus {
  status: string;
  scheduled_departure: string | null;
  actual_departure: string | null;
  scheduled_arrival: string | null;
  actual_arrival: string | null;
  delay_minutes: number | null;
  departure_airport: string | null;
  arrival_airport: string | null;
  diverted_airport: string | null;
  fetched_at?: string;
}
interface BoardFlight {
  flightNumber: string;
  airline: string | null;
  route: string | null;
  entries: BoardEntry[];
  status: CachedStatus | null;
}

// A diversion whose landing airport matches the departure airport is, in
// plain terms, "the flight turned back" -- exactly the "returned mid-way
// due to bad weather" scenario this feature exists for. AeroDataBox has no
// distinct status for that (it's still just "Diverted" with a diversion
// airport), so the relabeling happens here rather than in the server's
// normalizeStatus, which has no reason to know about display copy.
function effectiveStatus(s: CachedStatus | null | undefined): FlightStatus {
  if (!s) return 'unknown';
  if (s.status === 'diverted' && s.diverted_airport && s.departure_airport && s.diverted_airport === s.departure_airport) {
    return 'returned';
  }
  return (s.status as FlightStatus) || 'unknown';
}

const ATTENTION: FlightStatus[] = ['cancelled', 'returned', 'diverted', 'delayed'];
const ENROUTE: FlightStatus[] = ['departed', 'boarding'];

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' });
  } catch { return '—'; }
}

async function authedFetch(path: string, init?: RequestInit) {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token || '';
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
  return body;
}

const TIMELINE_STEPS: { key: FlightStatus; label: string }[] = [
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'boarding', label: 'Boarding' },
  { key: 'departed', label: 'Departed' },
  { key: 'landed', label: 'Landed' },
];
// Where each status sits on the linear Scheduled->Boarding->Departed->
// Landed timeline. Delayed sits at Boarding (still pre-departure);
// Diverted/Returned sit at Departed (the flight did leave, then turned
// back or went elsewhere); Cancelled sits at Scheduled (never departed).
// The banner above the timeline is what actually communicates the
// interrupted state -- this only decides how much of the bar to fill.
const STEP_ORDER: Record<string, number> = {
  scheduled: 0, delayed: 1, boarding: 1, departed: 2,
  diverted: 2, returned: 2, cancelled: 0, landed: 3,
};

function FlightTimeline({ status }: { status: FlightStatus }) {
  const interrupted = status === 'cancelled' || status === 'diverted' || status === 'returned' || status === 'delayed';
  const meta = flightStatusMeta(status);
  const stepIndex = STEP_ORDER[status];
  const known = status !== 'unknown';
  return (
    <div>
      {interrupted && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
          borderRadius: 10, background: meta.bg, color: meta.color,
          fontSize: 12, fontWeight: 600, marginBottom: 14,
        }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: meta.color }} />
          {meta.label}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {TIMELINE_STEPS.map((step, i) => {
          const isReached = known && i <= stepIndex;
          const isCurrent = known && i === stepIndex;
          const color = interrupted ? meta.color : 'var(--color-success)';
          return (
            <div key={step.key} style={{ display: 'flex', alignItems: 'center', flex: i < TIMELINE_STEPS.length - 1 ? 1 : 'none' }}>
              <div style={{
                width: 18, height: 18, borderRadius: '50%',
                background: isReached ? color : 'var(--color-border-strong)',
                border: isCurrent ? `2px solid ${color}` : 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                {isReached && !isCurrent && <span style={{ color: '#fff', fontSize: 8, fontWeight: 700 }}>✓</span>}
                {isCurrent && <div style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />}
              </div>
              {i < TIMELINE_STEPS.length - 1 && (
                <div style={{ flex: 1, height: 2, background: i < stepIndex ? color : 'var(--color-border-strong)' }} />
              )}
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
        {TIMELINE_STEPS.map((step, i) => (
          <div key={step.key} style={{
            fontSize: 9, textAlign: 'center', flex: 1,
            color: i === stepIndex ? (interrupted ? meta.color : 'var(--color-success)') : 'var(--color-muted)',
            fontWeight: i === stepIndex ? 600 : 400,
          }}>
            {step.label}
          </div>
        ))}
      </div>
    </div>
  );
}

function FlightCard({ flight, onOpen }: { flight: BoardFlight; onOpen: () => void }) {
  const es = effectiveStatus(flight.status);
  const meta = flightStatusMeta(es);
  return (
    <button
      onClick={onOpen}
      className="w-full text-left"
      style={{
        background: 'var(--color-surface-card)', border: '1px solid var(--color-border)',
        borderRadius: 12, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12,
      }}
    >
      <div style={{
        width: 36, height: 36, borderRadius: 10, background: meta.bg, color: meta.color,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <Plane size={17} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-foreground)', fontFamily: 'monospace' }}>
            {flight.flightNumber}
          </span>
          {flight.airline && (
            <span style={{ fontSize: 11, color: 'var(--color-muted)' }}>{flight.airline}</span>
          )}
        </div>
        <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 2, display: 'flex', gap: 8, alignItems: 'center' }}>
          {flight.route && <span>{flight.route}</span>}
          <span>· {flight.entries.length} shipment{flight.entries.length === 1 ? '' : 's'}</span>
          {flight.status?.delay_minutes ? <span style={{ color: 'var(--color-accent-amber)' }}>· +{flight.status.delay_minutes}m</span> : null}
        </div>
      </div>
      <StatusBadge status={es} size="sm" />
    </button>
  );
}

export const FlightRadar = ({ user, onBack }: { user: User; onBack: () => void }) => {
  const [date, setDate] = useState(lagosBusinessDate());
  const [flights, setFlights] = useState<BoardFlight[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<BoardFlight | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const { showToast } = useToast();

  const fetchBoard = useCallback(async () => {
    setLoading(true);
    try {
      const body = await authedFetch(`/api/flight-radar/board?date=${encodeURIComponent(date)}`);
      setFlights(body.flights || []);
    } catch (err: any) {
      showToast({ message: `Failed to load Flight Radar: ${err.message}`, type: 'error' });
    }
    setLoading(false);
  }, [date, showToast]);

  useEffect(() => { fetchBoard(); }, [fetchBoard]);

  const openFlight = async (flight: BoardFlight) => {
    setSelected(flight);
    setDetailLoading(true);
    try {
      const status = await authedFetch(`/api/flight-radar/status?flightNumber=${encodeURIComponent(flight.flightNumber)}&date=${encodeURIComponent(date)}`);
      setSelected(prev => prev && prev.flightNumber === flight.flightNumber ? { ...prev, status } : prev);
      setFlights(prev => prev.map(f => f.flightNumber === flight.flightNumber ? { ...f, status } : f));
    } catch (err: any) {
      showToast({ message: `Couldn't fetch live status: ${err.message}`, type: 'warning' });
    }
    setDetailLoading(false);
  };

  const refreshSelected = async () => {
    if (!selected) return;
    setRefreshing(true);
    try {
      const status = await authedFetch('/api/flight-radar/refresh', {
        method: 'POST',
        body: JSON.stringify({ flightNumber: selected.flightNumber, date }),
      });
      setSelected(prev => prev ? { ...prev, status } : prev);
      setFlights(prev => prev.map(f => f.flightNumber === selected.flightNumber ? { ...f, status } : f));
      showToast({ message: 'Flight status refreshed.', type: 'success' });
    } catch (err: any) {
      showToast({ message: `Refresh failed: ${err.message}`, type: 'error' });
    }
    setRefreshing(false);
  };

  const attention = flights.filter(f => ATTENTION.includes(effectiveStatus(f.status)));
  const enroute = flights.filter(f => ENROUTE.includes(effectiveStatus(f.status)));
  const scheduled = flights.filter(f => effectiveStatus(f.status) === 'scheduled' || effectiveStatus(f.status) === 'unknown');
  const landed = flights.filter(f => effectiveStatus(f.status) === 'landed');

  const groups: { title: string; items: BoardFlight[] }[] = [
    { title: 'Needs Attention', items: attention },
    { title: 'En Route', items: enroute },
    { title: 'Scheduled', items: scheduled },
    { title: 'Landed', items: landed },
  ];

  const selectedStatus = effectiveStatus(selected?.status);
  const selectedMeta = flightStatusMeta(selectedStatus);

  return (
    <div className="flex flex-col h-full bg-[var(--color-obsidian)] text-[var(--color-foreground)] overflow-hidden">
      <div className="ehi-view-header">
        <BackButton onClick={onBack} label="Back" />
        <span className="text-[10px] font-mono text-[var(--color-accent-amber)] tracking-widest font-bold">● FLIGHT RADAR</span>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="h-7 px-2 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded text-[11px] font-mono text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)]"
          />
          <button
            onClick={fetchBoard}
            className="h-7 w-7 flex items-center justify-center bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded text-[var(--color-muted)] hover:text-[var(--color-accent-amber)]"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="animate-spin" size={22} style={{ color: 'var(--color-accent-amber)' }} />
          </div>
        ) : flights.length === 0 ? (
          <EmptyState
            icon={<Radar size={36} strokeWidth={1.5} />}
            title="No flights tracked for this date"
            subtext="Add a flight number to a Cargo Entry to start tracking it here."
            actions={[{ label: '+ Cargo Entry', onClick: () => window.dispatchEvent(new CustomEvent('ehi-nav', { detail: 'Cargo' })) }]}
          />
        ) : (
          groups.filter(g => g.items.length > 0).map(g => (
            <div key={g.title}>
              <div className="text-[10px] font-mono text-[var(--color-muted)] uppercase tracking-widest mb-2">
                {g.title} <span className="opacity-60">({g.items.length})</span>
              </div>
              <div className="space-y-2">
                {g.items.map(f => (
                  <FlightCard key={f.flightNumber} flight={f} onOpen={() => openFlight(f)} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      <Modal isOpen={!!selected} onClose={() => setSelected(null)}>
        {selected && (
          <div className="flex flex-col max-h-[85vh]">
            <div className="p-4 border-b border-[var(--color-border)] flex justify-between items-center shrink-0">
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, fontFamily: 'monospace', color: 'var(--color-foreground)' }}>
                  {selected.flightNumber}
                </div>
                {selected.airline && <div style={{ fontSize: 11, color: 'var(--color-muted)' }}>{selected.airline}</div>}
              </div>
              <StatusBadge status={selectedStatus} />
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {detailLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="animate-spin" size={20} style={{ color: 'var(--color-accent-amber)' }} />
                </div>
              ) : (
                <>
                  <FlightTimeline status={selectedStatus} />

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div style={{ fontSize: 9, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Departure</div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-foreground)', fontFamily: 'monospace' }}>
                        {selected.status?.departure_airport || '—'}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--color-muted)' }}>
                        Sched {fmtTime(selected.status?.scheduled_departure ?? null)}
                        {selected.status?.actual_departure ? ` · Actual ${fmtTime(selected.status.actual_departure)}` : ''}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 9, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Arrival</div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-foreground)', fontFamily: 'monospace' }}>
                        {selected.status?.arrival_airport || '—'}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--color-muted)' }}>
                        Sched {fmtTime(selected.status?.scheduled_arrival ?? null)}
                        {selected.status?.actual_arrival ? ` · Actual ${fmtTime(selected.status.actual_arrival)}` : ''}
                      </div>
                    </div>
                  </div>

                  {selectedStatus === 'unknown' && (
                    <div style={{ fontSize: 11, color: 'var(--color-muted)', fontStyle: 'italic' }}>
                      No live data yet for this flight/date -- check the flight number, or try Refresh.
                    </div>
                  )}

                  <div>
                    <div style={{ fontSize: 9, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                      Shipments on this flight
                    </div>
                    <div className="space-y-1.5">
                      {selected.entries.map(e => (
                        <div key={e.id} className="flex items-center gap-2" style={{ fontSize: 12 }}>
                          <Package2 size={13} style={{ color: 'var(--color-muted)' }} />
                          <span style={{ fontFamily: 'monospace', color: 'var(--color-foreground)' }}>{e.awb || e.id}</span>
                          <span style={{ color: 'var(--color-muted)' }}>{e.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="p-4 border-t border-[var(--color-border)] shrink-0">
              <button
                onClick={refreshSelected}
                disabled={refreshing}
                className="w-full h-9 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-lg text-[11px] font-bold uppercase tracking-wider text-[var(--color-foreground)] flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
                {refreshing ? 'Refreshing…' : 'Refresh Live Status'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
