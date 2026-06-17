import { useRef, useState } from 'react';
import { queryClient } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { CalendarClock, Upload, CheckCircle2, AlertTriangle, ArrowLeft } from 'lucide-react';
import { BRAND } from '@/lib/brand';

interface Row {
  date: string; account: string; rawAccount: string; contact: string | null;
  activityRaw: string; type: string; metricKey: string | null; metricLabel: string | null;
  match: 'existing' | 'create'; existingId: number | null; skipped?: string;
}
interface ParseResult {
  rows: Row[];
  summary: { importable: number; skipped: number; willCreate: string[]; matched: number; byMetric: Record<string, number>; dateRange: { min: string; max: string } | null };
  warnings: string[];
}

export function ImportTrackerDialog() {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<'pick' | 'parsing' | 'preview' | 'committing'>('pick');
  const [result, setResult] = useState<ParseResult | null>(null);
  const [fileName, setFileName] = useState('');

  const reset = () => { setPhase('pick'); setResult(null); setFileName(''); if (inputRef.current) inputRef.current.value = ''; };

  const onFile = async (file: File) => {
    setFileName(file.name);
    setPhase('parsing');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await fetch('/api/import/tracker/parse', { method: 'POST', body: fd });
      const body = await r.json();
      if (!r.ok) { toast({ title: 'Could not read tracker', description: body?.error, variant: 'destructive' }); reset(); return; }
      setResult(body);
      setPhase('preview');
    } catch {
      toast({ title: 'Upload failed', variant: 'destructive' });
      reset();
    }
  };

  const commit = async () => {
    if (!result) return;
    setPhase('committing');
    const rows = result.rows.filter((r) => !r.skipped).map((r) => ({
      date: r.date, account: r.account, existingId: r.existingId, contact: r.contact,
      type: r.type, metricType: r.metricKey,
      summary: (r.activityRaw + (r.contact ? ` — ${r.contact}` : '')).slice(0, 200),
    }));
    try {
      const r = await fetch('/api/import/tracker/commit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows }),
      });
      const body = await r.json();
      if (!r.ok) { toast({ title: 'Import failed', description: body?.error, variant: 'destructive' }); setPhase('preview'); return; }
      queryClient.invalidateQueries({ queryKey: ['/api/accounts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/scorecard'] });
      toast({ title: 'Tracker imported', description: `${body.inserted} activities across ${body.accountsMatched} matched touches${body.skipped ? ` · ${body.skipped} unmatched skipped` : ''}` });
      setOpen(false); reset();
    } catch {
      toast({ title: 'Import failed', variant: 'destructive' });
      setPhase('preview');
    }
  };

  const importable = result?.rows.filter((r) => !r.skipped) ?? [];
  const unmatchedNames = Array.from(new Set(
    (result?.rows ?? []).filter((r) => r.skipped === 'No matching account in the CRM').map((r) => r.rawAccount)
  )).sort();

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" data-testid="button-open-tracker-import">
          <CalendarClock className="w-4 h-4 mr-1" /> Import weekly tracker
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Import weekly tracker</DialogTitle>
          <DialogDescription>
            Upload an Accountability Tracker (.xlsx). Each Account Activity Log row is matched to an existing account and becomes a backdated, metric-tagged touch. Unmatched names are skipped — no new accounts are created. Nothing saves until you confirm.
          </DialogDescription>
        </DialogHeader>

        {phase === 'pick' && (
          <div
            className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
            data-testid="dropzone-tracker"
          >
            <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm">Tap to choose, or drop the tracker here</p>
            <p className="text-xs text-muted-foreground mt-1">One workbook, sheets per week — .xlsx, 15 MB max</p>
            <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} data-testid="input-tracker-file" />
          </div>
        )}

        {phase === 'parsing' && <div className="py-10 text-center text-sm text-muted-foreground animate-pulse">Reading {fileName}…</div>}

        {(phase === 'preview' || phase === 'committing') && result && (
          <>
            <div className="grid grid-cols-3 gap-2 text-center shrink-0">
              <Stat label="To import" value={result.summary.importable} accent />
              <Stat label="Matched" value={result.summary.matched} />
              <Stat label="Skipped" value={result.summary.skipped} />
            </div>

            {result.summary.dateRange && (
              <p className="text-xs text-muted-foreground text-center shrink-0">
                {result.summary.dateRange.min} → {result.summary.dateRange.max} ·{' '}
                {Object.entries(result.summary.byMetric).map(([k, v]) => `${v} ${k}`).join(' · ')}
              </p>
            )}

            {unmatchedNames.length > 0 && (
              <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-2 text-xs flex gap-2 shrink-0">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <span>No CRM account matches these names, so their rows won't be imported. If they should match an existing account, fix the spelling in the tracker and re-upload: <span className="font-medium">{unmatchedNames.join(', ')}</span></span>
              </div>
            )}

            <div className="overflow-auto border rounded-md flex-1 min-h-0">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 dark:bg-slate-900 sticky top-0">
                  <tr className="text-left">
                    <th className="px-2 py-1.5 font-medium">Date</th>
                    <th className="px-2 py-1.5 font-medium">Account</th>
                    <th className="px-2 py-1.5 font-medium">Activity</th>
                    <th className="px-2 py-1.5 font-medium">Counts as</th>
                  </tr>
                </thead>
                <tbody>
                  {importable.map((r, i) => (
                    <tr key={i} className="border-t" data-testid={`tracker-row-${i}`}>
                      <td className="px-2 py-1 whitespace-nowrap tabular-nums">{r.date}</td>
                      <td className="px-2 py-1">
                        {r.account}
                      </td>
                      <td className="px-2 py-1 text-muted-foreground">{r.activityRaw}</td>
                      <td className="px-2 py-1">{r.metricLabel ?? <span className="text-muted-foreground">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {result.summary.skipped > 0 && (
              <p className="text-xs text-muted-foreground shrink-0">{result.summary.skipped} row(s) skipped (holidays, office/training days, or unreadable dates).</p>
            )}

            <DialogFooter className="shrink-0">
              <Button variant="ghost" size="sm" onClick={reset} disabled={phase === 'committing'}>
                <ArrowLeft className="w-4 h-4 mr-1" /> Choose another
              </Button>
              <Button size="sm" onClick={commit} disabled={phase === 'committing'} style={{ backgroundColor: BRAND.blue }} data-testid="button-commit-tracker">
                {phase === 'committing'
                  ? 'Importing…'
                  : <><CheckCircle2 className="w-4 h-4 mr-1" /> Import {result.summary.importable} activities</>}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="rounded-md border p-2">
      <div className="text-lg font-semibold tabular-nums" style={accent ? { color: BRAND.blue } : undefined}>{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}
