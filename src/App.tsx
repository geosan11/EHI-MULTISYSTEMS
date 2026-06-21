import { useState, useEffect, useMemo } from 'react';
import { BrowserRouter, Routes, Route, useParams } from 'react-router-dom';
import { LoginScreen } from './components/LoginScreen';
import { EHIApp } from './components/EHIApp';
import { UserProfile, getSession, signOut } from './lib/auth';
import { supabase } from './lib/supabase';
import { Loader2 } from 'lucide-react';

const PublicTrackingPage = () => {
  const { waybillId: routeParam } = useParams();
  const [searchQuery, setSearchQuery] = useState(routeParam || '');
  const [activeRef, setActiveRef] = useState(routeParam || '');

  const simulatedShipment = useMemo(() => {
    if (!activeRef) return null;
    
    // Normalize code representation
    const ref = activeRef.trim().toUpperCase();
    
    // Determine stream prefix/type
    const isCargo = ref.startsWith('CG') || ref.startsWith('AWB');
    const isMarketing = ref.startsWith('MK') || ref.startsWith('MKT');
    
    // Build simulated progressive state
    return {
      ref,
      type: isCargo ? 'Air Cargo' : (isMarketing ? 'Marketing Bag' : 'Package Consignment'),
      origin: isCargo ? 'Lagos Hub (HQ)' : 'Oyinbo Market Hub',
      destination: isCargo ? 'Abuja Airport Depot' : 'Kano Central Terminal',
      status: 'In Transit',
      carrier: 'United Nigeria (UN-240)',
      sender: 'Golden Nest Industrial Ltd',
      recipient: 'Aza Food Distributors',
      weight: isCargo ? '240 KG' : 'Big Bag (BB)',
      pieces: isCargo ? 12 : 3,
      date: '2026-06-20',
      timeline: [
        { title: 'Waybill Issued & Dispatched', status: 'completed', time: '08:30 AM', location: 'Lagos Hub Office' },
        { title: 'Security Screened & Cleared', status: 'completed', time: '10:15 AM', location: 'Murtala Muhammed Cargo Wing' },
        { title: 'Manifested on Flight UN-240', status: 'active', time: '01:45 PM', location: 'In-Transit to Abuja' },
        { title: 'Terminal Destination Handover', status: 'pending', time: 'Estimation 05:00 PM', location: 'Abuja Airport Depot' }
      ]
    };
  }, [activeRef]);

  return (
    <div className="bg-slate-50 text-slate-900 font-sans flex flex-col items-center" style={{ minHeight: '100dvh' }}>
      {/* Branding Header */}
      <header className="w-full max-w-lg bg-white border-b border-slate-200 py-4 px-6 flex items-center justify-between shadow-xs">
        <div className="flex items-center space-x-2">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" />
          <span className="text-sm font-mono tracking-widest font-black text-slate-800">EHI MULTISYSTEMS</span>
        </div>
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Portal v4.1</span>
      </header>

      {/* Main portal stage */}
      <main className="w-full max-w-lg p-6 space-y-6">
        
        {/* Tracking Lookup Box */}
        <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-5 space-y-4">
          <div className="text-center space-y-1">
            <h1 className="text-lg font-extrabold text-slate-900 tracking-tight">Consignment Tracking</h1>
            <p className="text-xs text-slate-500 leading-relaxed">Enter your waybill or marketing bag barcode to trace logistics stream</p>
          </div>

          <div className="flex space-x-2">
            <input 
              type="text"
              placeholder="e.g. CG-98443 or AWB-524"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && setActiveRef(searchQuery)}
              className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 font-mono focus:bg-white"
            />
            <button 
              onClick={() => setActiveRef(searchQuery)}
              className="bg-amber-500 hover:bg-amber-600 text-slate-900 text-xs font-bold font-mono px-4 h-9.5 rounded-lg transition-colors cursor-pointer"
            >
              TRACK
            </button>
          </div>
        </div>

        {/* Tracking Details Page */}
        {simulatedShipment ? (
          <div className="space-y-6 animate-in fade-in duration-300">
            
            {/* Status overview */}
            <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-5 space-y-3">
              <div className="flex justify-between items-start">
                <div>
                  <span className="text-[9px] font-mono font-bold text-slate-400 uppercase tracking-wider block">Waybill Ref</span>
                  <span className="text-base font-mono font-bold text-slate-900 uppercase block">{simulatedShipment.ref}</span>
                </div>
                <span className="bg-amber-100 border border-amber-300 text-amber-800 text-[10px] font-bold font-mono px-2.5 py-1 rounded-full uppercase tracking-wider">
                  {simulatedShipment.status}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4 pt-3 border-t border-slate-100 text-xs">
                <div>
                  <span className="text-[9px] text-slate-400 uppercase tracking-wider font-bold block">Consignment Type</span>
                  <span className="font-semibold text-slate-800 mt-0.5 block">{simulatedShipment.type}</span>
                </div>
                <div>
                  <span className="text-[9px] text-slate-400 uppercase tracking-wider font-bold block">Aviation Carrier</span>
                  <span className="font-semibold text-slate-800 mt-0.5 block">{simulatedShipment.carrier}</span>
                </div>
                <div>
                  <span className="text-[9px] text-slate-400 uppercase tracking-wider font-bold block">Route Path</span>
                  <span className="font-semibold text-slate-800 mt-0.5 block">{simulatedShipment.origin} ▸ {simulatedShipment.destination}</span>
                </div>
                <div>
                  <span className="text-[9px] text-slate-400 uppercase tracking-wider font-bold block">Shipment Payload</span>
                  <span className="font-semibold text-slate-800 mt-0.5 block">{simulatedShipment.weight} ({simulatedShipment.pieces} pcs)</span>
                </div>
              </div>
            </div>

            {/* Timeline progression */}
            <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-5 space-y-4">
              <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider font-bold">Journey Timeline</div>
              
              <div className="relative border-l border-slate-200 pl-5 ml-2.5 space-y-5 py-1">
                {simulatedShipment.timeline.map((step, index) => {
                  const isActive = step.status === 'active';
                  const isCompleted = step.status === 'completed';
                  return (
                    <div key={index} className="relative">
                      {/* Timeline dot */}
                      <span className={`absolute -left-[26px] top-1 w-3 h-3 rounded-full border-2 ${
                        isActive ? 'bg-amber-500 border-amber-500 ring-4 ring-amber-100' :
                        isCompleted ? 'bg-amber-500 border-amber-500' : 'bg-slate-200 border-slate-200'
                      }`} />
                      
                      <div className="space-y-0.5">
                        <div className="flex justify-between items-center text-xs">
                          <span className={`font-bold ${isActive ? 'text-slate-900 font-extrabold' : isCompleted ? 'text-slate-800' : 'text-slate-400'}`}>{step.title}</span>
                          <span className="text-[10px] font-mono text-slate-400">{step.time}</span>
                        </div>
                        <div className="text-[10.5px] text-slate-500 font-mono">{step.location}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

          </div>
        ) : (
          <div className="py-12 text-center space-y-2 border-2 border-dashed border-slate-200 rounded-xl bg-slate-100/50">
            <span className="text-3xl">📦</span>
            <div className="text-xs text-slate-400 font-mono">No active tracking selected</div>
          </div>
        )}

      </main>
    </div>
  );
};

const AuthenticatedApp = () => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    getSession().then((profile) => {
      if (profile) setUser(profile);
      setAuthLoading(false);
    }).catch((err) => {
      console.warn('getSession catch:', err);
      setAuthLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if (!session) {
          setUser(null);
        }
      }
    );
    return () => listener.subscription.unsubscribe();
  }, []);

  if (authLoading) {
    return (
      <div className="bg-[var(--color-obsidian)] flex items-center justify-center" style={{ minHeight: '100dvh' }}>
        <Loader2 className="animate-spin text-[var(--color-accent-amber)]" size={48} />
      </div>
    );
  }

  if (!user) {
    return <LoginScreen onLogin={setUser} />;
  }

  const handleLogout = async () => {
    await signOut();
    setUser(null);
  };

  return <EHIApp user={user} onLogout={handleLogout} />;
};

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/track/:waybillId" element={<PublicTrackingPage />} />
        <Route path="/*" element={<AuthenticatedApp />} />
      </Routes>
    </BrowserRouter>
  );
}

