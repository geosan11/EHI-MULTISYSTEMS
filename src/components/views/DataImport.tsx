import { useState, useRef, useCallback } from 'react';
import { Upload, Download, CheckCircle, AlertTriangle, ArrowLeft, FileText, X, RefreshCw, Table } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { uid } from '../../lib/helpers';
import { User } from '../../lib/types';

type ImportType = 'cargo' | 'marketing';
type Stage = 'upload' | 'preview' | 'importing' | 'done';

interface ParsedRow {
  [key: string]: string;
}

interface ValidationError {
  rowIndex: number;
  message: string;
}

interface ImportResult {
  imported: number;
  skipped: number;
}

const CARGO_COLUMNS = ['date', 'consignee_name', 'awb_tag_number', 'airline', 'route', 'total_pcs', 'total_kg', 'content_type', 'amount', 'receipt_mode', 'bank', 'remark'];
const MARKETING_COLUMNS = ['date', 'customer_name', 'airline', 'route', 'big_bags', 'med_bags', 'small_bags', 'amount', 'payment_mode', 'bank'];
const CARGO_REQUIRED = ['date', 'consignee_name', 'route', 'amount'];
const MARKETING_REQUIRED = ['date', 'customer_name', 'route', 'amount'];
const ALL_KNOWN_COLUMNS = new Set([...CARGO_COLUMNS, ...MARKETING_COLUMNS]);
const CHUNK_SIZE = 25;

const CARGO_TEMPLATE = [
  CARGO_COLUMNS.join(','),
  '2024-01-15,John Doe,AWB-123456,Green Africa Airways,LOS/ABJ,2,10.5,Clothes & Shoes,15000,Cash,,',
  '2024-01-15,Jane Smith,,United Nigeria Airlines,LOS/PHC,1,5.0,Documents,8000,Transfer,GTBank,Urgent',
].join('\n');

const MARKETING_TEMPLATE = [
  MARKETING_COLUMNS.join(','),
  '2024-01-15,Chukwuemeka Ltd,Green Africa Airways,LOS/ABJ,3,2,1,25000,Cash,',
  '2024-01-15,Adaeze Travels,United Nigeria Airlines,LOS/PHC,0,5,3,18000,Transfer,Access Bank',
].join('\n');

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

function parseCSV(text: string): ParsedRow[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) return [];

  const firstFields = parseCsvLine(lines[0]);
  const firstLower = firstFields.map(f => f.toLowerCase().trim());
  const isHeader = firstLower.some(f => ALL_KNOWN_COLUMNS.has(f));

  const headers = firstLower;
  const dataLines = isHeader ? lines.slice(1) : lines;

  return dataLines
    .filter(l => l.trim())
    .map(line => {
      const values = parseCsvLine(line);
      const obj: ParsedRow = {};
      headers.forEach((h, i) => {
        obj[h] = (values[i] ?? '').trim();
      });
      return obj;
    });
}

function validateRows(rows: ParsedRow[], type: ImportType): ValidationError[] {
  const required = type === 'cargo' ? CARGO_REQUIRED : MARKETING_REQUIRED;
  const errors: ValidationError[] = [];
  rows.forEach((r, i) => {
    for (const field of required) {
      if (!r[field] || !r[field].trim()) {
        errors.push({ rowIndex: i, message: `Row ${i + 2}: missing required field "${field}"` });
      }
    }
    if (r.date && r.date.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(r.date.trim())) {
      errors.push({ rowIndex: i, message: `Row ${i + 2}: date must be YYYY-MM-DD (got "${r.date}")` });
    }
    if (r.amount && r.amount.trim() && isNaN(parseFloat(r.amount))) {
      errors.push({ rowIndex: i, message: `Row ${i + 2}: amount must be a number (got "${r.amount}")` });
    }
  });
  return errors;
}

