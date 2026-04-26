import { useQuery, useMutation } from '@tanstack/react-query';
import { useState, useMemo } from 'react';
import type { Contact, Account } from '@shared/schema';
import { Link } from 'wouter';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Mail, Phone, Plus, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface ContactRow {
  source: 'primary' | 'extra';
  contactId?: number;
  accountId: number;
  accountName: string;
  county: string;
  name: string;
  title?: string | null;
  phone?: string | null;
  email?: string | null;
}

export default function Contacts() {
  const { toast } = useToast();
  const { data: accounts = [] } = useQuery<Account[]>({ queryKey: ['/api/accounts'] });
  const { data: extras = [] } = useQuery<Contact[]>({
    queryKey: ['/api/contacts', 'all'],
    queryFn: async () => (await apiRequest('GET', `/api/contacts`)).json(),
  });
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ accountId: '', name: '', title: '', phone: '', email: '' });

  const addMut = useMutation({
    mutationFn: async () => (await apiRequest('POST', `/api/contacts`, {
      accountId: Number(form.accountId),
      name: form.name,
      title: form.title || null,
      phone: form.phone || null,
      email: form.email || null,
    })).json(),
    onSuccess: () => {
      setForm({ accountId: '', name: '', title: '', phone: '', email: '' });
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ['/api/contacts', 'all'] });
      toast({ title: 'Contact added' });
    },
    onError: (e: any) => toast({ title: 'Could not add contact', description: e?.message || 'Unknown error', variant: 'destructive' }),
  });

  const delMut = useMutation({
    mutationFn: async (id: number) => apiRequest('DELETE', `/api/contacts/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/contacts', 'all'] });
      toast({ title: 'Contact removed' });
    },
  });

  const rows: ContactRow[] = useMemo(() => {
    const r: ContactRow[] = [];
    for (const a of accounts) {
      if (a.primaryContact) r.push({
        source: 'primary', accountId: a.id, accountName: a.name, county: a.county,
        name: a.primaryContact, title: a.contactTitle, phone: a.phone, email: a.email,
      });
    }
    const accById = new Map(accounts.map(a => [a.id, a]));
    for (const c of extras) {
      const a = accById.get(c.accountId);
      if (!a) continue;
      r.push({ source: 'extra', contactId: c.id, accountId: a.id, accountName: a.name, county: a.county, name: c.name, title: c.title, phone: c.phone, email: c.email });
    }
    return r.sort((a, b) => a.accountName.localeCompare(b.accountName));
  }, [accounts, extras]);

  const filtered = rows.filter(r => !q || `${r.name} ${r.accountName} ${r.county} ${r.title || ''} ${r.email || ''} ${r.phone || ''}`.toLowerCase().includes(q.toLowerCase()));

  const sortedAccounts = useMemo(() => [...accounts].sort((a, b) => a.name.localeCompare(b.name)), [accounts]);
  const canSubmit = !!form.accountId && !!form.name.trim();

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Contacts</h1>
          <p className="text-sm text-muted-foreground">{filtered.length} of {rows.length} contacts</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-open-add-contact"><Plus className="w-4 h-4 mr-1" /> Add Contact</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Contact</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Account *</Label>
                <Select value={form.accountId} onValueChange={(v) => setForm({ ...form, accountId: v })}>
                  <SelectTrigger data-testid="select-account"><SelectValue placeholder="Pick an account..." /></SelectTrigger>
                  <SelectContent className="max-h-72">
                    {sortedAccounts.map(a => (
                      <SelectItem key={a.id} value={String(a.id)}>{a.name} · {a.county}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Name *</Label>
                <Input data-testid="input-new-name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Jane Smith" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Title</Label>
                  <Input data-testid="input-new-title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Water Superintendent" />
                </div>
                <div>
                  <Label className="text-xs">Phone</Label>
                  <Input data-testid="input-new-phone" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="(555) 123-4567" />
                </div>
              </div>
              <div>
                <Label className="text-xs">Email</Label>
                <Input data-testid="input-new-email" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="jane@city.gov" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button disabled={!canSubmit || addMut.isPending} onClick={() => addMut.mutate()} data-testid="button-save-contact">
                {addMut.isPending ? 'Saving...' : 'Save Contact'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <Input className="mb-4 max-w-md" placeholder="Search contacts..." value={q} onChange={e => setQ(e.target.value)} data-testid="input-search" />
      <Card><CardContent className="p-0">
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900 border-b"><tr className="text-left">
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Title</th>
              <th className="px-3 py-2 font-medium">Account</th>
              <th className="px-3 py-2 font-medium">County</th>
              <th className="px-3 py-2 font-medium">Phone</th>
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2"></th>
            </tr></thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No contacts found.</td></tr>}
              {filtered.map((r, i) => (
                <tr key={`${r.source}-${r.accountId}-${r.contactId ?? 'p'}-${i}`} className="border-b hover:bg-slate-50 dark:hover:bg-slate-900/40" data-testid={`contact-row-${i}`}>
                  <td className="px-3 py-2 font-medium">{r.name}{r.source === 'primary' && <span className="ml-2 text-xs text-muted-foreground">primary</span>}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.title || '—'}</td>
                  <td className="px-3 py-2"><Link href={`/accounts/${r.accountId}`}><span className="text-blue-600 hover:underline cursor-pointer">{r.accountName}</span></Link></td>
                  <td className="px-3 py-2 text-muted-foreground">{r.county}</td>
                  <td className="px-3 py-2">{r.phone ? <a href={`tel:${r.phone}`} className="inline-flex items-center gap-1 hover:underline"><Phone className="w-3 h-3" />{r.phone}</a> : '—'}</td>
                  <td className="px-3 py-2">{r.email ? <a href={`mailto:${r.email}`} className="inline-flex items-center gap-1 hover:underline"><Mail className="w-3 h-3" />{r.email}</a> : '—'}</td>
                  <td className="px-3 py-2 text-right">
                    {r.source === 'extra' && r.contactId && (
                      <Button variant="ghost" size="sm" onClick={() => delMut.mutate(r.contactId!)} data-testid={`button-del-contact-${r.contactId}`}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent></Card>
    </div>
  );
}
