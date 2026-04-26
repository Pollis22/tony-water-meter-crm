import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ---------- Accounts ----------
export const accounts = sqliteTable("accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(), // municipality / city
  county: text("county").notNull(),
  city: text("city").notNull(),
  tier: text("tier").notNull(), // "Tier 1" | "Tier 2" | "Tier 3"
  population: integer("population").notNull().default(0),
  endpoints: integer("endpoints").notNull().default(0),
  primaryContact: text("primary_contact"),
  contactTitle: text("contact_title"),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  cityState: text("city_state"),
  entryAngle: text("entry_angle"),
  candidateScore: integer("candidate_score").notNull().default(0),
  scoreReasons: text("score_reasons"), // JSON array
  insight: text("insight"), // sales insight
  // Meter / opportunity flags
  currentMeterSystem: text("current_meter_system"),
  currentReadingMethod: text("current_reading_method"),
  oppAmiAmr: integer("opp_ami_amr").notNull().default(0), // bool
  oppLeakDetection: integer("opp_leak_detection").notNull().default(0),
  oppBillingAccuracy: integer("opp_billing_accuracy").notNull().default(0),
  oppLaborSavings: integer("opp_labor_savings").notNull().default(0),
  // CRM fields
  status: text("status").notNull().default("Not Started"),
  priority: text("priority").notNull().default("Medium"),
  lastContactedAt: text("last_contacted_at"),
  nextFollowUpAt: text("next_follow_up_at"),
  notes: text("notes"),
  tags: text("tags"), // JSON array
  // Geo
  lat: real("lat"),
  lng: real("lng"),
  geoSource: text("geo_source"),
  createdAt: text("created_at").notNull().default("CURRENT_TIMESTAMP"),
});

export const insertAccountSchema = createInsertSchema(accounts).omit({ id: true, createdAt: true });
export type InsertAccount = z.infer<typeof insertAccountSchema>;
export type Account = typeof accounts.$inferSelect;

// ---------- Contacts (extra contacts beyond primary) ----------
export const contacts = sqliteTable("contacts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accountId: integer("account_id").notNull(),
  name: text("name").notNull(),
  title: text("title"),
  phone: text("phone"),
  email: text("email"),
  notes: text("notes"),
  createdAt: text("created_at").notNull().default("CURRENT_TIMESTAMP"),
});
export const insertContactSchema = createInsertSchema(contacts).omit({ id: true, createdAt: true });
export type InsertContact = z.infer<typeof insertContactSchema>;
export type Contact = typeof contacts.$inferSelect;

// ---------- Tasks / Follow-ups ----------
export const tasks = sqliteTable("tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accountId: integer("account_id"),
  title: text("title").notNull(),
  description: text("description"),
  dueDate: text("due_date"),
  status: text("status").notNull().default("Open"), // Open | Done
  priority: text("priority").notNull().default("Medium"),
  createdAt: text("created_at").notNull().default("CURRENT_TIMESTAMP"),
});
export const insertTaskSchema = createInsertSchema(tasks).omit({ id: true, createdAt: true });
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Task = typeof tasks.$inferSelect;

// ---------- Notes ----------
export const notes = sqliteTable("notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accountId: integer("account_id").notNull(),
  body: text("body").notNull(),
  createdAt: text("created_at").notNull().default("CURRENT_TIMESTAMP"),
});
export const insertNoteSchema = createInsertSchema(notes).omit({ id: true, createdAt: true });
export type InsertNote = z.infer<typeof insertNoteSchema>;
export type Note = typeof notes.$inferSelect;

// ---------- Activities (timeline) ----------
export const activities = sqliteTable("activities", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accountId: integer("account_id").notNull(),
  type: text("type").notNull(), // call | email | meeting | visit | status_change | note
  summary: text("summary").notNull(),
  outcome: text("outcome"),
  occurredAt: text("occurred_at").notNull().default("CURRENT_TIMESTAMP"),
});
export const insertActivitySchema = createInsertSchema(activities).omit({ id: true, occurredAt: true });
export type InsertActivity = z.infer<typeof insertActivitySchema>;
export type Activity = typeof activities.$inferSelect;

// ---------- Opportunities ----------
export const opportunities = sqliteTable("opportunities", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accountId: integer("account_id").notNull(),
  name: text("name").notNull(),
  stage: text("stage").notNull().default("Discovery"), // Discovery | Qualification | Proposal | Negotiation | Closed Won | Closed Lost
  amount: real("amount"),
  closeDate: text("close_date"),
  notes: text("notes"),
  createdAt: text("created_at").notNull().default("CURRENT_TIMESTAMP"),
});
export const insertOpportunitySchema = createInsertSchema(opportunities).omit({ id: true, createdAt: true });
export type InsertOpportunity = z.infer<typeof insertOpportunitySchema>;
export type Opportunity = typeof opportunities.$inferSelect;

// ---------- Saved Routes ----------
export const routes = sqliteTable("routes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  startLabel: text("start_label"),
  startLat: real("start_lat"),
  startLng: real("start_lng"),
  endLabel: text("end_label"),
  endLat: real("end_lat"),
  endLng: real("end_lng"),
  accountIds: text("account_ids").notNull(), // JSON array of ints
  orderedIds: text("ordered_ids"), // JSON array of ints (optimized order)
  totalDistanceKm: real("total_distance_km"),
  totalDurationSec: real("total_duration_sec"),
  createdAt: text("created_at").notNull().default("CURRENT_TIMESTAMP"),
});
export const insertRouteSchema = createInsertSchema(routes).omit({ id: true, createdAt: true });
export type InsertRoute = z.infer<typeof insertRouteSchema>;
export type Route = typeof routes.$inferSelect;
