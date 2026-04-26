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

const sqlite = new Database("data.db");
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
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
    return db.insert(accounts).values(data as any).returning().get();
  },
  updateAccount(id: number, data: Partial<InsertAccount>): Account | undefined {
    db.update(accounts).set(data as any).where(eq(accounts.id, id)).run();
    return this.getAccount(id);
  },
  deleteAccount(id: number) {
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
