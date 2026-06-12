import * as XLSX from "xlsx";
import type { Account } from "@shared/schema";

// ---------------------------------------------------------------------------
// Bulk ACCOUNT import: parses XLSX / XLS / CSV / PDF buffers into preview rows
// for new (or updatable) accounts. Pure functions — no DB access.
//
// Mirrors the philosophy of importContacts.ts: recognize headers by alias,
// fall back to content inference for headerless sheets, normalize messy values
// (tiers, populations, budgets), and flag rows that collide with accounts that
// already exist so the rep can choose create-new vs skip.
// ---------------------------------------------------------------------------

export const MAX_IMPORT_ROWS = 500;

export interface ParsedAccountRow {
  name: string;            // municipality / city (required)
  county: string | null;
  city: string | null;
  state: string | null;
  tier: string | null;     // normalized to "Tier 1|2|3"
  population: number | null;
  endpoints: number | null;
  primaryContact: string | null;
  contactTitle: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  status: string | null;   // normalized to a known status or null
  priority: string | null; // High | Medium | Low or null
  waterBudgetUsd: number | null;
  insight: string | null;
  /** An existing account this row appears to duplicate (same name/city). */
  existingId: number | null;
  duplicate: boolean;
  duplicateReason: string | null;
  sourceFile: string;
}

export interface AccountParseResult {
  rows: ParsedAccountRow[];
  truncated: boolean;
  warnings: string[];
}

export interface UploadedFile {
  name: string;
  buffer: Buffer;
}

// ---------- text helpers ----------

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_RE = /(?:\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}(?!\d)/;
const ZIP_RE = /\b\d{5}(?:-\d{4})?\b/;
// 2-letter US state, optionally preceded by a comma, near end of an address
const STATE_RE = /\b(A[LKZR]|C[AOT]|D[EC]|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|N[CDEHJMVY]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[AT]|W[AIVY])\b/;

const TITLE_WORDS = [
  "director", "manager", "superintendent", "supervisor", "clerk", "operator",
  "foreman", "engineer", "administrator", "treasurer", "mayor", "coordinator",
  "commissioner", "chief", "president", "technician", "analyst", "assistant",
];

