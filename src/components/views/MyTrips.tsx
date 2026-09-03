import React, { useState, useEffect, useRef } from 'react';
import { User, DriverTrip, TripPing } from '../../lib/types';
import { uid, tnow } from '../../lib/helpers';
import { db } from '../../lib/db';
import { Truck, Plus, ChevronDown, ChevronUp, MapPin } from 'lucide-react';
import { Button } from '../ui';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/ToastContext';
import { useHubRoutes } from '../../lib/hubRoutes';

interface TripCardProps {
  trip: DriverTrip;
  expandedTrip: string | null;
  onToggle: (id: string) => void;
  onComplete: (id: string) => void;
  onCancel: (id: string) => void;
}

const TripCard: React.FC<TripCardProps> = ({
  trip, expandedTrip, onToggle, onComplete, onCancel
}) => {
  const isExpanded = expandedTrip === trip.id;
  // trip.status -> semantic tone. (Was a bare `var(--color-*)` string that
  // got string-concatenated with alpha hex -- `${statusColor}18` produced
  // the invalid value `var(--color-accent-amber)18`, so the status chip's
  // background and border silently never rendered.)
  const tone =
    trip.status === 'Active' ? 'amber' :
    trip.status === 'Completed' ? 'success' : 'error';

  const timeAgo = trip.lastPingAt ? Math.floor((Date.now() - new Date(trip.lastPingAt).getTime()) / 60000) : null;

  return (
    <div
      className="ehi-card overflow-hidden mb-3"
      style={{ borderLeft: `3px solid var(--color-${tone}-fg)` }}
    >
      {/* Card header */}
      <div
        className="p-4 flex items-center justify-between cursor-pointer"
        onClick={() => onToggle(trip.id)}
      >
        <div className="flex items-center gap-3">
          <Truck size={18} style={{ color: `var(--color-${tone}-fg)` }} />
          <div>
            <div className="text-[13px] font-bold text-[var(--color-foreground)]">
              {trip.vehiclePlate}
            </div>
            <div className="text-[10px] font-mono text-[var(--color-muted)] mt-0.5">
              {trip.origin.split(' ')[0]} → {trip.destination.split(' ')[0]}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span
            className="text-[9px] font-mono font-bold px-2 py-1 rounded border"
            style={{
              background: `var(--color-${tone}-bg)`,
              color: `var(--color-${tone}-fg)`,
              borderColor: `var(--color-${tone}-border)`,
            }}
          >
            {trip.status.toUpperCase()}
          </span>
          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      </div>

      {trip.status === 'Active' && trip.gpsTrackingEnabled && (
        <div className="px-4 pb-3 flex items-center gap-2 text-[10px] font-mono">
          <MapPin size={12} className="text-[var(--color-success)] animate-pulse" />
          <span className="text-[var(--color-muted)]">
            Tracking active · {timeAgo === null ? 'Waiting for ping...' : timeAgo === 0 ? 'Last ping: just now' : `Last ping: ${timeAgo} min ago`}
          </span>
        </div>
      )}

      {/* Expanded details */}
      {isExpanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-[var(--color-border)]">
          <div className="grid grid-cols-2 gap-3 pt-3">
            <div>
              <div className="text-[8px] font-mono text-[var(--color-muted)] uppercase tracking-wider">
                Departed
              </div>
              <div className="text-[11px] font-mono text-[var(--color-foreground)] mt-0.5">
                {trip.departureTime}
              </div>
            </div>
            {trip.arrivalTime && (
              <div>
                <div className="text-[8px] font-mono text-[var(--color-muted)] uppercase tracking-wider">
                  Arrived
                </div>
                <div className="text-[11px] font-mono text-[var(--color-success)] mt-0.5">
                  {trip.arrivalTime}
                </div>
              </div>
            )}
          </div>

          <div>
            <div className="text-[8px] font-mono text-[var(--color-muted)] uppercase tracking-wider mb-1">
              Cargo on Vehicle ({trip.cargoRefs.length} items)
            </div>
            {trip.cargoRefs.length === 0 ? (
              <div className="text-[10px] font-mono text-[var(--color-muted)]">
                No AWB refs logged
              </div>
            ) : (
              <div className="flex flex-wrap gap-1">
                {trip.cargoRefs.map(ref => (
                  <span
                    key={ref}
                    className="text-[9px] font-mono px-2 py-0.5 rounded border bg-[var(--color-amber-bg)] border-[var(--color-amber-border)] text-[var(--color-amber-fg)]"
                  >
                    {ref}
                  </span>
                ))}
              </div>
            )}
          </div>

          {trip.notes && (
            <div className="text-[10px] font-mono text-[var(--color-muted)]">
              Note: {trip.notes}
            </div>
          )}

          {/* Ref ID */}
          <div className="text-[8px] font-mono text-[var(--color-muted)]">
            Trip ID: {trip.id}
          </div>

          {/* Action buttons */}
          {trip.status === 'Active' && (
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => onComplete(trip.id)}
                className="flex-1 py-2 rounded text-[11px] font-bold font-mono cursor-pointer border bg-[var(--color-success-bg)] border-[var(--color-success-border)] text-[var(--color-success-fg)]"
              >
                ✓ MARK ARRIVED
              </button>
              <button
                onClick={() => onCancel(trip.id)}
                className="flex-1 py-2 rounded text-[11px] font-mono cursor-pointer border bg-[var(--color-error-bg)] border-[var(--color-error-border)] text-[var(--color-error-fg)]"
              >
                CANCEL
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const getTodayKey = () =>
  `ehi_driver_trips_${new Date().toISOString().split('T')[0]}`;

export const MyTrips = ({ user }: { user: User }) => {
  const { showToast } = useToast();
  const TRIPS_KEY = getTodayKey();

  const [trips, setTrips] = useState<DriverTrip[]>(() => {
    try {
      const saved = localStorage.getItem(TRIPS_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    const fetchTrips = async () => {
      try {
        const { data, error } = await supabase
          .from('driver_trips')
          .select('*')
          .eq('driver_id', user.id)
          .order('created_at', { ascending: false })
          .limit(50);
        
        if (data && !error) {
          const mappedTrips = data.map(d => ({
            id: d.id,
            vehiclePlate: d.vehicle_plate || '',
            driverName: d.driver_name || '',
            origin: d.origin || '',
            destination: d.destination || '',
            departureTime: d.departure_time ? new Date(d.departure_time).toLocaleString('en-GB') : '',
            arrivalTime: d.arrival_time ? new Date(d.arrival_time).toLocaleString('en-GB') : undefined,
            status: d.status as any,
            cargoRefs: d.cargo_refs || [],
            notes: '', // If you want to support notes, add a column or leave empty
            createdAt: d.created_at,
            gpsTrackingEnabled: d.gps_enabled || false,
          }));
          setTrips(mappedTrips);
          localStorage.setItem(TRIPS_KEY, JSON.stringify(mappedTrips));
        }
      } catch (err) {
        console.error("Failed to fetch driver_trips:", err);
      }
    };
    fetchTrips();
  }, [user.id, TRIPS_KEY]);

  // Track active watches
  const watchRefs = useRef<Record<string, number>>({});

  // Persist on every change
  useEffect(() => {
    localStorage.setItem(TRIPS_KEY, JSON.stringify(trips));
  }, [trips, TRIPS_KEY]);

  // Handle GPS watcher lifecycle
  useEffect(() => {
    const handleLocation = async (tripId: string, pos: GeolocationPosition) => {
      const ping: TripPing = {
        // trip_pings.id is a uuid PRIMARY KEY in Supabase -- a client-side
        // 'PING-...' string made every sync upsert fail permanently with
        // "invalid input syntax for type uuid", so GPS pings never reached
        // the server at all.
        id: crypto.randomUUID(),
        tripId,
        timestamp: new Date().toISOString(),
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        speed: pos.coords.speed || undefined,
        accuracy: pos.coords.accuracy || undefined
      };

      try {
        await db.trip_pings.add(ping);
        await db.sync_queue.add({
          table_name: 'trip_pings',
          record_id: ping.id,
          action: 'INSERT',
          payload: ping as any,
          synced: 0,
          created_at: new Date().toISOString(),
        });
      } catch (err) {
        console.error(err);
      }

      setTrips(prev => prev.map(t => 
        t.id === tripId ? {
          ...t, 
          lastPingAt: ping.timestamp,
          lastLatitude: ping.latitude,
          lastLongitude: ping.longitude,
          lastSpeed: ping.speed
        } : t
      ));
    };

    activeTrips.forEach(trip => {
      if (trip.gpsTrackingEnabled && trip.status === 'Active') {
        if (!watchRefs.current[trip.id]) {
          navigator.geolocation.getCurrentPosition((pos) => handleLocation(trip.id, pos), () => {}, { enableHighAccuracy: false });
          const watchId = navigator.geolocation.watchPosition(
            (pos) => handleLocation(trip.id, pos),
            (err) => console.warn(err),
            { enableHighAccuracy: false, maximumAge: 30000, timeout: 27000 }
          );
          watchRefs.current[trip.id] = watchId;
        }
      } else {
        if (watchRefs.current[trip.id]) {
          navigator.geolocation.clearWatch(watchRefs.current[trip.id]);
          delete watchRefs.current[trip.id];
        }
      }
    });

    completedTrips.forEach(trip => {
      if (watchRefs.current[trip.id]) {
        navigator.geolocation.clearWatch(watchRefs.current[trip.id]);
        delete watchRefs.current[trip.id];
      }
    });

    return () => {};
  }, [trips]);

  useEffect(() => {
    return () => {
      Object.keys(watchRefs.current).forEach(key => {
        navigator.geolocation.clearWatch(watchRefs.current[key]);
      });
    };
  }, []);

  // Clean up yesterday's key on mount
  useEffect(() => {
    const yesterday = new Date(Date.now() - 86400000)
      .toISOString().split('T')[0];
    localStorage.removeItem(`ehi_driver_trips_${yesterday}`);
  }, []);
  const [showNewTripForm, setShowNewTripForm] = useState(false);
  const [expandedTrip, setExpandedTrip] = useState<string | null>(null);

  // Live hub list (was a standalone hardcoded NIGERIAN_HUBS array that never
  // reflected hubs added/renamed via Settings -> Add Hub). Format matches
  // every other hub-driven screen ("CODE/City"), not the old "City Station"
  // labels, since the hubs table has no separate display-label column.
  const hubOptions = useHubRoutes({ includeOther: false });

  // New trip form state
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [origin, setOrigin] = useState(user.hub);
  const [destination, setDestination] = useState(() => hubOptions[1] || hubOptions[0] || '');
  const [cargoRefsInput, setCargoRefsInput] = useState('');
  const [notes, setNotes] = useState('');
  const [gpsEnabled, setGpsEnabled] = useState(false);

  const activeTrips = trips.filter(t => t.status === 'Active');
  const completedTrips = trips.filter(t => t.status === 'Completed' || t.status === 'Cancelled');

  const handleStartTrip = async () => {
    if (!vehiclePlate.trim() || !destination) return;
    const refs = cargoRefsInput
      .split(/[\n,]/)
      .map(r => r.trim().toUpperCase())
      .filter(Boolean);

    const trip: DriverTrip = {
      id: uid('TR'),
      vehiclePlate: vehiclePlate.trim().toUpperCase(),
      driverName: user.name,
      origin,
      destination,
      departureTime: tnow(),
      status: 'Active',
      cargoRefs: refs,
      notes: notes.trim(),
      createdAt: new Date().toISOString(),
      gpsTrackingEnabled: gpsEnabled,
    };

    setTrips(prev => [trip, ...prev]);
    setShowNewTripForm(false);
    setVehiclePlate('');
    setCargoRefsInput('');
    setNotes('');
    setGpsEnabled(false);

    // Local state above is the source of truth for this driver's own screen
    // (trips are cached to localStorage, offline-first by design), but a
    // failed sync here means Dispatch/fleet-tracking on OTHER devices never
    // sees this trip at all -- previously silent (result discarded
    // entirely), so nothing told the driver a retry was needed.
    const { error: tripInsertError } = await supabase.from('driver_trips').insert({
      id: trip.id,
      driver_id: user.id,
      driver_name: user.name,
      hub: user.hub,
      hub_id: user.hub_id || null,
      vehicle_plate: trip.vehiclePlate,
      origin: trip.origin,
      destination: trip.destination,
      departure_time: new Date().toISOString(),
      status: 'Active',
      cargo_refs: trip.cargoRefs,
      gps_enabled: trip.gpsTrackingEnabled,
    });
    if (tripInsertError) {
      showToast({ message: `Trip saved on this device, but failed to sync to the server: ${tripInsertError.message}. Dispatch won't see it until this succeeds.`, type: 'error' });
    }
  };

  const handleCompleteTrip = async (tripId: string) => {
    setTrips(prev => prev.map(t =>
      t.id === tripId
        ? { ...t, status: 'Completed', arrivalTime: tnow(), gpsTrackingEnabled: false }
        : t
    ));
    const { error } = await supabase.from('driver_trips').update({
      status: 'Completed',
      arrival_time: new Date().toISOString(),
      gps_enabled: false
    }).eq('id', tripId);
    if (error) {
      showToast({ message: `Trip marked complete here, but failed to sync to the server: ${error.message}.`, type: 'error' });
    }
  };

  const handleCancelTrip = async (tripId: string) => {
    setTrips(prev => prev.map(t =>
      t.id === tripId ? { ...t, status: 'Cancelled', gpsTrackingEnabled: false } : t
    ));
    const { error } = await supabase.from('driver_trips').update({
      status: 'Cancelled',
      gps_enabled: false
    }).eq('id', tripId);
    if (error) {
      showToast({ message: `Trip cancelled here, but failed to sync to the server: ${error.message}.`, type: 'error' });
    }
  };


  return (
    <div className="p-4 pb-20 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-2">
        <div>
          <div className="text-[9px] font-mono text-[var(--color-muted)] tracking-[0.12em] uppercase">
            ▸ DRIVER CONSOLE
          </div>
          <div className="text-[11px] font-mono text-[var(--color-accent-amber)] mt-0.5">
            {user.name} · {user.hub}
          </div>
        </div>
        <button
          onClick={() => setShowNewTripForm(!showNewTripForm)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded text-[11px] font-bold font-mono cursor-pointer border border-[var(--color-amber-border)] text-[var(--color-accent-amber)] ${
            showNewTripForm ? 'bg-[var(--color-amber-bg)]' : 'bg-[var(--color-surface-1)]'
          }`}
        >
          <Plus size={13} />
          NEW TRIP
        </button>
      </div>

      {/* New trip form */}
      {showNewTripForm && (
        <div className="bg-[var(--color-surface-1)] rounded-xl p-4 space-y-3 border border-[var(--color-amber-border)]">
          <div className="text-[9px] font-mono text-[var(--color-accent-amber)] uppercase tracking-widest mb-2">
            ▸ LOG NEW TRIP
          </div>

          <input
            placeholder="Vehicle Plate Number (e.g. LSD 456 AA)"
            value={vehiclePlate}
            onChange={e => setVehiclePlate(e.target.value)}
            className="w-full h-11 px-3 text-[13px] font-mono rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)] uppercase"
          />

          <div className="flex gap-3">
            <select
              value={origin}
              onChange={e => setOrigin(e.target.value)}
              className="flex-1 h-11 px-3 text-[12px] rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-foreground)] focus:outline-none"
            >
              {hubOptions.map(h => (
                <option key={h} value={h}>{h}</option>
              ))}
            </select>
            <div className="flex items-center text-[var(--color-muted)] font-mono text-[12px]">→</div>
            <select
              value={destination}
              onChange={e => setDestination(e.target.value)}
              className="flex-1 h-11 px-3 text-[12px] rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-foreground)] focus:outline-none"
            >
              {hubOptions.map(h => (
                <option key={h} value={h}>{h}</option>
              ))}
            </select>
          </div>

          <textarea
            placeholder="AWB / Cargo refs on this vehicle (one per line or comma separated)"
            value={cargoRefsInput}
            onChange={e => setCargoRefsInput(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 text-[12px] font-mono rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-foreground)] focus:outline-none resize-none"
          />

          <input
            placeholder="Notes (optional)"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            className="w-full h-10 px-3 text-[12px] rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-foreground)] focus:outline-none"
          />

          <div className="flex items-start gap-2 bg-[var(--color-surface-2)] p-3 rounded">
            <input 
              type="checkbox" 
              checked={gpsEnabled} 
              onChange={e => setGpsEnabled(e.target.checked)} 
              className="mt-0.5 accent-[var(--color-accent-amber)]"
              id="gpsCheck"
            />
            <label htmlFor="gpsCheck" className="text-[11px] font-sans text-[var(--color-light-muted)] cursor-pointer">
              <span className="font-bold text-[var(--color-foreground)] block mb-0.5">Enable GPS tracking for this trip</span>
              <span className="text-[10px] text-[var(--color-muted)]">Your location will be shared with EHI dispatch while this trip is active. Battery use slightly increased.</span>
            </label>
          </div>

          <div className="flex gap-2">
            <Button variant="secondary" size="md" className="flex-1" onClick={() => setShowNewTripForm(false)}>
              CANCEL
            </Button>
            <Button
              variant="primary"
              size="md"
              className="flex-1"
              onClick={handleStartTrip}
              disabled={!vehiclePlate.trim()}
            >
              START TRIP
            </Button>
          </div>
        </div>
      )}

      {/* Stats row */}
      <div className="flex gap-3">
        <div className="flex-1 bg-[var(--color-amber-bg)] border border-[var(--color-amber-border)] rounded-lg p-3 text-center">
          <div className="text-[22px] font-bold font-mono text-[var(--color-accent-amber)]">
            {activeTrips.length}
          </div>
          <div className="text-[8px] font-mono text-[var(--color-muted)] uppercase tracking-wider">
            Active
          </div>
        </div>
        <div className="flex-1 bg-[var(--color-success-bg)] border border-[var(--color-success-border)] rounded-lg p-3 text-center">
          <div className="text-[22px] font-bold font-mono text-[var(--color-success)]">
            {completedTrips.filter(t => t.status === 'Completed').length}
          </div>
          <div className="text-[8px] font-mono text-[var(--color-muted)] uppercase tracking-wider">
            Completed
          </div>
        </div>
        <div className="flex-1 bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-lg p-3 text-center">
          <div className="text-[22px] font-bold font-mono text-[var(--color-foreground)]">
            {trips.reduce((sum, t) => sum + t.cargoRefs.length, 0)}
          </div>
          <div className="text-[8px] font-mono text-[var(--color-muted)] uppercase tracking-wider">
            Items Moved
          </div>
        </div>
      </div>

      {/* Active trips */}
      {activeTrips.length > 0 && (
        <div>
          <div className="text-[9px] font-mono text-[var(--color-accent-amber)] uppercase tracking-widest mb-2">
            ▸ ACTIVE TRIPS
          </div>
          {activeTrips.map(t => (
            <TripCard
              key={t.id}
              trip={t}
              expandedTrip={expandedTrip}
              onToggle={(id) => setExpandedTrip(prev => prev === id ? null : id)}
              onComplete={handleCompleteTrip}
              onCancel={handleCancelTrip}
            />
          ))}
        </div>
      )}

      {/* Completed trips */}
      {completedTrips.length > 0 && (
        <div>
          <div className="text-[9px] font-mono text-[var(--color-muted)] uppercase tracking-widest mb-2">
            ▸ COMPLETED TODAY
          </div>
          {completedTrips.map(t => (
            <TripCard
              key={t.id}
              trip={t}
              expandedTrip={expandedTrip}
              onToggle={(id) => setExpandedTrip(prev => prev === id ? null : id)}
              onComplete={handleCompleteTrip}
              onCancel={handleCancelTrip}
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {trips.length === 0 && !showNewTripForm && (
        <div
          className="flex flex-col items-center justify-center py-16 rounded-xl border-2 border-dashed"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <Truck size={36} color="var(--color-muted)" strokeWidth={1.5} />
          <div className="text-[12px] font-mono text-[var(--color-muted)] mt-3">
            No trips logged today
          </div>
          <div className="text-[10px] font-mono text-[var(--color-muted)] mt-1 opacity-60">
            Tap NEW TRIP to log a vehicle run
          </div>
        </div>
      )}
    </div>
  );
};
