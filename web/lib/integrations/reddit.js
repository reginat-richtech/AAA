// Reddit integration — STUB. Posting needs OAuth (a "script" app: client id +
// secret with username/password, or a refresh token) then POST /api/submit.
// Wire it here when credentials exist; until then publishToReddit degrades
// gracefully so the approval workflow still records the post.
export function redditConfigured() {
  return !!(process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET
    && (process.env.REDDIT_REFRESH_TOKEN || (process.env.REDDIT_USERNAME && process.env.REDDIT_PASSWORD)));
}

// Returns { ok, id } on success or { ok:false, skipped|error } so the action
// route can record the failure without throwing.
export async function publishToReddit(post) {
  if (!redditConfigured()) return { ok: false, skipped: 'Reddit API not configured' };
  if (!post.subreddit) return { ok: false, error: 'Reddit post needs a subreddit' };
  if (!post.title) return { ok: false, error: 'Reddit post needs a title' };
  // TODO: get an OAuth token, then POST https://oauth.reddit.com/api/submit
  //   { sr: post.subreddit, kind: 'self', title: post.title, text: post.content }
  //   (or kind: 'image'/'link' for media). Return { ok:true, id: name/permalink }.
  return { ok: false, skipped: 'Reddit publishing not implemented yet' };
}
