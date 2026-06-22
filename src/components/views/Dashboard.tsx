import React, { useEffect, useState, useMemo, useRef } from 'react';
import { Package, Plane, TrendingUp, Package2 } from 'lucide-react';
import { User, Transaction } from '../../lib/types';
import { fmt } from '../../lib/helpers';
import { AnimatedAmount } from '../AnimatedAmount';
import { motion, AnimatePresence } from 'motion/react';
import { useVirtualizer } from '@tanstack/react-virtual';

const AnimatedScore = React.memo(({ value }: { value: number }) => <AnimatedAmount value={value} />);

const TxRow = React.memo(({ t, isNewest }: { t: Transaction, isNewest: boolean }) => {
  let bgClass = "bg-[var(--color-surface-card)] border-[rgba(255,255,255,0.04)]";
  if (isNewest) {
    if (t.type === 'cargo') bgClass = "bg-[rgba(245,158,11,0.08)] border-[rgba(245,158,11,0.25)] shadow-[0_0_12px_rgba(245,158,11,0.05)]";
    else if (t.type === 'marketing') bgClass = "bg-[rgba(16,185,129,0.08)] border-[rgba(16,185,129,0.25)] shadow-[0_0_12px_rgba(16,185,129,0.05)]";
    else bgClass = "bg-[rgba(59,130,246,0.08)] border-[rgba(59,130,246,0.25)] shadow-[0_0_12px_rgba(59,130,246,0.05)]";
  }

  return (
    <motion.div
      initial={{ scale: 0.98, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0.98, opacity: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className={`border rounded-xl p-3.5 flex items-center space-x-3 shadow-sm transition-all duration-700 ${bgClass} mb-3`}
    >
      <div className={`w-10 h-10 rounded-full shrink-0 flex items-center justify-center ${
        t.type === 'cargo' ? 'bg-[rgba(245,158,11,0.15)] text-[var(--color-accent-amber)]' : 
        t.type === 'marketing' ? 'bg-[rgba(16,185,129,0.15)] text-[var(--color-success)]' :
        'bg-[rgba(59,130,246,0.15)] text-[var(--color-accent-cobalt)]'
      }`}>
        {t.type === 'cargo' ? <Package size={18} /> : 
         t.type === 'marketing' ? <TrendingUp size={18} /> :
         <Plane size={18} />}
      </div>
      
      <div className="flex-1 min-w-0 flex flex-col justify-center">
        <div className="text-[14px] font-sans font-bold text-[var(--color-foreground)] truncate leading-tight">{t.name}</div>
        <div className="text-[12px] font-sans text-[var(--color-light-muted)] truncate mt-0.5">{t.detail}</div>
        <div className="mt-1">
          <span className="inline-block px-1.5 py-0.5 bg-[var(--color-border)] text-[9px] font-mono rounded text-[var(--color-muted)]">{t.id}</span>
        </div>
      </div>

      <div className="text-right shrink-0 flex flex-col items-end justify-center">
        <div className={`text-[16px] font-extrabold font-mono mb-1 ${
          t.type === 'cargo' ? 'text-[var(--color-accent-amber)]' : 
          t.type === 'marketing' ? 'text-[var(--color-success)]' :
          'text-[var(--color-accent-cobalt)]'
        }`}>
          {fmt(t.amount)}
        </div>
        <div className="flex items-center space-x-1.5 flex-wrap justify-end">
          <span className={`text-[9px] font-sans px-1.5 py-0.5 rounded font-medium ${
            t.mode === 'Cash' ? 'bg-[rgba(16,185,129,0.15)] text-[var(--color-success)]' :
            t.mode === 'Transfer' ? 'bg-[rgba(59,130,246,0.15)] text-[var(--color-accent-cobalt)]' :
            t.mode === 'POS' ? 'bg-[rgba(245,158,11,0.15)] text-[var(--color-accent-amber)]' :
            'border border-[var(--color-error)] text-[var(--color-error)]'
          }`}>
            {t.mode === 'Debt' ? 'Credit' : t.mode}
          </span>
          <span className="text-[10px] font-sans text-[var(--color-muted)]">{t.time}</span>
        </div>
      </div>
    </motion.div>
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
    estimateSize: () => 80, // Approximate row height with padding
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
      <div className="grid gap-3 shrink-0" style={{ gridTemplateColumns: 'var(--card-grid, repeat(2, 1fr))' }}>
        {showCargo && (
          <div className="bg-[var(--color-surface-card)] rounded-xl border border-[rgba(255,255,255,0.07)] p-4 relative overflow-hidden flex flex-col justify-between">
            <div className="absolute left-0 top-0 bottom-0 w-[4px] bg-[var(--color-accent-amber)]" />
            <div className="text-[12px] font-sans text-[var(--color-muted)] pl-2 font-medium">Cargo Station</div>
            <div className="text-[22px] font-bold font-mono text-[var(--color-accent-amber)] mt-2 pl-2">
              <AnimatedScore value={cargoTotal} />
            </div>
            <div className="text-[11px] font-sans text-[var(--color-muted)] mt-1 pl-2 font-medium">{cargoTx.length} Entries</div>
          </div>
        )}
        
        {showMktg && (
          <div className="bg-[var(--color-surface-card)] rounded-xl border border-[rgba(255,255,255,0.07)] p-4 relative overflow-hidden flex flex-col justify-between">
            <div className="absolute left-0 top-0 bottom-0 w-[4px] bg-[var(--color-success)]" />
            <div className="text-[12px] font-sans text-[var(--color-muted)] pl-2 font-medium">Marketing</div>
            <div className="text-[22px] font-bold font-mono text-[var(--color-success)] mt-2 pl-2">
              <AnimatedScore value={mktgTotal} />
            </div>
            <div className="text-[11px] font-sans text-[var(--color-muted)] mt-1 pl-2 font-medium">{mktgTx.length} Customers</div>
          </div>
        )}

        {showVJ && (
          <div className="bg-[var(--color-surface-card)] rounded-xl border border-[rgba(255,255,255,0.07)] p-4 relative overflow-hidden flex flex-col justify-between">
            <div className="absolute left-0 top-0 bottom-0 w-[4px] bg-[var(--color-accent-cobalt)]" />
            <div className="text-[12px] font-sans text-[var(--color-muted)] pl-2 font-medium">ValueJet POS</div>
            <div className="text-[22px] font-bold font-mono text-[var(--color-accent-cobalt)] mt-2 pl-2">
              <AnimatedScore value={vjTotal} />
            </div>
            <div className="text-[11px] font-sans text-[var(--color-muted)] mt-1 pl-2 font-medium">{vjTx.length} Passengers</div>
          </div>
        )}
      </div>

      {isAdmin && (
        <div className="w-full bg-[rgba(16,185,129,0.05)] border border-[var(--color-success)] rounded-xl p-4 shrink-0">
          <div className="text-[12px] font-sans font-medium text-[var(--color-success)]">Grand Total For All Streams</div>
          <div className="text-[28px] font-bold font-mono text-[var(--color-foreground)] mt-1">
            <AnimatedScore value={cargoTotal + mktgTotal + vjTotal} />
          </div>
          
          <div className="mt-3 flex space-x-6 text-[12px] font-sans text-[var(--color-light-muted)]">
            <div>Cash: <span className="text-[var(--color-foreground)] font-bold font-mono tracking-tight">{fmt(cashTotal)}</span></div>
            <div>Transfer: <span className="text-[var(--color-foreground)] font-bold font-mono tracking-tight">{fmt(transferTotal)}</span></div>
            <div>POS: <span className="text-[var(--color-foreground)] font-bold font-mono tracking-tight">{fmt(posTotal)}</span></div>
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

