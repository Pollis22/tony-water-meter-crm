import type { Express, Request, Response, NextFunction } from "express";
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import multer from "multer";
import { z } from "zod";
import * as XLSX from "xlsx";
import os from "node:os";
import nodePath from "node:path";
import nodeFs from "node:fs";
import { storage } from "./storage";
import { parseContactFiles, MAX_IMPORT_ROWS } from "./importContacts";
import { parseAccountFiles } from "./importAccounts";
import { parseTracker } from "./importTracker";
import { METRICS, METRIC_KEYS, DEFAULT_DAILY_TARGETS, PERIOD_MULTIPLIER } from "@shared/metrics";
import type { Account } from "@shared/schema";
import {
  insertAccountSchema, insertContactSchema, insertTaskSchema,
  insertNoteSchema, insertActivitySchema, insertOpportunitySchema, insertRouteSchema,
} from "@shared/schema";

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  // ---------- Accounts ----------
  app.get("/api/accounts", (_req, res) => {
    res.json(storage.listAccounts());
  });
  app.get("/api/accounts/:id", (req, res) => {
    const a = storage.getAccount(Number(req.params.id));
    if (!a) return res.status(404).json({ error: "Not found" });
    res.json(a);
  });
  app.post("/api/accounts", (req, res) => {
    const parsed = insertAccountSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    res.json(storage.createAccount(parsed.data));
  });
  app.patch("/api/accounts/:id", (req, res) => {
    const parsed = insertAccountSchema.partial().strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const a = storage.updateAccount(Number(req.params.id), parsed.data);
    if (!a) return res.status(404).json({ error: "Not found" });
    res.json(a);
  });

  // My Top 5 — Tony's manual focus list. Pinning is capped at 5; the cap is
  // enforced server-side so it holds no matter where the request comes from.
  const MAX_PINNED = 5;
  app.post("/api/accounts/:id/pin", (req, res) => {
    const id = Number(req.params.id);
    const pinned = Boolean(req.body?.pinned);
    if (pinned && storage.countPinned() >= MAX_PINNED) {
      const current = storage.getAccount(id);
      if (!current?.pinned) {
        return res.status(409).json({ error: `Top 5 is full — unpin one first.`, max: MAX_PINNED });
      }
    }
    const a = storage.setPinned(id, pinned);
    if (!a) return res.status(404).json({ error: "Not found" });
    res.json(a);
  });
  app.delete("/api/accounts/:id", (req, res) => {
    storage.deleteAccount(Number(req.params.id));
    res.json({ ok: true });
  });

  // ---------- Contacts ----------
  app.get("/api/contacts", (req, res) => {
    const accountId = req.query.accountId ? Number(req.query.accountId) : undefined;
    res.json(storage.listContacts(accountId));
  });
  app.post("/api/contacts", (req, res) => {
    const p = insertContactSchema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: p.error.flatten() });
    res.json(storage.createContact(p.data));
  });
  app.delete("/api/contacts/:id", (req, res) => {
    storage.deleteContact(Number(req.params.id));
    res.json({ ok: true });
  });

  // ---------- Bulk contact import ----------
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 5 }, // 10 MB each, max 5 files
  });
  // Wrap multer so its errors (file too large, too many files) come back as
  // friendly 400s instead of falling through to the global 500 handler.
  const uploadFiles = (req: Request, res: Response, next: NextFunction) => {
    upload.array("files", 5)(req, res, (err: any) => {
      if (err) {
        const msg =
          err.code === "LIMIT_FILE_SIZE" ? "Each file must be 10 MB or smaller." :
          err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE" ? "Upload up to 5 files at a time." :
          "Could not read the uploaded files.";
        return res.status(400).json({ error: msg });
      }
      next();
    });
  };

  app.post("/api/contacts/import/parse", uploadFiles, async (req, res) => {
    try {
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      if (!files.length) return res.status(400).json({ error: "No files uploaded." });
      const result = await parseContactFiles(
        files.map((f) => ({ name: f.originalname, buffer: f.buffer })),
        storage.listAccounts(),
        storage.listContacts(),
      );
      res.json(result);
    } catch (e: any) {
      console.error("[import/parse]", e);
      res.status(422).json({ error: "Could not read files." });
    }
  });

  const importCommitSchema = z.object({
    contacts: z.array(z.object({
      accountId: z.number().int().positive(),
      name: z.string().trim().min(1, "Name is required"),
      title: z.string().nullish(),
      email: z.string().nullish(),
      phone: z.string().nullish(),
      notes: z.string().nullish(),
    })).min(1).max(MAX_IMPORT_ROWS),
  });

  app.post("/api/contacts/import/commit", (req, res) => {
    const parsed = importCommitSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    // Validate every account id before touching the database — all rows or none.
    const validIds = new Set(storage.listAccounts().map((a) => a.id));
    const unknown = parsed.data.contacts.filter((c) => !validIds.has(c.accountId));
    if (unknown.length) {
      return res.status(400).json({
        error: `${unknown.length} row(s) reference an account that doesn't exist. Nothing was saved.`,
      });
    }
    try {
      const inserted = storage.bulkCreateContacts(parsed.data.contacts.map((c) => ({
        accountId: c.accountId,
        name: c.name,
        title: c.title?.trim() || null,
        email: c.email?.trim() || null,
        phone: c.phone?.trim() || null,
        notes: c.notes?.trim() || null,
      })));
      res.json({ inserted });
    } catch (e: any) {
      console.error("[import/commit]", e);
      res.status(500).json({ error: "Import failed — nothing was saved." });
    }
  });

  // ---------- Account bulk import ----------
  app.post("/api/accounts/import/parse", uploadFiles, async (req, res) => {
    try {
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      if (!files.length) return res.status(400).json({ error: "No files uploaded." });
      const result = await parseAccountFiles(
        files.map((f) => ({ name: f.originalname, buffer: f.buffer })),
        storage.listAccounts(),
      );
      res.json(result);
    } catch (e: any) {
      console.error("[accounts/import/parse]", e);
      res.status(422).json({ error: "Could not read files." });
    }
  });

  const accountImportSchema = z.object({
    accounts: z.array(z.object({
      // null id = create; positive id = update existing
      id: z.number().int().positive().nullable().optional(),
      name: z.string().trim().min(1, "Name is required"),
      county: z.string().nullish(),
      city: z.string().nullish(),
      tier: z.string().nullish(),
      population: z.number().int().nonnegative().nullish(),
      endpoints: z.number().int().nonnegative().nullish(),
      primaryContact: z.string().nullish(),
      contactTitle: z.string().nullish(),
      phone: z.string().nullish(),
      email: z.string().nullish(),
      address: z.string().nullish(),
      cityState: z.string().nullish(),
      status: z.string().nullish(),
      priority: z.string().nullish(),
      waterBudgetUsd: z.number().int().nullish(),
      insight: z.string().nullish(),
    })).min(1).max(MAX_IMPORT_ROWS),
  });

  app.post("/api/accounts/import/commit", (req, res) => {
    const parsed = accountImportSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const validIds = new Set(storage.listAccounts().map((a) => a.id));
    // Index existing names so a "create" can't silently duplicate an account.
    const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const existingNames = new Map<string, number>();
    for (const a of storage.listAccounts()) existingNames.set(normName(a.name), a.id);

    const creates: any[] = [];
    const updates: { id: number; data: any }[] = [];

    for (const a of parsed.data.accounts) {
      // Required-by-schema columns that the importer may not supply get sane defaults.
      const fields = {
        name: a.name.trim(),
        county: a.county?.trim() || "",
        city: a.city?.trim() || a.name.trim(),
        tier: a.tier?.trim() || "Tier 3",
        population: a.population ?? 0,
        endpoints: a.endpoints ?? 0,
        primaryContact: a.primaryContact?.trim() || null,
        contactTitle: a.contactTitle?.trim() || null,
        phone: a.phone?.trim() || null,
        email: a.email?.trim() || null,
        address: a.address?.trim() || null,
        cityState: a.cityState?.trim() || null,
        status: a.status?.trim() || "Not Started",
        priority: a.priority?.trim() || "Medium",
        waterBudgetUsd: a.waterBudgetUsd ?? null,
        insight: a.insight?.trim() || null,
      };
      if (a.id != null) {
        if (!validIds.has(a.id)) {
          return res.status(400).json({ error: `Row references account #${a.id}, which doesn't exist. Nothing was saved.` });
        }
        updates.push({ id: a.id, data: fields });
      } else {
        // Reject a create that would duplicate an existing account name — the
        // client should have sent it as an update or skipped it.
        const clash = existingNames.get(normName(fields.name));
        if (clash != null) {
          return res.status(400).json({
            error: `"${fields.name}" already exists. Uncheck it or switch it to "Update existing". Nothing was saved.`,
          });
        }
        creates.push(fields);
      }
    }

    try {
      const result = storage.bulkUpsertAccounts(creates, updates);
      res.json(result);
    } catch (e: any) {
      console.error("[accounts/import/commit]", e);
      res.status(500).json({ error: "Import failed — nothing was saved." });
    }
  });

  // ---------- Field workflow: quick log, search, backup ----------
  const localDay = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  const logSchema = z.object({
    type: z.enum(["call", "email", "meeting", "visit", "note"]),
    outcome: z.string().trim().max(120).optional(),
    note: z.string().trim().max(4000).optional(),
    metricType: z.enum(METRIC_KEYS as [string, ...string[]]).nullable().optional(),
    // null clears the follow-up; omitted leaves it untouched
    nextFollowUpAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  });
  const DEFAULT_SUMMARY: Record<string, string> = {
    call: "Call logged", email: "Email sent", meeting: "Meeting held", visit: "Site visit", note: "Note",
  };

  app.post("/api/accounts/:id/log", (req, res) => {
    const id = Number(req.params.id);
    const account = storage.getAccount(id);
    if (!account) return res.status(404).json({ error: "Account not found" });
    const parsed = logSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const b = parsed.data;
    const summary = b.note?.trim()
      ? (b.outcome ? `${b.outcome} — ${b.note.trim()}` : b.note.trim())
      : (b.outcome || DEFAULT_SUMMARY[b.type]);
    try {
      const result = storage.logTouch(id, {
        type: b.type,
        summary: summary.slice(0, 4000),
        outcome: b.outcome ?? null,
        metricType: b.metricType ?? null,
        nextFollowUpAt: "nextFollowUpAt" in req.body ? b.nextFollowUpAt : undefined,
        touch: b.type !== "note", // plain notes don't count as contacting the account
        today: localDay(),
      });
      res.json(result);
    } catch (e) {
      console.error("[log]", e);
      res.status(500).json({ error: "Could not save the log entry." });
    }
  });

  // ---------- Scorecard ----------
  const TARGETS_KEY = "scorecard_daily_targets";
  const getDailyTargets = (): Record<string, number> => {
    const raw = storage.getSetting(TARGETS_KEY);
    if (raw) {
      try { return { ...DEFAULT_DAILY_TARGETS, ...JSON.parse(raw) }; } catch { /* fall through */ }
    }
    return { ...DEFAULT_DAILY_TARGETS };
  };

  // Tally counts for a period. The client passes start/end as ISO instants it
  // computed in the user's local timezone (so "today" means Tony's day).
  app.get("/api/scorecard", (req, res) => {
    const start = String(req.query.start ?? "");
    const end = String(req.query.end ?? "");
    const period = String(req.query.period ?? "day");
    if (!start || !end) return res.status(400).json({ error: "start and end are required (ISO instants)." });
    const counts = storage.metricTally(start, end);
    const daily = getDailyTargets();
    const mult = (PERIOD_MULTIPLIER as Record<string, number>)[period] ?? 1;
    const metrics = METRICS.map((m) => ({
      key: m.key,
      label: m.label,
      actual: counts[m.key] ?? 0,
      target: Math.round((daily[m.key] ?? m.target) * mult),
    }));
    res.json({ period, metrics });
  });

  app.get("/api/scorecard/targets", (_req, res) => {
    res.json({ daily: getDailyTargets() });
  });

  const targetsSchema = z.object({
    daily: z.record(z.enum(METRIC_KEYS as [string, ...string[]]), z.number().int().min(0).max(100)),
  });
  app.put("/api/scorecard/targets", (req, res) => {
    const parsed = targetsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const merged = { ...getDailyTargets(), ...parsed.data.daily };
    storage.setSetting(TARGETS_KEY, JSON.stringify(merged));
    res.json({ daily: merged });
  });

  app.get("/api/search", (req, res) => {
    const q = String(req.query.q ?? "").trim();
    if (q.length < 2) {
      return res.json({ accounts: [], contacts: [], notes: [], activities: [], tasks: [], opportunities: [] });
    }
    res.json(storage.searchAll(q.slice(0, 80)));
  });

  app.get("/api/backup/database", async (_req, res) => {
    const tmp = nodePath.join(os.tmpdir(), `tony-crm-${Date.now()}.db`);
    try {
      await storage.backupDatabase(tmp);
      res.download(tmp, `tony-crm-backup-${localDay()}.db`, () => nodeFs.unlink(tmp, () => {}));
    } catch (e) {
      console.error("[backup]", e);
      nodeFs.unlink(tmp, () => {});
      res.status(500).json({ error: "Backup failed." });
    }
  });

  app.get("/api/backup/export.xlsx", (_req, res) => {
    try {
      const wb = XLSX.utils.book_new();
      const add = (name: string, rows: object[]) =>
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{}]), name);
      add("Accounts", storage.listAccounts());
      add("Contacts", storage.listContacts());
      add("Activities", storage.listAllActivities());
      add("Tasks", storage.listTasks());
      add("Notes", storage.listAllNotes());
      add("Opportunities", storage.listOpportunities());
      add("Routes", storage.listRoutes());
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="tony-crm-export-${localDay()}.xlsx"`);
      res.send(buf);
    } catch (e) {
      console.error("[export]", e);
      res.status(500).json({ error: "Export failed." });
    }
  });

  // Restore: upload a .db backup and swap it in. The process intentionally
  // restarts afterwards so better-sqlite3 reopens the restored file; Railway's
  // restart policy brings the service back in seconds.
  const restoreUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024, files: 1 },
  });
  app.post("/api/backup/restore", (req: Request, res: Response, next: NextFunction) => {
    restoreUpload.single("file")(req, res, (err: any) => {
      if (err) {
        const msg = err.code === "LIMIT_FILE_SIZE" ? "Backup file must be 50 MB or smaller." : "Could not read the uploaded file.";
        return res.status(400).json({ error: msg });
      }
      next();
    });
  }, (req, res) => {
    const f = (req as any).file as Express.Multer.File | undefined;
    if (!f) return res.status(400).json({ error: "No backup file uploaded." });
    const tmp = nodePath.join(os.tmpdir(), `tony-crm-restore-${Date.now()}.db`);
    try {
      nodeFs.writeFileSync(tmp, f.buffer);
      const info = storage.restoreDatabase(tmp);
      nodeFs.unlink(tmp, () => {});
      res.json({ ok: true, accounts: info.accounts, restarting: true });
      // Give the response time to flush, then exit so the platform restarts us
      // and better-sqlite3 reopens the restored database file.
      setTimeout(() => {
        console.log("[restore] database replaced — restarting to load it");
        process.exit(1);
      }, 500);
    } catch (e: any) {
      nodeFs.unlink(tmp, () => {});
      console.error("[restore]", e);
      // If the live connection was already closed mid-swap, the process is in a
      // bad state regardless; the error path before close() is the common one.
      res.status(400).json({ error: String(e?.message ?? "Restore failed — the database was not changed.") });
    }
  });

  // ---------- Weekly tracker import (backdated activity history) ----------
  const trackerUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 1 } });

  app.post("/api/import/tracker/parse", (req: Request, res: Response, next: NextFunction) => {
    trackerUpload.single("file")(req, res, (err: any) => {
      if (err) return res.status(400).json({ error: err.code === "LIMIT_FILE_SIZE" ? "File must be 15 MB or smaller." : "Could not read the upload." });
      next();
    });
  }, (req, res) => {
    const f = (req as any).file as Express.Multer.File | undefined;
    if (!f) return res.status(400).json({ error: "No file uploaded." });
    try {
      const result = parseTracker(f.buffer, storage.listAccounts());
      res.json(result);
    } catch (e: any) {
      console.error("[tracker parse]", e);
      res.status(400).json({ error: String(e?.message ?? "Could not parse the tracker.") });
    }
  });

  const trackerCommitSchema = z.object({
    rows: z.array(z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      account: z.string().min(1),
      existingId: z.number().int().nullable().optional(),
      contact: z.string().nullable().optional(),
      type: z.enum(["visit", "call", "email", "meeting", "note"]),
      metricType: z.string().nullable().optional(),
      summary: z.string().min(1),
    })).min(1).max(2000),
  });

  app.post("/api/import/tracker/commit", (req, res) => {
    const parsed = trackerCommitSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const looseKey = (s: string) =>
      s.trim().toLowerCase().replace(/^city of\s+/, "").replace(/^village of\s+/, "").replace(/\./g, "").replace(/\s+/g, " ").trim();

    // Resolve each row to an account id, creating accounts as needed (once each).
    const accountsByKey = new Map<string, Account>();
    for (const a of storage.listAccounts()) accountsByKey.set(looseKey(a.city || a.name), a);

    let matched = 0;
    const unmatched = new Set<string>();

    // Match only — tracker import never creates accounts. Unmatched rows are
    // reported back and contribute nothing.
    const idForRow = (account: string, existingId: number | null | undefined): number | null => {
      if (existingId) { const a = storage.getAccount(existingId); if (a) { matched++; return a.id; } }
      const hit = accountsByKey.get(looseKey(account));
      if (hit) { matched++; return hit.id; }
      unmatched.add(account);
      return null;
    };

    const entries: Parameters<typeof storage.insertActivitiesBackdated>[0] = [];
    const maxDateByAccount = new Map<number, string>();
    const metricLabels: Record<string, string> = {
      face_to_face: "Face-to-Face Stop", real_conversation: "Real Conversation",
      follow_up: "Follow-Up", secondary_call: "Secondary Call", meeting_set: "Meeting Set",
    };

    let skipped = 0;
    for (const r of parsed.data.rows) {
      const accountId = idForRow(r.account, r.existingId ?? null);
      if (accountId == null) { skipped++; continue; }
      const occurredAt = `${r.date} 12:00:00`; // noon UTC keeps the calendar day in Eastern time
      const outcome = r.metricType ? (metricLabels[r.metricType] ?? null) : null;
      entries.push({ accountId, type: r.type, summary: r.summary, outcome, metricType: r.metricType ?? null, occurredAt });
      const prev = maxDateByAccount.get(accountId);
      if (!prev || r.date > prev) maxDateByAccount.set(accountId, r.date);
    }

    const inserted = storage.insertActivitiesBackdated(entries);
    for (const [accountId, date] of Array.from(maxDateByAccount)) storage.setLastContactedIfNewer(accountId, date);

    res.json({ inserted, accountsMatched: matched, skipped, unmatched: Array.from(unmatched).sort() });
  });

  // ---------- Tasks ----------
  app.get("/api/tasks", (req, res) => {
    const accountId = req.query.accountId ? Number(req.query.accountId) : undefined;
    res.json(storage.listTasks(accountId));
  });
  app.post("/api/tasks", (req, res) => {
    const p = insertTaskSchema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: p.error.flatten() });
    res.json(storage.createTask(p.data));
  });
  app.patch("/api/tasks/:id", (req, res) => {
    const t = storage.updateTask(Number(req.params.id), req.body);
    if (!t) return res.status(404).json({ error: "Not found" });
    res.json(t);
  });
  app.delete("/api/tasks/:id", (req, res) => {
    storage.deleteTask(Number(req.params.id));
    res.json({ ok: true });
  });

  // ---------- Notes ----------
  app.get("/api/notes", (req, res) => {
    const accountId = req.query.accountId ? Number(req.query.accountId) : undefined;
    res.json(accountId ? storage.listNotes(accountId) : storage.listAllNotes());
  });
  app.post("/api/notes", (req, res) => {
    const p = insertNoteSchema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: p.error.flatten() });
    res.json(storage.createNote(p.data));
  });
  app.delete("/api/notes/:id", (req, res) => {
    storage.deleteNote(Number(req.params.id));
    res.json({ ok: true });
  });

  // ---------- Activities ----------
  app.get("/api/activities", (req, res) => {
    const accountId = Number(req.query.accountId);
    if (!accountId) return res.status(400).json({ error: "accountId required" });
    res.json(storage.listActivities(accountId));
  });
  app.post("/api/activities", (req, res) => {
    const p = insertActivitySchema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: p.error.flatten() });
    res.json(storage.createActivity(p.data));
  });

  // ---------- Opportunities ----------
  app.get("/api/opportunities", (_req, res) => res.json(storage.listOpportunities()));
  app.post("/api/opportunities", (req, res) => {
    const p = insertOpportunitySchema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: p.error.flatten() });
    res.json(storage.createOpportunity(p.data));
  });
  app.patch("/api/opportunities/:id", (req, res) => {
    const o = storage.updateOpportunity(Number(req.params.id), req.body);
    if (!o) return res.status(404).json({ error: "Not found" });
    res.json(o);
  });
  app.delete("/api/opportunities/:id", (req, res) => {
    storage.deleteOpportunity(Number(req.params.id));
    res.json({ ok: true });
  });

  // ---------- Routes (saved) ----------
  app.get("/api/routes", (_req, res) => res.json(storage.listRoutes()));
  app.get("/api/routes/:id", (req, res) => {
    const r = storage.getRoute(Number(req.params.id));
    if (!r) return res.status(404).json({ error: "Not found" });
    res.json(r);
  });
  app.post("/api/routes", (req, res) => {
    const p = insertRouteSchema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: p.error.flatten() });
    res.json(storage.createRoute(p.data));
  });
  app.delete("/api/routes/:id", (req, res) => {
    storage.deleteRoute(Number(req.params.id));
    res.json({ ok: true });
  });

  // ---------- Route optimization (OSRM trip service) ----------
  // Body: { coords: [[lng,lat], ...], roundTrip: bool, fixedStart: bool, fixedEnd: bool }
  app.post("/api/optimize-route", async (req, res) => {
    try {
      const { coords, roundTrip = false, fixedStart = true, fixedEnd = false } = req.body;
      if (!Array.isArray(coords) || coords.length < 2) {
        return res.status(400).json({ error: "Need at least 2 coordinates" });
      }
      if (coords.length > 100) {
        return res.status(400).json({ error: "OSRM trip limit is ~100 stops" });
      }
      const coordStr = coords.map((c: number[]) => `${c[0]},${c[1]}`).join(";");
      const params = new URLSearchParams({
        source: fixedStart ? "first" : "any",
        destination: fixedEnd ? "last" : "any",
        roundtrip: roundTrip ? "true" : "false",
        overview: "full",
        geometries: "geojson",
      });
      const url = `https://router.project-osrm.org/trip/v1/driving/${coordStr}?${params.toString()}`;
      const r = await fetch(url);
      if (!r.ok) {
        const text = await r.text();
        return res.status(502).json({ error: "OSRM error", detail: text });
      }
      const data: any = await r.json();
      if (data.code !== "Ok") return res.status(502).json({ error: data.message || "OSRM failed" });
      // Reorder: data.waypoints[i].waypoint_index gives the position in the trip
      const orderedIndices = data.waypoints
        .map((w: any, i: number) => ({ orig: i, pos: w.waypoint_index }))
        .sort((a: any, b: any) => a.pos - b.pos)
        .map((x: any) => x.orig);
      const trip = data.trips[0];
      res.json({
        order: orderedIndices, // indices into the original coords array, in optimized order
        distanceMeters: trip.distance,
        durationSec: trip.duration,
        geometry: trip.geometry, // GeoJSON LineString
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---------- Reports ----------
  app.get("/api/reports/summary", (_req, res) => {
    const all = storage.listAccounts();
    const byTier: Record<string, number> = {};
    const byCounty: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    let totalEndpoints = 0;
    for (const a of all) {
      byTier[a.tier] = (byTier[a.tier] || 0) + 1;
      byCounty[a.county] = (byCounty[a.county] || 0) + 1;
      byStatus[a.status] = (byStatus[a.status] || 0) + 1;
      totalEndpoints += a.endpoints || 0;
    }
    res.json({
      total: all.length,
      totalEndpoints,
      byTier, byCounty, byStatus,
      topByEndpoints: [...all].sort((a, b) => b.endpoints - a.endpoints).slice(0, 10),
      topByScore: [...all].sort((a, b) => b.candidateScore - a.candidateScore).slice(0, 10),
      upcomingFollowUps: all.filter(a => a.nextFollowUpAt).sort((a, b) => (a.nextFollowUpAt || '').localeCompare(b.nextFollowUpAt || '')).slice(0, 10),
    });
  });

  return httpServer;
}
