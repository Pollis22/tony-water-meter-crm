import { useQuery, useMutation } from '@tanstack/react-query';
import { useParams, Link } from 'wouter';
import { useState } from 'react';
import type { Account, Contact, Task, Note, Activity, Opportunity } from '@shared/schema';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { fmtNum, tierColor, priorityColor, statusColor, scoreColor, STATUSES, PRIORITIES, TIERS } from '@/lib/format';
import { ArrowLeft, Mail, Phone, MapPin, Building2, Sparkles, Plus, Trash2, Check, DollarSign, ExternalLink } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function AccountDetail() {
  const { id } = useParams<{ id: string }>();
  const accountId = Number(id);
  const { toast } = useToast();

  const { data: account, isLoading } = useQuery<Account>({ queryKey: ['/api/accounts', accountId] });
  const { data: contacts = [] } = useQuery<Contact[]>({ queryKey: ['/api/contacts', accountId], queryFn: async () => (await apiRequest('GET', `/api/contacts?accountId=${accountId}`)).json() });
  const { data: tasks = [] } = useQuery<Task[]>({ queryKey: ['/api/tasks', accountId], queryFn: async () => (await apiRequest('GET', `/api/tasks?accountId=${accountId}`)).json() });
  const { data: notes = [] } = useQuery<Note[]>({ queryKey: ['/api/notes', accountId], queryFn: async () => (await apiRequest('GET', `/api/notes?accountId=${accountId}`)).json() });
  const { data: activities = [] } = useQuery<Activity[]>({ queryKey: ['/api/activities', accountId], queryFn: async () => (await apiRequest('GET', `/api/activities?accountId=${accountId}`)).json() });
  const { data: opps = [] } = useQuery<Opportunity[]>({ queryKey: ['/api/opportunities'], queryFn: async () => (await apiRequest('GET', `/api/opportunities`)).json() });

  const accountOpps = opps.filter(o => o.accountId === accountId);

  const updateMut = useMutation({
    mutationFn: async (patch: Partial<Account>) => (await apiRequest('PATCH', `/api/accounts/${accountId}`, patch)).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/accounts'] }); toast({ title: 'Saved' }); },
  });

  const [newNote, setNewNote] = useState('');
  const noteMut = useMutation({
    mutationFn: async () => (await apiRequest('POST', `/api/notes`, { accountId, body: newNote })).json(),
    onSuccess: () => { setNewNote(''); queryClient.invalidateQueries({ queryKey: ['/api/notes', accountId] }); },
  });

  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDue, setNewTaskDue] = useState('');
  const taskMut = useMutation({
    mutationFn: async () => (await apiRequest('POST', `/api/tasks`, { accountId, title: newTaskTitle, dueDate: newTaskDue || null, status: 'Open', priority: 'Medium' })).json(),
    onSuccess: () => { setNewTaskTitle(''); setNewTaskDue(''); queryClient.invalidateQueries({ queryKey: ['/api/tasks', accountId] }); },
  });
  const taskToggle = useMutation({
    mutationFn: async (t: Task) => (await apiRequest('PATCH', `/api/tasks/${t.id}`, { status: t.status === 'Done' ? 'Open' : 'Done' })).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/tasks', accountId] }),
  });

  const [newContact, setNewContact] = useState({ name: '', title: '', phone: '', email: '' });
  const contactMut = useMutation({
    mutationFn: async () => (await apiRequest('POST', `/api/contacts`, { accountId, ...newContact })).json(),
    onSuccess: () => { setNewContact({ name: '', title: '', phone: '', email: '' }); queryClient.invalidateQueries({ queryKey: ['/api/contacts', accountId] }); },
  });
  const contactDel = useMutation({
    mutationFn: async (cid: number) => apiRequest('DELETE', `/api/contacts/${cid}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/contacts', accountId] }),
  });

  if (isLoading || !account) return <div className="p-8">Loading...</div>;

  const reasons: string[] = (() => { try { return JSON.parse(account.scoreReasons || '[]'); } catch { return []; } })();

  // Parse markdown link [text](url) from source
  const sourceMatch = account.waterBudgetSource?.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
  const fmtBudgetFull = (usd: number | null | undefined) => usd == null
    ? null
    : usd >= 1_000_000
      ? `$${(usd / 1_000_000).toFixed(2)}M ($${usd.toLocaleString()})`
      : `$${usd.toLocaleString()}`;

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <Link href="/accounts">
        <span className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground cursor-pointer mb-4" data-testid="link-back">
          <ArrowLeft className="w-4 h-4" /> Back to Accounts
        </span>
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-semibold" data-testid="text-account-name">{account.name}</h1>
            <Badge variant="outline" className={priorityColor[account.priority]}>{account.priority} Priority</Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {account.county} County · {account.city}{account.cityState ? `, ${account.cityState.split(',')[1]?.trim() || ''}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Card className="px-4 py-2">
            <div className="text-xs text-muted-foreground">Candidate Score</div>
            <div className={`text-xl font-semibold ${scoreColor(account.candidateScore)}`} data-testid="text-score">{account.candidateScore}</div>
          </Card>
          <Card className="px-4 py-2">
            <div className="text-xs text-muted-foreground">Endpoints</div>
            <div className="text-xl font-semibold tabular-nums">{fmtNum(account.endpoints)}</div>
          </Card>
        </div>
      </div>

      {/* Quick fields */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-6">
        <Card><CardContent className="p-3">
          <div className="text-xs text-muted-foreground mb-1">Tier</div>
          <Select value={account.tier} onValueChange={(v) => updateMut.mutate({ tier: v })}>
            <SelectTrigger data-testid="select-tier"><SelectValue /></SelectTrigger>
            <SelectContent>{TIERS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
          </Select>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-xs text-muted-foreground mb-1">Status</div>
          <Select value={account.status} onValueChange={(v) => updateMut.mutate({ status: v })}>
            <SelectTrigger data-testid="select-status"><SelectValue /></SelectTrigger>
            <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-xs text-muted-foreground mb-1">Priority</div>
          <Select value={account.priority} onValueChange={(v) => updateMut.mutate({ priority: v })}>
            <SelectTrigger data-testid="select-priority"><SelectValue /></SelectTrigger>
            <SelectContent>{PRIORITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
          </Select>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-xs text-muted-foreground mb-1">Next Follow-up</div>
          <Input type="date" defaultValue={account.nextFollowUpAt || ''} onBlur={(e) => updateMut.mutate({ nextFollowUpAt: e.target.value || null })} data-testid="input-followup" />
        </CardContent></Card>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
          <TabsTrigger value="contacts" data-testid="tab-contacts">Contacts</TabsTrigger>
          <TabsTrigger value="tasks" data-testid="tab-tasks">Tasks ({tasks.length})</TabsTrigger>
          <TabsTrigger value="notes" data-testid="tab-notes">Notes ({notes.length})</TabsTrigger>
          <TabsTrigger value="activity" data-testid="tab-activity">Activity</TabsTrigger>
          <TabsTrigger value="opps" data-testid="tab-opps">Opportunities ({accountOpps.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-2">
              <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Sparkles className="w-4 h-4 text-blue-600" /> Sales Insight</CardTitle></CardHeader>
              <CardContent>
                <p className="text-sm leading-relaxed">{account.insight || 'No insight available.'}</p>
                {account.entryAngle && (
                  <div className="mt-4 pt-4 border-t">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Entry Angle</div>
                    <div className="text-sm font-medium">{account.entryAngle}</div>
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><DollarSign className="w-4 h-4 text-emerald-600" /> Public Water Budget</CardTitle></CardHeader>
              <CardContent>
                {account.waterBudgetUsd ? (
                  <>
                    <div className="text-xl font-semibold text-emerald-700 dark:text-emerald-400 tabular-nums" data-testid="text-water-budget">
                      {fmtBudgetFull(account.waterBudgetUsd)}
                    </div>
                    {account.waterBudgetFiscalYear && (
                      <div className="text-xs text-muted-foreground mt-1">Fiscal year {account.waterBudgetFiscalYear}</div>
                    )}
                    {account.waterBudgetType && (
                      <Badge variant="outline" className="mt-2 text-[10px]">{account.waterBudgetType}</Badge>
                    )}
                    {account.waterBudgetNotes && (
                      <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{account.waterBudgetNotes}</p>
                    )}
                    {sourceMatch && (
                      <a href={sourceMatch[2]} target="_blank" rel="noopener noreferrer"
                         className="mt-3 inline-flex items-center gap-1 text-xs text-blue-600 hover:underline" data-testid="link-budget-source">
                        <ExternalLink className="w-3 h-3" /> {sourceMatch[1]}
                      </a>
                    )}
                  </>
                ) : (
                  <div className="text-sm text-muted-foreground" data-testid="text-water-budget">
                    Unknown — no public figure found in research.
                    <p className="mt-2 text-xs">Ask during discovery: water dept annual operating budget, capital plan, and meter replacement line item.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Primary Contact</CardTitle></CardHeader>
              <CardContent className="text-sm space-y-1" data-testid="card-primary-contact">
                <div className="font-medium">{account.primaryContact || 'Unknown'}</div>
                {account.contactTitle && <div className="text-muted-foreground">{account.contactTitle}</div>}
                {account.phone && <div className="flex items-center gap-2"><Phone className="w-3 h-3" /> <a href={`tel:${account.phone}`} className="hover:underline">{account.phone}</a></div>}
                {account.email && <div className="flex items-center gap-2"><Mail className="w-3 h-3" /> <a href={`mailto:${account.email}`} className="hover:underline">{account.email}</a></div>}
                {account.address && <div className="flex items-start gap-2"><MapPin className="w-3 h-3 mt-0.5" /> <span>{account.address}{account.cityState ? `, ${account.cityState}` : ''}</span></div>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Why This Score</CardTitle></CardHeader>
              <CardContent>
                {reasons.length === 0 ? <div className="text-sm text-muted-foreground">No reasons recorded.</div> : (
                  <ul className="text-sm space-y-1">
                    {reasons.map((r, i) => <li key={i} className="flex gap-2"><span className="text-blue-600">·</span><span>{r}</span></li>)}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Opportunities Targeted</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {account.oppAmiAmr ? <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200">AMI / AMR Upgrade</Badge> : null}
              {account.oppLeakDetection ? <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200">Leak Detection</Badge> : null}
              {account.oppBillingAccuracy ? <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">Billing Accuracy</Badge> : null}
              {account.oppLaborSavings ? <Badge className="bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-200">Labor Savings</Badge> : null}
              {!account.oppAmiAmr && !account.oppLeakDetection && !account.oppBillingAccuracy && !account.oppLaborSavings && (
                <span className="text-sm text-muted-foreground">No flagged opportunities. Discover during call.</span>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="contacts" className="space-y-4 mt-4">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Add Contact</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                <Input data-testid="input-contact-name" placeholder="Name" value={newContact.name} onChange={e => setNewContact({ ...newContact, name: e.target.value })} />
                <Input data-testid="input-contact-title" placeholder="Title" value={newContact.title} onChange={e => setNewContact({ ...newContact, title: e.target.value })} />
                <Input data-testid="input-contact-phone" placeholder="Phone" value={newContact.phone} onChange={e => setNewContact({ ...newContact, phone: e.target.value })} />
                <Input data-testid="input-contact-email" placeholder="Email" value={newContact.email} onChange={e => setNewContact({ ...newContact, email: e.target.value })} />
              </div>
              <Button className="mt-2" disabled={!newContact.name} onClick={() => contactMut.mutate()} data-testid="button-add-contact"><Plus className="w-4 h-4 mr-1" /> Add</Button>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900 border-b"><tr className="text-left">
                  <th className="px-3 py-2 font-medium">Name</th><th className="px-3 py-2 font-medium">Title</th><th className="px-3 py-2 font-medium">Phone</th><th className="px-3 py-2 font-medium">Email</th><th className="px-3 py-2"></th>
                </tr></thead>
                <tbody>
                  {contacts.length === 0 && <tr><td colSpan={5} className="p-4 text-muted-foreground text-center">No additional contacts.</td></tr>}
                  {contacts.map(c => (
                    <tr key={c.id} className="border-b">
                      <td className="px-3 py-2 font-medium">{c.name}</td>
                      <td className="px-3 py-2 text-muted-foreground">{c.title || '—'}</td>
                      <td className="px-3 py-2">{c.phone || '—'}</td>
                      <td className="px-3 py-2">{c.email || '—'}</td>
                      <td className="px-3 py-2 text-right"><Button variant="ghost" size="sm" onClick={() => contactDel.mutate(c.id)} data-testid={`button-delete-contact-${c.id}`}><Trash2 className="w-3 h-3" /></Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tasks" className="space-y-4 mt-4">
          <Card>
            <CardContent className="p-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <Input className="md:col-span-2" data-testid="input-task-title" placeholder="New task..." value={newTaskTitle} onChange={e => setNewTaskTitle(e.target.value)} />
                <Input type="date" data-testid="input-task-due" value={newTaskDue} onChange={e => setNewTaskDue(e.target.value)} />
              </div>
              <Button className="mt-2" disabled={!newTaskTitle} onClick={() => taskMut.mutate()} data-testid="button-add-task"><Plus className="w-4 h-4 mr-1" /> Add Task</Button>
            </CardContent>
          </Card>
          <Card><CardContent className="p-4 space-y-2">
            {tasks.length === 0 && <div className="text-sm text-muted-foreground">No tasks for this account.</div>}
            {tasks.map(t => (
              <div key={t.id} className="flex items-center justify-between gap-3 p-2 rounded hover:bg-slate-50 dark:hover:bg-slate-900/50" data-testid={`task-${t.id}`}>
                <div className="flex items-center gap-3 flex-1">
                  <Button size="sm" variant={t.status === 'Done' ? 'default' : 'outline'} onClick={() => taskToggle.mutate(t)} className="h-6 w-6 p-0" data-testid={`button-toggle-task-${t.id}`}>
                    {t.status === 'Done' && <Check className="w-3 h-3" />}
                  </Button>
                  <span className={t.status === 'Done' ? 'line-through text-muted-foreground' : ''}>{t.title}</span>
                </div>
                {t.dueDate && <span className="text-xs text-muted-foreground">{t.dueDate}</span>}
              </div>
            ))}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="notes" className="space-y-4 mt-4">
          <Card>
            <CardContent className="p-4">
              <Textarea data-testid="input-note" placeholder="Add a note about this account..." value={newNote} onChange={e => setNewNote(e.target.value)} rows={3} />
              <Button className="mt-2" disabled={!newNote} onClick={() => noteMut.mutate()} data-testid="button-add-note"><Plus className="w-4 h-4 mr-1" /> Save Note</Button>
            </CardContent>
          </Card>
          <div className="space-y-2">
            {notes.length === 0 && <Card><CardContent className="p-4 text-sm text-muted-foreground">No notes yet.</CardContent></Card>}
            {notes.map(n => (
              <Card key={n.id}><CardContent className="p-3">
                <div className="text-xs text-muted-foreground mb-1">{n.createdAt}</div>
                <div className="text-sm whitespace-pre-wrap">{n.body}</div>
              </CardContent></Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="activity" className="mt-4">
          <Card><CardContent className="p-4 space-y-2">
            {activities.length === 0 && <div className="text-sm text-muted-foreground">No activity recorded.</div>}
            {activities.map(a => (
              <div key={a.id} className="flex items-start gap-3 py-2 border-b last:border-0">
                <Badge variant="outline" className="text-xs">{a.type}</Badge>
                <div className="flex-1">
                  <div className="text-sm">{a.summary}</div>
                  {a.outcome && <div className="text-xs text-muted-foreground">{a.outcome}</div>}
                </div>
                <div className="text-xs text-muted-foreground">{a.occurredAt}</div>
              </div>
            ))}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="opps" className="mt-4">
          <Card><CardContent className="p-4 space-y-2">
            {accountOpps.length === 0 && <div className="text-sm text-muted-foreground">No opportunities yet. Create one in the Opportunities page.</div>}
            {accountOpps.map(o => (
              <div key={o.id} className="flex items-center justify-between p-2 border-b last:border-0">
                <div>
                  <div className="font-medium text-sm">{o.name}</div>
                  <div className="text-xs text-muted-foreground">Stage: {o.stage}</div>
                </div>
                {o.amount && <div className="text-sm font-medium">${o.amount.toLocaleString()}</div>}
              </div>
            ))}
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
