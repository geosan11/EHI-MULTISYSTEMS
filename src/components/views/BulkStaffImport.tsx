import { useState, useRef } from 'react';
import Papa from 'papaparse';
import { X, Upload, Download, CheckCircle2, XCircle, Loader, AlertTriangle } from 'lucide-react';
import { createStaffAccountsBulk, BulkStaffRow, BulkStaffResult } from '../../lib/auth';

const VALID_ROLES = ['admin', 'cargo_agent', 'vj_agent', 'marketing_agent', 'driver', 'accountant', 'auditor'];
const CHUNK_SIZE = 25; // server caps at 50/request; smaller chunks give a smoother progress bar and faster individual round trips

interface ParsedRow extends BulkStaffRow {
  clientError?: string;
}

interface Props {
  hubCodes: string[]; // active hub codes, for validation + the on-screen reference list
  onClose: () => void;
  onImported: () => void; // parent refetches the staff list after a successful import
}

function validateRow(r: any, rowNum: number, hubCodes: string[]): ParsedRow {
  const name = String(r.name || '').trim();
  const email = String(r.email || '').trim().toLowerCase();
  const role = String(r.role || '').trim();
  const hub_code = String(r.hub_code || '').trim().toUpperCase();
  const phone = String(r.phone || '').trim();
  const hub_type = String(r.hub_type || '').trim();

  let clientError: string | undefined;
  if (!name || !email || !role || !hub_code) {
    clientError = 'Missing required field (need name, email, role, hub_code)';
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    clientError = 'Invalid email format';
  } else if (!VALID_ROLES.includes(role)) {
    clientError = `Invalid role — must be one of: ${VALID_ROLES.join(', ')}`;
  } else if (!hubCodes.includes(hub_code)) {
    clientError = `Unknown hub code "${hub_code}"`;
  }

  return { row: rowNum, name, email, role, hub_code, hub_type: hub_type || undefined, phone: phone || undefined, clientError };
}

