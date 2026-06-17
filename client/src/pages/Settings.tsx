import { useRef, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { METRICS } from '@shared/metrics';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { ImportTrackerDialog } from '@/components/ImportTrackerDialog';
import { Badge } from '@/components/ui/badge';
import { Droplets, DatabaseBackup, FileSpreadsheet, UploadCloud, AlertTriangle, Target, CalendarClock } from 'lucide-react';


function TargetsBlock() {
  const { toast } = useToast();
  const { data } = useQuery<{ daily: Record<string, number> }>({
    queryKey: ['/api/scorecard/targets'],
    queryFn: async () => (await fetch('/api/scorecard/targets')).json(),
  });
  const [draft, setDraft] = useState<Record<string, number> | null>(null);
  const vals: Record<string, number> =
    draft ?? data?.daily ?? Object.fromEntries(METRICS.map((m) => [m.key, m.target]));

  const save = useMutation({
    mutationFn: async () => (await apiRequest('PUT', '/api/scorecard/targets', { daily: vals })).json(),
    onSuccess: () => {
      toast({ title: 'Daily targets saved' });
      queryClient.invalidateQueries({ queryKey: ['/api/scorecard'] });
      queryClient.invalidateQueries({ queryKey: ['/api/scorecard/targets'] });
      setDraft(null);
    },
    onError: () => toast({ title: 'Could not save targets', variant: 'destructive' }),
  });

  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Target className="w-4 h-4 text-blue-600" /> Scorecard Targets</CardTitle></CardHeader>
      <CardContent className="text-sm space-y-3">
        <p className="text-xs text-muted-foreground">
          Targets are per workday. Week, month, and year on the Dashboard scorecard scale automatically (×5, ×21, ×250 workdays).
        </p>
        <div className="space-y-2">
          {METRICS.map((m) => (
            <div key={m.key} className="flex items-center justify-between gap-3">
              <span className="text-sm">{m.label}</span>
              <Input
                type="number" min={0} max={100}
                className="h-9 w-20 text-right"
                value={vals[m.key] ?? 0}
                onChange={(e) => setDraft({ ...vals, [m.key]: Math.max(0, Number(e.target.value) || 0) })}
                data-testid={`input-target-${m.key}`}
              />
            </div>
          ))}
        </div>
        <Button size="sm" onClick={() => save.mutate()} disabled={!draft || save.isPending} data-testid="button-save-targets">
          {save.isPending ? 'Saving…' : 'Save targets'}
        </Button>
      </CardContent>
    </Card>
  );
}

function RestoreBlock() {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<'idle' | 'restoring' | 'waiting'>('idle');

  const pollUntilBack = () => {
    setPhase('waiting');
    const started = Date.now();
    const tick = async () => {
      try {
        const r = await fetch('/api/accounts', { cache: 'no-store' });
        if (r.ok) { window.location.reload(); return; }
      } catch { /* server restarting */ }
      if (Date.now() - started < 90_000) setTimeout(tick, 2000);
      else {
        setPhase('idle');
        toast({ title: 'Still restarting…', description: 'Give it a few more seconds, then reload the page yourself.', variant: 'destructive' });
      }
    };
    setTimeout(tick, 2500);
  };

  const restore = async () => {
    if (!file) return;
    setPhase('restoring');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/backup/restore', { method: 'POST', body: fd });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setPhase('idle');
        toast({ title: 'Restore rejected', description: body?.error ?? 'The file was not accepted. The database was not changed.', variant: 'destructive' });
        return;
      }
      // Server swaps the file and restarts itself; wait for it to come back.
      pollUntilBack();
    } catch {
      // Network drop here usually means the restart already began.
      pollUntilBack();
    }
  };

  return (
    <div className="border-t pt-3 mt-1 space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <UploadCloud className="w-4 h-4 text-blue-600" /> Restore from backup
      </div>
      <p className="text-xs text-muted-foreground">
        Load a previously downloaded <code>.db</code> file. This <span className="font-medium text-foreground">replaces everything currently in the app</span> with the backup's contents (the server keeps the replaced database as a safety copy). The app restarts itself — the page reloads automatically when it's back, usually within ~15 seconds.
      </p>
      <input
        ref={inputRef}
        type="file"
        accept=".db"
        className="hidden"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        data-testid="input-restore-file"
      />
      {phase === 'idle' && !file && (
        <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()} data-testid="button-pick-restore">
          Choose backup file…
        </Button>
      )}
      {phase === 'idle' && file && (
        <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-3 space-y-2">
          <div className="flex items-start gap-2 text-xs">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <span>
              Restore <span className="font-medium">{file.name}</span>? All current accounts, contacts, activity, tasks, notes, and opportunities will be replaced by what's in this backup.
            </span>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="destructive" onClick={restore} data-testid="button-confirm-restore">
              Restore now
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setFile(null); if (inputRef.current) inputRef.current.value = ''; }}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {phase !== 'idle' && (
        <div className="text-xs text-muted-foreground animate-pulse" data-testid="text-restore-status">
          {phase === 'restoring' ? 'Uploading and validating backup…' : 'Database restored — app is restarting, this page will reload itself…'}
        </div>
      )}
    </div>
  );
}

