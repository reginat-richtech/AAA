// Shared "publish due posts" logic, used by BOTH the cron endpoint
// (/api/social/run-scheduled) and the in-app minute scheduler (instrumentation.js).
// Publishes every APPROVED post whose scheduled time has arrived. A post with no
// scheduled_at is never auto-published — it waits for a manual "Publish now".
import { query } from '../db';
import { publishToX } from '../integrations/x';
import { publishToFacebook } from '../integrations/facebook';
import { publishToLinkedin } from '../integrations/linkedin';
import { publishToInstagram } from '../integrations/instagram';

const COLS = `id, platform, author_email, author_name, content, image_url, scheduled_at,
  status, reviewer_email, reviewer_note, published_at, x_post_id, created_at, updated_at`;

const publisher = (platform) =>
  platform === 'facebook' ? publishToFacebook
    : platform === 'linkedin' ? publishToLinkedin
    : platform === 'instagram' ? publishToInstagram
    : publishToX;

export async function publishDuePosts() {
  const { rows } = await query(
    `select ${COLS} from ext.social_post
     where status = 'approved' and scheduled_at is not null and scheduled_at <= now()
     order by scheduled_at asc limit 25`,
  );
  const results = [];
  for (const post of rows) {
    let res;
    try { res = await publisher(post.platform)(post); }
    catch (e) { res = { ok: false, error: String(e?.message || e) }; }
    if (res.ok) {
      await query(
        `update ext.social_post set status='published', x_post_id=$2, published_at=now(), updated_at=now() where id=$1`,
        [post.id, res.id || null],
      );
      results.push({ id: post.id, platform: post.platform, ok: true, post_id: res.id || null });
    } else {
      // Mark rejected with the reason so it doesn't retry every minute forever;
      // the author can fix and re-approve to reschedule.
      const why = `auto-publish failed: ${res.skipped || res.error || 'unknown'}`.slice(0, 500);
      await query(
        `update ext.social_post set status='rejected', reviewer_note=$2, updated_at=now() where id=$1`,
        [post.id, why],
      );
      results.push({ id: post.id, platform: post.platform, ok: false, error: res.skipped || res.error });
    }
  }
  return results;
}
