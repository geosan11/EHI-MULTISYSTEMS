import { useState, useEffect, useRef, useCallback } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { QrCode, RefreshCw, Package, Plane, ArrowDown, ArrowUp, List, CheckCircle, Bell } from 'lucide-react';
import { User, ScanMode, ScanValidationResult, BatchScanItem, ScanResultType, ProofOfDelivery, TrackingEvent } from '../../lib/types';
import { validateScan, logScanEvent, fetchCargoByRef, fetchWrongDestinationAlerts, resolveWrongDestinationAlert } from '../../lib/scanLogic';
import { supabase } from '../../lib/supabase';

import { ArrivalsView } from './ArrivalsView';
import { IncomingToHub } from './IncomingToHub';

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

function getBrowserCameraInstructions(): { browser: string; steps: string[] } {
  const ua = navigator.userAgent;
  const isSafari = /Safari/.test(ua) && !/Chrome/.test(ua);
  const isFirefox = /Firefox/.test(ua);
  const isEdge = /Edg\//.test(ua);
  const isMobile = /iPhone|iPad|Android/.test(ua);

  if (isSafari && isMobile) {
    return {
      browser: 'Safari (iOS)',
      steps: [
        'Open the iOS Settings app',
        'Scroll down and tap Safari',
        'Tap Camera → Allow',
        'Return here and tap Try Again',
      ],
    };
  }
  if (isSafari) {
    return {
      browser: 'Safari',
      steps: [
        'In the menu bar, go to Safari → Settings',
        'Click the Websites tab',
        'Select Camera on the left',
        "Set this site's permission to Allow",
        'Return here and tap Try Again',
      ],
    };
  }
  if (isFirefox) {
    return {
      browser: 'Firefox',
      steps: [
        'Click the camera/lock icon in the address bar',
        'Next to Camera, click the × to clear the block',
        'Reload this page, then tap Start Scanner',
      ],
    };
  }
  if (isEdge) {
    return {
      browser: 'Edge',
      steps: [
        'Click the lock icon in the address bar',
        'Click Site permissions → Camera → Allow',
        'Return here and tap Try Again',
      ],
    };
  }
  // Chrome (desktop or Android)
  if (isMobile) {
    return {
      browser: 'Chrome (Android)',
      steps: [
        'Tap the lock icon in the address bar',
        'Tap Site settings → Camera → Allow',
        'Return here and tap Try Again',
      ],
    };
  }
  return {
    browser: 'Chrome',
    steps: [
      'Click the lock icon in the address bar',
      'Click Site settings → Camera → Allow',
      'Return here and tap Try Again',
    ],
  };
}

function CameraPermissionDenied({ onRetry }: { onRetry: () => void }) {
  const { browser, steps } = getBrowserCameraInstructions();

  const handleRetry = async () => {
    // Check if the user has re-enabled the permission before attempting to start
    try {
      const status = await navigator.permissions.query({ name: 'camera' as PermissionName });
      if (status.state === 'denied') {
        // Still blocked — don't start, just re-render the same panel
        return;
      }
    } catch {
      // Permissions API not supported (Safari) — try starting anyway
    }
    onRetry();
  };

  return (
    <div style={{
      background: 'rgba(239,68,68,0.06)',
      border: '1.5px solid rgba(239,68,68,0.25)',
      borderRadius: 12,
      padding: '20px 18px',
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{
          width: 36, height: 36, borderRadius: '50%',
          background: 'rgba(239,68,68,0.12)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 18 }}>🚫</span>
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-error)', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Camera Access Blocked
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 3, fontFamily: 'monospace' }}>
            {browser} needs permission to use your camera
          </div>
        </div>
      </div>

      <div style={{ paddingLeft: 2 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8, fontFamily: 'monospace' }}>
          To fix this:
        </div>
        <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {steps.map((step, i) => (
            <li key={i} style={{ fontSize: 12, color: 'var(--color-foreground)', fontFamily: 'monospace', lineHeight: 1.5 }}>
              {step}
            </li>
          ))}
        </ol>
      </div>

      <button
        onClick={handleRetry}
        style={{
          background: 'var(--color-surface-2)',
          border: '1px solid var(--color-border)',
          borderRadius: 8,
          padding: '10px 0',
          color: 'var(--color-foreground)',
          fontSize: 12,
          fontWeight: 700,
          fontFamily: 'monospace',
          cursor: 'pointer',
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
        }}
      >
        Try Again
      </button>
    </div>
  );
}

