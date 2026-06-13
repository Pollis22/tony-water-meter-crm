import { useQuery, useMutation } from '@tanstack/react-query';
import { Link } from 'wouter';
import type { Account } from '@shared/schema';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Star, X } from 'lucide-react';
import { BRAND } from '@/lib/brand';

// Tony's manual focus list — the five accounts he chooses to keep in front of
// him. No scoring or logic; pinned is set by hand and capped at five.
export function TopFive() {
  const { data: accounts = [] } = useQuery<Account[]>({ queryKey: ['/api/accounts'] });
  const pinned = accounts.filter((a) => a.pinned).slice(0, 5);

  const unpin = useMutation({
    mutationFn: async (id: number) => (await apiRequest('POST', `/api/accounts/${id}/pin`, { pinned: false })).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/accounts'] }),
  });

  return (
    <Card data-testid="card-top-five">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Star className="w-4 h-4" style={{ color: BRAND.blue }} fill={BRAND.blue} />
          My Top 5
          <span className="text-xs font-normal text-muted-foreground">{pinned.length}/5 · focus list</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {pinned.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No accounts pinned yet. Open any account and tap the <Star className="w-3.5 h-3.5 inline -mt-0.5" /> star to keep it here.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {pinned.map((a) => (
              <li key={a.id} className="flex items-center gap-2 group">
                <Link href={`/accounts/${a.id}`} className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer">
                    <span className="font-medium truncate">{a.name}</span>
                    <span className="text-xs text-muted-foreground shrink-0">{a.county} · {a.tier}</span>
                  </div>
                </Link>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 opacity-50 hover:opacity-100"
                  onClick={() => unpin.mutate(a.id)}
                  title="Remove from Top 5"
                  data-testid={`button-unpin-${a.id}`}
                >
                  <X className="w-4 h-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
