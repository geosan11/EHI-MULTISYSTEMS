import React, { useState } from 'react';
import { ArrowLeft, Key, Plus, Trash2, Shield, Eye, HelpCircle, Layout } from 'lucide-react';

interface ApiKey {
  id: string;
  label: string;
  prefix: string;
  rawKey?: string;
  permissions: 'read' | 'write' | 'all';
  limit: number;
  lastUsed: string;
  created: string;
}

export const APIDashboard = ({ 
  onBack 
}: { 
  onBack: () => void;
}) => {
  const [keys, setKeys] = useState<ApiKey[]>([
    { id: '1', label: 'Aramex HQ ERP Gateway', prefix: 'ehi_f7a2d8', permissions: 'all', limit: 120, lastUsed: '5 mins ago', created: '2026-06-12' },
    { id: '2', label: 'Globacom Bulk SMS Webhook', prefix: 'ehi_981a3d', permissions: 'read', limit: 60, lastUsed: 'Yesterday', created: '2026-06-15' }
  ]);
  
  const [activeSubTab, setActiveSubTab] = useState<'console' | 'docs'>('console');
  const [showAddKeyModal, setShowAddKeyModal] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newPermissions, setNewPermissions] = useState<'read' | 'write' | 'all'>('read');
  const [newLimit, setNewLimit] = useState('60');

  const [generatedKeyResult, setGeneratedKeyResult] = useState<string | null>(null);

  const handleGenerateKey = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLabel) return;
    
    const array = new Uint8Array(24);
    crypto.getRandomValues(array);
    const hex = Array.from(array)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    const generatedRawKey = `ehi_live_${hex}`;
    
    const newKey: ApiKey = {
      id: Date.now().toString(),
      label: newLabel,
      prefix: generatedRawKey.slice(0, 10),
      rawKey: generatedRawKey,
      permissions: newPermissions,
      limit: Number(newLimit) || 60,
      lastUsed: 'Never Used',
      created: new Date().toISOString().split('T')[0]
    };

    setKeys(prev => [...prev, newKey]);
    setGeneratedKeyResult(generatedRawKey);
  };

  const handleDeleteKey = (id: string) => {
    if (confirm('Deactivate and revoke this credentials key? Partner services utilizing it will immediately receive 401 Unauthorized.')) {
      setKeys(prev => prev.filter(k => k.id !== id));
    }
  };

  return (
    <div className="flex flex-col h-full bg-[var(--color-obsidian)] p-4 text-[var(--color-foreground)] overflow-y-auto pb-[80px] font-sans">
      {/* Header back navigation */}
      <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-2 mb-4">
        <button onClick={onBack} className="flex items-center space-x-1 text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors">
          <ArrowLeft size={16} />
          <span className="text-[11px] font-mono">Back</span>
        </button>
        <span className="text-[10px] font-mono text-[var(--color-accent-cobalt)] tracking-widest font-bold">● SYSTEM DEVELOPER COCKPIT</span>
      </div>

      <div className="flex justify-between items-center flex-col sm:flex-row gap-4 mb-6">
        <div className="space-y-0.5">
          <div className="text-[9px] font-mono text-slate-400 tracking-[0.15em] uppercase">▸ PARTNER API GATEWAY CONTROLS</div>
          <h2 className="text-sm font-black text-[var(--color-foreground)]">REST API & Credentials Tokens</h2>
        </div>

        {activeSubTab === 'console' && (
          <button 
            onClick={() => {
              setGeneratedKeyResult(null);
              setShowAddKeyModal(true);
            }}
            className="bg-[var(--color-accent-cobalt)] hover:bg-blue-600 text-white font-mono text-[10px] uppercase font-bold px-3 py-1.5 rounded flex items-center space-x-1 cursor-pointer"
          >
            <Plus size={12} />
            <span>Generate New API Key</span>
          </button>
        )}
      </div>

      {/* Surface switches */}
      <div className="flex space-x-2 bg-black/35 p-1 rounded-lg border border-[var(--color-border)] mb-6">
        <button
          onClick={() => setActiveSubTab('console')}
          className={`flex-1 py-1.5 text-center text-[10px] font-mono uppercase font-bold rounded-md flex items-center justify-center space-x-1.5 transition-colors ${
            activeSubTab === 'console' ? 'bg-[var(--color-accent-cobalt)] text-white' : 'text-slate-400 hover:text-[var(--color-foreground)]'
          }`}
        >
          <Key size={12} />
          <span>Gateway Console</span>
        </button>
        <button
          onClick={() => setActiveSubTab('docs')}
          className={`flex-1 py-1.5 text-center text-[10px] font-mono uppercase font-bold rounded-md flex items-center justify-center space-x-1.5 transition-colors ${
            activeSubTab === 'docs' ? 'bg-[var(--color-accent-cobalt)] text-white' : 'text-slate-400 hover:text-[var(--color-foreground)]'
          }`}
        >
          <HelpCircle size={12} />
          <span>API Documentation</span>
        </button>
      </div>

      {/* Tab content controller */}
      {activeSubTab === 'console' ? (
        <div className="space-y-4">
          <div className="ehi-card p-4 space-y-4">
            <span className="text-[10px] font-mono text-slate-400 uppercase tracking-widest">Active Developer Tokens</span>

            <div className="divide-y divide-[rgba(255,255,255,0.05)] text-xs font-mono">
              {keys.map((k) => (
                <div key={k.id} className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 hover:bg-black/5">
                  <div className="space-y-1">
                    <span className="text-[12px] font-black text-[var(--color-foreground)]">{k.label}</span>
                    <div className="flex space-x-3 text-[10px] text-slate-500">
                      <span>Prefix: <code className="text-blue-300">{k.prefix}xxxxxx</code></span>
                      <span>Scope: <code className="text-emerald-400">{k.permissions}</code></span>
                      <span>Rate: <code className="text-amber-400">{k.limit} req/min</code></span>
                    </div>
                  </div>

                  <div className="flex items-center space-x-4 self-end sm:self-center">
                    <div className="text-right">
                      <span className="text-[10px] text-slate-400 block font-mono">Last Used</span>
                      <span className="text-[11px] text-slate-200 block font-mono">{k.lastUsed}</span>
                    </div>
                    <button 
                      onClick={() => handleDeleteKey(k.id)}
                      className="text-[var(--color-error)] opacity-60 hover:opacity-100 p-1.5 rounded hover:bg-red-500/10 cursor-pointer"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="ehi-card p-4 space-y-6 font-mono text-xs text-slate-300">
          <div className="space-y-2">
            <h3 className="text-sm font-bold text-[var(--color-foreground)] uppercase tracking-wider flex items-center space-x-1.5">
              <Shield size={14} className="text-[var(--color-accent-cobalt)]" />
              <span>Developer API specifications</span>
            </h3>
            <p className="text-[11.5px] leading-relaxed">
              Integrate your internal logistics ERP systems directly into EHI Multisystems. Send cargo manifests, look up tracking references, and retrieve client statement models.
            </p>
          </div>

          <div className="space-y-4">
            {/* Auth block */}
            <div className="p-3 bg-black/45 rounded-lg border border-solid border-[rgba(255,255,255,0.03)] space-y-2">
              <span className="text-[10.5px] font-bold text-[var(--color-accent-cobalt)] uppercase block mb-1">Authenticates Request Header:</span>
              <p className="text-[11px] leading-relaxed text-slate-300">Include your private credentials token in the headers sequence of every JSON API payload:</p>
              <pre className="p-2 bg-neutral-900 rounded font-bold text-slate-200">X-Api-Key: ehi_live_f7a2d8xxxxxxxxxxxxxxxx</pre>
            </div>

            {/* Endpoints specs */}
            <div className="space-y-4">
              <span className="text-[10.5px] font-black text-[var(--color-foreground)] uppercase block">ENDPOINT SPECIFICATIONS</span>

              {/* Endpoint 1 */}
              <div className="p-3 bg-black/25 rounded border border-[rgba(255,255,255,0.02)] space-y-2">
                <div className="flex items-center space-x-2">
                  <span className="bg-emerald-500/10 text-[var(--color-success)] px-1.5 py-0.5 rounded text-[9.5px] font-black uppercase">POST</span>
                  <span className="font-bold text-slate-200 text-[11px]">/api/v1/shipments</span>
                </div>
                <p className="text-[11px] text-slate-400">Log a new Cargo entry automatically into EHI operations cockpit.</p>
                
                <span className="text-[9.5px] font-extrabold text-slate-500 block uppercase mt-1">Payload Body Parameters:</span>
                <pre className="p-2.5 bg-neutral-950/40 rounded text-[10px] text-slate-400 whitespace-pre">
{`{
  "consignee_name": "Aramex Ltd",
  "awb_tag_number": "AWB-88392",
  "total_pcs": 12,
  "total_kg": 240,
  "route": "LOS-ABV",
  "content_type": "Parcels",
  "amount": 95000,
  "receipt_mode": "Transfer"
}`}
                </pre>
              </div>

              {/* Endpoint 2 */}
              <div className="p-3 bg-black/25 rounded border border-[rgba(255,255,255,0.02)] space-y-2">
                <div className="flex items-center space-x-2">
                  <span className="bg-blue-500/10 text-[var(--color-accent-cobalt)] px-1.5 py-0.5 rounded text-[9.5px] font-black uppercase">GET</span>
                  <span className="font-bold text-slate-200 text-[11px]">/api/v1/tracking/:ref</span>
                </div>
                <p className="text-[11px] text-slate-400">Pulls public, customer-safe consignment timeline parameters without requiring private API tokens.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Generate Key Modal */}
      {showAddKeyModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-55">
          <div className="ehi-card max-w-sm w-full overflow-hidden shadow-2xl">
            <div className="p-4 border-b border-[rgba(255,255,255,0.07)] flex justify-between items-center bg-black/40">
              <span className="text-[10px] font-mono text-[var(--color-accent-cobalt)] uppercase font-bold tracking-wider">GENERATE API CREDENTIALS</span>
              <button onClick={() => setShowAddKeyModal(false)} className="text-slate-400 hover:text-[var(--color-foreground)] font-mono text-xs cursor-pointer">✕</button>
            </div>

            <form onSubmit={handleGenerateKey} className="p-4 space-y-4 font-mono text-xs">
              
              {generatedKeyResult ? (
                <div className="space-y-3 animate-in zoom-in-95 duration-450 text-center">
                  <span className="text-2xl block">🔑</span>
                  <span className="text-[11px] font-black text-[var(--color-foreground)] block">Copy your API Key now!</span>
                  <p className="text-[10px] text-[var(--color-muted)] leading-relaxed">For security compliance, this is your only window to view and write down this raw key token:</p>
                  
                  <textarea 
                    readOnly
                    rows={2}
                    value={generatedKeyResult}
                    onClick={(e) => (e.target as any).select()}
                    className="w-full bg-[var(--color-obsidian)] border border-[var(--color-accent-cobalt)] p-2.5 rounded font-bold text-center text-xs text-blue-300 resize-none outline-none"
                  />
                  
                  <button 
                    type="button"
                    onClick={() => {
                      setShowAddKeyModal(false);
                      setGeneratedKeyResult(null);
                      setNewLabel('');
                    }}
                    className="w-full py-2 bg-[var(--color-accent-cobalt)] text-white font-mono text-[10px] font-black uppercase rounded cursor-pointer"
                  >
                    I have saved the credentials key
                  </button>
                </div>
              ) : (
                <>
                  <div className="space-y-1">
                    <label className="text-[8px] font-bold text-slate-500 uppercase">Gateway Alias / Label</label>
                    <input 
                      type="text" 
                      placeholder="e.g. Aramex Gateway"
                      required
                      value={newLabel}
                      onChange={(e) => setNewLabel(e.target.value)}
                      className="w-full bg-[var(--color-obsidian)] border border-[var(--color-border-strong)] p-2 rounded text-xs text-[var(--color-foreground)]"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-[8px] font-bold text-slate-500 uppercase">Permissions scope</label>
                      <select 
                        value={newPermissions} 
                        onChange={(e: any) => setNewPermissions(e.target.value)}
                        className="w-full bg-[var(--color-obsidian)] border border-[rgba(255,255,255,0.12)] p-2 rounded text-xs text-[var(--color-foreground)]"
                      >
                        <option value="read">READ-ONLY</option>
                        <option value="write">WRITE Manifests</option>
                        <option value="all">ALL Permissions</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[8px] font-bold text-slate-500 uppercase">Rate (req/min)</label>
                      <input 
                        type="number" 
                        required
                        value={newLimit}
                        onChange={(e) => setNewLimit(e.target.value)}
                        className="w-full bg-[var(--color-obsidian)] border border-[rgba(255,255,255,0.12)] p-2 rounded text-xs text-[var(--color-foreground)]"
                      />
                    </div>
                  </div>

                  <div className="flex space-x-2 pt-2">
                    <button 
                      type="submit"
                      className="flex-1 bg-[var(--color-accent-cobalt)] text-white font-mono text-[10px] font-bold uppercase py-2.5 rounded hover:bg-blue-600 cursor-pointer"
                    >
                      Issue API Token
                    </button>
                    <button 
                      type="button"
                      onClick={() => setShowAddKeyModal(false)}
                      className="bg-neutral-800 text-slate-300 font-mono text-[10px] uppercase font-bold px-4 rounded hover:bg-neutral-700 cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
