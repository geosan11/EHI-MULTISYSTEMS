import React, { useEffect, useState, useMemo, useRef } from "react";
import { Package, Plane, TrendingUp, Package2, QrCode, X, Clock } from "lucide-react";
import { User, Transaction } from "../../lib/types";
import { fmt } from "../../lib/helpers";
import { AnimatedAmount } from "../AnimatedAmount";
import { useVirtualizer } from "@tanstack/react-virtual";
import { QRCode } from "../QRCode";

const AnimatedScore = React.memo(({ value }: { value: number }) => (
  <AnimatedAmount value={value} />
));

// Format time from full timestamp to "10:42 AM"
function formatTime(raw: string): string {
  if (!raw) return '';
  try {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) {
      return d.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', hour12: true });
    }
  } catch { /* fall through */ }
  // Fallback: grab time portion from locale string
  const parts = raw.split(/,?\s+/);
  if (parts.length >= 2) return `${parts[1]}${parts[2] ? ' ' + parts[2] : ''}`;
  return raw;
}

const TxRow = React.memo(
  ({ t, isNewest, onQrClick }: {
    t: Transaction;
    isNewest: boolean;
    onQrClick?: (t: Transaction) => void;
  }) => {
    const accent =
      t.type === "cargo"
        ? { color: "var(--color-accent-amber)", bg: "rgba(245,158,11,0.10)" }
        : t.type === "marketing"
          ? { color: "var(--color-success)", bg: "rgba(16,185,129,0.10)" }
          : { color: "var(--color-accent-cobalt)", bg: "rgba(59,130,246,0.10)" };

    const modeStyle =
      t.mode === "Cash"
        ? { bg: "rgba(16,185,129,0.15)", color: "var(--color-success)" }
        : t.mode === "Transfer"
          ? { bg: "rgba(59,130,246,0.15)", color: "var(--color-accent-cobalt)" }
          : t.mode === "POS"
            ? { bg: "rgba(245,158,11,0.15)", color: "var(--color-accent-amber)" }
            : { bg: "rgba(239,68,68,0.12)", color: "var(--color-error)" };

    const statusDot =
      t.status === "Delivered"   ? "var(--color-success)" :
      t.status === "Arrived"     ? "var(--color-accent-amber)" :
      ["In-Transit","Dispatched","Departure"].includes(t.status || '') ? "var(--color-accent-cobalt)" :
      t.status === "Cancelled"   ? "var(--color-error)" :
      "var(--color-muted)";

    return (
      <div
        style={{
          background: isNewest
            ? `linear-gradient(135deg, var(--color-surface-card) 0%, ${accent.bg} 100%)`
            : "var(--color-surface-card)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-md)",
          padding: "12px 14px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 8,
          boxShadow: "var(--shadow-xs)",
          transition: "background 0.5s ease",
        }}
      >
        {/* Type icon */}
        <div style={{
          width: 40, height: 40, borderRadius: "50%",
          background: accent.bg, flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          color: accent.color,
        }}>
          {t.type === "cargo" ? <Package size={17} /> :
           t.type === "marketing" ? <TrendingUp size={17} /> :
           <Plane size={17} />}
        </div>

        {/* Name + detail */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--color-foreground)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {t.name}
          </div>
          <div style={{ fontSize: 11, color: "var(--color-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>
            {t.detail}
          </div>
          {/* Status badge inline */}
          {t.status && t.status !== 'Intake' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: statusDot, flexShrink: 0 }} />
              <span style={{ fontSize: 9, color: statusDot, fontWeight: 600, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {t.status}
              </span>
            </div>
          )}
        </div>

        {/* Amount + mode + time */}
        <div style={{ textAlign: "right", flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
          <div style={{ fontSize: 15, fontWeight: 800, fontFamily: "monospace", color: accent.color, marginBottom: 4 }}>
            {fmt(t.amount)}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, justifyContent: "flex-end" }}>
            <span style={{ fontSize: 10, fontWeight: 600, background: modeStyle.bg, color: modeStyle.color, borderRadius: "var(--radius-xs)", padding: "2px 6px" }}>
              {t.mode === "Debt" ? "Credit" : t.mode}
            </span>
            <span style={{ fontSize: 10, color: "var(--color-muted)" }}>
              {formatTime(t.time)}
            </span>
            {onQrClick && (
              <button
                onClick={() => onQrClick(t)}
                style={{ background: 'rgba(255,255,255,0.07)', border: 'none', borderRadius: 6, width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
                title="View QR Code"
              >
                <QrCode size={13} color="var(--color-muted)" />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  },
);

// Reusable Score Card
const ScoreCard = ({ label, icon: Icon, color, bg, borderColor, total, sub1, sub2 }: {
  label: string; icon: any; color: string; bg: string; borderColor: string;
  total: number; sub1: string; sub2?: string;
}) => (
  <div style={{
    background: `linear-gradient(145deg, var(--color-surface-card) 0%, ${bg} 100%)`,
    border: `1px solid ${borderColor}`,
    borderRadius: "var(--radius-lg)",
    padding: 16, position: "relative", overflow: "hidden",
    boxShadow: "var(--shadow-card)",
    display: "flex", flexDirection: "column", gap: 4,
  }}>
    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, ${color} 0%, transparent 100%)` }} />
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </span>
      <div style={{ width: 28, height: 28, borderRadius: "var(--radius-sm)", background: bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon size={14} style={{ color }} />
      </div>
    </div>
    <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "monospace", color, lineHeight: 1.1 }}>
      <AnimatedAmount value={total} />
    </div>
    <div style={{ fontSize: 11, color: "var(--color-muted)", display: "flex", justifyContent: "space-between" }}>
      <span>{sub1}</span>
      {sub2 && <span>{sub2}</span>}
    </div>
  </div>
);

export const Dashboard = React.memo(
  ({ user, transactions }: { user: User; transactions: Transaction[] }) => {
    const today = useMemo(() => {
      const n = new Date();
      return new Date(n.getFullYear(), n.getMonth(), n.getDate());
    }, []);

    const todayLabel = useMemo(() => {
      return new Date().toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    }, []);

    const todaysTx = useMemo(() => {
      return transactions.filter(t => {
        if (t.created_at) return new Date(t.created_at) >= today;
        return true;
      });
    }, [transactions, today]);

    const cargoTx   = useMemo(() => todaysTx.filter(t => t.type === "cargo"),     [todaysTx]);
    const mktgTx    = useMemo(() => todaysTx.filter(t => t.type === "marketing"), [todaysTx]);
    const vjTx      = useMemo(() => todaysTx.filter(t => t.type === "baggage"),   [todaysTx]);

    const cargoTotal    = useMemo(() => cargoTx.reduce((s, t) => s + t.amount, 0),       [cargoTx]);
    const cargoKgTotal  = useMemo(() => cargoTx.reduce((s, t) => s + (t.kg || 0), 0),    [cargoTx]);
    const mktgTotal     = useMemo(() => mktgTx.reduce((s, t) => s + t.amount, 0),        [mktgTx]);
    const vjTotal       = useMemo(() => vjTx.reduce((s, t) => s + t.amount, 0),          [vjTx]);
    const vjKgTotal     = useMemo(() => vjTx.reduce((s, t) => s + (t.kg || 0), 0),       [vjTx]);
    const grossTotal    = cargoTotal + mktgTotal + vjTotal;

    const isAdmin       = user.role === "admin" || user.role === "super_admin";
    const isAccountant  = user.role === "accountant" || user.role === "auditor";
    const showCargo     = isAdmin || user.role === "cargo_agent";
    const showVJ        = isAdmin || user.role === "vj_agent";
    const showMktg      = isAdmin || user.role === "marketing_agent";
    const showRevSummary = isAdmin || isAccountant;

    const allVisibleTx = useMemo(() =>
      todaysTx.filter(t =>
        (showCargo && t.type === "cargo") ||
        (showMktg  && t.type === "marketing") ||
        (showVJ    && t.type === "baggage")
      ),
      [todaysTx, showCargo, showMktg, showVJ]
    );

    const cashTotal     = useMemo(() => allVisibleTx.reduce((s, t) => s + (t.mode === "Cash"     ? t.amount : 0), 0), [allVisibleTx]);
    const transferTotal = useMemo(() => allVisibleTx.reduce((s, t) => s + (t.mode === "Transfer" ? t.amount : 0), 0), [allVisibleTx]);
    const posTotal      = useMemo(() => allVisibleTx.reduce((s, t) => s + (t.mode === "POS"      ? t.amount : 0), 0), [allVisibleTx]);
    const debtTotal     = useMemo(() => allVisibleTx.reduce((s, t) => s + (t.mode === "Debt"     ? t.amount : 0), 0), [allVisibleTx]);

    const [newestId, setNewestId] = useState<string>("");
    const [viewingQrTx, setViewingQrTx] = useState<Transaction | null>(null);
    useEffect(() => {
      if (allVisibleTx.length > 0) {
        const topTx = allVisibleTx[0];
        setNewestId(topTx.id);
        const timer = setTimeout(() => setNewestId(""), 2000);
        return () => clearTimeout(timer);
      }
    }, [allVisibleTx]);

    const parentRef = useRef<HTMLDivElement>(null);
    const virtualizer = useVirtualizer({
      count: allVisibleTx.length,
      getScrollElement: () => parentRef.current,
      estimateSize: () => 90,
      overscan: 5,
    });

    // How many score cards are visible — determines grid cols
    const cardCount = [showCargo, showMktg, showVJ].filter(Boolean).length;
    const gridCols = cardCount === 1 ? '1fr' : cardCount === 3 ? 'repeat(3, 1fr)' : 'repeat(2, 1fr)';

    return (
      <div className="flex flex-col p-4 space-y-4 h-full">

        {/* Stats Header */}
        <div className="flex items-center justify-between shrink-0">
          <div>
            <span className="text-[13px] font-sans font-semibold text-[var(--color-foreground)]">
              {user.hub}
            </span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <Clock size={10} className="text-[var(--color-muted)]" />
              <span className="text-[10px] font-mono text-[var(--color-muted)]">{todayLabel}</span>
            </div>
          </div>
          {showRevSummary && grossTotal > 0 && (
            <div className="text-right">
              <div className="text-[10px] font-mono text-[var(--color-muted)] uppercase tracking-wide">Gross Today</div>
              <div className="text-[15px] font-bold font-mono text-[var(--color-success)]">{fmt(grossTotal)}</div>
            </div>
          )}
        </div>

        {/* Score Cards */}
        {(showCargo || showVJ || showMktg) && (
          <div className="grid gap-3 shrink-0" style={{ gridTemplateColumns: gridCols }}>
            {showCargo && (
              <ScoreCard
                label="Cargo" icon={Package}
                color="var(--color-accent-amber)"
                bg="rgba(245,158,11,0.07)" borderColor="rgba(245,158,11,0.22)"
                total={cargoTotal}
                sub1={`${cargoTx.length} ${cargoTx.length === 1 ? "entry" : "entries"}`}
                sub2={`${cargoKgTotal.toLocaleString()} KG`}
              />
            )}
            {showMktg && (
              <ScoreCard
                label="Marketing" icon={TrendingUp}
                color="var(--color-success)"
                bg="rgba(16,185,129,0.07)" borderColor="rgba(16,185,129,0.22)"
                total={mktgTotal}
                sub1={`${mktgTx.length} ${mktgTx.length === 1 ? "customer" : "customers"}`}
              />
            )}
            {showVJ && (
              <ScoreCard
                label="ValueJet" icon={Plane}
                color="var(--color-accent-cobalt)"
                bg="rgba(59,130,246,0.07)" borderColor="rgba(59,130,246,0.22)"
                total={vjTotal}
                sub1={`${vjTx.length} ${vjTx.length === 1 ? "passenger" : "passengers"}`}
                sub2={`${vjKgTotal.toLocaleString()} Excess KG`}
              />
            )}
          </div>
        )}

        {/* Revenue Summary — admin, accountant, auditor */}
        {showRevSummary && (
          <div style={{
            background: "linear-gradient(135deg, rgba(16,185,129,0.08) 0%, rgba(16,185,129,0.03) 100%)",
            border: "1px solid rgba(16,185,129,0.22)",
            borderRadius: "var(--radius-lg)", padding: 14,
            boxShadow: "var(--shadow-card)",
          }} className="shrink-0">
            <div className="flex justify-between items-baseline mb-3">
              <span style={{ fontSize: 10, fontWeight: 700, color: "var(--color-success)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
                Revenue Breakdown
              </span>
              <span style={{ fontSize: 18, fontWeight: 800, fontFamily: "monospace", color: "var(--color-foreground)" }}>
                <AnimatedAmount value={grossTotal} />
              </span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: "Cash",     value: cashTotal,     color: "var(--color-success)" },
                { label: "Transfer", value: transferTotal, color: "var(--color-accent-cobalt)" },
                { label: "POS",      value: posTotal,      color: "var(--color-accent-amber)" },
                { label: "Debt",     value: debtTotal,     color: "var(--color-error)" },
              ].map(({ label, value, color }) => (
                <div key={label}>
                  <div style={{ fontSize: 9, color: "var(--color-muted)", marginBottom: 2, textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600 }}>
                    {label}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, fontFamily: "monospace", color }}>
                    {fmt(value)}
                  </div>
                  {grossTotal > 0 && (
                    <div style={{ fontSize: 9, color: "var(--color-muted)", marginTop: 1 }}>
                      {Math.round((value / grossTotal) * 100)}%
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Live Feed Header */}
        <div className="border-b border-[rgba(255,255,255,0.07)] pb-2 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-sans font-semibold text-[var(--color-foreground)]">
              Today's Activity
            </span>
            {allVisibleTx.length > 0 && (
              <span className="text-[10px] font-mono text-[var(--color-muted)] bg-[rgba(255,255,255,0.06)] px-2 py-0.5 rounded-full">
                {allVisibleTx.length} {allVisibleTx.length === 1 ? 'entry' : 'entries'}
              </span>
            )}
          </div>
          <div className="inline-flex items-center space-x-1.5 bg-[rgba(16,185,129,0.1)] px-2 py-1 rounded border border-[rgba(16,185,129,0.15)]">
            <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-success)] animate-pulse"></div>
            <span className="text-[11px] font-sans text-[var(--color-success)] font-medium">Live</span>
          </div>
        </div>

        {/* Live Feed */}
        <div ref={parentRef} className="flex-1 overflow-y-auto w-full no-scrollbar">
          {allVisibleTx.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-8 py-12 text-center bg-[var(--color-surface-card)] rounded-xl border border-dashed border-[rgba(255,255,255,0.1)] mt-2">
              <Package2 size={36} className="text-[#64748B] mb-3" strokeWidth={1.5} />
              <div className="text-[14px] font-semibold text-[var(--color-foreground)] font-sans">
                No activity yet today
              </div>
              <div className="text-[12px] text-[var(--color-muted)] font-sans mt-1 mb-4">
                Start by logging a cargo, ValueJet or marketing entry
              </div>
              <div className="flex gap-2 flex-wrap justify-center">
                {(user.role === 'super_admin' || user.role === 'admin' || user.role === 'cargo_agent') && (
                  <button
                    onClick={() => window.dispatchEvent(new CustomEvent('ehi-nav', { detail: 'Cargo' }))}
                    className="px-3 py-1.5 bg-[rgba(245,158,11,0.1)] border border-[rgba(245,158,11,0.3)] text-[var(--color-accent-amber)] text-[11px] font-bold rounded-lg"
                  >
                    + Cargo Entry
                  </button>
                )}
                {(user.role === 'super_admin' || user.role === 'admin' || user.role === 'vj_agent') && (
                  <button
                    onClick={() => window.dispatchEvent(new CustomEvent('ehi-nav', { detail: 'VJ POS' }))}
                    className="px-3 py-1.5 bg-[rgba(59,130,246,0.1)] border border-[rgba(59,130,246,0.3)] text-[var(--color-accent-cobalt)] text-[11px] font-bold rounded-lg"
                  >
                    + ValueJet POS
                  </button>
                )}
                {(user.role === 'super_admin' || user.role === 'admin' || user.role === 'marketing_agent') && (
                  <button
                    onClick={() => window.dispatchEvent(new CustomEvent('ehi-nav', { detail: 'Marketing' }))}
                    className="px-3 py-1.5 bg-[rgba(16,185,129,0.1)] border border-[rgba(16,185,129,0.3)] text-[var(--color-success)] text-[11px] font-bold rounded-lg"
                  >
                    + Marketing
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div style={{ height: virtualizer.getTotalSize(), position: "relative" }} className="mt-2">
              {virtualizer.getVirtualItems().map((v) => (
                <div key={v.key} style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${v.start}px)` }}>
                  <TxRow
                    t={allVisibleTx[v.index]}
                    isNewest={allVisibleTx[v.index].id === newestId}
                    onQrClick={setViewingQrTx}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* QR Modal */}
        {viewingQrTx && (
          <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-[2px] flex items-center justify-center p-4 animate-in fade-in">
            <div className="bg-[var(--color-surface-card)] border border-[rgba(255,255,255,0.1)] rounded-xl w-full max-w-sm shadow-xl flex flex-col overflow-hidden">
              <div className="p-4 border-b border-[rgba(255,255,255,0.05)] flex justify-between items-center bg-[#111827]">
                <h3 className="font-bold font-sans text-[var(--color-foreground)]">Scan to View</h3>
                <button onClick={() => setViewingQrTx(null)} className="text-[var(--color-muted)] hover:text-[var(--color-foreground)] p-1 cursor-pointer">
                  <X size={16} />
                </button>
              </div>
              <div className="p-8 flex flex-col items-center justify-center space-y-4 bg-[var(--color-obsidian)]">
                <div className="bg-white p-4 rounded-xl shadow-inner">
                  <QRCode id={viewingQrTx.id} size={200} />
                </div>
                <div className="text-center">
                  <p className="text-[14px] font-bold text-[var(--color-foreground)] mb-1">{viewingQrTx.id}</p>
                  <p className="text-[12px] text-[var(--color-muted)]">{viewingQrTx.name}</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  },
);
