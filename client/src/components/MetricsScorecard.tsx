import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { METRICS, type Period } from '@shared/metrics';
import { BRAND } from '@/lib/brand';
import { Target } from 'lucide-react';

// ---------------------------------------------------------------------------
// Tony's activity scorecard: occurrences of the five tracked metrics vs
// targets, tallied by day / week / month / year.
//
// Period bounds are computed in the BROWSER's timezone (Tony's day, not the
// server's) and converted to the same "YYYY-MM-DD HH:MM:SS" UTC format SQLite
// stores in occurred_at, so the lexicographic range scan is timezone-correct.
// ---------------------------------------------------------------------------

const sqlUtc = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');

function periodBounds(period: Period): { start: string; end: string; caption: string } {
  const now = new Date();
  const s = new Date(now);
  s.setHours(0, 0, 0, 0);
  const e = new Date(s);
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  if (period === 'day') {
    e.setDate(e.getDate() + 1);
    return { start: sqlUtc(s), end: sqlUtc(e), caption: `Today · ${fmt(s)}` };
  }
  if (period === 'week') {
    const dow = (s.getDay() + 6) % 7; // Monday = 0
    s.setDate(s.getDate() - dow);
    e.setTime(s.getTime());
    e.setDate(s.getDate() + 7);
    const last = new Date(e); last.setDate(last.getDate() - 1);
    return { start: sqlUtc(s), end: sqlUtc(e), caption: `Week · ${fmt(s)}–${fmt(last)}` };
  }
  if (period === 'month') {
    s.setDate(1);
    e.setTime(s.getTime());
    e.setMonth(s.getMonth() + 1);
    return { start: sqlUtc(s), end: sqlUtc(e), caption: s.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) };
  }
  s.setMonth(0, 1);
  e.setTime(s.getTime());
  e.setFullYear(s.getFullYear() + 1);
  return { start: sqlUtc(s), end: sqlUtc(e), caption: String(s.getFullYear()) };
}

interface ScorecardRow { key: string; label: string; actual: number; target: number }

const PERIODS: { key: Period; label: string }[] = [
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'year', label: 'Year' },
];

export function MetricsScorecard() {
  const [period, setPeriod] = useState<Period>('day');
  const { start, end, caption } = periodBounds(period);

  const { data, isLoading } = useQuery<{ metrics: ScorecardRow[] }>({
    queryKey: ['/api/scorecard', period, start],
    queryFn: async () => {
      const r = await fetch(`/api/scorecard?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&period=${period}`);
      if (!r.ok) throw new Error('scorecard fetch failed');
      return r.json();
    },
    refetchInterval: 60_000,
  });

  const rows = data?.metrics ?? METRICS.map((m) => ({ key: m.key, label: m.label, actual: 0, target: m.target }));
  const totalActual = rows.reduce((s, r) => s + r.actual, 0);
  const totalTarget = rows.reduce((s, r) => s + r.target, 0);

  return (
    <Card data-testid="card-scorecard">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Target className="w-4 h-4" style={{ color: BRAND.blue }} />
            Activity Scorecard
            <span className="text-xs font-normal text-muted-foreground">{caption}</span>
          </CardTitle>
          <div className="flex rounded-md border overflow-hidden">
            {PERIODS.map((p) => (
              <Button
                key={p.key}
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 px-3 rounded-none text-xs"
                style={period === p.key ? { backgroundColor: BRAND.blue, color: '#fff' } : undefined}
                onClick={() => setPeriod(p.key)}
                data-testid={`button-scorecard-${p.key}`}
              >
                {p.label}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.map((r) => {
          const pct = r.target > 0 ? Math.min(100, Math.round((r.actual / r.target) * 100)) : 0;
          const hit = r.target > 0 && r.actual >= r.target;
          return (
            <div key={r.key} data-testid={`scorecard-row-${r.key}`}>
              <div className="flex items-baseline justify-between mb-1">
                <span className="text-sm">{r.label}</span>
                <span className={`text-sm font-semibold tabular-nums ${hit ? 'text-emerald-600' : ''}`}>
                  {isLoading ? '…' : r.actual}
                  <span className="text-xs font-normal text-muted-foreground"> / {r.target}</span>
                </span>
              </div>
              <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${pct}%`, backgroundColor: hit ? '#059669' : BRAND.blue }}
                />
              </div>
            </div>
          );
        })}
        <div className="pt-1 border-t flex items-baseline justify-between text-xs text-muted-foreground">
          <span>All tracked touches</span>
          <span className="tabular-nums font-medium text-foreground">{totalActual} / {totalTarget}</span>
        </div>
      </CardContent>
    </Card>
  );
}