function downloadCsv(filename: string, rows: Record<string, any>[]) {
  const csv = Papa.unparse(rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const BulkStaffImport = ({ hubCodes, onClose, onImported }: Props) => {
  const [stage, setStage] = useState<'upload' | 'preview' | 'importing' | 'done'>('upload');
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [results, setResults] = useState<BulkStaffResult[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validRows = rows.filter(r => !r.clientError);
  const invalidRows = rows.filter(r => r.clientError);

  const handleFile = (file: File) => {
    setFileError(null);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        if (!result.data.length) {
          setFileError('CSV appears to be empty.');
          return;
        }
        if (result.data.length > 1000) {
          setFileError(`${result.data.length} rows found — max 1000 per file. Split into multiple files.`);
          return;
        }
        const parsed = (result.data as any[]).map((r, i) => validateRow(r, i + 2, hubCodes)); // +2: header is row 1, data starts at row 2
        setRows(parsed);
        setStage('preview');
      },
      error: (err) => setFileError(`Failed to read file: ${err.message}`),
    });
  };

  const runImport = async () => {
    setStage('importing');
    setProgress({ completed: 0, total: validRows.length });
    const allResults: BulkStaffResult[] = [];

    for (let i = 0; i < validRows.length; i += CHUNK_SIZE) {
      const chunk = validRows.slice(i, i + CHUNK_SIZE);
      try {
        const { results: chunkResults } = await createStaffAccountsBulk(chunk);
        allResults.push(...chunkResults);
      } catch (err: any) {
        // Whole chunk failed at the network/auth level (not a per-row error) —
        // record every row in it as failed so nothing silently disappears
        // from the results the admin sees.
        chunk.forEach(r => allResults.push({ row: r.row, email: r.email, success: false, error: err.message || 'Request failed' }));
      }
      setProgress({ completed: Math.min(i + CHUNK_SIZE, validRows.length), total: validRows.length });
    }

    setResults(allResults);
    setStage('done');
    if (allResults.some(r => r.success)) onImported();
  };

  const successResults = results.filter(r => r.success);
  const failedResults = results.filter(r => !r.success);

  return (
    <div className="fixed inset-0 z-50 bg-[rgba(0,0,0,0.6)] flex items-center justify-center p-4">
      <div className="ehi-card w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-lg">
        <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
          <h2 className="text-[15px] font-sans font-bold text-[var(--color-foreground)]">Bulk Staff Import</h2>
          <button onClick={onClose} className="text-[var(--color-muted)] hover:text-[var(--color-foreground)]">
            <X size={20} />
          </button>
        </div>

        <div className="p-5">
          {stage === 'upload' && (
            <div className="space-y-4">
              <p className="text-[13px] font-sans text-[var(--color-muted)]">
                Upload a CSV with columns: <code className="text-[var(--color-accent-cobalt)]">name, email, role, hub_code, phone</code> (phone and hub_type optional).
                Passwords are never read from the CSV — a secure temporary password is generated for each account and shown after import.
              </p>
              <div>
                <span className="text-[11px] font-sans font-semibold text-[var(--color-light-muted)] block mb-1">Valid roles</span>
                <p className="text-[12px] font-mono text-[var(--color-muted)]">{VALID_ROLES.join(', ')}</p>
              </div>
              <div>
                <span className="text-[11px] font-sans font-semibold text-[var(--color-light-muted)] block mb-1">Active hub codes</span>
                <p className="text-[12px] font-mono text-[var(--color-muted)]">{hubCodes.length ? hubCodes.join(', ') : 'None loaded — check your connection'}</p>
              </div>
              <button
                onClick={() => downloadCsv('staff_import_template.csv', [{ name: 'Jane Doe', email: 'jane@example.com', role: 'cargo_agent', hub_code: hubCodes[0] || 'LOS', phone: '+2348012345678' }])}
                className="flex items-center gap-1.5 text-[12px] font-sans font-medium text-[var(--color-accent-cobalt)]"
              >
                <Download size={14} /> Download CSV template
              </button>

              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-[var(--color-border-strong)] rounded-lg p-8 text-center cursor-pointer hover:border-[var(--color-accent-amber)] transition-colors"
              >
                <Upload size={24} className="mx-auto mb-2 text-[var(--color-muted)]" />
                <p className="text-[13px] font-sans text-[var(--color-muted)]">Click to choose a CSV file</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              />
              {fileError && (
                <div className="flex items-center gap-2 text-[12px] font-sans text-[var(--color-error)]">
                  <AlertTriangle size={14} /> {fileError}
                </div>
              )}
            </div>
          )}

          {stage === 'preview' && (
            <div className="space-y-4">
              <div className="flex items-center gap-4 text-[13px] font-sans">
                <span className="text-[var(--color-success)] font-semibold">{validRows.length} ready to import</span>
                {invalidRows.length > 0 && (
                  <span className="text-[var(--color-error)] font-semibold">{invalidRows.length} will be skipped</span>
                )}
              </div>

              <div className="max-h-80 overflow-y-auto overflow-x-auto border border-[var(--color-border)] rounded-lg">
                <table className="w-full min-w-[680px] text-left font-mono text-[11px]">
                  <thead className="bg-[var(--color-surface-2)] sticky top-0">
                    <tr className="text-[var(--color-muted)] uppercase">
                      <th className="py-2 px-2 w-[36px]"></th>
                      <th className="py-2 px-2">Row</th>
                      <th className="py-2 px-2">Name</th>
                      <th className="py-2 px-2">Email</th>
                      <th className="py-2 px-2">Role</th>
                      <th className="py-2 px-2">Hub</th>
                      <th className="py-2 px-2">Issue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.row} className="border-t border-[var(--color-border)]">
                        <td className="py-2 px-2">
                          {r.clientError
                            ? <XCircle size={14} className="text-[var(--color-error)]" />
                            : <CheckCircle2 size={14} className="text-[var(--color-success)]" />}
                        </td>
                        <td className="py-2 px-2 text-[var(--color-muted)]">{r.row}</td>
                        <td className="py-2 px-2 text-[var(--color-foreground)]">{r.name || '—'}</td>
                        <td className="py-2 px-2 text-[var(--color-foreground)]">{r.email || '—'}</td>
                        <td className="py-2 px-2 text-[var(--color-foreground)]">{r.role || '—'}</td>
                        <td className="py-2 px-2 text-[var(--color-foreground)]">{r.hub_code || '—'}</td>
                        <td className="py-2 px-2 text-[var(--color-error)]">{r.clientError || ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setStage('upload')}
                  className="flex-1 py-2.5 rounded-lg border border-[var(--color-border)] text-[13px] font-sans font-medium text-[var(--color-muted)]"
                >
                  Back
                </button>
                <button
                  onClick={runImport}
                  disabled={validRows.length === 0}
                  className="flex-1 py-2.5 rounded-lg bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] text-[13px] font-sans font-bold disabled:opacity-40"
                >
                  Import {validRows.length} staff account{validRows.length === 1 ? '' : 's'}
                </button>
              </div>
            </div>
          )}

          {stage === 'importing' && (
            <div className="py-8 text-center space-y-4">
              <Loader size={28} className="mx-auto animate-spin text-[var(--color-accent-amber)]" />
              <p className="text-[13px] font-sans text-[var(--color-muted)]">
                Creating account {progress.completed} of {progress.total}…
              </p>
              <div className="w-full h-2 bg-[var(--color-surface-2)] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[var(--color-accent-amber)] transition-all duration-300"
                  style={{ width: `${progress.total ? (progress.completed / progress.total) * 100 : 0}%` }}
                />
              </div>
            </div>
          )}

          {stage === 'done' && (
            <div className="space-y-4">
              <div className="flex items-center gap-4 text-[13px] font-sans">
                <span className="text-[var(--color-success)] font-semibold">{successResults.length} created</span>
                {failedResults.length > 0 && (
                  <span className="text-[var(--color-error)] font-semibold">{failedResults.length} failed</span>
                )}
              </div>

              {successResults.length > 0 && (
                <div>
                  <p className="text-[12px] font-sans text-[var(--color-muted)] mb-2">
                    Temporary passwords are only shown here and in the downloaded file — Sentry/logs never see them. Get this to each new hire and have them change it on first login.
                  </p>
                  <button
                    onClick={() => downloadCsv('staff_import_credentials.csv', successResults.map(r => ({ email: r.email, temp_password: r.tempPassword })))}
                    className="flex items-center gap-1.5 text-[12px] font-sans font-medium text-[var(--color-accent-cobalt)]"
                  >
                    <Download size={14} /> Download credentials CSV ({successResults.length} accounts)
                  </button>
                </div>
              )}

              {failedResults.length > 0 && (
                <div className="max-h-60 overflow-y-auto overflow-x-auto border border-[var(--color-border)] rounded-lg">
                  <table className="w-full min-w-[480px] text-left font-mono text-[11px]">
                    <thead className="bg-[var(--color-surface-2)] sticky top-0">
                      <tr className="text-[var(--color-muted)] uppercase">
                        <th className="py-2 px-2">Row</th>
                        <th className="py-2 px-2">Email</th>
                        <th className="py-2 px-2">Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {failedResults.map((r) => (
                        <tr key={r.row} className="border-t border-[var(--color-border)]">
                          <td className="py-2 px-2 text-[var(--color-muted)]">{r.row}</td>
                          <td className="py-2 px-2 text-[var(--color-foreground)]">{r.email}</td>
                          <td className="py-2 px-2 text-[var(--color-error)]">{r.error}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <button
                onClick={onClose}
                className="w-full py-2.5 rounded-lg bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] text-[13px] font-sans font-bold"
              >
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
