import React, { useEffect, useState, useMemo, useRef } from 'react';
import { Package, Plane, TrendingUp, Package2 } from 'lucide-react';
import { User, Transaction } from '../../lib/types';
import { fmt } from '../../lib/helpers';
import { AnimatedAmount } from '../AnimatedAmount';
import { motion, AnimatePresence } from 'motion/react';
import { useVirtualizer } from '@tanstack/react-virtual';

const AnimatedScore = React.memo(({ value }: { value: number }) => <AnimatedAmount value={value} />);

const TxRow = React.memo(({ t, isNewest }: { t: Transaction, isNewest: boolean }) => {
  const accent =
    t.type === 'cargo'     ? { color: 'var(--color-accent-amber)', bg: 'rgba(245,158,11,0.10)' } :
    t.type === 'marketing' ? { color: 'var(--color-success)',       bg: 'rgba(16,185,129,0.10)' } :
                             { color: 'var(--color-accent-cobalt)', bg: 'rgba(59,130,246,0.10)' };
  const modeStyle =
    t.mode === 'Cash'     ? { bg: 'rgba(16,185,129,0.15)', color: 'var(--color-success)' } :
    t.mode === 'Transfer' ? { bg: 'rgba(59,130,246,0.15)', color: 'var(--color-accent-cobalt)' } :
    t.mode === 'POS'      ? { bg: 'rgba(245,158,11,0.15)', color: 'var(--color-accent-amber)' } :
                            { bg: 'rgba(239,68,68,0.12)',  color: 'var(--color-error)' };
  return (
    <div style={{
      background: isNewest
        ? `linear-gradient(135deg, var(--color-surface-card) 0%, ${accent.bg} 100%)`
        : 'var(--color-surface-card)',
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-md)',
      padding: '12px 14px',
      display: 'flex', alignItems: 'center', gap: 12,
      marginBottom: 8,
      boxShadow: 'var(--shadow-xs)',
      transition: 'background 0.5s ease',
    }}>
      <div style={{
        width: 40, height: 40, borderRadius: '50%',
        background: accent.bg, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: accent.color,
      }}>
        {t.type === 'cargo' ? <Package size={17} /> :
         t.type === 'marketing' ? <TrendingUp size={17} /> : <Plane size={17} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 14, fontWeight: 700,
          color: 'var(--color-foreground)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{t.name}</div>
        <div style={{
          fontSize: 12, color: 'var(--color-muted)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          marginTop: 2,
        }}>{t.detail}</div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{
          fontSize: 15, fontWeight: 800, fontFamily: 'monospace',
          color: accent.color, marginBottom: 4,
        }}>{fmt(t.amount)}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'flex-end' }}>
          <span style={{
            fontSize: 10, fontWeight: 600,
            background: modeStyle.bg, color: modeStyle.color,
            borderRadius: 'var(--radius-xs)', padding: '2px 6px',
          }}>{t.mode === 'Debt' ? 'Credit' : t.mode}</span>
          <span style={{ fontSize: 10, color: 'var(--color-muted)' }}>{t.time}</span>
        </div>
      </div>
    </div>
  );
});

