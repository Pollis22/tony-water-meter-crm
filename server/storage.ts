import {
  accounts, contacts, tasks, notes, activities, opportunities, routes,
  type Account, type InsertAccount,
  type Contact, type InsertContact,
  type Task, type InsertTask,
  type Note, type InsertNote,
  type Activity, type InsertActivity,
  type Opportunity, type InsertOpportunity,
  type Route, type InsertRoute,
} from '@shared/schema';
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, desc, asc } from "drizzle-orm";
import fs from 'node:fs';
import path from 'node:path';
import { computeScore, SCORING_FIELDS, type ScoreInputs } from './scoring';

// Resolve the database location. Railway (or any host with a persistent
// volume) sets DB_PATH, e.g. /data/data.db; locally we fall back to ./data.db.
// Without this, the file lands in the ephemeral working directory and is
// wiped on every redeploy.
const dbPath = process.env.DB_PATH || "data.db";
fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");

// Apply schema (idempotent)
sqlite.exec(`
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  county TEXT NOT NULL,
  city TEXT NOT NULL,
  tier TEXT NOT NULL,
  population INTEGER NOT NULL DEFAULT 0,
  endpoints INTEGER NOT NULL DEFAULT 0,
  primary_contact TEXT,
  contact_title TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  city_state TEXT,
  entry_angle TEXT,
  candidate_score INTEGER NOT NULL DEFAULT 0,
  score_reasons TEXT,
  insight TEXT,
  current_meter_system TEXT,
  current_reading_method TEXT,
  opp_ami_amr INTEGER NOT NULL DEFAULT 0,
  opp_leak_detection INTEGER NOT NULL DEFAULT 0,
  opp_billing_accuracy INTEGER NOT NULL DEFAULT 0,
  opp_labor_savings INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Not Started',
  priority TEXT NOT NULL DEFAULT 'Medium',
  last_contacted_at TEXT,
  next_follow_up_at TEXT,
  notes TEXT,
  tags TEXT,
  water_budget_usd INTEGER,
  water_budget_fiscal_year TEXT,
  water_budget_type TEXT,
  water_budget_source TEXT,
  water_budget_notes TEXT,
  lat REAL,
  lng REAL,
  geo_source TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  title TEXT,
  phone TEXT,
  email TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER,
  title TEXT NOT NULL,
  description TEXT,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'Open',
  priority TEXT NOT NULL DEFAULT 'Medium',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  summary TEXT NOT NULL,
  outcome TEXT,
  metric_type TEXT,
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS opportunities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'Discovery',
  amount REAL,
  close_date TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS routes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  start_label TEXT,
  start_lat REAL,
  start_lng REAL,
  end_label TEXT,
  end_lat REAL,
  end_lng REAL,
  account_ids TEXT NOT NULL,
  ordered_ids TEXT,
  total_distance_km REAL,
  total_duration_sec REAL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

// Idempotent migrations for already-seeded databases (adds columns if missing)
function safeAddColumn(table: string, col: string, type: string) {
  try {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
  } catch (e: any) {
    // Column already exists — safe to ignore
    if (!String(e.message || e).includes('duplicate column')) throw e;
  }
}
safeAddColumn('accounts', 'water_budget_usd', 'INTEGER');
safeAddColumn('accounts', 'water_budget_fiscal_year', 'TEXT');
safeAddColumn('accounts', 'water_budget_type', 'TEXT');
safeAddColumn('accounts', 'water_budget_source', 'TEXT');
safeAddColumn('accounts', 'water_budget_notes', 'TEXT');
safeAddColumn('accounts', 'pinned', 'INTEGER NOT NULL DEFAULT 0');
safeAddColumn('activities', 'metric_type', 'TEXT');

// Repair rows where a drizzle string-literal default wrote 'CURRENT_TIMESTAMP'
// as text instead of a real timestamp (schema bug, fixed in shared/schema.ts).
// We can't recover the original times; stamping the repair moment keeps the
// rows valid and sortable. Runs at boot; no-ops once clean.
for (const [table, col] of [
  ['accounts', 'created_at'], ['contacts', 'created_at'], ['tasks', 'created_at'], ['notes', 'created_at'],
  ['opportunities', 'created_at'], ['routes', 'created_at'], ['activities', 'occurred_at'],
] as const) {
  try {
    const fixed = sqlite.prepare(`UPDATE ${table} SET ${col} = datetime('now') WHERE ${col} = 'CURRENT_TIMESTAMP'`).run();
    if (fixed.changes) console.log(`[migrate] ${table}.${col}: repaired ${fixed.changes} literal-timestamp row(s)`);
  } catch { /* table may not exist yet on a brand-new database */ }
}

export const db = drizzle(sqlite);

// ---------- Seed if empty ----------
function maybeSeed() {
  const count = sqlite.prepare("SELECT COUNT(*) as c FROM accounts").get() as { c: number };
  if (count.c > 0) return;
  // Find seed file
  const candidates = [
    path.resolve(process.cwd(), 'data/accounts.json'),
    path.resolve(process.cwd(), '../data/accounts.json'),
  ];
  let seedPath: string | null = null;
  for (const p of candidates) if (fs.existsSync(p)) { seedPath = p; break; }
  if (!seedPath) {
    console.warn('[seed] No data/accounts.json found, skipping seed');
    return;
  }
  const raw = JSON.parse(fs.readFileSync(seedPath, 'utf8')) as any[];
  console.log(`[seed] Seeding ${raw.length} accounts from ${seedPath}`);
  const insert = sqlite.prepare(`INSERT INTO accounts
    (name, county, city, tier, population, endpoints, primary_contact, contact_title,
     phone, email, address, city_state, entry_angle, candidate_score, score_reasons,
     insight, opp_ami_amr, opp_leak_detection, opp_billing_accuracy, opp_labor_savings,
     priority, lat, lng, geo_source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const txn = sqlite.transaction((rows: any[]) => {
    for (const r of rows) {
      const angle = (r.entryAngle || '').toLowerCase();
      const ami = angle.includes('ami') ? 1 : 0;
      const leak = angle.includes('leak') ? 1 : 0;
      const billing = angle.includes('billing') ? 1 : 0;
      const labor = angle.includes('labor') ? 1 : 0;
      const priority = r.tier === 'Tier 1' ? 'High' : r.tier === 'Tier 2' ? 'Medium' : 'Low';
      insert.run(
        r.city, r.county, r.city, r.tier, r.population, r.endpoints,
        r.contact, r.title, r.phone, r.email, r.address, r.cityState, r.entryAngle,
        r.score, JSON.stringify(r.scoreReasons || []), r.insight,
        ami, leak, billing, labor,
        priority, r.lat, r.lng, r.geoSource
      );
    }
  });
  txn(raw);
  console.log('[seed] Done');
}
maybeSeed();

// One-time catch-up: score any account that predates auto-scoring (manually
// added rows sit at 0 until something touches them). Runs at boot; no-ops
// once everything is scored.
function rescoreUnscored() {
  const unscored = db.select().from(accounts).all().filter((a) => !a.candidateScore);
  if (!unscored.length) return;
  const run = sqlite.transaction(() => {
    for (const a of unscored) {
      const { score, reasons } = computeScore(a as ScoreInputs);
      db.update(accounts)
        .set({ candidateScore: score, scoreReasons: JSON.stringify(reasons) } as any)
        .where(eq(accounts.id, a.id)).run();
    }
  });
  run();
  console.log(`[scoring] scored ${unscored.length} previously unscored account(s)`);
}
rescoreUnscored();

// ---------- Apply public-budget research (idempotent; only fills empty cells) ----------
function applyBudgets() {
  const candidates = [
    path.resolve(process.cwd(), 'data/water_budgets.json'),
    path.resolve(process.cwd(), '../data/water_budgets.json'),
  ];
  let p: string | null = null;
  for (const c of candidates) if (fs.existsSync(c)) { p = c; break; }
  if (!p) return;
  const data = JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, {
    usd: number | null; fiscalYear: string | null; type: string | null;
    source: string | null; notes: string | null;
  }>;
  const update = sqlite.prepare(`UPDATE accounts SET
    water_budget_usd = COALESCE(water_budget_usd, ?),
    water_budget_fiscal_year = COALESCE(water_budget_fiscal_year, ?),
    water_budget_type = COALESCE(water_budget_type, ?),
    water_budget_source = COALESCE(water_budget_source, ?),
    water_budget_notes = COALESCE(water_budget_notes, ?)
    WHERE name = ? AND water_budget_source IS NULL`);
  let applied = 0;
  const txn = sqlite.transaction(() => {
    for (const [name, b] of Object.entries(data)) {
      const r = update.run(b.usd, b.fiscalYear, b.type, b.source, b.notes, name);
      if (r.changes) applied += r.changes;
    }
  });
  txn();
  if (applied > 0) console.log(`[budgets] Applied research to ${applied} account(s)`);
}
applyBudgets();

// ---------- Storage ----------
export const storage = {
  // Accounts
  listAccounts(): Account[] {
    return db.select().from(accounts).orderBy(desc(accounts.candidateScore)).all();
  },
  getAccount(id: number): Account | undefined {
    return db.select().from(accounts).where(eq(accounts.id, id)).get();
  },
  createAccount(data: InsertAccount): Account {
    const values: any = { ...data };
    if (values.candidateScore == null || values.candidateScore === 0) {
      const { score, reasons } = computeScore(values as ScoreInputs);
      values.candidateScore = score;
      values.scoreReasons = JSON.stringify(reasons);
    }
    return db.insert(accounts).values(values).returning().get();
  },
  /**
   * Bulk account import. `creates` are inserted; `updates` patch existing rows
   * by id. All in one transaction — any failure rolls back the whole batch.
   */
  bulkUpsertAccounts(creates: InsertAccount[], updates: { id: number; data: Partial<InsertAccount> }[]): { created: number; updated: number } {
    const run = sqlite.transaction(() => {
      for (const c of creates) {
        const values: any = { ...c };
        if (values.candidateScore == null || values.candidateScore === 0) {
          const { score, reasons } = computeScore(values as ScoreInputs);
          values.candidateScore = score;
          values.scoreReasons = JSON.stringify(reasons);
        }
        db.insert(accounts).values(values).run();
      }
      for (const u of updates) {
        const patch: any = { ...u.data };
        if (patch.candidateScore == null && SCORING_FIELDS.some((f) => f in patch)) {
          const current = db.select().from(accounts).where(eq(accounts.id, u.id)).get();
          if (current) {
            const { score, reasons } = computeScore({ ...current, ...patch } as ScoreInputs);
            patch.candidateScore = score;
            patch.scoreReasons = JSON.stringify(reasons);
          }
        }
        db.update(accounts).set(patch).where(eq(accounts.id, u.id)).run();
      }
      return { created: creates.length, updated: updates.length };
    });
    return run();
  },
  // ---------- Backdated activity seeding (weekly tracker import) ----------
  /** Inserts activities with explicit occurred_at timestamps, in one transaction. */
  insertActivitiesBackdated(entries: {
    accountId: number; type: string; summary: string; outcome: string | null;
    metricType: string | null; occurredAt: string;
  }[]): number {
    const run = sqlite.transaction(() => {
      for (const e of entries) {
        db.insert(activities).values({
          accountId: e.accountId, type: e.type, summary: e.summary,
          outcome: e.outcome, metricType: e.metricType, occurredAt: e.occurredAt,
        } as any).run();
      }
      return entries.length;
    });
    return run();
  },
  /** Sets lastContactedAt only if the given date is newer than what's stored. */
  setLastContactedIfNewer(accountId: number, dateStr: string): void {
    const cur = this.getAccount(accountId);
    if (!cur) return;
    if (!cur.lastContactedAt || dateStr > cur.lastContactedAt) {
      db.update(accounts).set({ lastContactedAt: dateStr } as any).where(eq(accounts.id, accountId)).run();
    }
  },

  // ---------- My Top 5 (manual pin) ----------
  countPinned(): number {
    return (sqlite.prepare("SELECT COUNT(*) AS c FROM accounts WHERE pinned = 1").get() as { c: number }).c;
  },
  setPinned(id: number, pinned: boolean): Account | undefined {
    db.update(accounts).set({ pinned: pinned ? 1 : 0 } as any).where(eq(accounts.id, id)).run();
    return this.getAccount(id);
  },
  listPinned(): Account[] {
    return db.select().from(accounts).where(eq(accounts.pinned, 1)).orderBy(desc(accounts.candidateScore)).all();
  },

  updateAccount(id: number, data: Partial<InsertAccount>): Account | undefined {
    const patch: any = { ...data };
    const touchesScoring = SCORING_FIELDS.some((f) => f in patch);
    if (touchesScoring && patch.candidateScore == null) {
      const current = this.getAccount(id);
      if (current) {
        const { score, reasons } = computeScore({ ...current, ...patch } as ScoreInputs);
        patch.candidateScore = score;
        patch.scoreReasons = JSON.stringify(reasons);
      }
    }
    db.update(accounts).set(patch).where(eq(accounts.id, id)).run();
    return this.getAccount(id);
  },
  deleteAccount(id: number) {
    // Cascade delete: contacts, tasks, notes, activities, opportunities tied to this account
    db.delete(contacts).where(eq(contacts.accountId, id)).run();
    db.delete(tasks).where(eq(tasks.accountId, id)).run();
    db.delete(notes).where(eq(notes.accountId, id)).run();
    db.delete(activities).where(eq(activities.accountId, id)).run();
    db.delete(opportunities).where(eq(opportunities.accountId, id)).run();
    db.delete(accounts).where(eq(accounts.id, id)).run();
  },

  // Contacts
  listContacts(accountId?: number): Contact[] {
    if (accountId) return db.select().from(contacts).where(eq(contacts.accountId, accountId)).all();
    return db.select().from(contacts).all();
  },
  createContact(data: InsertContact): Contact {
    return db.insert(contacts).values(data).returning().get();
  },
  /** Inserts all rows in one SQLite transaction — if any insert fails, none are saved. */
  bulkCreateContacts(rows: InsertContact[]): number {
    const insertAll = sqlite.transaction((items: InsertContact[]) => {
      for (const item of items) {
        db.insert(contacts).values(item).run();
      }
      return items.length;
    });
    return insertAll(rows);
  },
  deleteContact(id: number) {
    db.delete(contacts).where(eq(contacts.id, id)).run();
  },

  // Tasks
  listTasks(accountId?: number): Task[] {
    if (accountId) return db.select().from(tasks).where(eq(tasks.accountId, accountId)).orderBy(asc(tasks.dueDate)).all();
    return db.select().from(tasks).orderBy(asc(tasks.dueDate)).all();
  },
  createTask(data: InsertTask): Task {
    return db.insert(tasks).values(data).returning().get();
  },
  updateTask(id: number, data: Partial<InsertTask>): Task | undefined {
    db.update(tasks).set(data).where(eq(tasks.id, id)).run();
    return db.select().from(tasks).where(eq(tasks.id, id)).get();
  },
  deleteTask(id: number) {
    db.delete(tasks).where(eq(tasks.id, id)).run();
  },

  // Notes
  listAllNotes(): Note[] {
    return db.select().from(notes).orderBy(desc(notes.id)).all();
  },
  listNotes(accountId: number): Note[] {
    return db.select().from(notes).where(eq(notes.accountId, accountId)).orderBy(desc(notes.createdAt)).all();
  },
  createNote(data: InsertNote): Note {
    return db.insert(notes).values(data).returning().get();
  },
  deleteNote(id: number) {
    db.delete(notes).where(eq(notes.id, id)).run();
  },

  // Activities
  listActivities(accountId: number): Activity[] {
    return db.select().from(activities).where(eq(activities.accountId, accountId)).orderBy(desc(activities.occurredAt)).all();
  },
  createActivity(data: InsertActivity): Activity {
    return db.insert(activities).values(data).returning().get();
  },

  // Opportunities
  listOpportunities(): Opportunity[] {
    return db.select().from(opportunities).orderBy(desc(opportunities.createdAt)).all();
  },
  createOpportunity(data: InsertOpportunity): Opportunity {
    return db.insert(opportunities).values(data).returning().get();
  },
  updateOpportunity(id: number, data: Partial<InsertOpportunity>): Opportunity | undefined {
    db.update(opportunities).set(data).where(eq(opportunities.id, id)).run();
    return db.select().from(opportunities).where(eq(opportunities.id, id)).get();
  },
  deleteOpportunity(id: number) {
    db.delete(opportunities).where(eq(opportunities.id, id)).run();
  },

  // Routes
  // ---------- Field workflow ----------
  /** Logs an activity and (optionally) bumps lastContactedAt / nextFollowUpAt in one transaction. */
  logTouch(accountId: number, opts: {
    type: string; summary: string; outcome: string | null;
    metricType?: string | null;
    nextFollowUpAt?: string | null; touch: boolean; today: string;
  }): { activity: Activity; account: Account } {
    const run = sqlite.transaction(() => {
      const activity = db.insert(activities)
        .values({
          accountId, type: opts.type, summary: opts.summary, outcome: opts.outcome,
          metricType: opts.metricType ?? null,
          // Explicit UTC stamp ("YYYY-MM-DD HH:MM:SS") — matches the format the
          // scorecard's range scan compares against.
          occurredAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
        } as any)
        .returning().get();
      const patch: Partial<InsertAccount> = {};
      if (opts.touch) patch.lastContactedAt = opts.today;
      if (opts.nextFollowUpAt !== undefined) patch.nextFollowUpAt = opts.nextFollowUpAt;
      const account = Object.keys(patch).length
        ? db.update(accounts).set(patch).where(eq(accounts.id, accountId)).returning().get()
        : db.select().from(accounts).where(eq(accounts.id, accountId)).get();
      return { activity, account: account! };
    });
    return run();
  },

  // ---------- Settings (key/value) ----------
  getSetting(key: string): string | null {
    const row = sqlite.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  },
  setSetting(key: string, value: string): void {
    sqlite.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  },

  /**
   * Counts logged metric occurrences per metric key within [startIso, endIso).
   * Bounds are computed by the caller in the user's local timezone, then passed
   * as ISO strings; occurred_at is compared lexicographically (ISO-8601 sorts
   * chronologically). Returns { metricKey: count }.
   */
  metricTally(startIso: string, endIso: string): Record<string, number> {
    const rows = sqlite.prepare(
      `SELECT metric_type AS k, COUNT(*) AS n FROM activities
       WHERE metric_type IS NOT NULL AND occurred_at >= ? AND occurred_at < ?
       GROUP BY metric_type`
    ).all(startIso, endIso) as { k: string; n: number }[];
    const out: Record<string, number> = {};
    for (const r of rows) out[r.k] = r.n;
    return out;
  },
  listAllActivities(): Activity[] {
    return db.select().from(activities).orderBy(desc(activities.id)).all();
  },
  /** LIKE-based search across every table. At this scale (one rep's book) it's instant and needs no FTS shadow tables. */
  searchAll(qRaw: string) {
    const q = `%${qRaw.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    const p = { q };
    const acc = sqlite.prepare(`
      SELECT id, name, county, tier, candidate_score AS score FROM accounts
      WHERE name LIKE @q ESCAPE '\\' OR county LIKE @q ESCAPE '\\' OR city LIKE @q ESCAPE '\\'
         OR primary_contact LIKE @q ESCAPE '\\' OR notes LIKE @q ESCAPE '\\' OR insight LIKE @q ESCAPE '\\'
      ORDER BY candidate_score DESC LIMIT 6`).all(p);
    const con = sqlite.prepare(`
      SELECT c.id, c.account_id AS accountId, c.name, c.title, c.email, a.name AS accountName
      FROM contacts c LEFT JOIN accounts a ON a.id = c.account_id
      WHERE c.name LIKE @q ESCAPE '\\' OR c.email LIKE @q ESCAPE '\\' OR c.title LIKE @q ESCAPE '\\'
      LIMIT 6`).all(p);
    const nts = sqlite.prepare(`
      SELECT n.id, n.account_id AS accountId, substr(n.body, 1, 90) AS snippet, a.name AS accountName
      FROM notes n LEFT JOIN accounts a ON a.id = n.account_id
      WHERE n.body LIKE @q ESCAPE '\\' ORDER BY n.id DESC LIMIT 6`).all(p);
    const act = sqlite.prepare(`
      SELECT v.id, v.account_id AS accountId, v.type, substr(v.summary, 1, 90) AS summary,
             v.occurred_at AS occurredAt, a.name AS accountName
      FROM activities v LEFT JOIN accounts a ON a.id = v.account_id
      WHERE v.summary LIKE @q ESCAPE '\\' OR v.outcome LIKE @q ESCAPE '\\'
      ORDER BY v.id DESC LIMIT 6`).all(p);
    const tks = sqlite.prepare(`
      SELECT t.id, t.account_id AS accountId, t.title, t.due_date AS dueDate, t.status, a.name AS accountName
      FROM tasks t LEFT JOIN accounts a ON a.id = t.account_id
      WHERE t.title LIKE @q ESCAPE '\\' OR t.description LIKE @q ESCAPE '\\'
      ORDER BY t.id DESC LIMIT 6`).all(p);
    const opp = sqlite.prepare(`
      SELECT o.id, o.account_id AS accountId, o.name, o.stage, a.name AS accountName
      FROM opportunities o LEFT JOIN accounts a ON a.id = o.account_id
      WHERE o.name LIKE @q ESCAPE '\\' OR o.stage LIKE @q ESCAPE '\\'
      ORDER BY o.id DESC LIMIT 6`).all(p);
    return { accounts: acc, contacts: con, notes: nts, activities: act, tasks: tks, opportunities: opp };
  },
  /** Consistent online snapshot of the live database (safe while the app is running). */
  async backupDatabase(dest: string): Promise<void> {
    await sqlite.backup(dest);
  },
  /**
   * Replaces the live database with an uploaded backup. Validates the file
   * first (expected tables + integrity check), keeps the current database as
   * `<db>.pre-restore.bak`, then swaps files. The caller MUST restart the
   * process afterwards — the live connection is closed by this call.
   */
  restoreDatabase(srcPath: string): { accounts: number } {
    const incoming = new Database(srcPath, { readonly: true, fileMustExist: true });
    let count: number;
    try {
      const tables = (incoming.prepare("select name from sqlite_master where type='table'").all() as { name: string }[])
        .map((r) => r.name);
      for (const t of ["accounts", "contacts", "activities", "tasks", "notes", "opportunities", "routes"]) {
        if (!tables.includes(t)) throw new Error(`That file isn't a Territory CRM backup (missing "${t}" table).`);
      }
      const check = incoming.prepare("pragma quick_check").get() as { quick_check?: string } | undefined;
      if (check?.quick_check !== "ok") throw new Error("Backup file failed the integrity check.");
      count = (incoming.prepare("select count(*) as c from accounts").get() as { c: number }).c;
    } finally {
      incoming.close();
    }
    // Swap: close the live handle, keep a safety copy, drop stale WAL/SHM, copy in.
    sqlite.close();
    const abs = path.resolve(dbPath);
    try { if (fs.existsSync(abs)) fs.copyFileSync(abs, abs + ".pre-restore.bak"); } catch { /* best effort */ }
    for (const suffix of ["-wal", "-shm"]) {
      try { fs.rmSync(abs + suffix, { force: true }); } catch { /* best effort */ }
    }
    fs.copyFileSync(srcPath, abs);
    return { accounts: count };
  },

  listRoutes(): Route[] {
    return db.select().from(routes).orderBy(desc(routes.createdAt)).all();
  },
  getRoute(id: number): Route | undefined {
    return db.select().from(routes).where(eq(routes.id, id)).get();
  },
  createRoute(data: InsertRoute): Route {
    return db.insert(routes).values(data).returning().get();
  },
  deleteRoute(id: number) {
    db.delete(routes).where(eq(routes.id, id)).run();
  },
};
