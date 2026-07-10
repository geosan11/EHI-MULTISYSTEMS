import React, { useState, useEffect } from 'react';
import { ArrowLeft, Plus, Fuel, Truck, Wrench, Loader } from 'lucide-react';
import { fmt } from '../../lib/helpers';
import { supabase } from '../../lib/supabase';
import { User } from '../../lib/types';
import { EmptyState } from './EmptyState';

interface Vehicle {
  id: string;
  plate: string;
  make: string;
  model: string;
  type: string;
  driver: string;
  capacity: number;
  status: 'Available' | 'On Trip' | 'Maintenance' | 'Inactive';
  lastService: string;
  nextService: string;
}

interface FuelLog {
  id: string;
  plate: string;
  litres: number;
  costPerLitre: number;
  total_cost: number;
  station: string;
  date: string;
}

export const Fleet = ({ onBack, user }: { onBack: () => void; user?: User }) => {
  const [activeTab, setActiveTab] = useState<'vehicles' | 'fuel'>('vehicles');
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [fuelLogs, setFuelLogs] = useState<FuelLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [showAddVehicle, setShowAddVehicle] = useState(false);
  const [showAddFuel, setShowAddFuel] = useState(false);

  // Vehicle form
  const [plate, setPlate] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [capacity, setCapacity] = useState('1500');
  const [driver, setDriver] = useState('');
  const [type, setType] = useState('Van');

  // Fuel form
  const [fuelPlate, setFuelPlate] = useState('');
  const [litres, setLitres] = useState('');
  const [costPerLitre, setCostPerLitre] = useState('950');
  const [station, setStation] = useState('');

  const canEdit = user?.role === 'admin' || user?.role === 'super_admin';

  const fetchData = async () => {
    setLoading(true);
    try {
      const [vRes, fRes] = await Promise.all([
        supabase.from('fleet_vehicles').select('*').order('created_at', { ascending: false }),
        supabase.from('fuel_logs').select('*').order('log_date', { ascending: false }).limit(100)
      ]);

      if (vRes.data) {
        setVehicles(vRes.data.map((r: any) => ({
          id: r.id, plate: r.plate, make: r.make || '', model: r.model || '',
          type: r.vehicle_type || 'Van', driver: r.driver_name || 'Unassigned',
          capacity: r.capacity_kg || 1000, status: r.status || 'Available',
          lastService: r.last_service || '', nextService: r.next_service || ''
        })));
      }
      if (fRes.data) {
        setFuelLogs(fRes.data.map((r: any) => ({
          id: r.id, plate: r.vehicle_plate, litres: Number(r.litres),
          costPerLitre: Number(r.cost_per_litre), total_cost: Number(r.total_cost),
          station: r.station || '', date: r.log_date
        })));
      }
    } catch (err) {
      console.error('Fleet fetch error:', err);
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const retryFetch = () => {
    setFetchError(false);
    fetchData();
  };

  const handleAddVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!plate || !make) return;
    const payload = {
      plate: plate.toUpperCase(), make, model, vehicle_type: type,
      driver_name: driver || 'Unassigned', capacity_kg: Number(capacity) || 1000,
      status: 'Available', hub_id: user?.hub_id || null,
      last_service: new Date().toISOString().slice(0, 10),
      next_service: new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10)
    };
    const { data, error } = await supabase.from('fleet_vehicles').insert(payload).select().single();
    if (data && !error) {
      setVehicles(prev => [{
        id: data.id, plate: data.plate, make: data.make, model: data.model || '',
        type: data.vehicle_type, driver: data.driver_name, capacity: data.capacity_kg,
        status: 'Available', lastService: data.last_service, nextService: data.next_service
      }, ...prev]);
    }
    setShowAddVehicle(false);
    setPlate(''); setMake(''); setModel(''); setDriver('');
  };

  const handleAddFuel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fuelPlate || !(Number(litres) > 0) || !(Number(costPerLitre) > 0)) return;
    const payload = {
      vehicle_plate: fuelPlate, litres: Number(litres),
      cost_per_litre: Number(costPerLitre), station,
      logged_by: user?.name || '', hub_id: user?.hub_id || null,
      log_date: new Date().toISOString().slice(0, 10)
    };
    const { data, error } = await supabase.from('fuel_logs').insert(payload).select().single();
    if (data && !error) {
      setFuelLogs(prev => [{
        id: data.id, plate: data.vehicle_plate, litres: Number(data.litres),
        costPerLitre: Number(data.cost_per_litre), total_cost: Number(data.total_cost),
        station: data.station || '', date: data.log_date
      }, ...prev]);
    }
    setShowAddFuel(false);
    setFuelPlate(''); setLitres(''); setStation('');
  };

  const statusColor = (s: string) => ({
    Available: 'text-[var(--color-success)] bg-[rgba(16,185,129,0.1)]',
    'On Trip': 'text-[var(--color-accent-cobalt)] bg-[rgba(59,130,246,0.1)]',
    Maintenance: 'text-[var(--color-accent-amber)] bg-[rgba(245,158,11,0.1)]',
    Inactive: 'text-[var(--color-muted)] bg-[var(--color-surface-2)]'
  }[s] || 'text-[var(--color-muted)]');

  return (
    <div className="flex flex-col min-h-full bg-[var(--color-obsidian)]">
      <div className="ehi-page-body px-4 pt-4 text-[var(--color-foreground)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-2 mb-4">
        <button onClick={onBack} className="flex items-center gap-1 text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors">
          <ArrowLeft size={16} /><span className="text-[11px] font-mono">Back</span>
        </button>
        <span className="text-[10px] font-mono text-[var(--color-accent-cobalt)] tracking-widest font-bold">● FLEET</span>
      </div>

      <div className="flex justify-between items-center mb-4">
        <h2 className="text-[14px] font-bold">Fleet Management</h2>
        {canEdit && (
          <button onClick={() => activeTab === 'vehicles' ? setShowAddVehicle(true) : setShowAddFuel(true)}
            className="flex items-center gap-1.5 bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] text-[11px] font-bold px-3 py-1.5 rounded">
            <Plus size={12} /> {activeTab === 'vehicles' ? 'Add Vehicle' : 'Log Fuel'}
          </button>
        )}
      </div>

      <div className="flex border-b border-[var(--color-border)] mb-4">
        {(['vehicles', 'fuel'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`pb-2 px-4 text-[11px] font-mono font-bold border-b-2 transition-all capitalize ${activeTab === tab ? 'border-[var(--color-accent-amber)] text-[var(--color-accent-amber)]' : 'border-transparent text-[var(--color-muted)]'}`}>
            {tab === 'vehicles' ? `Vehicles (${vehicles.length})` : `Fuel Logs (${fuelLogs.length})`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Loader size={24} className="animate-spin text-[var(--color-accent-amber)]" />
          <p className="text-[12px] font-mono text-[var(--color-muted)]">Loading fleet data...</p>
        </div>
      ) : fetchError ? (
        <EmptyState
          icon={<Truck size={36} strokeWidth={1.5} />}
          title="Couldn't load fleet data"
          subtext="Check your connection and try again."
          actions={[{ label: 'Retry', onClick: retryFetch }]}
        />
      ) : activeTab === 'vehicles' ? (
        vehicles.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 border-2 border-dashed border-[var(--color-border)] rounded-xl">
            <Truck size={32} className="opacity-20" />
            <p className="text-[12px] font-mono text-[var(--color-muted)]">No vehicles registered yet</p>
            {canEdit && <button onClick={() => setShowAddVehicle(true)} className="text-[11px] font-mono text-[var(--color-accent-amber)] underline">Add first vehicle</button>}
          </div>
        ) : (
          <div className="space-y-3">
            {vehicles.map(v => (
              <div key={v.id} className="ehi-card p-4">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <p className="text-[14px] font-bold font-mono">{v.plate}</p>
                    <p className="text-[11px] text-[var(--color-muted)]">{v.make} {v.model} · {v.type}</p>
                  </div>
                  <span className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded font-mono ${statusColor(v.status)}`}>{v.status}</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-[10px] font-mono text-[var(--color-muted)]">
                  <span>Driver: {v.driver}</span>
                  <span>Cap: {v.capacity.toLocaleString()}kg</span>
                  <span>Next svc: {v.nextService || '—'}</span>
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        fuelLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 border-2 border-dashed border-[var(--color-border)] rounded-xl">
            <Fuel size={32} className="opacity-20" />
            <p className="text-[12px] font-mono text-[var(--color-muted)]">No fuel logs yet</p>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="ehi-card p-3 flex justify-between items-center mb-3 bg-[rgba(245,158,11,0.05)] border-[rgba(245,158,11,0.2)]">
              <span className="text-[10px] font-mono text-[var(--color-muted)]">Total Fuel Spend</span>
              <span className="text-[14px] font-bold font-mono text-[var(--color-accent-amber)]">{fmt(fuelLogs.reduce((s, f) => s + f.total_cost, 0))}</span>
            </div>
            {fuelLogs.map(f => (
              <div key={f.id} className="ehi-card p-3">
                <div className="flex justify-between items-center">
                  <div>
                    <p className="text-[12px] font-bold font-mono">{f.plate}</p>
                    <p className="text-[10px] text-[var(--color-muted)]">{f.litres}L @ ₦{f.costPerLitre}/L · {f.station}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[13px] font-bold text-[var(--color-accent-amber)]">{fmt(f.total_cost)}</p>
                    <p className="text-[9px] font-mono text-[var(--color-muted)]">{f.date}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* Add Vehicle Modal */}
      {showAddVehicle && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="ehi-card max-w-sm w-full">
            <div className="p-4 border-b border-[var(--color-border)] flex justify-between items-center">
              <span className="text-[11px] font-mono font-bold">Register Vehicle</span>
              <button onClick={() => setShowAddVehicle(false)} aria-label="Close" className="text-[var(--color-muted)] font-mono">✕</button>
            </div>
            <form onSubmit={handleAddVehicle} className="p-4 space-y-3">
              <div className="space-y-1">
                <label htmlFor="fleet-vehicle-type" className="text-[9px] font-mono text-[var(--color-muted)] uppercase">Vehicle Type</label>
                <select id="fleet-vehicle-type" value={type} onChange={e => setType(e.target.value)} className="w-full ehi-input text-[12px]">
                  <option value="Van">Van</option>
                  <option value="Truck">Truck</option>
                  <option value="Pickup">Pickup</option>
                  <option value="Bus">Bus</option>
                  <option value="Motorcycle">Motorcycle</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label htmlFor="fleet-vehicle-plate" className="text-[9px] font-mono text-[var(--color-muted)] uppercase">Plate No.</label>
                  <input id="fleet-vehicle-plate" required type="text" value={plate} onChange={e => setPlate(e.target.value)} placeholder="LAG-404AA" className="w-full ehi-input text-[12px] uppercase" />
                </div>
                <div className="space-y-1">
                  <label htmlFor="fleet-vehicle-capacity" className="text-[9px] font-mono text-[var(--color-muted)] uppercase">Load Limit (kg)</label>
                  <input id="fleet-vehicle-capacity" type="number" value={capacity} onChange={e => setCapacity(e.target.value)} className="w-full ehi-input text-[12px]" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label htmlFor="fleet-vehicle-make" className="text-[9px] font-mono text-[var(--color-muted)] uppercase">Make</label>
                  <input id="fleet-vehicle-make" required type="text" value={make} onChange={e => setMake(e.target.value)} placeholder="Toyota" className="w-full ehi-input text-[12px]" />
                </div>
                <div className="space-y-1">
                  <label htmlFor="fleet-vehicle-model" className="text-[9px] font-mono text-[var(--color-muted)] uppercase">Model</label>
                  <input id="fleet-vehicle-model" type="text" value={model} onChange={e => setModel(e.target.value)} placeholder="Hiace" className="w-full ehi-input text-[12px]" />
                </div>
              </div>
              <div className="space-y-1">
                <label htmlFor="fleet-vehicle-driver" className="text-[9px] font-mono text-[var(--color-muted)] uppercase">Driver Name</label>
                <input id="fleet-vehicle-driver" type="text" value={driver} onChange={e => setDriver(e.target.value)} placeholder="Driver Tunde" className="w-full ehi-input text-[12px]" />
              </div>
              <div className="flex gap-2 pt-1">
                <button type="submit" className="flex-1 bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] font-bold text-[11px] py-2.5 rounded">Add Vehicle</button>
                <button type="button" onClick={() => setShowAddVehicle(false)} className="px-4 bg-[var(--color-surface-2)] text-[var(--color-muted)] text-[11px] rounded">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Fuel Modal */}
      {showAddFuel && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="ehi-card max-w-sm w-full">
            <div className="p-4 border-b border-[var(--color-border)] flex justify-between items-center">
              <span className="text-[11px] font-mono font-bold">Log Fuel</span>
              <button onClick={() => setShowAddFuel(false)} aria-label="Close" className="text-[var(--color-muted)] font-mono">✕</button>
            </div>
            <form onSubmit={handleAddFuel} className="p-4 space-y-3">
              <div className="space-y-1">
                <label htmlFor="fleet-fuel-plate" className="text-[9px] font-mono text-[var(--color-muted)] uppercase">Vehicle Plate</label>
                <select id="fleet-fuel-plate" value={fuelPlate} onChange={e => setFuelPlate(e.target.value)} required className="w-full ehi-input text-[12px]">
                  <option value="">Select vehicle...</option>
                  {vehicles.map(v => (
                    <option key={v.id} value={v.plate}>{v.plate} · {v.driver}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label htmlFor="fleet-fuel-litres" className="text-[9px] font-mono text-[var(--color-muted)] uppercase">Litres</label>
                  <input id="fleet-fuel-litres" name="fleet-fuel-litres" required type="number" min="0.01" step="0.01" value={litres} onChange={e => setLitres(e.target.value)} placeholder="e.g. 45" className="w-full ehi-input text-[12px]" />
                </div>
                <div className="space-y-1">
                  <label htmlFor="fleet-fuel-rate" className="text-[9px] font-mono text-[var(--color-muted)] uppercase">Rate/L (₦)</label>
                  <input id="fleet-fuel-rate" name="fleet-fuel-rate" required type="number" min="0.01" step="0.01" value={costPerLitre} onChange={e => setCostPerLitre(e.target.value)} className="w-full ehi-input text-[12px]" />
                </div>
              </div>
              <div className="space-y-1">
                <label htmlFor="fleet-fuel-station" className="text-[9px] font-mono text-[var(--color-muted)] uppercase">Station Name</label>
                <input id="fleet-fuel-station" type="text" value={station} onChange={e => setStation(e.target.value)} placeholder="e.g. BOVAS Ikeja" className="w-full ehi-input text-[12px]" />
              </div>
              <div className="flex gap-2 pt-1">
                <button type="submit" className="flex-1 bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] font-bold text-[11px] py-2.5 rounded">Save Log</button>
                <button type="button" onClick={() => setShowAddFuel(false)} className="px-4 bg-[var(--color-surface-2)] text-[var(--color-muted)] text-[11px] rounded">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
      </div>
    </div>
  );
};
