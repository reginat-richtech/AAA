import { query } from '../../../../lib/db';
import { requireUser } from '../../../../lib/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Streams a Project Proposal's uploaded document (Site Survey / Deployment Plan /
// Packing List). The files live on JotForm and are PRIVATE — the public URL just
// redirects to a JotForm login — so we fetch them server-side with the API key and
// proxy the bytes back. ?doc=<type> picks the column; ?dl=1 forces download,
// otherwise it's served inline for in-browser preview.
const COL = {
  site_survey: 'site_survey_url',
  deployment: 'deployment_url',
  packing_list: 'packing_list_url',
};

// Filename = last path segment of the JotForm URL (matches what the form shows).
function fileName(url) {
  const raw = String(url).split('/').pop().split('?')[0];
  try { return decodeURIComponent(raw) || 'document'; } catch { return raw || 'document'; }
}
// JotForm serves uploads as application/octet-stream, so infer a real type from
// the extension — otherwise browsers download instead of previewing PDFs/images.
function contentType(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  return {
    pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    webp: 'image/webp', gif: 'image/gif',
  }[ext] || 'application/octet-stream';
}

export async function GET(request, { params }) {
  const { response } = await requireUser();
  if (response) return response;

  const { id } = await params;
  const sp = new URL(request.url).searchParams;
  const col = COL[sp.get('doc')];
  if (!col) return new Response('unknown doc type', { status: 400 });

  // col is from the fixed COL whitelist (not user input) → safe to interpolate.
  const { rows } = await query(`select ${col} as u from ops.project_proposal where id = $1`, [id]);
  const fileUrl = rows[0]?.u;
  if (!fileUrl) return new Response('not found', { status: 404 });

  const key = process.env.JOTFORM_API_KEY;
  const src = key ? `${fileUrl}${fileUrl.includes('?') ? '&' : '?'}apiKey=${encodeURIComponent(key)}` : fileUrl;
  const upstream = await fetch(src);
  if (!upstream.ok) return new Response('file unavailable from JotForm', { status: 502 });
  const buf = Buffer.from(await upstream.arrayBuffer());

  const name = fileName(fileUrl).replace(/[\r\n"]/g, '');
  const disposition = sp.get('dl') === '1' ? 'attachment' : 'inline';
  return new Response(buf, {
    headers: {
      'Content-Type': contentType(name),
      'Content-Disposition': `${disposition}; filename="${name}"`,
      'Cache-Control': 'private, max-age=300',
    },
  });
}
