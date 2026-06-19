'use client';
import { useEffect, useState, useCallback } from 'react';
import { PageHeader, StageRail } from '../_components/blueprint';

// Per-platform character caps (X enforces 280; Reddit is effectively long-form).
const LIMITS = { x: 280, reddit: 40000 };
const PLATFORMS = [
  { key: 'x', label: 'X' },
  { key: 'reddit', label: 'Reddit' },
];
const PLATFORM_LABEL = { x: 'X', reddit: 'Reddit' };

// The social workflow stages, mirroring the Project Tracker's stage model.
const SOCIAL_STAGES = [
  { key: 'draft', label: 'Draft', color: '#94a3b8', tracked: true },
  { key: 'submitted', label: 'Submitted', color: '#0ea5e9', tracked: true },
  { key: 'approved', label: 'Approved', color: '#16a34a', tracked: true },
  { key: 'published', label: 'Published', color: '#1d4ed8', tracked: true },
];
const ORDER = ['draft', 'submitted', 'approved', 'published'];
const STATUS_CHIP = { draft: '', submitted: 'info', approved: 'ok', rejected: 'bad', published: 'ok' };
const PRIORITY = { submitted: 0, approved: 1, draft: 2, rejected: 3, published: 4 };
const EMPTY = { id: null, platform: 'x', content: '', title: '', subreddit: '', scheduled_at: '', image_url: '', status: 'draft' };

