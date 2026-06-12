import * as XLSX from "xlsx";
import type { Account, Contact } from "@shared/schema";

// ---------------------------------------------------------------------------
// Bulk contact import: parses XLSX / XLS / CSV / PDF buffers into preview rows.
// Pure functions — no DB access. The route layer supplies accounts/contacts.
// ---------------------------------------------------------------------------

export const MAX_IMPORT_ROWS = 500;

export interface ParsedContactRow {
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  /** Raw account text found in the file (company / municipality / city). */
  accountHint: string | null;
  /** Matched account id, or null when nothing matched. */
  accountId: number | null;
  accountMatch: "exact" | "fuzzy" | "none";
  duplicate: boolean;
  duplicateReason: string | null;
  sourceFile: string;
}

export interface ParseResult {
  rows: ParsedContactRow[];
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

/** Strips municipal prefixes/suffixes: "City of Westland" -> "westland", "Canton Twp" -> "canton". */
function stripMuni(s: string): string {
  return norm(s)
    .replace(/\b(charter township of|township of|village of|city of|charter twp|charter township|township|twp|village|city)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeName(s: string): boolean {
  if (!s || s.length > 60) return false;
  if (EMAIL_RE.test(s) || PHONE_RE.test(s)) return false;
  if (/\d{3,}/.test(s)) return false;
  const words = s.split(/\s+/);
  if (words.length < 1 || words.length > 5) return false;
  return /[A-Za-z]/.test(s);
}

function looksLikeTitle(s: string): boolean {
  const low = s.toLowerCase();
  return TITLE_WORDS.some((w) => low.includes(w));
}

// ---------- account matching ----------

export interface AccountMatcher {
  match(hint: string): { accountId: number; kind: "exact" | "fuzzy" } | null;
}

export function buildAccountMatcher(accounts: Account[]): AccountMatcher {
  const exact = new Map<string, number>();    // normalized full name/city -> id
  const stripped = new Map<string, number>(); // muni-prefix-stripped -> id
  const list: { key: string; id: number }[] = [];

  for (const a of accounts) {
    for (const raw of [a.name, a.city]) {
      if (!raw) continue;
      const n = norm(raw);
      if (n && !exact.has(n)) exact.set(n, a.id);
      const st = stripMuni(raw);
      if (st && !stripped.has(st)) stripped.set(st, a.id);
      if (st.length >= 4) list.push({ key: st, id: a.id });
    }
  }

  return {
    match(hint: string) {
      const h = clean(hint);
      if (!h) return null;
      const n = norm(h);
      if (exact.has(n)) return { accountId: exact.get(n)!, kind: "exact" };
      const st = stripMuni(h);
      if (!st) return null;
      if (stripped.has(st)) return { accountId: stripped.get(st)!, kind: "fuzzy" };
      if (st.length >= 4) {
        // containment either direction, longest key wins ("ann arbor" beats "arbor")
        let best: { id: number; len: number } | null = null;
        for (const { key, id } of list) {
          if (key.includes(st) || st.includes(key)) {
            if (!best || key.length > best.len) best = { id, len: key.length };
          }
        }
        if (best) return { accountId: best.id, kind: "fuzzy" };
      }
      return null;
    },
  };
}

// ---------- duplicate detection ----------

interface DupeIndex {
  emails: Set<string>;
  nameAccount: Set<string>;
}

function buildExistingIndex(accounts: Account[], contacts: Contact[]): DupeIndex {
  const emails = new Set<string>();
  const nameAccount = new Set<string>();
  for (const c of contacts) {
    if (c.email) emails.add(c.email.toLowerCase().trim());
    if (c.name) nameAccount.add(`${norm(c.name)}@@${c.accountId}`);
  }
  for (const a of accounts) {
    if (a.email) emails.add(a.email.toLowerCase().trim());
    if (a.primaryContact) nameAccount.add(`${norm(a.primaryContact)}@@${a.id}`);
  }
  return { emails, nameAccount };
}

// ---------- raw record (pre account-match / dedupe) ----------

interface RawContact {
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  accountHint: string | null;
  sourceFile: string;
}

function hasSubstance(r: Pick<RawContact, "name" | "email" | "phone">): boolean {
  return !!(r.name || r.email || r.phone);
}

// ---------- spreadsheet / CSV parsing ----------

type Field = "name" | "firstName" | "lastName" | "email" | "phone" | "title" | "account" | "notes";

const HEADER_ALIASES: Record<string, Field> = {
  "name": "name", "full name": "name", "contact": "name", "contact name": "name",
  "first name": "firstName", "firstname": "firstName", "first": "firstName",
  "last name": "lastName", "lastname": "lastName", "last": "lastName", "surname": "lastName",
  "email": "email", "e-mail": "email", "email address": "email", "mail": "email",
  "phone": "phone", "phone number": "phone", "telephone": "phone", "tel": "phone",
  "mobile": "phone", "cell": "phone", "office phone": "phone", "direct": "phone", "work phone": "phone",
  "title": "title", "job title": "title", "position": "title", "role": "title",
  "account": "account", "account name": "account", "company": "account", "municipality": "account",
  "organization": "account", "org": "account", "city": "account", "employer": "account", "utility": "account",
  "notes": "notes", "note": "notes", "comments": "notes", "comment": "notes", "description": "notes",
};

function detectHeaderMap(row: string[]): Map<number, Field> | null {
  const map = new Map<number, Field>();
  row.forEach((cell, i) => {
    const key = norm(cell);
    if (key && HEADER_ALIASES[key]) map.set(i, HEADER_ALIASES[key]);
  });
  const fields = new Set(map.values());
  // Need at least two recognized columns (or a lone name/email) to trust headers.
  if (map.size >= 2 || fields.has("email") || fields.has("name")) return map.size > 0 ? map : null;
  return null;
}

/** Infers a column map from cell content when no header row is recognized. */
function inferColumns(rows: string[][], matcher: AccountMatcher): Map<number, Field> {
  const width = Math.max(0, ...rows.map((r) => r.length));
  const map = new Map<number, Field>();
  const taken = new Set<Field>();

  const scores: { i: number; email: number; phone: number; account: number; title: number; namey: number; n: number }[] = [];
  for (let i = 0; i < width; i++) {
    let email = 0, phone = 0, account = 0, title = 0, namey = 0, n = 0;
    for (const r of rows) {
      const v = clean(r[i]);
      if (!v) continue;
      n++;
      if (EMAIL_RE.test(v)) email++;
      else if (PHONE_RE.test(v)) phone++;
      else {
        if (matcher.match(v)) account++;
        if (looksLikeTitle(v)) title++;
        if (looksLikeName(v) && v.split(/\s+/).length >= 2) namey++;
      }
    }
    scores.push({ i, email, phone, account, title, namey, n });
  }

  const assign = (i: number, f: Field) => { if (!map.has(i) && !taken.has(f)) { map.set(i, f); taken.add(f); } };
  for (const s of scores) if (s.n && s.email / s.n > 0.5) assign(s.i, "email");
  for (const s of scores) if (s.n && s.phone / s.n > 0.5) assign(s.i, "phone");
  for (const s of scores) if (s.n && !map.has(s.i) && s.account / s.n > 0.4) assign(s.i, "account");
  for (const s of scores) if (s.n && !map.has(s.i) && s.title / s.n > 0.3) assign(s.i, "title");
  // Name: the unassigned column with the most multi-word namey values.
  const nameCand = scores.filter((s) => !map.has(s.i) && s.n > 0).sort((a, b) => b.namey - a.namey)[0];
  if (nameCand && nameCand.namey > 0) assign(nameCand.i, "name");
  return map;
}

function rowsToContacts(rows: string[][], map: Map<number, Field>, sourceFile: string): RawContact[] {
  const out: RawContact[] = [];
  // Reverse index (field -> first column) built once, not per row.
  const colFor = new Map<Field, number>();
  map.forEach((field, i) => { if (!colFor.has(field)) colFor.set(field, i); });
  for (const r of rows) {
    const get = (f: Field) => {
      const i = colFor.get(f);
      return i == null ? "" : clean(r[i]);
    };
    const first = get("firstName");
    const last = get("lastName");
    const name = clean(get("name") || `${first} ${last}`);
    const rec: RawContact = {
      name,
      title: get("title") || null,
      email: (get("email").match(EMAIL_RE)?.[0] ?? get("email")) || null,
      phone: get("phone") || null,
      notes: get("notes") || null,
      accountHint: get("account") || null,
      sourceFile,
    };
    if (hasSubstance(rec)) out.push(rec);
  }
  return out;
}

function parseSpreadsheet(buffer: Buffer, sourceFile: string, warnings: string[], matcher: AccountMatcher): RawContact[] {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: "buffer" });
  } catch {
    warnings.push(`${sourceFile}: file could not be read as a spreadsheet — skipped.`);
    return [];
  }
  const out: RawContact[] = [];
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    const grid = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: "" }) as string[][];
    const rows = grid.map((r) => r.map(clean)).filter((r) => r.some(Boolean));
    if (!rows.length) continue;

    const headerMap = detectHeaderMap(rows[0]);
    if (headerMap) {
      out.push(...rowsToContacts(rows.slice(1), headerMap, sourceFile));
    } else {
      const inferred = inferColumns(rows, matcher);
      if (inferred.size === 0) {
        warnings.push(`${sourceFile}${wb.SheetNames.length > 1 ? ` (${sheetName})` : ""}: no recognizable columns found — skipped.`);
        continue;
      }
      out.push(...rowsToContacts(rows, inferred, sourceFile));
    }
  }
  return out;
}
// ---------- PDF parsing ----------

