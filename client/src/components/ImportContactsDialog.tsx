import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { Account } from '@shared/schema';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Upload, FileSpreadsheet, FileText, Image as ImageIcon, X, Download, CheckCircle2, ArrowLeft } from 'lucide-react';

// Mirrors ParsedContactRow from server/importContacts.ts
interface ImportRow {
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  accountHint: string | null;
  accountId: number | null;
  accountMatch: 'exact' | 'fuzzy' | 'none' | 'manual';
  duplicate: boolean;
  duplicateReason: string | null;
  sourceFile: string;
  include: boolean; // client-side
}

interface ParseResponse {
  rows: (Omit<ImportRow, 'include' | 'accountMatch'> & { accountMatch: 'exact' | 'fuzzy' | 'none' })[];
  truncated: boolean;
  warnings: string[];
}

type Step = 'pick' | 'review' | 'done';

const ACCEPTED = ['.csv', '.xlsx', '.xls', '.pdf', '.jpg', '.jpeg', '.png', '.webp'];
const MAX_FILES = 5;
const MAX_BYTES = 10 * 1024 * 1024;

const TEMPLATE_CSV = [
  'Name,Title,Email,Phone,Account,Notes',
  'Jane Smith,Water Superintendent,jane.smith@cityofwestland.com,(734) 555-0101,Westland,Met at MRWA conference',
  'Bob Jones,DPW Director,bjones@a2gov.org,(734) 555-0102,City of Ann Arbor,Prefers email',
].join('\n');

function fileIcon(name: string) {
  const n = name.toLowerCase();
  if (n.endsWith('.pdf')) return <FileText className="w-3.5 h-3.5 shrink-0" />;
  if (/\.(jpe?g|png|webp)$/.test(n)) return <ImageIcon className="w-3.5 h-3.5 shrink-0" />;
  return <FileSpreadsheet className="w-3.5 h-3.5 shrink-0" />;
}