function clean(v: unknown): string {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
function stripMuni(s: string): string {
  return norm(s)
    .replace(/\b(charter township of|township of|village of|city of|charter twp|charter township|township|twp|village|city)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function looksLikeTitle(s: string): boolean {
  const low = s.toLowerCase();
  return TITLE_WORDS.some((w) => low.includes(w));
}
function looksLikePersonName(s: string): boolean {
  if (!s || s.length > 60) return false;
  if (EMAIL_RE.test(s) || PHONE_RE.test(s) || /\d/.test(s)) return false;
  const words = s.split(/\s+/);
  return words.length >= 2 && words.length <= 4 && /^[A-Z]/.test(s);
}

/** Parse "12,345" / "12k" / "$1.2M" / "1,200,000" into an integer. */
function parseIntLoose(v: string): number | null {
  const s = clean(v).toLowerCase().replace(/[$,\s]/g, "");
  if (!s) return null;
  const m = s.match(/^(\d+(?:\.\d+)?)([km])?$/);
  if (!m) {
    const digits = s.replace(/[^\d]/g, "");
    return digits ? parseInt(digits, 10) : null;
  }
  let n = parseFloat(m[1]);
  if (m[2] === "k") n *= 1_000;
  else if (m[2] === "m") n *= 1_000_000;
  return Math.round(n);
}

const KNOWN_STATUSES = ["Not Started", "Researching", "Contacted", "Meeting Set", "Proposal Sent", "Won", "Lost", "Nurture", "Prospect", "Customer", "Dead"];
function normStatus(v: string): string | null {
  const n = norm(v);
  if (!n) return null;
  const hit = KNOWN_STATUSES.find((s) => norm(s) === n);
  return hit ?? null;
}
function normPriority(v: string): string | null {
  const n = norm(v);
  if (["high", "hi", "h", "urgent", "1"].includes(n)) return "High";
  if (["medium", "med", "m", "normal", "2"].includes(n)) return "Medium";
  if (["low", "lo", "l", "3"].includes(n)) return "Low";
  return null;
}
function normTier(v: string): string | null {
  const n = norm(v);
  if (!n) return null;
  if (/(tier\s*)?1|one|strategic|a\b/.test(n)) return "Tier 1";
  if (/(tier\s*)?2|two|b\b/.test(n)) return "Tier 2";
  if (/(tier\s*)?3|three|c\b/.test(n)) return "Tier 3";
  return null;
}

// ---------- existing-account index (for dupe detection) ----------

function buildExistingIndex(accounts: Account[]) {
  const byName = new Map<string, number>();
  const byStripped = new Map<string, number>();
  for (const a of accounts) {
    for (const raw of [a.name, a.city]) {
      if (!raw) continue;
      const n = norm(raw);
      if (n && !byName.has(n)) byName.set(n, a.id);
      const st = stripMuni(raw);
      if (st && !byStripped.has(st)) byStripped.set(st, a.id);
    }
  }
  return {
    find(name: string): number | null {
      const n = norm(name);
      if (byName.has(n)) return byName.get(n)!;
      const st = stripMuni(name);
      if (st && byStripped.has(st)) return byStripped.get(st)!;
      return null;
    },
  };
}

// ---------- raw record ----------

type Field =
  | "name" | "county" | "city" | "state" | "tier" | "population" | "endpoints"
  | "primaryContact" | "contactTitle" | "phone" | "email" | "address"
  | "status" | "priority" | "waterBudgetUsd" | "insight";

interface RawAccount {
  name: string;
  county: string | null;
  city: string | null;
  state: string | null;
  tier: string | null;
  population: number | null;
  endpoints: number | null;
  primaryContact: string | null;
  contactTitle: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  status: string | null;
  priority: string | null;
  waterBudgetUsd: number | null;
  insight: string | null;
  sourceFile: string;
}

function emptyRaw(sourceFile: string): RawAccount {
  return {
    name: "", county: null, city: null, state: null, tier: null,
    population: null, endpoints: null, primaryContact: null, contactTitle: null,
    phone: null, email: null, address: null, status: null, priority: null,
    waterBudgetUsd: null, insight: null, sourceFile,
  };
}
function hasSubstance(r: RawAccount): boolean {
  return !!(r.name || r.city || r.primaryContact || r.email);
}

// ---------- header aliases ----------

const HEADER_ALIASES: Record<string, Field> = {
  // name / municipality
  "name": "name", "account": "name", "account name": "name", "municipality": "name",
  "city name": "name", "town": "name", "utility": "name", "organization": "name", "agency": "name",
  // geography
  "county": "county", "parish": "county", "borough": "county",
  "city": "city", "city/town": "city",
  "state": "state", "st": "state", "province": "state",
  // classification
  "tier": "tier", "segment": "tier", "category": "tier", "class": "tier",
  "status": "status", "stage": "status",
  "priority": "priority", "prio": "priority",
  // size
  "population": "population", "pop": "population", "residents": "population", "service population": "population",
  "endpoints": "endpoints", "meters": "endpoints", "connections": "endpoints",
  "accounts": "endpoints", "service connections": "endpoints", "meter count": "endpoints",
  "estimated endpoints": "endpoints", "est endpoints": "endpoints",
  // contact
  "contact": "primaryContact", "primary contact": "primaryContact", "contact name": "primaryContact",
  "decision maker": "primaryContact",
  "title": "contactTitle", "contact title": "contactTitle", "job title": "contactTitle", "position": "contactTitle", "role": "contactTitle",
  "phone": "phone", "phone number": "phone", "telephone": "phone", "tel": "phone", "office phone": "phone", "direct": "phone",
  "email": "email", "e-mail": "email", "email address": "email",
  "address": "address", "street": "address", "street address": "address", "mailing address": "address", "location": "address",
  // money / notes
  "water budget": "waterBudgetUsd", "budget": "waterBudgetUsd", "annual budget": "waterBudgetUsd",
  "water budget usd": "waterBudgetUsd", "utility budget": "waterBudgetUsd",
  "insight": "insight", "notes": "insight", "note": "insight", "comments": "insight", "description": "insight", "summary": "insight",
};

function detectHeaderMap(row: string[]): Map<number, Field> | null {
  const map = new Map<number, Field>();
  row.forEach((cell, i) => {
    const key = norm(cell);
    if (key && HEADER_ALIASES[key] && !Array.from(map.values()).includes(HEADER_ALIASES[key])) {
      map.set(i, HEADER_ALIASES[key]);
    }
  });
  const fields = new Set(map.values());
  // Trust headers if we found the name column plus at least one more, or >=2 known columns.
  if (fields.has("name") || map.size >= 2) return map.size > 0 ? map : null;
  return null;
}

/** Infer columns from content when headers aren't recognized. */
function inferColumns(rows: string[][], existing: ReturnType<typeof buildExistingIndex>): Map<number, Field> {
  const width = Math.max(0, ...rows.map((r) => r.length));
  const map = new Map<number, Field>();
  const taken = new Set<Field>();
  const assign = (i: number, f: Field) => { if (!map.has(i) && !taken.has(f)) { map.set(i, f); taken.add(f); } };

  interface Col { i: number; n: number; email: number; phone: number; title: number; person: number; muni: number; num: number; numAvg: number; }
  const cols: Col[] = [];
  for (let i = 0; i < width; i++) {
    let n = 0, email = 0, phone = 0, title = 0, person = 0, muni = 0, num = 0, numSum = 0;
    for (const r of rows) {
      const v = clean(r[i]);
      if (!v) continue;
      n++;
      if (EMAIL_RE.test(v)) { email++; continue; }
      if (PHONE_RE.test(v)) { phone++; continue; }
      const asNum = parseIntLoose(v);
      if (asNum != null && /\d/.test(v) && !/[a-z]{3,}/i.test(v)) { num++; numSum += asNum; }
      if (looksLikeTitle(v)) title++;
      if (looksLikePersonName(v)) person++;
      if (existing.find(v)) muni++;
    }
    cols.push({ i, n, email, phone, title, person, muni, num, numAvg: num ? numSum / num : 0 });
  }

  for (const c of cols) if (c.n && c.email / c.n > 0.5) assign(c.i, "email");
  for (const c of cols) if (c.n && c.phone / c.n > 0.5) assign(c.i, "phone");
  for (const c of cols) if (c.n && !map.has(c.i) && c.title / c.n > 0.3) assign(c.i, "contactTitle");
  for (const c of cols) if (c.n && !map.has(c.i) && c.person / c.n > 0.4) assign(c.i, "primaryContact");
  // Municipality/name: the column whose values most match existing account names,
  // else the first text column.
  const muniCand = cols.filter((c) => !map.has(c.i) && c.n > 0).sort((a, b) => b.muni - a.muni)[0];
  if (muniCand && muniCand.muni > 0) assign(muniCand.i, "name");
  // Two numeric columns: larger average = population, smaller = endpoints (heuristic).
  const numCols = cols.filter((c) => !map.has(c.i) && c.num / Math.max(1, c.n) > 0.6).sort((a, b) => b.numAvg - a.numAvg);
  if (numCols[0]) assign(numCols[0].i, "population");
  if (numCols[1]) assign(numCols[1].i, "endpoints");
  // Fallback name: first unassigned text-ish column.
  if (!taken.has("name")) {
    const textCand = cols.filter((c) => !map.has(c.i) && c.n > 0 && c.num / Math.max(1, c.n) < 0.5)[0];
    if (textCand) assign(textCand.i, "name");
  }
  return map;
}

function rowsToAccounts(rows: string[][], map: Map<number, Field>, sourceFile: string): RawAccount[] {
  const colFor = new Map<Field, number>();
  map.forEach((field, i) => { if (!colFor.has(field)) colFor.set(field, i); });
  const get = (r: string[], f: Field) => {
    const i = colFor.get(f);
    return i == null ? "" : clean(r[i]);
  };
  const out: RawAccount[] = [];
  for (const r of rows) {
    const rec = emptyRaw(sourceFile);
    rec.name = get(r, "name");
    rec.county = get(r, "county") || null;
    rec.city = get(r, "city") || null;
    rec.state = get(r, "state") || null;
    rec.tier = normTier(get(r, "tier"));
    rec.population = parseIntLoose(get(r, "population"));
    rec.endpoints = parseIntLoose(get(r, "endpoints"));
    rec.primaryContact = get(r, "primaryContact") || null;
    rec.contactTitle = get(r, "contactTitle") || null;
    rec.phone = get(r, "phone") || null;
    const em = get(r, "email");
    rec.email = (em.match(EMAIL_RE)?.[0] ?? em) || null;
    rec.address = get(r, "address") || null;
    rec.status = normStatus(get(r, "status"));
    rec.priority = normPriority(get(r, "priority"));
    rec.waterBudgetUsd = parseIntLoose(get(r, "waterBudgetUsd"));
    rec.insight = get(r, "insight") || null;
    // If no explicit city column, default city to the account name (municipality).
    if (!rec.city && rec.name) rec.city = rec.name;
    if (hasSubstance(rec)) out.push(rec);
  }
  return out;
}

function parseSpreadsheet(buffer: Buffer, sourceFile: string, warnings: string[], existing: ReturnType<typeof buildExistingIndex>): RawAccount[] {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: "buffer" });
  } catch {
    warnings.push(`${sourceFile}: could not be read as a spreadsheet — skipped.`);
    return [];
  }
  const out: RawAccount[] = [];
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    const grid = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: "" }) as string[][];
    const rows = grid.map((r) => r.map(clean)).filter((r) => r.some(Boolean));
    if (!rows.length) continue;
    const headerMap = detectHeaderMap(rows[0]);
    if (headerMap) {
      out.push(...rowsToAccounts(rows.slice(1), headerMap, sourceFile));
    } else {
      const inferred = inferColumns(rows, existing);
      if (inferred.size === 0) {
        warnings.push(`${sourceFile}${wb.SheetNames.length > 1 ? ` (${sheetName})` : ""}: no recognizable account columns — skipped.`);
        continue;
      }
      out.push(...rowsToAccounts(rows, inferred, sourceFile));
    }
  }
  return out;
}

