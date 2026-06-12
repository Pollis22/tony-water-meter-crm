import { useQuery, useMutation } from '@tanstack/react-query';
import { useState, useMemo, useEffect } from 'react';
import { Link, useSearch } from 'wouter';
import type { Account } from '@shared/schema';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { fmtNum, tierColor, priorityColor, statusColor, scoreColor, STATUSES, PRIORITIES, TIERS } from '@/lib/format';
import { ArrowUpDown, LayoutGrid, Table as TableIcon, Plus, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import ImportAccountsDialog from '@/components/ImportAccountsDialog';

type SortKey = 'name' | 'county' | 'tier' | 'endpoints' | 'candidateScore' | 'status' | 'waterBudgetUsd';

function fmtBudget(usd: number | null | undefined) {
  if (usd == null) return null;
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(usd >= 10_000_000 ? 0 : 1)}M`;
  if (usd >= 1_000) return `$${Math.round(usd / 1_000)}K`;
  return `$${usd}`;
}

export default function Accounts() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const initCounty = params.get('county') || 'all';
  const { toast } = useToast();

  const { data: accounts = [], isLoading } = useQuery<Account[]>({ queryKey: ['/api/accounts'] });
  const [view, setView] = useState<'table' | 'kanban'>('table');
  const [q, setQ] = useState('');
  const [county, setCounty] = useState<string>(initCounty);
  const [tier, setTier] = useState<string>('all');
  const [status, setStatus] = useState<string>('all');
  const [priority, setPriority] = useState<string>('all');
  const [sortKey, setSortKey] = useState<SortKey>('candidateScore');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const [addOpen, setAddOpen] = useState(false);
  const emptyForm = {
    name: '', county: '', city: '', tier: 'Tier 3', endpoints: '',
    primaryContact: '', contactTitle: '', phone: '', email: '', address: '',
    insight: '',
  };
  const [form, setForm] = useState(emptyForm);

  useEffect(() => { if (initCounty) setCounty(initCounty); }, [initCounty]);

  const counties = useMemo(() => {
    const set = new Set(accounts.map(a => a.county).filter(Boolean));
    return Array.from(set).sort();
  }, [accounts]);

  const filtered = useMemo(() => {
    let list = accounts.filter(a => {
      if (q && !`${a.name} ${a.county} ${a.primaryContact || ''}`.toLowerCase().includes(q.toLowerCase())) return false;
      if (county !== 'all' && a.county !== county) return false;
      if (tier !== 'all' && a.tier !== tier) return false;
      if (status !== 'all' && a.status !== status) return false;
      if (priority !== 'all' && a.priority !== priority) return false;
      return true;
    });
    list.sort((a: any, b: any) => {
      let av = a[sortKey], bv = b[sortKey];
      if (typeof av === 'string') av = av.toLowerCase();
      if (typeof bv === 'string') bv = bv.toLowerCase();
      if (av == null) av = sortKey === 'waterBudgetUsd' ? -1 : '';
      if (bv == null) bv = sortKey === 'waterBudgetUsd' ? -1 : '';
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return list;
  }, [accounts, q, county, tier, status, priority, sortKey, sortDir]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir(k === 'name' || k === 'county' ? 'asc' : 'desc'); }
  }

  const addMut = useMutation({
    mutationFn: async () => {
      const tierNum = form.tier === 'Tier 1' ? 40 : form.tier === 'Tier 2' ? 25 : 12;
      const ep = Number(form.endpoints) || 0;
      const epScore = Math.min(35, Math.round(Math.log10(Math.max(ep, 1) + 1) * 7));
      const score = Math.min(100, tierNum + epScore + 10);
      const body: any = {
        name: form.name.trim(),
        county: form.county.trim() || 'Unknown',
        city: (form.city.trim() || form.name.trim()),
        tier: form.tier,
        endpoints: ep,
        population: 0,
        candidateScore: score,
        scoreReasons: JSON.stringify([
          `${form.tier} weighting`,
          ep ? `${fmtNum(ep)} endpoints` : 'Endpoint count not provided',
          'Manually added account',
        ]),
        priority: form.tier === 'Tier 1' ? 'High' : form.tier === 'Tier 2' ? 'Medium' : 'Low',
        status: 'Not Started',
        primaryContact: form.primaryContact || null,
        contactTitle: form.contactTitle || null,
        phone: form.phone || null,
        email: form.email || null,
        address: form.address || null,
        insight: form.insight || 'Manually added — gather discovery data on next call.',
        oppAmiAmr: 0, oppLeakDetection: 0, oppBillingAccuracy: 0, oppLaborSavings: 0,
      };
      return (await apiRequest('POST', '/api/accounts', body)).json();
    },
    onSuccess: () => {
      setForm(emptyForm); setAddOpen(false);
      queryClient.invalidateQueries({ queryKey: ['/api/accounts'] });
      toast({ title: 'Account added' });
    },
    onError: (e: any) => toast({ title: 'Could not add account', description: e?.message || 'Unknown error', variant: 'destructive' }),
  });

  const delMut = useMutation({
    mutationFn: async (id: number) => apiRequest('DELETE', `/api/accounts/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/accounts'] });
      toast({ title: 'Account deleted' });
    },
  });

  const updateMut = useMutation({
    mutationFn: async ({ id, patch }: { id: number; patch: Partial<Account> }) =>
      (await apiRequest('PATCH', `/api/accounts/${id}`, patch)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/accounts'] });
    },
    onError: (e: any) => toast({ title: 'Update failed', description: e?.message || 'Unknown error', variant: 'destructive' }),
  });

  const canSubmit = form.name.trim() && form.county.trim();

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold">Accounts</h1>
          <p className="text-sm text-muted-foreground">{filtered.length} of {accounts.length} accounts</p>
        </div>
        <div className="flex gap-2 items-center">
          <Tabs value={view} onValueChange={(v) => setView(v as any)}>
            <TabsList>
              <TabsTrigger value="table" data-testid="tab-table"><TableIcon className="w-4 h-4 mr-1" /> Table</TabsTrigger>
              <TabsTrigger value="kanban" data-testid="tab-kanban"><LayoutGrid className="w-4 h-4 mr-1" /> Kanban</TabsTrigger>
            </TabsList>
          </Tabs>
          <ImportAccountsDialog />
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-open-add-account"><Plus className="w-4 h-4 mr-1" /> Add Account</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Add Account</DialogTitle>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Label className="text-xs">Municipality / Account Name *</Label>
                  <Input data-testid="input-new-account-name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Plymouth" />
                </div>
                <div>
                  <Label className="text-xs">County *</Label>
                  <Input data-testid="input-new-county" value={form.county} onChange={e => setForm({ ...form, county: e.target.value })} placeholder="Wayne" list="county-list" />
                  <datalist id="county-list">
                    {counties.map(c => <option key={c} value={c} />)}
                  </datalist>
                </div>
                <div>
                  <Label className="text-xs">City</Label>
                  <Input value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} placeholder="Same as account name" />
                </div>
                <div>
                  <Label className="text-xs">Tier</Label>
                  <Select value={form.tier} onValueChange={(v) => setForm({ ...form, tier: v })}>
                    <SelectTrigger data-testid="select-new-tier"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TIERS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Estimated Endpoints</Label>
                  <Input type="number" value={form.endpoints} onChange={e => setForm({ ...form, endpoints: e.target.value })} placeholder="5000" />
                </div>
                <div className="col-span-2 pt-2 border-t">
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">Primary Contact (optional)</Label>
                </div>
                <div>
                  <Label className="text-xs">Name</Label>
                  <Input value={form.primaryContact} onChange={e => setForm({ ...form, primaryContact: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">Title</Label>
                  <Input value={form.contactTitle} onChange={e => setForm({ ...form, contactTitle: e.target.value })} placeholder="DPW Director" />
                </div>
                <div>
                  <Label className="text-xs">Phone</Label>
                  <Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">Email</Label>
                  <Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">Address</Label>
                  <Input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="123 Main St" />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">Insight (optional)</Label>
                  <Input value={form.insight} onChange={e => setForm({ ...form, insight: e.target.value })} placeholder="What you know about the buying opportunity" />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
                <Button disabled={!canSubmit || addMut.isPending} onClick={() => addMut.mutate()} data-testid="button-save-account">
                  {addMut.isPending ? 'Saving...' : 'Save Account'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Filters */}
      <Card className="mb-4">
        <CardContent className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
            <Input data-testid="input-search" placeholder="Search name, county, contact..." value={q} onChange={e => setQ(e.target.value)} className="md:col-span-2" />
            <Select value={county} onValueChange={setCounty}>
              <SelectTrigger data-testid="select-county"><SelectValue placeholder="County" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Counties</SelectItem>
                {counties.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={tier} onValueChange={setTier}>
              <SelectTrigger data-testid="select-tier"><SelectValue placeholder="Tier" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Tiers</SelectItem>
                {TIERS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger data-testid="select-status"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger data-testid="select-priority"><SelectValue placeholder="Priority" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Priorities</SelectItem>
                {PRIORITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="p-8 text-center text-muted-foreground">Loading accounts...</div>
      ) : view === 'table' ? (
        <Card>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900 border-b">
                <tr className="text-left">
                  {([['name','Account'],['county','County'],['tier','Tier'],['endpoints','Endpoints'],['candidateScore','Score'],['status','Status']] as [SortKey,string][]).map(([k,l]) => (
                    <th key={k} className="px-3 py-2 font-medium cursor-pointer select-none" onClick={() => toggleSort(k)} data-testid={`sort-${k}`}>
                      <span className="inline-flex items-center gap-1">{l} <ArrowUpDown className="w-3 h-3 text-muted-foreground" /></span>
                    </th>
                  ))}
                  <th className="px-3 py-2 font-medium">Contact</th>
                  <th className="px-3 py-2 font-medium">Priority</th>
                  <th className="px-3 py-2 font-medium">Insight</th>
                  <th className="px-3 py-2 font-medium cursor-pointer select-none" onClick={() => toggleSort('waterBudgetUsd')} data-testid="sort-waterBudgetUsd">
                    <span className="inline-flex items-center gap-1">Water Budget <ArrowUpDown className="w-3 h-3 text-muted-foreground" /></span>
                  </th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(a => (
                  <tr key={a.id} className="border-b hover:bg-slate-50 dark:hover:bg-slate-900/50" data-testid={`row-account-${a.id}`}>
                    <td className="px-3 py-2">
                      <Link href={`/accounts/${a.id}`}>
                        <span className="font-medium text-blue-700 dark:text-blue-400 hover:underline cursor-pointer">{a.name}</span>
                      </Link>
                      <div className="text-xs text-muted-foreground">{a.city}{a.cityState ? `, ${a.cityState.split(',')[1]?.trim() || ''}` : ''}</div>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{a.county}</td>
                    <td className="px-3 py-2">
                      <Select value={a.tier} onValueChange={(v) => updateMut.mutate({ id: a.id, patch: { tier: v } })}>
                        <SelectTrigger
                          data-testid={`select-row-tier-${a.id}`}
                          className={`h-7 w-[88px] px-2 text-xs border-0 ${tierColor[a.tier]} hover:opacity-80`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TIERS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-3 py-2 tabular-nums">{fmtNum(a.endpoints)}</td>
                    <td className={`px-3 py-2 tabular-nums ${scoreColor(a.candidateScore)}`}>{a.candidateScore}</td>
                    <td className="px-3 py-2"><Badge variant="outline" className={statusColor[a.status] || ''}>{a.status}</Badge></td>
                    <td className="px-3 py-2">
                      <div className="text-xs">{a.primaryContact || '—'}</div>
                      {a.contactTitle && <div className="text-xs text-muted-foreground">{a.contactTitle}</div>}
                    </td>
                    <td className="px-3 py-2">
                      <Select value={a.priority} onValueChange={(v) => updateMut.mutate({ id: a.id, patch: { priority: v } })}>
                        <SelectTrigger
                          data-testid={`select-row-priority-${a.id}`}
                          className={`h-7 w-[90px] px-2 text-xs ${priorityColor[a.priority] || ''} hover:opacity-80`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PRIORITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground max-w-md truncate" title={a.insight || ''}>{a.insight || '—'}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {a.waterBudgetUsd ? (
                        <div>
                          <div className="font-medium text-emerald-700 dark:text-emerald-400">{fmtBudget(a.waterBudgetUsd)}</div>
                          {a.waterBudgetFiscalYear && <div className="text-[10px] text-muted-foreground">{a.waterBudgetFiscalYear}</div>}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">unknown</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="sm" data-testid={`button-del-account-${a.id}`} title="Delete account">
                            <Trash2 className="w-3.5 h-3.5 text-red-600" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete {a.name}?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This permanently removes the account and all of its contacts, tasks, notes, opportunities, and activity. This cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => delMut.mutate(a.id)} className="bg-red-600 hover:bg-red-700" data-testid={`confirm-del-${a.id}`}>
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {STATUSES.map(s => {
            const col = filtered.filter(a => a.status === s);
            return (
              <div key={s} className="bg-slate-100 dark:bg-slate-900/50 rounded-lg p-3" data-testid={`kanban-col-${s}`}>
                <div className="flex items-center justify-between mb-3 px-1">
                  <Badge variant="outline" className={statusColor[s]}>{s}</Badge>
                  <span className="text-xs text-muted-foreground">{col.length}</span>
                </div>
                <div className="space-y-2 max-h-[70vh] overflow-auto">
                  {col.map(a => (
                    <Link key={a.id} href={`/accounts/${a.id}`}>
                      <div className="bg-white dark:bg-slate-900 border rounded-md p-3 hover:shadow cursor-pointer" data-testid={`kanban-card-${a.id}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="font-medium text-sm leading-tight">{a.name}</div>
                          <span className={`text-xs ${scoreColor(a.candidateScore)}`}>{a.candidateScore}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <Badge className={tierColor[a.tier] + ' text-[10px]'}>{a.tier}</Badge>
                          <span className="text-xs text-muted-foreground">{a.county}</span>
                        </div>
                        <div className="flex items-center justify-between mt-2">
                          <div className="text-xs text-muted-foreground">{fmtNum(a.endpoints)} endpoints</div>
                          {a.waterBudgetUsd && <div className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">{fmtBudget(a.waterBudgetUsd)}</div>}
                        </div>
                      </div>
                    </Link>
                  ))}
                  {col.length === 0 && <div className="text-xs text-muted-foreground text-center py-4">No accounts</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
