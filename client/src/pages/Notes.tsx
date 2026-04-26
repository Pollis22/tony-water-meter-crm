import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { Note, Account } from '@shared/schema';
import { Link } from 'wouter';
import { apiRequest } from '@/lib/queryClient';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export default function Notes() {
  const { data: accounts = [] } = useQuery<Account[]>({ queryKey: ['/api/accounts'] });
  const [search, setSearch] = useState('');

  // Notes are scoped per account; aggregate by reading each account's notes via accountId list endpoint.
  // Simpler: load all notes by fetching with no filter — server returns all notes.
  const { data: notes = [] } = useQuery<Note[]>({
    queryKey: ['/api/notes', 'all'],
    queryFn: async () => (await apiRequest('GET', `/api/notes`)).json(),
  });

  const accountById = new Map(accounts.map(a => [a.id, a]));

  const filtered = notes.filter(n => {
    if (!search) return true;
    const acc = accountById.get(n.accountId);
    return n.body.toLowerCase().includes(search.toLowerCase()) || (acc && acc.name.toLowerCase().includes(search.toLowerCase()));
  }).sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));

  return (
    <div className="p-6 max-w-[1100px] mx-auto">
      <div className="mb-4">
        <h1 className="text-xl font-semibold">Notes</h1>
        <p className="text-sm text-muted-foreground">{notes.length} notes across all accounts</p>
      </div>
      <Input className="mb-4" placeholder="Search notes..." value={search} onChange={e => setSearch(e.target.value)} data-testid="input-search" />
      <div className="space-y-3">
        {filtered.length === 0 && <Card><CardContent className="p-6 text-center text-muted-foreground text-sm">No notes yet. Add notes from any account page.</CardContent></Card>}
        {filtered.map(n => {
          const acc = accountById.get(n.accountId);
          return (
            <Card key={n.id} data-testid={`note-${n.id}`}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  {acc ? <Link href={`/accounts/${acc.id}`}><span className="text-sm font-semibold text-blue-600 hover:underline cursor-pointer">{acc.name}</span></Link> : <span className="text-sm text-muted-foreground">Unknown account</span>}
                  <span className="text-xs text-muted-foreground">{n.createdAt}</span>
                </div>
                <div className="text-sm whitespace-pre-wrap">{n.body}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
