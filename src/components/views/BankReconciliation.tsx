import React, { useState } from 'react';
import { ArrowLeft, Upload, CheckCircle2, AlertCircle, RefreshCw, Layers, DollarSign, FileSpreadsheet, Loader2, AlertTriangle, Download } from 'lucide-react';
import { fmt } from '../../lib/helpers';
import { Transaction, User } from '../../lib/types';
import { supabase } from '../../lib/supabase';

export type BankFormat = 'UBA' | 'GTBank' | 'Access' | 'Zenith' | 'FirstBank';

interface BankTx {
  id: string;
  date: string;
  description: string;
  credit: number;
  reference: string;
  matchedId?: string;
  status: 'Unmatched' | 'Auto-Matched' | 'Manual-Matched' | 'Near-Match';
  suspicious?: boolean;
}

const parseNigerianBankCSV = (csvText: string, bank: BankFormat): BankTx[] => {
  const lines = csvText.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length === 0) return [];
  
  let headerIdx = -1;
  for (let i = 0; i < Math.min(20, lines.length); i++) {
    const l = lines[i].toLowerCase();
    if (l.includes('date') || l.includes('trans date') || l.includes('value date')) {
      headerIdx = i;
      break;
    }
  }
  
  if (headerIdx === -1) headerIdx = 0;
  
  const headers = lines[headerIdx].split(',').map(h => h.replace(/["']/g, '').trim().toLowerCase());
  
  let dateCol = -1, descCol = -1, creditCol = -1;
  
  headers.forEach((h, i) => {
    if (h.includes('date')) dateCol = i;
    else if (h.includes('desc') || h.includes('detail') || h.includes('remark') || h.includes('narration')) descCol = i;
    else if (h.includes('credit') || h === 'cr' || h.includes('(cr)')) creditCol = i;
  });

  // Fallbacks if header mapping fails
  if (dateCol === -1) dateCol = 0;
  if (descCol === -1) descCol = 1;
  if (creditCol === -1) creditCol = 3; 

  const normalizeDate = (dStr: string) => {
    const s = dStr.replace(/["']/g, '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const parts = s.split(/[\/\- ]/);
    if (parts.length >= 3) {
      if (parts[0].length === 4) return `${parts[0]}-${parts[1].padStart(2,'0')}-${parts[2].padStart(2,'0')}`;
      if (parts[2].length === 4) return `${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`;
    }
    const dt = new Date(s);
    if (!isNaN(dt.getTime())) return dt.toISOString().split('T')[0];
    return s;
  };

  const results: BankTx[] = [];
  let index = 1;

  for (let i = headerIdx + 1; i < lines.length; i++) {
    // Basic CSV parsing handling quoted commas
    const row = [];
    let cur = '';
    let inQuote = false;
    for (let c = 0; c < lines[i].length; c++) {
      const char = lines[i][c];
      if (char === '"') { inQuote = !inQuote; }
      else if (char === ',' && !inQuote) { row.push(cur); cur = ''; }
      else { cur += char; }
    }
    row.push(cur);

    if (row.length <= Math.max(dateCol, descCol, creditCol)) continue;

    const descRaw = (row[descCol] || '').replace(/["']/g, '').trim();
    if (descRaw.toUpperCase().includes('OPENING BALANCE') || descRaw.toUpperCase().includes('CLOSING BALANCE')) continue;

    const creditStr = (row[creditCol] || '').replace(/["'₦, ]/g, '');
    const credit = parseFloat(creditStr);
    
    if (!credit || isNaN(credit) || credit <= 0) continue;

    const date = normalizeDate(row[dateCol]);
    const suspicious = /UNREGISTERED|UNKNOWN|SUSPICIOUS/i.test(descRaw);

    results.push({
      id: `BTX-${index++}`,
      date,
      description: descRaw,
      credit,
      reference: `REF-${Math.floor(Math.random() * 10000000).toString()}`,
      status: 'Unmatched',
      suspicious
    });
  }
  
  return results;
};

export const BankReconciliation = ({
  transactions,
  onBack,
  onConfirm,
  user
}: {
  transactions: Transaction[];
  onBack: () => void;
  onConfirm?: (s: { matched: number, unmatched: number, totalMatched: number, matchedIds: string[] }) => void;
  user?: User;
}) => {
  const [method, setMethod] = useState<'CSV' | 'PDF'>('CSV');
  const [bankType, setBankType] = useState<BankFormat>('UBA');
  const [fileImported, setFileImported] = useState(false);
  const [matchingInProgress, setMatchingInProgress] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  
  const [bankTxList, setBankTxList] = useState<BankTx[]>([]);
  const [loadingPdf, setLoadingPdf] = useState(false);
  const [pdfError, setPdfError] = useState('');
  const [fileName, setFileName] = useState('');
  const [showSuccess, setShowSuccess] = useState(false);
  const [matchWarning, setMatchWarning] = useState<string | null>(null);

  // Consider all transfers or POS as possible deposits
  const systemPayments = transactions.filter(t => t.mode === 'Transfer' || t.mode === 'POS').map(t => ({
    id: t.id,
    name: t.name,
    amount: t.amount,
    time: t.time,
    date: new Date().toISOString().split('T')[0],
    matched: false
  }));

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement> | React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    setPdfError('');
    
    let file: File | null = null;
    if ('dataTransfer' in e) {
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) file = e.dataTransfer.files[0];
    } else {
      if (e.target.files && e.target.files.length > 0) file = e.target.files[0];
    }
    
    if (!file) return;
    setFileName(file.name);

    if (method === 'CSV' && (file.name.endsWith('.csv') || file.name.endsWith('.txt'))) {
      const text = await file.text();
      const parsed = parseNigerianBankCSV(text, bankType);
      setBankTxList(parsed);
      setFileImported(true);
    } else if (method === 'PDF' && file.name.endsWith('.pdf')) {
      setLoadingPdf(true);
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64Data = (reader.result as string).split(',')[1];
          const { data: sess } = await supabase.auth.getSession();
          const token = sess.session?.access_token || '';
          const res = await fetch('/api/gemini/parse-pdf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ pdfBase64: base64Data })
          });
          
          let data: any = {};
          try {
            const text = await res.text();
            if (text) data = JSON.parse(text);
          } catch(e) {}
          
          if (!res.ok || data.error) {
            throw new Error(data.error || `Server returned error status ${res.status}`);
          }
          
          if (data.success && data.transactions) {
            let idx = 1;
            const parsed = data.transactions.map((t: any) => ({
              id: `BTX-${idx++}`,
              date: t.date || new Date().toISOString().split('T')[0],
              description: t.description || 'Unknown Deposit',
              credit: parseFloat(t.credit),
              reference: t.reference || `AI-REF-${Math.floor(Math.random()*1000000)}`,
              status: 'Unmatched',
              suspicious: /UNREGISTERED|UNKNOWN|SUSPICIOUS/i.test(t.description || ''),
            }));
            setBankTxList(parsed);
            setFileImported(true);
          } else {
            setPdfError("Could not read this PDF. Try downloading it as CSV instead.");
          }
        } catch (err) {
          setPdfError("Could not read this PDF. Try downloading it as CSV instead.");
        } finally {
          setLoadingPdf(false);
        }
      };
      reader.readAsDataURL(file);
    } else {
      setPdfError(`Please upload a valid ${method} file.`);
    }
  };

  const handleAutoMatch = () => {
    setMatchingInProgress(true);
    setTimeout(() => {
      const claimedIds = new Set(
        bankTxList.filter(b => b.matchedId).map(b => b.matchedId as string)
      );
      setBankTxList(prev => prev.map(btx => {
        if (btx.status !== 'Unmatched' && btx.status !== 'Near-Match') return btx;

        const available = (sp: { id: string }) => !claimedIds.has(sp.id);

        // Exact Priority: amount matches AND description contains client name
        const exactMatch = systemPayments.find(sp => available(sp) && sp.amount === btx.credit && btx.description.toLowerCase().includes(sp.name.toLowerCase().split(' ')[0]));
        if (exactMatch) { claimedIds.add(exactMatch.id); return { ...btx, status: 'Auto-Matched', matchedId: exactMatch.id }; }

        // Amount Priority
        const amtMatch = systemPayments.find(sp => available(sp) && sp.amount === btx.credit);
        if (amtMatch) { claimedIds.add(amtMatch.id); return { ...btx, status: 'Auto-Matched', matchedId: amtMatch.id }; }

        // Fuzzy Priority
        const fuzzyMatch = systemPayments.find(sp => available(sp) && Math.abs(sp.amount - btx.credit) <= 500);
        if (fuzzyMatch) { claimedIds.add(fuzzyMatch.id); return { ...btx, status: 'Near-Match', matchedId: fuzzyMatch.id }; }

        return btx;
      }));
      setMatchingInProgress(false);
    }, 1500);
  };

  const handleManualMatch = (btxId: string, sysId: string) => {
    const alreadyClaimedBy = bankTxList.find(b => b.id !== btxId && b.matchedId === sysId);
    if (alreadyClaimedBy) {
      setMatchWarning('This system transaction is already matched to another bank line.');
      return;
    }
    setMatchWarning(null);
    setBankTxList(prev => prev.map(btx => {
      if (btx.id === btxId) return { ...btx, status: 'Manual-Matched', matchedId: sysId };
      return btx;
    }));
  };

  const handleConfirmFuzzy = (btxId: string) => {
    setBankTxList(prev => prev.map(btx => {
      if (btx.id === btxId) return { ...btx, status: 'Manual-Matched' };
      return btx;
    }));
  };

  const handleResetMatch = (btxId: string) => {
    setBankTxList(prev => prev.map(btx => {
      if (btx.id === btxId) return { ...btx, status: 'Unmatched', matchedId: undefined };
      return btx;
    }));
  };

  const unmatchedBtxCount = bankTxList.filter(b => b.status === 'Unmatched' || b.status === 'Near-Match').length;
  const matchedBtxCount = bankTxList.filter(b => b.status === 'Auto-Matched' || b.status === 'Manual-Matched').length;
  const totalCredits = bankTxList.reduce((sum, b) => sum + b.credit, 0);

  const confirmRecon = () => {
    const matchedIds = bankTxList.filter(b => b.status === 'Auto-Matched' || b.status === 'Manual-Matched').map(b => b.matchedId).filter(Boolean) as string[];
    if (onConfirm) onConfirm({ matched: matchedBtxCount, unmatched: unmatchedBtxCount, totalMatched: totalCredits, matchedIds });
    supabase.from('bank_reconciliations').insert({
      bank_type: bankType,
      file_name: fileName || null,
      run_by: user?.name || null,
      run_by_id: user?.id && user.id.includes('-') && user.id.length > 30 ? user.id : null,
      matched_count: matchedBtxCount,
      unmatched_count: unmatchedBtxCount,
      total_credits: totalCredits,
      bank_tx_snapshot: bankTxList,
    }).then(({ error }) => {
      if (error) console.error('Failed to persist bank reconciliation run:', error);
    });
    setShowSuccess(true);
  };

  const downloadReport = () => {
    const csvContent = [
      "Bank Ref,Bank Description,Amount,Status,System Match ID,System Client Name",
      ...bankTxList.map(b => {
         const sys = b.matchedId ? systemPayments.find(s => s.id === b.matchedId) : null;
         return `${b.reference},"${b.description}",${b.credit},${b.status},${b.matchedId || ''},${sys ? sys.name : ''}`;
      })
    ].join("\\n");
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Recon_${bankType}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  if (showSuccess) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-[var(--color-obsidian)] p-8 text-center animate-in zoom-in-95">
         <div className="w-16 h-16 rounded-full bg-[rgba(16,185,129,0.1)] flex items-center justify-center border border-[rgba(16,185,129,0.2)] mb-4">
           <CheckCircle2 size={32} className="text-[var(--color-success)]" />
         </div>
         <h2 className="text-[20px] font-sans font-bold text-[var(--color-foreground)] mb-2">Reconciliation confirmed</h2>
         <p className="text-[14px] font-sans text-[var(--color-muted)] mb-8 max-w-sm">
           {matchedBtxCount} of {bankTxList.length} transactions matched. Saved to accounting ledger.
         </p>
         <div className="flex space-x-3">
           <button onClick={downloadReport} className="flex items-center space-x-2 bg-neutral-800 hover:bg-neutral-700 text-[var(--color-foreground)] font-sans text-[13px] font-medium px-5 py-2.5 rounded-lg transition-colors">
             <Download size={16} /> <span>Download Report</span>
           </button>
           <button onClick={onBack} className="flex items-center space-x-2 bg-[var(--color-accent-cobalt)] hover:bg-opacity-90 text-white font-sans text-[13px] font-bold px-5 py-2.5 rounded-lg transition-colors">
             <span>Return</span>
           </button>
         </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[var(--color-obsidian)] p-4 text-[var(--color-foreground)] overflow-y-auto pb-[80px]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-4 mb-4">
        <button onClick={onBack} className="flex items-center space-x-2 text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors">
          <ArrowLeft size={18} />
          <span className="text-[14px] font-sans font-medium">Back</span>
        </button>
      </div>

      <div className="mb-6">
        <h1 className="text-[18px] font-sans font-bold text-[var(--color-foreground)] leading-tight">Bank Reconciliation</h1>
        <div className="text-[13px] font-sans text-[var(--color-muted)]">Match bank deposits with your system records</div>
      </div>

      {!fileImported ? (
        <div className="bg-[var(--color-surface-card)] border border-[rgba(255,255,255,0.07)] rounded-xl p-5 space-y-4">
          <div className="flex justify-between items-center mb-2">
            <div className="flex bg-[var(--color-surface-1)] rounded-lg p-1 border border-[rgba(255,255,255,0.07)]">
               <button onClick={() => setMethod('CSV')} className={`px-4 py-1.5 text-[12px] font-sans font-medium rounded-md ${method === 'CSV' ? 'bg-[var(--color-surface-2)] text-[var(--color-foreground)] shadow-sm' : 'text-[var(--color-muted)]'}`}>CSV</button>
               <button onClick={() => setMethod('PDF')} className={`px-4 py-1.5 text-[12px] font-sans font-medium rounded-md ${method === 'PDF' ? 'bg-[var(--color-surface-2)] text-[var(--color-foreground)] shadow-sm' : 'text-[var(--color-muted)]'}`}>PDF Parser</button>
            </div>
            {method === 'CSV' && (
              <select 
                value={bankType} 
                onChange={(e) => setBankType(e.target.value as any)}
                className="bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.07)] rounded-lg px-3 py-1.5 text-[12px] font-sans focus:outline-none focus:border-[var(--color-accent-cobalt)]"
              >
                <option value="UBA">UBA Statement</option>
                <option value="GTBank">GTBank Statement</option>
                <option value="Access">Access Bank</option>
                <option value="Zenith">Zenith Bank</option>
                <option value="FirstBank">First Bank</option>
              </select>
            )}
          </div>

          <div 
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleFileUpload}
            className={`border-2 border-dashed rounded-xl p-8 py-12 text-center flex flex-col items-center justify-center space-y-3 transition-colors ${
              dragOver ? 'border-[var(--color-accent-cobalt)] bg-blue-500/5' : 'border-[var(--color-surface-2)] bg-[var(--color-surface-1)]'
            }`}
          >
            {loadingPdf ? (
               <Loader2 size={32} className="text-[var(--color-accent-cobalt)] animate-spin" />
            ) : (
               <Upload size={32} className={`${dragOver ? 'text-[var(--color-accent-cobalt)]' : 'text-[var(--color-muted)]'}`} />
            )}
            
            <div className="space-y-1">
              <span className="text-[14px] font-sans font-semibold text-[var(--color-foreground)] block">
                {loadingPdf ? 'Processing PDF with Gemini AI...' : `Drag and drop ${method} statement`}
              </span>
              <span className="text-[12px] text-[var(--color-muted)] font-sans block">
                {loadingPdf ? 'Extracting transactions from document format...' : `Supports .${method.toLowerCase()} statement exports`}
              </span>
            </div>
            
            {pdfError && <div className="text-[12px] font-sans text-[var(--color-error)] mt-2 bg-[rgba(239,68,68,0.1)] px-3 py-1.5 rounded">{pdfError}</div>}
            
            {!loadingPdf && (
              <div className="relative mt-4">
                <input 
                  type="file" 
                  accept={method === 'CSV' ? '.csv,.txt' : '.pdf'}
                  onChange={handleFileUpload}
                  className="absolute inset-0 opacity-0 w-full cursor-pointer h-full"
                />
                <button className="bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-1)] border border-[var(--color-surface-2)] text-[var(--color-foreground)] font-sans text-[13px] font-medium px-6 py-2.5 rounded-lg pointer-events-none">
                  Select File
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-[var(--color-surface-card)] border border-[rgba(255,255,255,0.07)] p-4 rounded-xl">
              <span className="text-[12px] font-sans font-medium text-[var(--color-muted)] block">Statement Credits</span>
              <span className="text-[20px] font-bold font-mono text-[var(--color-foreground)] mt-1 block">{fmt(totalCredits)}</span>
              <span className="text-[11px] font-sans text-slate-500 block mt-1">{bankTxList.length} transactions</span>
            </div>
            
            <div className="bg-[var(--color-surface-card)] border border-[rgba(16,185,129,0.2)] p-4 rounded-xl bg-[rgba(16,185,129,0.03)]">
              <span className="text-[12px] font-sans font-medium text-[var(--color-success)] block opacity-80">Matched Deposits</span>
              <span className="text-[20px] font-bold font-mono text-[var(--color-success)] mt-1 block">
                {fmt(bankTxList.filter(b => b.status === 'Auto-Matched' || b.status === 'Manual-Matched').reduce((sum, b) => sum + b.credit, 0))}
              </span>
              <span className="text-[11px] font-sans text-[var(--color-success)] block mt-1 opacity-80">{matchedBtxCount} records paired</span>
            </div>

            <div className="bg-[var(--color-surface-card)] border border-[rgba(239,68,68,0.2)] p-4 rounded-xl bg-[rgba(239,68,68,0.03)]">
              <span className="text-[12px] font-sans font-medium text-[var(--color-error)] block opacity-80">Unresolved</span>
              <span className="text-[20px] font-bold font-mono text-[var(--color-error)] mt-1 block">
                {fmt(bankTxList.filter(b => b.status === 'Unmatched' || b.status === 'Near-Match').reduce((sum, b) => sum + b.credit, 0))}
              </span>
              <span className="text-[11px] font-sans text-[var(--color-error)] block mt-1 opacity-80">{unmatchedBtxCount} unmatched left</span>
            </div>
          </div>

          <div className="bg-[var(--color-surface-card)] border border-[rgba(255,255,255,0.07)] rounded-xl p-4 flex flex-col sm:flex-row justify-between items-center gap-3">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-lg bg-[rgba(59,130,246,0.1)] flex items-center justify-center text-[var(--color-accent-cobalt)]">
                <FileSpreadsheet size={20} />
              </div>
              <div>
                <span className="text-[14px] font-sans font-bold text-[var(--color-foreground)] block">{fileName || 'Imported Statement'}</span>
                <span className="text-[12px] font-sans text-[var(--color-muted)] block mt-0.5">Matched {matchedBtxCount}/{bankTxList.length}</span>
              </div>
            </div>

            <div className="flex space-x-2">
              <button 
                onClick={handleAutoMatch}
                disabled={matchingInProgress || unmatchedBtxCount === 0}
                className="bg-[var(--color-accent-cobalt)] hover:bg-blue-600 disabled:opacity-50 text-white font-sans text-[13px] font-bold px-4 py-2.5 rounded-lg flex items-center space-x-2 cursor-pointer transition-colors"
              >
                <Layers size={16} className={matchingInProgress ? 'animate-spin' : ''} />
                <span>{matchingInProgress ? 'Matching...' : 'Auto-Match Engine'}</span>
              </button>
              
              <button 
                onClick={() => setFileImported(false)}
                className="bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.07)] text-[var(--color-foreground)] font-sans text-[13px] font-medium px-4 py-2.5 rounded-lg cursor-pointer transition-colors"
              >
                Reset Sheet
              </button>
            </div>
          </div>

          {matchWarning && (
            <div className="bg-[rgba(239,68,68,0.08)] border border-[rgba(239,68,68,0.3)] rounded-xl p-3 flex items-center justify-between gap-3">
              <span className="text-[12px] font-sans text-[var(--color-error)]">{matchWarning}</span>
              <button onClick={() => setMatchWarning(null)} className="text-[11px] font-sans text-[var(--color-muted)] hover:text-[var(--color-foreground)]">Dismiss</button>
            </div>
          )}

          <div className="bg-[var(--color-surface-card)] border border-[rgba(255,255,255,0.07)] rounded-xl overflow-hidden">
            <div className="p-4 border-b border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.01)] flex justify-between items-center">
              <span className="text-[12px] font-sans font-bold text-[var(--color-muted)] uppercase tracking-wider">Statement Ledger vs. System Log</span>
            </div>

            <div className="divide-y divide-[var(--color-border)]">
              {bankTxList.map((btx) => {
                const correspondingSysPayment = btx.matchedId ? systemPayments.find(sp => sp.id === btx.matchedId) : null;
                return (
                  <div key={btx.id} className="p-4 grid grid-cols-1 md:grid-cols-12 gap-4 items-center hover:bg-[rgba(255,255,255,0.01)] transition-colors">
                    <div className="md:col-span-5 space-y-1.5">
                      <div className="flex items-center space-x-2">
                        <span className="text-[11px] font-sans text-[var(--color-muted)]">{btx.date}</span>
                        <span className="text-[10px] font-mono bg-[rgba(255,255,255,0.06)] text-[var(--color-muted)] px-1.5 py-0.5 rounded uppercase">{btx.reference}</span>
                        {btx.suspicious && (
                           <span className="text-[10px] font-sans font-bold bg-[rgba(239,68,68,0.1)] text-[var(--color-error)] px-1.5 py-0.5 rounded flex items-center space-x-1" title="Review this transaction manually">
                             <AlertTriangle size={10} /> <span>Suspicious</span>
                           </span>
                        )}
                      </div>
                      <span className="text-[13px] font-sans font-medium text-[var(--color-foreground)] block leading-snug">{btx.description}</span>
                    </div>

                    <div className="md:col-span-2 flex flex-col md:items-center">
                      <span className="text-[15px] font-bold font-mono text-[var(--color-success)]">{fmt(btx.credit)}</span>
                      <span className="text-[10px] font-sans text-slate-500 mt-0.5">Deposit</span>
                    </div>

                    <div className="md:col-span-5 flex items-center justify-between md:justify-end space-x-3 rounded-xl p-3 md:p-0 bg-[rgba(0,0,0,0.2)] md:bg-transparent">
                      {(btx.status === 'Unmatched' || btx.status === 'Near-Match') ? (
                        <>
                          <div className="text-left md:text-right">
                            {btx.status === 'Near-Match' ? (
                               <span className="text-[12px] text-[var(--color-accent-amber)] font-sans font-semibold block flex items-center space-x-1 md:justify-end">
                                 <AlertCircle size={14}/><span>Near Match?</span>
                               </span>
                            ) : (
                               <span className="text-[12px] text-[var(--color-error)] font-sans font-semibold block">Unresolved</span>
                            )}
                            <span className="text-[11px] text-[var(--color-muted)] font-sans block">{btx.status === 'Near-Match' ? 'Review fuzzy match' : 'No matching record'}</span>
                          </div>
                          
                          <div className="flex space-x-2 flex-wrap justify-end">
                            {btx.status === 'Near-Match' && btx.matchedId && (
                               <button
                                 onClick={() => handleConfirmFuzzy(btx.id)}
                                 className="bg-[rgba(245,158,11,0.1)] hover:bg-[rgba(245,158,11,0.2)] border border-[rgba(245,158,11,0.3)] text-[var(--color-accent-amber)] text-[11px] font-sans font-bold px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
                               >
                                 Confirm Pair
                               </button>
                            )}
                            {btx.status === 'Unmatched' && systemPayments.filter(sp => sp.amount === btx.credit).map((sp) => (
                              <button
                                key={sp.id}
                                onClick={() => handleManualMatch(btx.id, sp.id)}
                                className="bg-[rgba(16,185,129,0.1)] hover:bg-[rgba(16,185,129,0.2)] border border-[rgba(16,185,129,0.3)] text-[var(--color-success)] text-[11px] font-sans font-bold px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
                              >
                                Pair with {sp.name.split(' ')[0]}
                              </button>
                            ))}
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="text-left md:text-right mr-3">
                            <div className="flex items-center md:justify-end space-x-1.5 mb-0.5">
                              <CheckCircle2 size={14} className="text-[var(--color-success)]" />
                              <span className="text-[12px] text-[var(--color-success)] font-sans font-bold">
                                {btx.status === 'Auto-Matched' ? 'Auto Mapped' : 'Manually Paired'}
                              </span>
                            </div>
                            <span className="text-[11px] text-slate-400 font-sans block truncate max-w-[200px]">
                              Ledger: {correspondingSysPayment ? correspondingSysPayment.name : btx.matchedId || ''}
                            </span>
                          </div>
                          <button 
                            onClick={() => handleResetMatch(btx.id)}
                            className="bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-1)] text-slate-300 px-3 py-1.5 rounded-lg text-[11px] font-sans font-medium transition-colors cursor-pointer"
                          >
                            Unlink
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="p-5 border-t border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.01)] flex justify-between items-center flex-col sm:flex-row gap-4">
              <div className="flex items-center space-x-2">
                <AlertCircle size={16} className="text-[var(--color-muted)]" />
                <span className="text-[12px] font-sans text-[var(--color-muted)]">Reconciliation locks automated ledger accounting updates.</span>
              </div>
              <button 
                onClick={confirmRecon}
                disabled={matchedBtxCount === 0}
                className="bg-[var(--color-success)] hover:bg-emerald-600 disabled:opacity-50 text-[#0B0F19] font-sans text-[14px] font-bold px-6 py-3 rounded-xl transition-colors cursor-pointer flex items-center space-x-2"
              >
                <CheckCircle2 size={18} />
                <span>Confirm & Lock Selected</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