// ---------- PDF parsing (labeled blocks) ----------

const PDF_LABELS: Record<string, Field> = {
  name: "name", account: "name", municipality: "name", city: "city", town: "name", utility: "name",
  county: "county", state: "state", tier: "tier", status: "status", priority: "priority",
  population: "population", pop: "population", endpoints: "endpoints", meters: "endpoints", connections: "endpoints",
  contact: "primaryContact", title: "contactTitle", position: "contactTitle", role: "contactTitle",
  phone: "phone", tel: "phone", telephone: "phone", email: "email", address: "address",
  budget: "waterBudgetUsd", notes: "insight", note: "insight",
};
const PDF_LABEL_RE = /\b(name|account|municipality|city|town|utility|county|state|tier|status|priority|population|pop|endpoints|meters|connections|contact|title|position|role|phone|tel|telephone|e-?mail|address|budget|notes?)\s*[:\-–]\s*/gi;

function assignPdf(rec: RawAccount, field: Field, value: string) {
  switch (field) {
    case "name": if (!rec.name) rec.name = value; break;
    case "city": rec.city = rec.city ?? value; break;
    case "county": rec.county = rec.county ?? value; break;
    case "state": rec.state = rec.state ?? value; break;
    case "tier": rec.tier = rec.tier ?? normTier(value); break;
    case "status": rec.status = rec.status ?? normStatus(value); break;
    case "priority": rec.priority = rec.priority ?? normPriority(value); break;
    case "population": rec.population = rec.population ?? parseIntLoose(value); break;
    case "endpoints": rec.endpoints = rec.endpoints ?? parseIntLoose(value); break;
    case "primaryContact": rec.primaryContact = rec.primaryContact ?? value; break;
    case "contactTitle": rec.contactTitle = rec.contactTitle ?? value; break;
    case "phone": rec.phone = rec.phone ?? (value.match(PHONE_RE)?.[0] ?? value); break;
    case "email": rec.email = rec.email ?? (value.match(EMAIL_RE)?.[0] ?? value); break;
    case "address": rec.address = rec.address ?? value; break;
    case "waterBudgetUsd": rec.waterBudgetUsd = rec.waterBudgetUsd ?? parseIntLoose(value); break;
    case "insight": rec.insight = rec.insight ?? value; break;
  }
}