const PDF_LABELS: Record<string, Field> = {
  name: "name", contact: "name",
  title: "title", position: "title", role: "title",
  email: "email", "e-mail": "email",
  phone: "phone", tel: "phone", telephone: "phone", mobile: "phone", cell: "phone",
  account: "account", municipality: "account", company: "account", organization: "account", city: "account",
  notes: "notes", note: "notes",
};

const PDF_LABEL_RE = /\b(name|contact|title|position|role|e-?mail|phone|telephone|tel|mobile|cell|account|municipality|company|organization|city|notes?)\s*[:\-–]\s*/gi;

/** Pass 1: "Name: Jane Smith  Title: ..." labeled blocks (works with or without newlines). */
function pdfLabeledPass(text: string, sourceFile: string): RawContact[] {
  const matches = Array.from(text.matchAll(PDF_LABEL_RE));
  if (!matches.length) return [];
  const out: RawContact[] = [];
  let cur: RawContact | null = null;
  const flush = () => { if (cur && hasSubstance(cur)) out.push(cur); cur = null; };

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const labelKey = m[1].toLowerCase().replace("e-mail", "email").replace(/^notes$/, "notes");
    const field = PDF_LABELS[labelKey] ?? PDF_LABELS[labelKey.replace(/s$/, "")];
    if (!field) continue;
    const start = m.index! + m[0].length;
    const nextLabel = i + 1 < matches.length ? matches[i + 1].index! : text.length;
    // A labeled value ends at the next label or the end of its own line,
    // whichever comes first — otherwise the last label on a page absorbs
    // everything below it.
    const lineEnd = text.indexOf("\n", start);
    const end = Math.min(nextLabel, lineEnd === -1 ? text.length : lineEnd);
    let value = clean(text.slice(start, end)).slice(0, 120);
    if (field === "email") value = value.match(EMAIL_RE)?.[0] ?? value;
    if (field === "phone") value = value.match(PHONE_RE)?.[0] ?? value;

    if (field === "name") {
      if (cur && (cur.name || cur.email || cur.phone)) flush();
      cur = cur ?? { name: "", title: null, email: null, phone: null, notes: null, accountHint: null, sourceFile };
      cur.name = value;
    } else {
      cur = cur ?? { name: "", title: null, email: null, phone: null, notes: null, accountHint: null, sourceFile };
      if (field === "title") cur.title = cur.title ?? (value || null);
      if (field === "email") cur.email = cur.email ?? (value || null);
      if (field === "phone") cur.phone = cur.phone ?? (value || null);
      if (field === "account") cur.accountHint = cur.accountHint ?? (value || null);
      if (field === "notes") cur.notes = cur.notes ?? (value || null);
    }
  }
  flush();
  return out;
}

