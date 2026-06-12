import type { Account } from '@shared/schema';

// All CRM dates are plain local-day strings (yyyy-mm-dd). Parse at noon to
// sidestep DST/UTC drift.
export const todayStr = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const parseDay = (s?: string | null): Date | null => {
  if (!s) return null;
  const m = s.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
};

export const addDaysStr = (base: string, days: number): string => {
  const d = parseDay(base) ?? new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Days from today until the given day. Negative = overdue, 0 = today, null = no date. */
export const daysUntil = (s?: string | null): number | null => {
  const d = parseDay(s);
  if (!d) return null;
  const t = parseDay(todayStr())!;
  return Math.round((d.getTime() - t.getTime()) / 86400000);
};

/** Days since the given day (e.g. lastContactedAt). null = never. */
export const daysSince = (s?: string | null): number | null => {
  const d = parseDay(s);
  if (!d) return null;
  const t = parseDay(todayStr())!;
  return Math.round((t.getTime() - d.getTime()) / 86400000);
};

export const fmtDay = (s?: string | null): string => {
  const d = parseDay(s);
  return d ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—';
};

export interface DueAccount {
  account: Account;
  days: number; // relative to today
}

export interface FollowUpBuckets {
  overdue: DueAccount[];
  today: DueAccount[];
  week: DueAccount[]; // next 7 days
}

export function followUpBuckets(accounts: Account[]): FollowUpBuckets {
  const overdue: DueAccount[] = [];
  const today: DueAccount[] = [];
  const week: DueAccount[] = [];
  for (const account of accounts) {
    const days = daysUntil(account.nextFollowUpAt);
    if (days == null) continue;
    if (days < 0) overdue.push({ account, days });
    else if (days === 0) today.push({ account, days });
    else if (days <= 7) week.push({ account, days });
  }
  const byUrgency = (a: DueAccount, b: DueAccount) =>
    a.days - b.days || b.account.candidateScore - a.account.candidateScore;
  overdue.sort(byUrgency);
  today.sort((a, b) => b.account.candidateScore - a.account.candidateScore);
  week.sort(byUrgency);
  return { overdue, today, week };
}

/** Accounts worth touching even without a follow-up date: live pipeline gone quiet. */
export function staleAccounts(accounts: Account[], openOppAccountIds: Set<number>, quietDays = 14): Account[] {
  const ACTIVE = new Set(['Contacted', 'Meeting Set', 'Proposal Sent', 'Nurture', 'Prospect']);
  return accounts
    .filter((a) => {
      const due = daysUntil(a.nextFollowUpAt);
      if (due != null && due <= 7) return false; // already in the week's queue
      const inPlay = openOppAccountIds.has(a.id) || ACTIVE.has(a.status);
      if (!inPlay) return false;
      const since = daysSince(a.lastContactedAt);
      return since == null || since >= quietDays;
    })
    .sort((a, b) => b.candidateScore - a.candidateScore);
}
