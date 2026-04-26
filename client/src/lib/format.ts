export const fmtNum = (n: number | null | undefined) =>
  n == null ? '—' : Number(n).toLocaleString();

export const fmtMoney = (n: number | null | undefined) =>
  n == null ? '—' : `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export const tierColor: Record<string, string> = {
  'Tier 1': 'bg-blue-900 text-white',
  'Tier 2': 'bg-blue-600 text-white',
  'Tier 3': 'bg-blue-300 text-blue-950',
};
export const tierBorderColor: Record<string, string> = {
  'Tier 1': 'border-blue-900',
  'Tier 2': 'border-blue-600',
  'Tier 3': 'border-blue-300',
};

export const priorityColor: Record<string, string> = {
  High: 'bg-red-100 text-red-900 border-red-300 dark:bg-red-900/30 dark:text-red-200',
  Medium: 'bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-900/30 dark:text-amber-200',
  Low: 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300',
};

export const statusColor: Record<string, string> = {
  'Not Started': 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  Researching: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-200',
  Contacted: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200',
  'Meeting Set': 'bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-200',
  'Proposal Sent': 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200',
  Won: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200',
  Lost: 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-200',
  Nurture: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-200',
};

export const STATUSES = ['Not Started', 'Researching', 'Contacted', 'Meeting Set', 'Proposal Sent', 'Won', 'Lost', 'Nurture'] as const;
export const PRIORITIES = ['High', 'Medium', 'Low'] as const;
export const TIERS = ['Tier 1', 'Tier 2', 'Tier 3'] as const;

export function scoreColor(score: number) {
  if (score >= 80) return 'text-emerald-600 dark:text-emerald-400 font-semibold';
  if (score >= 60) return 'text-blue-600 dark:text-blue-400 font-semibold';
  if (score >= 40) return 'text-amber-600 dark:text-amber-400';
  return 'text-slate-500';
}

export function fmtDuration(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m} min`;
}

export function fmtKm(m: number) {
  const mi = m / 1609.344;
  return `${mi.toFixed(1)} mi`;
}
