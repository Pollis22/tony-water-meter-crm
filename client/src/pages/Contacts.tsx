import { useQuery } from '@tanstack/react-query';
import { useState, useMemo } from 'react';
import type { Contact, Account } from '@shared/schema';
import { Link } from 'wouter';
import { apiRequest } from '@/lib/queryClient';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Mail, Phone } from 'lucide-react';

interface ContactRow {
  source: 'primary' | 'extra';
  accountId: number;
  accountName: string;
  county: string;
  name: string;
  title?: string | null;
  phone?: string | null;
  email?: string | null;
}

export default function Contacts() {
  const { data: accounts = [] } = useQuery<Account[]>({ queryKey: ['/api/accounts'] });
  const { data: extras = [] } = useQuery<Contact[]>({
    queryKey: ['/api/contacts', 'all'],
    queryFn: async () => (await apiRequest('GET', `/api/contacts`)).json(),
  });
  const [q, setQ] = useState('');

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
      r.push({ source: 'extra', accountId: a.id, accountName: a.name, county: a.county, name: c.name, title: c.title, phone: c.phone, email: c.email });
    }
    return r.sort((a, b) => a.accountName.localeCompare(b.accountName));
  }, [accounts, extras]);

  const filtered = rows.filter(r => !q || `${r.name} ${r.accountName} ${r.county} ${r.title || ''} ${r.email || ''} ${r.phone || ''}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="mb-4">
        <h1 className="text-xl font-semibold">Contacts</h1>
        <p className="text-sm text-muted-foreground">{filtered.length} of {rows.length} contacts</p>
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
            </tr></thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No contacts found.</td></tr>}
              {filtered.map((r, i) => (
                <tr key={`${r.source}-${r.accountId}-${i}`} className="border-b hover:bg-slate-50 dark:hover:bg-slate-900/40" data-testid={`contact-row-${i}`}>
                  <td className="px-3 py-2 font-medium">{r.name}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.title || '—'}</td>
                  <td className="px-3 py-2"><Link href={`/accounts/${r.accountId}`}><span className="text-blue-600 hover:underline cursor-pointer">{r.accountName}</span></Link></td>
                  <td className="px-3 py-2 text-muted-foreground">{r.county}</td>
                  <td className="px-3 py-2">{r.phone ? <a href={`tel:${r.phone}`} className="inline-flex items-center gap-1 hover:underline"><Phone className="w-3 h-3" />{r.phone}</a> : '—'}</td>
                  <td className="px-3 py-2">{r.email ? <a href={`mailto:${r.email}`} className="inline-flex items-center gap-1 hover:underline"><Mail className="w-3 h-3" />{r.email}</a> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent></Card>
    </div>
  );
}