export const Scanner = ({
  user,
  transactions,
  showToast,
}: {
  user: User;
  transactions: any[];
  showToast?: (opts: any) => void;
}) => {
  const [mode, setMode] = useState<ScanMode>('DEPART');
  const [isScanning, setIsScanning] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [batchItems, setBatchItems] = useState<BatchScanItem[]>([]);
  const [showBatch, setShowBatch] = useState(false);
  const [manualRef, setManualRef] = useState('');
  const scannerRef = useRef<any>(null);
  const processingRef = useRef(false);
  // Held true while a WRONG_DESTINATION popup is visible — prevents re-scans until dismissed
  const alertActiveRef = useRef(false);

  // New states for batch queuing
  const [isBatchQueueMode, setIsBatchQueueMode] = useState(false);

  const BATCH_QUEUE_KEY = `ehi_scan_batch_queue_${user.hub_id || user.hub}`;

  const [batchQueue, setBatchQueue] = useState<{
    ref: string;
    name: string;
    result: ScanResultType;
    mode: ScanMode;
    destination?: string;
    time: string;
    kg?: number;
  }[]>(() => {
    try {
      const saved = localStorage.getItem(BATCH_QUEUE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Persist batch queue to localStorage whenever it changes
  useEffect(() => {
    try {
      if (batchQueue.length > 0) {
        localStorage.setItem(BATCH_QUEUE_KEY, JSON.stringify(batchQueue));
      } else {
        localStorage.removeItem(BATCH_QUEUE_KEY);
      }
    } catch {
      // localStorage unavailable — queue lives in memory only
    }
  }, [batchQueue]);

  const [submittingBatch, setSubmittingBatch] = useState(false);
  const [showQueueSummary, setShowQueueSummary] = useState(false);
  const [showIncomingView, setShowIncomingView] = useState(false);
  const [showArrivalsView, setShowArrivalsView] = useState(false);
  const [showWrongDestView, setShowWrongDestView] = useState(false);
  const [wrongDestTab, setWrongDestTab] = useState<'unresolved' | 'resolved'>('unresolved');
  const [wrongDestAlerts, setWrongDestAlerts] = useState<TrackingEvent[]>([]);
  const [wrongDestLoading, setWrongDestLoading] = useState(false);
  const [activePodCapture, setActivePodCapture] = useState<{ref: string, name: string, resultData: any} | null>(null);

  // Cargo tracking history
  const [showTrackView, setShowTrackView] = useState(false);
  const [trackRef, setTrackRef] = useState('');
  const [trackLoading, setTrackLoading] = useState(false);
  const [trackCargo, setTrackCargo] = useState<any>(null);
  const [trackEvents, setTrackEvents] = useState<any[]>([]);

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

  const loadWrongDestAlerts = useCallback(async (tab: 'unresolved' | 'resolved') => {
    setWrongDestLoading(true);
    try {
      setWrongDestAlerts(await fetchWrongDestinationAlerts(tab));
    } finally {
      setWrongDestLoading(false);
    }
  }, []);

  useEffect(() => {
    if (showWrongDestView) loadWrongDestAlerts(wrongDestTab);
  }, [showWrongDestView, wrongDestTab, loadWrongDestAlerts]);

  const handleResolveAlert = async (alertId: string) => {
    await resolveWrongDestinationAlert(alertId, user.name);
    setWrongDestAlerts(prev => prev.filter(a => a.id !== alertId));
    if (showToast) showToast({ message: 'Alert marked resolved.', type: 'success' });
  };

  const handleTrackLookup = async (ref?: string) => {
    const query = (ref || trackRef).trim().toUpperCase();
    if (isScanning) await stopScanner();
    setTrackRef(query);
    setTrackCargo(null);
    setTrackEvents([]);
    setShowTrackView(true);
    if (!query) { setTrackLoading(false); return; }
    setTrackLoading(true);
    try {
      const [cargo, eventsRes] = await Promise.all([
        fetchCargoByRef(query),
        supabase
          .from('tracking_events')
          .select('*')
          .eq('cargo_ref', query)
          .order('created_at', { ascending: true }),
      ]);
      setTrackCargo(cargo || null);
      setTrackEvents(eventsRes.data || []);
    } catch (err) {
      console.error('Track lookup error:', err);
    } finally {
      setTrackLoading(false);
    }
  };

  const handleConfirmSubmitBatch = async (itemsToSubmit = batchQueue) => {
    if (itemsToSubmit.length === 0) return;
    setSubmittingBatch(true);

    try {
      const results = await Promise.allSettled(
        itemsToSubmit.map(item =>
          logScanEvent(item.ref, item.mode, currentHub, user.name, item.destination)
        )
      );

      const succeeded = results.filter(r => r.status === 'fulfilled');
      const failed = results.filter(r => r.status === 'rejected');

      // Add only the successfully logged items to the session history
      const newlyLoggedItems: BatchScanItem[] = itemsToSubmit
        .filter((_, i) => results[i].status === 'fulfilled')
        .map(item => ({ ref: item.ref, name: item.name, result: item.result, time: item.time }));

      setBatchItems(prev => [...newlyLoggedItems, ...prev]);

      if (failed.length === 0) {
        if (showToast) showToast({ message: `Batch committed — ${succeeded.length} scans logged.`, type: 'success' });
        setBatchQueue([]);
        localStorage.removeItem(BATCH_QUEUE_KEY);
        setShowQueueSummary(false);
      } else {
        // Keep only the failed items in the queue so the agent can retry
        const failedRefs = new Set(
          itemsToSubmit.filter((_, i) => results[i].status === 'rejected').map(item => item.ref)
        );
        setBatchQueue(prev => prev.filter(item => failedRefs.has(item.ref)));
        if (showToast) {
          showToast({
            message: `${succeeded.length} logged, ${failed.length} failed — failed items remain in queue.`,
            type: 'error'
          });
        }
      }
    } catch (error) {
      console.error('Batch submit error:', error);
      if (showToast) showToast({ message: 'Batch submit failed. Please try again.', type: 'error' });
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
      const result = await validateScan(code, mode, currentHub, transactions);
      
      // Clear previous popup timer if any
      if (popupTimerRef.current) clearTimeout(popupTimerRef.current);

      let message = result.message || '';
      
      if (result.type === 'WRONG_DESTINATION') {
        playWarningBeep();
        // Wrong-destination alert must be manually dismissed — do not auto-close
        setPopup({
          visible: true,
          type: result.type,
          mode,
          entryRef: result.cargo?.awb || code,
          consignee: result.cargo?.name || 'Unknown',
          hubName: currentHub,
          message: result.message || ''
        });
        if (showToast) {
          showToast({
            message: `ALERT: Wrong station detected! ${result.message}`,
            type: 'error'
          });
        }
        return;
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

  const showToastRef = useRef(showToast);
  useEffect(() => { showToastRef.current = showToast; }, [showToast]);

  // Start camera scanner — just flips the flag; the effect below does the real work
  const startScanner = useCallback(() => {
    setPermissionDenied(false);
    setIsScanning(true);
  }, []);

  useEffect(() => {
    if (!isScanning || scannerRef.current) return;

    const scanner = new Html5Qrcode('qr-reader-div');
    // Set ref immediately so the !scannerRef.current guard blocks a second init
    // while start() is still resolving.
    scannerRef.current = scanner as any;

    scanner.start(
      { facingMode: 'environment' },
      { fps: 15, qrbox: { width: 220, height: 220 }, aspectRatio: 1.0 },
      (decodedText) => processCodeRef.current(decodedText),
      () => { /* ignore scan errors */ }
    ).catch((err: any) => {
      console.error('Scanner start error:', err);
      // Clear the ref so the next tap on "Start Scanner" can retry.
      scannerRef.current = null;
      setIsScanning(false);

      const name: string = err?.name || (typeof err === 'string' ? err : '');
      let msg = 'Camera failed to start. Tap again to retry.';
      if (name.includes('NotAllowed') || name.includes('PermissionDenied')) {
        setPermissionDenied(true);
        return; // persistent UI panel handles it — no toast needed
      } else if (name.includes('NotFound') || name.includes('DevicesNotFound')) {
        msg = 'No camera detected on this device.';
      } else if (name.includes('NotReadable') || name.includes('TrackStart') || name.includes('Abort')) {
        msg = 'Camera is busy — another app may be using it. Close it and tap again.';
      } else if (name.includes('NotSupported') || name.includes('OverConstrained')) {
        msg = 'Back camera not available. Try a different browser or device.';
      }

      if (showToastRef.current) {
        showToastRef.current({ message: msg, type: 'error' });
      }
    });
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

    const { ref, resultData } = pendingDelivery;
    const actualPin = pendingDelivery.expectedPin;

    // If cargo has no PIN assigned, skip PIN check entirely
    if (actualPin !== null) {
      if (!pinInput || pinInput.trim() === '') {
        if (showToast) showToast({ message: 'Please enter the pickup PIN.', type: 'error' });
        return;
      }
      if (pinInput.trim() !== actualPin) {
        if (showToast) showToast({ message: 'Incorrect PIN — check with the consignee.', type: 'error' });
        return;
      }
    }

    // Release the QR scanner's camera stream before the POD form opens its
    // own getUserMedia() call for the delivery photo — otherwise the device
    // is still held by the (now-unmounted) scanner and the second camera
    // request fails, surfacing on Android as a misleading NotAllowedError.
    if (isScanning) await stopScanner();

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

  if (showIncomingView) {
    return <IncomingToHub user={user} onBack={() => setShowIncomingView(false)} />;
  }

  // Arrivals List View
  if (showArrivalsView) {
    return <ArrivalsView user={user} onBack={() => setShowArrivalsView(false)} />;
  }

  // Wrong Destination Alert History
  if (showWrongDestView) {
    return (
      <div className="p-4 pb-20 space-y-4">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-3">
          <button
            onClick={() => setShowWrongDestView(false)}
            className="text-[11px] font-mono text-[var(--color-muted)] flex items-center gap-1 hover:text-[var(--color-foreground)] transition-colors cursor-pointer border-none bg-transparent"
          >
            ← BACK TO SCANNER
          </button>
          <span className="text-[10px] font-mono text-[var(--color-error)] uppercase tracking-wider font-bold">
            ⚠ WRONG DESTINATION ALERTS
          </span>
        </div>

        <div className="flex bg-[var(--color-surface-2)] p-1 rounded-lg shadow-inner" style={{ width: '100%' }}>
          {(['unresolved', 'resolved'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setWrongDestTab(tab)}
              style={{
                flex: 1, padding: '8px 4px',
                background: wrongDestTab === tab ? 'var(--color-surface-1)' : 'transparent',
                borderRadius: 8, border: 'none', cursor: 'pointer',
                color: wrongDestTab === tab ? 'var(--color-error)' : '#64748B',
              }}
              className="font-mono text-[11px] font-bold uppercase tracking-wide"
            >
              {tab === 'unresolved' ? 'Unresolved' : 'Resolved'}
            </button>
          ))}
        </div>

        {wrongDestLoading ? (
          <div className="flex justify-center py-10">
            <RefreshCw size={22} className="animate-spin text-[var(--color-error)]" />
          </div>
        ) : wrongDestAlerts.length === 0 ? (
          <div className="text-center py-10 text-[var(--color-muted)] text-[12px] font-mono border border-dashed border-[var(--color-border)] rounded-xl">
            {wrongDestTab === 'unresolved' ? 'No unresolved wrong-destination alerts.' : 'No resolved alerts yet.'}
          </div>
        ) : (
          <div className="space-y-2">
            {wrongDestAlerts.map(alert => (
              <div key={alert.id} className="ehi-card p-3 space-y-1.5 border border-[rgba(239,68,68,0.2)]">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-mono font-bold text-[var(--color-accent-amber)]">{alert.cargo_ref}</span>
                  <span className="text-[9px] font-mono text-[var(--color-muted)]">
                    {new Date(alert.created_at).toLocaleString('en-NG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <div className="text-[11px] font-mono text-[var(--color-foreground)] flex flex-wrap gap-x-3 gap-y-1">
                  {alert.previous_hub && <span>Came from: <span className="text-[var(--color-muted)]">{alert.previous_hub}</span></span>}
                  <span>Scanned at: <span className="text-[var(--color-error)]">{alert.hub_name}</span></span>
                  {alert.cargo_destination && <span>Belongs at: <span className="text-[var(--color-success)]">{alert.cargo_destination}</span></span>}
                </div>
                {alert.resolved ? (
                  <div className="text-[10px] font-mono text-[var(--color-success)] pt-1">
                    ✓ Resolved by {alert.resolved_by || 'Unknown'} · {alert.resolved_at ? new Date(alert.resolved_at).toLocaleString('en-NG') : ''}
                  </div>
                ) : (
                  <button
                    onClick={() => handleResolveAlert(alert.id)}
                    className="mt-1 w-full py-2 bg-[rgba(16,185,129,0.1)] text-[var(--color-success)] text-[10px] font-mono font-bold uppercase rounded border border-[rgba(16,185,129,0.25)] cursor-pointer hover:bg-[rgba(16,185,129,0.2)] transition-colors"
                  >
                    Mark Resolved
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Tracking history view
  if (showTrackView) {
    const statusColor = (type: string) =>
      type === 'ARRIVE' ? 'var(--color-success)' :
      type === 'DEPART' ? 'var(--color-accent-cobalt)' :
      type === 'DELIVER' ? '#a855f7' :
      'var(--color-error)';
    const statusLabel = (type: string) =>
      type === 'ARRIVE' ? '▼ ARRIVED' :
      type === 'DEPART' ? '▲ DEPARTED' :
      type === 'DELIVER' ? '✓ DELIVERED' :
      '⚠ ALERT';

    return (
      <div className="p-4 pb-20 space-y-4">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-3">
          <button
            onClick={() => setShowTrackView(false)}
            className="text-[11px] font-mono text-[var(--color-muted)] flex items-center gap-1 hover:text-[var(--color-foreground)] transition-colors cursor-pointer border-none bg-transparent"
          >
            ← BACK TO SCANNER
          </button>
          <span className="text-[10px] font-mono text-[var(--color-accent-amber)] uppercase tracking-wider font-bold">
            ● CARGO TRACKING
          </span>
        </div>

        {/* Search box */}
        <div className="flex gap-2">
          <input
            value={trackRef}
            onChange={e => setTrackRef(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && handleTrackLookup()}
            placeholder="Enter AWB / tag ref..."
            className="ehi-input"
          />
          <button
            onClick={() => handleTrackLookup()}
            disabled={!trackRef.trim() || trackLoading}
            className="h-11 px-4 bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] text-[11px] font-mono font-bold rounded disabled:opacity-50 border-none cursor-pointer"
          >
            {trackLoading ? '...' : 'SEARCH'}
          </button>
        </div>

        {trackLoading && (
          <div className="flex justify-center py-10">
            <RefreshCw size={22} className="animate-spin text-[var(--color-accent-amber)]" />
          </div>
        )}

        {!trackLoading && trackRef && !trackCargo && trackEvents.length === 0 && (
          <div className="text-center py-10 text-[var(--color-muted)] text-[12px] font-mono border border-dashed border-[var(--color-border)] rounded-xl">
            No records found for {trackRef}
          </div>
        )}

        {/* Cargo info card */}
        {trackCargo && (
          <div className="ehi-card p-4 space-y-2">
            <div className="text-[15px] font-bold text-[var(--color-foreground)]">
              {trackCargo.consignee_name || trackCargo.passenger_name || trackCargo.customer_name || 'Unknown Consignee'}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-mono text-[var(--color-muted)]">
              <span>REF: <span className="text-[var(--color-accent-amber)]">{trackRef}</span></span>
              {trackCargo.route && <span>ROUTE: {trackCargo.route}</span>}
              {trackCargo.total_pcs && <span>{trackCargo.total_pcs} PCS</span>}
              {trackCargo.total_kg && <span>{trackCargo.total_kg} KG</span>}
              {trackCargo.airline && <span>✈ {trackCargo.airline}</span>}
            </div>
            {trackCargo.status && (
              <div className="text-[10px] font-mono font-bold uppercase tracking-wider mt-1"
                style={{ color: trackCargo.status === 'Delivered' ? 'var(--color-success)' : 'var(--color-accent-amber)' }}>
                Current status: {trackCargo.status}
              </div>
            )}
          </div>
        )}

        {/* Event timeline */}
        {trackEvents.length > 0 && (
          <div className="space-y-0">
            <div className="text-[10px] font-mono text-[var(--color-muted)] uppercase tracking-wider mb-3">
              Event Timeline ({trackEvents.length} events)
            </div>
            <div className="relative">
              {/* Vertical line */}
              <div className="absolute left-[11px] top-4 bottom-4 w-px bg-[var(--color-border)]" />
              <div className="space-y-3">
                {trackEvents.map((ev, i) => {
                  const isLast = i === trackEvents.length - 1;
                  const color = statusColor(ev.event_type);
                  return (
                    <div key={ev.id || i} className="flex gap-4 items-start relative">
                      <div
                        className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center border-2 z-10"
                        style={{ background: 'var(--color-obsidian)', borderColor: color }}
                      >
                        <div className="w-2 h-2 rounded-full" style={{ background: color }} />
                      </div>
                      <div className={`ehi-card p-3 flex-1 ${isLast ? 'border-[var(--color-accent-amber)]/30' : ''}`}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-mono font-bold uppercase tracking-wider" style={{ color }}>
                            {statusLabel(ev.event_type)}
                          </span>
                          <span className="text-[10px] font-mono text-[var(--color-muted)] shrink-0">
                            {new Date(ev.created_at).toLocaleString('en-NG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <div className="text-[12px] font-sans text-[var(--color-foreground)] mt-0.5">{ev.hub_name}</div>
                        {ev.scanned_by_name && (
                          <div className="text-[10px] font-mono text-[var(--color-muted)] mt-0.5">by {ev.scanned_by_name}</div>
                        )}
                        {ev.event_type === 'WRONG_DESTINATION_ALERT' && ev.alert_reason && (
                          <div className="text-[10px] font-mono text-[var(--color-error)] mt-1 bg-[rgba(239,68,68,0.07)] px-2 py-1 rounded">
                            {ev.alert_reason}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    );
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
    <div className="p-4 space-y-4" style={{ paddingBottom: 'calc(96px + env(safe-area-inset-bottom))' }}>

      {/* Section header */}
      <div className="text-[9px] font-mono text-[var(--color-muted)] tracking-[0.12em] uppercase border-b border-[rgba(255,255,255,0.07)] pb-2">
        ▸ QR SCAN & TRACKING
      </div>

      {/* Hub indicator */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-[10px] font-mono text-[var(--color-accent-amber)] truncate">
          📍 {currentHub}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('ehi-nav', { detail: 'IncomingToHub' }))}
            className="flex items-center gap-1.5 text-[10px] sm:text-[11px] font-mono font-semibold text-[var(--color-accent-cobalt)] hover:text-[var(--color-foreground)] bg-[rgba(59,130,246,0.1)] hover:bg-[rgba(59,130,246,0.2)] border border-[rgba(59,130,246,0.2)] px-2.5 py-1.5 rounded-full transition-colors cursor-pointer whitespace-nowrap"
          >
            <Plane size={12} />
            Incoming
          </button>
          <button
            onClick={() => setShowArrivalsView(true)}
            className="flex items-center gap-1.5 text-[10px] sm:text-[11px] font-mono font-semibold text-[var(--color-success)] hover:text-[var(--color-foreground)] bg-[rgba(16,185,129,0.1)] hover:bg-[rgba(16,185,129,0.2)] border border-[rgba(16,185,129,0.2)] px-2.5 py-1.5 rounded-full transition-colors cursor-pointer whitespace-nowrap"
          >
            <ArrowDown size={12} />
            Arrivals
          </button>
          <button
            onClick={() => setShowWrongDestView(true)}
            className="flex items-center gap-1.5 text-[10px] sm:text-[11px] font-mono font-semibold text-[var(--color-error)] hover:text-[var(--color-foreground)] bg-[rgba(239,68,68,0.1)] hover:bg-[rgba(239,68,68,0.2)] border border-[rgba(239,68,68,0.2)] px-2.5 py-1.5 rounded-full transition-colors cursor-pointer whitespace-nowrap"
          >
            ⚠ Alerts
          </button>
          {batchItems.length > 0 && (
            <button
              onClick={() => setShowBatch(true)}
              className="flex items-center gap-1.5 text-[10px] font-mono text-[var(--color-light-muted)] border-none bg-transparent cursor-pointer whitespace-nowrap"
            >
              <List size={11} />
              {batchSuccess} ✓ {batchAlerts > 0 && <span className="text-[var(--color-error)]">| {batchAlerts} alerts</span>}
            </button>
          )}
        </div>
      </div>

      {/* Mode Toggle — ARRIVE / DEPART / DELIVER */}
      <div className="flex bg-[var(--color-surface-2)] p-1 rounded-lg mb-6 shadow-inner" style={{ width: '100%' }}>
        {(['DEPART', 'ARRIVE', 'DELIVER'] as ScanMode[]).map((m) => {
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
      ) : permissionDenied ? (
        <CameraPermissionDenied onRetry={startScanner} />
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
          className="h-11 px-4 bg-[var(--color-surface-2)] text-[var(--color-foreground)] text-[11px] font-mono rounded disabled:opacity-50 border border-[var(--color-border)] cursor-pointer hover:bg-[var(--color-surface-3)] transition-colors shrink-0"
        >
          LOOKUP
        </button>
        <button
          onClick={() => {
            if (manualRef.trim()) {
              handleTrackLookup(manualRef.trim());
            } else {
              setShowTrackView(true);
            }
          }}
          className="h-11 px-4 bg-[rgba(245,158,11,0.12)] text-[var(--color-accent-amber)] text-[11px] font-mono rounded border border-[rgba(245,158,11,0.3)] cursor-pointer hover:bg-[rgba(245,158,11,0.2)] transition-colors shrink-0"
        >
          TRACK
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
      <div className="ehi-card p-3">
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

      {/* --- SCAN RESULT POPUP --- */}
      {/* Backdrop for WRONG_DESTINATION — requires manual dismiss */}
      {popup.visible && popup.type === 'WRONG_DESTINATION' && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 49, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(3px)' }}
          onClick={dismissAlert}
        />
      )}
      <div
        style={{
          position: 'fixed',
          bottom: popup.type === 'WRONG_DESTINATION' ? '50%' : 80,
          transform: popup.type === 'WRONG_DESTINATION'
            ? (popup.visible ? 'translate(-50%, 50%)' : 'translate(-50%, 120%)')
            : (popup.visible ? 'translateY(0)' : 'translateY(200%)'),
          left: popup.type === 'WRONG_DESTINATION' ? '50%' : 16,
          right: popup.type === 'WRONG_DESTINATION' ? 'auto' : 16,
          width: popup.type === 'WRONG_DESTINATION' ? 'calc(100vw - 32px)' : 'auto',
          maxWidth: popup.type === 'WRONG_DESTINATION' ? 380 : 'none',
          zIndex: 50,
          transition: 'transform 220ms cubic-bezier(0.34,1.56,0.64,1), bottom 220ms ease, opacity 220ms',
          opacity: popup.visible ? 1 : 0,
          pointerEvents: popup.visible ? 'auto' : 'none',
        }}
      >
        {(() => {
          const isSuccess = popup.type.startsWith('SUCCESS');
          const isWrongDest = popup.type === 'WRONG_DESTINATION';
          const isAlready = popup.type === 'ALREADY_PROCESSED';
          const isError = popup.type === 'NOT_FOUND' || popup.type === 'ERROR' || popup.type === 'NOT_LOGGED_IN';

          const accentColor = isSuccess
            ? (popup.mode === 'DEPART' ? '#3B82F6' : popup.mode === 'DELIVER' ? '#a855f7' : '#10B981')
            : isWrongDest ? '#EF4444'
            : isAlready ? '#F59E0B'
            : '#EF4444';

          const bigIcon = isWrongDest ? '⚠' : isAlready ? '↩'
            : popup.type === 'NOT_LOGGED_IN' ? '⟳'
            : isError ? '✕'
            : popup.mode === 'ARRIVE' ? '▼' : popup.mode === 'DEPART' ? '▲' : '✓';

          const headline = isWrongDest
            ? 'WRONG STATION'
            : isAlready
              ? 'ALREADY LOGGED'
              : popup.type === 'NOT_LOGGED_IN'
                ? 'ARRIVE FIRST'
                : isError
                  ? (popup.type === 'NOT_FOUND' ? 'NOT FOUND' : 'SCAN ERROR')
                  : popup.mode === 'ARRIVE'
                    ? 'ARRIVED'
                    : popup.mode === 'DEPART'
                      ? 'DEPARTED'
                      : 'DELIVERED';

          return (
            <div style={{
              background: isWrongDest
                ? 'linear-gradient(135deg, #1a0505 0%, #1c0808 100%)'
                : isAlready
                  ? 'linear-gradient(135deg, #1a1200 0%, #1c1400 100%)'
                  : isError
                    ? 'linear-gradient(135deg, #110505 0%, #180606 100%)'
                    : popup.mode === 'DEPART'
                      ? 'linear-gradient(135deg, #050d1a 0%, #070f1f 100%)'
                      : popup.mode === 'DELIVER'
                        ? 'linear-gradient(135deg, #0f0518 0%, #120620 100%)'
                        : 'linear-gradient(135deg, #031209 0%, #051510 100%)',
              border: `2px solid ${accentColor}`,
              borderRadius: 16,
              boxShadow: `0 0 32px ${accentColor}33, 0 8px 32px rgba(0,0,0,0.6)`,
              padding: '20px 20px 16px',
              position: 'relative',
              overflow: 'hidden',
            }}>
              {/* Glow pulse behind icon */}
              <div style={{
                position: 'absolute', top: -24, right: -24,
                width: 100, height: 100, borderRadius: '50%',
                background: accentColor,
                opacity: 0.08,
                filter: 'blur(24px)',
              }} />

              {/* Top row: icon + headline + dismiss */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                {/* Big status icon circle */}
                <div style={{
                  width: 48, height: 48, borderRadius: '50%',
                  background: `${accentColor}22`,
                  border: `2px solid ${accentColor}66`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <span style={{ fontSize: 22, color: accentColor, fontWeight: 900, lineHeight: 1 }}>
                    {bigIcon}
                  </span>
                </div>

                {/* Headline + hub */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 20, fontWeight: 900, color: accentColor,
                    fontFamily: 'monospace', letterSpacing: '0.05em', lineHeight: 1.1,
                  }}>
                    {headline}
                  </div>
                  <div style={{
                    fontSize: 11, color: 'rgba(255,255,255,0.45)',
                    fontFamily: 'monospace', marginTop: 2, letterSpacing: '0.04em',
                  }}>
                    {popup.hubName}
                  </div>
                </div>

                {/* Dismiss button (always visible for WRONG_DESTINATION, others auto-dismiss) */}
                {(isWrongDest || isAlready || isError) && (
                  <button
                    onClick={dismissAlert}
                    style={{
                      width: 28, height: 28, borderRadius: '50%',
                      background: 'rgba(255,255,255,0.07)',
                      border: '1px solid rgba(255,255,255,0.12)',
                      color: 'rgba(255,255,255,0.5)',
                      fontSize: 14, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* Divider */}
              <div style={{ height: 1, background: `${accentColor}30`, marginBottom: 12 }} />

              {/* Cargo info */}
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                <div style={{
                  fontFamily: 'monospace', fontSize: 15, fontWeight: 800,
                  color: 'rgba(255,255,255,0.9)', letterSpacing: '0.04em',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {popup.entryRef || '---'}
                </div>
              </div>
              <div style={{
                fontSize: 13, color: 'rgba(255,255,255,0.65)',
                fontFamily: 'sans-serif', overflow: 'hidden',
                textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                marginBottom: isWrongDest ? 10 : 0,
              }}>
                {popup.consignee || 'Unknown Consignee'}
              </div>

              {/* Message — shown boldly for WRONG_DESTINATION, subtly for others */}
              {popup.message && (
                <div style={{
                  marginTop: 8,
                  padding: isWrongDest ? '10px 12px' : '6px 10px',
                  background: `${accentColor}18`,
                  borderRadius: 8,
                  fontSize: isWrongDest ? 13 : 11,
                  fontFamily: 'monospace',
                  color: isWrongDest ? accentColor : 'rgba(255,255,255,0.5)',
                  fontWeight: isWrongDest ? 700 : 400,
                  lineHeight: 1.4,
                }}>
                  {popup.message}
                </div>
              )}

              {/* WRONG_DESTINATION: Switch to ARRIVE shortcut */}
              {isWrongDest && (
                <button
                  onClick={switchToArriveAndDismiss}
                  style={{
                    marginTop: 12, width: '100%',
                    padding: '11px',
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: 10, cursor: 'pointer',
                    color: 'rgba(255,255,255,0.7)',
                    fontSize: 12, fontFamily: 'monospace', fontWeight: 700,
                    letterSpacing: '0.04em',
                  }}
                >
                  Switch to ARRIVE mode instead
                </button>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
};
