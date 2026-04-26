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
import { fmtNum, tierColor, priorityColor, statusColor, scoreColor, STATUSES, PRIORITIES, TIERS } from '@/lib/format';
import { ArrowUpDown, Mail, Phone, MapPin, ExternalLink, LayoutGrid, Table as TableIcon } from 'lucide-react';

type SortKey = 'name' | 'county' | 'tier' | 'endpoints' | 'candidateScore' | 'status';

export default function Accounts() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const initCounty = params.get('county') || 'all';

  const { data: accounts = [], isLoading } = useQuery<Account[]>({ queryKey: ['/api/accounts'] });
  const [view, setView] = useState<'table' | 'kanban'>('table');
  const [q, setQ] = useState('');
  const [county, setCounty] = useState<string>(initCounty);
  const [tier, setTier] = useState<string>('all');
  const [status, setStatus] = useState<string>('all');
  const [priority, setPriority] = useState<string>('all');
  const [sortKey, setSortKey] = useState<SortKey>('candidateScore');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  useEffect(() => { if (initCounty) setCounty(initCounty); }, [initCounty]);

  const counties = useMemo(() => {
    const set = new Set(accounts.map(a => a.county));
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
      if (av == null) av = '';
      if (bv == null) bv = '';
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

  const updateMut = useMutation({
    mutationFn: async ({ id, patch }: { id: number; patch: Partial<Account> }) => {
      const r = await apiRequest('PATCH', `/api/accounts/${id}`, patch);
      return r.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/accounts'] }),
  });

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold">Accounts</h1>
          <p className="text-sm text-muted-foreground">{filtered.length} of {accounts.length} accounts</p>
        </div>
        <div className="flex gap-2">
          <Tabs value={view} onValueChange={(v) => setView(v as any)}>
            <TabsList>
              <TabsTrigger value="table" data-testid="tab-table"><TableIcon className="w-4 h-4 mr-1" /> Table</TabsTrigger>
              <TabsTrigger value="kanban" data-testid="tab-kanban"><LayoutGrid className="w-4 h-4 mr-1" /> Kanban</TabsTrigger>
            </TabsList>
          </Tabs>
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
                    <td className="px-3 py-2"><Badge className={tierColor[a.tier]}>{a.tier}</Badge></td>
                    <td className="px-3 py-2 tabular-nums">{fmtNum(a.endpoints)}</td>
                    <td className={`px-3 py-2 tabular-nums ${scoreColor(a.candidateScore)}`}>{a.candidateScore}</td>
                    <td className="px-3 py-2"><Badge variant="outline" className={statusColor[a.status] || ''}>{a.status}</Badge></td>
                    <td className="px-3 py-2">
                      <div className="text-xs">{a.primaryContact || '—'}</div>
                      {a.contactTitle && <div className="text-xs text-muted-foreground">{a.contactTitle}</div>}
                    </td>
                    <td className="px-3 py-2"><Badge variant="outline" className={priorityColor[a.priority] || ''}>{a.priority}</Badge></td>
                    <td className="px-3 py-2 text-xs text-muted-foreground max-w-md truncate" title={a.insight || ''}>{a.insight || '—'}</td>
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
                        <div className="text-xs text-muted-foreground mt-2">{fmtNum(a.endpoints)} endpoints</div>
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
