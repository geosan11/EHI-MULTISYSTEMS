import { AlertTriangle, XCircle, CheckCircle, Info } from 'lucide-react';
import { ScanValidationResult } from '../lib/types';

// ── WRONG DESTINATION ALERT ──────────────────────────
// Full-screen life-safety STOP. Deliberately NOT theme-aware: a near-opaque
// alarm screen should look identical (dark, red, unmissable) whether the app
// is in light or dark mode -- same rationale as a vehicle dashboard warning.
// The overlay is near-opaque so nothing behind it shows through regardless.
const ALARM_INK = '#F1F5F9';
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
      background: 'var(--color-overlay-critical)',
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
      animation: 'customPulse 1.5s ease-in-out infinite',
    }}>
      <XCircle size={40} style={{ color: '#ef4444' }} />
    </div>

    <div style={{
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 11, color: '#ef4444',
      letterSpacing: '0.16em', textTransform: 'uppercase',
      marginBottom: 8,
    }}>
      ⚠ WRONG DESTINATION
    </div>

    <div style={{
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 22, fontWeight: 800,
      color: ALARM_INK, marginBottom: 24,
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
        <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.1em' }}>AWB / Ref</span>
        <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#fbbf24', fontWeight: 700 }}>{result.cargo?.awb}</span>
      </div>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        marginBottom: 14, paddingBottom: 14,
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Consignee</span>
        <span style={{ fontSize: 12, fontFamily: 'monospace', color: ALARM_INK, fontWeight: 600 }}>{result.cargo?.name}</span>
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
          <div style={{ fontSize: 8, fontFamily: 'monospace', color: '#34d399', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>
            CARGO GOING TO
          </div>
          <div style={{ fontSize: 14, fontFamily: 'monospace', fontWeight: 800, color: '#34d399' }}>
            {result.cargo?.destination?.toUpperCase()}
          </div>
        </div>
        <div style={{
          background: 'rgba(239,68,68,0.1)',
          border: '1px solid rgba(239,68,68,0.3)',
          borderRadius: 8, padding: '10px 12px',
        }}>
          <div style={{ fontSize: 8, fontFamily: 'monospace', color: '#ef4444', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>
            YOU ARE AT
          </div>
          <div style={{ fontSize: 14, fontFamily: 'monospace', fontWeight: 800, color: '#ef4444' }}>
            {result.currentHub.split(' ')[0].toUpperCase()}
          </div>
        </div>
      </div>
    </div>

    {/* Instruction text */}
    <div style={{
      fontSize: 12, color: '#94a3b8', textAlign: 'center',
      lineHeight: 1.6, marginBottom: 28, maxWidth: 300,
    }}>
      Return this consignment to the cargo hold immediately.
      Contact the dispatch supervisor.
    </div>

    {/* Action buttons. The "CALL DISPATCH" button was removed here: it did
        `window.location.href = 'tel:'` with no number (a no-op on desktop, an
        empty dialer on mobile). Restore it once a real dispatch number is
        configured (e.g. a Settings field threaded in as a prop). */}
    <div style={{ display: 'flex', gap: 12, width: '100%', maxWidth: 360 }}>
      <button
        onClick={onAcknowledge}
        style={{
          flex: 1, padding: '13px',
          background: 'rgba(239,68,68,0.15)',
          border: '1px solid rgba(239,68,68,0.3)',
          borderRadius: 10, color: '#ef4444',
          fontSize: 12, fontFamily: 'monospace',
          fontWeight: 700, cursor: 'pointer',
          letterSpacing: '0.06em',
        }}
      >
        ACKNOWLEDGE
      </button>
    </div>
  </div>
);

// ── NOT LOGGED IN ALERT ───────────────────────────────
export const NotLoggedInAlert = ({
  result,
  mode,
  onOk,
  onSwitchToArrive,
  onSwitchToDepart,
}: {
  result: ScanValidationResult;
  mode?: string;
  onOk: () => void;
  onSwitchToArrive: () => void;
  onSwitchToDepart?: () => void;
}) => (
  <div
    style={{
      position: 'fixed', inset: 0, zIndex: 9998,
      background: 'var(--color-overlay)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }}
    onClick={onOk}
  >
    <div
      style={{
        width: '100%', maxWidth: 360,
        background: 'var(--color-surface-1)',
        border: '1px solid var(--color-amber-border)',
        borderRadius: 14, overflow: 'hidden',
        boxShadow: 'var(--shadow-modal)',
      }}
      onClick={e => e.stopPropagation()}
    >
      {/* Header */}
      <div style={{
        background: 'var(--color-amber-bg)',
        borderBottom: '1px solid var(--color-amber-border)',
        padding: '16px 20px',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <AlertTriangle size={18} style={{ color: 'var(--color-amber-fg)' }} />
        <span style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--color-amber-fg)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Not Checked In Here
        </span>
      </div>

      <div style={{ padding: 20 }}>
        {/* Cargo info */}
        <div style={{
          background: 'var(--color-surface-2)',
          border: '1px solid var(--color-border)',
          borderRadius: 8, padding: '10px 14px',
          marginBottom: 14,
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-foreground)', marginBottom: 2 }}>{result.cargo?.name}</div>
          <div style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--color-amber-fg)' }}>{result.cargo?.awb}</div>
        </div>

        {/* Message */}
        <div style={{ fontSize: 12, color: 'var(--color-light-muted)', lineHeight: 1.6, marginBottom: 14 }}>
          {result.message ? result.message : (
            <>
              This cargo has no <strong style={{ color: 'var(--color-foreground)' }}>ARRIVE</strong> record
              at <strong style={{ color: 'var(--color-foreground)' }}>{result.currentHub}</strong>.
              Scan ARRIVE first before departing.
            </>
          )}
        </div>

        {/* Last known location */}
        {result.lastEvent && (
          <div style={{
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-border)',
            borderRadius: 8, padding: '10px 14px',
            marginBottom: 16,
          }}>
            <div style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>
              Last Known Location
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-light-muted)', fontFamily: 'monospace' }}>
              {result.lastEvent.type} — {result.lastEvent.hub}
            </div>
            <div style={{ fontSize: 10, color: 'var(--color-muted)', fontFamily: 'monospace', marginTop: 2 }}>
              {result.lastEvent.time}
            </div>
          </div>
        )}

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onOk} style={{
            flex: 1, padding: 12,
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-border-strong)',
            borderRadius: 8, color: 'var(--color-light-muted)',
            fontSize: 11, fontFamily: 'monospace',
            cursor: 'pointer',
          }}>
            OK
          </button>

          {mode === 'ARRIVE' && onSwitchToDepart ? (
            <button onClick={onSwitchToDepart} style={{
              flex: 1, padding: 12,
              background: 'var(--color-accent-amber)',
              border: 'none',
              borderRadius: 8, color: 'var(--color-on-accent)',
              fontSize: 11, fontFamily: 'monospace',
              fontWeight: 700, cursor: 'pointer',
            }}>
              SCAN DEPART →
            </button>
          ) : (
            <button onClick={onSwitchToArrive} style={{
              flex: 1, padding: 12,
              background: 'var(--color-accent-amber)',
              border: 'none',
              borderRadius: 8, color: 'var(--color-on-accent)',
              fontSize: 11, fontFamily: 'monospace',
              fontWeight: 700, cursor: 'pointer',
            }}>
              SCAN ARRIVE →
            </button>
          )}
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
      background: 'var(--color-overlay)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }}
    onClick={onOk}
  >
    <div
      style={{
        width: '100%', maxWidth: 340,
        background: 'var(--color-surface-1)',
        border: '1px solid var(--color-info-border)',
        borderRadius: 14, padding: 20,
        boxShadow: 'var(--shadow-modal)',
      }}
      onClick={e => e.stopPropagation()}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <Info size={16} style={{ color: 'var(--color-info-fg)' }} />
        <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--color-info-fg)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Already {result.lastEvent?.type}
        </span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--color-light-muted)', lineHeight: 1.6, marginBottom: 14 }}>
        {result.cargo?.name} was already recorded as {result.lastEvent?.type} from {result.lastEvent?.hub}.
      </div>
      <div style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--color-muted)', marginBottom: 16 }}>
        {result.lastEvent?.time} · by {result.lastEvent?.by}
      </div>
      <button onClick={onOk} style={{
        width: '100%', padding: 12,
        background: 'var(--color-info-bg)',
        border: '1px solid var(--color-info-border)',
        borderRadius: 8, color: 'var(--color-info-fg)',
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
  const tone = isArrive ? 'success' : 'info';
  const label = isArrive ? '✓ ARRIVED' : '✓ DEPARTED';

  return (
    <div style={{
      position: 'fixed', bottom: 80, left: 16, right: 16,
      background: `var(--color-${tone}-bg)`,
      border: `1px solid var(--color-${tone}-border)`,
      borderRadius: 10, padding: '12px 16px',
      display: 'flex', alignItems: 'center', gap: 10,
      zIndex: 200,
      boxShadow: 'var(--shadow-sm)',
    }}>
      <CheckCircle size={18} style={{ color: `var(--color-${tone}-fg)` }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, fontFamily: 'monospace', color: `var(--color-${tone}-fg)`, fontWeight: 700 }}>{label}</div>
        <div style={{ fontSize: 10, color: 'var(--color-light-muted)', fontFamily: 'monospace' }}>
          {result.cargo?.name} · {result.cargo?.awb}
        </div>
      </div>
    </div>
  );
};
