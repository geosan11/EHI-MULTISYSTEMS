import React, { useState } from 'react';
import { ArrowLeft, ShieldAlert, CheckCircle, RefreshCcw, Eye, Search, AlertOctagon } from 'lucide-react';
import { fmt } from '../../lib/helpers';

interface FraudAlert {
  id: string;
  type: 'duplicate_awb' | 'unusual_amount' | 'debt_spike' | 'rapid_entries' | 'suspicious_pattern';
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  relatedId: string;
  time: string;
  reviewed: boolean;
  resolution?: string;
}

export const FraudAlerts = ({ 
  onBack 
}: { 
  onBack: () => void;
}) => {
  const [activeTab, setActiveTab] = useState<'pending' | 'reviewed'>('pending');
  const [selectedAlert, setSelectedAlert] = useState<FraudAlert | null>(null);
  const [resolutionText, setResolutionText] = useState('');
  
  // Real-time seed fraud alerts (Rule-based & AI-based logs)
  const [alerts, setAlerts] = useState<FraudAlert[]>([
    { id: 'FR-101', type: 'duplicate_awb', severity: 'critical', title: 'Duplicate Airway Bill Input', description: 'AWB tag tracking number 18002 was submitted twice by Lagos HQ and Abuja Station within 8 minutes.', relatedId: 'AC-18002', time: '10 mins ago', reviewed: false },
    { id: 'FR-102', type: 'debt_spike', severity: 'high', title: 'Rapid Debt Limit Violation', description: 'Consignee Madame Lily total outstanding uncollected debt balances sum up to ₦620,000, violating terminal alert threshold (₦50,050).', relatedId: 'MK-240619-M112', time: '35 mins ago', reviewed: false },
    { id: 'FR-103', type: 'unusual_amount', severity: 'medium', title: 'Aesthetic Cargo Rate Deviation', description: 'Amount recorded (₦95,000) for Parcels shipment of weight 12KG is significantly inflated compared to standard pricing grid.', relatedId: 'WB-240619-A3F1', time: '2 hours ago', reviewed: false },
    { id: 'FR-104', type: 'suspicious_pattern', severity: 'high', title: '[AI Insight] Abnormal Entry Volatility', description: 'Agent logged 32 ValueJet tags within 45 minutes from same POS terminal. High probability of bulk baggage ledger manipulation.', relatedId: 'VJ-BATCH', time: '5 hours ago', reviewed: false },
    { id: 'FR-105', type: 'rapid_entries', severity: 'low', title: 'Over-speed Entry Checklist', description: 'Cargo ledger registered 12 distinct entries under 180 seconds on terminal C-14.', relatedId: 'TX-FAST', time: 'Yesterday', reviewed: true, resolution: 'Confirmed manual bulk backlog clearance by Lead Accountant.' }
  ]);

  const handleReviewAlert = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAlert) return;

    setAlerts(prev => prev.map(a => {
      if (a.id === selectedAlert.id) {
        return {
          ...a,
          reviewed: true,
          resolution: resolutionText || 'Manually evaluated and checked.'
        };
      }
      return a;
    }));

    setSelectedAlert(null);
    setResolutionText('');
  };

  const handleDismissAll = () => {
    if (confirm('Resolve all pending fraud alarms? This logs blank administrative overrides.')) {
      setAlerts(prev => prev.map(a => ({ ...a, reviewed: true, resolution: 'Batch resolved by Super Administrator' })));
    }
  };

  const pendingAlerts = alerts.filter(a => !a.reviewed);
  const reviewedAlerts = alerts.filter(a => a.reviewed);

  return (
    <div className="flex flex-col h-full bg-[var(--color-obsidian)] p-4 text-[var(--color-foreground)] overflow-y-auto pb-[80px] font-sans">
      {/* Header back navigation */}
      <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-2 mb-4">
        <button onClick={onBack} className="flex items-center space-x-1 text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors">
          <ArrowLeft size={16} />
          <span className="text-[11px] font-mono">Back</span>
        </button>
        <span className="text-[10px] font-mono text-[var(--color-error)] tracking-widest font-bold">● COGNITIVE AUDIT COCKPIT</span>
      </div>

      <div className="flex flex-col sm:flex-row justify-between items-start gap-4 mb-6">
        <div className="space-y-0.5">
          <div className="text-[9px] font-mono text-slate-400 tracking-[0.15em] uppercase">▸ COGNITIVE SHIELD PRO v1.1</div>
          <h2 className="text-sm font-black text-[var(--color-foreground)]">Anomalies & Fraud Security Feed</h2>
        </div>

        {pendingAlerts.length > 0 && (
          <button 
            onClick={handleDismissAll}
            className="bg-neutral-800 hover:bg-neutral-750 text-slate-300 font-mono text-[10px] uppercase font-bold px-3 py-1.5 rounded transition-all cursor-pointer"
          >
            Acknowledge All
          </button>
        )}
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-[var(--color-surface-1)] border border-[rgba(239,68,68,0.15)] p-3 rounded-lg flex items-center space-x-3">
          <AlertOctagon size={18} className="text-[var(--color-error)] animate-pulse" />
          <div>
            <span className="text-[8px] font-mono text-slate-400 uppercase block">Active Anomalies</span>
            <span className="text-sm font-mono font-bold text-white block">{pendingAlerts.length}</span>
          </div>
        </div>

        <div className="bg-[var(--color-surface-1)] border border-[rgba(16,185,129,0.1)] p-3 rounded-lg flex items-center space-x-3">
          <CheckCircle size={18} className="text-[var(--color-success)]" />
          <div>
            <span className="text-[8px] font-mono text-slate-400 uppercase block">Reviewed Today</span>
            <span className="text-sm font-mono font-bold text-white block">{reviewedAlerts.length}</span>
          </div>
        </div>

        <div className="bg-[var(--color-surface-1)] border border-[var(--color-border)] p-3 rounded-lg flex items-center space-x-3">
          <RefreshCcw size={16} className="text-[var(--color-accent-cobalt)]" />
          <div>
            <span className="text-[8px] font-mono text-slate-400 uppercase block">Integrations Live</span>
            <span className="text-sm font-mono font-bold text-[var(--color-success)] block">100%</span>
          </div>
        </div>
      </div>

      {/* Segment switcher */}
      <div className="flex border-b border-[rgba(255,255,255,0.05)] mb-4 text-xs font-mono">
        <button 
          onClick={() => setActiveTab('pending')}
          className={`pb-2.5 px-4 font-bold border-b-2 flex items-center space-x-1.5 transition-all cursor-pointer ${
            activeTab === 'pending' ? 'border-[var(--color-error)] text-[var(--color-error)] font-black' : 'border-transparent text-slate-400 hover:text-white'
          }`}
        >
          <span>Unresolved Alarms</span>
          <span className="bg-red-500/10 text-[var(--color-error)] text-[9px] px-1.5 py-0.5 rounded-full font-bold">{pendingAlerts.length}</span>
        </button>

        <button 
          onClick={() => setActiveTab('reviewed')}
          className={`pb-2.5 px-4 font-bold border-b-2 flex items-center space-x-1.5 transition-all cursor-pointer ${
            activeTab === 'reviewed' ? 'border-[var(--color-success)] text-[var(--color-success)]' : 'border-transparent text-slate-400 hover:text-white'
          }`}
        >
          <span>Audit Log Archive</span>
          <span className="bg-emerald-500/10 text-[var(--color-success)] text-[9px] px-1.5 py-0.5 rounded-full font-bold">{reviewedAlerts.length}</span>
        </button>
      </div>

      {/* Log Feed List */}
      <div className="space-y-3">
        {(activeTab === 'pending' ? pendingAlerts : reviewedAlerts).length === 0 ? (
          <div className="py-12 text-center border-2 border-dashed border-[rgba(255,255,255,0.05)] rounded-xl bg-black/10">
            <span className="text-2xl block">🛡️</span>
            <span className="text-xs font-mono text-slate-400 mt-2 block">No matching security entries found</span>
          </div>
        ) : (
          (activeTab === 'pending' ? pendingAlerts : reviewedAlerts).map((alert) => (
            <div 
              key={alert.id}
              className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 transition-all hover:bg-black/10 ${
                alert.severity === 'critical' ? 'bg-[rgba(239,68,68,0.02)] border-red-500/20' :
                alert.severity === 'high' ? 'bg-[rgba(245,158,11,0.02)] border-amber-500/20' :
                'bg-[var(--color-surface-1)] border-[rgba(255,255,255,0.05)]'
              }`}
            >
              <div className="space-y-1.5 flex-1">
                <div className="flex items-center space-x-2">
                  <span className={`text-[8.5px] uppercase font-bold px-2 py-0.5 rounded-md ${
                    alert.severity === 'critical' ? 'bg-red-500/15 text-red-400' :
                    alert.severity === 'high' ? 'bg-amber-500/15 text-amber-400' :
                    'bg-zinc-800 text-zinc-400'
                  }`}>
                    {alert.severity} Risk
                  </span>
                  <span className="text-[8.5px] font-mono text-slate-500">{alert.time} &middot; ID: {alert.id}</span>
                </div>

                <div className="space-y-0.5">
                  <h4 className="text-[13px] font-bold text-white block">{alert.title}</h4>
                  <p className="text-[11.5px] text-slate-400 leading-relaxed font-mono">{alert.description}</p>
                </div>

                {alert.reviewed && alert.resolution && (
                  <div className="p-2.5 bg-black/30 rounded border border-[rgba(16,185,129,0.1)] text-[10px] text-[var(--color-success)] font-mono mt-2">
                    <span className="font-bold uppercase text-[8.5px] block mb-0.5">AUDITED RESOLUTION CHECK:</span>
                    {alert.resolution}
                  </div>
                )}
              </div>

              {!alert.reviewed && (
                <button 
                  onClick={() => setSelectedAlert(alert)}
                  className="bg-neutral-800 hover:bg-neutral-700 text-slate-300 hover:text-white font-mono text-[9px] uppercase font-bold px-3 py-2 rounded flex items-center space-x-1 cursor-pointer self-start sm:self-center"
                >
                  <Eye size={12} />
                  <span>Log Resolution</span>
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {/* Evaluation Log Modals */}
      {selectedAlert && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 z-55">
          <div className="bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.1)] rounded-xl max-w-sm w-full overflow-hidden shadow-2xl">
            <div className="p-4 border-b border-[rgba(255,255,255,0.07)] flex justify-between items-center bg-black/40">
              <span className="text-[9px] font-mono text-[var(--color-error)] uppercase font-bold tracking-wider">SECURE SECURITY ANOMALY EVALUATION</span>
              <button onClick={() => setSelectedAlert(null)} className="text-slate-400 hover:text-white font-mono text-xs cursor-pointer">✕</button>
            </div>

            <form onSubmit={handleReviewAlert} className="p-4 space-y-4 font-mono text-xs">
              <div className="space-y-1">
                <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest block">Anomaly Threat description:</span>
                <p className="text-slate-300 leading-relaxed bg-black/20 p-2.5 rounded border border-solid border-[rgba(255,255,255,0.03)] text-[11px]">{selectedAlert.description}</p>
              </div>

              <div className="space-y-1">
                <label className="text-[8px] font-bold text-slate-500 uppercase tracking-widest block">RESOLUTION LOG DESCRIPTION</label>
                <textarea 
                  required
                  rows={3}
                  value={resolutionText}
                  onChange={(e) => setResolutionText(e.target.value)}
                  placeholder="e.g. Cleared. Confirmed corresponding bank deposit statement matches duplicated tags series."
                  className="w-full bg-[var(--color-obsidian)] border border-[var(--color-border-strong)] p-2 rounded text-[11px] font-mono text-white placeholder-slate-600 focus:outline-none focus:border-[var(--color-error)]"
                />
              </div>

              <div className="flex space-x-2 pt-2">
                <button 
                  type="submit"
                  className="flex-1 bg-[var(--color-error)] text-white font-mono text-[10px] font-bold uppercase py-2.5 rounded hover:bg-red-650 cursor-pointer"
                >
                  Confirm Audited Override
                </button>
                <button 
                  type="button"
                  onClick={() => setSelectedAlert(null)}
                  className="bg-neutral-800 text-slate-300 font-mono text-[10px] uppercase font-bold px-4 rounded hover:bg-neutral-700 cursor-pointer"
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
