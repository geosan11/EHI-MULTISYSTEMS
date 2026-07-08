import { useState, useEffect } from 'react';
import { fetchProofOfDeliveryRecords } from '../../lib/sync';
import { ProofOfDelivery, User } from '../../lib/types';
import { ShieldCheck, MapPin, Search, Calendar, ChevronRight, RefreshCw, X, ArrowLeft } from 'lucide-react';
import { EmptyState } from './EmptyState';

export const PODLog = ({ user, onBack }: { user: User; onBack: () => void }) => {
  const [pods, setPods] = useState<ProofOfDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [selectedPod, setSelectedPod] = useState<ProofOfDelivery | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const isAdmin = ['super_admin', 'admin'].includes(user.role);

  const fetchPods = async () => {
    setLoading(true);
    setFetchError(false);
    try {
      const data = await fetchProofOfDeliveryRecords(user.hub, isAdmin);
      setPods(data);
    } catch (err) {
      console.error(err);
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPods();
  }, []);

  const filteredPods = pods.filter(p => 
    p.awbNumber.toLowerCase().includes(searchTerm.toLowerCase()) || 
    p.receivedByName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.consigneeName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="animate-in fade-in">
      <div className="ehi-page-body px-4 pt-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-[var(--color-border)] pb-3">
        <button onClick={onBack} aria-label="Back" className="p-1 rounded hover:bg-[var(--color-surface-2)] text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors cursor-pointer border-none bg-transparent">
          <ArrowLeft size={18} />
        </button>
        <div>
          <div className="text-[9px] font-mono text-[var(--color-muted)] tracking-[0.12em] uppercase">▸ PROOF OF DELIVERY LOG</div>
          <div className="text-[12px] font-bold text-[var(--color-foreground)] tracking-wide mt-0.5">Secure Evidence</div>
        </div>
      </div>

      {/* Search & Actions */}
      <div className="flex gap-2 items-center">
        <div className="flex-1 relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)]" />
          <input
            type="text"
            placeholder="Search AWB, Consignee, Receiver..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full h-11 pl-9 pr-3 ehi-card text-[12px] font-mono text-[var(--color-input-text)] focus:outline-none focus:border-[var(--color-accent-amber)] transition-colors"
          />
        </div>
        <button
          onClick={fetchPods}
          aria-label="Refresh"
          className="h-11 px-4 ehi-card flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors cursor-pointer"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* List */}
      <div className="flex flex-col gap-2">
        {loading ? (
          <div className="text-center py-10 text-[var(--color-muted)] font-mono text-[11px] flex flex-col items-center">
            <RefreshCw size={24} className="animate-spin mb-4" />
            Loading records...
          </div>
        ) : fetchError ? (
          <EmptyState
            icon={<ShieldCheck size={36} strokeWidth={1.5} />}
            title="Couldn't load delivery records"
            subtext="Check your connection and try again."
            actions={[{ label: 'Retry', onClick: fetchPods }]}
          />
        ) : filteredPods.length === 0 ? (
          <EmptyState icon={<ShieldCheck size={36} strokeWidth={1.5} />} message="No proof of delivery records found." />
        ) : (
          filteredPods.map(pod => (
            <div 
              key={pod.id}
              onClick={() => setSelectedPod(pod)}
              className="ehi-card p-3 flex items-center justify-between cursor-pointer hover:border-[var(--color-muted)] transition-colors group"
            >
              <div className="flex items-start gap-3 min-w-0">
                <div className="p-2 bg-[rgba(16,185,129,0.1)] rounded-lg text-[var(--color-success)] shrink-0">
                  <ShieldCheck size={18} />
                </div>
                <div className="min-w-0 flex flex-col items-start gap-1">
                  <div className="text-[12px] font-bold text-[var(--color-foreground)] uppercase font-mono">{pod.awbNumber}</div>
                  <div className="text-[10px] text-[var(--color-light-muted)] truncate block whitespace-nowrap overflow-hidden max-w-[190px]">
                    <span className="opacity-70">To:</span> {pod.receivedByName}
                  </div>
                  <div className="text-[9px] font-mono text-[var(--color-muted)] flex items-center gap-1.5 mt-0.5">
                    <Calendar size={10} /> {new Date(pod.deliveredAt).toLocaleDateString('en-NG')} {new Date(pod.deliveredAt).toLocaleTimeString('en-NG', {hour: '2-digit', minute:'2-digit'})}
                  </div>
                </div>
              </div>
              <ChevronRight size={16} className="text-[var(--color-muted)] group-hover:text-[var(--color-foreground)] transition-colors shrink-0" />
            </div>
          ))
        )}
      </div>

      {/* Modal */}
      {selectedPod && (
        <div className="fixed inset-0 z-[60] bg-black/90 flex flex-col items-center justify-start p-4 overflow-y-auto">
          <div className="w-full max-w-lg bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-strong)] relative flex flex-col overflow-hidden mb-10 shadow-2xl">
            {/* Modal Header */}
            <div className="p-4 border-b border-[var(--color-border)] bg-[rgba(0,0,0,0.4)] flex justify-between items-center sticky top-0 z-10 backdrop-blur-md">
              <div className="flex items-center gap-2">
                <ShieldCheck size={18} className="text-[var(--color-success)]" />
                <h3 className="text-[12px] font-bold text-[var(--color-foreground)] uppercase font-mono">Proof of Delivery</h3>
              </div>
              <button
                onClick={() => setSelectedPod(null)}
                aria-label="Close"
                className="p-1.5 bg-[var(--color-surface-2)] rounded hover:bg-white/10 text-[var(--color-muted)] cursor-pointer transition-colors border-none"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-5 flex flex-col gap-5">
              {/* Primary info */}
              <div className="bg-[var(--color-surface-2)] rounded-lg p-3 border border-[var(--color-border)] border-l-2 border-l-[var(--color-success)]">
                <div className="text-[10px] text-[var(--color-muted)] font-mono uppercase mb-1">AWB Number</div>
                <div className="text-[16px] font-bold font-mono text-[var(--color-foreground)] mb-3">{selectedPod.awbNumber}</div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-[9px] text-[var(--color-muted)] font-mono uppercase">Delivery Hub</div>
                    <div className="text-[11px] font-bold text-[var(--color-light-muted)] mt-0.5">{selectedPod.hubName}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-[var(--color-muted)] font-mono uppercase">Date / Time</div>
                    <div className="text-[11px] font-bold text-[var(--color-light-muted)] mt-0.5">{new Date(selectedPod.deliveredAt).toLocaleString('en-NG')}</div>
                  </div>
                </div>
              </div>

              {/* Recipient info */}
              <div>
                <h4 className="text-[10px] font-mono text-[var(--color-muted)] uppercase tracking-widest border-b border-[var(--color-border)] pb-1 mb-2">Recipient Details</h4>
                <div className="bg-[rgba(255,255,255,0.02)] p-3 rounded-lg flex flex-col gap-3 text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-[var(--color-muted)]">Consignee Name:</span>
                    <span className="font-bold text-[var(--color-light-muted)] text-right">{selectedPod.consigneeName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--color-muted)]">Received By:</span>
                    <span className="font-bold text-[var(--color-foreground)] text-right">{selectedPod.receivedByName}</span>
                  </div>
                  {selectedPod.receivedByPhone && (
                    <div className="flex justify-between">
                      <span className="text-[var(--color-muted)]">Contact Phone:</span>
                      <span className="font-bold text-[var(--color-light-muted)] text-right">{selectedPod.receivedByPhone}</span>
                    </div>
                  )}
                  {selectedPod.receivedByIdType && (
                    <div className="flex justify-between border-t border-[var(--color-border)] pt-2 mt-1">
                      <span className="text-[var(--color-muted)]">Verified ID:</span>
                      <div className="text-right">
                        <div className="font-bold text-[var(--color-accent-amber)]">{selectedPod.receivedByIdType}</div>
                        <div className="text-[10px] font-mono opacity-80">{selectedPod.receivedByIdNumber}</div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Staff & GPS */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-[rgba(255,255,255,0.02)] p-2.5 rounded-lg">
                  <div className="text-[9px] text-[var(--color-muted)] font-mono uppercase">Handling Staff</div>
                  <div className="text-[11px] font-bold font-sans mt-0.5">{selectedPod.deliveredBy}</div>
                </div>
                <div className="bg-[rgba(255,255,255,0.02)] p-2.5 rounded-lg flex justify-between items-center group">
                  <div>
                    <div className="text-[9px] text-[var(--color-muted)] font-mono uppercase">GPS Trace</div>
                    {selectedPod.gpsLatitude ? (
                      <div className="text-[9px] font-mono text-[var(--color-success)] mt-0.5">Recorded</div>
                    ) : (
                      <div className="text-[9px] font-mono text-[var(--color-error)] mt-0.5">Not Available</div>
                    )}
                  </div>
                  {selectedPod.gpsLatitude && selectedPod.gpsLongitude && (
                    <a 
                      href={`https://maps.google.com/?q=${selectedPod.gpsLatitude},${selectedPod.gpsLongitude}`} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="p-1.5 bg-[var(--color-surface-2)] group-hover:bg-[var(--color-accent-cobalt)] group-hover:text-[var(--color-foreground)] rounded text-[var(--color-muted)] transition-colors"
                    >
                      <MapPin size={14} />
                    </a>
                  )}
                </div>
              </div>

              {/* Images */}
              <div className="flex flex-col gap-4 border-t border-[var(--color-border)] pt-4">
                <div>
                  <h4 className="text-[10px] font-mono text-[var(--color-muted)] uppercase tracking-widest mb-2">Recipient Signature</h4>
                  <div className="bg-white rounded-lg p-2 border border-[var(--color-border)] overflow-hidden flex justify-center items-center h-[120px]">
                    <img src={selectedPod.signatureData} alt="Signature" className="max-h-full object-contain" />
                  </div>
                </div>

                {selectedPod.photoData && (
                  <div>
                    <h4 className="text-[10px] font-mono text-[var(--color-muted)] uppercase tracking-widest mb-2">Photo Evidence</h4>
                    <div className="bg-black rounded-lg border border-[var(--color-border)] overflow-hidden h-[200px]">
                      <img src={selectedPod.photoData} alt="Photo Proof" className="w-full h-full object-cover" />
                    </div>
                  </div>
                )}
              </div>

              {/* Notes */}
              {selectedPod.notes && (
                <div className="mt-2 bg-[rgba(245,158,11,0.05)] border border-[rgba(245,158,11,0.2)] rounded-lg p-3">
                  <div className="text-[9px] font-mono text-[var(--color-accent-amber)] uppercase font-bold mb-1">Notes / Remarks</div>
                  <div className="text-[11px] text-[var(--color-light-muted)] italic leading-relaxed">{selectedPod.notes}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      </div>{/* end ehi-page-body */}
    </div>
  );
};
