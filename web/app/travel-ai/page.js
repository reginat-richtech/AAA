'use client';
import { useEffect, useState, useCallback } from 'react';
import { PageHeader } from '../_components/blueprint';

const money = (n) => '$' + Math.round(Number(n) || 0).toLocaleString();

export default function TravelAI() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true); setErr(null);
    fetch(`/api/ai/travel?days=${days}`)
      .then((r) => r.json())
      .then((d) => { setData(d); if (d && d.ok === false) setErr(d.error || 'Unavailable'); })
      .catch((e) => setErr(String(e?.message || e)))
      .finally(() => setLoading(false));
  }, [days]);
  useEffect(() => { load(); }, [load]);

  const s = data && data.ok !== false ? data.summary : null;

  return (
    <>
      <PageHeader title="Travel AI" sub="Navan bookings — flagged trips, traveler spend, and budget compliance." sheet="Travel AI" />
      <div className="split">
        <section className="panel">
          <div className="panel-title">
            <h2>Travel Expense Review{data?.count != null && <span className="chip bad" style={{ marginLeft: 8 }}>{data.count}</span>}</h2>
            <button className="secondary" onClick={load} disabled={loading}>{loading ? '…' : '↻'}</button>
          </div>

          <div className="seg">
            <button className={days === 7 ? 'on' : ''} onClick={() => setDays(7)}>Last 7 Days</button>
            <button className={days === 30 ? 'on' : ''} onClick={() => setDays(30)}>Last 30 Days</button>
          </div>

          {loading && <p className="note">Loading…</p>}
          {!loading && err && <p className="error">{err}</p>}
          {!loading && !err && s && (
            <>
              <h3 style={{ marginBottom: 4 }}>Executive brief</h3>
              <p className="note" style={{ marginTop: 0 }}>
                In the last {data.days} days there were <b>{s.trips} trips</b> totaling <b>{money(s.totalSpend)}</b>.
                {' '}{s.flights.count} flights (avg {money(s.flights.avg)}) and {s.hotels.count} hotel stays (avg {money(s.hotels.avgPerNight)}/night).
                {' '}{s.overBudget} over budget, {s.weekend} over a weekend.
                {s.trfConnected && <>{' '}<b>{s.missingTRF}</b> with no matching Travel Request Form.</>}
              </p>

              <div className="flag-head">
                {s.flaggedCount} flagged trip{s.flaggedCount === 1 ? '' : 's'} need review
                <span className="note"> · {money(s.flaggedSpend)} · Last {data.days} Days</span>
              </div>

              {data.travelers.length === 0 && <p className="note">No bookings in this window.</p>}
              <div className="travelers">
                {data.travelers.map((t, i) => (
                  <div className="trow" key={i}>
                    <span className="tname">{t.name}</span>
                    <span className="tflags">
                      {t.flights > 0 && <span className="tflag" title="flights">✈ {t.flights}</span>}
                      {t.hotels > 0 && <span className="tflag" title="hotel stays">🏨 {t.hotels}</span>}
                      {t.flagged > 0 && <span className="tflag bad" title="flagged bookings">⚑ {t.flagged}</span>}
                      {t.approxTRF > 0 && <span className="tflag" title="early/late vs Travel Request Form">⏰ {t.approxTRF}</span>}
                      {t.missingTRF > 0 && <span className="tflag bad" title="no matching Travel Request Form">❌ {t.missingTRF}</span>}
                    </span>
                    <span className="tamt">{money(t.spend)}</span>
                  </div>
                ))}
              </div>

              <div className="travel-legend">
                <div className="tl-group">
                  <span className="tl-h">Booking type</span>
                  <span className="tl-chip" style={{ background: 'rgba(191,219,254,.92)', borderColor: '#7dd3fc' }}>✈ Flight</span>
                  <span className="tl-chip" style={{ background: 'rgba(167,243,208,.92)', borderColor: '#6ee7b7' }}>🏨 Hotel</span>
                  <span className="tl-chip" style={{ background: 'rgba(221,214,254,.92)', borderColor: '#c4b5fd' }}>✈🏨 Flight + Hotel</span>
                </div>
                <div className="tl-group">
                  <span className="tl-h">Flags</span>
                  <span className="tl-item"><i className="m" style={{ background: 'var(--warn)' }} /> Over budget <span className="tl-sub">flights &gt; $500 RT / $250 OW · hotels &gt; $200/night</span></span>
                  <span className="tl-item">🚩 Weekend travel <span className="tl-sub">trip starts Sat/Sun</span></span>
                  <span className="tl-item" style={{ color: 'var(--bad)' }}>⚑ Flagged <span className="tl-sub">over budget or weekend — needs review</span></span>
                </div>
                <div className="tl-group">
                  <span className="tl-h">Travel Request Form <span className="tl-sub" style={{ textTransform: 'none', letterSpacing: 0 }}>· shown when a matching Travel Request Form is found</span></span>
                  <span className="tl-item">✅ Matched TRF <span className="tl-sub">booking linked to a request form</span></span>
                  <span className="tl-item">⏰ Early / late flight <span className="tl-sub">within ±2 days of the TRF dates</span></span>
                  <span className="tl-item">❌ No TRF match <span className="tl-sub">no request form found</span></span>
                </div>
                <style>{`
                  .travel-legend { margin-top:14px; padding-top:12px; border-top:1px dashed var(--line); display:flex; flex-direction:column; gap:10px; }
                  .tl-group { display:flex; flex-wrap:wrap; align-items:center; gap:6px 12px; }
                  .tl-h { font-family:var(--font-mono); font-size:10px; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); margin-right:4px; }
                  .tl-chip { display:inline-flex; align-items:center; gap:4px; font-size:12px; padding:2px 8px; border:1px solid; border-radius:999px; color:var(--ink); }
                  .tl-item { display:inline-flex; align-items:center; gap:5px; font-size:12.5px; color:var(--ink); }
                  .tl-item .m { width:10px; height:10px; border-radius:50%; display:inline-block; flex:0 0 auto; }
                  .tl-sub { color:var(--muted); font-size:11.5px; }
                `}</style>
              </div>
            </>
          )}
        </section>

        <section className="panel">
          <div className="panel-title"><h2>AI chat</h2><span className="meta">Bookings · per-diem · spend</span></div>
          <div className="chat-soon note">
            💬 The Travel AI conversational agent is the next phase.<br />
            The review on the left is <b>live data</b> from Navan.
          </div>
        </section>
      </div>
    </>
  );
}
