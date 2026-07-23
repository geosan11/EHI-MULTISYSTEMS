import React, { useState, useMemo } from 'react';
import { Transaction, ParsedBankAlert, PaymentMatch, User } from '../../lib/types';
import { fmt } from '../../lib/helpers';
import { AlertCircle, CheckCircle, Mail, Search, Link as LinkIcon, ChevronDown, ChevronRight } from 'lucide-react';
import { useToast } from '../../lib/ToastContext';
import { supabase } from '../../lib/supabase';
import { confirmPayment, PaymentEntryType } from '../../lib/paymentConfirmation';

interface PaymentValidationProps {
  transactions: Transaction[];
  onUpdateTx: (tx: Transaction) => void;
  user?: User;
}

export const PaymentValidation: React.FC<PaymentValidationProps> = ({ transactions, onUpdateTx, user }) => {
  const [emailText, setEmailText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [parsedResult, setParsedResult] = useState<ParsedBankAlert | null>(null);
  const [matchResult, setMatchResult] = useState<PaymentMatch | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [showAutoForward, setShowAutoForward] = useState(false);
  const { showToast } = useToast();

  // SECTION A: Unconfirmed Transfers
  const unconfirmedTransfers = useMemo(() => {
    return transactions
      .filter(t => t.mode === 'Transfer' && !t.paymentConfirmed)
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
  }, [transactions]);

  // SECTION C: Recently Confirmed (Today)
  const recentlyConfirmed = useMemo(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    return transactions
      .filter(t => t.mode === 'Transfer' && t.paymentConfirmed && t.confirmedAt && t.confirmedAt.startsWith(todayStr))
      .sort((a, b) => new Date(b.confirmedAt || 0).getTime() - new Date(a.confirmedAt || 0).getTime());
  }, [transactions]);

  const handleParseAndMatch = async () => {
    setErrorMsg('');
    setParsedResult(null);
    setMatchResult(null);

    if (!emailText.trim()) {
      setErrorMsg('Please paste the email text first.');
      return;
    }

    setParsing(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token || '';
      const res = await fetch('/api/validate-payment/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ emailText })
      });
      let data: any = {};
      try {
        const text = await res.text();
        if (text) data = JSON.parse(text);
      } catch(e) {}

      if (!res.ok || data.error) throw new Error(data.error || `Failed to parse (status: ${res.status})`);
      
      const parsed: ParsedBankAlert = data;
      setParsedResult(parsed);

      // Match Logic Client-Side
      let bestScore = 0;
      let bestTx: Transaction | null = null;
      let bestReasons: string[] = [];

      if (parsed.narrationCode) {
        const exactMatch = unconfirmedTransfers.find(t => t.paymentNarration?.toUpperCase() === parsed.narrationCode?.toUpperCase());
        if (exactMatch) {
          setMatchResult({
            transaction: exactMatch,
            alert: parsed,
            matchScore: 100,
            matchReasons: ['EXACT MATCH via narration'],
            status: 'pending'
          });
          return;
        }
      }

      unconfirmedTransfers.forEach(tx => {
        let score = 0;
        let reasons: string[] = [];

        // Amount match
        if (tx.amount === parsed.amount) {
          score += 60;
          reasons.push('Exact amount match');
        } else if (Math.abs(tx.amount - parsed.amount) / tx.amount <= 0.01) {
          score += 40;
          reasons.push('Amount within 1%');
        }

        // Date match
        const txDate = new Date(tx.time);
        const parsedDate = new Date(parsed.parsedDate);
        const timeDiff = Math.abs(txDate.getTime() - parsedDate.getTime());
        const daysDiff = timeDiff / (1000 * 3600 * 24);
        
        if (txDate.toISOString().split('T')[0] === parsedDate.toISOString().split('T')[0]) {
          score += 25;
          reasons.push('Same date');
        } else if (daysDiff <= 2) {
          score += 10;
          reasons.push('Date within 2 days');
        }

        // Name match
        const txNameWords = tx.name.toLowerCase().split(/\s+/).filter(w => w.length >= 3);
        const parsedNameLower = parsed.senderName.toLowerCase();
        let nameMatched = false;
        for (const w of txNameWords) {
          if (parsedNameLower.includes(w)) {
            nameMatched = true;
            break;
          }
        }
        if (nameMatched) {
          score += 15;
          reasons.push('Sender name match');
        }

        if (score > bestScore) {
          bestScore = score;
          bestTx = tx;
          bestReasons = reasons;
        }
      });

      if (bestTx) {
        setMatchResult({
          transaction: bestTx,
          alert: parsed,
          matchScore: bestScore,
          matchReasons: bestReasons,
          status: 'pending'
        });
      }
    } catch (e: any) {
      setErrorMsg(e.message);
    } finally {
      setParsing(false);
    }
  };

  const [confirming, setConfirming] = useState(false);

  const confirmMatch = async (tx: Transaction, parsedAlert?: ParsedBankAlert) => {
    // Basic maker-checker: whoever logged the transaction can't also be the
    // one who confirms its payment landed -- otherwise one person can
    // unilaterally push money in and out with no independent check. This
    // client-side check is now also enforced server-side inside
    // confirm_payment_* itself (this screen previously went through the
    // generic onUpdateTx path, which never ran the RPC's own maker-checker
    // guard at all -- only TransactionLedger.tsx's toggleConfirm did).
    if (user?.name && tx.enteredByName && tx.enteredByName === user.name) {
      showToast({ message: `${user.name} logged this transaction and cannot also confirm its payment. Ask another staff member to confirm it.`, type: 'warning' });
      return;
    }
    if (confirming) return;
    setConfirming(true);
    try {
      const bankReference = parsedAlert?.reference;
      const bankSender = parsedAlert?.senderName;
      const bankAlertText = parsedAlert
        ? `Amount: ${parsedAlert.amount}, Sender: ${parsedAlert.senderName}, Date: ${parsedAlert.dateString}`.substring(0, 200)
        : undefined;

      // Same state-wide-authorized RPC dispatcher TransactionLedger.tsx's
      // toggleConfirm uses -- the generic onUpdateTx path this used to call
      // is hub-locked to an exact match and could silently affect 0 rows
      // for a sibling-hub entry while still showing a false "confirmed"
      // success toast.
      const result = await confirmPayment(tx.type as PaymentEntryType, {
        id: tx.id,
        confirmed: true,
        loggedBy: user?.name || 'Unknown',
        bankReference,
        bankSender,
        bankAlertText,
      });
      if (!result.ok) {
        showToast({ message: result.error || 'Failed to confirm payment.', type: 'error' });
        return;
      }

      const updatedTx = { ...tx, paymentConfirmed: true, confirmedAt: new Date().toISOString(), confirmedBy: user?.name };
      if (parsedAlert) {
        updatedTx.bankReference = bankReference;
        updatedTx.bankSender = bankSender;
        updatedTx.bankAlertText = bankAlertText;
      }
      onUpdateTx(updatedTx);
      setMatchResult(null);
      setParsedResult(null);
      setEmailText('');
      showToast({ message: 'Payment confirmed', type: 'success' });
    } finally {
      setConfirming(false);
    }
  };

  const getBankColor = (bank: string) => {
    if (bank.includes('GTBank')) return 'text-orange-500';
    if (bank.includes('UBA')) return 'text-red-500';
    if (bank.includes('Access')) return 'text-orange-600';
    if (bank.includes('Zenith')) return 'text-red-600';
    if (bank.includes('Opay')) return 'text-green-500';
    if (bank.includes('Wema')) return 'text-purple-500';
    return 'text-[var(--color-foreground)]';
  };

  return (
    <div className="flex flex-col p-4 space-y-6 select-none animate-in fade-in duration-300">
      <div className="flex justify-between items-center border-b border-[var(--color-border)] pb-2">
        <span className="text-[10px] font-mono text-[var(--color-accent-cobalt)] tracking-[0.15em] uppercase font-bold">▸ PAYMENT VALIDATION</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* LEFT COLUMN: Paste & Match */}
        <div className="space-y-4">
          <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-xl p-4 shadow-md">
            <h3 className="text-[13px] font-bold text-[var(--color-foreground)] mb-2 flex items-center">
              <Mail size={14} className="mr-2 text-[var(--color-accent-amber)]" />
              PASTE EMAIL ALERT
            </h3>
            <textarea
              className="w-full h-32 bg-[var(--color-surface-1)] text-[12px] font-mono text-[var(--color-foreground)] p-3 rounded-lg border border-[var(--color-border)] focus:border-[var(--color-accent-amber)] focus:outline-none resize-none mb-3"
              placeholder="Paste the full text of the bank alert email here..."
              value={emailText}
              onChange={(e) => setEmailText(e.target.value)}
            />
            {errorMsg && <div className="text-red-400 text-[11px] mb-3">{errorMsg}</div>}
            <button
              onClick={handleParseAndMatch}
              disabled={parsing || !emailText.trim()}
              className="w-full bg-[var(--color-accent-amber)] hover:bg-[var(--color-accent-amber-hover)] text-white text-[12px] font-bold py-2 rounded shadow-sm disabled:opacity-50 transition-colors"
            >
              {parsing ? 'PARSING...' : 'PARSE & MATCH'}
            </button>
          </div>

          {parsedResult && (
            <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-xl p-4 shadow-md animate-in slide-in-from-top-2">
              <h3 className="text-[11px] text-[var(--color-muted)] uppercase tracking-wider mb-2">Parsed Alert Data</h3>
              <div className="flex items-center space-x-2 mb-2">
                <span className={`font-bold ${getBankColor(parsedResult.bankName)}`}>{parsedResult.bankName}</span>
                <span className="text-[10px] bg-[var(--color-surface-2)] px-2 py-0.5 rounded text-[var(--color-foreground)]">
                  Confidence: {parsedResult.confidence}
                </span>
              </div>
              <div className="text-[20px] font-bold font-mono text-[var(--color-foreground)] mb-2">
                {fmt(parsedResult.amount)}
              </div>
              <div className="text-[12px] text-[var(--color-muted)] space-y-1">
                <div><span className="opacity-60">Sender:</span> <span className="text-[var(--color-foreground)]">{parsedResult.senderName}</span></div>
                <div><span className="opacity-60">Date:</span> <span className="text-[var(--color-foreground)]">{parsedResult.dateString}</span></div>
                <div><span className="opacity-60">Ref:</span> <span className="text-[var(--color-foreground)]">{parsedResult.reference || 'N/A'}</span></div>
              </div>
            </div>
          )}

          {matchResult && (
            <div className={`bg-[var(--color-surface-card)] border ${matchResult.matchScore > 70 ? 'border-green-500/50' : 'border-amber-500/50'} rounded-xl p-4 shadow-md animate-in slide-in-from-top-2`}>
              <h3 className="text-[13px] font-bold text-[var(--color-foreground)] mb-3 flex items-center">
                <LinkIcon size={14} className="mr-2" />
                {matchResult.matchScore > 70 ? (
                  <span className="text-green-400">Strong Match ({matchResult.matchScore} pts)</span>
                ) : matchResult.matchScore >= 40 ? (
                  <span className="text-amber-400">Possible Match ({matchResult.matchScore} pts)</span>
                ) : (
                  <span className="text-red-400">Low Confidence Match ({matchResult.matchScore} pts)</span>
                )}
              </h3>
              
              <div className="bg-[var(--color-surface-1)] p-3 rounded-lg border border-[var(--color-border)] mb-4">
                <div className="flex justify-between items-start mb-2">
                  <div className="text-[13px] font-bold text-[var(--color-foreground)]">{matchResult.transaction.name}</div>
                  <div className="text-[13px] font-mono font-bold text-[var(--color-accent-amber)]">{fmt(matchResult.transaction.amount)}</div>
                </div>
                <div className="text-[11px] text-[var(--color-muted)] mb-2">{matchResult.transaction.detail}</div>
                <div className="flex flex-wrap gap-1">
                  {matchResult.matchReasons.map((r, i) => (
                    <span key={i} className="text-[9px] bg-[var(--color-border)] px-1.5 py-0.5 rounded border border-[var(--color-surface-2)]">
                      {r}
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex space-x-2">
                <button
                  onClick={() => confirmMatch(matchResult.transaction, matchResult.alert)}
                  disabled={confirming}
                  className="flex-1 bg-green-600 hover:bg-green-500 text-white text-[12px] font-bold py-2 rounded transition-colors flex justify-center items-center disabled:opacity-50"
                >
                  <CheckCircle size={14} className="mr-2" /> {confirming ? 'CONFIRMING...' : 'CONFIRM THIS MATCH'}
                </button>
                <button
                  onClick={() => setMatchResult(null)}
                  className="px-4 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)] text-[var(--color-foreground)] text-[12px] font-bold py-2 rounded transition-colors"
                >
                  DISMISS
                </button>
              </div>
            </div>
          )}

          {parsedResult && !matchResult && (
             <div className="bg-[var(--color-surface-card)] border border-red-500/30 rounded-xl p-4 shadow-md text-center">
               <AlertCircle size={24} className="text-red-400 mx-auto mb-2" />
               <h3 className="text-[13px] font-bold text-red-400 mb-1">No confident match found</h3>
               <p className="text-[11px] text-[var(--color-muted)]">Could not find a pending Transfer with a similar amount or name.</p>
             </div>
          )}

        </div>

        {/* RIGHT COLUMN: Confirmed history + auto-forward setup. The plain
            "pending transfers + manual confirm" list that used to live here
            is now redundant with the Transaction Ledger, which surfaces
            Cash and Transfer together under its "Unverified" filter with
            the same confirm action -- this screen's remaining job is just
            the bank-alert paste-and-match tool above. */}
        <div className="space-y-4">
          <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-xl p-4 shadow-md">
            <h3 className="text-[13px] font-bold text-[var(--color-foreground)] mb-3 flex justify-between items-center">
              <span className="flex items-center"><CheckCircle size={14} className="mr-2 text-green-500" /> RECENTLY CONFIRMED</span>
              <span className="bg-green-500/20 text-green-500 text-[10px] px-2 py-0.5 rounded-full">{recentlyConfirmed.length} TODAY</span>
            </h3>
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {recentlyConfirmed.length === 0 ? (
                <div className="text-center text-[var(--color-muted)] text-[11px] py-2">No confirmations today.</div>
              ) : (
                recentlyConfirmed.map(tx => (
                  <div key={tx.id} className="text-[11px] border-l-2 border-green-500 pl-2">
                    <div className="text-[var(--color-foreground)] font-medium truncate">{tx.name} <span className="font-mono text-green-400 ml-1">{fmt(tx.amount)}</span></div>
                    <div className="text-[9px] text-[var(--color-muted)] truncate">{tx.bankSender || 'Manual'} · {tx.bankReference || 'N/A'}</div>
                  </div>
                ))
              )}
            </div>
          </div>
          
          <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-xl shadow-md overflow-hidden">
            <button 
              onClick={() => setShowAutoForward(!showAutoForward)}
              className="w-full flex justify-between items-center p-3 text-[12px] font-bold text-[var(--color-foreground)] hover:bg-[var(--color-surface-1)] transition-colors"
            >
              <span className="flex items-center"><Mail size={14} className="mr-2" /> SET UP AUTO-FORWARD</span>
              {showAutoForward ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            {showAutoForward && (
              <div className="p-4 border-t border-[var(--color-border)] bg-[var(--color-surface-1)] text-[11px] text-[var(--color-muted)] space-y-2">
                <p>To receive confirmations automatically without pasting emails, forward your bank alerts to this address:</p>
                <div className="bg-[var(--color-surface-3)] p-2 rounded border border-[var(--color-border)] font-mono text-[10px] break-all select-all">
                  [server-url]/api/validate-payment/inbound?secret=[INBOUND_WEBHOOK_SECRET]
                </div>
                <p>The <code>secret</code> query param must match the server's <code>INBOUND_WEBHOOK_SECRET</code> environment variable — ask an administrator for the value.</p>
                <p className="font-bold text-[var(--color-foreground)] mt-2">How to set up auto-forward:</p>
                <ol className="list-decimal pl-4 space-y-1">
                  <li>Gmail: Settings → Filters → Create filter → From: [bank email address]</li>
                  <li>Forward to [webhook email if using Postmark/Sendgrid, or show the direct URL]</li>
                </ol>
                <p className="mt-2"><span className="font-bold text-[var(--color-foreground)]">Supported banks:</span> GTBank, UBA, Access Bank, Zenith Bank, Opay, Wema Bank</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