/** Pass 2: line scanning around email/phone hits ("Jane Smith — Water Supt — jane@x.gov — (734) 555‑0101"). */
const PDF_LABELED_LINE_RE = /^(name|contact|title|position|role|e-?mail|phone|telephone|tel|mobile|cell|account|municipality|company|organization|city|notes?)\s*[:\-–]/i;

function pdfLinePass(text: string, sourceFile: string, matcher: AccountMatcher): RawContact[] {
  const out: RawContact[] = [];
  const lines = text.split(/\r?\n+/);
  for (const lineRaw of lines) {
    const line = clean(lineRaw);
    if (!line) continue;
    // Lines that open with a label ("Phone: …") belong to the labeled pass;
    // re-scanning them here produced nameless phone-only ghost rows.
    if (PDF_LABELED_LINE_RE.test(line)) continue;
    const email = line.match(EMAIL_RE)?.[0] ?? null;
    const phone = line.match(PHONE_RE)?.[0] ?? null;
    if (!email && !phone) continue;

    const segments = line
      .split(/\s*[—|•·;,]\s*|\t+|\s{2,}|\s+-\s+/)
      .map(clean)
      .filter(Boolean);
    let name = "", title: string | null = null, accountHint: string | null = null;
    for (const seg of segments) {
      if (EMAIL_RE.test(seg) || PHONE_RE.test(seg)) continue;
      if (!title && looksLikeTitle(seg)) { title = seg; continue; }
      if (!accountHint && matcher.match(seg)) { accountHint = seg; continue; }
      if (!name && looksLikeName(seg)) { name = seg; continue; }
    }
    const rec: RawContact = { name, title, email, phone, notes: null, accountHint, sourceFile };
    if (hasSubstance(rec)) out.push(rec);
  }
  return out;
}

