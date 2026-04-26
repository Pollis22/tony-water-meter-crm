import { ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { LayoutDashboard, Building2, Users, Briefcase, Map, CheckSquare, StickyNote, BarChart3, Settings, Search, Droplets } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { useQuery } from '@tanstack/react-query';
import type { Account } from '@shared/schema';
import { useState } from 'react';

const NAV = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/accounts', label: 'Accounts', icon: Building2 },
  { href: '/contacts', label: 'Contacts', icon: Users },
  { href: '/opportunities', label: 'Opportunities', icon: Briefcase },
  { href: '/route-planner', label: 'Route Planner', icon: Map },
  { href: '/tasks', label: 'Tasks', icon: CheckSquare },
  { href: '/notes', label: 'Notes', icon: StickyNote },
  { href: '/reports', label: 'Reports', icon: BarChart3 },
  { href: '/settings', label: 'Settings', icon: Settings },
];

function GlobalSearch() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const { data: accounts = [] } = useQuery<Account[]>({ queryKey: ['/api/accounts'] });
  const filtered = q.length < 2 ? [] : accounts.filter(a =>
    a.name.toLowerCase().includes(q.toLowerCase()) ||
    a.county.toLowerCase().includes(q.toLowerCase()) ||
    (a.primaryContact || '').toLowerCase().includes(q.toLowerCase())
  ).slice(0, 8);

  return (
    <div className="relative w-full max-w-xl">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
      <Input
        data-testid="input-global-search"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search accounts, contacts, counties..."
        className="pl-9 bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700"
      />
      {open && filtered.length > 0 && (
        <div className="absolute top-full mt-1 w-full bg-popover border rounded-md shadow-lg z-50 overflow-hidden">
          {filtered.map(a => (
            <Link key={a.id} href={`/accounts/${a.id}`} onClick={() => { setQ(''); setOpen(false); }}>
              <div className="px-3 py-2 hover:bg-accent cursor-pointer flex items-center justify-between" data-testid={`search-result-${a.id}`}>
                <div>
                  <div className="font-medium text-sm">{a.name}</div>
                  <div className="text-xs text-muted-foreground">{a.county} County · {a.tier}</div>
                </div>
                <div className="text-xs text-muted-foreground">{a.primaryContact || '—'}</div>
              </div>
            </Link>
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
        <div className="px-5 py-4 border-b border-slate-800 flex items-center gap-2">
          <div className="w-8 h-8 rounded-md bg-blue-600 flex items-center justify-center">
            <Droplets className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="font-semibold text-sm leading-tight">Tony's Territory</div>
            <div className="text-xs text-slate-400">Water Meter CRM</div>
          </div>
        </div>
        <nav className="flex-1 py-3">
          {NAV.map(item => {
            const Icon = item.icon;
            const active = loc === item.href || (item.href !== '/' && loc.startsWith(item.href));
            return (
              <Link key={item.href} href={item.href}>
                <div
                  data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
                  className={cn(
                    'flex items-center gap-3 px-5 py-2 text-sm font-medium cursor-pointer transition-colors',
                    active ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800'
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
          Tony Robertson · East MI
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center px-6 gap-4 no-print">
          <GlobalSearch />
          <div className="ml-auto text-sm text-muted-foreground">
            EJP Sales · Michigan East
          </div>
        </header>
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
