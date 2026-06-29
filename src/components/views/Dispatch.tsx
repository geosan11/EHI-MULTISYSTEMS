import { useState, useEffect } from 'react';
import { db } from '../../lib/db';
import { DriverTrip, TripPing } from '../../lib/types';
import { MapPin, Navigation, X, Truck, Phone } from 'lucide-react';
import { MapContainer, TileLayer, Polyline, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { supabase } from '../../lib/supabase';

// Fix leaflet icon issue in react-leaflet
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

interface TripWithPings extends DriverTrip {
  pings: TripPing[];
}

export const Dispatch = ({ onBack }: { onBack: () => void }) => {
  const [activeTrips, setActiveTrips] = useState<TripWithPings[]>([]);
  const [selectedTrip, setSelectedTrip] = useState<TripWithPings | null>(null);

  useEffect(() => {
    const fetchTrips = async () => {
      try {
        const { data, error } = await supabase
          .from('driver_trips')
          .select('*')
          .eq('status', 'Active')
          .eq('gps_enabled', true)
          .order('created_at', { ascending: false });

        if (data && !error) {
          const tripsWithPings = await Promise.all(data.map(async (t: any) => {
            let pings: TripPing[] = [];
            try { pings = await db.trip_pings.where('tripId').equals(t.id).sortBy('timestamp'); } catch {}
            return {
              id: t.id, driverName: t.driver_name || 'Driver',
              vehiclePlate: t.vehicle_plate || '', origin: t.origin || '',
              destination: t.destination || '', status: t.status,
              departureTime: t.departure_time || t.created_at,
              cargoRefs: t.cargo_refs || [], gpsTrackingEnabled: t.gps_enabled,
              pings
            };
          }));
          setActiveTrips(tripsWithPings);
        }
      } catch (err) {
        console.error('Dispatch fetch error:', err);
      }
    };

    fetchTrips();
    const interval = setInterval(fetchTrips, 15000); // refresh every 15s
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="overflow-y-auto pb-24 animate-in fade-in flex flex-col">
      <div className="ehi-page-body px-4 pt-4 space-y-4 flex flex-col flex-1">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-2">
        <div className="flex items-center gap-2">
          <button onClick={onBack} className="p-1 rounded hover:bg-[var(--color-surface-2)] text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors cursor-pointer border-none bg-transparent">
            ←
          </button>
          <div>
            <div className="text-[9px] font-mono text-[var(--color-muted)] tracking-[0.12em] uppercase">▸ DISPATCH</div>
            <div className="text-[12px] font-bold text-[var(--color-foreground)] tracking-wide mt-0.5">ACTIVE FLEET</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {activeTrips.length === 0 ? (
          <div className="col-span-full py-12 text-center border border-dashed border-[var(--color-border)] rounded-xl opacity-60">
            <Navigation className="mx-auto mb-2 text-[var(--color-muted)]" size={24} />
            <div className="text-[12px] font-mono text-[var(--color-muted)]">No active fleet tracking sessions</div>
          </div>
        ) : (
          activeTrips.map(trip => {
            const timeAgo = trip.pings?.length ? Math.floor((Date.now() - new Date(trip.pings[trip.pings.length-1]?.timestamp || Date.now()).getTime()) / 60000) : null;
            let batteryColor = '#10B981'; // Green
            if (timeAgo !== null) {
              if (timeAgo > 5) batteryColor = '#F59E0B'; // Amber - 5+ mins
              if (timeAgo > 15) batteryColor = '#EF4444'; // Red - 15+ mins
            }

            return (
              <div 
                key={trip.id} 
                onClick={() => setSelectedTrip(trip)}
                className="ehi-card cursor-pointer hover:border-[var(--color-accent-blue)] transition-colors group"
              >
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-[var(--color-surface-2)] flex items-center justify-center text-xl overflow-hidden border border-[var(--color-border)]">
                      <Truck size={18} className="text-[var(--color-muted)]" />
                    </div>
                    <div>
                      <div className="text-[14px] font-bold text-[var(--color-foreground)]">{trip.driverName}</div>
                      <div className="text-[10px] font-mono text-[var(--color-muted)] uppercase">{trip.vehiclePlate}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5" title="Tracking Status">
                    <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: batteryColor }} />
                    <span className="text-[9px] font-mono text-[var(--color-muted)]">
                      {timeAgo === null ? 'Connecting...' : timeAgo === 0 ? 'Now' : `${timeAgo}m ago`}
                    </span>
                  </div>
                </div>

                <div className="bg-[var(--color-surface-2)] rounded p-2 text-[10px] font-mono flex items-center justify-between">
                  <div className="flex-1 text-center truncate">{trip.origin.split(' ')[0]}</div>
                  <div className="px-2 text-[var(--color-muted)]">→</div>
                  <div className="flex-1 text-center truncate">{trip.destination.split(' ')[0]}</div>
                </div>

                <div className="mt-3 flex justify-between items-center text-[11px]">
                  <div className="text-[var(--color-light-muted)]">
                    <span className="font-bold text-[var(--color-foreground)]">{trip.cargoRefs.length}</span> items
                  </div>
                  {trip.pings?.length > 0 && (
                    <div className="flex items-center gap-1 text-[var(--color-accent-amber)] font-mono text-[9px]">
                      <MapPin size={10} /> POS LOGGED
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {selectedTrip && (
        <div className="fixed inset-0 z-50 bg-black/90 flex flex-col p-4 md:p-8">
          <div className="w-full h-full max-w-5xl mx-auto bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-strong)] flex flex-col overflow-hidden shadow-2xl relative">
            <div className="p-4 border-b border-[var(--color-border)] bg-[rgba(0,0,0,0.4)] flex justify-between items-center">
              <div className="flex items-center gap-3">
                <Navigation size={18} className="text-[var(--color-accent-blue)]" />
                <div>
                  <h3 className="text-[14px] font-bold text-[var(--color-foreground)] uppercase tracking-wider">{selectedTrip.vehiclePlate} Tracking</h3>
                  <div className="text-[10px] text-[var(--color-muted)] font-mono">{selectedTrip.driverName}</div>
                </div>
              </div>
              <div className="flex gap-2">
                <a 
                  href={`tel:0000000000`} 
                  className="px-3 py-1.5 bg-[rgba(16,185,129,0.1)] text-[var(--color-success)] border border-[rgba(16,185,129,0.3)] rounded text-[11px] font-bold uppercase font-mono flex items-center gap-1.5 hover:bg-[rgba(16,185,129,0.2)]"
                >
                  <Phone size={12} /> Call Driver
                </a>
                <button 
                  onClick={() => setSelectedTrip(null)}
                  className="p-1.5 bg-[var(--color-surface-2)] rounded hover:bg-white/10 text-[var(--color-muted)] transition-colors border-none"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="flex-1 relative bg-[var(--color-surface-2)]">
              {selectedTrip.pings.length > 0 ? (
                <MapContainer
                  center={[
                    selectedTrip.pings[selectedTrip.pings.length - 1].latitude,
                    selectedTrip.pings[selectedTrip.pings.length - 1].longitude
                  ]}
                  zoom={13}
                  style={{ height: '100%', width: '100%' }}
                >
                  <TileLayer
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  />
                  <Polyline 
                    positions={selectedTrip.pings.map(p => [p.latitude, p.longitude])} 
                    color="var(--color-accent-amber)" 
                    weight={4} 
                    opacity={0.8} 
                  />
                  <Marker position={[
                    selectedTrip.pings[selectedTrip.pings.length - 1].latitude,
                    selectedTrip.pings[selectedTrip.pings.length - 1].longitude
                  ]}>
                    <Popup>
                      <div className="text-[12px] font-bold">{selectedTrip.driverName}</div>
                      <div className="text-[10px] text-gray-500">{selectedTrip.vehiclePlate}</div>
                      <div className="text-[10px] text-gray-500 mt-1">Last ping: {new Date(selectedTrip.pings[selectedTrip.pings.length-1]?.timestamp || '').toLocaleTimeString()}</div>
                    </Popup>
                  </Marker>
                </MapContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-[var(--color-muted)] font-mono text-[12px]">
                  Waiting for location updates...
                </div>
              )}
            </div>

            <div className="p-3 border-t border-[var(--color-border)] bg-[rgba(0,0,0,0.4)] flex justify-between items-center text-[10px] font-mono">
              <div><span className="text-[var(--color-muted)]">Origin:</span> <span className="text-[var(--color-foreground)]">{selectedTrip.origin}</span></div>
              <div><span className="text-[var(--color-muted)]">Destination:</span> <span className="text-[var(--color-foreground)]">{selectedTrip.destination}</span></div>
              <div><span className="text-[var(--color-muted)]">Pings logged:</span> <span className="text-[var(--color-accent-amber)] font-bold">{selectedTrip.pings.length}</span></div>
            </div>
          </div>
        </div>
      )}
      </div>{/* end ehi-page-body */}
    </div>
  );
};
