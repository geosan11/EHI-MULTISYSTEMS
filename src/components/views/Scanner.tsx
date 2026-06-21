import { useState, useEffect, useRef, useCallback } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { QrCode, RefreshCw, Package, Plane, TrendingUp, ArrowDown, ArrowUp, List } from 'lucide-react';
import { User, ScanMode, ScanValidationResult, BatchScanItem } from '../../lib/types';
import { validateScan, logScanEvent } from '../../lib/scanLogic';
import { WrongDestinationAlert, NotLoggedInAlert, AlreadyProcessedAlert, SuccessFlash } from '../ScanAlerts';

export const Scanner = ({
  user,
  transactions,
  showToast,
}: {
  user: User;
  transactions: any[];
  showToast?: (opts: any) => void;
}) => {
  const [mode, setMode] = useState<ScanMode>('ARRIVE');
  const [isScanning, setIsScanning] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [currentResult, setCurrentResult] = useState<ScanValidationResult | null>(null);
  const [successFlash, setSuccessFlash] = useState<ScanValidationResult | null>(null);
  const [batchItems, setBatchItems] = useState<BatchScanItem[]>([]);
  const [showBatch, setShowBatch] = useState(false);
  const [manualRef, setManualRef] = useState('');
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);
  const processingRef = useRef(false);

  const currentHub = user.hub;
  const batchSuccess = batchItems.filter(b => b.result.startsWith('SUCCESS')).length;
  const batchAlerts = batchItems.filter(b => !b.result.startsWith('SUCCESS') && b.result !== 'ALREADY_PROCESSED').length;

  const processCode = useCallback(async (code: string) => {
    if (processingRef.current) return;
    processingRef.current = true;
    setProcessing(true);

    try {
      const result = await validateScan(code, mode, currentHub);

      if (result.type === 'SUCCESS_ARRIVE' || result.type === 'SUCCESS_DEPART') {
        // Log the event to database
        await logScanEvent(
          code,
          mode,
          currentHub,
          user.name,
          result.cargo?.destination
        );

        // Add to batch list
        setBatchItems(prev => [{
          ref: code,
          name: result.cargo?.name || code,
          result: result.type,
          time: new Date().toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' }),
        }, ...prev]);

        // Show success flash briefly then auto-clear
        setSuccessFlash(result);
        setTimeout(() => {
          setSuccessFlash(null);
          processingRef.current = false;
          setProcessing(false);
        }, 1500);

      } else {
        // Error — show alert modal, pause scanner
        if (scannerRef.current) {
          try { await scannerRef.current.pause(true); } catch { /* ignore */ }
        }
        setCurrentResult(result);
        setProcessing(false);
        processingRef.current = false;
      }
    } catch (err) {
      console.error('Scan processing error:', err);
      setProcessing(false);
      processingRef.current = false;
    }
  }, [mode, currentHub, user.name]);

  // Start camera scanner
  const startScanner = useCallback(async () => {
    // Request camera permission explicitly on iOS
    try {
      await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    } catch (err) {
      if (showToast) {
        showToast({
          message: 'Camera permission denied. Enable in Settings → Safari → Camera.',
          type: 'error',
        });
      } else {
        alert('Camera permission denied. Enable in Settings → Safari → Camera.');
      }
      return;
    }
    setIsScanning(true);
  }, [showToast]);

  useEffect(() => {
    if (isScanning && !scannerRef.current) {
      const scanner = new Html5QrcodeScanner(
        'qr-reader-div',
        {
          fps: 15,
          qrbox: { width: 220, height: 220 },
          aspectRatio: 1.0,
          showTorchButtonIfSupported: true,
          showZoomSliderIfSupported: false,
          defaultZoomValueIfSupported: 2,
        },
        false
      );

      scanner.render(
        (decodedText) => processCode(decodedText),
        () => { /* ignore scan failures — camera looking */ }
      );

      scannerRef.current = scanner;
    }
  }, [isScanning, processCode]);

  const stopScanner = useCallback(async () => {
    if (scannerRef.current) {
      try { await scannerRef.current.clear(); } catch { /* ignore */ }
      scannerRef.current = null;
    }
    setIsScanning(false);
  }, []);

  // Resume scanner after alert dismissed
  const dismissAlert = useCallback(async () => {
    setCurrentResult(null);
    processingRef.current = false;
    if (scannerRef.current) {
      try { scannerRef.current.resume(); } catch { /* ignore */ }
    }
  }, []);

  const switchToArriveAndDismiss = useCallback(() => {
    setMode('ARRIVE');
    dismissAlert();
  }, [dismissAlert]);

  // Manual lookup
  const handleManualLookup = async () => {
    if (!manualRef.trim()) return;
    await processCode(manualRef.trim());
    setManualRef('');
  };

  // Stop scanner on unmount
  useEffect(() => {
    return () => { stopScanner(); };
  }, [stopScanner]);

  // Batch list view
  if (showBatch) {
    return (
      <div className="p-4 pb-20 space-y-4">
        <div className="flex items-center justify-between border-b border-[rgba(255,255,255,0.07)] pb-3">
          <button onClick={() => setShowBatch(false)} className="text-[11px] font-mono text-[var(--color-muted)] flex items-center gap-1">
            ← BACK TO SCANNER
          </button>
          <span className="text-[10px] font-mono text-[var(--color-muted)] uppercase tracking-wider">
            {batchItems.length} scans this session
          </span>
        </div>
        <div className="space-y-2">
          {batchItems.length === 0 ? (
            <div className="text-center py-12 text-[var(--color-muted)] font-mono text-[11px]">
              No scans yet this session
            </div>
          ) : batchItems.map((item, i) => {
            const isSuccess = item.result.startsWith('SUCCESS');
            const color = item.result === 'SUCCESS_ARRIVE' ? 'var(--color-success)' : 'var(--color-accent-cobalt)';
            return (
              <div key={i} className="flex items-center gap-3 bg-[var(--color-surface-1)] p-3 rounded border border-[rgba(255,255,255,0.06)]">
                <div style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: isSuccess ? (item.result === 'SUCCESS_ARRIVE' ? '#10B981' : '#3B82F6') : '#EF4444',
                  flexShrink: 0,
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="text-[12px] font-bold text-[var(--color-foreground)] truncate">{item.name}</div>
                  <div className="text-[10px] font-mono text-[var(--color-muted)]">{item.ref}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[10px] font-mono" style={{ color: isSuccess ? color : '#EF4444' }}>
                    {item.result.replace('SUCCESS_', '').replace('_', ' ')}
                  </div>
                  <div className="text-[9px] text-[var(--color-muted)] font-mono">{item.time}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 pb-20 space-y-4">

      {/* Section header */}
      <div className="text-[9px] font-mono text-[var(--color-muted)] tracking-[0.12em] uppercase border-b border-[rgba(255,255,255,0.07)] pb-2">
        ▸ QR SCAN & TRACKING
      </div>

      {/* Hub indicator */}
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-mono text-[var(--color-accent-amber)]">
          📍 {currentHub}
        </div>
        {batchItems.length > 0 && (
          <button
            onClick={() => setShowBatch(true)}
            className="flex items-center gap-1.5 text-[10px] font-mono text-[var(--color-light-muted)]"
          >
            <List size={11} />
            {batchSuccess} ✓ {batchAlerts > 0 && <span className="text-[var(--color-error)]">| {batchAlerts} alerts</span>}
          </button>
        )}
      </div>

      {/* Mode Toggle — ARRIVE / DEPART */}
      <div className="flex rounded overflow-hidden border border-[var(--color-border)]">
        {(['ARRIVE', 'DEPART'] as ScanMode[]).map((m) => {
          const active = mode === m;
          const isArrive = m === 'ARRIVE';
          const activeColor = isArrive ? 'var(--color-success)' : 'var(--color-accent-cobalt)';
          const activeBg = isArrive ? 'rgba(16,185,129,0.12)' : 'rgba(59,130,246,0.12)';
          const Icon = isArrive ? ArrowDown : ArrowUp;
          return (
            <button
              key={m}
              onClick={() => { setMode(m); dismissAlert(); }}
              style={{
                flex: 1, padding: '12px 8px',
                background: active ? activeBg : 'transparent',
                border: 'none',
                borderRight: m === 'ARRIVE' ? '1px solid var(--color-border)' : 'none',
                color: active ? activeColor : '#64748B',
                cursor: 'pointer',
                display: 'flex', alignItems: 'center',
                justifyContent: 'center', gap: 6,
                transition: 'all 0.2s',
              }}
            >
              <Icon size={16} />
              <span style={{
                fontFamily: 'monospace', fontSize: 13,
                fontWeight: active ? 800 : 500,
                letterSpacing: '0.04em',
              }}>
                {m}
              </span>
            </button>
          );
        })}
      </div>

      {/* Mode description */}
      <div className="text-[10px] font-mono text-[var(--color-muted)] text-center">
        {mode === 'ARRIVE'
          ? 'Scan cargo arriving at this hub'
          : 'Scan cargo departing from this hub'}
      </div>

      {/* Camera scanner */}
      {isScanning ? (
        <div className="relative">
          <div
            id="qr-reader-div"
            style={{ borderRadius: 12, overflow: 'hidden' }}
          />
          {processing && (
            <div style={{
              position: 'absolute', inset: 0, zIndex: 10,
              background: 'rgba(11,15,25,0.7)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: 12,
            }}>
              <RefreshCw size={28} color="#F59E0B" style={{ animation: 'spin 1s linear infinite' }} />
            </div>
          )}
          <button
            onClick={stopScanner}
            className="mt-3 w-full py-3 bg-[var(--color-surface-2)] text-[var(--color-muted)] text-[11px] font-mono rounded border border-[var(--color-border)] cursor-pointer hover:bg-[var(--color-surface-3)] transition-colors"
          >
            Stop Camera
          </button>
        </div>
      ) : (
        <div
          onClick={startScanner}
          style={{
            height: 180,
            background: 'var(--color-surface-1)',
            border: '2px dashed var(--color-border-strong)',
            borderRadius: 12,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            gap: 10, cursor: 'pointer',
          }}
        >
          <QrCode size={36} color="#64748B" />
          <div style={{
            fontFamily: 'monospace', fontSize: 11,
            color: '#64748B', textAlign: 'center', lineHeight: 1.6,
            letterSpacing: '0.04em',
          }}>
            TAP TO START CAMERA
            <br />
            <span style={{ fontSize: 9, opacity: 0.6 }}>Point at cargo QR tag to scan</span>
          </div>
        </div>
      )}

      {/* Manual entry fallback */}
      <div className="flex gap-2">
        <input
          value={manualRef}
          onChange={e => setManualRef(e.target.value.toUpperCase())}
          onKeyDown={e => e.key === 'Enter' && handleManualLookup()}
          placeholder="Enter AWB / tag ref manually..."
          className="flex-1 h-11 px-3 text-[12px] font-mono rounded border border-[var(--color-border)] focus:border-[var(--color-muted)] outline-none bg-[var(--color-input-bg)] text-[var(--color-input-text)]"
        />
        <button
          onClick={handleManualLookup}
          disabled={!manualRef.trim() || processing}
          className="h-11 px-4 bg-[var(--color-surface-2)] text-[var(--color-foreground)] text-[11px] font-mono rounded disabled:opacity-50 border border-[var(--color-border)] cursor-pointer hover:bg-[var(--color-surface-3)] transition-colors"
        >
          LOOKUP
        </button>
      </div>

      {/* Batch counter when active */}
      {batchItems.length > 0 && (
        <div className="flex gap-3 mt-2">
          <div className="flex-1 bg-[rgba(16,185,129,0.07)] border border-[rgba(16,185,129,0.2)] rounded p-2 text-center">
            <div className="text-[18px] font-bold font-mono text-[var(--color-success)]">{batchSuccess}</div>
            <div className="text-[8px] font-mono text-[var(--color-muted)] uppercase tracking-wider">Logged</div>
          </div>
          <div className="flex-1 bg-[rgba(239,68,68,0.07)] border border-[rgba(239,68,68,0.2)] rounded p-2 text-center">
            <div className="text-[18px] font-bold font-mono text-[var(--color-error)]">{batchAlerts}</div>
            <div className="text-[8px] font-mono text-[var(--color-muted)] uppercase tracking-wider">Alerts</div>
          </div>
          <div className="flex-1 bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded p-2 text-center">
            <div className="text-[18px] font-bold font-mono text-[var(--color-foreground)]">{batchItems.length}</div>
            <div className="text-[8px] font-mono text-[var(--color-muted)] uppercase tracking-wider">Total</div>
          </div>
        </div>
      )}

      {/* Alert modals */}
      {currentResult?.type === 'WRONG_DESTINATION' && (
        <WrongDestinationAlert
          result={currentResult}
          onAcknowledge={dismissAlert}
        />
      )}
      {currentResult?.type === 'NOT_LOGGED_IN' && (
        <NotLoggedInAlert
          result={currentResult}
          onOk={dismissAlert}
          onSwitchToArrive={switchToArriveAndDismiss}
        />
      )}
      {currentResult?.type === 'ALREADY_PROCESSED' && (
        <AlreadyProcessedAlert
          result={currentResult}
          onOk={dismissAlert}
        />
      )}
      {currentResult?.type === 'NOT_FOUND' && (
        <NotLoggedInAlert
          result={{ ...currentResult, message: currentResult.message }}
          onOk={dismissAlert}
          onSwitchToArrive={dismissAlert}
        />
      )}

      {/* Success flash */}
      {successFlash && <SuccessFlash result={successFlash} />}

    </div>
  );
};
