import { useQuery } from '@tanstack/react-query';
import type { Account } from '@shared/schema';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { fmtNum, tierColor, scoreColor } from '@/lib/format';
import { Download } from 'lucide-react';

interface Summary {
  total: number; totalEndpoints: number;
  byTier: Record<string, number>;
  byCounty: Record<string, number>;
  byStatus: Record<string, number>;
  topByEndpoints: Account[]; topByScore: Account[]; upcomingFollowUps: Account[];
}

function exportCsv(accounts: Account[]) {
  const cols: (keyof Account)[] = ['name', 'county', 'city', 'tier', 'population', 'endpoints', 'primaryContact', 'contactTitle', 'phone', 'email', 'address', 'cityState', 'entryAngle', 'candidateScore', 'insight', 'status', 'priority'];
  const head = cols.join(',');
  const esc = (v: any) => v == null ? '' : `"${String(v).replace(/"/g, '""')}"`;
  const rows = accounts.map(a => cols.map(c => esc((a as any)[c])).join(','));
  const csv = [head, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'accounts.csv'; a.click();
  URL.revokeObjectURL(url);
}

export default function Reports() {
  const { data: s } = useQuery<Summary>({ queryKey: ['/api/reports/summary'] });
  const { data: accounts = [] } = useQuery<Account[]>({ queryKey: ['/api/accounts'] });

  if (!s) return <div className="p-8">Loading...</div>;

  const counties = Object.entries(s.byCounty).sort((a, b) => b[1] - a[1]);
  const oppCounts = {
    ami: accounts.filter(a => a.oppAmiAmr).length,
    leak: accounts.filter(a => a.oppLeakDetection).length,
    billing: accounts.filter(a => a.oppBillingAccuracy).length,
    labor: accounts.filter(a => a.oppLaborSavings).length,
  };

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold">Reports</h1>
          <p className="text-sm text-muted-foreground">Territory analytics · {s.total} accounts</p>
        </div>
        <Button onClick={() => exportCsv(accounts)} data-testid="button-export"><Download className="w-4 h-4 mr-1" /> Export CSV</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">AMI/AMR Opportunities</div><div className="text-xl font-semibold">{oppCounts.ami}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Leak Detection</div><div className="text-xl font-semibold">{oppCounts.leak}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Billing Accuracy</div><div className="text-xl font-semibold">{oppCounts.billing}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Labor Savings</div><div className="text-xl font-semibold">{oppCounts.labor}</div></CardContent></Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Accounts by County</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {counties.map(([c, n]) => {
                const inC = accounts.filter(a => a.county === c);
                const ep = inC.reduce((s, a) => s + a.endpoints, 0);
                const max = Math.max(...counties.map(([, x]) => x));
                return (
                  <div key={c}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="font-medium">{c}</span>
                      <span className="text-xs text-muted-foreground">{n} · {fmtNum(ep)} ep</span>
                    </div>
                    <div className="h-2 bg-slate-200 dark:bg-slate-800 rounded">
                      <div className="h-2 bg-blue-600 rounded" style={{ width: `${(n / max) * 100}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Pipeline Distribution</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {Object.entries(s.byStatus).sort((a, b) => b[1] - a[1]).map(([st, n]) => {
                const max = Math.max(...Object.values(s.byStatus));
                return (
                  <div key={st}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="font-medium">{st}</span><span className="text-xs text-muted-foreground">{n}</span>
                    </div>
                    <div className="h-2 bg-slate-200 dark:bg-slate-800 rounded">
                      <div className="h-2 bg-blue-600 rounded" style={{ width: `${(n / max) * 100}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">All Accounts (Score Ranked)</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[600px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900 border-b sticky top-0">
                <tr className="text-left">
                  <th className="px-3 py-2 font-medium">Rank</th>
                  <th className="px-3 py-2 font-medium">Account</th>
                  <th className="px-3 py-2 font-medium">County</th>
                  <th className="px-3 py-2 font-medium">Tier</th>
                  <th className="px-3 py-2 font-medium text-right">Endpoints</th>
                  <th className="px-3 py-2 font-medium text-right">Score</th>
                </tr>
              </thead>
              <tbody>
                {accounts.slice().sort((a, b) => b.candidateScore - a.candidateScore).map((a, i) => (
                  <tr key={a.id} className="border-b hover:bg-slate-50 dark:hover:bg-slate-900/40">
                    <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                    <td className="px-3 py-2 font-medium">{a.name}</td>
                    <td className="px-3 py-2 text-muted-foreground">{a.county}</td>
                    <td className="px-3 py-2"><Badge className={tierColor[a.tier]}>{a.tier}</Badge></td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtNum(a.endpoints)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${scoreColor(a.candidateScore)}`}>{a.candidateScore}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
