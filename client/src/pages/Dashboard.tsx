import { useQuery } from '@tanstack/react-query';
import type { Account } from '@shared/schema';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Link } from 'wouter';
import { fmtNum, tierColor, statusColor, scoreColor } from '@/lib/format';
import { Building2, MapPin, Target, TrendingUp, Calendar, Layers } from 'lucide-react';
import { FollowUpQueue } from '@/components/FollowUpQueue';

interface Summary {
  total: number;
  totalEndpoints: number;
  byTier: Record<string, number>;
  byCounty: Record<string, number>;
  byStatus: Record<string, number>;
  topByEndpoints: Account[];
  topByScore: Account[];
  upcomingFollowUps: Account[];
}

function StatCard({ label, value, sub, icon: Icon }: { label: string; value: string | number; sub?: string; icon: any }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</div>
          <Icon className="w-4 h-4 text-blue-600" />
        </div>
        <div className="text-xl font-semibold mt-1" data-testid={`stat-${label.toLowerCase().replace(/\s+/g,'-')}`}>{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { data: s, isLoading } = useQuery<Summary>({ queryKey: ['/api/reports/summary'] });
  const { data: accounts = [] } = useQuery<Account[]>({ queryKey: ['/api/accounts'] });

  if (isLoading || !s) return <div className="p-8">Loading...</div>;

  const counties = Object.entries(s.byCounty).sort((a, b) => b[1] - a[1]);
  // Suggested route clusters: top counties by total score density
  const clusters = counties.slice(0, 6).map(([county]) => {
    const inCounty = accounts.filter(a => a.county === county);
    const totalScore = inCounty.reduce((acc, a) => acc + a.candidateScore, 0);
    const avgScore = Math.round(totalScore / inCounty.length);
    const totalEp = inCounty.reduce((acc, a) => acc + a.endpoints, 0);
    return { county, count: inCounty.length, avgScore, totalEp };
  }).sort((a, b) => b.avgScore - a.avgScore);

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">East Michigan territory · {s.total} accounts · {fmtNum(s.totalEndpoints)} estimated endpoints</p>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Accounts" value={s.total} icon={Building2} />
        <StatCard label="Tier 1" value={s.byTier['Tier 1'] || 0} sub="strategic" icon={Target} />
        <StatCard label="Total Endpoints" value={fmtNum(s.totalEndpoints)} sub="metered customers" icon={Layers} />
        <StatCard label="Counties" value={Object.keys(s.byCounty).length} sub="across territory" icon={MapPin} />
      </div>

      <div className="mb-6">
        <FollowUpQueue limit={6} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {/* Pipeline */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><TrendingUp className="w-4 h-4 text-blue-600" /> Pipeline by Status</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {Object.entries(s.byStatus).sort((a,b) => b[1]-a[1]).map(([status, count]) => (
                <div key={status} className="flex items-center justify-between text-sm" data-testid={`pipeline-${status}`}>
                  <Badge variant="outline" className={statusColor[status] || ''}>{status}</Badge>
                  <span className="font-medium">{count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Tiers */}
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Accounts by Tier</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {(['Tier 1', 'Tier 2', 'Tier 3'] as const).map(t => {
              const n = s.byTier[t] || 0;
              const pct = Math.round((n / s.total) * 100);
              return (
                <div key={t}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="font-medium">{t}</span>
                    <span className="text-muted-foreground">{n} · {pct}%</span>
                  </div>
                  <div className="h-2 bg-slate-200 dark:bg-slate-800 rounded">
                    <div className={`h-2 rounded ${t === 'Tier 1' ? 'bg-blue-900' : t === 'Tier 2' ? 'bg-blue-600' : 'bg-blue-300'}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Suggested Counties */}
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Suggested Counties to Work</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {clusters.slice(0, 5).map(c => (
                <Link key={c.county} href={`/accounts?county=${encodeURIComponent(c.county)}`}>
                  <div className="flex items-center justify-between text-sm py-1.5 px-2 -mx-2 rounded hover:bg-accent cursor-pointer" data-testid={`cluster-${c.county}`}>
                    <div>
                      <div className="font-medium">{c.county}</div>
                      <div className="text-xs text-muted-foreground">{c.count} accounts · {fmtNum(c.totalEp)} endpoints</div>
                    </div>
                    <span className={scoreColor(c.avgScore)}>{c.avgScore}</span>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* High Priority */}
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Top Buying Candidates</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr><th className="text-left pb-2">Account</th><th className="text-left pb-2">County</th><th className="text-right pb-2">Endpoints</th><th className="text-right pb-2">Score</th></tr>
              </thead>
              <tbody>
                {s.topByScore.slice(0, 8).map(a => (
                  <tr key={a.id} className="border-t border-border">
                    <td className="py-2"><Link href={`/accounts/${a.id}`}><span className="font-medium hover:underline cursor-pointer">{a.name}</span></Link></td>
                    <td className="py-2 text-muted-foreground">{a.county}</td>
                    <td className="py-2 text-right">{fmtNum(a.endpoints)}</td>
                    <td className={`py-2 text-right ${scoreColor(a.candidateScore)}`}>{a.candidateScore}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* Top by endpoints */}
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Top 10 by Estimated Endpoints</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr><th className="text-left pb-2">Account</th><th className="text-left pb-2">Tier</th><th className="text-right pb-2">Endpoints</th></tr>
              </thead>
              <tbody>
                {s.topByEndpoints.slice(0, 10).map(a => (
                  <tr key={a.id} className="border-t border-border">
                    <td className="py-2"><Link href={`/accounts/${a.id}`}><span className="font-medium hover:underline cursor-pointer">{a.name}</span></Link></td>
                    <td className="py-2"><Badge className={tierColor[a.tier]}>{a.tier}</Badge></td>
                    <td className="py-2 text-right font-medium">{fmtNum(a.endpoints)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      {/* Follow-ups */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Calendar className="w-4 h-4 text-blue-600" /> Upcoming Follow-ups</CardTitle></CardHeader>
        <CardContent>
          {s.upcomingFollowUps.length === 0 ? (
            <p className="text-sm text-muted-foreground">No follow-ups scheduled. Open an account and set the next follow-up date.</p>
          ) : (
            <div className="space-y-1">
              {s.upcomingFollowUps.map(a => (
                <Link key={a.id} href={`/accounts/${a.id}`}>
                  <div className="flex items-center justify-between p-2 hover:bg-accent rounded cursor-pointer">
                    <span className="font-medium">{a.name}</span>
                    <span className="text-sm text-muted-foreground">{a.nextFollowUpAt}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