function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso); if (isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
const fmtWhen = (iso) => (iso ? new Date(iso).toLocaleString() : 'not scheduled');

// Per-post horizontal progress rail (like the Project Tracker's ProjectRail).
function SocialRail({ status }) {
  const idx = status === 'rejected' ? 1 : ORDER.indexOf(status);
  return (
    <div className="srail">
      {SOCIAL_STAGES.map((s, i) => {
        const reached = i <= idx;
        const isRej = status === 'rejected' && s.key === 'submitted';
        const color = isRej ? '#dc2626' : s.color;
        const isFirst = i === 0, isLast = i === SOCIAL_STAGES.length - 1;
        const nodeStyle = reached ? { background: color, borderColor: color } : { background: '#fff', borderColor: 'var(--line)' };
        const lblStyle = reached ? { color, fontWeight: i === idx ? 700 : 500 } : { color: 'var(--muted)' };
        return (
          <div className="sr-col" key={s.key}>
            <div className="sr-track">
              <span className="sr-line" style={{ background: isFirst ? 'transparent' : (i - 1 < idx ? SOCIAL_STAGES[i - 1].color : 'var(--line)') }} />
              <span className="sr-node" style={nodeStyle} />
              <span className="sr-line" style={{ background: isLast ? 'transparent' : (i < idx ? s.color : 'var(--line)') }} />
            </div>
            <div className="sr-lbl" style={lblStyle}>{isRej ? 'Rejected' : s.label}</div>
          </div>
        );
      })}
    </div>
  );
}

// A live X (Twitter) preview of how the post will look once published.
function TweetPreview({ name, handle, avatarUrl, content, media = [], postId }) {
  const clean = String(name || 'You');
  const at = handle ? '@' + String(handle).replace(/^@/, '') : '@' + (clean.toLowerCase().replace(/[^a-z0-9._]/g, '').slice(0, 15) || 'user');
  const initials = (clean.replace(/[^a-zA-Z ]/g, '').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()) || 'U';
  const url = (m) => `/api/social/${postId}/media/${m.id}`;
  const vids = media.filter((m) => m.kind === 'video');
  const imgs = media.filter((m) => m.kind === 'image').slice(0, 4);
  return (
    <div className="tw">
      <div className="tw-head">
        <div className="tw-av">{avatarUrl ? <img src={avatarUrl} alt="" /> : initials}</div>
        <div><div className="tw-name">{clean}</div><div className="tw-handle">{at} · now</div></div>
      </div>
      <div className={'tw-text' + (content ? '' : ' tw-empty')}>{content || "What's happening?"}</div>
      {vids.length ? (
        <div className="tw-media n1"><video src={url(vids[0])} controls /></div>
      ) : imgs.length ? (
        <div className={`tw-media n${imgs.length}`}>{imgs.map((m) => <img key={m.id} src={url(m)} alt="" />)}</div>
      ) : null}
      <div className="tw-actions"><span>💬</span><span>🔁</span><span>♡</span><span>↗</span></div>
    </div>
  );
}

// A live Reddit preview (subreddit · title · body · one media tile).
function RedditPreview({ subreddit, title, content, media = [], postId, author }) {
  const sr = 'r/' + (String(subreddit || '').replace(/^\/?r\//i, '') || 'subreddit');
  const who = String(author || 'you').replace(/^@/, '').split('@')[0].slice(0, 20) || 'you';
  const url = (m) => `/api/social/${postId}/media/${m.id}`;
  const vid = media.find((m) => m.kind === 'video');
  const img = media.find((m) => m.kind === 'image');
  return (
    <div className="rd">
      <div className="rd-head">
        <div className="rd-srav">r/</div>
        <div><div className="rd-sr">{sr}</div><div className="rd-meta">Posted by u/{who} · now</div></div>
      </div>
      <div className={'rd-title' + (title ? '' : ' rd-empty')}>{title || 'An interesting title'}</div>
      {content ? <div className="rd-text">{content}</div> : null}
      {vid ? (
        <div className="rd-media"><video src={url(vid)} controls /></div>
      ) : img ? (
        <div className="rd-media"><img src={url(img)} alt="" /></div>
      ) : null}
      <div className="rd-actions"><span>⬆ Vote</span><span>💬 Comments</span><span>↗ Share</span></div>
    </div>
  );
}

const STYLE = `
  .sgrid { display:flex; flex-direction:column; gap:10px; }
  .spost { display:block; width:100%; text-align:left; background:var(--surface); border:1px solid var(--line); border-radius:10px; padding:12px 14px; cursor:pointer; color:var(--ink); font:inherit; box-shadow:var(--shadow); }
  .spost:hover { border-color:var(--primary); background:var(--surface); }
  .sp-top { display:flex; align-items:center; gap:8px; }
  .sp-body { margin:8px 0; white-space:pre-wrap; word-break:break-word; font-size:13.5px; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
  .sp-title { font-weight:600; font-size:13.5px; margin:8px 0 2px; }
  .srail { display:flex; align-items:flex-start; margin-top:4px; }
  .sr-col { flex:1; min-width:0; display:flex; flex-direction:column; align-items:center; }
  .sr-track { display:flex; align-items:center; width:100%; }
  .sr-line { height:2.5px; flex:1 1 auto; border-radius:2px; }
  .sr-node { width:12px; height:12px; border-radius:50%; border:2px solid var(--line); background:#fff; flex:0 0 auto; }
  .sr-lbl { font-size:9.5px; line-height:1.2; margin-top:4px; text-align:center; }
  .sd-label { display:grid; gap:4px; font-size:13px; color:var(--muted); }
  .sed input, .sed textarea { width:100%; }
  .sd-actions { display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin-top:14px; }
  .sd-media { display:flex; flex-wrap:wrap; gap:8px; margin:6px 0; }
  .sm-item { position:relative; width:96px; height:96px; border:1px solid var(--line); border-radius:8px; overflow:hidden; background:#0b1220; }
  .sm-item img, .sm-item video { width:100%; height:100%; object-fit:cover; display:block; }
  .sm-del { position:absolute; top:3px; right:3px; width:20px; height:20px; padding:0; border-radius:50%; font-size:11px; line-height:1; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,.6); color:#fff; border:0; }
  .sm-del:hover { background:rgba(0,0,0,.85); }
  .seg { display:inline-flex; border:1px solid var(--line); border-radius:8px; overflow:hidden; width:fit-content; }
  .seg-btn { padding:7px 18px; border:0; background:var(--surface); color:var(--muted); font:inherit; cursor:pointer; }
  .seg-btn + .seg-btn { border-left:1px solid var(--line); }
  .seg-btn.on { background:var(--primary); color:#fff; font-weight:600; }
  .pbadge { font-size:10px; font-weight:700; padding:1px 7px; border-radius:999px; color:#fff; letter-spacing:.02em; }
  .pbadge[data-p="reddit"] { background:#ff4500; }
  .pbadge[data-p="x"] { background:#0f1419; }
  .tw { border:1px solid #cfd9de; border-radius:16px; padding:12px 14px; background:#fff; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; }
  .tw-head { display:flex; align-items:center; gap:10px; }
  .tw-av { width:40px; height:40px; border-radius:50%; background:#1d9bf0; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:14px; flex:0 0 auto; overflow:hidden; }
  .tw-av img { width:100%; height:100%; object-fit:cover; }
  .tw-name { font-weight:700; font-size:15px; color:#0f1419; line-height:1.2; }
  .tw-handle { color:#536471; font-size:13px; }
  .tw-text { margin:10px 0; font-size:15px; line-height:1.4; color:#0f1419; white-space:pre-wrap; word-break:break-word; }
  .tw-text.tw-empty { color:#8b98a5; }
  .tw-media { display:grid; gap:2px; border-radius:16px; overflow:hidden; border:1px solid #cfd9de; margin-top:2px; }
  .tw-media.n2, .tw-media.n3, .tw-media.n4 { grid-template-columns:1fr 1fr; }
  .tw-media img, .tw-media video { width:100%; height:100%; object-fit:cover; display:block; aspect-ratio:16/10; background:#000; }
  .tw-media.n3 img:first-child { grid-row:span 2; aspect-ratio:auto; height:100%; }
  .tw-actions { display:flex; gap:38px; margin-top:10px; color:#536471; font-size:14px; }
  .rd { border:1px solid #ccc; border-radius:8px; padding:12px 14px; background:#fff; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; }
  .rd-head { display:flex; align-items:center; gap:8px; }
  .rd-srav { width:28px; height:28px; border-radius:50%; background:#ff4500; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:12px; flex:0 0 auto; }
  .rd-sr { font-weight:700; font-size:13px; color:#1a1a1b; line-height:1.2; }
  .rd-meta { color:#7c7c7c; font-size:12px; }
  .rd-title { margin:10px 0 6px; font-size:17px; font-weight:600; color:#222; line-height:1.3; word-break:break-word; }
  .rd-title.rd-empty { color:#a8a8a8; font-weight:500; }
  .rd-text { font-size:14px; line-height:1.5; color:#1a1a1b; white-space:pre-wrap; word-break:break-word; }
  .rd-media { margin-top:8px; border:1px solid #e2e2e2; border-radius:8px; overflow:hidden; }
  .rd-media img, .rd-media video { width:100%; display:block; max-height:340px; object-fit:contain; background:#000; }
  .rd-actions { display:flex; gap:20px; margin-top:12px; color:#878a8c; font-size:13px; font-weight:600; }
`;

export default function Social() {
  const [data, setData] = useState({ isAdmin: false, email: '', posts: [] });
  const [form, setForm] = useState(null);   // null = list view; otherwise the full-page editor
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = useCallback(() => {
    fetch('/api/social').then((r) => r.json()).then((d) => { if (d && !d.error) setData(d); }).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const setF = (k, v) => setForm((s) => ({ ...s, [k]: v }));
  const openNew = () => { setMsg(null); setForm({ ...EMPTY }); window.scrollTo({ top: 0 }); };
  const openPost = (p) => { setMsg(null); setForm({ id: p.id, platform: p.platform || 'x', content: p.content || '', title: p.title || '', subreddit: p.subreddit || '', scheduled_at: toLocalInput(p.scheduled_at), image_url: p.image_url || '', status: p.status }); window.scrollTo({ top: 0 }); };
  const close = () => { setForm(null); setMsg(null); };

  // Shared body for create/save — keeps platform-specific fields together.
  const payloadOf = (f) => ({ platform: f.platform, content: f.content, title: f.title || null, subreddit: f.subreddit || null, scheduled_at: f.scheduled_at || null, image_url: f.image_url || null });

  async function save(submit) {
    setBusy(true); setMsg(null);
    try {
      const payload = payloadOf(form);
      const r = form.id
        ? await fetch(`/api/social/${form.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
        : await fetch('/api/social', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      const row = await r.json();
      if (!r.ok) { setMsg({ err: row.error || 'Save failed' }); setBusy(false); return; }
      if (submit) {
        const ar = await fetch(`/api/social/${row.id}/action`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'submit' }) });
        const aj = await ar.json();
        if (!ar.ok) { setMsg({ err: aj.error || 'Submit failed' }); setBusy(false); load(); return; }
        setBusy(false); close(); load(); return;
      }
      setForm((s) => ({ ...s, id: row.id, status: row.status }));
      setMsg({ ok: 'Saved.' }); setBusy(false); load();
    } catch (e) { setMsg({ err: String(e?.message || e) }); setBusy(false); }
  }

  async function act(id, action, extra = {}) {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/social/${id}/action`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, ...extra }) });
      const j = await r.json();
      if (!r.ok) { setMsg({ err: j.error || `${action} failed` }); setBusy(false); return; }
      if (action === 'publish' && j.ok === false) { setMsg({ err: `Not published — ${j.skipped}` }); setBusy(false); load(); return; }
      setBusy(false); close(); load();
    } catch (e) { setMsg({ err: String(e?.message || e) }); setBusy(false); }
  }

  async function del(id) {
    if (!confirm('Delete this post?')) return;
    setBusy(true); await fetch(`/api/social/${id}`, { method: 'DELETE' }).catch(() => {}); setBusy(false); close(); load();
  }

  async function uploadMedia(fileList) {
    const files = Array.from(fileList || []); if (!files.length) return;
    setBusy(true); setMsg(null);
    try {
      let id = form.id;
      if (!id) {
        const r = await fetch('/api/social', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payloadOf(form)) });
        const row = await r.json();
        if (!r.ok) { setMsg({ err: row.error || 'Save failed' }); setBusy(false); return; }
        id = row.id; setForm((s) => ({ ...s, id: row.id, status: row.status }));
      }
      const fd = new FormData(); for (const f of files) fd.append('file', f);
      const ur = await fetch(`/api/social/${id}/media`, { method: 'POST', body: fd });
      const uj = await ur.json();
      setMsg(ur.ok ? { ok: `Uploaded ${uj.media?.length || 0} file(s).` } : { err: uj.error || 'Upload failed' });
    } catch (e) { setMsg({ err: String(e?.message || e) }); }
    setBusy(false); load();
  }
  async function delMedia(mid) {
    setBusy(true); await fetch(`/api/social/${form.id}/media/${mid}`, { method: 'DELETE' }).catch(() => {}); setBusy(false); load();
  }

  const counts = {}; for (const s of ORDER) counts[s] = 0;
  let rejected = 0;
  for (const p of data.posts) { if (p.status === 'rejected') rejected++; else if (counts[p.status] != null) counts[p.status]++; }
  const posts = [...data.posts].sort((a, b) => (PRIORITY[a.status] ?? 9) - (PRIORITY[b.status] ?? 9) || new Date(b.updated_at) - new Date(a.updated_at));
  const isReddit = form?.platform === 'reddit';
  const limit = form ? (LIMITS[form.platform] || 280) : 280;
  const over = !!form && form.content.length > limit;
  // Reddit needs a subreddit + title; X needs body text.
  const canSubmit = form && (isReddit ? (!!form.subreddit.trim() && !!form.title.trim()) : !!form.content.trim());
  const isDraftish = form && (!form.id || form.status === 'draft' || form.status === 'rejected');
  const isReview = form && data.isAdmin && form.id && (form.status === 'submitted' || form.status === 'approved');
  const editingPost = form?.id ? data.posts.find((p) => p.id === form.id) : null;
  const currentMedia = editingPost?.media || [];
  const xacct = data.xAccount;
  const previewName = xacct?.name || editingPost?.author_name || editingPost?.author_email || data.email || 'You';
  const previewHandle = xacct?.username || null;
  const previewAvatar = xacct?.profile_image_url || null;
  const redditAuthor = editingPost?.author_name || editingPost?.author_email || data.email || 'you';

  // ── Full-page editor ──────────────────────────────────────────────────────
  if (form) {
    return (
      <>
        <PageHeader title={form.id ? 'Edit post' : 'New post'} sub="Compose, attach media, and preview exactly how it will appear on X or Reddit." sheet="Social Media" />
        <div className="toolbar">
          <button className="secondary" onClick={close}>← Back to posts</button>
          {form.id && <span className={'chip ' + (STATUS_CHIP[form.status] || '')}>{form.status}</span>}
        </div>

        <div className="split">
          <section className="panel sed">
            <div className="sd-label">Platform
              {isDraftish ? (
                <div className="seg">
                  {PLATFORMS.map((pl) => (
                    <button type="button" key={pl.key} className={'seg-btn' + (form.platform === pl.key ? ' on' : '')} onClick={() => setF('platform', pl.key)}>{pl.label}</button>
                  ))}
                </div>
              ) : (
                <div><span className="pbadge" data-p={form.platform}>{PLATFORM_LABEL[form.platform] || form.platform}</span></div>
              )}
            </div>

            {isReddit && (
              <>
                <label className="sd-label" style={{ marginTop: 12 }}>Subreddit
                  <input value={form.subreddit} onChange={(e) => setF('subreddit', e.target.value)} placeholder="e.g. robotics (no “r/”)" />
                </label>
                <label className="sd-label" style={{ marginTop: 12 }}>Title
                  <input value={form.title} onChange={(e) => setF('title', e.target.value)} placeholder="Post title" maxLength={300} />
                  <span className="note">{form.title.length} / 300</span>
                </label>
              </>
            )}

            <label className="sd-label" style={{ marginTop: 12 }}>{isReddit ? 'Body text (optional)' : 'Post text'}
              <textarea rows={8} value={form.content} onChange={(e) => setF('content', e.target.value)} placeholder={isReddit ? 'Add text, or leave empty for a title-only / media post' : "What's happening?"} />
            </label>
            <div className="note" style={{ marginTop: -2, color: over ? 'var(--bad)' : 'var(--muted)' }}>{form.content.length} / {limit}</div>

            <label className="sd-label" style={{ marginTop: 12 }}>Send time
              <input type="datetime-local" value={form.scheduled_at} onChange={(e) => setF('scheduled_at', e.target.value)} />
            </label>

            <div className="sd-label" style={{ marginTop: 12 }}>Media (images / video)
              {currentMedia.length > 0 && (
                <div className="sd-media">
                  {currentMedia.map((m) => (
                    <div className="sm-item" key={m.id}>
                      {m.kind === 'video'
                        ? <video src={`/api/social/${form.id}/media/${m.id}`} muted />
                        : <img src={`/api/social/${form.id}/media/${m.id}`} alt={m.filename || ''} />}
                      <button type="button" className="sm-del" onClick={() => delMedia(m.id)} disabled={busy} aria-label="Remove">✕</button>
                    </div>
                  ))}
                </div>
              )}
              <input type="file" accept="image/*,video/*" multiple onChange={(e) => { uploadMedia(e.target.files); e.target.value = ''; }} disabled={busy} />
              <span className="note">Images up to 10 MB · video up to 50 MB.</span>
            </div>

            {msg?.ok && <p className="ok-msg">{msg.ok}</p>}{msg?.err && <p className="error">{msg.err}</p>}

            <div className="sd-actions">
              {(isDraftish || data.isAdmin) && <button className="secondary" onClick={() => save(false)} disabled={busy || over}>{form.id ? 'Save' : 'Save draft'}</button>}
              {isDraftish && <button onClick={() => save(true)} disabled={busy || over || !canSubmit}>Submit for approval</button>}
              {isReview && <button onClick={() => act(form.id, 'approve', payloadOf(form))} disabled={busy || over}>Approve</button>}
              {isReview && <button className="secondary" onClick={() => act(form.id, 'reject', { note: prompt('Reason for rejection (optional):') ?? '' })} disabled={busy}>Reject</button>}
              {data.isAdmin && form.status === 'approved' && <button onClick={() => act(form.id, 'publish')} disabled={busy}>Publish now</button>}
              {form.id && (isDraftish || data.isAdmin) && <button className="secondary" onClick={() => del(form.id)} disabled={busy} style={{ marginLeft: 'auto' }}>Delete</button>}
            </div>
          </section>

          <section className="panel">
            <div className="panel-title"><h2>{isReddit ? 'Reddit preview' : 'X preview'}</h2><span className="meta">how it'll look on {PLATFORM_LABEL[form.platform]}</span></div>
            {isReddit
              ? <RedditPreview subreddit={form.subreddit} title={form.title} content={form.content} media={currentMedia} postId={form.id} author={redditAuthor} />
              : <TweetPreview name={previewName} handle={previewHandle} avatarUrl={previewAvatar} content={form.content} media={currentMedia} postId={form.id} />}
          </section>
        </div>
        <style>{STYLE}</style>
      </>
    );
  }

  // ── List / tracker view ───────────────────────────────────────────────────
  return (
    <>
      <PageHeader title="Social Media" sub="Draft posts for X or Reddit, schedule a send time, and route them through manager approval." sheet="Social Media" />

      <section className="panel">
        <div className="panel-title"><h2>Post tracker</h2><span className="meta">draft → submitted → approved → published</span></div>
        <StageRail stages={SOCIAL_STAGES} counts={counts} />
        {rejected > 0 && <p className="note" style={{ marginTop: 10 }}>⚑ <b>{rejected}</b> rejected — needs revision.</p>}
      </section>

      <div className="toolbar">
        <button onClick={openNew}>+ New post</button>
        <span className="note">{posts.length} post(s) {data.isAdmin ? '(all authors)' : ''}</span>
      </div>

      <div className="sgrid">
        {posts.length ? posts.map((p) => (
          <button className="spost" key={p.id} onClick={() => openPost(p)}>
            <div className="sp-top">
              <span className="pbadge" data-p={p.platform || 'x'}>{PLATFORM_LABEL[p.platform] || 'X'}</span>
              <span className={'chip ' + (STATUS_CHIP[p.status] || '')}>{p.status}</span>
              {data.isAdmin && <span className="note">{p.author_name || p.author_email}</span>}
              {p.media?.length > 0 && <span className="note">📎 {p.media.length}</span>}
              <span className="note" style={{ marginLeft: 'auto' }}>📅 {fmtWhen(p.scheduled_at)}</span>
            </div>
            {p.platform === 'reddit' && (p.subreddit || p.title) && (
              <div className="sp-title">{p.subreddit ? `r/${p.subreddit} · ` : ''}{p.title || ''}</div>
            )}
            <div className="sp-body">{p.content || (p.platform === 'reddit' && p.title ? <span className="note">(title-only / media)</span> : <span className="note">(empty)</span>)}</div>
            <SocialRail status={p.status} />
          </button>
        )) : <p className="note">No posts yet — click “+ New post”.</p>}
      </div>

      <style>{STYLE}</style>
    </>
  );
}