/**
 * Rebuilds real text lines from PDF.js text items using their y/x coordinates.
 * unpdf's extractText() flattens a page to a single space-joined string (zero
 * newlines), which breaks both the line-scan pass and labeled-value boundaries.
 */
async function pdfTextByLines(buffer: Buffer): Promise<string> {
  const { getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(new Uint8Array(buffer));
  const lines: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const rows = new Map<number, { x: number; str: string }[]>();
    for (const item of content.items as Array<{ str?: string; transform?: number[] }>) {
      if (!item.str || !item.transform) continue;
      const y = Math.round(item.transform[5]);
      // Bucket items whose baselines sit within 2pt of each other onto one line.
      let key = y;
      for (const k of Array.from(rows.keys())) {
        if (Math.abs(k - y) <= 2) { key = k; break; }
      }
      const arr = rows.get(key) ?? [];
      arr.push({ x: item.transform[4], str: item.str });
      rows.set(key, arr);
    }
    const ordered = Array.from(rows.entries()).sort((a, b) => b[0] - a[0]); // top of page first
    for (const entry of ordered) {
      lines.push(entry[1].sort((a, b) => a.x - b.x).map((i) => i.str).join(" ").trim());
    }
    lines.push("");
  }
  return lines.join("\n");
}

async function parsePdf(buffer: Buffer, sourceFile: string, warnings: string[], matcher: AccountMatcher): Promise<RawContact[]> {
  let text = "";
  try {
    // unpdf is ESM-native and serverless (no PDF.js worker), so malformed files
    // reject the awaited promise instead of crashing the process the way
    // pdf-parse's bundled worker did ("bad XRef entry" -> silent exit).
    text = await pdfTextByLines(buffer);
  } catch {
    try {
      // Fallback: flat extraction (no line structure, labeled pass still works).
      const { extractText } = await import("unpdf");
      const result = await extractText(new Uint8Array(buffer), { mergePages: true });
      text = Array.isArray(result.text) ? result.text.join("\n") : String(result.text ?? "");
    } catch (e: any) {
      warnings.push(`${sourceFile}: PDF could not be read — skipped. (${clean(e?.message ?? e).slice(0, 120)})`);
      return [];
    }
  }
  if (!clean(text)) {
    warnings.push(`${sourceFile}: no extractable text found in PDF (scanned image?) — skipped.`);
    return [];
  }

  const labeled = pdfLabeledPass(text, sourceFile);
  const lined = pdfLinePass(text, sourceFile, matcher);

  // Merge: labeled records win; line-scan adds anything with an email we haven't seen.
  const seenEmails = new Set(labeled.map((r) => r.email?.toLowerCase()).filter(Boolean) as string[]);
  const seenNames = new Set(labeled.map((r) => norm(r.name)).filter(Boolean));
  const merged = [...labeled];
  for (const r of lined) {
    const ekey = r.email?.toLowerCase();
    if (ekey && seenEmails.has(ekey)) continue;
    if (!ekey && r.name && seenNames.has(norm(r.name))) continue;
    merged.push(r);
    if (ekey) seenEmails.add(ekey);
    if (r.name) seenNames.add(norm(r.name));
  }
  if (!merged.length) warnings.push(`${sourceFile}: no contacts recognized in PDF text.`);
  return merged;
}