function pdfLabeledPass(text: string, sourceFile: string): RawAccount[] {
  const matches = Array.from(text.matchAll(PDF_LABEL_RE));
  if (!matches.length) return [];
  const out: RawAccount[] = [];
  let cur: RawAccount | null = null;
  const flush = () => { if (cur && hasSubstance(cur)) out.push(cur); cur = null; };
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const key = m[1].toLowerCase().replace("e-mail", "email");
    const field = PDF_LABELS[key] ?? PDF_LABELS[key.replace(/s$/, "")];
    if (!field) continue;
    const start = m.index! + m[0].length;
    const nextLabel = i + 1 < matches.length ? matches[i + 1].index! : text.length;
    const lineEnd = text.indexOf("\n", start);
    const end = Math.min(nextLabel, lineEnd === -1 ? text.length : lineEnd);
    const value = clean(text.slice(start, end)).slice(0, 160);
    if (field === "name") {
      if (cur && (cur.name || cur.city || cur.email)) flush();
      cur = cur ?? emptyRaw(sourceFile);
      cur.name = value;
    } else {
      cur = cur ?? emptyRaw(sourceFile);
      assignPdf(cur, field, value);
    }
  }
  flush();
  return out;
}

async function parsePdf(buffer: Buffer, sourceFile: string, warnings: string[]): Promise<RawAccount[]> {
  let text = "";
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const res = await extractText(pdf, { mergePages: true });
    text = Array.isArray(res.text) ? res.text.join("\n") : String(res.text ?? "");
  } catch {
    warnings.push(`${sourceFile}: PDF could not be read — skipped.`);
    return [];
  }
  if (!clean(text)) {
    warnings.push(`${sourceFile}: no extractable text (scanned image?) — skipped.`);
    return [];
  }
  const rows = pdfLabeledPass(text, sourceFile);
  if (!rows.length) warnings.push(`${sourceFile}: no labeled account fields found in the PDF.`);
  return rows;
}

