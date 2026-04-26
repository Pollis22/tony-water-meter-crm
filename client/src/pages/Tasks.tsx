import { useQuery, useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import type { Task, Account } from '@shared/schema';
import { Link } from 'wouter';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Check, Plus, Trash2 } from 'lucide-react';
import { priorityColor, PRIORITIES } from '@/lib/format';

export default function Tasks() {
  const { data: tasks = [] } = useQuery<Task[]>({ queryKey: ['/api/tasks'] });
  const { data: accounts = [] } = useQuery<Account[]>({ queryKey: ['/api/accounts'] });
  const accountById = new Map(accounts.map(a => [a.id, a]));

  const [filter, setFilter] = useState<'open' | 'done' | 'all'>('open');
  const [accountId, setAccountId] = useState<string>('');
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [priority, setPriority] = useState('Medium');

  const filtered = tasks.filter(t => filter === 'all' ? true : filter === 'open' ? t.status !== 'Done' : t.status === 'Done')
    .sort((a, b) => (a.dueDate || '9') > (b.dueDate || '9') ? 1 : -1);

  const addMut = useMutation({
    mutationFn: async () => (await apiRequest('POST', '/api/tasks', {
      accountId: accountId ? Number(accountId) : null,
      title, dueDate: due || null, priority, status: 'Open',
    })).json(),
    onSuccess: () => { setTitle(''); setDue(''); setAccountId(''); queryClient.invalidateQueries({ queryKey: ['/api/tasks'] }); },
  });
  const toggleMut = useMutation({
    mutationFn: async (t: Task) => (await apiRequest('PATCH', `/api/tasks/${t.id}`, { status: t.status === 'Done' ? 'Open' : 'Done' })).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/tasks'] }),
  });
  const delMut = useMutation({
    mutationFn: async (id: number) => apiRequest('DELETE', `/api/tasks/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/tasks'] }),
  });

  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold">Tasks</h1>
          <p className="text-sm text-muted-foreground">{tasks.filter(t => t.status !== 'Done').length} open · {tasks.filter(t => t.status === 'Done').length} done</p>
        </div>
        <Select value={filter} onValueChange={(v) => setFilter(v as any)}>
          <SelectTrigger className="w-32" data-testid="select-filter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="done">Done</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card className="mb-4"><CardContent className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
          <Input className="md:col-span-2" placeholder="Task title..." value={title} onChange={e => setTitle(e.target.value)} data-testid="input-title" />
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger data-testid="select-account"><SelectValue placeholder="Account (optional)" /></SelectTrigger>
            <SelectContent>
              {accounts.slice().sort((a, b) => a.name.localeCompare(b.name)).map(a => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" value={due} onChange={e => setDue(e.target.value)} data-testid="input-due" />
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger data-testid="select-priority"><SelectValue /></SelectTrigger>
            <SelectContent>{PRIORITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <Button className="mt-2" disabled={!title} onClick={() => addMut.mutate()} data-testid="button-add"><Plus className="w-4 h-4 mr-1" /> Add Task</Button>
      </CardContent></Card>

      <Card><CardContent className="p-0">
        {filtered.length === 0 ? <div className="p-6 text-center text-muted-foreground text-sm">No tasks.</div> : (
          <div className="divide-y">
            {filtered.map(t => {
              const acc = t.accountId ? accountById.get(t.accountId) : null;
              return (
                <div key={t.id} className="flex items-center gap-3 p-3" data-testid={`task-${t.id}`}>
                  <Button size="sm" variant={t.status === 'Done' ? 'default' : 'outline'} onClick={() => toggleMut.mutate(t)} className="h-6 w-6 p-0" data-testid={`button-toggle-${t.id}`}>
                    {t.status === 'Done' && <Check className="w-3 h-3" />}
                  </Button>
                  <div className="flex-1">
                    <div className={t.status === 'Done' ? 'line-through text-muted-foreground' : 'font-medium'}>{t.title}</div>
                    {acc && <Link href={`/accounts/${acc.id}`}><span className="text-xs text-blue-600 hover:underline cursor-pointer">{acc.name}</span></Link>}
                  </div>
                  <Badge variant="outline" className={priorityColor[t.priority] || ''}>{t.priority}</Badge>
                  {t.dueDate && <span className="text-sm text-muted-foreground tabular-nums">{t.dueDate}</span>}
                  <Button size="sm" variant="ghost" onClick={() => delMut.mutate(t.id)} data-testid={`button-delete-${t.id}`}><Trash2 className="w-3 h-3" /></Button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent></Card>
    </div>
  );
}
