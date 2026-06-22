import React, { useState } from 'react';
import { ArrowLeft, Plus, Trash2, Fuel, ShieldAlert, Truck, Wrench, BarChart2, Check } from 'lucide-react';
import { fmt } from '../../lib/helpers';

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
  station: string;
  date: string;
}

export const Fleet = ({ 
  onBack 
}: { 
  onBack: () => void;
}) => {
  const [activeTab, setActiveTab] = useState<'vehicles' | 'maintenance' | 'fuel'>('vehicles');
  const [showAddVehicleModal, setShowAddVehicleModal] = useState(false);

  // Initial Seed Vehicles (SaaS & Fleet Management)
  const [vehicles, setVehicles] = useState<Vehicle[]>([
    { id: 'v-1', plate: 'LAG-404AA', make: 'Toyota', model: 'Hiace Cargo', type: 'Van', driver: 'Driver Folarin', capacity: 1200, status: 'Available', lastService: '2026-05-10', nextService: '2026-08-10' },
    { id: 'v-2', plate: 'KAF-114BB', make: 'Mitsubishi', model: 'Fuso 5-Ton', type: 'Truck', driver: 'Driver Ibrahim', capacity: 5000, status: 'On Trip', lastService: '2026-04-12', nextService: '2026-07-12' },
    { id: 'v-3', plate: 'ABJ-901CC', make: 'Nissan', model: 'Cabstar Pickup', type: 'Pickup', driver: 'Driver Stanley', capacity: 2200, status: 'Maintenance', lastService: '2026-03-20', nextService: '2026-06-25' }
  ]);

  // Fuel Logs Storage
  const [fuelLogs, setFuelLogs] = useState<FuelLog[]>([
    { id: 'FL-001', plate: 'LAG-404AA', litres: 45, costPerLitre: 850, station: 'BOVAS Ojota', date: '2026-06-19' },
    { id: 'FL-002', plate: 'KAF-114BB', litres: 120, costPerLitre: 870, station: 'NNPC Abuja', date: '2026-06-18' },
    { id: 'FL-003', plate: 'ABJ-901CC', litres: 35, costPerLitre: 850, station: 'Total Ikeja', date: '2026-06-17' }
  ]);

  // Form states for new vehicle
  const [plate, setPlate] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [capacity, setCapacity] = useState('1500');
  const [driver, setDriver] = useState('');
  const [type, setType] = useState('Van');

  // Form states for new fuel log
  const [selectedPlate, setSelectedPlate] = useState(vehicles[0]?.plate || '');
  const [litres, setLitres] = useState('');
  const [costPrLitre, setCostPrLitre] = useState('850');
  const [stationName, setStationName] = useState('');

  const handleAddVehicle = (e: React.FormEvent) => {
    e.preventDefault();
    if (!plate || !make) return;
    const newVehicle: Vehicle = {
      id: `v-${Date.now()}`,
      plate: plate.toUpperCase(),
      make,
      model,
      type,
      driver: driver || 'Unassigned',
      capacity: Number(capacity) || 1200,
      status: 'Available',
      lastService: new Date().toISOString().split('T')[0],
      nextService: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    };

    setVehicles(prev => [...prev, newVehicle]);
    setShowAddVehicleModal(false);
    setPlate('');
    setMake('');
    setModel('');
    setDriver('');
  };

  const handleLogFuel = (e: React.FormEvent) => {
    e.preventDefault();
    if (!litres) return;
    const newLog: FuelLog = {
      id: `FL-${Date.now().toString().slice(-5)}`,
      plate: selectedPlate,
      litres: Number(litres),
      costPerLitre: Number(costPrLitre),
      station: stationName || 'General Station',
      date: new Date().toISOString().split('T')[0]
    };
    setFuelLogs(prev => [newLog, ...prev]);
    setLitres('');
    setStationName('');
  };

  const handleDeleteVehicle = (id: string) => {
    if (confirm('Deactivate and remove this vehicle from fleet?')) {
      setVehicles(prev => prev.filter(v => v.id !== id));
    }
  };

  const handleToggleStatus = (id: string, current: string) => {
    const nextStatus: Record<string, Vehicle['status']> = {
      'Available': 'On Trip',
      'On Trip': 'Maintenance',
      'Maintenance': 'Available'
    };
    const next = nextStatus[current] || 'Available';
    setVehicles(prev => prev.map(v => v.id === id ? { ...v, status: next } : v));
  };

  return (
    <div className="flex flex-col h-full bg-[var(--color-obsidian)] p-4 text-[var(--color-foreground)] overflow-y-auto pb-[80px] font-sans">
      {/* Header back navigation */}
      <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-2 mb-4">
        <button onClick={onBack} className="flex items-center space-x-1 text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors">
          <ArrowLeft size={16} />
          <span className="text-[11px] font-mono">Back</span>
        </button>
        <span className="text-[10px] font-mono text-[var(--color-accent-amber)] tracking-widest font-bold">● SYSTEM FLEET HUB</span>
      </div>

      <div className="flex justify-between items-center mb-6">
        <div className="space-y-0.5">
          <div className="text-[9px] font-mono text-slate-400 tracking-[0.15em] uppercase">▸ ENTERPRISE FLEET TRACKER</div>
          <h2 className="text-sm font-black text-[var(--color-foreground)]">Logistics & Route Vehicles</h2>
        </div>

        {activeTab === 'vehicles' && (
          <button 
            onClick={() => setShowAddVehicleModal(true)}
            className="bg-[var(--color-accent-amber)] hover:bg-amber-600 text-[var(--color-obsidian)] font-mono text-[10px] uppercase font-bold px-3 py-1.5 rounded flex items-center space-x-1 cursor-pointer"
          >
            <Plus size={12} />
            <span>Add Vehicle</span>
          </button>
        )}
      </div>

      {/* Surface switches */}
      <div className="flex space-x-2 bg-black/35 p-1 rounded-lg border border-[var(--color-border)] mb-6">
        <button
          onClick={() => setActiveTab('vehicles')}
          className={`flex-1 py-2 text-center text-[10px] font-mono uppercase font-bold rounded-md flex items-center justify-center space-x-1.5 transition-colors ${
            activeTab === 'vehicles' ? 'bg-[var(--color-accent-amber)] text-[var(--color-obsidian)]' : 'text-slate-400 hover:text-white'
          }`}
        >
          <Truck size={12} />
          <span>Fleet Registry</span>
        </button>
        <button
          onClick={() => setActiveTab('maintenance')}
          className={`flex-1 py-2 text-center text-[10px] font-mono uppercase font-bold rounded-md flex items-center justify-center space-x-1.5 transition-colors ${
            activeTab === 'maintenance' ? 'bg-[var(--color-accent-amber)] text-[var(--color-obsidian)]' : 'text-slate-400 hover:text-white'
          }`}
        >
          <Wrench size={12} />
          <span>Services scheduler</span>
        </button>
        <button
          onClick={() => setActiveTab('fuel')}
          className={`flex-1 py-2 text-center text-[10px] font-mono uppercase font-bold rounded-md flex items-center justify-center space-x-1.5 transition-colors ${
            activeTab === 'fuel' ? 'bg-[var(--color-accent-amber)] text-[var(--color-obsidian)]' : 'text-slate-400 hover:text-white'
          }`}
        >
          <Fuel size={12} />
          <span>Fuel Ledger</span>
        </button>
      </div>

      {/* Tab Contents */}
      {activeTab === 'vehicles' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {vehicles.map((v) => (
              <div key={v.id} className="bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.05)] p-4 rounded-xl relative overflow-hidden space-y-4">
                <span className={`absolute top-0 right-0 h-1.5 w-full ${
                  v.status === 'Available' ? 'bg-[var(--color-success)]' :
                  v.status === 'On Trip' ? 'bg-[var(--color-accent-cobalt)]' :
                  v.status === 'Maintenance' ? 'bg-[var(--color-accent-amber)]' : 'bg-red-500'
                }`} />

                <div className="flex justify-between items-start">
                  <div>
                    <span className="text-[9px] font-mono font-bold text-slate-500 block uppercase tracking-wider">{v.type} ({v.capacity}KG Limit)</span>
                    <h3 className="text-base font-mono font-black text-white mt-0.5">{v.plate}</h3>
                  </div>
                  <button 
                    onClick={() => handleToggleStatus(v.id, v.status)}
                    className={`text-[9px] font-mono font-bold px-2.5 py-1 rounded-full uppercase tracking-wider border border-solid ${
                      v.status === 'Available' ? 'bg-[rgba(16,185,129,0.1)] text-[var(--color-success)] border-[rgba(16,185,129,0.3)]' :
                      v.status === 'On Trip' ? 'bg-[rgba(59,130,246,0.1)] text-[var(--color-accent-cobalt)] border-[rgba(59,130,246,0.3)]' :
                      'bg-[rgba(245,158,11,0.1)] text-[var(--color-accent-amber)] border-[rgba(245,158,11,0.3)]'
                    }`}
                  >
                    {v.status}
                  </button>
                </div>

                <div className="pt-2 border-t border-[rgba(255,255,255,0.05)] grid grid-cols-2 gap-4 text-[11px]">
                  <div>
                    <span className="text-[8px] font-mono text-[var(--color-muted)] uppercase tracking-wider block">Assigned Driver</span>
                    <span className="font-semibold text-slate-300 mt-0.5 block truncate">{v.driver}</span>
                  </div>
                  <div>
                    <span className="text-[8px] font-mono text-[var(--color-muted)] uppercase tracking-wider block">Car Model</span>
                    <span className="font-semibold text-slate-300 mt-0.5 block truncate">{v.make} {v.model}</span>
                  </div>
                </div>

                <div className="flex justify-between items-center pt-3 border-t border-[rgba(255,255,255,0.05)]">
                  <span className="text-[9px] font-mono text-slate-500 uppercase">Service: {v.nextService}</span>
                  <button 
                    onClick={() => handleDeleteVehicle(v.id)}
                    className="text-[var(--color-error)] opacity-60 hover:opacity-100 p-1 rounded hover:bg-red-500/10 cursor-pointer"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'maintenance' && (
        <div className="bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.05)] rounded-xl overflow-hidden">
          <div className="p-3 border-b border-[rgba(255,255,255,0.05)] bg-[rgba(255,255,255,0.02)] flex justify-between items-center">
            <span className="text-[10px] font-mono text-white uppercase tracking-wider">Scheduled Fleet Services</span>
            <span className="text-[9px] text-[var(--color-muted)] font-mono uppercase">Interval Checklist (90-Day Standard)</span>
          </div>

          <div className="divide-y divide-[rgba(255,255,255,0.05)] text-xs font-mono">
            {vehicles.map((v) => {
              const diffMs = new Date(v.nextService).getTime() - Date.now();
              const daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
              const isUrgent = daysRemaining < 10;
              return (
                <div key={v.id} className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center space-x-1.5">
                      <span className="text-[12px] font-bold text-white">{v.plate}</span>
                      <span className="text-[8px] bg-black/40 text-slate-400 px-1 py-0.5 rounded uppercase">{v.make} {v.model}</span>
                    </div>
                    <div className="flex space-x-4 text-[10px] text-slate-500">
                      <span>Last Service: {v.lastService}</span>
                      <span>Next Schedule: {v.nextService}</span>
                    </div>
                  </div>

                  <div className="flex items-center space-x-4">
                    <div className="text-right">
                      <span className={`text-[12px] font-bold font-mono ${isUrgent ? 'text-[var(--color-error)]' : 'text-[var(--color-success)]'}`}>
                        {daysRemaining} Days
                      </span>
                      <span className="text-[8px] text-slate-500 uppercase tracking-widest block font-mono">Remaining</span>
                    </div>

                    <button 
                      onClick={() => {
                        const today = new Date().toISOString().split('T')[0];
                        const next = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                        setVehicles(prev => prev.map(item => item.id === v.id ? { ...item, lastService: today, nextService: next } : item));
                        alert(`Vehicle ${v.plate} marked as fully serviced! Last serviced record updated to ${today}.`);
                      }}
                      className="bg-[var(--color-success)] hover:bg-emerald-600 text-[var(--color-obsidian)] text-[9px] uppercase font-black px-3 py-1.5 rounded cursor-pointer"
                    >
                      Log Service Completed
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {activeTab === 'fuel' && (
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
          {/* Fuel Entry Log Form */}
          <form onSubmit={handleLogFuel} className="bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.05)] rounded-xl p-4 md:col-span-4 h-max space-y-4">
            <div className="text-[10px] font-mono text-[var(--color-accent-amber)] tracking-wider uppercase">Log Fuel Consumption</div>

            <div className="space-y-1">
              <label className="text-[9px] font-mono text-[var(--color-muted)] uppercase">Select Vehicle</label>
              <select 
                value={selectedPlate}
                onChange={(e) => setSelectedPlate(e.target.value)}
                className="w-full bg-black/40 border border-[rgba(255,255,255,0.1)] rounded p-2 text-xs focus:outline-none focus:border-[var(--color-accent-amber)]"
              >
                {vehicles.map(v => (
                  <option key={v.id} value={v.plate}>{v.plate} ({v.driver})</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[9px] font-mono text-[var(--color-muted)] uppercase">Litres Count</label>
                <input 
                  type="number"
                  placeholder="e.g. 45"
                  value={litres}
                  onChange={(e) => setLitres(e.target.value)}
                  className="w-full bg-black/40 border border-[rgba(255,255,255,0.1)] rounded p-2 text-xs focus:outline-none focus:border-[var(--color-accent-amber)]"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-mono text-[var(--color-muted)] uppercase">Rate/L (₦)</label>
                <input 
                  type="number"
                  placeholder="e.g. 850"
                  value={costPrLitre}
                  onChange={(e) => setCostPrLitre(e.target.value)}
                  className="w-full bg-black/40 border border-[rgba(255,255,255,0.1)] rounded p-2 text-xs focus:outline-none focus:border-[var(--color-accent-amber)]"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[9px] font-mono text-[var(--color-muted)] uppercase">Filling Station Info</label>
              <input 
                type="text"
                placeholder="e.g. Bovas Ikeja"
                value={stationName}
                onChange={(e) => setStationName(e.target.value)}
                className="w-full bg-black/40 border border-[rgba(255,255,255,0.1)] rounded p-2 text-xs focus:outline-none focus:border-[var(--color-accent-amber)]"
              />
            </div>

            <button 
              type="submit"
              className="w-full py-2.5 bg-[var(--color-accent-amber)] hover:bg-amber-600 text-[var(--color-obsidian)] text-[10px] font-bold font-mono uppercase rounded cursor-pointer"
            >
              SAVE FUEL LOG
            </button>
          </form>

          {/* Historical Log list */}
          <div className="bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.05)] rounded-xl md:col-span-8 overflow-hidden">
            <div className="p-3 border-b border-[rgba(255,255,255,0.05)] bg-[rgba(255,255,255,0.02)] flex justify-between items-center">
              <span className="text-[10px] font-mono text-white uppercase tracking-wider font-bold">Historical Fuel Expenditures</span>
              <span className="text-[9px] text-[var(--color-muted)] font-mono uppercase">Fleet records</span>
            </div>

            <div className="divide-y divide-[rgba(255,255,255,0.05)] text-xs font-mono">
              {fuelLogs.map((log) => (
                <div key={log.id} className="p-3.5 flex justify-between items-center hover:bg-black/10">
                  <div className="space-y-1">
                    <div className="flex items-center space-x-1.5">
                      <span className="text-[12px] font-bold text-white">{log.plate}</span>
                      <span className="text-[8px] bg-amber-500/10 text-[var(--color-accent-amber)] px-1 py-0.5 rounded uppercase">{log.id}</span>
                    </div>
                    <div className="flex space-x-4 text-[10px] text-slate-500">
                      <span>Station: {log.station}</span>
                      <span>Date: {log.date}</span>
                    </div>
                  </div>

                  <div className="text-right space-y-0.5">
                    <span className="text-[12px] font-bold text-[var(--color-success)] block">{fmt(log.litres * log.costPerLitre)}</span>
                    <span className="text-[8.5px] text-slate-400 block">{log.litres}L @ ₦{log.costPerLitre}/L</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Add Vehicle Modal Overlay */}
      {showAddVehicleModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 z-55">
          <div className="bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.1)] rounded-xl max-w-sm w-full overflow-hidden shadow-2xl">
            <div className="p-4 border-b border-[rgba(255,255,255,0.07)] flex justify-between items-center bg-black/40">
              <span className="text-[10px] font-mono text-[var(--color-accent-amber)] uppercase font-bold tracking-wider">ADD VEHICLE TO FLEET</span>
              <button onClick={() => setShowAddVehicleModal(false)} className="text-slate-400 hover:text-white font-mono text-xs cursor-pointer">✕</button>
            </div>

            <form onSubmit={handleAddVehicle} className="p-4 space-y-4">
              <div className="space-y-1">
                <label className="text-[8px] font-mono text-[var(--color-muted)] uppercase">Vehicle Type</label>
                <select 
                  value={type} 
                  onChange={(e) => setType(e.target.value)}
                  className="w-full bg-[var(--color-obsidian)] border border-[var(--color-border-strong)] p-2 rounded text-xs text-white"
                >
                  <option value="Van">Van Delivery</option>
                  <option value="Truck">Truck Logistic Trailer</option>
                  <option value="Pickup">Pickup Dispatch</option>
                  <option value="Bus">Passenger Bus</option>
                  <option value="Motorcycle">Motorcycle Delivery</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[8px] font-mono text-[var(--color-muted)] uppercase">Plate Number</label>
                  <input 
                    type="text" 
                    placeholder="e.g. LAG-404AA"
                    required
                    value={plate}
                    onChange={(e) => setPlate(e.target.value)}
                    className="w-full bg-[var(--color-obsidian)] border border-[rgba(255,255,255,0.12)] p-2 rounded text-xs text-white uppercase placeholder-slate-600"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[8px] font-mono text-[var(--color-muted)] uppercase">Load Limit (KG)</label>
                  <input 
                    type="number" 
                    placeholder="e.g. 1500"
                    required
                    value={capacity}
                    onChange={(e) => setCapacity(e.target.value)}
                    className="w-full bg-[var(--color-obsidian)] border border-[rgba(255,255,255,0.12)] p-2 rounded text-xs text-white placeholder-slate-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[8px] font-mono text-[var(--color-muted)] uppercase">Manufacturer Make</label>
                  <input 
                    type="text" 
                    placeholder="e.g. Toyota"
                    required
                    value={make}
                    onChange={(e) => setMake(e.target.value)}
                    className="w-full bg-[var(--color-obsidian)] border border-[rgba(255,255,255,0.12)] p-2 rounded text-xs text-white placeholder-slate-600"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[8px] font-mono text-[var(--color-muted)] uppercase">Model Series</label>
                  <input 
                    type="text" 
                    placeholder="e.g. Hiace"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    className="w-full bg-[var(--color-obsidian)] border border-[rgba(255,255,255,0.12)] p-2 rounded text-xs text-white placeholder-slate-600"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[8px] font-mono text-[var(--color-muted)] uppercase">Default Driver Name</label>
                <input 
                  type="text" 
                  placeholder="e.g. Driver Tunde"
                  value={driver}
                  onChange={(e) => setDriver(e.target.value)}
                  className="w-full bg-[var(--color-obsidian)] border border-[rgba(255,255,255,0.12)] p-2 rounded text-xs text-white placeholder-slate-600"
                />
              </div>

              <div className="flex space-x-2 pt-2">
                <button 
                  type="submit"
                  className="flex-1 bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] font-mono text-[10px] font-bold uppercase py-2.5 rounded hover:bg-amber-600 cursor-pointer"
                >
                  Confirm Addition
                </button>
                <button 
                  type="button"
                  onClick={() => setShowAddVehicleModal(false)}
                  className="bg-neutral-800 text-slate-300 font-mono text-[10px] font-bold uppercase px-4 rounded hover:bg-neutral-700 cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