export default function ImportContactsDialog() {
  const { toast } = useToast();
  const { data: accounts = [] } = useQuery<Account[]>({ queryKey: ['/api/accounts'] });
  const sortedAccounts = useMemo(() => [...accounts].sort((a, b) => a.name.localeCompare(b.name)), [accounts]);

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('pick');
  const [files, setFiles] = useState<File[]>([]);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [bulkAccountId, setBulkAccountId] = useState('');
  const [insertedCount, setInsertedCount] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setStep('pick'); setFiles([]); setRows([]); setWarnings([]);
    setTruncated(false); setBulkAccountId(''); setInsertedCount(0); setDragOver(false);
  };

  const addFiles = (incoming: FileList | File[]) => {
    const next = [...files];
    for (const f of Array.from(incoming)) {
      const ext = '.' + (f.name.split('.').pop() ?? '').toLowerCase();
      if (!ACCEPTED.includes(ext)) {
        toast({ title: 'Unsupported file type', description: `${f.name} — use CSV, XLSX, XLS, PDF, or a photo (JPG/PNG).`, variant: 'destructive' });
        continue;
      }
      if (f.size > MAX_BYTES) {
        toast({ title: 'File too large', description: `${f.name} is over 10 MB.`, variant: 'destructive' });
        continue;
      }
      if (next.some((x) => x.name === f.name && x.size === f.size)) continue;
      if (next.length >= MAX_FILES) {
        toast({ title: 'Too many files', description: `Upload up to ${MAX_FILES} files at a time.`, variant: 'destructive' });
        break;
      }
      next.push(f);
    }
    setFiles(next);
  };

  const parseMut = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      for (const f of files) fd.append('files', f);
      const res = await apiRequest('POST', '/api/contacts/import/parse', fd);
      return (await res.json()) as ParseResponse;
    },
    onSuccess: (data) => {
      const prepared: ImportRow[] = data.rows.map((r: any) => ({
        ...r,
        accountMatch: r.accountMatch ?? 'none',
        include: !r.duplicate, // possible duplicates start unchecked; one click re-includes them
      }));
      setWarnings(data.warnings ?? []);
      setTruncated(!!data.truncated);
      if (!prepared.length) {
        toast({
          title: 'No contacts found',
          description: data.warnings?.[0] ?? 'Nothing recognizable in those files. Try the CSV template.',
          variant: 'destructive',
        });
        return;
      }
      setRows(prepared);
      setStep('review');
    },
    onError: () => toast({ title: 'Could not read files', description: 'Check the format and try again, or use the CSV template.', variant: 'destructive' }),
  });

  const commitMut = useMutation({
    mutationFn: async (payload: { contacts: any[] }) => {
      const res = await apiRequest('POST', '/api/contacts/import/commit', payload);
      return (await res.json()) as { inserted: number };
    },
    onSuccess: (data) => {
      setInsertedCount(data.inserted);
      setStep('done');
      queryClient.invalidateQueries({ queryKey: ['/api/contacts', 'all'] });
    },
    onError: () => toast({ title: 'Import failed — nothing was saved', description: 'Fix the highlighted rows and try again.', variant: 'destructive' }),
  });

  const updateRow = (i: number, patch: Partial<ImportRow>) => {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };

  const selected = rows.filter((r) => r.include);
  const needsAccount = selected.filter((r) => r.accountId == null).length;
  const needsName = selected.filter((r) => !r.name.trim()).length;
  const dupeCount = rows.filter((r) => r.duplicate).length;
  const unmatchedCount = rows.filter((r) => r.accountId == null).length;
  const canCommit = selected.length > 0 && needsAccount === 0 && needsName === 0 && !commitMut.isPending;

  const allIncluded = rows.length > 0 && rows.every((r) => r.include);
  const someIncluded = rows.some((r) => r.include);

  const assignUnmatched = () => {
    const id = Number(bulkAccountId);
    if (!id) return;
    setRows((prev) => prev.map((r) => (r.accountId == null ? { ...r, accountId: id, accountMatch: 'manual' } : r)));
  };

  const commit = () => {
    commitMut.mutate({
      contacts: selected.map((r) => ({
        accountId: r.accountId,
        name: r.name.trim(),
        title: r.title || null,
        email: r.email || null,
        phone: r.phone || null,
        notes: r.notes || null,
      })),
    });
  };

  const downloadTemplate = () => {
    const blob = new Blob([TEMPLATE_CSV], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'contacts-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const accountName = (id: number | null) => accounts.find((a) => a.id === id)?.name ?? '';

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) reset(); }}>
      <DialogTrigger asChild>
        <Button variant="outline" data-testid="button-open-import">
          <Upload className="w-4 h-4 mr-1" /> Import
        </Button>
      </DialogTrigger>
      <DialogContent className={step === 'review' ? 'sm:max-w-6xl max-h-[92vh] flex flex-col' : 'sm:max-w-lg'}>
        {step === 'pick' && (
          <>
            <DialogHeader>
              <DialogTitle>Import contacts</DialogTitle>
              <DialogDescription>
                Upload up to 5 files (CSV, XLSX, XLS, PDF — or a photo of a printed list, 10 MB each). You'll review every row before anything is saved.
              </DialogDescription>
            </DialogHeader>
            <div
              className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${dragOver ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30' : 'border-slate-300 dark:border-slate-700 hover:border-slate-400'}`}
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
              data-testid="dropzone-import"
            >
              <Upload className="w-7 h-7 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm font-medium">Drop files here or click to browse</p>
              <p className="text-xs text-muted-foreground mt-1">A spreadsheet export, a PDF directory — or snap a photo of a printed contact list…</p>
              <input
                ref={inputRef} type="file" multiple accept={ACCEPTED.join(',')} className="hidden"
                onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }}
                data-testid="input-import-files"
              />
            </div>
            {files.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {files.map((f) => (
                  <span key={f.name + f.size} className="inline-flex items-center gap-1.5 rounded-full border bg-slate-50 dark:bg-slate-900 px-3 py-1 text-xs" data-testid={`file-pill-${f.name}`}>
                    {fileIcon(f.name)}
                    <span className="max-w-[180px] truncate">{f.name}</span>
                    <button className="text-muted-foreground hover:text-foreground" onClick={() => setFiles(files.filter((x) => x !== f))} aria-label={`Remove ${f.name}`}>
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {warnings.length > 0 && (
              <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-3 text-xs space-y-1">
                {warnings.map((w, i) => <p key={i}>{w}</p>)}
              </div>
            )}
            <div className="flex items-center justify-between">
              <Button variant="ghost" size="sm" onClick={downloadTemplate} data-testid="button-download-template">
                <Download className="w-3.5 h-3.5 mr-1" /> CSV template
              </Button>
              <DialogFooter className="m-0">
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button disabled={files.length === 0 || parseMut.isPending} onClick={() => parseMut.mutate()} data-testid="button-parse-files">
                  {parseMut.isPending ? 'Reading files…' : 'Preview import'}
                </Button>
              </DialogFooter>
            </div>
          </>
        )}

        {step === 'review' && (
          <>
            <DialogHeader>
              <DialogTitle>Review {rows.length} contact{rows.length === 1 ? '' : 's'}</DialogTitle>
              <DialogDescription>
                {selected.length} selected
                {unmatchedCount > 0 && <> · {unmatchedCount} need an account</>}
                {dupeCount > 0 && <> · {dupeCount} possible duplicate{dupeCount === 1 ? '' : 's'} (unchecked)</>}
                {truncated && <> · list capped at 500 rows</>}
              </DialogDescription>
            </DialogHeader>

            {warnings.length > 0 && (
              <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-2.5 text-xs space-y-0.5">
                {warnings.map((w, i) => <p key={i}>{w}</p>)}
              </div>
            )}

            {unmatchedCount > 0 && (
              <div className="flex items-center gap-2 rounded-md border bg-slate-50 dark:bg-slate-900 p-2">
                <span className="text-xs font-medium whitespace-nowrap">Assign all unmatched to:</span>
                <Select value={bulkAccountId} onValueChange={setBulkAccountId}>
                  <SelectTrigger className="h-8 w-64" data-testid="select-bulk-account"><SelectValue placeholder="Pick an account…" /></SelectTrigger>
                  <SelectContent className="max-h-72">
                    {sortedAccounts.map((a) => (
                      <SelectItem key={a.id} value={String(a.id)}>{a.name} · {a.county}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="sm" variant="secondary" disabled={!bulkAccountId} onClick={assignUnmatched} data-testid="button-bulk-assign">
                  Assign {unmatchedCount}
                </Button>
              </div>
            )}

            <div className="flex-1 min-h-0 overflow-auto rounded-md border">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 dark:bg-slate-900 sticky top-0 z-10">
                  <tr className="text-left border-b">
                    <th className="px-2 py-2 w-8">
                      <Checkbox
                        checked={allIncluded ? true : someIncluded ? 'indeterminate' : false}
                        onCheckedChange={(v) => setRows((prev) => prev.map((r) => ({ ...r, include: v === true })))}
                        aria-label="Include all"
                        data-testid="checkbox-include-all"
                      />
                    </th>
                    <th className="px-2 py-2 font-medium min-w-[150px]">Name *</th>
                    <th className="px-2 py-2 font-medium min-w-[140px]">Title</th>
                    <th className="px-2 py-2 font-medium min-w-[170px]">Email</th>
                    <th className="px-2 py-2 font-medium min-w-[120px]">Phone</th>
                    <th className="px-2 py-2 font-medium min-w-[180px]">Account *</th>
                    <th className="px-2 py-2 font-medium min-w-[130px]">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className={`border-b align-top ${r.include ? '' : 'opacity-50'}`} data-testid={`import-row-${i}`}>
                      <td className="px-2 py-1.5">
                        <Checkbox checked={r.include} onCheckedChange={(v) => updateRow(i, { include: v === true })} aria-label="Include row" data-testid={`checkbox-include-${i}`} />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input className="h-7 text-xs" value={r.name} onChange={(e) => updateRow(i, { name: e.target.value })} placeholder="Required" data-testid={`input-row-name-${i}`} />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input className="h-7 text-xs" value={r.title ?? ''} onChange={(e) => updateRow(i, { title: e.target.value })} />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input className="h-7 text-xs" value={r.email ?? ''} onChange={(e) => updateRow(i, { email: e.target.value })} />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input className="h-7 text-xs" value={r.phone ?? ''} onChange={(e) => updateRow(i, { phone: e.target.value })} />
                      </td>
                      <td className="px-2 py-1.5">
                        <Select
                          value={r.accountId != null ? String(r.accountId) : ''}
                          onValueChange={(v) => updateRow(i, { accountId: Number(v), accountMatch: 'manual' })}
                        >
                          <SelectTrigger className="h-7 text-xs" data-testid={`select-row-account-${i}`}>
                            <SelectValue placeholder={r.accountHint ? `? ${r.accountHint}` : 'Pick account…'} />
                          </SelectTrigger>
                          <SelectContent className="max-h-72">
                            {sortedAccounts.map((a) => (
                              <SelectItem key={a.id} value={String(a.id)}>{a.name} · {a.county}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex flex-wrap gap-1">
                          {!r.name.trim() && <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Needs name</Badge>}
                          {r.accountId == null && <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Needs account</Badge>}
                          {r.duplicate && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-400 text-amber-700 dark:text-amber-400" title={r.duplicateReason ?? undefined}>
                              Duplicate
                            </Badge>
                          )}
                          {r.accountMatch === 'fuzzy' && r.accountId != null && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0" title={`"${r.accountHint}" matched to ${accountName(r.accountId)}`}>
                              Check match
                            </Badge>
                          )}
                          {files.length > 1 && <span className="text-[10px] text-muted-foreground w-full truncate">{r.sourceFile}</span>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <DialogFooter className="flex-row items-center justify-between sm:justify-between">
              <Button variant="ghost" onClick={() => { setStep('pick'); setRows([]); }} data-testid="button-back-to-pick">
                <ArrowLeft className="w-4 h-4 mr-1" /> Back
              </Button>
              <div className="flex items-center gap-3">
                {!canCommit && selected.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {needsName > 0 && `${needsName} selected row(s) need a name. `}
                    {needsAccount > 0 && `${needsAccount} selected row(s) need an account.`}
                  </span>
                )}
                <Button disabled={!canCommit} onClick={commit} data-testid="button-commit-import">
                  {commitMut.isPending ? 'Importing…' : `Import ${selected.length} contact${selected.length === 1 ? '' : 's'}`}
                </Button>
              </div>
            </DialogFooter>
          </>
        )}

        {step === 'done' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-600" /> Import complete
              </DialogTitle>
              <DialogDescription>
                {insertedCount} contact{insertedCount === 1 ? '' : 's'} added to your accounts.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={reset} data-testid="button-import-more">Import more</Button>
              <Button onClick={() => setOpen(false)} data-testid="button-import-done">Done</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
