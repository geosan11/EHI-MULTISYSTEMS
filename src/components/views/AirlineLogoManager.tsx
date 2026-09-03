import { useState, useEffect } from 'react';
import { User } from '../../lib/types';
import { Upload, Trash2 } from 'lucide-react';
import { listAirlineLogos, uploadAirlineLogo, deleteAirlineLogo } from '../../lib/airlineLogos';
import { useToast } from '../../lib/ToastContext';
import { useConfirm } from '../../lib/ConfirmContext';
import { Button, PageHeader, Spinner, TextField } from '../ui';

export const AirlineLogoManager = ({ user, onBack }: { user: User; onBack: () => void }) => {
  const [logos, setLogos] = useState<Array<{ name: string; slug: string; url: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [newAirlineName, setNewAirlineName] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const { showToast } = useToast();
  const confirm = useConfirm();

  useEffect(() => {
    listAirlineLogos().then(data => { setLogos(data); setLoading(false); });
  }, []);

  const handleUpload = async () => {
    if (!newAirlineName.trim() || !selectedFile) return;
    setUploading(true);
    try {
      await uploadAirlineLogo(newAirlineName.trim(), selectedFile);
      showToast({ message: `Logo uploaded for ${newAirlineName.trim()}`, type: 'success' });
      setNewAirlineName('');
      setSelectedFile(null);
      const updated = await listAirlineLogos();
      setLogos(updated);
    } catch (e: any) {
      showToast({ message: 'Upload failed: ' + e.message, type: 'error' });
    }
    setUploading(false);
  };

  const handleDelete = async (name: string) => {
    const ok = await confirm({
      title: 'Remove logo?',
      message: `Remove logo for ${name}?`,
      confirmLabel: 'Remove',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await deleteAirlineLogo(name);
      setLogos(prev => prev.filter(l => l.name !== name));
      showToast({ message: `Logo removed for ${name}`, type: 'success' });
    } catch (e: any) {
      showToast({ message: 'Delete failed: ' + e.message, type: 'error' });
    }
  };

  if (user.role !== 'super_admin' && user.role !== 'admin') {
    return null;
  }

  return (
    <div className="flex flex-col h-full bg-[var(--color-canvas)] text-[var(--color-foreground)] animate-in slide-in-from-right overflow-hidden">
      <PageHeader title="Airline Logos" onBack={onBack} />

      <div className="flex-1 overflow-y-auto">
        <div className="ehi-page-body px-4 py-4 space-y-6">

          {/* Upload new logo */}
          <div className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl p-4 space-y-3">
            <div className="text-[12px] font-bold text-[var(--color-foreground)]">Add Airline Logo</div>
            <div className="text-[11px] text-[var(--color-muted)]">
              Upload a PNG logo for any airline. Once uploaded, it automatically
              appears on cargo tags, receipts, and PDF waybills — no app update needed.
            </div>

            <TextField
              label="Airline Name (exactly as entered in Cargo Form)"
              value={newAirlineName}
              onChange={e => setNewAirlineName(e.target.value)}
              placeholder="e.g. Overland Airways"
            />

            <div className="space-y-1.5">
              <label htmlFor="airline-logo-file" className="ehi-label">Logo File (PNG recommended)</label>
              <input
                id="airline-logo-file"
                type="file"
                accept="image/png,image/jpeg,image/gif"
                onChange={e => setSelectedFile(e.target.files?.[0] || null)}
                className="ehi-input text-[11px]"
              />
            </div>

            {selectedFile && (
              <div className="text-[10px] text-[var(--color-muted)] font-mono">
                Selected: {selectedFile.name} ({Math.round(selectedFile.size / 1024)}KB)
              </div>
            )}

            <Button
              variant="primary"
              fullWidth
              iconLeft={Upload}
              onClick={handleUpload}
              loading={uploading}
              loadingLabel="Uploading…"
              disabled={!newAirlineName.trim() || !selectedFile}
            >
              Upload Logo
            </Button>
          </div>

          {/* Existing logos list */}
          <div>
            <div className="text-[11px] font-mono text-[var(--color-muted)] uppercase tracking-widest mb-3">
              Uploaded Logos ({logos.length})
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Spinner size="lg" tone="muted" />
              </div>
            ) : logos.length === 0 ? (
              <div className="text-center py-8 text-[var(--color-muted)] text-[12px] font-mono">
                No logos uploaded yet.
              </div>
            ) : (
              <div className="space-y-2">
                {logos.map(logo => (
                  <div key={logo.slug} className="flex items-center gap-3 p-3 bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-lg">
                    <img
                      src={logo.url}
                      alt={logo.name}
                      className="w-12 h-8 object-contain bg-white rounded"
                      onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                    <div className="flex-1">
                      <div className="text-[12px] font-bold text-[var(--color-foreground)]">{logo.name}</div>
                      <div className="text-[10px] font-mono text-[var(--color-muted)]">{logo.slug}.png</div>
                    </div>
                    <button
                      onClick={() => handleDelete(logo.name)}
                      aria-label={`Remove logo for ${logo.name}`}
                      className="p-1.5 text-[var(--color-error-fg)] hover:bg-[var(--color-error-bg)] rounded transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Instructions */}
          <div className="bg-[var(--color-amber-bg)] border border-[var(--color-amber-border)] rounded-lg p-3 text-[11px] text-[var(--color-muted)] space-y-1">
            <div className="font-bold text-[var(--color-accent-amber)] mb-1">How to migrate existing logos</div>
            <div>Upload logos for each current airline partner:</div>
            <div className="font-mono text-[10px] space-y-0.5 mt-1">
              <div>• "Arik Air" → upload arik-air.png</div>
              <div>• "Green Africa Airways" → upload green-africa-airways.png</div>
              <div>• "United Nigeria Airlines" → upload united-nigeria-airlines.png</div>
              <div>• "ValueJet" → upload valuejet.png</div>
              <div>• "Aero Contractors" → upload aero-contractors.png</div>
            </div>
          </div>

        </div>
      </div>

    </div>
  );
};
