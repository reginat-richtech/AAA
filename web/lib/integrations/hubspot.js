// HubSpot activity brief — computed from the DB (ext.hubspot_*), NOT the live API.
// The data is pulled into Postgres by lib/ingest/hubspot.js (sync job / Option-B
// Refresh). Cards: (1) new deals this week (2026+), (2) stage moves last 7 days,
// (3) stalled open deals past close date, (4) at-risk deals by composite risk
// score (see dealRisk). Plus email activity by rep (yesterday), with one-line
// LLM summaries. Reads are cheap DB queries; force bypasses caches.
import { query } from '../db';
import { ensureExtSchema } from '../ingest/schema';

const OPENAI_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_BASE = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1';
const DAY = 86400000;
const YEAR_CUTOFF = Date.parse('2026-01-01T00:00:00Z');
const HALF_YEAR_MS = 183 * DAY;   // at-risk alerts only consider deals from the last ~6 months

function dayStartMs(offsetDays = 0) {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + offsetDays);
  return d.getTime();
}
function fmtMoney(v) {
  const n = Number(v);
  return Number.isFinite(n) && n ? '$' + n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : null;
}
const tsOf = (v) => (v == null ? 0 : (isNaN(+v) ? Date.parse(v) : +v)) || 0;
function stageSeverity(label) {
  const s = (label || '').toLowerCase();
  if (s.includes('lost')) return { sev: 'fail', icon: '❌' };
  if (s.includes('won')) return { sev: 'ok', icon: '🏆' };
  if (s.includes('trial')) return { sev: 'info', icon: '🧪' };
  return { sev: 'warn', icon: '🔄' };
}

// Composite deal risk score (0–100), ported from the old app's deal_risk model.
// Deal-property rules only (call-sentiment penalties omitted — no call data here):
//   inactivity tier (no activity 7/14/30d → +8/18/30, highest tier only),
//   past-due close +25, closing-soon & quiet +20, stuck in current stage >30d +15.
// Bands: ≥70 at_risk · ≥40 watch · else healthy. Activity falls back to
// hs_lastmodifieddate until the ingest re-syncs hs_last_activity_date.
function dealRisk(d) {
  const p = d.properties || {};
  const now = Date.now();
  const lastAct = tsOf(p.hs_last_activity_date || p.notes_last_contacted || p.hs_lastmodifieddate);
  const daysQuiet = lastAct ? (now - lastAct) / DAY : null;
  const close = tsOf(p.closedate);
  const daysToClose = close ? (close - now) / DAY : null;
  const entered = Array.isArray(d.hist) && d.hist.length ? tsOf(d.hist[0].timestamp) : null;
  const daysInStage = entered ? (now - entered) / DAY : null;

  let score = 0; const reasons = [];
  if (daysQuiet != null) {
    if (daysQuiet >= 30) { score += 30; reasons.push('no activity 30d+'); }
    else if (daysQuiet >= 14) { score += 18; reasons.push('no activity 14d+'); }
    else if (daysQuiet >= 7) { score += 8; reasons.push('no activity 7d+'); }
  }
  if (daysToClose != null && daysToClose < 0) { score += 25; reasons.push('past close date'); }
  else if (daysToClose != null && daysToClose <= 7 && (daysQuiet == null || daysQuiet >= 5)) { score += 20; reasons.push('closing soon & quiet'); }
  if (daysInStage != null && daysInStage > 30) { score += 15; reasons.push('stuck in stage 30d+'); }

  score = Math.min(100, score);
  return { score, band: score >= 70 ? 'at_risk' : score >= 40 ? 'watch' : 'healthy', reasons };
}

async function stageMapDb() {
  const { rows } = await query('select stage_id, label from ext.hubspot_pipeline');
  const m = {}; for (const r of rows) m[r.stage_id] = r.label; return m;
}
async function ownerMapDb() {
  const { rows } = await query('select id, name from ext.hubspot_owner');
  const m = {}; for (const r of rows) m[String(r.id)] = r.name; return m;
}

