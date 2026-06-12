import { useRef, useState } from 'react';
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
import { TIERS } from '@/lib/format';
import { Upload, FileSpreadsheet, FileText, X, Download, CheckCircle2, ArrowLeft } from 'lucide-react';

// Mirrors ParsedAccountRow from server/importAccounts.ts (plus client-only fields).
interface ImportRow {
  name: string;
  county: string | null;
  city: string | null;
  state: string | null;
  tier: string | null;
  population: number | null;
  endpoints: number | null;
  primaryContact: string | null;
  contactTitle: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  status: string | null;
  priority: string | null;
  waterBudgetUsd: number | null;
  insight: string | null;
  existingId: number | null;
  duplicate: boolean;
  duplicateReason: string | null;
  sourceFile: string;
  include: boolean;             // client-side
  mode: 'create' | 'update';    // client-side: what to do when an existing match is found
}

interface ParseResponse {
  rows: Omit<ImportRow, 'include' | 'mode'>[];
  truncated: boolean;
  warnings: string[];
}

type Step = 'pick' | 'review' | 'done';

const ACCEPTED = ['.csv', '.xlsx', '.xls', '.pdf'];
const MAX_FILES = 5;
const MAX_BYTES = 10 * 1024 * 1024;

const TEMPLATE_CSV = [
  'Municipality,County,City,Tier,Population,Endpoints,Contact,Title,Phone,Email,Address,Status,Priority,Water Budget,Notes',
  'Plymouth,Wayne,Plymouth,Tier 2,9132,4200,Jane Smith,DPW Director,(734) 555-0101,jsmith@plymouthmi.gov,201 S Main St,Researching,High,2400000,Strong AMI candidate',
  'Milan,Monroe,Milan,Tier 3,5944,2600,Bob Jones,Water Superintendent,(734) 555-0102,bjones@milanmi.gov,,Not Started,Medium,,Aging meters',
].join('\n');

function fileIcon(name: string) {
  return name.toLowerCase().endsWith('.pdf')
    ? <FileText className="w-3.5 h-3.5 shrink-0" />
    : <FileSpreadsheet className="w-3.5 h-3.5 shrink-0" />;
}

const STATUS_OPTIONS = ['Not Started', 'Researching', 'Contacted', 'Meeting Set', 'Proposal Sent', 'Won', 'Lost', 'Nurture', 'Prospect', 'Customer', 'Dead'];
const PRIORITY_OPTIONS = ['High', 'Medium', 'Low'];