// ---------- finalize ----------

function finalize(raws: RawAccount[], accounts: Account[]): { rows: ParsedAccountRow[]; truncated: boolean } {
  const existing = buildExistingIndex(accounts);
  const seenInBatch = new Map<string, number>(); // normalized name -> first index
  const rows: ParsedAccountRow[] = [];
  let truncated = false;

  for (const r of raws) {
    if (rows.length >= MAX_IMPORT_ROWS) { truncated = true; break; }
    const name = clean(r.name) || clean(r.city || "");
    if (!name) continue;

    const existingId = existing.find(name);
    let duplicate = false;
    let duplicateReason: string | null = null;
    if (existingId != null) {
      duplicate = true;
      duplicateReason = "An account with this name already exists";
    }
    const key = norm(name);
    if (seenInBatch.has(key)) {
      duplicate = true;
      duplicateReason = "Repeated in this file";
    } else {
      seenInBatch.set(key, rows.length);
    }

    // Try to split "City, ST" out of an address or state cell.
    let state = r.state;
    if (!state && r.address) state = r.address.match(STATE_RE)?.[0] ?? null;

    rows.push({
      name,
      county: r.county,
      city: r.city ?? name,
      state,
      tier: r.tier,
      population: r.population,
      endpoints: r.endpoints,
      primaryContact: r.primaryContact,
      contactTitle: r.contactTitle,
      phone: r.phone,
      email: r.email,
      address: r.address,
      status: r.status,
      priority: r.priority,
      waterBudgetUsd: r.waterBudgetUsd,
      insight: r.insight,
      existingId,
      duplicate,
      duplicateReason,
      sourceFile: r.sourceFile,
    });
  }
  return { rows, truncated };
}

export async function parseAccountFiles(files: UploadedFile[], accounts: Account[]): Promise<AccountParseResult> {
  const warnings: string[] = [];
  const existing = buildExistingIndex(accounts);
  const raws: RawAccount[] = [];

  for (const f of files) {
    const ext = (f.name.split(".").pop() ?? "").toLowerCase();
    try {
      if (ext === "pdf") {
        raws.push(...(await parsePdf(f.buffer, f.name, warnings)));
      } else if (["xlsx", "xls", "csv"].includes(ext)) {
        raws.push(...parseSpreadsheet(f.buffer, f.name, warnings, existing));
      } else {
        warnings.push(`${f.name}: unsupported file type — skipped.`);
      }
    } catch (e) {
      warnings.push(`${f.name}: could not be processed — skipped.`);
    }
  }

  const { rows, truncated } = finalize(raws, accounts);
  if (!rows.length && !warnings.length) {
    warnings.push("No accounts were recognized in those files. Try the CSV template.");
  }
  return { rows, truncated, warnings };
}
