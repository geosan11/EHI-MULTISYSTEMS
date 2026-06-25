import { useState, useEffect } from 'react';
import { ArrowLeft, Percent, Save, Building2, Plus, Trash2 } from 'lucide-react';

export const AirlineCommissions = ({ onBack }: { onBack: () => void }) => {
  const [commissions, setCommissions] = useState<Record<string, string>>({
    'ValueJet': '10',
    'Ibom Air': '5',
    'Air Peace': '5',
    'Arik': '5',
    'Green Africa': '5',
    'United Nigeria': '5',
    'OTHER': '5'
  });
  
  const [newAirline, setNewAirline] = useState('');
  const [newCommission, setNewCommission] = useState('5');

  useEffect(() => {
    const saved = localStorage.getItem('ehi_airline_commissions');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        const strParsed: Record<string, string> = {};
        Object.entries(parsed).forEach(([k, v]) => {
          strParsed[k] = String(v);
        });
        setCommissions(prev => ({ ...prev, ...strParsed }));
      } catch (e) {
        // ignore
      }
    } else {
      // Save default on first load
      handleSaveData(commissions);
    }
  }, []);

  const handleSaveData = (data: Record<string, string>) => {
    const parsedToNum: Record<string, number> = {};
    Object.entries(data).forEach(([k, v]) => {
      parsedToNum[k] = parseFloat(v) || 0;
    });
    localStorage.setItem('ehi_airline_commissions', JSON.stringify(parsedToNum));
  };

  const handleChange = (airline: string, value: string) => {
    const updated = { ...commissions, [airline]: value };
    setCommissions(updated);
    handleSaveData(updated);
  };

  const handleAddAirline = () => {
    if (!newAirline.trim()) return;
    const updated = { ...commissions, [newAirline.trim()]: newCommission };
    setCommissions(updated);
    handleSaveData(updated);
    setNewAirline('');
    setNewCommission('5');
  };

  const handleDeleteAirline = (airline: string) => {
    const updated = { ...commissions };
    delete updated[airline];
    setCommissions(updated);
    handleSaveData(updated);
  };

  const handleSave = () => {
    handleSaveData(commissions);
    onBack();
  };

  return (
    <main className="flex-1 flex flex-col h-full bg-[var(--color-bg)] overflow-hidden">
      {/* Header */}
      <div className="bg-[var(--color-surface-card)] border-b border-[var(--color-border)] p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button 
            onClick={onBack}
            className="w-8 h-8 flex items-center justify-center bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)] transition-colors rounded-lg group"
          >
            <ArrowLeft size={16} strokeWidth={1.5} className="text-[var(--color-muted)] group-hover:text-[var(--color-accent-amber)] transition-colors" />
          </button>
          <div>
            <h1 className="text-[16px] font-bold font-sans text-[var(--color-foreground)] tracking-tight">Airline Commissions</h1>
            <p className="text-[11px] font-mono text-[var(--color-muted)] mt-0.5">Set percentage cut per airline</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-lg p-3 mb-4">
          <div className="text-[12px] font-bold font-sans text-[var(--color-foreground)] mb-2">Add New Airline</div>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Airline Name"
              value={newAirline}
              onChange={(e) => setNewAirline(e.target.value)}
              className="flex-1 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-lg py-2 px-3 text-[13px] font-sans text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)] transition-colors"
            />
            <div className="relative w-20">
              <input
                type="number"
                value={newCommission}
                onChange={(e) => setNewCommission(e.target.value)}
                className="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-lg py-2 pl-2 pr-8 text-[13px] font-mono text-right text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)] transition-colors"
                step="0.1"
                min="0"
                max="100"
              />
              <Percent size={12} strokeWidth={1.5} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-muted)] pointer-events-none" />
            </div>
            <button
              onClick={handleAddAirline}
              disabled={!newAirline.trim()}
              className="px-3 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)] disabled:opacity-50 border border-[var(--color-border)] rounded-lg text-[var(--color-foreground)] flex items-center justify-center transition-colors"
            >
              <Plus size={16} strokeWidth={1.5} />
            </button>
          </div>
        </div>

        {Object.entries(commissions).map(([airline, rate]) => (
          <div key={airline} className="ehi-card p-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button 
                onClick={() => handleDeleteAirline(airline)}
                className="p-2 bg-[rgba(239,68,68,0.1)] hover:bg-[rgba(239,68,68,0.2)] rounded-lg text-[var(--color-error)] transition-colors group"
                title={`Remove ${airline}`}
              >
                <Trash2 size={14} strokeWidth={1.5} />
              </button>
              <div className="p-2 bg-[var(--color-surface-2)] rounded-lg">
                <Building2 size={16} strokeWidth={1.5} className="text-[var(--color-muted)]" />
              </div>
              <span className="font-sans font-bold text-[13px] text-[var(--color-foreground)]">{airline}</span>
            </div>
            
            <div className="relative w-24">
              <input
                type="number"
                value={rate}
                onChange={(e) => handleChange(airline, e.target.value)}
                className="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-lg py-2 pl-3 pr-9 text-[13px] font-mono text-right text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)] transition-colors"
                step="0.1"
                min="0"
                max="100"
              />
              <Percent size={12} strokeWidth={1.5} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)] pointer-events-none" />
            </div>
          </div>
        ))}

        <div className="pt-4">
          <button
            onClick={handleSave}
            className="w-full py-3 bg-[rgba(245,158,11,0.1)] hover:bg-[rgba(245,158,11,0.2)] text-[var(--color-accent-amber)] border border-[rgba(245,158,11,0.2)] rounded-lg font-bold font-sans text-[13px] transition-colors flex justify-center items-center gap-2"
          >
            <Save size={16} strokeWidth={1.5} /> Save Settings
          </button>
        </div>
      </div>
    </main>
  );
};
