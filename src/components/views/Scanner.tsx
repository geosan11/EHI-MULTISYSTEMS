import { useState, useEffect, useRef, useCallback } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { QrCode, RefreshCw, Package, Plane, TrendingUp, ArrowDown, ArrowUp, List, CheckCircle } from 'lucide-react';
import { User, ScanMode, ScanValidationResult, BatchScanItem, ScanResultType, ProofOfDelivery } from '../../lib/types';
import { validateScan, logScanEvent } from '../../lib/scanLogic';
// imports removed

import { ArrivalsView } from './ArrivalsView';

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

// Play a distinct warning/alarm double pulse for wrong destination alerts
const playWarningBeep = () => {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const audioCtx = new AudioContextClass();
    
    const playPulse = (time: number, freq: number) => {
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      oscillator.type = 'sawtooth';
      oscillator.frequency.setValueAtTime(freq, time);
      gainNode.gain.setValueAtTime(0.0, time);
      gainNode.gain.linearRampToValueAtTime(0.15, time + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.001, time + 0.18);
      oscillator.start(time);
      oscillator.stop(time + 0.2);
    };
    
    playPulse(audioCtx.currentTime, 180);
    playPulse(audioCtx.currentTime + 0.25, 150);
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
  // Unused state removed
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
  const [showArrivalsView, setShowArrivalsView] = useState(false);
  const [activePodCapture, setActivePodCapture] = useState<{ref: string, name: string, resultData: any} | null>(null);

  // Delivery PIN states
  const [pendingDelivery, setPendingDelivery] = useState<{ref: string, expectedPin: string | null, resultData: any} | null>(null);
  const [pinInput, setPinInput] = useState('');

  // New states for the slide-up popup
  const [popup, setPopup] = useState<{
    visible: boolean;
    type: ScanResultType;
    mode: ScanMode;
    entryRef: string;
    consignee: string;
    hubName: string;
    message: string;
  }>({
    visible: false,
    type: 'ERROR',
    mode: 'ARRIVE',
    entryRef: '',
    consignee: '',
    hubName: '',
    message: ''
  });
  const popupTimerRef = useRef<any>(null);
  const lastScannedRef = useRef<{code: string, time: number}>({ code: '', time: 0 });

  const currentHub = user.hub;
  const batchSuccess = batchItems.filter(b => b.result.startsWith('SUCCESS')).length;
  const batchAlerts = batchItems.filter(b => !b.result.startsWith('SUCCESS') && b.result !== 'ALREADY_PROCESSED').length;
  const successfulScans = batchItems
    .filter(item => item.result === 'SUCCESS_ARRIVE' || item.result === 'SUCCESS_DEPART' || item.result === 'SUCCESS_DELIVER')
    .slice(0, 10);

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
    const now = Date.now();
    if (lastScannedRef.current.code === code && (now - lastScannedRef.current.time) < 1500) {
      return;
    }
    lastScannedRef.current = { code, time: now };

    if (processingRef.current) return;
    processingRef.current = true;
    setProcessing(true);

    try {
      // User-requested 2-second delay to simulate verification and show location / alert
      await new Promise(resolve => setTimeout(resolve, 2000));

      const result = await validateScan(code, mode, currentHub, transactions);
      
      // Clear previous popup timer if any
      if (popupTimerRef.current) clearTimeout(popupTimerRef.current);

      let message = result.message || '';
      
      if (result.type === 'WRONG_DESTINATION') {
        playWarningBeep();
        if (showToast) {
          showToast({
            message: `ALERT: Wrong station detected! ${result.message}`,
            type: 'error'
          });
        }
      } else if (result.type === 'SUCCESS_DELIVER' || result.type === 'SUCCESS_ARRIVE' || result.type === 'SUCCESS_DEPART') {
        playBeep();
        
        if (result.type === 'SUCCESS_DELIVER') {
          setPendingDelivery({ ref: code, expectedPin: result.cargo?.pickupPin || null, resultData: result });
          processingRef.current = false;
          setProcessing(false);
          return;
        } else if (result.type === 'SUCCESS_ARRIVE') {
          message = 'Status updated to: ARRIVED';
        } else if (result.type === 'SUCCESS_DEPART') {
          message = 'Status updated to: IN TRANSIT';
        }
        
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
            setPopup({
              visible: true,
              type: 'ALREADY_PROCESSED',
              mode,
              entryRef: code,
              consignee: result.cargo?.name || 'Unknown',
              hubName: currentHub,
              message: `${code} is already in the batch queue for ${mode}`,
            });
            return;
          }
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
        }
      }

      setPopup({
        visible: true,
        type: result.type,
        mode,
        entryRef: result.cargo?.awb || code,
        consignee: result.cargo?.name || 'Unknown',
        hubName: currentHub,
        message
      });

      // Auto dismiss popup after 3 seconds to let users read easily
      popupTimerRef.current = setTimeout(() => {
        setPopup(prev => ({ ...prev, visible: false }));
      }, 3000);

    } catch (err) {
      console.error('Scan processing error:', err);
      if (popupTimerRef.current) clearTimeout(popupTimerRef.current);
      setPopup({
        visible: true,
        type: 'ERROR',
        mode,
        entryRef: code,
        consignee: 'Unknown',
        hubName: currentHub,
        message: 'An unexpected error occurred while processing.'
      });
      popupTimerRef.current = setTimeout(() => {
        setPopup(prev => ({ ...prev, visible: false }));
      }, 2000);
    } finally {
      setProcessing(false);
      processingRef.current = false;
    }
  }, [mode, currentHub, user.name, isBatchQueueMode, transactions]);

  const processCodeRef = useRef(processCode);

  useEffect(() => {
    processCodeRef.current = processCode;
  }, [processCode]);

  // Start camera scanner
  const startScanner = useCallback(async () => {
    // Request camera permission explicitly on iOS
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      stream.getTracks().forEach(track => track.stop());
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
        (decodedText) => processCodeRef.current(decodedText),
        () => { /* ignore */ }
      ).catch(err => {
        console.error("Scanner start error:", err);
        setIsScanning(false);
      });

      scannerRef.current = scanner as any;
    }
  }, [isScanning]);

  const stopScanner = useCallback(async () => {
    // Step 1: Tell the library to clean up its DOM and internal state.
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
      } catch {
        // Acceptable if it throws
      }
      try {
        scannerRef.current.clear();
      } catch {
        // ignore
      }
      scannerRef.current = null;
    }

    // Step 2: Stop all video tracks directly on the DOM element as a fallback
    // This ensures the camera LED turns off even if the library failed.
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

    // Step 3: Reset all scanning state
    setIsScanning(false);
    setProcessing(false);
    processingRef.current = false;
    setPopup(prev => ({ ...prev, visible: false }));
    if (popupTimerRef.current) clearTimeout(popupTimerRef.current);
  }, []);

  // Resume scanner after alert dismissed
  const dismissAlert = useCallback(async () => {
    processingRef.current = false;
    setPopup(prev => ({ ...prev, visible: false }));
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

  const handleCommitDelivery = async () => {
    if (!pendingDelivery) return;

    if (!pinInput || pinInput.trim() === '') {
      if (showToast) showToast({ message: 'Please enter the pickup PIN.', type: 'error' });
      return;
    }

    const { ref, resultData } = pendingDelivery;
    let actualPin = pendingDelivery.expectedPin;

    if (!actualPin && resultData.cargo?.remark) {
      try {
        const parsed = JSON.parse(resultData.cargo.remark);
        if (parsed && parsed.pin) actualPin = parsed.pin;
      } catch (e) {}
    }

    if (pinInput !== actualPin) {
      if (showToast) showToast({ message: 'Incorrect PIN provided.', type: 'error' });
      return;
    }
    
    // Switch to POD form
    setActivePodCapture({ ref, name: resultData.cargo?.name || 'Unknown', resultData });
    setPendingDelivery(null);
    setPinInput('');
  };

  const handlePodComplete = async () => {
    if (!activePodCapture) return;
    const { ref, resultData } = activePodCapture;
    const message = 'Status updated to: DELIVERED';

    if (isBatchQueueMode) {
      let isDuplicate = false;
      setBatchQueue(prev => {
        if (prev.some(item => item.ref === ref && item.mode === 'DELIVER')) {
          isDuplicate = true;
          return prev;
        }
        return [{
          ref: ref,
          name: resultData.cargo?.name || ref,
          result: resultData.type,
          mode: 'DELIVER',
          destination: resultData.cargo?.destination,
          time: new Date().toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' }),
          kg: resultData.cargo?.kg,
        }, ...prev];
      });

      if (isDuplicate) {
        setPopup({
          visible: true,
          type: 'ALREADY_PROCESSED',
          mode: 'DELIVER',
          entryRef: ref,
          consignee: resultData.cargo?.name || 'Unknown',
          hubName: currentHub,
          message: `${ref} is already in the batch queue for DELIVER`,
        });
        setActivePodCapture(null);
        return;
      }
    } else {
      await logScanEvent(
        ref,
        'DELIVER',
        currentHub,
        user.name,
        resultData.cargo?.destination
      );

      setBatchItems(prev => [{
        ref: ref,
        name: resultData.cargo?.name || ref,
        result: resultData.type,
        time: new Date().toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })
      }, ...prev].slice(0, 50));
    }

    setPopup({
      visible: true,
      type: resultData.type,
      mode: 'DELIVER',
      entryRef: ref,
      consignee: resultData.cargo?.name || 'Unknown',
      hubName: currentHub,
      message
    });

    if (showToast) showToast({ message, type: 'success' });
    
    // Auto dismiss success popup
    popupTimerRef.current = setTimeout(() => {
      setPopup(prev => ({ ...prev, visible: false }));
    }, 4000);

    setActivePodCapture(null);
  };

  // Stop scanner on unmount
  useEffect(() => {
    return () => {
      // Step 1: Tell the library to stop
      if (scannerRef.current) {
        try { 
          scannerRef.current.stop().catch(() => {});
        } catch { /* ignore */ }
        try { scannerRef.current.clear(); } catch { /* ignore */ }
        scannerRef.current = null;
      }
      
      // Step 3: Stop camera tracks directly
      document.querySelectorAll<HTMLVideoElement>(
        '#qr-reader-div video'
      ).forEach(video => {
        if (video.srcObject instanceof MediaStream) {
          video.srcObject.getTracks().forEach(t => t.stop());
          video.srcObject = null;
        }
      });
      
      if (popupTimerRef.current) clearTimeout(popupTimerRef.current);
    };
  }, []);

  // Arrivals List View
  if (showArrivalsView) {
    return <ArrivalsView user={user} onBack={() => setShowArrivalsView(false)} />;
  }

  if (activePodCapture) {
    return (
      <div className="fixed inset-0 z-[150] bg-[var(--color-bg)] flex flex-col">
        <ProofOfDeliveryForm
          awbNumber={activePodCapture.ref}
          consigneeName={activePodCapture.name}
          user={user}
          onComplete={handlePodComplete}
          onCancel={() => setActivePodCapture(null)}
        />
      </div>
    );
  }

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
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowArrivalsView(true)}
            className="flex items-center gap-1.5 text-[11px] font-mono font-semibold text-[var(--color-success)] hover:text-white bg-[rgba(16,185,129,0.1)] hover:bg-[rgba(16,185,129,0.2)] border border-[rgba(16,185,129,0.2)] px-3 py-1.5 rounded-full transition-colors cursor-pointer"
          >
            <ArrowDown size={12} />
            Hub Arrivals
          </button>
          {batchItems.length > 0 && (
            <button
              onClick={() => setShowBatch(true)}
              className="flex items-center gap-1.5 text-[10px] font-mono text-[var(--color-light-muted)] border-none bg-transparent cursor-pointer"
            >
              <List size={11} />
              {batchSuccess} ✓ {batchAlerts > 0 && <span className="text-[var(--color-error)]">| {batchAlerts} alerts</span>}
            </button>
          )}
        </div>
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
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', gap: 4,
                transition: 'all 0.2s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon size={16} />
                <span style={{
                  fontFamily: 'monospace', fontSize: 13,
                  fontWeight: active ? 800 : 500,
                  letterSpacing: '0.04em',
                }}>
                  {m === 'ARRIVE' ? 'Arrive' : m === 'DEPART' ? 'Depart' : 'Delivers'}
                </span>
              </div>
              {active && (
                <span style={{ fontSize: 9, fontFamily: 'monospace', opacity: 0.7, textAlign: 'center', lineHeight: 1.3 }}>
                  {m === 'ARRIVE' ? 'Cargo landed here' : m === 'DEPART' ? 'Sending to airline' : 'Handover to consignee'}
                </span>
              )}
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
              Last 10
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
              const isDeliver = item.result === 'SUCCESS_DELIVER';
              const badgeBg = isArrive ? 'rgba(16,185,129,0.1)' : isDeliver ? 'rgba(168,85,247,0.1)' : 'rgba(37,99,235,0.1)';
              const badgeText = isArrive ? 'var(--color-success)' : isDeliver ? '#a855f7' : 'var(--color-accent-cobalt)';
              const label = isArrive ? 'ARRIVE' : isDeliver ? 'DELIVER' : 'DEPART';

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

      {/* --- PIN MODAL FOR DELIVERY --- */}
      {pendingDelivery && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 100,
          background: 'rgba(11,15,25,0.8)',
          backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 16
        }}>
          <div className="bg-[var(--color-surface-card)] rounded-[var(--radius-lg)] border border-[var(--color-border)] p-6 w-full max-w-[320px] shadow-2xl animate-in fade-in zoom-in duration-200">
            <div className="flex flex-col items-center mb-5">
              <div className="w-12 h-12 bg-[rgba(168,85,247,0.1)] rounded-full flex items-center justify-center mb-3">
                <CheckCircle size={24} color="#a855f7" />
              </div>
              <h2 className="text-[16px] font-sans font-bold text-[var(--color-foreground)] tracking-tight">Delivery Verification</h2>
              <p className="text-[11px] font-mono text-[var(--color-muted)] text-center mt-1">
                Enter the pickup PIN for:<br/>
                <span className="text-[var(--color-accent-amber)] font-bold">{pendingDelivery.ref}</span>
              </p>
            </div>

            <input
              type="text"
              autoFocus
              value={pinInput}
              onChange={e => setPinInput(e.target.value)}
              placeholder="Enter 4-6 digit PIN"
              className="ehi-input text-center text-lg tracking-widest font-mono mb-4"
              maxLength={8}
            />

            <div className="flex gap-2">
              <button
                onClick={() => {
                  setPendingDelivery(null);
                  setPinInput('');
                }}
                className="flex-1 py-3 bg-[var(--color-surface-2)] text-[var(--color-foreground)] text-[12px] font-mono font-bold rounded-[var(--radius-md)] cursor-pointer hover:bg-[var(--color-surface-3)] transition-colors"
              >
                CANCEL
              </button>
              <button
                onClick={handleCommitDelivery}
                disabled={!pinInput.trim()}
                className="flex-1 py-3 bg-[#a855f7] text-white text-[12px] font-mono font-bold rounded-[var(--radius-md)] cursor-pointer hover:bg-opacity-90 transition-colors disabled:opacity-50"
              >
                CONFIRM
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- SLIDE-UP SCAN RESULT POPUP --- */}
      <div 
        style={{
          position: 'fixed',
          bottom: 80, // Above bottom nav
          left: 16,
          right: 16,
          backgroundColor: 'var(--color-surface-card)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-card)',
          transform: popup.visible ? 'translateY(0)' : 'translateY(200%)',
          transition: 'transform 200ms ease-out',
          zIndex: 50,
          borderLeftWidth: 4,
          borderLeftStyle: 'solid',
          borderLeftColor: popup.type.startsWith('SUCCESS') 
            ? 'var(--color-success)' 
            : popup.type === 'WRONG_DESTINATION' || popup.type === 'ALREADY_PROCESSED' 
              ? 'var(--color-accent-amber)' 
              : 'var(--color-error)'
        }}
        className="p-4"
      >
        {/* Row 1 — Status badge + scan mode */}
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xl">
            {popup.mode === 'DEPART' ? '🛫' : popup.mode === 'ARRIVE' ? '🛬' : '✅'}
          </span>
          <span className="font-bold text-[13px] text-[var(--color-foreground)]">
            {popup.mode === 'DEPART' 
              ? `Departed ${popup.hubName}` 
              : popup.mode === 'ARRIVE' 
                ? `Arrived at ${popup.hubName}` 
                : 'Delivered to Consignee'}
          </span>
        </div>

        {/* Row 2 — Cargo identity */}
        <div className="mb-3">
          <div className="font-mono font-bold text-base text-[var(--color-foreground)] tracking-wide">
            {popup.entryRef || '---'}
          </div>
          <div className="text-[11px] text-[var(--color-muted)] mt-1 truncate">
            {popup.consignee || 'Unknown Consignee'}
          </div>
        </div>

        {/* Row 3 — Status update line */}
        <div 
          className="text-[11px] font-mono font-bold mt-2"
          style={{ 
            color: popup.type.startsWith('SUCCESS') 
              ? popup.mode === 'DEPART' ? 'var(--color-accent-cobalt)' : 'var(--color-success)'
              : popup.type === 'WRONG_DESTINATION' || popup.type === 'ALREADY_PROCESSED' 
                ? 'var(--color-accent-amber)' 
                : 'var(--color-error)'
          }}
        >
          {popup.message || 'Error details missing'}
        </div>
      </div>
    </div>
  );
};
