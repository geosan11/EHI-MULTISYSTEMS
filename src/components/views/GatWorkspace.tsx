import { useState } from 'react';
import { Package, Box, ClipboardList } from 'lucide-react';
import { CargoForm } from './CargoForm';
import { PackageForm } from './PackageForm';
import type { User, Transaction, Expense, CustomerWallet } from '../../lib/types';

type StreamMode = 'cargo' | 'parcel';

// Prop lists mirror EXACTLY what EHIApp.tsx passes to <CargoForm> and
// <PackageForm> on their own tabs -- no invented props (no pendingIntakes,
// activeShift, onFullUpdateTx: neither form actually accepts those; each
// manages its own Supabase-backed state internally).
interface GatWorkspaceProps {
  user: User;
  transactions: Transaction[];
  expenses: Expense[];
  onAddTx: (tx: Transaction) => void;
  onAddExpense: (exp: Expense) => void;
  customerWallets?: CustomerWallet[];
  setCustomerWallets?: React.Dispatch<React.SetStateAction<CustomerWallet[]>>;
  onShowHistory?: () => void;
}

export const GatWorkspace = (props: GatWorkspaceProps) => {
  const [stream, setStream] = useState<StreamMode>('cargo');

  return (
    <div className="flex flex-col h-full bg-[var(--color-obsidian)]">
      <div className="flex items-center justify-between gap-3 px-4 pt-4">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] font-mono text-[var(--color-accent-cobalt)] font-bold px-2 py-0.5 rounded bg-[rgba(59,130,246,0.15)] border border-[var(--color-accent-cobalt)]">GAT TERMINAL</span>
          <span className="text-[11px] font-mono text-[var(--color-muted)] truncate">MM1 · General Aviation Terminal</span>
        </div>
        {props.onShowHistory && (
          <button
            onClick={props.onShowHistory}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-[var(--color-border)] rounded-lg text-[11px] font-mono text-[var(--color-muted)] hover:text-[var(--color-accent-cobalt)] hover:border-[var(--color-accent-cobalt)] transition-colors shrink-0"
          >
            <ClipboardList size={14} /> <span>History</span>
          </button>
        )}
      </div>

      <div className="flex bg-[var(--color-obsidian)] rounded-lg p-1 border border-[var(--color-border)] mx-4 mt-3 mb-1 max-w-lg lg:mx-auto">
        <button
          onClick={() => setStream('cargo')}
          className={`flex-1 flex items-center justify-center gap-2 py-3 text-[14px] font-sans font-bold rounded-md transition-all cursor-pointer ${
            stream === 'cargo'
              ? 'bg-[var(--color-accent-amber)] text-[#030712] shadow-md'
              : 'text-[var(--color-light-muted)] hover:text-[var(--color-foreground)]'
          }`}
        >
          <Package size={16} /> Cargo
        </button>
        <button
          onClick={() => setStream('parcel')}
          className={`flex-1 flex items-center justify-center gap-2 py-3 text-[14px] font-sans font-bold rounded-md transition-all cursor-pointer ${
            stream === 'parcel'
              ? 'bg-[var(--color-accent-amber)] text-[#030712] shadow-md'
              : 'text-[var(--color-light-muted)] hover:text-[var(--color-foreground)]'
          }`}
        >
          <Box size={16} /> Parcel
        </button>
      </div>

      {/* No onShowHistory forwarded to either child form -- the workspace-level
          button above already covers both streams combined; per-form History
          buttons stay hidden while inside GAT. */}
      <div className="flex-1 overflow-y-auto">
        {stream === 'cargo' ? (
          <CargoForm
            user={props.user}
            transactions={props.transactions}
            onAddTx={props.onAddTx}
            customerWallets={props.customerWallets}
            setCustomerWallets={props.setCustomerWallets}
            forcedTerminal="GAT"
          />
        ) : (
          <PackageForm
            user={props.user}
            transactions={props.transactions}
            expenses={props.expenses}
            onAddTx={props.onAddTx}
            onAddExpense={props.onAddExpense}
            customerWallets={props.customerWallets}
            setCustomerWallets={props.setCustomerWallets}
            forcedTerminal="GAT"
          />
        )}
      </div>
    </div>
  );
};