// ---------- file-type routing ----------

function sniffKind(file: UploadedFile): "pdf" | "sheet" | "unknown" {
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  if (ext === "pdf") return "pdf";
  if (["xlsx", "xls", "csv", "tsv", "txt"].includes(ext)) return "sheet";
  const head = file.buffer.subarray(0, 5).toString("latin1");
  if (head.startsWith("%PDF")) return "pdf";
  if (head.startsWith("PK\x03\x04")) return "sheet"; // zip container = xlsx
  return "unknown";
}

// ---------- main entry ----------

export async function parseContactFiles(
  files: UploadedFile[],
  accounts: Account[],
  existingContacts: Contact[],
): Promise<ParseResult> {
  const warnings: string[] = [];
  const matcher = buildAccountMatcher(accounts);

  const raw: RawContact[] = [];
  for (const file of files) {
    try {
      const kind = sniffKind(file);
      if (kind === "pdf") {
        raw.push(...(await parsePdf(file.buffer, file.name, warnings, matcher)));
      } else if (kind === "sheet") {
        raw.push(...parseSpreadsheet(file.buffer, file.name, warnings, matcher));
      } else {
        warnings.push(`${file.name}: unsupported file type — use CSV, XLSX, XLS, or PDF.`);
      }
    } catch (e: any) {
      // Per-file belt-and-suspenders: a bad file never takes down the request.
      warnings.push(`${file.name}: could not be read — skipped. (${clean(e?.message ?? e).slice(0, 120)})`);
    }
  }

  let truncated = false;
  let limited = raw;
  if (raw.length > MAX_IMPORT_ROWS) {
    truncated = true;
    limited = raw.slice(0, MAX_IMPORT_ROWS);
    warnings.push(`Found ${raw.length} contacts; showing the first ${MAX_IMPORT_ROWS}. Split larger lists into separate uploads.`);
  }

  const existing = buildExistingIndex(accounts, existingContacts);
  const batchEmails = new Set<string>();
  const batchNameAccount = new Set<string>();

  const rows: ParsedContactRow[] = limited.map((r) => {
    const matched = r.accountHint ? matcher.match(r.accountHint) : null;
    const accountId = matched?.accountId ?? null;
    const accountMatch: ParsedContactRow["accountMatch"] = matched ? matched.kind : "none";

    let duplicate = false;
    let duplicateReason: string | null = null;
    const ekey = r.email?.toLowerCase().trim() || null;
    const nkey = r.name && accountId != null ? `${norm(r.name)}@@${accountId}` : null;

    if (ekey && existing.emails.has(ekey)) {
      duplicate = true; duplicateReason = "email matches an existing contact";
    } else if (nkey && existing.nameAccount.has(nkey)) {
      duplicate = true; duplicateReason = "name already exists on this account";
    } else if (ekey && batchEmails.has(ekey)) {
      duplicate = true; duplicateReason = "duplicate within this upload";
    } else if (nkey && batchNameAccount.has(nkey)) {
      duplicate = true; duplicateReason = "duplicate within this upload";
    }
    if (ekey) batchEmails.add(ekey);
    if (nkey) batchNameAccount.add(nkey);

    return {
      name: r.name,
      title: r.title,
      email: r.email,
      phone: r.phone,
      notes: r.notes,
      accountHint: r.accountHint,
      accountId,
      accountMatch,
      duplicate,
      duplicateReason,
      sourceFile: r.sourceFile,
    };
  });

  return { rows, truncated, warnings };
}
