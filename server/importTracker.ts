import * as XLSX from "xlsx";
import type { Account } from "@shared/schema";

// ---------------------------------------------------------------------------
// Parses Tony's "Weekly Accountability Tracker" workbook (one sheet per week).
// We import the detailed "Account Activity Log" section of each sheet — every
// row is a real account touch on a real date — and ignore the KPI summary grid
// at the top (it double-counts and doesn't trace to accounts).
//
// Output is a preview the user approves before any write. Commit then creates
// missing accounts and inserts the activities with BACKDATED timestamps so the
// scorecard's week/month/year views reflect the real history.
// ---------------------------------------------------------------------------

const YEAR = 2026; // sheets are May–June; stray cells confirm 2026

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

export interface TrackerRow {
  sheet: string;
  date: string;              // YYYY-MM-DD (resolved)
  rawDate: string;
  account: string;           // resolved display name
  rawAccount: string;
  contact: string | null;
  activityRaw: string;
  type: "visit" | "call" | "email" | "meeting" | "note";
  metricKey: string | null;  // scorecard metric, or null (logged but not counted)
  metricLabel: string | null;
  isNew: boolean;            // tracker's "New Account" flag
  match: "existing" | "create";
  existingId: number | null;
  skipped?: string;          // reason, if this row won't import
}

export interface TrackerParse {
  rows: TrackerRow[];
  summary: {
    importable: number;
    skipped: number;
    willCreate: string[];
    matched: number;
    byMetric: Record<string, number>;
    dateRange: { min: string; max: string } | null;
  };
  warnings: string[];
}

// ---------- name normalization & matching ----------

// Spelling fixes keyed on the loose form (lowercased, prefixes/periods stripped).
const CORRECTIONS: Record<string, string> = {
  "gross pointe": "grosse pointe",
  "gross pointe city": "grosse pointe",
  "gross pointe farms": "grosse pointe farms",
  "gross pointe shores": "grosse pointe shores",
  "gross pointe woods": "grosse pointe woods",
  "gross pointe park": "grosse pointe park",
  "hazek park": "hazel park",
  "plesant ridge": "pleasant ridge",
  "liviona": "livonia",
  "wayandotte": "wyandotte",
  "east pointe": "eastpointe",
  "hasting": "hastings",
  "ecores": "ecorse",
  "st clair shore": "st clair shores",
};

/** Loose key for matching: lowercase, drop "City of"/"Village of", drop periods, collapse spaces. */
function loose(name: string): string {
  let s = String(name || "").trim().toLowerCase();
  s = s.replace(/^city of\s+/, "").replace(/^village of\s+/, "");
  s = s.replace(/\./g, "").replace(/\s+/g, " ").trim();
  return CORRECTIONS[s] ?? s;
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------- date resolution ----------

/** Month a sheet belongs to, from its title (e.g. "May 11-16th" -> 5). */
function sheetMonth(title: string): number | null {
  const m = title.toLowerCase().match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/);
  return m ? MONTHS[m[1]] : null;
}

/**
 * Resolve a log row's date to YYYY-MM-DD. Excel may give a Date, a serial, or
 * text like "May 14th" / "MAY 21st" / "March 15th". If the parsed month differs
 * from the sheet's month (e.g. a "March 15th" row living in the May 11–16 sheet),
 * we snap the month to the sheet and keep the day — that's the mislabeled-row fix.
 */