export const Dashboard = React.memo(({ user, transactions }: { user: User; transactions: Transaction[] }) => {
  const cargoTx = useMemo(() => transactions.filter(t => t.type === 'cargo'), [transactions]);
  const mktgTx = useMemo(() => transactions.filter(t => t.type === 'marketing'), [transactions]);
  const vjTx = useMemo(() => transactions.filter(t => t.type === 'baggage'), [transactions]);

  const cargoTotal = useMemo(() => cargoTx.reduce((sum, t) => sum + t.amount, 0), [cargoTx]);
  const mktgTotal = useMemo(() => mktgTx.reduce((sum, t) => sum + t.amount, 0), [mktgTx]);
  const vjTotal = useMemo(() => vjTx.reduce((sum, t) => sum + t.amount, 0), [vjTx]);

  const isAdmin = user.role === 'admin' || user.role === 'super_admin';
  const showCargo = isAdmin || user.role === 'cargo_agent';
  const showVJ = isAdmin || user.role === 'vj_agent';
  const showMktg = isAdmin || user.role === 'marketing_agent';

  const allVisibleTx = useMemo(() => transactions.filter(t => 
    (showCargo && t.type === 'cargo') || 
    (showMktg && t.type === 'marketing') || 
    (showVJ && t.type === 'baggage')
  ), [transactions, showCargo, showMktg, showVJ]);

  const cashTotal = useMemo(() => allVisibleTx.reduce((sum, t) => sum + (t.mode === 'Cash' ? t.amount : 0), 0), [allVisibleTx]);
  const transferTotal = useMemo(() => allVisibleTx.reduce((sum, t) => sum + (t.mode === 'Transfer' ? t.amount : 0), 0), [allVisibleTx]);
  const posTotal = useMemo(() => allVisibleTx.reduce((sum, t) => sum + (t.mode === 'POS' ? t.amount : 0), 0), [allVisibleTx]);

  // Track newest transaction to apply fade tint
  const [newestId, setNewestId] = useState<string>('');
  useEffect(() => {
    if (allVisibleTx.length > 0) {
      const topTx = allVisibleTx[0];
      setNewestId(topTx.id);
      const timer = setTimeout(() => setNewestId(''), 2000);
      return () => clearTimeout(timer);
    }
  }, [allVisibleTx]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: allVisibleTx.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 88, // Approximate row height with padding
    overscan: 5,
  });

  return (
    <div className="flex flex-col p-4 space-y-5 h-full">
      {/* Score Cards Header */}
      <div className="border-b border-[var(--color-border)] pb-2 flex justify-between items-center shrink-0">
        <span className="text-[13px] font-sans font-semibold text-[var(--color-muted)]">
          Stats Overview
        </span>
      </div>

      {/* Score Cards */}
      <div className="grid gap-3 shrink-0"
           style={{ gridTemplateColumns: 'var(--card-grid, repeat(2, 1fr))' }}>

        {showCargo && (
          <div style={{
            background: 'linear-gradient(145deg, var(--color-surface-card) 0%, rgba(245,158,11,0.07) 100%)',
            border: '1px solid rgba(245,158,11,0.20)',
            borderRadius: 'var(--radius-lg)',
            padding: 16, position: 'relative', overflow: 'hidden',
            boxShadow: 'var(--shadow-card)',
            display: 'flex', flexDirection: 'column', gap: 4,
          }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2,
              background: 'linear-gradient(90deg, var(--color-accent-amber) 0%, transparent 100%)' }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-muted)',
                textTransform: 'uppercase', letterSpacing: '0.06em' }}>Cargo</span>
              <div style={{ width: 28, height: 28, borderRadius: 'var(--radius-sm)',
                background: 'rgba(245,158,11,0.15)', display: 'flex',
                alignItems: 'center', justifyContent: 'center' }}>
                <Package size={14} style={{ color: 'var(--color-accent-amber)' }} />
              </div>
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'monospace',
              color: 'var(--color-accent-amber)', lineHeight: 1.1 }}>
              <AnimatedScore value={cargoTotal} />
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-muted)' }}>
              {cargoTx.length} {cargoTx.length === 1 ? 'entry' : 'entries'}
            </div>
          </div>
        )}

        {showMktg && (
          <div style={{
            background: 'linear-gradient(145deg, var(--color-surface-card) 0%, rgba(16,185,129,0.07) 100%)',
            border: '1px solid rgba(16,185,129,0.20)',
            borderRadius: 'var(--radius-lg)',
            padding: 16, position: 'relative', overflow: 'hidden',
            boxShadow: 'var(--shadow-card)',
            display: 'flex', flexDirection: 'column', gap: 4,
          }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2,
              background: 'linear-gradient(90deg, var(--color-success) 0%, transparent 100%)' }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-muted)',
                textTransform: 'uppercase', letterSpacing: '0.06em' }}>Marketing</span>
              <div style={{ width: 28, height: 28, borderRadius: 'var(--radius-sm)',
                background: 'rgba(16,185,129,0.15)', display: 'flex',
                alignItems: 'center', justifyContent: 'center' }}>
                <TrendingUp size={14} style={{ color: 'var(--color-success)' }} />
              </div>
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'monospace',
              color: 'var(--color-success)', lineHeight: 1.1 }}>
              <AnimatedScore value={mktgTotal} />
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-muted)' }}>
              {mktgTx.length} {mktgTx.length === 1 ? 'customer' : 'customers'}
            </div>
          </div>
        )}

        {showVJ && (
          <div style={{
            background: 'linear-gradient(145deg, var(--color-surface-card) 0%, rgba(59,130,246,0.07) 100%)',
            border: '1px solid rgba(59,130,246,0.20)',
            borderRadius: 'var(--radius-lg)',
            padding: 16, position: 'relative', overflow: 'hidden',
            boxShadow: 'var(--shadow-card)',
            display: 'flex', flexDirection: 'column', gap: 4,
          }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2,
              background: 'linear-gradient(90deg, var(--color-accent-cobalt) 0%, transparent 100%)' }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-muted)',
                textTransform: 'uppercase', letterSpacing: '0.06em' }}>ValueJet</span>
              <div style={{ width: 28, height: 28, borderRadius: 'var(--radius-sm)',
                background: 'rgba(59,130,246,0.15)', display: 'flex',
                alignItems: 'center', justifyContent: 'center' }}>
                <Plane size={14} style={{ color: 'var(--color-accent-cobalt)' }} />
              </div>
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'monospace',
              color: 'var(--color-accent-cobalt)', lineHeight: 1.1 }}>
              <AnimatedScore value={vjTotal} />
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-muted)' }}>
              {vjTx.length} {vjTx.length === 1 ? 'passenger' : 'passengers'}
            </div>
          </div>
        )}
      </div>

      {isAdmin && (
        <div style={{
          background: 'linear-gradient(135deg, rgba(16,185,129,0.08) 0%, rgba(16,185,129,0.03) 100%)',
          border: '1px solid rgba(16,185,129,0.22)',
          borderRadius: 'var(--radius-lg)',
          padding: 16,
          boxShadow: 'var(--shadow-card)',
        }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-success)',
            textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
            Total Revenue — All Streams
          </div>
          <div style={{ fontSize: 28, fontWeight: 800, fontFamily: 'monospace',
            color: 'var(--color-foreground)', marginBottom: 12, lineHeight: 1 }}>
            <AnimatedScore value={cargoTotal + mktgTotal + vjTotal} />
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {[
              { label: 'Cash',     value: cashTotal,    color: 'var(--color-success)' },
              { label: 'Transfer', value: transferTotal, color: 'var(--color-accent-cobalt)' },
              { label: 'POS',      value: posTotal,      color: 'var(--color-accent-amber)' },
            ].map(({ label, value, color }) => (
              <div key={label}>
                <div style={{ fontSize: 10, color: 'var(--color-muted)', marginBottom: 2,
                  textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
                <div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'monospace', color }}>
                  {fmt(value)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Live Feed Header */}
      <div className="border-b border-[rgba(255,255,255,0.07)] pb-2 mt-4 flex items-center justify-between shrink-0">
        <span className="text-[14px] font-sans font-semibold text-[var(--color-foreground)]">
          Today's Activity
        </span>
        <div className="inline-flex items-center space-x-1.5 bg-[rgba(16,185,129,0.1)] px-2 py-1 rounded border border-[rgba(16,185,129,0.15)]">
           <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-success)] animate-pulse"></div>
           <span className="text-[11px] font-sans text-[var(--color-success)] font-medium">Live</span>
        </div>
      </div>

      {/* Live Feed */}
      <div ref={parentRef} className="flex-1 overflow-y-auto w-full no-scrollbar">
        {allVisibleTx.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 py-16 text-center bg-[var(--color-surface-card)] rounded-xl border border-dashed border-[rgba(255,255,255,0.1)] mt-2">
            <Package2 size={36} className="text-[#64748B] mb-3" strokeWidth={1.5} />
            <div className="text-[14px] font-medium text-[var(--color-foreground)] font-sans">No activity yet today.</div>
            <div className="text-[13px] text-[var(--color-muted)] font-sans mt-0.5">Entries will appear here.</div>
          </div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }} className="mt-2">
            {virtualizer.getVirtualItems().map(v => (
              <div
                key={v.key}
                style={{
                  position: 'absolute', top: 0, left: 0, width: '100%',
                  transform: `translateY(${v.start}px)`,
                }}
              >
                <TxRow t={allVisibleTx[v.index]} isNewest={allVisibleTx[v.index].id === newestId} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

