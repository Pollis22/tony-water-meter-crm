import type { Express } from "express";
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { storage } from "./storage";
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