// One LLM call per rep → { overall, per: [one-line summary per email] }.
async function aiEmailSummary(pmName, emails) {
  const sample = emails.slice(0, 15);
  if (!OPENAI_KEY) return { overall: '', per: sample.map(() => '') };
  const blocks = sample.map((e, i) =>
    `Email ${i + 1}: Subject: ${e.subject} | To: ${(e.to || []).join(', ') || '(unknown)'}` + (e.body ? ` | Body: ${e.body.slice(0, 400)}` : ''));
  const prompt = `${pmName} sent ${emails.length} emails yesterday.\n\n${blocks.join('\n')}\n\n`
    + `Return ONLY valid JSON: {"overall":"<2-3 sentence overall summary>","emails":["<1 sentence for email 1>", ...]} `
    + `with exactly ${sample.length} entries in "emails".`;
  try {
    const r = await fetch(`${OPENAI_BASE}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OPENAI_MODEL, temperature: 0.2, max_tokens: 700,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'You are a sales coach. Respond with valid JSON only.' },
          { role: 'user', content: prompt },
        ],
      }),
    });
    if (!r.ok) throw new Error(`OpenAI ${r.status}`);
    const j = await r.json();
    const parsed = JSON.parse(j.choices?.[0]?.message?.content || '{}');
    const per = (parsed.emails || []).map(String);
    while (per.length < sample.length) per.push('');
    return { overall: String(parsed.overall || ''), per: per.slice(0, sample.length) };
  } catch { return { overall: '', per: sample.map(() => '') }; }
}

// Deal cards (sections 1, 2, 3) — computed from ext.hubspot_deal.
async function computeCards() {
  await ensureExtSchema();   // tables may not exist before the first sync
  const wA = dayStartMs(-7), tD = dayStartMs(0);
  const stageMap = await stageMapDb();

  const { rows } = await query(
    `select id, raw from ext.hubspot_deal
      where createdate   >= now() - interval '8 days'
         or lastmodified >= now() - interval '8 days'
         or coalesce(is_closed, false) = false`
  );
  const deals = rows.map((r) => ({ id: r.id, properties: r.raw?.properties || {}, hist: r.raw?.stageHistory || [] }));

  const cards = [];

  // 1 — new deals this week (created 2026+)
  const newDeals = deals.filter((d) => {
    const c = tsOf(d.properties.createdate);
    return c >= wA && c < tD && c >= YEAR_CUTOFF;
  });
  if (newDeals.length) {
    const names = newDeals.slice(0, 3).map((d) => {
      const p = d.properties; const m = fmtMoney(p.amount);
      return (p.dealname || 'Untitled') + (m ? ` · ${m}` : '');
    });
    cards.push({
      id: 'new_deals', sev: 'info', icon: '🆕',
      title: `${newDeals.length} New Deal${newDeals.length !== 1 ? 's' : ''} This Week`,
      msg: names.join(', ') + (newDeals.length > 3 ? ` +${newDeals.length - 3} more` : ''),
      detail: {
        kind: 'deals',
        deals: newDeals.map((d) => {
          const p = d.properties;
          return { id: d.id, name: p.dealname || `Deal #${d.id}`, amount: fmtMoney(p.amount) || '—', stage: stageMap[p.dealstage] || p.dealstage || '—', created: (p.createdate || '').slice(0, 10), close: (p.closedate || '').slice(0, 10) };
        }),
      },
    });
  }

  // 2 — stage moves in the last 7 days (from stored dealstage history)
  const seen = new Set();
  for (const d of deals) {
    if (tsOf(d.properties.hs_lastmodifieddate) < wA) continue;
    const h = d.hist;
    if (!Array.isArray(h) || h.length < 2) continue;
    const inWin = h.filter((e) => tsOf(e.timestamp) >= wA && tsOf(e.timestamp) < tD);
    if (!inWin.length) continue;
    const newStage = inWin[0].value;                       // newest-first
    const older = h.filter((e) => tsOf(e.timestamp) < wA);
    const oldStage = older.length ? older[0].value : '';
    if (!oldStage || oldStage === newStage) continue;
    const key = `${d.id}:${oldStage}:${newStage}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const p = d.properties, m = fmtMoney(p.amount);
    const to = stageMap[newStage] || newStage, from = stageMap[oldStage] || oldStage;
    const { sev, icon } = stageSeverity(to);
    const movedTs = tsOf(inWin[0].timestamp);
    cards.push({
      id: `move_${d.id}`, sev, icon, title: p.dealname || `Deal #${d.id}`, msg: `${from} → ${to}${m ? ` · ${m}` : ''}`,
      detail: { kind: 'move', deal: { id: d.id, name: p.dealname || `Deal #${d.id}`, amount: m || '—', from, to, close: (p.closedate || '').slice(0, 10), movedAt: movedTs ? new Date(movedTs).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '' } },
    });
  }
  const stageMoves = cards.filter((c) => c.id.startsWith('move_')).length;

  // 3 — stalled open deals past close date
  const overdue = deals
    .filter((d) => d.properties.hs_is_closed !== 'true' && d.properties.closedate && tsOf(d.properties.closedate) < tD)
    .sort((a, b) => tsOf(a.properties.closedate) - tsOf(b.properties.closedate));
  if (overdue.length) {
    const names = overdue.slice(0, 3).map((d) => {
      const p = d.properties; const m = fmtMoney(p.amount);
      const over = p.closedate ? Math.round((Date.now() - tsOf(p.closedate)) / DAY) : null;
      return (p.dealname || 'deal') + (m ? ` · ${m}` : '') + (over != null ? ` · ${over}d overdue` : '');
    });
    cards.push({
      id: 'overdue', sev: 'fail', icon: '⏰',
      title: `${overdue.length} Stalled Deal${overdue.length !== 1 ? 's' : ''} — Past Close Date`,
      msg: names.join(', ') + (overdue.length > 3 ? ` +${overdue.length - 3} more` : ''),
      rec: 'Review and update close dates or move to Closed Lost',
      detail: {
        kind: 'deals', total: overdue.length,
        deals: overdue.map((d) => {
          const p = d.properties;
          const over = p.closedate ? Math.round((Date.now() - tsOf(p.closedate)) / DAY) : null;
          return { id: d.id, name: p.dealname || `Deal #${d.id}`, amount: fmtMoney(p.amount) || '—', close: (p.closedate || '').slice(0, 10), daysOverdue: over };
        }),
      },
    });
  }

  // 4 — at-risk deals (composite risk score). Scope: open deals created within
  // the last half-year only (ignore old lingering deals we no longer chase).
  const halfYearAgo = Date.now() - HALF_YEAR_MS;
  const scored = deals
    .filter((d) => d.properties.hs_is_closed !== 'true')
    .filter((d) => tsOf(d.properties.createdate) >= halfYearAgo)
    .map((d) => ({ d, r: dealRisk(d) }))
    .filter((x) => x.r.score >= 40)
    .sort((a, b) => b.r.score - a.r.score);
  const atRiskN = scored.filter((x) => x.r.score >= 70).length;
  const highValueN = scored.filter((x) => x.r.score >= 70 && Number(x.d.properties.amount) >= 5000).length;
  if (scored.length) {
    const top = scored.slice(0, 3).map((x) => {
      const p = x.d.properties; const m = fmtMoney(p.amount);
      return (p.dealname || 'deal') + (m ? ` · ${m}` : '') + ` · risk ${x.r.score}`;
    });
    cards.push({
      id: 'at_risk', sev: atRiskN ? 'fail' : 'warn', icon: '⚠️',
      title: atRiskN
        ? `${atRiskN} Deal${atRiskN !== 1 ? 's' : ''} At Risk${scored.length > atRiskN ? ` · ${scored.length - atRiskN} to watch` : ''}`
        : `${scored.length} Deal${scored.length !== 1 ? 's' : ''} to Watch`,
      msg: top.join(', ') + (scored.length > 3 ? ` +${scored.length - 3} more` : ''),
      rec: highValueN ? `${highValueN} high-value (≥$5k) — prioritize re-engagement` : 'Re-engage or update stalled deals',
      detail: {
        kind: 'deals', total: scored.length,
        deals: scored.map((x) => {
          const p = x.d.properties;
          return { id: x.d.id, name: p.dealname || `Deal #${x.d.id}`, amount: fmtMoney(p.amount) || '—', stage: stageMap[p.dealstage] || p.dealstage || '—', close: (p.closedate || '').slice(0, 10), score: x.r.score, band: x.r.band, reasons: x.r.reasons.join(', ') || '—', highValue: Number(p.amount) >= 5000 };
        }),
      },
    });
  }

  const rank = { fail: 0, warn: 1, info: 2, ok: 3 };
  cards.sort((a, b) => rank[a.sev] - rank[b.sev]);

  return { ok: true, count: cards.length, cards, brief: { newDeals: newDeals.length, stageMoves, overdue: overdue.length, atRisk: atRiskN, watch: scored.length - atRiskN }, error: null };
}