export default function ImportAccountsDialog() {
  const { toast } = useToast();
  const { data: accounts = [] } = useQuery<Account[]>({ queryKey: ['/api/accounts'] });

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('pick');
  const [files, setFiles] = useState<File[]>([]);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [result, setResult] = useState({ created: 0, updated: 0 });
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setStep('pick'); setFiles([]); setRows([]); setWarnings([]);
    setTruncated(false); setResult({ created: 0, updated: 0 }); setDragOver(false);
  };

  const addFiles = (incoming: FileList | File[]) => {
    const next = [...files];
    for (const f of Array.from(incoming)) {
      const ext = '.' + (f.name.split('.').pop() ?? '').toLowerCase();
      if (!ACCEPTED.includes(ext)) {
        toast({ title: 'Unsupported file type', description: `${f.name} — use CSV, XLSX, XLS, or PDF.`, variant: 'destructive' });
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
      const res = await apiRequest('POST', '/api/accounts/import/parse', fd);
      return (await res.json()) as ParseResponse;
    },
    onSuccess: (data) => {
      const prepared: ImportRow[] = data.rows.map((r) => ({
        ...r,
        include: !r.duplicate,                         // possible dupes start unchecked
        mode: r.existingId != null ? 'update' : 'create',
      }));
      setWarnings(data.warnings ?? []);
      setTruncated(!!data.truncated);
      if (!prepared.length) {
        toast({
          title: 'No accounts found',
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
    mutationFn: async (payload: { accounts: any[] }) => {
      const res = await apiRequest('POST', '/api/accounts/import/commit', payload);
      return (await res.json()) as { created: number; updated: number };
    },
    onSuccess: (data) => {
      setResult(data);
      setStep('done');
      queryClient.invalidateQueries({ queryKey: ['/api/accounts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/reports/summary'] });
    },
    onError: () => toast({ title: 'Import failed — nothing was saved', description: 'Fix the highlighted rows and try again.', variant: 'destructive' }),
  });

  const updateRow = (i: number, patch: Partial<ImportRow>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const selected = rows.filter((r) => r.include);
  const needsName = selected.filter((r) => !r.name.trim()).length;
  const dupeCount = rows.filter((r) => r.duplicate).length;
  const createCount = selected.filter((r) => !(r.existingId != null && r.mode === 'update')).length;
  const updateCount = selected.filter((r) => r.existingId != null && r.mode === 'update').length;
  const canCommit = selected.length > 0 && needsName === 0 && !commitMut.isPending;
  const allIncluded = rows.length > 0 && rows.every((r) => r.include);
  const someIncluded = rows.some((r) => r.include);

  const commit = () => {
    commitMut.mutate({
      accounts: selected.map((r) => ({
        id: r.existingId != null && r.mode === 'update' ? r.existingId : null,
        name: r.name.trim(),
        county: r.county || null,
        city: r.city || null,
        tier: r.tier || null,
        population: r.population,
        endpoints: r.endpoints,
        primaryContact: r.primaryContact || null,
        contactTitle: r.contactTitle || null,
        phone: r.phone || null,
        email: r.email || null,
        address: r.address || null,
        cityState: r.state ? `${r.city ?? r.name}, ${r.state}` : null,
        status: r.status || null,
        priority: r.priority || null,
        waterBudgetUsd: r.waterBudgetUsd,
        insight: r.insight || null,
      })),
    });
  };

  const downloadTemplate = () => {
    const blob = new Blob([TEMPLATE_CSV], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'accounts-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const existingName = (id: number | null) => accounts.find((a) => a.id === id)?.name ?? '';

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) reset(); }}>
      <DialogTrigger asChild>
        <Button variant="outline" data-testid="button-open-import-accounts">
          <Upload className="w-4 h-4 mr-1" /> Import
        </Button>
      </DialogTrigger>
      <DialogContent className={step === 'review' ? 'sm:max-w-[88rem] max-h-[92vh] flex flex-col' : 'sm:max-w-lg'}>
        {step === 'pick' && (
          <>
            <DialogHeader>
              <DialogTitle>Import accounts</DialogTitle>
              <DialogDescription>
                Upload up to 5 files (CSV, XLSX, XLS, or PDF, 10 MB each). Columns are detected automatically — you'll review everything before it's saved.
              </DialogDescription>
            </DialogHeader>
            <div
              className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${dragOver ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30' : 'border-slate-300 dark:border-slate-700 hover:border-slate-400'}`}
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
              data-testid="dropzone-import-accounts"
            >
              <Upload className="w-7 h-7 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm font-medium">Drop files here or click to browse</p>
              <p className="text-xs text-muted-foreground mt-1">A territory spreadsheet, a prospect list, a county utility directory…</p>
              <input
                ref={inputRef} type="file" multiple accept={ACCEPTED.join(',')} className="hidden"
                onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }}
                data-testid="input-import-account-files"
              />
            </div>
            {files.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {files.map((f) => (
                  <span key={f.name + f.size} className="inline-flex items-center gap-1.5 rounded-full border bg-slate-50 dark:bg-slate-900 px-3 py-1 text-xs">
                    {fileIcon(f.name)}
                    <span className="max-w-[180px] truncate">{f.name}</span>
                    <button className="text-muted-foreground hover:text-foreground" onClick={() => setFiles(files.filter((x) => x !== f))} aria-label={`Remove ${f.name}`}>
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-center justify-between">
              <Button variant="ghost" size="sm" onClick={downloadTemplate} data-testid="button-download-account-template">
                <Download className="w-3.5 h-3.5 mr-1" /> CSV template
              </Button>
              <DialogFooter className="m-0">
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button disabled={files.length === 0 || parseMut.isPending} onClick={() => parseMut.mutate()} data-testid="button-parse-account-files">
                  {parseMut.isPending ? 'Reading files…' : 'Preview import'}
                </Button>
              </DialogFooter>
            </div>
          </>
        )}

        {step === 'review' && (
          <>
            <DialogHeader>
              <DialogTitle>Review {rows.length} account{rows.length === 1 ? '' : 's'}</DialogTitle>
              <DialogDescription>
                {createCount} to create{updateCount > 0 && <> · {updateCount} to update</>}
                {dupeCount > 0 && <> · {dupeCount} already exist{dupeCount === 1 ? 's' : ''} (unchecked)</>}
                {truncated && <> · capped at 500 rows</>}
              </DialogDescription>
            </DialogHeader>

            {warnings.length > 0 && (
              <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-2.5 text-xs space-y-0.5">
                {warnings.map((w, i) => <p key={i}>{w}</p>)}
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
                        data-testid="checkbox-include-all-accounts"
                      />
                    </th>
                    <th className="px-2 py-2 font-medium min-w-[140px]">Municipality *</th>
                    <th className="px-2 py-2 font-medium min-w-[110px]">County</th>
                    <th className="px-2 py-2 font-medium min-w-[90px]">Tier</th>
                    <th className="px-2 py-2 font-medium min-w-[90px]">Endpoints</th>
                    <th className="px-2 py-2 font-medium min-w-[140px]">Contact</th>
                    <th className="px-2 py-2 font-medium min-w-[150px]">Email</th>
                    <th className="px-2 py-2 font-medium min-w-[120px]">Status</th>
                    <th className="px-2 py-2 font-medium min-w-[130px]">Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className={`border-b align-top ${r.include ? '' : 'opacity-50'}`} data-testid={`account-import-row-${i}`}>
                      <td className="px-2 py-1.5">
                        <Checkbox checked={r.include} onCheckedChange={(v) => updateRow(i, { include: v === true })} aria-label="Include row" data-testid={`checkbox-include-account-${i}`} />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input className="h-7 text-xs" value={r.name} onChange={(e) => updateRow(i, { name: e.target.value })} placeholder="Required" data-testid={`input-account-name-${i}`} />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input className="h-7 text-xs" value={r.county ?? ''} onChange={(e) => updateRow(i, { county: e.target.value })} />
                      </td>
                      <td className="px-2 py-1.5">
                        <Select value={r.tier ?? ''} onValueChange={(v) => updateRow(i, { tier: v })}>
                          <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                          <SelectContent>{TIERS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                        </Select>
                      </td>
                      <td className="px-2 py-1.5">
                        <Input className="h-7 text-xs tabular-nums" value={r.endpoints ?? ''} onChange={(e) => updateRow(i, { endpoints: e.target.value ? Number(e.target.value.replace(/[^\d]/g, '')) : null })} />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input className="h-7 text-xs" value={r.primaryContact ?? ''} onChange={(e) => updateRow(i, { primaryContact: e.target.value })} />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input className="h-7 text-xs" value={r.email ?? ''} onChange={(e) => updateRow(i, { email: e.target.value })} />
                      </td>
                      <td className="px-2 py-1.5">
                        <Select value={r.status ?? ''} onValueChange={(v) => updateRow(i, { status: v })}>
                          <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Not Started" /></SelectTrigger>
                          <SelectContent>{STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                        </Select>
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex flex-wrap gap-1 items-center">
                          {!r.name.trim() && <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Needs name</Badge>}
                          {r.existingId != null ? (
                            <button
                              type="button"
                              onClick={() => updateRow(i, { mode: r.mode === 'update' ? 'create' : 'update' })}
                              title={`Matches existing "${existingName(r.existingId)}". Click to toggle.`}
                              data-testid={`toggle-mode-${i}`}
                            >
                              <Badge variant="outline" className={`text-[10px] px-1.5 py-0 cursor-pointer ${r.mode === 'update' ? 'border-blue-400 text-blue-700 dark:text-blue-300' : 'border-emerald-400 text-emerald-700 dark:text-emerald-300'}`}>
                                {r.mode === 'update' ? 'Update existing' : 'Create new'}
                              </Badge>
                            </button>
                          ) : r.duplicate ? (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-400 text-amber-700 dark:text-amber-400" title={r.duplicateReason ?? undefined}>
                              {r.duplicateReason ?? 'Duplicate'}
                            </Badge>
                          ) : null}
                          {files.length > 1 && <span className="text-[10px] text-muted-foreground w-full truncate">{r.sourceFile}</span>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <DialogFooter className="flex-row items-center justify-between sm:justify-between">
              <Button variant="ghost" onClick={() => { setStep('pick'); setRows([]); }} data-testid="button-back-to-pick-accounts">
                <ArrowLeft className="w-4 h-4 mr-1" /> Back
              </Button>
              <div className="flex items-center gap-3">
                {needsName > 0 && <span className="text-xs text-muted-foreground">{needsName} selected row(s) need a name.</span>}
                <Button disabled={!canCommit} onClick={commit} data-testid="button-commit-account-import">
                  {commitMut.isPending ? 'Importing…' : `Import ${selected.length} account${selected.length === 1 ? '' : 's'}`}
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
                {result.created > 0 && <>{result.created} account{result.created === 1 ? '' : 's'} created. </>}
                {result.updated > 0 && <>{result.updated} updated.</>}
                {result.created === 0 && result.updated === 0 && 'Nothing to import.'}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={reset} data-testid="button-import-more-accounts">Import more</Button>
              <Button onClick={() => setOpen(false)} data-testid="button-account-import-done">Done</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
