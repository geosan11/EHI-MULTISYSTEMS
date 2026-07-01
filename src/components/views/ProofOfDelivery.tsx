import { useRef, useState, useEffect } from 'react';
import SignatureCanvas from 'react-signature-canvas';
import { Camera, RefreshCw, X, ShieldCheck } from 'lucide-react';
import { db } from '../../lib/db';
import { User, ProofOfDelivery } from '../../lib/types';

interface PODProps {
  awbNumber: string;
  consigneeName: string;
  user: User;
  onComplete: (pod: ProofOfDelivery) => void;
  onCancel: () => void;
}

export const ProofOfDeliveryForm = ({ awbNumber, consigneeName, user, onComplete, onCancel }: PODProps) => {
  const [receiverName, setReceiverName] = useState('');
  const [receiverPhone, setReceiverPhone] = useState('');
  const [idType, setIdType] = useState<ProofOfDelivery['receivedByIdType'] | ''>('');
  const [idNumber, setIdNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [isPhotoActive, setIsPhotoActive] = useState(false);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  
  const signatureRef = useRef<SignatureCanvas>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    
    if (isPhotoActive && videoRef.current) {
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        .then((s) => {
          stream = s;
          if (videoRef.current) videoRef.current.srcObject = s;
        })
        .catch(err => {
          console.error("Camera error:", err);
          setIsPhotoActive(false);
        });
    }

    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [isPhotoActive]);

  const handleCapture = () => {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(videoRef.current, 0, 0);
      setCapturedPhoto(canvas.toDataURL('image/jpeg'));
      setIsPhotoActive(false);
    }
  };

  const clearSignature = () => {
    signatureRef.current?.clear();
  };

  const handleConfirm = () => {
    if (!receiverName || signatureRef.current?.isEmpty()) return;

    const savePOD = async (latitude?: number, longitude?: number) => {
      const pod: ProofOfDelivery = {
        id: 'POD-' + Date.now().toString(36).toUpperCase(),
        awbNumber,
        consigneeName,
        deliveredBy: user.name,
        receivedByName: receiverName.trim(),
        receivedByPhone: receiverPhone || undefined,
        receivedByIdType: idType ? (idType as ProofOfDelivery['receivedByIdType']) : undefined,
        receivedByIdNumber: idNumber || undefined,
        signatureData: signatureRef.current?.toDataURL('image/png') || '',
        photoData: capturedPhoto || undefined,
        deliveredAt: new Date().toISOString(),
        hubName: user.hub,
        notes: notes || undefined,
        gpsLatitude: latitude,
        gpsLongitude: longitude,
      };

      await db.proof_of_delivery.add(pod);
      // NOTE: Proof of Delivery is currently local-device-only. There is no
      // `proof_of_delivery` table in Supabase yet, so we do not queue a sync
      // attempt here — doing so would fail every time and spam the network.
      // A dedicated Supabase table + sync mapping is needed before this can
      // be made cross-device visible (tracked as a follow-up, not part of this fix).
      onComplete(pod);
    };

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => savePOD(pos.coords.latitude, pos.coords.longitude),
        (err) => {
          console.warn("GPS failed", err);
          savePOD();
        },
        { timeout: 5000, enableHighAccuracy: true }
      );
    } else {
      savePOD();
    }
  };

  const isFormValid = receiverName.trim() !== '' && !signatureRef.current?.isEmpty();

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-start overflow-y-auto w-full p-4 md:p-8 select-none">
      <div className="w-full max-w-lg bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-strong)] overflow-hidden flex flex-col shadow-2xl relative mb-12">
        
        {/* Header */}
        <div className="p-4 border-b border-[var(--color-border)] bg-[rgba(0,0,0,0.3)] flex justify-between items-center sticky top-0 z-10 backdrop-blur-md">
          <div className="flex items-center gap-2">
            <ShieldCheck size={20} className="text-[var(--color-success)]" />
            <h2 className="text-[14px] font-bold text-[var(--color-foreground)] uppercase tracking-wider font-mono">Proof of Delivery</h2>
          </div>
          <button onClick={onCancel} className="p-2 bg-[var(--color-surface-2)] rounded hover:bg-white/10 transition-colors cursor-pointer border-none text-[var(--color-error)]">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-6">
          {/* Summary Details */}
          <div className="bg-[var(--color-surface-2)] p-3 rounded-lg border border-[var(--color-border)] flex flex-col">
            <span className="text-[10px] text-[var(--color-muted)] font-mono uppercase">AWB Number</span>
            <span className="text-[14px] font-bold text-[var(--color-accent-amber)] font-mono">{awbNumber}</span>
            <span className="text-[10px] text-[var(--color-muted)] font-mono uppercase mt-2">Consignee</span>
            <span className="text-[12px] font-bold text-[var(--color-foreground)]">{consigneeName}</span>
          </div>

          {/* Section 1 - Recipient Details */}
          <div className="space-y-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] text-[var(--color-muted)] font-mono uppercase">Receiver's Full Name <span className="text-red-500">*</span></label>
              <input 
                type="text" 
                value={receiverName} 
                onChange={e => setReceiverName(e.target.value)} 
                placeholder="Name of person taking package" 
                className="ehi-input" 
              />
            </div>
            
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] text-[var(--color-muted)] font-mono uppercase">Receiver's Phone</label>
              <input 
                type="tel" 
                value={receiverPhone} 
                onChange={e => setReceiverPhone(e.target.value)} 
                placeholder="Include country code for foreign customers (e.g. +44, +1, +233)" 
                className="ehi-input" 
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-[var(--color-muted)] font-mono uppercase">ID Type</label>
                <select 
                  value={idType} 
                  onChange={e => setIdType(e.target.value as any)} 
                  className="ehi-input"
                >
                  <option value="">Select ID...</option>
                  <option value="NIN">NIN</option>
                  <option value="Driving License">Driving License</option>
                  <option value="Voter Card">Voter Card</option>
                  <option value="Staff ID">Staff ID</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-[var(--color-muted)] font-mono uppercase">ID Number</label>
                <input 
                  type="text" 
                  value={idNumber} 
                  onChange={e => setIdNumber(e.target.value)} 
                  placeholder="Optional ID #..." 
                  className="ehi-input" 
                />
              </div>
            </div>
          </div>

          {/* Section 2 - Signature Pad */}
          <div className="flex flex-col gap-2 relative">
            <div className="flex justify-between items-end">
              <label className="text-[10px] text-[var(--color-muted)] font-mono uppercase">Sign here to confirm receipt <span className="text-red-500">*</span></label>
              <button onClick={clearSignature} className="text-[10px] font-mono text-[var(--color-accent-amber)] hover:text-amber-400 bg-transparent border-none cursor-pointer">Clear</button>
            </div>
            <div className="w-full h-[200px] bg-white rounded border-2 border-dashed border-[var(--color-accent-amber)] overflow-hidden" onTouchEnd={() => setReceiverPhone(receiverPhone)}>
              {/* onTouchEnd trick forces re-render to evaluate isFormValid after signature ends */}
              <SignatureCanvas 
                ref={signatureRef} 
                penColor="black" 
                canvasProps={{ className: 'sigCanvas w-full h-full' }} 
                onEnd={() => setReceiverName(receiverName)} 
              />
            </div>
          </div>

          {/* Section 3 - Photo Capture */}
          <div className="flex flex-col gap-2">
            <label className="text-[10px] text-[var(--color-muted)] font-mono uppercase">Photo Evidence (Optional)</label>
            {!isPhotoActive && !capturedPhoto && (
              <button 
                onClick={() => setIsPhotoActive(true)} 
                className="w-full h-12 border border-[var(--color-surface-2)] bg-[var(--color-surface-2)] text-[var(--color-foreground)] hover:bg-[var(--color-border)] rounded flex items-center justify-center gap-2 cursor-pointer transition-colors"
              >
                <Camera size={16} /> <span className="text-[13px] font-bold">Capture Photo</span>
              </button>
            )}

            {isPhotoActive && (
              <div className="flex flex-col gap-2">
                <div className="w-full aspect-video bg-black rounded overflow-hidden relative">
                  <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                </div>
                <div className="flex gap-2">
                  <button onClick={handleCapture} className="flex-1 h-11 bg-[var(--color-success)] text-black font-bold uppercase text-[12px] flex items-center justify-center gap-2 cursor-pointer rounded border-none">
                    <Camera size={14} /> Snap
                  </button>
                  <button onClick={() => setIsPhotoActive(false)} className="ehi-btn-secondary ehi-btn">
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {capturedPhoto && (
              <div className="flex flex-col gap-2">
                <div className="w-full aspect-video bg-black rounded overflow-hidden relative border border-[var(--color-border)]">
                  <img src={capturedPhoto} alt="Captured delivery proof" className="w-full h-full object-cover" />
                </div>
                <button onClick={() => { setCapturedPhoto(null); setIsPhotoActive(true); }} className="h-10 border border-[var(--color-surface-2)] bg-[var(--color-surface-2)] text-[var(--color-foreground)] hover:bg-[var(--color-border)] rounded flex items-center justify-center gap-2 cursor-pointer transition-colors">
                  <RefreshCw size={14} /> <span className="text-[12px] font-bold">Retake Photo</span>
                </button>
              </div>
            )}
          </div>

          {/* Section 4 - Notes */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] text-[var(--color-muted)] font-mono uppercase">Delivery Notes</label>
            <textarea 
              value={notes} 
              onChange={e => setNotes(e.target.value)} 
              placeholder="E.g. Left with security guard, package inspected..." 
              className="ehi-input"
              rows={3}
            />
          </div>
        </div>

        {/* Section 5 - Confirmation Footer */}
        <div className="p-4 border-t border-[var(--color-border)] bg-[rgba(0,0,0,0.4)] flex gap-3 sticky bottom-0">
          <button 
            onClick={onCancel} 
            className="flex-1 h-12 bg-transparent text-[var(--color-foreground)] font-bold uppercase tracking-wider rounded border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button 
            onClick={handleConfirm} 
            disabled={!isFormValid}
            className={`flex-[2] h-12 font-bold uppercase tracking-widest rounded border-none transition-colors flex items-center justify-center gap-2 ${
              isFormValid ? 'bg-[var(--color-success)] text-black cursor-pointer hover:bg-emerald-500' : 'bg-[var(--color-surface-2)] text-gray-500 cursor-not-allowed opacity-50'
            }`}
          >
            Confirm Delivery
          </button>
        </div>
      </div>
    </div>
  );
};
