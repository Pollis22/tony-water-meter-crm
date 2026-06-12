import { ReactNode, useEffect, useRef } from 'react';
import { Link, useLocation } from 'wouter';
import { LayoutDashboard, CalendarDays, Building2, Users, Briefcase, Map, CheckSquare, StickyNote, BarChart3, Settings, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useState } from 'react';
import { BRAND } from '@/lib/brand';

const NAV = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/week', label: 'This Week', icon: CalendarDays },
  { href: '/accounts', label: 'Accounts', icon: Building2 },
  { href: '/contacts', label: 'Contacts', icon: Users },
  { href: '/opportunities', label: 'Opportunities', icon: Briefcase },
  { href: '/route-planner', label: 'Route Planner', icon: Map },
  { href: '/tasks', label: 'Tasks', icon: CheckSquare },
  { href: '/notes', label: 'Notes', icon: StickyNote },
  { href: '/reports', label: 'Reports', icon: BarChart3 },
  { href: '/settings', label: 'Settings', icon: Settings },
];

interface SearchResults {
  accounts: { id: number; name: string; county: string; tier: string; score: number }[];
  contacts: { id: number; accountId: number | null; name: string; title: string | null; email: string | null; accountName: string | null }[];
  notes: { id: number; accountId: number; snippet: string; accountName: string | null }[];
  activities: { id: number; accountId: number; type: string; summary: string; occurredAt: string; accountName: string | null }[];
  tasks: { id: number; accountId: number | null; title: string; dueDate: string | null; status: string; accountName: string | null }[];
  opportunities: { id: number; accountId: number; name: string; stage: string; accountName: string | null }[];
}

const EMPTY: SearchResults = { accounts: [], contacts: [], notes: [], activities: [], tasks: [], opportunities: [] };

function GlobalSearch() {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  // Cmd/Ctrl+K focuses the search from anywhere
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const { data = EMPTY } = useQuery<SearchResults>({
    queryKey: ['/api/search', debounced],
    enabled: debounced.length >= 2,
    queryFn: async () => (await apiRequest('GET', `/api/search?q=${encodeURIComponent(debounced)}`)).json(),
  });

  const r = debounced.length >= 2 ? data : EMPTY;
  const total = r.accounts.length + r.contacts.length + r.notes.length + r.activities.length + r.tasks.length + r.opportunities.length;
  const close = () => { setQ(''); setOpen(false); };

  const Row = ({ href, top, sub, right }: { href: string; top: string; sub: string; right?: string }) => (
    <Link href={href} onClick={close}>
      <div className="px-3 py-2 hover:bg-accent cursor-pointer flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium text-sm truncate">{top}</div>
          <div className="text-xs text-muted-foreground truncate">{sub}</div>
        </div>
        {right && <div className="text-xs text-muted-foreground shrink-0">{right}</div>}
      </div>
    </Link>
  );
  const GroupLabel = ({ children }: { children: ReactNode }) => (
    <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground bg-muted/40">{children}</div>
  );

  return (
    <div className="relative w-full max-w-xl">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
      <Input
        ref={inputRef}
        data-testid="input-global-search"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => { if (e.key === 'Escape') close(); }}
        placeholder="Search everything — accounts, contacts, notes, activity…  (Ctrl+K)"
        className="pl-9 bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700"
      />
      {open && debounced.length >= 2 && (
        <div className="absolute top-full mt-1 w-full bg-popover border rounded-md shadow-lg z-50 overflow-hidden max-h-[70vh] overflow-y-auto">
          {total === 0 && <div className="px-3 py-3 text-sm text-muted-foreground">No matches for “{debounced}”.</div>}
          {r.accounts.length > 0 && <GroupLabel>Accounts</GroupLabel>}
          {r.accounts.map((a) => (
            <Row key={`a${a.id}`} href={`/accounts/${a.id}`} top={a.name} sub={`${a.county} County · ${a.tier}`} right={`score ${a.score}`} />
          ))}
          {r.contacts.length > 0 && <GroupLabel>Contacts</GroupLabel>}
          {r.contacts.map((c) => (
            <Row key={`c${c.id}`} href={c.accountId ? `/accounts/${c.accountId}` : '/contacts'} top={c.name} sub={[c.title, c.accountName].filter(Boolean).join(' · ') || c.email || ''} />
          ))}
          {r.activities.length > 0 && <GroupLabel>Activity</GroupLabel>}
          {r.activities.map((v) => (
            <Row key={`v${v.id}`} href={`/accounts/${v.accountId}`} top={v.summary} sub={`${v.accountName ?? ''} · ${v.type}`} right={v.occurredAt?.slice(0, 10)} />
          ))}
          {r.notes.length > 0 && <GroupLabel>Notes</GroupLabel>}
          {r.notes.map((n) => (
            <Row key={`n${n.id}`} href={`/accounts/${n.accountId}`} top={n.snippet} sub={n.accountName ?? ''} />
          ))}
          {r.tasks.length > 0 && <GroupLabel>Tasks</GroupLabel>}
          {r.tasks.map((t) => (
            <Row key={`t${t.id}`} href="/tasks" top={t.title} sub={[t.accountName, t.status].filter(Boolean).join(' · ')} right={t.dueDate ?? undefined} />
          ))}
          {r.opportunities.length > 0 && <GroupLabel>Opportunities</GroupLabel>}
          {r.opportunities.map((o) => (
            <Row key={`o${o.id}`} href="/opportunities" top={o.name} sub={[o.accountName, o.stage].filter(Boolean).join(' · ')} />
          ))}
        </div>
      )}
    </div>
  );
}

export function AppLayout({ children }: { children: ReactNode }) {
  const [loc] = useLocation();

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950">
      {/* Sidebar */}
      <aside className="w-60 shrink-0 bg-slate-900 text-slate-100 flex flex-col no-print">
        <div className="px-5 py-4 border-b border-slate-800">
          <img src={BRAND.logoWhite} alt="Team EJP" className="h-9 w-auto" />
          <div className="text-xs text-slate-400 mt-1.5">{BRAND.tagline}</div>
        </div>
        <nav className="flex-1 py-3">
          {NAV.map(item => {
            const Icon = item.icon;
            const active = loc === item.href || (item.href !== '/' && loc.startsWith(item.href));
            return (
              <Link key={item.href} href={item.href}>
                <div
                  data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
                  style={active ? { backgroundColor: BRAND.blue } : undefined}
                  className={cn(
                    'flex items-center gap-3 px-5 py-2 text-sm font-medium cursor-pointer transition-colors',
                    active ? 'text-white' : 'text-slate-300 hover:bg-slate-800'
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {item.label}
                </div>
              </Link>
            );
          })}
        </nav>
        <div className="px-5 py-3 border-t border-slate-800 text-xs text-slate-400">
          {BRAND.rep}
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center px-6 gap-4 no-print">
          <GlobalSearch />
          <div className="ml-auto text-sm text-muted-foreground">
            {BRAND.region}
          </div>
        </header>
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
