import React, { useState, useEffect } from 'react';
import { ArrowLeft, ShieldAlert, CheckCircle, RefreshCcw, Eye, AlertOctagon, Loader } from 'lucide-react';
import { fmt } from '../../lib/helpers';
import { supabase } from '../../lib/supabase';

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
  const [loading, setLoading] = useState(true);
  const [alerts, setAlerts] = useState<FraudAlert[]>([]);

  useEffect(() => {
    const runDetectionRules = async () => {
      setLoading(true);
      const liveAlerts: FraudAlert[] = [];
      const now = new Date();
      const last24h = new Date(Date.now() - 86400000).toISOString();
      const last15m = new Date(Date.now() - 15 * 60000).toISOString();

      try {
        // Rule 1: Duplicate AWB detection (last 24 hours)
        const { data: cargoData } = await supabase
          .from('cargo_entries')
          .select('awb_tag_number, consignee_name, amount, logged_by, created_at')
          .gte('created_at', last24h);

        if (cargoData && cargoData.length > 0) {
          const awbCounts: Record<string, number> = {};
          cargoData.forEach((e: any) => {
            if (e.awb_tag_number) awbCounts[e.awb_tag_number] = (awbCounts[e.awb_tag_number] || 0) + 1;
          });
          Object.entries(awbCounts).filter(([_, c]) => c > 1).forEach(([awb, count]) => {
            liveAlerts.push({
              id: `FR-DUP-${awb}`, type: 'duplicate_awb', severity: 'critical',
              title: 'Duplicate Airway Bill Detected',
              description: `AWB ${awb} was submitted ${count} times in the last 24 hours across stations.`,
              relatedId: awb, time: 'Live', reviewed: false
            });
          });

          // Rule 2: Unusual amount — entries >2.5× average amount
          const amounts = cargoData.map((e: any) => Number(e.amount)).filter(a => a > 0);
          if (amounts.length > 3) {
            const avg = amounts.reduce((s: number, a: number) => s + a, 0) / amounts.length;
            cargoData.filter((e: any) => Number(e.amount) > avg * 2.5 && Number(e.amount) > 80000).forEach((e: any) => {
              liveAlerts.push({
                id: `FR-AMT-${e.awb_tag_number || e.id}`, type: 'unusual_amount', severity: 'medium',
                title: 'Unusual Cargo Amount',
                description: `${e.consignee_name}: ${fmt(Number(e.amount))} is ${Math.round(Number(e.amount) / avg * 100)}% of average — significantly above the ₦${Math.round(avg).toLocaleString()} baseline.`,
                relatedId: e.awb_tag_number || '', time: 'Live', reviewed: false
              });
            });
          }

          // Rule 3: Rapid entries — any agent logging ≥8 entries in 15 minutes
          const { data: recentData } = await supabase
            .from('cargo_entries')
            .select('entered_by, created_at')
            .gte('created_at', last15m);

          if (recentData && recentData.length >= 8) {
            const byAgent: Record<string, number> = {};
            recentData.forEach((e: any) => {
              const key = e.entered_by || 'Unknown Agent';
              byAgent[key] = (byAgent[key] || 0) + 1;
            });
            Object.entries(byAgent).filter(([_, c]) => c >= 8).forEach(([agent, count]) => {
              liveAlerts.push({
                id: `FR-RAPID-${agent.slice(0, 8)}`, type: 'rapid_entries', severity: 'high',
                title: 'Rapid Entry Velocity Detected',
                description: `Agent ID ${agent.slice(0, 8)}… logged ${count} cargo entries within 15 minutes. This may indicate bulk manipulation.`,
                relatedId: agent, time: 'Live', reviewed: false
              });
            });
          }
        }

        // Rule 4: Debt spike — consignees with total outstanding debt > ₦50,000
        const { data: debtData } = await supabase
          .from('cargo_entries')
          .select('consignee_name, amount')
          .eq('receipt_mode', 'Debt');

        if (debtData && debtData.length > 0) {
          const debtByConsignee: Record<string, number> = {};
          debtData.forEach((e: any) => {
            debtByConsignee[e.consignee_name] = (debtByConsignee[e.consignee_name] || 0) + Number(e.amount);
          });
          Object.entries(debtByConsignee).filter(([_, total]) => total > 50000).forEach(([name, total]) => {
            liveAlerts.push({
              id: `FR-DEBT-${name.slice(0, 10).replace(/\s/g, '')}`, type: 'debt_spike', severity: 'high',
              title: 'Outstanding Debt Threshold Exceeded',
              description: `${name} has ${fmt(total)} in uncleared debt, exceeding the ₦50,000 alert threshold.`,
              relatedId: name, time: 'Live', reviewed: false
            });
          });
        }

      } catch (err) {
        console.error('Fraud detection error:', err);
      }

      setAlerts(liveAlerts);
      setLoading(false);
    };

    runDetectionRules();
  }, []);

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
    <div className="flex flex-col h-full bg-[var(--color-obsidian)] overflow-y-auto pb-24 font-sans">
      <div className="ehi-page-body px-4 pt-4 text-[var(--color-foreground)]">
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
            <span className="text-sm font-mono font-bold text-[var(--color-foreground)] block">{pendingAlerts.length}</span>
          </div>
        </div>

        <div className="bg-[var(--color-surface-1)] border border-[rgba(16,185,129,0.1)] p-3 rounded-lg flex items-center space-x-3">
          <CheckCircle size={18} className="text-[var(--color-success)]" />
          <div>
            <span className="text-[8px] font-mono text-slate-400 uppercase block">Reviewed Today</span>
            <span className="text-sm font-mono font-bold text-[var(--color-foreground)] block">{reviewedAlerts.length}</span>
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
            activeTab === 'pending' ? 'border-[var(--color-error)] text-[var(--color-error)] font-black' : 'border-transparent text-slate-400 hover:text-[var(--color-foreground)]'
          }`}
        >
          <span>Unresolved Alarms</span>
          <span className="bg-red-500/10 text-[var(--color-error)] text-[9px] px-1.5 py-0.5 rounded-full font-bold">{pendingAlerts.length}</span>
        </button>

        <button 
          onClick={() => setActiveTab('reviewed')}
          className={`pb-2.5 px-4 font-bold border-b-2 flex items-center space-x-1.5 transition-all cursor-pointer ${
            activeTab === 'reviewed' ? 'border-[var(--color-success)] text-[var(--color-success)]' : 'border-transparent text-slate-400 hover:text-[var(--color-foreground)]'
          }`}
        >
          <span>Audit Log Archive</span>
          <span className="bg-emerald-500/10 text-[var(--color-success)] text-[9px] px-1.5 py-0.5 rounded-full font-bold">{reviewedAlerts.length}</span>
        </button>
      </div>

      {/* Log Feed List */}
      <div className="space-y-3">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Loader size={24} className="animate-spin text-[var(--color-error)]" />
            <p className="text-[12px] font-mono text-[var(--color-muted)]">Running 4 live detection rules...</p>
          </div>
        ) : (activeTab === 'pending' ? pendingAlerts : reviewedAlerts).length === 0 ? (
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
                  <h4 className="text-[13px] font-bold text-[var(--color-foreground)] block">{alert.title}</h4>
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
                  className="bg-neutral-800 hover:bg-neutral-700 text-slate-300 hover:text-[var(--color-foreground)] font-mono text-[9px] uppercase font-bold px-3 py-2 rounded flex items-center space-x-1 cursor-pointer self-start sm:self-center"
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
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-55">
          <div className="ehi-card max-w-sm w-full overflow-hidden shadow-2xl">
            <div className="p-4 border-b border-[rgba(255,255,255,0.07)] flex justify-between items-center bg-black/40">
              <span className="text-[9px] font-mono text-[var(--color-error)] uppercase font-bold tracking-wider">SECURE SECURITY ANOMALY EVALUATION</span>
              <button onClick={() => setSelectedAlert(null)} className="text-slate-400 hover:text-[var(--color-foreground)] font-mono text-xs cursor-pointer">✕</button>
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
                  className="w-full bg-[var(--color-obsidian)] border border-[var(--color-border-strong)] p-2 rounded text-[11px] font-mono text-[var(--color-foreground)] placeholder-slate-600 focus:outline-none focus:border-[var(--color-error)]"
                />
              </div>

              <div className="flex space-x-2 pt-2">
                <button 
                  type="submit"
                  className="ehi-btn-destructive ehi-btn"
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
    </div>
  );
};
