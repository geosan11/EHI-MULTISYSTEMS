import { AlertTriangle, XCircle, CheckCircle, Info, Phone } from 'lucide-react';
import { ScanValidationResult } from '../lib/types';

// ── WRONG DESTINATION ALERT ──────────────────────────
// Full-screen red overlay — cannot be dismissed easily
export const WrongDestinationAlert = ({
  result,
  onAcknowledge,
}: {
  result: ScanValidationResult;
  onAcknowledge: () => void;
}) => (
  <div
    style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(10, 4, 4, 0.97)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }}
  >
    {/* Pulsing red icon */}
    <div style={{
      width: 80, height: 80, borderRadius: '50%',
      background: 'rgba(239,68,68,0.15)',
      border: '2px solid rgba(239,68,68,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      marginBottom: 24,
      animation: 'pulse 1.5s ease-in-out infinite',
    }}>
      <XCircle size={40} color="#EF4444" />
    </div>

    <div style={{
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 11, color: '#EF4444',
      letterSpacing: '0.16em', textTransform: 'uppercase',
      marginBottom: 8,
    }}>
      ⚠ WRONG DESTINATION
    </div>

    <div style={{
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 22, fontWeight: 800,
      color: '#F1F5F9', marginBottom: 24,
      textAlign: 'center',
    }}>
      DO NOT OFFLOAD
    </div>

    {/* Destination vs Location card */}
    <div style={{
      width: '100%', maxWidth: 360,
      background: 'rgba(239,68,68,0.08)',
      border: '1px solid rgba(239,68,68,0.3)',
      borderRadius: 12, padding: 20,
      marginBottom: 24,
    }}>
      {/* AWB */}
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        marginBottom: 14, paddingBottom: 14,
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.1em' }}>AWB / Ref</span>
        <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#F59E0B', fontWeight: 700 }}>{result.cargo?.awb}</span>
      </div>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        marginBottom: 14, paddingBottom: 14,
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Consignee</span>
        <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#F1F5F9', fontWeight: 600 }}>{result.cargo?.name}</span>
      </div>

      {/* Destination vs Current */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12,
      }}>
        <div style={{
          background: 'rgba(16,185,129,0.1)',
          border: '1px solid rgba(16,185,129,0.2)',
          borderRadius: 8, padding: '10px 12px',
        }}>
          <div style={{ fontSize: 8, fontFamily: 'monospace', color: '#10B981', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>
            CARGO GOING TO
          </div>
          <div style={{ fontSize: 14, fontFamily: 'monospace', fontWeight: 800, color: '#10B981' }}>
            {result.cargo?.destination?.toUpperCase()}
          </div>
        </div>
        <div style={{
          background: 'rgba(239,68,68,0.1)',
          border: '1px solid rgba(239,68,68,0.3)',
          borderRadius: 8, padding: '10px 12px',
        }}>
          <div style={{ fontSize: 8, fontFamily: 'monospace', color: '#EF4444', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>
            YOU ARE AT
          </div>
          <div style={{ fontSize: 14, fontFamily: 'monospace', fontWeight: 800, color: '#EF4444' }}>
            {result.currentHub.split(' ')[0].toUpperCase()}
          </div>
        </div>
      </div>
    </div>

    {/* Instruction text */}
    <div style={{
      fontSize: 12, color: '#94A3B8', textAlign: 'center',
      lineHeight: 1.6, marginBottom: 28, maxWidth: 300,
    }}>
      Return this consignment to the cargo hold immediately.
      Contact the dispatch supervisor.
    </div>

    {/* Action buttons */}
    <div style={{ display: 'flex', gap: 12, width: '100%', maxWidth: 360 }}>
      <button
        onClick={onAcknowledge}
        style={{
          flex: 1, padding: '13px',
          background: 'rgba(239,68,68,0.15)',
          border: '1px solid rgba(239,68,68,0.3)',
          borderRadius: 10, color: '#EF4444',
          fontSize: 12, fontFamily: 'monospace',
          fontWeight: 700, cursor: 'pointer',
          letterSpacing: '0.06em',
        }}
      >
        ACKNOWLEDGE
      </button>
      <button
        onClick={() => { window.location.href = 'tel:'; }}
        style={{
          flex: 1, padding: '13px',
          background: '#EF4444',
          border: 'none',
          borderRadius: 10, color: '#FFF',
          fontSize: 12, fontFamily: 'monospace',
          fontWeight: 700, cursor: 'pointer',
          display: 'flex', alignItems: 'center',
          justifyContent: 'center', gap: 6,
        }}
      >
        <Phone size={14} /> CALL DISPATCH
      </button>
    </div>
  </div>
);

// ── NOT LOGGED IN ALERT ───────────────────────────────
export const NotLoggedInAlert = ({
  result,
  onOk,
  onSwitchToArrive,
}: {
  result: ScanValidationResult;
  onOk: () => void;
  onSwitchToArrive: () => void;
}) => (
  <div
    style={{
      position: 'fixed', inset: 0, zIndex: 9998,
      background: 'rgba(0,0,0,0.88)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }}
    onClick={onOk}
  >
    <div
      style={{
        width: '100%', maxWidth: 360,
        background: '#1E293B',
        border: '1px solid rgba(245,158,11,0.3)',
        borderRadius: 14, overflow: 'hidden',
      }}
      onClick={e => e.stopPropagation()}
    >
      {/* Header */}
      <div style={{
        background: 'rgba(245,158,11,0.1)',
        borderBottom: '1px solid rgba(245,158,11,0.2)',
        padding: '16px 20px',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <AlertTriangle size={18} color="#F59E0B" />
        <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#F59E0B', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Not Checked In Here
        </span>
      </div>

      <div style={{ padding: 20 }}>
        {/* Cargo info */}
        <div style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 8, padding: '10px 14px',
          marginBottom: 14,
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#F1F5F9', marginBottom: 2 }}>{result.cargo?.name}</div>
          <div style={{ fontSize: 10, fontFamily: 'monospace', color: '#F59E0B' }}>{result.cargo?.awb}</div>
        </div>

        {/* Message */}
        <div style={{ fontSize: 12, color: '#94A3B8', lineHeight: 1.6, marginBottom: 14 }}>
          This cargo has no <strong style={{ color: '#F1F5F9' }}>ARRIVE</strong> record
          at <strong style={{ color: '#F1F5F9' }}>{result.currentHub}</strong>.
          Scan ARRIVE first before departing.
        </div>

        {/* Last known location */}
        {result.lastEvent && (
          <div style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 8, padding: '10px 14px',
            marginBottom: 16,
          }}>
            <div style={{ fontSize: 9, fontFamily: 'monospace', color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>
              Last Known Location
            </div>
            <div style={{ fontSize: 11, color: '#94A3B8', fontFamily: 'monospace' }}>
              {result.lastEvent.type} — {result.lastEvent.hub}
            </div>
            <div style={{ fontSize: 10, color: '#64748B', fontFamily: 'monospace', marginTop: 2 }}>
              {result.lastEvent.time}
            </div>
          </div>
        )}

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onOk} style={{
            flex: 1, padding: 12,
            background: 'var(--color-border)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 8, color: '#94A3B8',
            fontSize: 11, fontFamily: 'monospace',
            cursor: 'pointer',
          }}>
            OK
          </button>
          <button onClick={onSwitchToArrive} style={{
            flex: 1, padding: 12,
            background: '#F59E0B',
            border: 'none',
            borderRadius: 8, color: '#0B0F19',
            fontSize: 11, fontFamily: 'monospace',
            fontWeight: 700, cursor: 'pointer',
          }}>
            SCAN ARRIVE →
          </button>
        </div>
      </div>
    </div>
  </div>
);

// ── ALREADY PROCESSED ALERT ───────────────────────────
export const AlreadyProcessedAlert = ({
  result,
  onOk,
}: {
  result: ScanValidationResult;
  onOk: () => void;
}) => (
  <div
    style={{
      position: 'fixed', inset: 0, zIndex: 9998,
      background: 'rgba(0,0,0,0.85)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }}
    onClick={onOk}
  >
    <div
      style={{
        width: '100%', maxWidth: 340,
        background: '#1E293B',
        border: '1px solid rgba(59,130,246,0.3)',
        borderRadius: 14, padding: 20,
      }}
      onClick={e => e.stopPropagation()}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <Info size={16} color="#3B82F6" />
        <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#3B82F6', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Already {result.lastEvent?.type}
        </span>
      </div>
      <div style={{ fontSize: 12, color: '#94A3B8', lineHeight: 1.6, marginBottom: 14 }}>
        {result.cargo?.name} was already recorded as {result.lastEvent?.type} from {result.lastEvent?.hub}.
      </div>
      <div style={{ fontSize: 10, fontFamily: 'monospace', color: '#64748B', marginBottom: 16 }}>
        {result.lastEvent?.time} · by {result.lastEvent?.by}
      </div>
      <button onClick={onOk} style={{
        width: '100%', padding: 12,
        background: 'rgba(59,130,246,0.1)',
        border: '1px solid rgba(59,130,246,0.2)',
        borderRadius: 8, color: '#3B82F6',
        fontSize: 12, fontFamily: 'monospace',
        fontWeight: 700, cursor: 'pointer',
      }}>
        OK, CONTINUE
      </button>
    </div>
  </div>
);

// ── SUCCESS FLASH ─────────────────────────────────────
export const SuccessFlash = ({
  result,
}: {
  result: ScanValidationResult;
}) => {
  const isArrive = result.type === 'SUCCESS_ARRIVE';
  const color = isArrive ? '#10B981' : '#3B82F6';
  const label = isArrive ? '✓ ARRIVED' : '✓ DEPARTED';

  return (
    <div style={{
      position: 'fixed', bottom: 80, left: 16, right: 16,
      background: isArrive ? 'rgba(16,185,129,0.12)' : 'rgba(59,130,246,0.12)',
      border: `1px solid ${isArrive ? 'rgba(16,185,129,0.3)' : 'rgba(59,130,246,0.3)'}`,
      borderRadius: 10, padding: '12px 16px',
      display: 'flex', alignItems: 'center', gap: 10,
      zIndex: 200,
    }}>
      <CheckCircle size={18} color={color} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, fontFamily: 'monospace', color, fontWeight: 700 }}>{label}</div>
        <div style={{ fontSize: 10, color: '#94A3B8', fontFamily: 'monospace' }}>
          {result.cargo?.name} · {result.cargo?.awb}
        </div>
      </div>
    </div>
  );
};
