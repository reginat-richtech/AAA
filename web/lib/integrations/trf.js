// Travel Request Form (TRF) matching — ported from the old app
// (admin.py _fetch_jotform_travel_requests + _find_trf_match).
//
// TRFs are fetched live from JotForm (the Richtech "Travel Request Form")
// using JOTFORM_API_KEY, then matched to Navan bookings. DEGRADES GRACEFULLY:
// with no API key / no submissions / a fetch error, fetchTravelRequests()
// returns [] and the ✅/⏰/❌ flags simply stay hidden.
import { query } from '../db';

const KEY = process.env.JOTFORM_API_KEY || '';

const PROXIMITY_DAYS = 2;
const norm = (s) => String(s || '').trim().toLowerCase();
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;

// The Richtech "Travel Request Form (TRF)" JotForm id (override via env).
// Fields: requestersName(3) · companyEmail(4) · departureDate(5) · returnDate(6).
const TRF_FORM_ID = process.env.TRAVEL_REQUEST_FORM_ID || '253216066321044';

// Normalize various JotForm date shapes to an ISO 'YYYY-MM-DD' string.
function toISO(v) {
  if (!v) return '';
  if (typeof v === 'object') {
    const { year, month, day } = v;
    if (year && month && day) return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    v = v.datetime || v.text || '';
  }
  const s = String(v).trim();
  let m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/))) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  const dt = new Date(s);
  return isNaN(dt.getTime()) ? '' : dt.toISOString().slice(0, 10);
}

// Flatten a raw JotForm submission's answers to [{ label, value }].
function answersOf(raw) {
  const a = raw && raw.answers;
  if (!a) return [];
  return Object.values(a).map((x) => ({ label: norm(x?.name) + ' ' + norm(x?.text), value: x?.answer }));
}

// Heuristically pull traveler email/name + departure/return dates from a TRF.
export function parseTRF(raw) {
  const a = (raw && raw.answers) || {};
  const byName = {};
  for (const x of Object.values(a)) if (x && x.name) byName[norm(x.name)] = x.answer;
  const fullname = (v) => (v && typeof v === 'object' ? [v.first, v.last].filter(Boolean).join(' ') : String(v || ''));
  const emailIn = (v) => { const m = (typeof v === 'string' ? v : '').match(EMAIL_RE); return m ? m[0] : ''; };

  // Exact mapping for the known TRF, by JotForm field `name`.
  let email = norm(emailIn(byName.companyemail));
  let name = norm(fullname(byName.requestersname));
  let depart = toISO(byName.departuredate);
  let ret = toISO(byName.returndate);

  // Heuristic fallback — fills anything the exact names missed (or other forms).
  if (!email || !name || !depart || !ret) {
    for (const { label, value } of answersOf(raw)) {
      const flat = typeof value === 'string' ? value : '';
      if (!email && (label.includes('email') || EMAIL_RE.test(flat))) email = norm(emailIn(flat));
      if (!name && (label.includes('requester') || label.includes('traveler') || label.includes('employee'))) { const v = fullname(value); if (v) name = norm(v); }
      if (!depart && (label.includes('depart') || label.includes('fly out') || label.includes('outbound'))) depart = toISO(value);
      if (!ret && (label.includes('return') || label.includes('fly back'))) ret = toISO(value);
    }
  }
  return { email, name, depart, ret };
}

// Read TRF submissions from the synced DB (ext.jotform_submission) — no live
// JotForm call on the request path. Empty table → [] (TRF flags stay hidden).
export async function fetchTravelRequests() {
  try {
    const { rows } = await query('select raw from ext.jotform_submission where form_id = $1', [TRF_FORM_ID]);
    return rows.map((r) => parseTRF(r.raw)).filter((t) => t.depart || t.ret);
  } catch {
    return [];
  }
}

const daysApart = (a, b) => Math.abs((new Date(a + 'T00:00:00Z') - new Date(b + 'T00:00:00Z')) / 86400000);

// Match one booking to the traveler's TRFs. Returns:
//   request_match: null  → no TRF data connected (caller hides the flag)
//   request_match: false → TRFs exist but none match this booking  (❌)
//   request_match: true  → matched; match_note set for ±-day proximity (⏰), else exact/within (✅)
export function matchTRF(booking, trfs) {
  if (!trfs || !trfs.length) return { request_match: null, match_note: null };
  const bEmail = norm(booking.email), bName = norm(booking.name);
  const bDep = booking.depart, bRet = booking.ret || booking.depart;
  const mine = trfs.filter((t) =>
    (bEmail && t.email && t.email === bEmail) || (bName && t.name && t.name === bName));
  if (!mine.length) return { request_match: false, match_note: null };

  for (const t of mine) if (bDep && t.depart === bDep && (!t.ret || t.ret === bRet)) return { request_match: true, match_note: null };          // exact
  for (const t of mine) if (t.depart && t.ret && bDep && bDep >= t.depart && bDep <= t.ret) return { request_match: true, match_note: null };   // within range
  for (const t of mine) {                                                                                                                       // ±2-day proximity
    if (t.depart && bDep && daysApart(bDep, t.depart) <= PROXIMITY_DAYS) return { request_match: true, match_note: bDep < t.depart ? 'Early flight in' : 'Late flight back' };
    if (t.ret && bRet && daysApart(bRet, t.ret) <= PROXIMITY_DAYS) return { request_match: true, match_note: bRet > t.ret ? 'Late flight back' : 'Early flight in' };
  }
  return { request_match: false, match_note: null };
}