function resolveDate(raw: unknown, monthOfSheet: number | null): { iso: string; rawText: string } | null {
  let day: number | null = null;
  let month: number | null = null;
  let rawText = "";

  if (raw instanceof Date && !isNaN(raw.getTime())) {
    month = raw.getMonth() + 1; day = raw.getDate(); rawText = raw.toISOString().slice(0, 10);
  } else if (typeof raw === "number" && raw > 30000 && raw < 60000) {
    const d = XLSX.SSF ? XLSX.SSF.parse_date_code(raw) : null;
    if (d) { month = d.m; day = d.d; rawText = `serial ${raw}`; }
  } else {
    rawText = String(raw ?? "").trim();
    if (!rawText) return null;
    const mm = rawText.toLowerCase().match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/);
    if (mm) month = MONTHS[mm[1]];
    const dm = rawText.match(/(\d{1,2})\s*(st|nd|rd|th)?\b/);
    if (dm) day = parseInt(dm[1], 10);
  }

  if (!day || day < 1 || day > 31) return null;
  // Snap to the sheet's month when the row's own month is missing or inconsistent.
  if (monthOfSheet && month !== monthOfSheet) month = monthOfSheet;
  if (!month) month = monthOfSheet ?? null;
  if (!month) return null;
  const iso = `${YEAR}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { iso, rawText };
}

// ---------- activity -> metric mapping ----------

function mapActivity(activityRaw: string): { type: TrackerRow["type"]; metricKey: string | null; metricLabel: string | null } {
  const a = activityRaw.toLowerCase();
  const has = (w: string) => a.includes(w);

  if (has("secondary")) return { type: "email", metricKey: "secondary_call", metricLabel: "Secondary Calls" };
  if (has("follow")) {
    return { type: has("email") || has("text") ? "email" : "visit", metricKey: "follow_up", metricLabel: "Follow-Ups" };
  }
  if (has("meeting") || has("appointment")) return { type: "meeting", metricKey: "meeting_set", metricLabel: "Meetings Set" };
  if (has("onsite") || has("on site") || has("on  site") || has("on sute") || has("support")) {
    return { type: "visit", metricKey: "face_to_face", metricLabel: "Face-to-Face Stops" };
  }
  if (has("text") || has("call") || has("phone")) return { type: "call", metricKey: null, metricLabel: null };
  // e.g. "Gate Closed", "They told me not interested", or blank — logged, not counted.
  return { type: "visit", metricKey: null, metricLabel: null };
}

const SKIP_ACCOUNT = /holiday|office day|training|^na\b|^n\/a\b/i;

// ---------- main parse ----------

export function parseTracker(buffer: Buffer, existing: Account[]): TrackerParse {
  const warnings: string[] = [];
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  } catch {
    return { rows: [], summary: { importable: 0, skipped: 0, willCreate: [], matched: 0, byMetric: {}, dateRange: null }, warnings: ["Could not read the workbook — is it a valid .xlsx?"] };
  }

  // Loose-name -> existing account.
  const byLoose = new Map<string, Account>();
  for (const a of existing) byLoose.set(loose(a.city || a.name), a);

  const rows: TrackerRow[] = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const grid = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, raw: true, defval: null }) as any[][];
    const mOfSheet = sheetMonth(sheetName);

    // Find the "Account Activity Log" header row (Date | Account | Contact | ...).
    let logStart = -1;
    for (let r = 0; r < grid.length; r++) {
      const c0 = String(grid[r]?.[0] ?? "").trim().toLowerCase();
      const c1 = String(grid[r]?.[1] ?? "").trim().toLowerCase();
      if (c0 === "date" && c1 === "account") { logStart = r + 1; break; }
    }
    if (logStart < 0) { warnings.push(`${sheetName}: no account activity log found — skipped.`); continue; }

    for (let r = logStart; r < grid.length; r++) {
      const row = grid[r] || [];
      const rawDate = row[0];
      const rawAccount = String(row[1] ?? "").trim();
      const contact = String(row[2] ?? "").trim() || null;
      const newFlag = String(row[3] ?? "").trim().toLowerCase();
      const activityRaw = String(row[4] ?? "").trim();

      if (!rawAccount && !activityRaw && rawDate == null) continue; // empty line
      const resolved = resolveDate(rawDate, mOfSheet);

      // Skip non-account rows (holidays, office/training days, blanks).
      if (!rawAccount || SKIP_ACCOUNT.test(rawAccount)) {
        if (rawAccount) rows.push(mkSkip(sheetName, resolved, rawAccount, "Not an account (holiday/office/training)"));
        continue;
      }
      if (!resolved) {
        rows.push(mkSkip(sheetName, null, rawAccount, "Date couldn't be read"));
        continue;
      }

      const lk = loose(rawAccount);
      const match = byLoose.get(lk);
      if (!match) {
        // Policy: tracker import never creates accounts. An unmatched name is
        // surfaced as a skip so it can be reviewed, not silently invented.
        rows.push(mkSkip(sheetName, resolved, rawAccount, "No matching account in the CRM"));
        continue;
      }
      const display = match.name;

      const { type, metricKey, metricLabel } = mapActivity(activityRaw);

      rows.push({
        sheet: sheetName,
        date: resolved.iso,
        rawDate: resolved.rawText,
        account: display,
        rawAccount,
        contact,
        activityRaw: activityRaw || "(no activity noted)",
        type, metricKey, metricLabel,
        isNew: newFlag === "yes" || newFlag === "new",
        match: "existing",
        existingId: match.id,
      });
    }
  }

  const importable = rows.filter((r) => !r.skipped);
  const byMetric: Record<string, number> = {};
  let min = "", max = "";
  for (const r of importable) {
    if (r.metricLabel) byMetric[r.metricLabel] = (byMetric[r.metricLabel] ?? 0) + 1;
    if (!min || r.date < min) min = r.date;
    if (!max || r.date > max) max = r.date;
  }

  return {
    rows,
    summary: {
      importable: importable.length,
      skipped: rows.length - importable.length,
      willCreate: [], // tracker import never creates accounts
      matched: importable.filter((r) => r.match === "existing").length,
      byMetric,
      dateRange: min ? { min, max } : null,
    },
    warnings,
  };
}

function mkSkip(sheet: string, resolved: { iso: string; rawText: string } | null, rawAccount: string, reason: string): TrackerRow {
  return {
    sheet, date: resolved?.iso ?? "", rawDate: resolved?.rawText ?? "", account: rawAccount, rawAccount,
    contact: null, activityRaw: "", type: "note", metricKey: null, metricLabel: null,
    isNew: false, match: "create", existingId: null, skipped: reason,
  };
}
