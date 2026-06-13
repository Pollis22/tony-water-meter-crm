// ---------------------------------------------------------------------------
// Candidate scoring — exact reconstruction of the model used to score the
// original 103-account seed (validated: reproduces all 103 seed scores and
// reason strings precisely).
//
//   Tier weight      Tier 1: 35 · Tier 2: 22 · Tier 3: 12
//   Endpoints        bucketed: <1.5k: 4 · ≥1.5k: 8 · ≥4k: 13 · ≥8k: 18
//                              ≥15k: 24 · ≥30k: 30 · ≥100k: 35
//                    (unknown/zero endpoints score 0, not the 4-pt floor —
//                     "we don't know" shouldn't outrank "we know it's tiny")
//   Entry angle      Enterprise AMI+NRW: 25 · AMI+leak: 20
//                    Billing+labor: 14 · Pilot: 8
//   Contact bonus    contact + email: 5 · contact only: 3
// ---------------------------------------------------------------------------

export interface ScoreInputs {
  tier?: string | null;
  endpoints?: number | null;
  entryAngle?: string | null;
  primaryContact?: string | null;
  email?: string | null;
  oppAmiAmr?: number | null;
  oppLeakDetection?: number | null;
  oppBillingAccuracy?: number | null;
  oppLaborSavings?: number | null;
}

const TIER_PTS: Record<string, { pts: number; reason: string }> = {
  "Tier 1": { pts: 35, reason: "Tier 1 strategic account" },
  "Tier 2": { pts: 22, reason: "Tier 2 mid-size system" },
  "Tier 3": { pts: 12, reason: "Tier 3 smaller system" },
};

const EP_BUCKETS: [number, number][] = [
  [100_000, 35], [30_000, 30], [15_000, 24], [8_000, 18], [4_000, 13], [1_500, 8],
];

const ANGLE_PTS: { match: RegExp; pts: number; reason: string }[] = [
  { match: /enterprise|nrw|non.?revenue/i, pts: 25, reason: "Enterprise AMI + non-revenue-water fit" },
  { match: /leak/i, pts: 20, reason: "AMI upgrade + leak detection fit" },
  { match: /billing|labor/i, pts: 14, reason: "Billing accuracy + labor savings fit" },
  { match: /pilot|quick roi/i, pts: 8, reason: "Simple AMI pilot fit" },
];

function endpointPts(ep: number | null | undefined): { pts: number; reason: string } {
  if (!ep || ep <= 0) return { pts: 0, reason: "Endpoints unknown" };
  for (const [threshold, pts] of EP_BUCKETS) {
    if (ep >= threshold) return { pts, reason: `${ep.toLocaleString("en-US")} estimated endpoints` };
  }
  return { pts: 4, reason: `${ep.toLocaleString("en-US")} estimated endpoints` };
}

function anglePts(a: ScoreInputs): { pts: number; reason: string } {
  const text = (a.entryAngle ?? "").trim();
  if (text) {
    for (const { match, pts, reason } of ANGLE_PTS) {
      if (match.test(text)) return { pts, reason };
    }
  }
  // No (recognized) angle text — fall back to opportunity flags.
  if (a.oppAmiAmr && a.oppLeakDetection) return { pts: 20, reason: "AMI upgrade + leak detection fit" };
  if (a.oppBillingAccuracy && a.oppLaborSavings) return { pts: 14, reason: "Billing accuracy + labor savings fit" };
  if (a.oppAmiAmr || a.oppLeakDetection || a.oppBillingAccuracy || a.oppLaborSavings) {
    return { pts: 8, reason: "Simple AMI pilot fit" };
  }
  return { pts: 0, reason: "No entry angle identified yet" };
}

export function computeScore(a: ScoreInputs): { score: number; reasons: string[] } {
  const parts: { pts: number; reason: string }[] = [];

  const tier = TIER_PTS[(a.tier ?? "").trim()];
  parts.push(tier ?? { pts: 0, reason: "Tier not set" });
  parts.push(endpointPts(a.endpoints));
  parts.push(anglePts(a));

  if (a.primaryContact?.trim() && a.email?.trim()) parts.push({ pts: 5, reason: "Direct contact + email on file" });
  else if (a.primaryContact?.trim()) parts.push({ pts: 3, reason: "Named contact on file" });
  else parts.push({ pts: 0, reason: "No named contact yet" });

  const score = Math.min(100, parts.reduce((s, p) => s + p.pts, 0));
  return { score, reasons: parts.map((p) => `${p.reason} (+${p.pts})`) };
}

/** Fields whose change should trigger a re-score. */
export const SCORING_FIELDS = [
  "tier", "endpoints", "entryAngle", "primaryContact", "email",
  "oppAmiAmr", "oppLeakDetection", "oppBillingAccuracy", "oppLaborSavings",
] as const;
