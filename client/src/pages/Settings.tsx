import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Droplets, DatabaseBackup, FileSpreadsheet } from 'lucide-react';

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