// Email activity by PM — outbound emails sent yesterday, from ext.hubspot_engagement.
async function computeEmail() {
  const yStart = dayStartMs(-1), yEnd = dayStartMs(0);
  const { rows } = await query(
    `select raw from ext.hubspot_engagement
      where direction <> 'inbound' and coalesce(owner_id, '') <> '' and ts >= $1 and ts < $2`,
    [new Date(yStart).toISOString(), new Date(yEnd).toISOString()],
  );
  const yest = rows.map((r) => r.raw);

  const byPm = {};
  for (const e of yest) (byPm[e.owner_id] = byPm[e.owner_id] || []).push(e);
  const ranked = Object.entries(byPm).sort((a, b) => b[1].length - a[1].length);
  const top3 = ranked.slice(0, 3);
  const topIds = new Set(top3.map(([oid]) => oid));
  const bot3 = ranked.slice(-3).filter(([oid]) => !topIds.has(oid));

  const owners = await ownerMapDb();
  const build = async ([oid, emails]) => {
    const name = owners[oid] || oid;
    const { overall, per } = await aiEmailSummary(name, emails);
    return {
      owner_id: oid, owner_name: name, count: emails.length, ai_summary: overall,
      emails: emails.slice(0, 15).map((e, i) => ({
        subject: e.subject, to: (e.to || []).slice(0, 5),
        date: e.timestamp ? new Date(e.timestamp).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '',
        summary: per[i] || '',
      })),
    };
  };
  const entries = await Promise.all([...top3, ...bot3].map(build));
  return {
    top: entries.filter((e) => topIds.has(e.owner_id)),
    bottom: entries.filter((e) => !topIds.has(e.owner_id)),
    total_emails_yesterday: yest.length,
    total_pms_active: Object.keys(byPm).length,
  };
}

