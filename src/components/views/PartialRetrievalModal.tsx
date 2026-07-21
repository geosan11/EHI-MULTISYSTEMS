import React, { useState, useEffect } from 'react';
import { X, Scale, Package, Wallet, CheckCircle2 } from 'lucide-react';
import { fmt } from '../../lib/helpers';

interface PartialRetrievalModalProps {
  entry: any; // Using any for simplicity here
  onClose: () => void;
  onConfirm: (data: {
    isPartial: boolean;
    retrievedValue: number;
    retrievedPieces: number;
    retrievedKg: number;
  }) => void;
}

export const PartialRetrievalModal: React.FC<PartialRetrievalModalProps> = ({ entry, onClose, onConfirm }) => {
  const [retrievalType, setRetrievalType] = useState<'full' | 'partial'>('full');
  const totalPieces = entry.pieces || 1;
  const totalKg = entry.kg || 1;
  const totalAmount = entry.amount || 0;

  // Partial is driven by ONE input: pieces. Value + kg proportion off it,
  // with the value editable for the case where specific boxes are worth more.
  const [pieces, setPieces] = useState<number>(Math.max(1, totalPieces - 1));
  const proportionalValue = Math.min(totalAmount, Math.round((pieces / totalPieces) * totalAmount));
  const [valueOverride, setValueOverride] = useState<string>('');
  const retrievedValue = retrievalType === 'full'
    ? totalAmount
    : (valueOverride !== '' ? Math.min(totalAmount, Math.round(parseFloat(valueOverride) || 0)) : proportionalValue);
  const retrievedKg = retrievalType === 'full' ? totalKg : Math.round((pieces / totalPieces) * totalKg * 10) / 10;

  const amountPaid = (entry as any).amountPaid || (entry.mode !== 'Debt' ? entry.amount : 0);
  const alreadyRetrieved = (entry as any).raw?.retrieved_amount || 0;
  const unpaidDebt = Math.max(0, entry.amount - amountPaid - alreadyRetrieved);
  const debtReduction = Math.min(retrievedValue, unpaidDebt);
  const walletRefund = retrievedValue - debtReduction;

  const invalid = retrievalType === 'partial' && (pieces < 1 || pieces > totalPieces || retrievedValue <= 0);

  const handleConfirm = () => {
    if (invalid) return;
    onConfirm({
      isPartial: retrievalType === 'partial',
      retrievedValue,
      retrievedPieces: retrievalType === 'partial' ? pieces : totalPieces,
      retrievedKg: retrievalType === 'partial' ? retrievedKg : totalKg,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
      <div className="bg-[var(--color-obsidian)] border border-[var(--color-border)] rounded-xl w-full max-w-md overflow-hidden shadow-2xl flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-[var(--color-border)] bg-[var(--color-surface-card)]">
          <h3 className="text-[14px] font-bold text-[var(--color-foreground)]">Process Cargo Retrieval</h3>
          <button onClick={onClose} className="p-1 hover:bg-[var(--color-surface-2)] rounded text-[var(--color-muted)]"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-5">
          <div className="bg-[var(--color-surface-1)] p-3 rounded-lg border border-[var(--color-border)] flex flex-col gap-2">
            <div className="text-[11px] font-mono text-[var(--color-muted)] uppercase tracking-wider flex justify-between">
              <span>Entry: {entry.id}</span>
              <span className="text-[var(--color-accent-amber)] font-bold">{entry.name}</span>
            </div>
            <div className="flex items-center gap-4 text-[13px] font-bold text-[var(--color-foreground)]">
              <span className="flex items-center gap-1.5"><Package size={14} className="text-[var(--color-muted)]" /> {totalPieces} PCS</span>
              <span className="flex items-center gap-1.5"><Scale size={14} className="text-[var(--color-muted)]" /> {totalKg} KG</span>
              <span className="flex items-center gap-1.5 ml-auto text-[var(--color-success)]">₦{fmt(totalAmount)}</span>
            </div>
          </div>

          <div className="flex p-1 bg-[var(--color-surface-2)] rounded-lg">
            <button onClick={() => setRetrievalType('full')} className={`flex-1 py-2 text-[12px] font-bold rounded-md ${retrievalType === 'full' ? 'bg-[var(--color-accent-amber)] text-[var(--color-obsidian)]' : 'text-[var(--color-muted)]'}`}>Full Retrieval</button>
            <button onClick={() => setRetrievalType('partial')} className={`flex-1 py-2 text-[12px] font-bold rounded-md ${retrievalType === 'partial' ? 'bg-[var(--color-accent-cobalt)] text-white' : 'text-[var(--color-muted)]'}`}>Partial</button>
          </div>

          {retrievalType === 'partial' && (
            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-mono text-[var(--color-muted)] block mb-1.5">How many of the {totalPieces} pieces?</label>
                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => setPieces(p => Math.max(1, p - 1))} className="w-10 h-10 rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-foreground)] text-lg font-bold">−</button>
                  <div className="flex-1 text-center text-[20px] font-mono font-bold text-[var(--color-foreground)]">{pieces} <span className="text-[12px] text-[var(--color-muted)]">/ {totalPieces}</span></div>
                  <button type="button" onClick={() => setPieces(p => Math.min(totalPieces, p + 1))} className="w-10 h-10 rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-foreground)] text-lg font-bold">+</button>
                </div>
              </div>
              <div>
                <label className="text-[11px] font-mono text-[var(--color-muted)] block mb-1.5">Value (auto ₦{fmt(proportionalValue)} — edit if needed)</label>
                <input type="number" value={valueOverride} onChange={e => setValueOverride(e.target.value)} placeholder={`₦${fmt(proportionalValue)}`}
                  className="w-full h-10 px-3 bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-lg text-[13px] font-mono text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-cobalt)]" />
              </div>
            </div>
          )}

          <div className={`p-4 rounded-xl border ${retrievalType === 'full' ? 'bg-[rgba(245,158,11,0.05)] border-[rgba(245,158,11,0.2)]' : 'bg-[rgba(59,130,246,0.05)] border-[rgba(59,130,246,0.2)]'}`}>
            <div className="flex flex-col items-center gap-1 border-b border-[rgba(255,255,255,0.1)] pb-3">
              <div className="text-[11px] font-mono text-[var(--color-muted)] uppercase tracking-wider flex items-center gap-1.5"><Wallet size={12} /> Retrieved Value</div>
              <div className={`text-[28px] font-mono font-bold ${retrievalType === 'full' ? 'text-[var(--color-accent-amber)]' : 'text-[var(--color-accent-cobalt)]'}`}>₦{fmt(retrievedValue)}</div>
            </div>
            {/* Plain-language summary of the split */}
            <p className="text-[11px] font-mono text-[var(--color-light-muted)] leading-relaxed pt-3 text-center">
              {debtReduction > 0 && walletRefund > 0
                ? <>₦{fmt(debtReduction)} clears what's still owed on this shipment; ₦{fmt(walletRefund)} is credited to {entry.name}'s wallet.</>
                : debtReduction > 0
                ? <>All of it clears what's still owed on this shipment (₦{fmt(debtReduction)}).</>
                : <>Nothing is owed on this shipment, so the full ₦{fmt(walletRefund)} is credited to {entry.name}'s wallet.</>}
            </p>
          </div>
        </div>

        <div className="p-4 border-t border-[var(--color-border)] bg-[var(--color-surface-card)]">
          <button onClick={handleConfirm} disabled={invalid}
            className={`w-full h-12 flex items-center justify-center gap-2 rounded-lg text-[13px] font-bold disabled:opacity-50 ${retrievalType === 'full' ? 'bg-[var(--color-accent-amber)] text-[var(--color-obsidian)]' : 'bg-[var(--color-accent-cobalt)] text-white'}`}>
            <CheckCircle2 size={16} /> Confirm Retrieval
          </button>
        </div>
      </div>
    </div>
  );
};
