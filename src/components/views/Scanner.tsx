import { useState, useEffect, useRef, useCallback } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { QrCode, RefreshCw, Package, Plane, TrendingUp, ArrowDown, ArrowUp, List, CheckCircle } from 'lucide-react';
import { User, ScanMode, ScanValidationResult, BatchScanItem, ScanResultType, ProofOfDelivery } from '../../lib/types';
import { validateScan, logScanEvent } from '../../lib/scanLogic';
import { WrongDestinationAlert, NotLoggedInAlert, AlreadyProcessedAlert, SuccessFlash } from '../ScanAlerts';
import { ProofOfDeliveryForm } from './ProofOfDelivery';

// Standard Web Audio API synthesizer for a subtle, high-pitched electronic confirmation blip
const playBeep = () => {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const audioCtx = new AudioContextClass();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    oscillator.type = 'sine';
    // Clean, crisp note at 900Hz sliding slightly to 1100Hz
    oscillator.frequency.setValueAtTime(900, audioCtx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(1100, audioCtx.currentTime + 0.05);

    gainNode.gain.setValueAtTime(0.0, audioCtx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.12, audioCtx.currentTime + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.12);

    oscillator.start(audioCtx.currentTime);
    oscillator.stop(audioCtx.currentTime + 0.13);
  } catch (error) {
    console.warn('Audio feedback failed to play:', error);
  }
};

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
  const scannerRef = useRef<any>(null);
  const processingRef = useRef(false);

  // New states for batch queuing
  const [isBatchQueueMode, setIsBatchQueueMode] = useState(false);
  const [batchQueue, setBatchQueue] = useState<{
    ref: string;
    name: string;
    result: ScanResultType;
    mode: ScanMode;
    destination?: string;
    time: string;
    kg?: number;
  }[]>([]);
  const [submittingBatch, setSubmittingBatch] = useState(false);
  const [showQueueSummary, setShowQueueSummary] = useState(false);
  const [activeDeliverCargo, setActiveDeliverCargo] = useState<{awbNumber: string, consigneeName: string} | null>(null);

  const currentHub = user.hub;
  const batchSuccess = batchItems.filter(b => b.result.startsWith('SUCCESS')).length;
  const batchAlerts = batchItems.filter(b => !b.result.startsWith('SUCCESS') && b.result !== 'ALREADY_PROCESSED').length;
  const successfulScans = batchItems
    .filter(item => item.result === 'SUCCESS_ARRIVE' || item.result === 'SUCCESS_DEPART')
    .slice(0, 5);

  const handleConfirmSubmitBatch = async (itemsToSubmit = batchQueue) => {
    if (itemsToSubmit.length === 0) return;
    setSubmittingBatch(true);

    try {
      // Loop through all items and commit them to supabase
      await Promise.all(itemsToSubmit.map(item => 
        logScanEvent(
          item.ref,
          item.mode,
          currentHub,
          user.name,
          item.destination
        )
      ));

      // Add to session logs so they display in recent successfully scanned logs list
      const newlyLoggedItems: BatchScanItem[] = itemsToSubmit.map(item => ({
        ref: item.ref,
        name: item.name,
        result: item.result,
        time: item.time
      }));

      setBatchItems(prev => [...newlyLoggedItems, ...prev]);

      if (showToast) {
        showToast({
          message: `Successfully logged batch of ${itemsToSubmit.length} scans to database!`,
          type: 'success'
        });
      }

      setBatchQueue([]);
      setShowQueueSummary(false);
    } catch (error) {
      console.error('Failed to submit batch scans:', error);
      if (showToast) {
        showToast({
          message: 'Failed to submit batch scans. Please try again.',
          type: 'error'
        });
      } else {
        alert('Failed to submit batch scans. Please try again.');
      }
    } finally {
      setSubmittingBatch(false);
    }
  };

  const processCode = useCallback(async (code: string) => {
    if (processingRef.current) return;
    processingRef.current = true;
    setProcessing(true);

    try {
      const result = await validateScan(code, mode, currentHub);

      if (result.type === 'SUCCESS_DELIVER') {
        playBeep();
        
        // Pause scanner video
        document.querySelectorAll<HTMLVideoElement>('#qr-reader-div video').forEach(v => { v.pause(); });
        setProcessing(false);
        processingRef.current = false;
        
        setActiveDeliverCargo({
          awbNumber: result.cargo?.awb || code,
          consigneeName: result.cargo?.name || 'Unknown'
        });
        return;
      }

      if (result.type === 'SUCCESS_ARRIVE' || result.type === 'SUCCESS_DEPART') {
        playBeep();
        
        if (isBatchQueueMode) {
          // Check for duplicate in current batch queue to prevent double scanning
          let isDuplicate = false;
          setBatchQueue(prev => {
            if (prev.some(item => item.ref === code && item.mode === mode)) {
              isDuplicate = true;
              return prev;
            }
            return [{
              ref: code,
              name: result.cargo?.name || code,
              result: result.type,
              mode: mode,
              destination: result.cargo?.destination,
              time: new Date().toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' }),
              kg: result.cargo?.kg,
            }, ...prev];
          });

          if (isDuplicate) {
            if (showToast) {
              showToast({
                message: `${code} is already in the batch queue for ${mode}`,
                type: 'warning'
              });
            }
            setProcessing(false);
            processingRef.current = false;
            return;
          }

          if (showToast) {
            showToast({
              message: `Queued ${mode} scan for AWB ${code}`,
              type: 'success'
            });
          }

          // Show success flash briefly then auto-clear
          setSuccessFlash(result);
          setTimeout(() => {
            setSuccessFlash(null);
            processingRef.current = false;
            setProcessing(false);
          }, 1200);

        } else {
          // Log the event immediately to database
          await logScanEvent(
            code,
            mode,
            currentHub,
            user.name,
            result.cargo?.destination
          );

          // Add to session batch/history list
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
        }

      } else {
        // Error — show alert modal, pause scanner
        document.querySelectorAll<HTMLVideoElement>(
          '#qr-reader-div video'
        ).forEach(v => { v.pause(); });
        setCurrentResult(result);
        setProcessing(false);
        processingRef.current = false;
      }
    } catch (err) {
      console.error('Scan processing error:', err);
      setProcessing(false);
      processingRef.current = false;
    }
  }, [mode, currentHub, user.name, isBatchQueueMode, showToast]);

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
      const scanner = new Html5Qrcode('qr-reader-div');
      
      scanner.start(
        { facingMode: 'environment' },
        {
          fps: 15,
          qrbox: { width: 220, height: 220 },
          aspectRatio: 1.0,
        },
        (decodedText) => processCode(decodedText),
        () => { /* ignore */ }
      ).catch(err => {
        console.error("Scanner start error:", err);
        setIsScanning(false);
      });

      scannerRef.current = scanner as any;
    }
  }, [isScanning, processCode]);

  const stopScanner = useCallback(async () => {
    // Step 1: Stop all video tracks directly on the DOM element
    // This is the only 100% reliable way to turn the camera off.
    // Do this BEFORE calling clear() so the camera LED turns off
    // immediately when the button is tapped.
    const videoEls = document.querySelectorAll<HTMLVideoElement>(
      '#qr-reader-div video'
    );
    videoEls.forEach(video => {
      if (video.srcObject instanceof MediaStream) {
        video.srcObject.getTracks().forEach(track => {
          track.stop();  // ← this actually turns off the camera
        });
        video.srcObject = null;
      }
      video.load(); // reset the video element state
    });

    // Step 2: Tell the library to clean up its DOM and internal state.
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        scannerRef.current.clear();
      } catch {
        // Acceptable — camera is already stopped above
      }
      scannerRef.current = null;
    }

    // Step 3: Reset all scanning state
    setIsScanning(false);
    setProcessing(false);
    processingRef.current = false;
    setCurrentResult(null);
    setSuccessFlash(null);
  }, []);

  // Resume scanner after alert dismissed
  const dismissAlert = useCallback(async () => {
    setCurrentResult(null);
    setActiveDeliverCargo(null);
    processingRef.current = false;
    // Resume video playback directly
    document.querySelectorAll<HTMLVideoElement>(
      '#qr-reader-div video'
    ).forEach(v => {
      v.play().catch(() => { /* ignore autoplay errors */ });
    });
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
    return () => {
      // On unmount: stop camera tracks directly
      document.querySelectorAll<HTMLVideoElement>(
        '#qr-reader-div video'
      ).forEach(video => {
        if (video.srcObject instanceof MediaStream) {
          video.srcObject.getTracks().forEach(t => t.stop());
          video.srcObject = null;
        }
      });
      // Then clear the library instance
      if (scannerRef.current) {
        try { scannerRef.current.clear(); } catch { /* ignore */ }
        scannerRef.current = null;
      }
    };
  }, []);

  // Batch Queue Summary View
  if (showQueueSummary) {
    return (
      <div className="p-4 pb-24 space-y-4 animate-in fade-in duration-200">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-3">
          <button onClick={() => setShowQueueSummary(false)} className="text-[11px] font-mono text-[var(--color-muted)] flex items-center gap-1 hover:text-[var(--color-foreground)] transition-colors cursor-pointer border-none bg-transparent">
            ← BACK TO SCANNER
          </button>
          <span className="text-[10px] font-mono text-[var(--color-accent-amber)] uppercase tracking-wider font-bold">
            {batchQueue.length} items in batch queue
          </span>
        </div>

        {batchQueue.length === 0 ? (
          <div className="text-center py-16 text-[var(--color-muted)] font-mono text-[11px]">
            The batch queue is currently empty. Start scanning in Batch mode to add items here.
          </div>
        ) : (
          <>
            {/* Batch Action Buttons */}
            <div className="grid grid-cols-2 gap-3 pb-2">
              <button
                onClick={() => {
                  if (confirm('Are you sure you want to clear all items in the batch queue?')) {
                    setBatchQueue([]);
                    setShowQueueSummary(false);
                    if (showToast) showToast({ message: 'Batch queue cleared', type: 'info' });
                  }
                }}
                className="py-3 bg-red-950/40 hover:bg-red-900/30 text-red-400 text-[12px] font-sans font-semibold rounded-[var(--radius-sm)] border border-red-900/50 transition-colors cursor-pointer"
              >
                Clear Queue ({batchQueue.length})
              </button>
              <button
                onClick={() => handleConfirmSubmitBatch()}
                disabled={submittingBatch}
                style={{
                  background: 'var(--color-success)',
                  color: '#0d1117',
                }}
                className="py-3 hover:bg-opacity-90 text-[12px] font-bold font-sans rounded-[var(--radius-sm)] border-none transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                {submittingBatch ? (
                  <>
                    <RefreshCw size={14} className="animate-spin" />
                    SUBMITTING...
                  </>
                ) : (
                  <>
                    Commit Batch ({batchQueue.length})
                  </>
                )}
              </button>
            </div>

            {/* Queue items list */}
            <div className="space-y-2">
              {batchQueue.map((item, i) => {
                const isArrive = item.mode === 'ARRIVE';
                const color = isArrive ? 'var(--color-success)' : 'var(--color-accent-cobalt)';
                return (
                  <div key={i} className="flex items-center gap-3 bg-[var(--color-surface-1)] p-3.5 rounded-lg border border-[var(--color-border)] hover:border-[var(--color-border-strong)] transition-all">
                    <div style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: isArrive ? '#10B981' : '#3B82F6',
                      flexShrink: 0,
                    }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="text-[12px] font-bold text-[var(--color-foreground)] truncate">{item.name}</div>
                      <div className="text-[10px] font-mono text-[var(--color-muted)] flex items-center gap-2">
                        <span>{item.ref}</span>
                        {item.kg && <span>· {item.kg} KG</span>}
                      </div>
                    </div>
                    <div className="text-right shrink-0 flex items-center gap-3">
                      <div className="text-right">
                        <div className="text-[10px] font-mono uppercase font-bold" style={{ color }}>
                          {item.mode}
                        </div>
                        <div className="text-[9px] text-[var(--color-muted)] font-mono">{item.time}</div>
                      </div>
                      <button
                        onClick={() => {
                          setBatchQueue(prev => prev.filter((_, idx) => idx !== i));
                          if (showToast) showToast({ message: `Removed ${item.ref} from queue`, type: 'info' });
                        }}
                        className="p-1 px-1.5 rounded bg-[rgba(239,68,68,0.1)] text-[var(--color-error)] hover:bg-[rgba(239,68,68,0.2)] border-none text-[10px] font-mono transition-colors cursor-pointer"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    );
  }

  // Batch list view
  if (showBatch) {
    return (
      <div className="p-4 pb-20 space-y-4">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-3">
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

      {/* Mode Toggle — ARRIVE / DEPART / DELIVER */}
      <div className="flex bg-[var(--color-surface-2)] p-1 rounded-lg mb-6 shadow-inner" style={{ width: '100%' }}>
        {(['ARRIVE', 'DEPART', 'DELIVER'] as ScanMode[]).map((m) => {
          const active = mode === m;
          const activeColor = m === 'ARRIVE' ? 'var(--color-success)' : m === 'DEPART' ? 'var(--color-accent-cobalt)' : '#a855f7';
          const activeBg = 'var(--color-surface-1)';
          const Icon = m === 'ARRIVE' ? ArrowDown : m === 'DEPART' ? ArrowUp : CheckCircle;
          return (
            <button
              key={m}
              onClick={() => { setMode(m); dismissAlert(); }}
              style={{
                flex: 1, minWidth: 0, padding: '12px 8px',
                background: active ? activeBg : 'transparent',
                borderRadius: '8px',
                border: 'none',
                color: active ? activeColor : '#64748B',
                boxShadow: active ? '0 2px 8px rgba(0,0,0,0.2)' : 'none',
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
      <div className="text-[10px] font-mono text-[var(--color-muted)] text-center mb-1">
        {mode === 'ARRIVE'
          ? 'Scan cargo arriving at this hub'
          : mode === 'DEPART'
          ? 'Scan cargo departing from this hub'
          : 'Capture proof of delivery for recipient'}
      </div>

      {/* Scan Logic Option Toggle: Instant vs Batch Queue */}
      <div className="flex bg-[var(--color-surface-2)] p-1 rounded-lg shadow-inner mt-1 mb-2" style={{ width: '100%' }}>
        {[
          { key: 'instant', label: '⚡ Instant Log', desc: 'Direct DB commit' },
          { key: 'batch', label: '📥 Batch Queue', desc: 'Verify before log' }
        ].map((opt) => {
          const active = (opt.key === 'batch') === isBatchQueueMode;
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => {
                setIsBatchQueueMode(opt.key === 'batch');
                dismissAlert();
              }}
              style={{
                flex: 1, minWidth: 0, padding: '8px 4px',
                background: active ? 'var(--color-surface-1)' : 'transparent',
                borderRadius: '8px',
                border: 'none',
                color: active ? 'var(--color-accent-amber)' : '#64748B',
                boxShadow: active ? '0 1px 4px rgba(0,0,0,0.15)' : 'none',
                cursor: 'pointer',
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.2s',
              }}
            >
              <span className="font-sans text-[12px] font-bold tracking-wide">
                {opt.label}
              </span>
              <span className="font-sans text-[9px] opacity-65 font-medium mt-0.5">
                {opt.desc}
              </span>
            </button>
          );
        })}
      </div>

      {/* Batch Queue Status Box */}
      {batchQueue.length > 0 && (
        <div 
          onClick={() => setShowQueueSummary(true)}
          style={{
            background: 'linear-gradient(135deg, rgba(245,158,11,0.1) 0%, rgba(245,158,11,0.03) 100%)',
            border: '1.5px solid rgba(245,158,11,0.25)',
            borderRadius: 'var(--radius-md)',
            padding: '12px 14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
            gap: 12,
            marginTop: 4,
            marginBottom: 8,
          }}
          className="hover:border-amber-500/40 transition-colors shadow-sm"
        >
          <div className="min-w-0 flex-1">
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-accent-amber)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>⚡ Batch Queue Storage</span>
              <span className="ehi-btn-primary ehi-btn">{batchQueue.length}</span>
            </div>
            <div style={{ fontSize: 10, color: 'var(--color-muted)', marginTop: 4 }} className="truncate font-sans font-medium">
              Scans are staged locally. Tap to summarize and commit.
            </div>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowQueueSummary(true);
            }}
            className="ehi-btn-primary ehi-btn"
          >
            REVIEW & COMMIT
          </button>
        </div>
      )}

      {/* Camera scanner */}
      {isScanning ? (
        <div className="relative w-full">
          <div
            id="qr-reader-div"
            style={{ borderRadius: 12, overflow: 'hidden', width: '100%', minHeight: 300 }}
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
        <button
          onClick={startScanner}
          className="w-full flex flex-col items-center justify-center gap-3 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)] transition-colors border-2 border-dashed border-[var(--color-accent-amber)] rounded-lg cursor-pointer"
          style={{ height: 'clamp(160px, 35vw, 240px)' }}
        >
          <div className="p-4 bg-[var(--color-surface-1)] rounded-full mb-1">
            <QrCode size={36} className="text-[var(--color-accent-amber)]" />
          </div>
          <div style={{
            fontFamily: 'monospace', fontSize: 13, fontWeight: 700,
            color: 'var(--color-foreground)', textAlign: 'center', lineHeight: 1.6,
            letterSpacing: '0.04em',
          }}>
            TAP TO START SCANNER
            <br />
            <span style={{ fontSize: 10, fontWeight: 400, opacity: 0.6 }}>Point at cargo QR tag to scan</span>
          </div>
        </button>
      )}

      {/* Manual entry fallback */}
      <div className="flex gap-2">
        <input
          value={manualRef}
          onChange={e => setManualRef(e.target.value.toUpperCase())}
          onKeyDown={e => e.key === 'Enter' && handleManualLookup()}
          placeholder="Enter AWB / tag ref manually..."
          className="ehi-input"
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
          <div className="flex-1 bg-[rgba(16,185,129,0.07)] border border-[rgba(16,185,129,0.2)] rounded-[var(--radius-lg)] p-2 text-center">
            <div className="text-[18px] font-bold font-mono text-[var(--color-success)]">{batchSuccess}</div>
            <div className="text-[8px] font-mono text-[var(--color-muted)] uppercase tracking-wider">Logged</div>
          </div>
          <div className="flex-1 bg-[rgba(239,68,68,0.07)] border border-[rgba(239,68,68,0.2)] rounded-[var(--radius-lg)] p-2 text-center">
            <div className="text-[18px] font-bold font-mono text-[var(--color-error)]">{batchAlerts}</div>
            <div className="text-[8px] font-mono text-[var(--color-muted)] uppercase tracking-wider">Alerts</div>
          </div>
          <div className="flex-1 ehi-card p-2 text-center">
            <div className="text-[18px] font-bold font-mono text-[var(--color-foreground)]">{batchItems.length}</div>
            <div className="text-[8px] font-mono text-[var(--color-muted)] uppercase tracking-wider">Total</div>
          </div>
        </div>
      )}

      {/* Recent Scans List */}
      <div className="ehi-card">
        <div className="flex items-center justify-between mb-3 border-b border-[var(--color-border)] pb-2">
          <div className="flex items-center gap-2 ml-1">
            <span className="text-[13px] font-sans font-bold text-[var(--color-foreground)] tracking-wide">Recent Scans</span>
            <span className="text-[9px] font-mono bg-[var(--color-surface-2)] text-[var(--color-muted)] px-1.5 py-0.5 rounded-full ml-1">
              Last 5
            </span>
          </div>
          {successfulScans.length > 0 && (
            <button
              onClick={() => setShowBatch(true)}
              className="text-[10px] font-mono text-[var(--color-accent-amber)] hover:underline focus:outline-none cursor-pointer mr-1"
            >
              View Session ({batchItems.length})
            </button>
          )}
        </div>

        {successfulScans.length === 0 ? (
          <div className="text-center py-6 text-[var(--color-muted)] font-mono text-[11px]">
            No successful scans logged in this session yet
          </div>
        ) : (
          <div className="divide-y divide-[var(--color-border)]">
            {successfulScans.map((item, index) => {
              const isArrive = item.result === 'SUCCESS_ARRIVE';
              const badgeBg = isArrive ? 'rgba(16,185,129,0.1)' : 'rgba(37,99,235,0.1)';
              const badgeText = isArrive ? 'var(--color-success)' : 'var(--color-accent-cobalt)';
              const label = isArrive ? 'ARRIVE' : 'DEPART';

              return (
                <div key={index} className="flex items-center justify-between py-2 text-[12px]">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="p-1.5 rounded-lg bg-[var(--color-surface-2)] shrink-0">
                      <Package size={14} className="text-[var(--color-light-muted)]" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-bold text-[var(--color-foreground)] truncate">
                        {item.name}
                      </div>
                      <div className="font-mono text-[10px] text-[var(--color-muted)] truncate">
                        {item.ref}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5 shrink-0">
                    <span 
                      className="px-2 py-0.5 text-[9px] font-mono font-bold rounded uppercase"
                      style={{ backgroundColor: badgeBg, color: badgeText }}
                    >
                      {label}
                    </span>
                    <span className="text-[10px] font-mono text-[var(--color-muted)]">
                      {item.time}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

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
          mode={mode}
          onOk={dismissAlert}
          onSwitchToArrive={switchToArriveAndDismiss}
          onSwitchToDepart={() => { setMode('DEPART'); dismissAlert(); }}
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
          mode={mode}
          onOk={dismissAlert}
          onSwitchToArrive={dismissAlert}
        />
      )}

      {/* Success flash */}
      {successFlash && <SuccessFlash result={successFlash} />}

      {/* POD Overlay */}
      {activeDeliverCargo && (
        <ProofOfDeliveryForm
          awbNumber={activeDeliverCargo.awbNumber}
          consigneeName={activeDeliverCargo.consigneeName}
          user={user}
          onComplete={async (pod) => {
            // Also log the final event in supabase tracking_events
            await logScanEvent(activeDeliverCargo.awbNumber, 'DELIVER', currentHub, user.name, undefined);
            if (showToast) {
              showToast({ message: `Proof of Delivery saved for ${activeDeliverCargo.awbNumber}!`, type: 'success' });
            }
            dismissAlert();
          }}
          onCancel={dismissAlert}
        />
      )}
    </div>
  );
};
