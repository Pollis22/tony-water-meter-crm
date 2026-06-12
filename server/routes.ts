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
    const a = storage.updateAccount(Number(req.params.id), req.body);
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
