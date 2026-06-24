import { useState, useEffect } from 'react';
import { ArrowLeft, Percent, Save, Building2 } from 'lucide-react';

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
    }
  }, []);

  const handleChange = (airline: string, value: string) => {
    setCommissions(prev => ({ ...prev, [airline]: value }));
  };

  const handleSave = () => {
    const parsedToNum: Record<string, number> = {};
    Object.entries(commissions).forEach(([k, v]) => {
      parsedToNum[k] = parseFloat(v) || 0;
    });
    localStorage.setItem('ehi_airline_commissions', JSON.stringify(parsedToNum));
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
        {Object.entries(commissions).map(([airline, rate]) => (
          <div key={airline} className="ehi-card p-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
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
                className="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-lg py-2 pl-3 pr-8 text-[13px] font-mono text-right text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)] transition-colors"
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
