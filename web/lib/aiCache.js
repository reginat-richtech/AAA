// Client-side cache for the AI tabs so list↔detail navigation and tab switches
// are instant — no refetch per click. In-memory (survives client-side route
// changes within a session) + a sessionStorage mirror (survives full reloads),
// with a TTL and in-flight dedupe so concurrent callers share one request.
const TTL = 60_000; // 60s — matches the server-side brief cache window
const mem = new Map();       // endpoint -> { at, data }
const inflight = new Map();  // endpoint -> Promise

function fromSession(endpoint) {
  try {
    const raw = sessionStorage.getItem('ai-cache:' + endpoint);
    if (!raw) return null;
    const o = JSON.parse(raw);
    return Date.now() - o.at < TTL ? o : null;
  } catch { return null; }
}
function toSession(endpoint, entry) {
  try { sessionStorage.setItem('ai-cache:' + endpoint, JSON.stringify(entry)); } catch { /* quota / SSR */ }
}

// Synchronous peek — fresh cached data or null. Safe on the server (returns null).
export function peekAi(endpoint) {
  const m = mem.get(endpoint);
  if (m && Date.now() - m.at < TTL) return m.data;
  if (typeof window === 'undefined') return null;
  const s = fromSession(endpoint);
  if (s) { mem.set(endpoint, s); return s.data; }
  return null;
}

// Returns cached data if fresh (unless force), else fetches once (deduped).
// Only successful payloads are cached, so a transient error self-heals next time.
export function getAi(endpoint, { force = false } = {}) {
  if (!force) {
    const cached = peekAi(endpoint);
    if (cached != null) return Promise.resolve(cached);
  }
  if (inflight.has(endpoint)) return inflight.get(endpoint);
  const p = fetch(endpoint)
    .then((r) => r.json())
    .then((data) => {
      if (data && data.ok !== false) {
        const entry = { at: Date.now(), data };
        mem.set(endpoint, entry);
        toSession(endpoint, entry);
      }
      return data;
    })
    .finally(() => inflight.delete(endpoint));
  inflight.set(endpoint, p);
  return p;
}

// Fire-and-forget warm the cache for several endpoints (skips ones already fresh).
export function prefetchAi(endpoints) {
  if (typeof window === 'undefined') return;
  for (const ep of endpoints) {
    if (peekAi(ep) == null && !inflight.has(ep)) getAi(ep).catch(() => {});
  }
}