export default function Settings() {
  return (
    <div className="p-6 max-w-[900px] mx-auto">
      <div className="mb-4">
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">Configuration and territory info</p>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Droplets className="w-4 h-4 text-blue-600" /> Territory</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-2">
            <div className="flex justify-between"><span className="text-muted-foreground">Sales Rep</span><span className="font-medium">Tony Robertson</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Region</span><span className="font-medium">East Michigan</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Source</span><span className="font-medium">EJP April 2026 Call Book</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Counties</span><span className="font-medium">22</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Total Accounts</span><span className="font-medium">103</span></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Scoring Model</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-2">
            <p className="text-muted-foreground">Each account is scored 0–100 based on:</p>
            <ul className="space-y-1.5">
              <li><Badge variant="outline" className="mr-2">Tier weight</Badge> Tier 1: 35 pts · Tier 2: 22 pts · Tier 3: 12 pts</li>
              <li><Badge variant="outline" className="mr-2">Endpoints</Badge> Log scale 4–35 pts (≥100k = 35 pts)</li>
              <li><Badge variant="outline" className="mr-2">Entry angle</Badge> Enterprise AMI+NRW: 25 · AMI+leak: 20 · Billing+labor: 14 · Pilot: 8</li>
              <li><Badge variant="outline" className="mr-2">Contact bonus</Badge> Contact + email: 5 · Contact only: 3</li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Routing</CardTitle></CardHeader>
          <CardContent className="text-sm">
            <p className="text-muted-foreground mb-2">Route optimization powered by OSRM (Open Source Routing Machine).</p>
            <ul className="space-y-1">
              <li className="flex justify-between"><span className="text-muted-foreground">Provider</span><span>router.project-osrm.org</span></li>
              <li className="flex justify-between"><span className="text-muted-foreground">Map tiles</span><span>OpenStreetMap</span></li>
              <li className="flex justify-between"><span className="text-muted-foreground">Geocoding</span><span>Nominatim</span></li>
            </ul>
          </CardContent>
        </Card>

        <TargetsBlock />

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><CalendarClock className="w-4 h-4 text-blue-600" /> Import weekly tracker</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-3">
            <p className="text-muted-foreground">
              Upload a Weekly Accountability Tracker (.xlsx). Each Account Activity Log row is matched to an existing account and logged as a backdated, metric-tagged touch, so past weeks show up on the scorecard. Unmatched names are skipped — no new accounts are created.
            </p>
            <ImportTrackerDialog />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><DatabaseBackup className="w-4 h-4 text-blue-600" /> Backup</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-3">
            <p className="text-muted-foreground">
              This database is your book of business. Download a copy before big changes and keep one somewhere safe — it takes one click.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild data-testid="button-backup-db">
                <a href="/api/backup/database"><DatabaseBackup className="w-4 h-4 mr-1" /> Download database (.db)</a>
              </Button>
              <Button asChild variant="outline" data-testid="button-backup-xlsx">
                <a href="/api/backup/export.xlsx"><FileSpreadsheet className="w-4 h-4 mr-1" /> Export everything (.xlsx)</a>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              The .db file is a live snapshot of the full database (restorable as-is). The spreadsheet has one tab per table — accounts, contacts, activities, tasks, notes, opportunities, routes.
            </p>
            <RestoreBlock />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Data Privacy</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Account data, contacts, tasks, notes and routes are stored locally in SQLite (`data.db`) and persist across deployments. Sales insights are generated from public information about each municipality where available; any unknown data points are explicitly marked "unknown" rather than fabricated.
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