function downloadTemplate(type: ImportType) {
  const csv = type === 'cargo' ? CARGO_TEMPLATE : MARKETING_TEMPLATE;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ehi_${type}_import_template.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const DataImport = ({ user, onBack }: { user: User; onBack: () => void }) => {
  const [importType, setImportType] = useState<ImportType>('cargo');
  const [stage, setStage] = useState<Stage>('upload');
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<ImportResult>({ imported: 0, skipped: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const columns = importType === 'cargo' ? CARGO_COLUMNS : MARKETING_COLUMNS;

  const resetWorkflow = useCallback(() => {
    setStage('upload');
    setRows([]);
    setErrors([]);
    setFileError(null);
    setProgress({ done: 0, total: 0 });
    setResult({ imported: 0, skipped: 0 });
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const handleFile = useCallback((file: File) => {
    if (!file.name.toLowerCase().endsWith('.csv') && !file.type.includes('csv') && !file.type.includes('text/plain')) {
      setFileError('Please upload a .csv file.');
      return;
    }
    setFileError(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const parsed = parseCSV(text);
      if (parsed.length === 0) {
        setFileError('File appears to be empty or could not be parsed.');
        return;
      }
      const validationErrors = validateRows(parsed, importType);
      setRows(parsed);
      setErrors(validationErrors);
      setStage('preview');
    };
    reader.onerror = () => setFileError('Could not read the file.');
    reader.readAsText(file);
  }, [importType]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const errorRowIndices = new Set(errors.map(e => e.rowIndex));
  const validRows = rows.filter((_, i) => !errorRowIndices.has(i));

  const runImport = async () => {
    setStage('importing');
    setProgress({ done: 0, total: validRows.length });

    let imported = 0;
    let skipped = rows.length - validRows.length;

    for (let i = 0; i < validRows.length; i += CHUNK_SIZE) {
      const chunk = validRows.slice(i, i + CHUNK_SIZE);

      const records = chunk.map(r => {
        if (importType === 'cargo') {
          return {
            entry_ref: uid('CG'),
            awb_tag_number: r.awb_tag_number || `AWB-${Math.floor(100000 + Math.random() * 900000)}`,
            consignee_name: r.consignee_name,
            airline: r.airline || null,
            route: r.route,
            total_pcs: parseInt(r.total_pcs) || 1,
            total_kg: parseFloat(r.total_kg) || 0,
            content_type: r.content_type || null,
            amount: parseFloat(r.amount),
            receipt_mode: r.receipt_mode || 'Cash',
            bank: r.bank || null,
            remark: r.remark || null,
            status: 'Intake',
            hub_id: user.hub_id || null,
            hub: user.hub,
            logged_by: user.name,
            entered_by: user.id,
            created_at: new Date(r.date).toISOString(),
            updated_at: new Date().toISOString(),
          };
        } else {
          return {
            entry_ref: uid('MK'),
            customer_name: r.customer_name,
            airline: r.airline || null,
            route: r.route,
            big_bags: parseInt(r.big_bags) || 0,
            med_bags: parseInt(r.med_bags) || 0,
            small_bags: parseInt(r.small_bags) || 0,
            amount: parseFloat(r.amount),
            payment_mode: r.payment_mode || 'Cash',
            bank: r.bank || null,
            hub_id: user.hub_id || null,
            hub: user.hub,
            agent_name: user.name,
            entered_by: user.id,
            created_at: new Date(r.date).toISOString(),
          };
        }
      });

      const table = importType === 'cargo' ? 'cargo_entries' : 'marketing_entries';
      const { error } = await supabase.from(table).insert(records);
      if (error) {
        skipped += records.length;
      } else {
        imported += records.length;
      }

      setProgress({ done: Math.min(i + CHUNK_SIZE, validRows.length), total: validRows.length });
    }

    setResult({ imported, skipped });
    setStage('done');
  };

  return (
    <div className="flex flex-col h-full bg-[var(--color-obsidian)] text-[var(--color-foreground)] animate-in slide-in-from-right overflow-hidden">
      <div className="ehi-view-header">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors cursor-pointer border-none bg-transparent text-[11px] font-mono"
        >
          <ArrowLeft size={14} /> Back
        </button>
        <span className="text-[10px] font-mono text-[var(--color-accent-amber)] tracking-widest font-bold">● DATA IMPORT</span>
        <div className="w-12" />
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="ehi-page-body px-4 py-4 max-w-2xl mx-auto space-y-5">

          <div className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl p-4 space-y-3">
            <div className="text-[11px] font-sans font-semibold text-[var(--color-muted)] uppercase tracking-wider">Import Type</div>
            <div className="flex gap-2">
              <button
                onClick={() => { setImportType('cargo'); resetWorkflow(); }}
                className={`flex-1 py-2.5 rounded-lg text-[13px] font-sans font-semibold transition-colors ${
                  importType === 'cargo'
                    ? 'bg-[var(--color-accent-amber)] text-[var(--color-obsidian)]'
                    : 'border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-foreground)]'
                }`}
              >
                Cargo Entries
              </button>
              <button
                onClick={() => { setImportType('marketing'); resetWorkflow(); }}
                className={`flex-1 py-2.5 rounded-lg text-[13px] font-sans font-semibold transition-colors ${
                  importType === 'marketing'
                    ? 'bg-[var(--color-accent-amber)] text-[var(--color-obsidian)]'
                    : 'border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-foreground)]'
                }`}
              >
                Marketing Entries
              </button>
            </div>
          </div>

          {stage === 'upload' && (
            <div className="space-y-4">
              <div className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="text-[11px] font-sans font-semibold text-[var(--color-muted)] uppercase tracking-wider">CSV Columns</div>
                  <button
                    onClick={() => downloadTemplate(importType)}
                    className="flex items-center gap-1.5 text-[12px] font-sans font-medium text-[var(--color-accent-amber)] hover:opacity-80 transition-opacity"
                  >
                    <Download size={13} /> Download Template
                  </button>
                </div>
                <p className="text-[11px] font-mono text-[var(--color-muted)] leading-relaxed break-all">
                  {columns.join(', ')}
                </p>
                <p className="text-[11px] font-sans text-[var(--color-muted)]">
                  Required:{' '}
                  <span className="text-[var(--color-foreground)]">
                    {(importType === 'cargo' ? CARGO_REQUIRED : MARKETING_REQUIRED).join(', ')}
                  </span>
                  {'. '}
                  Date format: <span className="font-mono text-[var(--color-foreground)]">YYYY-MM-DD</span>.
                  entry_ref is auto-generated.
                </p>
              </div>

              <div
                onDrop={handleDrop}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
                  dragOver
                    ? 'border-[var(--color-success)] bg-[rgba(34,197,94,0.05)]'
                    : 'border-[var(--color-border)] hover:border-[var(--color-muted)]'
                }`}
              >
                <Upload size={28} className="mx-auto mb-3 text-[var(--color-muted)]" />
                <p className="text-[13px] font-sans font-semibold text-[var(--color-foreground)] mb-1">
                  Drop your CSV here
                </p>
                <p className="text-[11px] font-sans text-[var(--color-muted)]">or click to browse files</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              />

              {fileError && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-[rgba(239,68,68,0.08)] border border-[var(--color-error)] text-[var(--color-error)] text-[12px] font-sans">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <span>{fileError}</span>
                </div>
              )}
            </div>
          )}

          {stage === 'preview' && (
            <div className="space-y-4">
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-1.5 text-[13px] font-sans font-semibold text-[var(--color-success)]">
                  <FileText size={14} />
                  {rows.length} row{rows.length !== 1 ? 's' : ''} parsed
                </div>
                {errors.length > 0 && (
                  <div className="flex items-center gap-1.5 text-[13px] font-sans font-semibold text-[var(--color-error)]">
                    <AlertTriangle size={14} />
                    {errorRowIndices.size} row{errorRowIndices.size !== 1 ? 's' : ''} will be skipped
                  </div>
                )}
              </div>

              {errors.length > 0 && (
                <div className="bg-[var(--color-surface-1)] border border-[var(--color-error)] rounded-xl p-3 space-y-1.5">
                  <div className="text-[11px] font-sans font-semibold text-[var(--color-error)] uppercase tracking-wider mb-2">
                    Validation Errors
                  </div>
                  {errors.slice(0, 10).map((e, i) => (
                    <div key={i} className="flex items-start gap-2 text-[11px] font-mono text-[var(--color-error)]">
                      <X size={11} className="mt-0.5 shrink-0" />
                      {e.message}
                    </div>
                  ))}
                  {errors.length > 10 && (
                    <div className="text-[11px] font-sans text-[var(--color-muted)] pt-1">
                      …and {errors.length - 10} more error{errors.length - 10 !== 1 ? 's' : ''}
                    </div>
                  )}
                </div>
              )}

              <div className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[var(--color-border)]">
                  <Table size={13} className="text-[var(--color-muted)]" />
                  <span className="text-[11px] font-sans font-semibold text-[var(--color-muted)] uppercase tracking-wider">
                    Preview — first {Math.min(rows.length, 10)} of {rows.length} rows
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[10px] font-mono" style={{ minWidth: 'max-content' }}>
                    <thead>
                      <tr>
                        {columns.map(col => (
                          <th
                            key={col}
                            className="py-2 px-2.5 text-[var(--color-muted)] uppercase font-semibold whitespace-nowrap border-b border-[var(--color-border)] bg-[var(--color-surface-1)]"
                          >
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.slice(0, 10).map((r, i) => (
                        <tr
                          key={i}
                          className={`border-t border-[var(--color-border)] ${errorRowIndices.has(i) ? 'bg-[rgba(239,68,68,0.05)]' : 'hover:bg-[rgba(255,255,255,0.02)]'}`}
                        >
                          {columns.map(col => (
                            <td key={col} className="py-1.5 px-2.5 whitespace-nowrap max-w-[140px] truncate">
                              {r[col]
                                ? <span className="text-[var(--color-foreground)]">{r[col]}</span>
                                : <span className="text-[var(--color-muted)]">—</span>
                              }
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={resetWorkflow}
                  className="flex-1 py-2.5 rounded-lg border border-[var(--color-border)] text-[13px] font-sans font-medium text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={runImport}
                  disabled={validRows.length === 0}
                  className="flex-1 py-2.5 rounded-lg bg-[var(--color-success)] text-white text-[13px] font-sans font-bold disabled:opacity-40 hover:opacity-90 transition-opacity"
                >
                  Import {validRows.length} row{validRows.length !== 1 ? 's' : ''}
                </button>
              </div>
            </div>
          )}

          {stage === 'importing' && (
            <div className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl p-6 space-y-5">
              <div className="text-center space-y-1">
                <p className="text-[13px] font-sans font-semibold text-[var(--color-foreground)]">
                  Importing {progress.done} / {progress.total} rows…
                </p>
                <p className="text-[11px] font-sans text-[var(--color-muted)]">Please keep this screen open</p>
              </div>
              <div className="w-full h-2.5 bg-[var(--color-surface-2)] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[var(--color-success)] rounded-full transition-all duration-300"
                  style={{ width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%` }}
                />
              </div>
              <p className="text-center text-[11px] font-mono text-[var(--color-muted)]">
                {progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0}% complete
              </p>
            </div>
          )}

          {stage === 'done' && (
            <div className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl p-8 space-y-5 text-center">
              <CheckCircle size={44} className="mx-auto text-[var(--color-success)]" />
              <div className="space-y-1.5">
                <p className="text-[15px] font-sans font-bold text-[var(--color-foreground)]">Import Complete</p>
                <p className="text-[13px] font-sans">
                  <span className="text-[var(--color-success)] font-semibold">
                    {result.imported} row{result.imported !== 1 ? 's' : ''} imported
                  </span>
                  {result.skipped > 0 && (
                    <span className="text-[var(--color-muted)]">, {result.skipped} skipped</span>
                  )}
                </p>
              </div>
              <button
                onClick={resetWorkflow}
                className="flex items-center gap-2 mx-auto px-5 py-2.5 rounded-lg border border-[var(--color-border)] text-[13px] font-sans font-medium text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors"
              >
                <RefreshCw size={13} /> Import Another File
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};