// ── caches (DB reads are cheap, but the LLM email step is not — cache it). ──
let _cardsCache = null, _cardsInflight = null;
const CARDS_TTL = 20000;
function cardsBrief(force = false) {
  if (!force && _cardsCache && Date.now() - _cardsCache.at < CARDS_TTL) return Promise.resolve(_cardsCache.data);
  if (!force && _cardsInflight) return _cardsInflight;
  const p = computeCards()
    .catch((e) => ({ ok: false, count: 0, cards: [], error: String(e?.message || e) }))
    .then((data) => { _cardsCache = { at: Date.now(), data }; _cardsInflight = null; return data; });
  if (!force) _cardsInflight = p;
  return p;
}

let _fullCache = null, _fullInflight = null;
const FULL_TTL = 45000;
export async function hubspotBrief({ force = false } = {}) {
  if (!force && _fullCache && Date.now() - _fullCache.at < FULL_TTL) return _fullCache.data;
  if (!force && _fullInflight) return _fullInflight;
  const run = (async () => {
    const base = await cardsBrief(force);
    if (!base.ok) return base;
    let email_activity = null;
    try { email_activity = await computeEmail(); } catch { email_activity = null; }
    return { ...base, email_activity };
  })()
    .catch((e) => ({ ok: false, count: 0, cards: [], error: String(e?.message || e) }))
    .then((data) => { _fullCache = { at: Date.now(), data }; _fullInflight = null; return data; });
  if (!force) _fullInflight = run;
  return run;
}

export async function hubspotCount() {
  const r = await cardsBrief(false);
  return r.ok ? r.count : null;
}
