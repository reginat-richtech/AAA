import { NextResponse } from 'next/server';
import { query } from '../../../../lib/db';
import { getJotformSubmission } from '../../../../lib/jotform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Records a JotForm workflow stage event (idempotent on submission_id + stage).
// Accepts POST (normal JotForm delivery) AND GET (JotForm "GET" webhooks + the
// connection test). Point a webhook here with ?stage=<name> (e.g. ?stage=approved);
// the Project Tracker reads these to advance the "Trip & Travel" stage.
async function handle(request) {
  const url = new URL(request.url);
  const q = url.searchParams;

  // Optional shared-secret gate: if JOTFORM_WEBHOOK_SECRET is set, require ?token=.
  const secret = process.env.JOTFORM_WEBHOOK_SECRET;
  if (secret && q.get('token') !== secret) {
    return NextResponse.json({ error: 'invalid token' }, { status: 401 });
  }

  // POST carries the submission in the body; GET carries it on the query string.
  // Read the body ONCE (reading json() first would consume the stream).
  let body = {};
  if (request.method === 'POST') {
    const ct = request.headers.get('content-type') || '';
    try { body = ct.includes('application/json') ? await request.json() : Object.fromEntries(await request.formData()); }
    catch { body = {}; }
  }
  const pick = (...keys) => {
    for (const k of keys) { if (body[k] != null) return body[k]; const v = q.get(k); if (v != null) return v; }
    return null;
  };

  const stage = q.get('stage') || body.stage;
  if (!stage) return NextResponse.json({ error: 'stage is required (?stage=...)' }, { status: 400 });

  const submission_id = pick('submissionID', 'submission_id', 'so_number');
  const form_id = pick('formID', 'form_id');

  // A bare connection test (no submission) succeeds without writing a junk row.
  if (submission_id) {
    const payload = Object.keys(body).length ? body : Object.fromEntries(q);
    // Travel Request Form approval (?stage=travel…): the Project Tracker matches
    // it to a project by SO number, which the delivery doesn't carry. An explicit
    // ?so_number= wins; otherwise read it back off the submission (field "soOr"),
    // mirroring the tech-confirmation webhook's auto-capture and the old app.
    if (String(stage).startsWith('travel') && !payload.so_number) {
      const explicit = pick('so_number', 'soOr', 'so');
      if (explicit) {
        payload.so_number = String(explicit);
      } else {
        const f = await getJotformSubmission(submission_id);
        if (f.ok) {
          for (const a of Object.values(f.answers || {})) {
            if (a && a.name === 'soOr' && String(a.answer || '').trim()) { payload.so_number = String(a.answer).trim(); break; }
          }
        }
      }
    }
    await query(
      `insert into ops.jotform_stage_event (form_id, submission_id, stage, payload)
       values ($1,$2,$3,$4) on conflict (submission_id, stage) do nothing`,
      [form_id, submission_id, stage, JSON.stringify(payload)],
    );
  }
  return NextResponse.json({ ok: true, stage, recorded: !!submission_id });
}

export const GET = handle;
export const POST = handle;
