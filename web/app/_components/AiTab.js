'use client';
import { useEffect, useState, useCallback } from 'react';
import { PageHeader } from './blueprint';
import { getAi, peekAi } from '../../lib/aiCache';

// Shared two-pane shell for the AI tabs: live data panel on the left, chat on
// the right. Data is served from a shared client cache (see lib/aiCache) so
// switching tabs / opening an alert detail is instant; Refresh forces a refetch.
export default function AiTab({ title, sub, sheet, endpoint, chatScope, renderLeft }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback((force = false) => {
    const cached = force ? null : peekAi(endpoint);
    if (cached != null) { setData(cached); setLoading(false); } else { setLoading(true); }
    setErr(null);
    getAi(endpoint, { force })
      .then((d) => setData(d))
      .catch((e) => setErr(String(e?.message || e)))
      .finally(() => setLoading(false));
  }, [endpoint]);

  useEffect(() => { load(false); }, [load]);

  const count = data && data.count != null ? data.count : null;

  return (
    <>
      <PageHeader title={title} sub={sub} sheet={sheet} />
      <div className="split">
        <section className="panel">
          <div className="panel-title">
            <h2>{title}{count != null && <span className="chip" style={{ marginLeft: 8 }}>{count}</span>}</h2>
            <button className="secondary" onClick={() => load(true)} disabled={loading}>{loading ? '…' : '↻ Refresh'}</button>
          </div>
          {loading && !data && <p className="note">Loading…</p>}
          {!loading && err && <p className="error">{err}</p>}
          {data && data.ok === false && (
            <p className={data.pending ? 'note' : 'error'}>{data.error}</p>
          )}
          {data && data.ok !== false && renderLeft(data)}
        </section>
        <section className="panel">
          <div className="panel-title"><h2>AI chat</h2><span className="meta">{chatScope}</span></div>
          <div className="chat-soon note">
            💬 The conversational agent for this tab is the next phase.<br />
            The panel on the left is <b>live data</b> from your account.
          </div>
        </section>
      </div>
    </>
  );
}
