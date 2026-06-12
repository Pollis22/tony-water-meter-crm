import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import type { Account } from '@shared/schema';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { addDaysStr, followUpBuckets, todayStr, type DueAccount } from '@/lib/field';
import { QuickLogDialog } from '@/components/FieldLog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlarmClock, ArrowRight, CalendarClock } from 'lucide-react';

function DueChip({ days }: { days: number }) {
  if (days < 0) {
    return (
      <Badge variant="outline" className="border-red-300 bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 text-[11px]">
        {-days}d overdue
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 text-[11px]">
      Today
    </Badge>
  );
}

export function FollowUpQueue({ limit = 6 }: { limit?: number }) {
  const { data: accounts = [] } = useQuery<Account[]>({ queryKey: ['/api/accounts'] });
  const { overdue, today } = followUpBuckets(accounts);
  const due: DueAccount[] = [...overdue, ...today];

  const snooze = useMutation({
    mutationFn: async ({ id, days }: { id: number; days: number }) =>
      (await apiRequest('PATCH', `/api/accounts/${id}`, { nextFollowUpAt: addDaysStr(todayStr(), days) })).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/accounts'] }),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between">
          <span className="flex items-center gap-2">
            <AlarmClock className="w-4 h-4 text-blue-600" /> Follow-ups due
            {due.length > 0 && (
              <Badge variant="secondary" className="text-[11px]">{due.length}</Badge>
            )}
          </span>
          <Link href="/week">
            <span className="text-xs font-medium text-blue-600 hover:underline cursor-pointer inline-flex items-center gap-1" data-testid="link-this-week">
              This Week <ArrowRight className="w-3 h-3" />
            </span>
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {due.length === 0 ? (
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <CalendarClock className="w-4 h-4" /> Nothing due — set follow-up dates on accounts to build your queue.
          </div>
        ) : (
          <div className="divide-y">
            {due.slice(0, limit).map(({ account: a, days }) => (
              <div key={a.id} className="py-2 flex items-center gap-3" data-testid={`followup-row-${a.id}`}>
                <div className="min-w-0 flex-1">
                  <Link href={`/accounts/${a.id}`}>
                    <span className="font-medium text-sm hover:underline cursor-pointer">{a.name}</span>
                  </Link>
                  <div className="text-xs text-muted-foreground truncate">
                    {a.county} County · score {a.candidateScore}
                  </div>
                </div>
                <DueChip days={days} />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-xs"
                  title="Snooze one week"
                  onClick={() => snooze.mutate({ id: a.id, days: 7 })}
                  data-testid={`button-snooze-${a.id}`}
                >
                  +1w
                </Button>
                <QuickLogDialog account={a} />
              </div>
            ))}
            {due.length > limit && (
              <div className="pt-2 text-xs text-muted-foreground">
                +{due.length - limit} more in <Link href="/week"><span className="text-blue-600 hover:underline cursor-pointer">This Week</span></Link>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
