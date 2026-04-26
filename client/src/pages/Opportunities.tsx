import { useQuery, useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import type { Opportunity, Account } from '@shared/schema';
import { Link } from 'wouter';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2 } from 'lucide-react';

const STAGES = ['Discovery', 'Qualification', 'Proposal', 'Negotiation', 'Closed Won', 'Closed Lost'] as const;

const stageColor: Record<string, string> = {
  Discovery: 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200',
  Qualification: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-200',
  Proposal: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200',
  Negotiation: 'bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-200',
  'Closed Won': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200',
  'Closed Lost': 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-200',
};

export default function Opportunities() {
  const { data: opps = [] } = useQuery<Opportunity[]>({ queryKey: ['/api/opportunities'] });
  const { data: accounts = [] } = useQuery<Account[]>({ queryKey: ['/api/accounts'] });
  const accById = new Map(accounts.map(a => [a.id, a]));

  const [name, setName] = useState('');
  const [accountId, setAccountId] = useState('');
  const [stage, setStage] = useState('Discovery');
  const [amount, setAmount] = useState('');

  const addMut = useMutation({
    mutationFn: async () => (await apiRequest('POST', '/api/opportunities', {
      name, accountId: Number(accountId), stage,
      amount: amount ? Number(amount) : null,
    })).json(),
    onSuccess: () => { setName(''); setAmount(''); setAccountId(''); queryClient.invalidateQueries({ queryKey: ['/api/opportunities'] }); },
  });
  const updMut = useMutation({
    mutationFn: async ({ id, patch }: { id: number; patch: Partial<Opportunity> }) => (await apiRequest('PATCH', `/api/opportunities/${id}`, patch)).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/opportunities'] }),
  });
  const delMut = useMutation({
    mutationFn: async (id: number) => apiRequest('DELETE', `/api/opportunities/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/opportunities'] }),
  });

  const total = opps.reduce((s, o) => s + (o.amount || 0), 0);
  const won = opps.filter(o => o.stage === 'Closed Won').reduce((s, o) => s + (o.amount || 0), 0);

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold">Opportunities</h1>
          <p className="text-sm text-muted-foreground">{opps.length} opportunities · ${total.toLocaleString()} total · ${won.toLocaleString()} won</p>
        </div>
      </div>

      <Card className="mb-4"><CardContent className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
          <Input className="md:col-span-2" placeholder="Opportunity name..." value={name} onChange={e => setName(e.target.value)} data-testid="input-name" />
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger data-testid="select-account"><SelectValue placeholder="Account" /></SelectTrigger>
            <SelectContent>
              {accounts.slice().sort((a, b) => a.name.localeCompare(b.name)).map(a => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={stage} onValueChange={setStage}>
            <SelectTrigger data-testid="select-stage"><SelectValue /></SelectTrigger>
            <SelectContent>{STAGES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
          <Input type="number" placeholder="Amount $" value={amount} onChange={e => setAmount(e.target.value)} data-testid="input-amount" />
        </div>
        <Button className="mt-2" disabled={!name || !accountId} onClick={() => addMut.mutate()} data-testid="button-add"><Plus className="w-4 h-4 mr-1" /> Add Opportunity</Button>
      </CardContent></Card>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {STAGES.map(s => {
          const col = opps.filter(o => o.stage === s);
          const sum = col.reduce((acc, o) => acc + (o.amount || 0), 0);
          return (
            <div key={s} className="bg-slate-100 dark:bg-slate-900/50 rounded-lg p-3" data-testid={`stage-col-${s}`}>
              <div className="flex items-center justify-between mb-3 px-1">
                <Badge variant="outline" className={stageColor[s]}>{s}</Badge>
                <span className="text-xs text-muted-foreground">{col.length} · ${sum.toLocaleString()}</span>
              </div>
              <div className="space-y-2 min-h-[60px]">
                {col.map(o => {
                  const acc = accById.get(o.accountId);
                  return (
                    <Card key={o.id} className="p-3" data-testid={`opp-card-${o.id}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <div className="font-medium text-sm">{o.name}</div>
                          {acc && <Link href={`/accounts/${acc.id}`}><span className="text-xs text-blue-600 hover:underline cursor-pointer">{acc.name}</span></Link>}
                        </div>
                        <Button size="sm" variant="ghost" onClick={() => delMut.mutate(o.id)} data-testid={`button-delete-${o.id}`}><Trash2 className="w-3 h-3" /></Button>
                      </div>
                      <div className="flex items-center justify-between mt-2">
                        <Select value={o.stage} onValueChange={(v) => updMut.mutate({ id: o.id, patch: { stage: v } })}>
                          <SelectTrigger className="h-7 text-xs w-[130px]"><SelectValue /></SelectTrigger>
                          <SelectContent>{STAGES.map(st => <SelectItem key={st} value={st}>{st}</SelectItem>)}</SelectContent>
                        </Select>
                        {o.amount && <span className="text-sm font-semibold">${o.amount.toLocaleString()}</span>}
                      </div>
                    </Card>
                  );
                })}
                {col.length === 0 && <div className="text-xs text-muted-foreground text-center py-3">Empty</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
