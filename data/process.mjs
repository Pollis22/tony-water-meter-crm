// Geocode + score + generate insight for all accounts
import fs from 'node:fs';
import path from 'node:path';

const raw = JSON.parse(fs.readFileSync('./data/accounts-raw.json', 'utf8'));

// ---------- Scoring ----------
function score(a) {
  let s = 0;
  const reasons = [];

  // Tier weight (35 points)
  if (a.tier === 'Tier 1') { s += 35; reasons.push('Tier 1 strategic account (+35)'); }
  else if (a.tier === 'Tier 2') { s += 22; reasons.push('Tier 2 mid-size system (+22)'); }
  else { s += 12; reasons.push('Tier 3 smaller system (+12)'); }

  // Endpoint weight (35 points, log-ish scale)
  const ep = a.endpoints || 0;
  let epPts = 0;
  if (ep >= 100000) epPts = 35;
  else if (ep >= 30000) epPts = 30;
  else if (ep >= 15000) epPts = 24;
  else if (ep >= 8000) epPts = 18;
  else if (ep >= 4000) epPts = 13;
  else if (ep >= 1500) epPts = 8;
  else epPts = 4;
  s += epPts;
  reasons.push(`${ep.toLocaleString()} estimated endpoints (+${epPts})`);

  // Entry angle weight (25 points)
  const angle = (a.entryAngle || '').toLowerCase();
  let aPts = 0;
  if (angle.includes('enterprise ami') || angle.includes('nrw')) { aPts = 25; reasons.push('Enterprise AMI + non-revenue-water fit (+25)'); }
  else if (angle.includes('ami upgrade') && angle.includes('leak')) { aPts = 20; reasons.push('AMI upgrade + leak detection fit (+20)'); }
  else if (angle.includes('billing') || angle.includes('labor')) { aPts = 14; reasons.push('Billing accuracy + labor savings fit (+14)'); }
  else { aPts = 8; reasons.push('Simple AMI pilot fit (+8)'); }
  s += aPts;

  // Contact bonus (5 points)
  if (a.contact && a.email) { s += 5; reasons.push('Direct contact + email on file (+5)'); }
  else if (a.contact) { s += 3; reasons.push('Named contact on file (+3)'); }
  else { reasons.push('No named contact yet (+0)'); }

  return { score: Math.min(100, s), reasons };
}

// ---------- Sales insight ----------
function insight(a) {
  const ep = a.endpoints || 0;
  const tier = a.tier;
  const angle = a.entryAngle || '';
  const lines = [];

  // What it manages
  lines.push(`${a.city} likely manages a municipal water utility serving roughly ${ep.toLocaleString()} metered connections (population ${a.population.toLocaleString()}). The Public Works / DPS office handles meters, billing, and field service.`);

  // Why a candidate
  if (tier === 'Tier 1') {
    lines.push(`As a Tier 1 system in ${a.county} County, this is a strategic enterprise opportunity. Scale supports a multi-year AMI program with district-level visibility.`);
  } else if (tier === 'Tier 2') {
    lines.push(`Tier 2 mid-size utility — large enough to fund modernization, small enough for a quick decision cycle. Best fit for billing accuracy and labor reduction stories.`);
  } else {
    lines.push(`Tier 3 small system — practical, fast-payback opportunity. Decision-makers are typically the DPW director and city manager.`);
  }

  // Recommendation
  let fit = '';
  if (angle.includes('Enterprise AMI')) fit = 'enterprise AMI + non-revenue-water visibility';
  else if (angle.includes('AMI upgrade')) fit = 'AMI upgrade paired with leak detection';
  else if (angle.includes('Billing')) fit = 'billing accuracy and labor savings';
  else fit = 'a simple AMI pilot with quick ROI';
  lines.push(`Best suited for ${fit}.`);

  // Sales angle
  let pitch = '';
  if (tier === 'Tier 1') pitch = `Lead with district-level water-loss visibility, MDM integration, and a phased deployment plan. Position EJP as the long-term partner, not just a meter vendor.`;
  else if (tier === 'Tier 2') pitch = `Open with a billing-accuracy and field-labor story. Quantify hours spent on manual reads and re-reads, then show payback.`;
  else pitch = `Open with staff time spent on meter reads, no-read tickets, and any known billing complaints. Offer a small AMI pilot to prove ROI.`;
  lines.push(pitch);

  return lines.join(' ');
}

// ---------- Geocoding ----------
// Use Nominatim (free, no key). Be polite: 1 req/sec, custom UA.
async function geocode(address, cityState) {
  const q = `${address}, ${cityState}, USA`;
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'tony-water-meter-crm/1.0 (territory planning)' }
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data && data.length > 0) {
      return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), source: 'precise' };
    }
    // Fallback: just city, state
    const url2 = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(cityState + ', USA')}`;
    const res2 = await fetch(url2, { headers: { 'User-Agent': 'tony-water-meter-crm/1.0' } });
    const data2 = await res2.json();
    if (data2 && data2.length > 0) {
      return { lat: parseFloat(data2[0].lat), lng: parseFloat(data2[0].lon), source: 'city' };
    }
    return null;
  } catch (e) {
    return null;
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const out = [];
for (let i = 0; i < raw.length; i++) {
  const a = raw[i];
  const { score: sc, reasons } = score(a);
  const ins = insight(a);
  process.stdout.write(`[${i+1}/${raw.length}] ${a.city}, ${a.county} ... `);
  let geo = await geocode(a.address, a.cityState);
  if (!geo) geo = { lat: null, lng: null, source: 'none' };
  console.log(geo.lat ? `(${geo.lat.toFixed(4)}, ${geo.lng.toFixed(4)}) ${geo.source}` : 'FAILED');
  out.push({
    ...a,
    score: sc,
    scoreReasons: reasons,
    insight: ins,
    lat: geo.lat,
    lng: geo.lng,
    geoSource: geo.source,
  });
  await sleep(1100);
}

fs.writeFileSync('./data/accounts.json', JSON.stringify(out, null, 2));
console.log(`\nWrote ${out.length} accounts to data/accounts.json`);
const failed = out.filter(o => !o.lat).length;
console.log(`Geocode failures: ${failed}`);
