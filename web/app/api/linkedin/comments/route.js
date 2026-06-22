import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../lib/access';
import { getValidAccessToken, listComments } from '../../../../lib/integrations/linkedin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Read comments on a published post. ?post=<share/ugcPost URN>
export async function GET(req) {
  const { response } = await requireAdmin();
  if (response) return response;
  const postUrn = new URL(req.url).searchParams.get('post');
  if (!postUrn) return NextResponse.json({ error: 'post (URN) is required' }, { status: 400 });

  let token;
  try { token = await getValidAccessToken(); } catch (e) { return NextResponse.json({ error: String(e?.message || e) }, { status: 400 }); }
  if (!token) return NextResponse.json({ error: 'LinkedIn not connected.' }, { status: 400 });

  const r = await listComments({ token, postUrn });
  return NextResponse.json(r, { status: r.ok ? 200 : 502 });
}
