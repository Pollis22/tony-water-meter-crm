import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import type { Account, Opportunity, Task } from '@shared/schema';
import { apiRequest, queryClient } from '@/lib/queryClient';
import {
  addDaysStr, daysSince, daysUntil, fmtDay, followUpBuckets, staleAccounts, todayStr, type DueAccount,
} from '@/lib/field';
import { QuickLogDialog } from '@/components/FieldLog';
import { fmtMoney, scoreColor } from '@/lib/format';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { AlarmClock, CalendarDays, CheckSquare, Map, Moon, TrendingUp } from 'lucide-react';

const OPEN_STAGES = ['Discovery', 'Qualification', 'Proposal', 'Negotiation'];

function DueChip({ days }: { days: number }) {
  if (days < 0) return <Badge variant="outline" className="border-red-300 bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 text-[11px] shrink-0">{-days}d overdue</Badge>;
  if (days === 0) return <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 text-[11px] shrink-0">Today</Badge>;
  return <Badge variant="outline" className="text-[11px] shrink-0">in {days}d</Badge>;
}

export default function ThisWeek() {
  const [, navigate] = useLocation();
  const { data: accounts = [] } = useQuery<Account[]>({ queryKey: ['/api/accounts'] });
  const { data: tasks = [] } = useQuery<Task[]>({ queryKey: ['/api/tasks'] });
  const { data: opps = [] } = useQuery<Opportunity[]>({ queryKey: ['/api/opportunities'] });

  const [selected, setSelected] = useState<number[]>([]);
  const toggle = (id: number) =>
    setSelected((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const buckets = useMemo(() => followUpBuckets(accounts), [accounts]);
  const openOpps = useMemo(() => opps.filter((o) => OPEN_STAGES.includes(o.stage)), [opps]);
  const stale = useMemo(
    () => staleAccounts(accounts, new Set(openOpps.map((o) => o.accountId))).slice(0, 6),
    [accounts, openOpps],
  );
  const openTasks = useMemo(
    () => tasks.filter((t) => t.status !== 'Done' && daysUntil(t.dueDate) != null && daysUntil(t.dueDate)! <= 7)
      .sort((a, b) => (daysUntil(a.dueDate) ?? 0) - (daysUntil(b.dueDate) ?? 0)),
    [tasks],
  );
  const accountName = (id: number | null) => accounts.find((a) => a.id === id)?.name;

  const snooze = useMutation({
    mutationFn: async ({ id, days }: { id: number; days: number }) =>
      (await apiRequest('PATCH', `/api/accounts/${id}`, { nextFollowUpAt: addDaysStr(todayStr(), days) })).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/accounts'] }),
  });
  const scheduleTouch = useMutation({
    mutationFn: async (id: number) =>
      (await apiRequest('PATCH', `/api/accounts/${id}`, { nextFollowUpAt: addDaysStr(todayStr(), 7) })).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/accounts'] }),
  });
  const taskDone = useMutation({
    mutationFn: async (t: Task) => (await apiRequest('PATCH', `/api/tasks/${t.id}`, { status: 'Done' })).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/tasks'] }),
  });

  const dueCount = buckets.overdue.length + buckets.today.length;
  const selectUrgent = () =>
    setSelected(Array.from(new Set([...buckets.overdue, ...buckets.today].map((d) => d.account.id))));

  const Row = ({ d }: { d: DueAccount }) => {
    const a = d.account;
    return (
      <div className="py-2.5 flex items-center gap-3" data-testid={`week-row-${a.id}`}>
        <Checkbox
          checked={selected.includes(a.id)}
          onCheckedChange={() => toggle(a.id)}
          aria-label={`Select ${a.name} for route`}
          className="h-5 w-5"
          data-testid={`checkbox-route-${a.id}`}
        />
        <div className="min-w-0 flex-1">
          <Link href={`/accounts/${a.id}`}>
            <span className="font-medium text-sm hover:underline cursor-pointer">{a.name}</span>
          </Link>
          <div className="text-xs text-muted-foreground truncate">
            {a.county} · {a.tier} · <span className={scoreColor(a.candidateScore)}>{a.candidateScore}</span>
            {a.primaryContact ? ` · ${a.primaryContact}` : ''}
          </div>
        </div>
        <DueChip days={d.days} />
        <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => snooze.mutate({ id: a.id, days: 1 })} title="Snooze to tomorrow">+1d</Button>
        <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => snooze.mutate({ id: a.id, days: 7 })} title="Snooze one week">+1w</Button>
        <QuickLogDialog account={a} />
      </div>
    );
  };

  const Section = ({ title, icon: Icon, items, tone }: { title: string; icon: any; items: DueAccount[]; tone?: string }) => (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className={`text-sm flex items-center gap-2 ${tone ?? ''}`}>
          <Icon className="w-4 h-4" /> {title}
          <Badge variant="secondary" className="text-[11px]">{items.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {items.length === 0
          ? <div className="text-sm text-muted-foreground py-1.5">Nothing here.</div>
          : <div className="divide-y">{items.map((d) => <Row key={d.account.id} d={d} />)}</div>}
      </CardContent>
    </Card>
  );

  return (
    <div className="p-6 max-w-[1100px] mx-auto">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-blue-600" /> This Week
          </h1>
          <p className="text-sm text-muted-foreground">
            {dueCount} due now · {buckets.week.length} later this week · {openTasks.length} task{openTasks.length === 1 ? '' : 's'} · pipeline {fmtMoney(openOpps.reduce((s, o) => s + (o.amount ?? 0), 0))}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dueCount > 0 && (
            <Button variant="outline" size="sm" onClick={selectUrgent} data-testid="button-select-urgent">
              Select all due
            </Button>
          )}
          <Button
            disabled={selected.length === 0}
            onClick={() => navigate(`/route-planner?accounts=${selected.join(',')}`)}
            data-testid="button-plan-route"
          >
            <Map className="w-4 h-4 mr-1" /> Route {selected.length || ''} stop{selected.length === 1 ? '' : 's'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <Section title="Overdue" icon={AlarmClock} items={buckets.overdue} tone="text-red-600 dark:text-red-400" />
        <Section title="Due today" icon={AlarmClock} items={buckets.today} tone="text-amber-700 dark:text-amber-400" />
      </div>
      <div className="mb-4">
        <Section title="Next 7 days" icon={CalendarDays} items={buckets.week} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        {/* Tasks due this week */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <CheckSquare className="w-4 h-4 text-blue-600" /> Tasks due
              <Badge variant="secondary" className="text-[11px]">{openTasks.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {openTasks.length === 0
              ? <div className="text-sm text-muted-foreground py-1.5">No tasks due this week.</div>
              : (
                <div className="divide-y">
                  {openTasks.map((t) => (
                    <div key={t.id} className="py-2 flex items-center gap-3" data-testid={`week-task-${t.id}`}>
                      <Checkbox className="h-5 w-5" checked={false} onCheckedChange={() => taskDone.mutate(t)} aria-label={`Complete ${t.title}`} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{t.title}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {accountName(t.accountId) ?? 'No account'} · due {fmtDay(t.dueDate)}
                        </div>
                      </div>
                      <DueChip days={daysUntil(t.dueDate) ?? 0} />
                    </div>
                  ))}
                </div>
              )}
          </CardContent>
        </Card>

        {/* Going stale */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Moon className="w-4 h-4 text-blue-600" /> Going quiet
              <span className="text-xs font-normal text-muted-foreground">in play, no touch in 14+ days</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {stale.length === 0
              ? <div className="text-sm text-muted-foreground py-1.5">Nothing going stale. Nice.</div>
              : (
                <div className="divide-y">
                  {stale.map((a) => {
                    const since = daysSince(a.lastContactedAt);
                    return (
                      <div key={a.id} className="py-2 flex items-center gap-3" data-testid={`stale-row-${a.id}`}>
                        <div className="min-w-0 flex-1">
                          <Link href={`/accounts/${a.id}`}>
                            <span className="font-medium text-sm hover:underline cursor-pointer">{a.name}</span>
                          </Link>
                          <div className="text-xs text-muted-foreground truncate">
                            {a.status} · {since == null ? 'never contacted' : `last touch ${since}d ago`}
                          </div>
                        </div>
                        <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" title="Schedule follow-up next week" onClick={() => scheduleTouch.mutate(a.id)}>
                          Queue +1w
                        </Button>
                        <QuickLogDialog account={a} />
                      </div>
                    );
                  })}
                </div>
              )}
          </CardContent>
        </Card>
      </div>

      {/* Pipeline strip */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-blue-600" /> Open pipeline
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {OPEN_STAGES.map((stage) => {
              const inStage = openOpps.filter((o) => o.stage === stage);
              const value = inStage.reduce((s, o) => s + (o.amount ?? 0), 0);
              return (
                <Link key={stage} href="/opportunities">
                  <div className="rounded-md border p-3 hover:bg-accent cursor-pointer" data-testid={`pipeline-stage-${stage}`}>
                    <div className="text-xs text-muted-foreground">{stage}</div>
                    <div className="text-lg font-semibold">{inStage.length}</div>
                    <div className="text-xs text-muted-foreground">{fmtMoney(value)}</div>
                  </div>
                </Link>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
