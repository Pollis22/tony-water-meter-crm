import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'wouter';
import type { Account, Contact } from '@shared/schema';
import { apiRequest } from '@/lib/queryClient';
import { fmtMoney, fmtNum, scoreColor } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Droplets, Printer } from 'lucide-react';

function parseSourceLinks(src?: string | null): { title: string; url: string }[] {
  if (!src) return [];
  return Array.from(src.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)).map((m) => ({ title: m[1], url: m[2] }));
}

export default function Brief() {
  const { id } = useParams<{ id: string }>();
  const accountId = Number(id);
  const { data: account, isLoading } = useQuery<Account>({ queryKey: ['/api/accounts', accountId] });
  const { data: contacts = [] } = useQuery<Contact[]>({
    queryKey: ['/api/contacts', accountId],
    queryFn: async () => (await apiRequest('GET', `/api/contacts?accountId=${accountId}`)).json(),
  });

  if (isLoading || !account) return <div className="p-8">Loading…</div>;

  const reasons: string[] = (() => { try { return JSON.parse(account.scoreReasons || '[]'); } catch { return []; } })();
  const links = parseSourceLinks(account.waterBudgetSource);
  const angles = [
    account.oppAmiAmr ? 'AMI / AMR' : null,
    account.oppLeakDetection ? 'Leak detection' : null,
    account.oppBillingAccuracy ? 'Billing accuracy' : null,
    account.oppLaborSavings ? 'Labor savings' : null,
  ].filter(Boolean) as string[];
  const today = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

  const Stat = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
    <div className="rounded-md border border-slate-200 p-3">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-base font-semibold text-slate-900">{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );

  return (
    <div className="p-6 max-w-[850px] mx-auto print-page">
      {/* Controls — hidden when printing */}
      <div className="no-print mb-4 flex items-center justify-between">
        <Link href={`/accounts/${account.id}`}>
          <span className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground cursor-pointer">
            <ArrowLeft className="w-4 h-4" /> Back to account
          </span>
        </Link>
        <Button onClick={() => window.print()} data-testid="button-print-brief">
          <Printer className="w-4 h-4 mr-1" /> Print / Save PDF
        </Button>
      </div>

      {/* The brief itself — forced light so the printout is consistent */}
      <div className="bg-white text-slate-900 rounded-lg border border-slate-200 p-8 print:border-0 print:p-0 print:rounded-none" data-testid="brief-page">
        {/* Brand bar */}
        <div className="flex items-center justify-between border-b border-slate-200 pb-3 mb-5">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-blue-600 flex items-center justify-center">
              <Droplets className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="font-semibold text-sm leading-tight">EJP Sales · Pre-Call Brief</div>
              <div className="text-xs text-slate-500">Tony Robertson · East Michigan territory</div>
            </div>
          </div>
          <div className="text-xs text-slate-500">{today}</div>
        </div>

        {/* Account header */}
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h1 className="text-2xl font-semibold">{account.name}</h1>
            <div className="text-sm text-slate-500 mt-0.5">
              {account.county} County{account.cityState ? ` · ${account.cityState}` : ''} · {account.tier} · {account.priority} priority · {account.status}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-[11px] uppercase tracking-wide text-slate-500">Candidate score</div>
            <div className={`text-3xl font-bold ${scoreColor(account.candidateScore)}`}>{account.candidateScore}</div>
          </div>
        </div>

        {/* Key stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <Stat label="Population" value={fmtNum(account.population)} />
          <Stat label="Est. endpoints" value={fmtNum(account.endpoints)} sub="metered connections" />
          <Stat
            label="Water budget"
            value={account.waterBudgetUsd != null ? fmtMoney(account.waterBudgetUsd) : 'Unknown'}
            sub={[account.waterBudgetFiscalYear, account.waterBudgetType].filter(Boolean).join(' · ') || undefined}
          />
          <Stat label="Current system" value={account.currentMeterSystem || 'Unknown'} sub={account.currentReadingMethod || undefined} />
        </div>

        {/* Angle */}
        <div className="mb-5">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Entry angle</div>
          <div className="text-sm font-medium">{account.entryAngle || '—'}</div>
          {angles.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {angles.map((a) => (
                <Badge key={a} variant="outline" className="border-blue-300 text-blue-800 bg-blue-50">{a}</Badge>
              ))}
            </div>
          )}
        </div>

        {/* Why this account */}
        {reasons.length > 0 && (
          <div className="mb-5">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Why this account</div>
            <ul className="text-sm space-y-1 list-disc pl-5">
              {reasons.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          </div>
        )}

        {/* Talk track */}
        {account.insight && (
          <div className="mb-5">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Talk track</div>
            <p className="text-sm leading-relaxed">{account.insight}</p>
          </div>
        )}

        {/* Budget intel */}
        {(account.waterBudgetNotes || links.length > 0) && (
          <div className="mb-5">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Budget intel</div>
            {account.waterBudgetNotes && <p className="text-sm leading-relaxed mb-1.5">{account.waterBudgetNotes}</p>}
            {links.length > 0 && (
              <ul className="text-xs text-slate-500 space-y-0.5">
                {links.map((l, i) => (
                  <li key={i}>
                    <a className="text-blue-700 hover:underline" href={l.url} target="_blank" rel="noreferrer">{l.title}</a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Contacts */}
        <div className="mb-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Contacts</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
            <div className="rounded-md border border-slate-200 p-3">
              <div className="font-medium">{account.primaryContact || 'No named contact yet'}</div>
              <div className="text-xs text-slate-500">{account.contactTitle || '—'}</div>
              <div className="text-xs mt-1">{account.phone || ''}</div>
              <div className="text-xs">{account.email || ''}</div>
              {account.address && <div className="text-xs text-slate-500 mt-1">{account.address}{account.cityState ? `, ${account.cityState}` : ''}</div>}
            </div>
            {contacts.slice(0, 3).map((c) => (
              <div key={c.id} className="rounded-md border border-slate-200 p-3">
                <div className="font-medium">{c.name}</div>
                <div className="text-xs text-slate-500">{c.title || '—'}</div>
                <div className="text-xs mt-1">{c.phone || ''}</div>
                <div className="text-xs">{c.email || ''}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-slate-200 mt-5 pt-3 text-[11px] text-slate-400">
          Prepared {today} · Tony's Territory CRM · Internal use
        </div>
      </div>
    </div>
  );
}
