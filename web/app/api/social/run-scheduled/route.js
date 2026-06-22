import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../lib/access';
import { publishDuePosts } from '../../../../lib/social/runScheduled';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Cron caller with the shared secret, or a signed-in admin (same scheme as data-sync).
async function authorize(req) {
  const secret = process.env.SYNC_CRON_SECRET;
  const auth = req.headers.get('authorization') || '';
  if (secret && auth === `Bearer ${secret}`) return { ok: true };
  if (auth.startsWith('Bearer ')) return { ok: false, response: NextResponse.json({ error: 'Invalid cron secret' }, { status: 401 }) };
  const { response } = await requireAdmin();
  if (response) return { ok: false, response };
  return { ok: true };
}

// Publish every approved post whose scheduled time has arrived. Shares
// publishDuePosts() with the in-app minute scheduler (instrumentation.js), so a
// manual/cron call and the background timer do exactly the same thing.
async function handle(req) {
  const a = await authorize(req);
  if (!a.ok) return a.response;
  try {
    const results = await publishDuePosts();
    return NextResponse.json({ ran: results.length, results });
  } catch (e) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
