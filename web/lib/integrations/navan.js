// Navan Travel Expense Review — computed from the DB (ext.navan_booking), modeled
// on the old app's /travel/dashboard. Bookings are cleaned (drop $0/cancelled),
// grouped into TRIPS (flight + hotel → one "FLIGHT + HOTEL" trip, via Navan
// tripUuid or a ±1-day pairing fallback), flagged (over budget 🔴, weekend 🚩,
// early/late ⏰, matched ✅, no-TRF ❌), and the "needs review" trips are grouped
// per traveler for the clickable UI. Round-trip return legs inherit a TRF match.
import { query } from '../db';
import { fetchTravelRequests, matchTRF } from './trf';

// Old-app budget thresholds.
const FLIGHT_RT_MAX = 500;   // round-trip
const FLIGHT_OW_MAX = 250;   // one-way
const HOTEL_NIGHT_MAX = 200; // per night
const DAY_MS = 86400000;

// Amount cascade (matches the old app's normalize_booking).
const amt = (b) => Number(b.usdGrandTotal || b.grandTotal || b.totalCost || b.totalAmount || b.travelSpend || b.cost || 0);
const travelerOf = (b) => b.passengers?.[0]?.person?.name || b.booker?.name || '—';
const travelerEmailOf = (b) => (b.passengers?.[0]?.person?.email || b.booker?.email || '').trim().toLowerCase();
// Navan origin/destination are objects ({city,state,airportCode,...}); show the city.
const placeName = (o) => (!o ? '' : typeof o === 'string' ? o : (o.city || o.airportCode || o.name || ''));
const dateMs = (s) => (s ? new Date(s + 'T00:00:00Z').getTime() : NaN);
const isWeekendDate = (d) => { if (!d) return false; const g = new Date(d + 'T00:00:00Z').getUTCDay(); return g === 0 || g === 6; };
const flightOverBudget = (b) => amt(b) > (/round/i.test(b.routeType || '') ? FLIGHT_RT_MAX : FLIGHT_OW_MAX);
const hotelOverBudget = (b) => amt(b) / (b.bookingDuration || 1) > HOTEL_NIGHT_MAX;

// Smart window (old app's _smart_include): include a booking if it TRAVELED within
// the last `days` (past/today → by start_date), OR it's a future/undated trip
// BOOKED within the last `days` (→ by created_at).
async function fetchBookings(days) {
  const { rows } = await query(
    `select raw from ext.navan_booking
       where (start_date is not null and start_date <= current_date and start_date >= current_date - $1::int)
          or ((start_date is null or start_date > current_date) and created_at >= now() - ($1::int * interval '1 day'))`,
    [String(days)],
  );
  // Drop cancelled and $0 bookings before grouping (so junk doesn't steal pairing slots).
  return rows.map((r) => r.raw).filter((b) =>
    b && !/cancel/i.test(b.bookingStatus || '') && !b.cancelledAt && amt(b) > 0);
}

function buildTrips(bs, trfs, trfConnected) {
  // 1) cluster by traveler + Navan tripUuid (solo otherwise)
  const clusterMap = {};
  for (const b of bs) {
    const key = travelerOf(b) + '||' + ((b.tripUuids && b.tripUuids[0]) || ('solo:' + (b.uuid || b.bookingId || '')));
    (clusterMap[key] = clusterMap[key] || []).push(b);
  }
  let clusters = Object.values(clusterMap);

  // 2) ±1-day pairing fallback: merge an unpaired pure-FLIGHT cluster with a
  //    pure-HOTEL cluster for the same traveler whose start dates are ≤ 1 day apart
  //    (catches flight+hotel that Navan didn't link via tripUuid).
  const onlyType = (items, t) => items.length > 0 && items.every((b) => b.bookingType === t);
  const byTraveler = {};
  for (const c of clusters) { const t = travelerOf(c[0]); (byTraveler[t] = byTraveler[t] || []).push(c); }
  const merged = new Set();
  const paired = [];
  for (const list of Object.values(byTraveler)) {
    const flights = list.filter((c) => onlyType(c, 'FLIGHT'));
    const hotels = list.filter((c) => onlyType(c, 'HOTEL'));
    for (const f of flights) {
      if (merged.has(f)) continue;
      let best = null, bestGap = 1.0001;
      for (const h of hotels) {
        if (merged.has(h)) continue;
        const gap = Math.abs(dateMs(f[0].startDate) - dateMs(h[0].startDate)) / DAY_MS;
        if (gap <= 1 && gap < bestGap) { best = h; bestGap = gap; }
      }
      if (best) { merged.add(f); merged.add(best); paired.push([...f, ...best]); }
    }
  }
  clusters = clusters.filter((c) => !merged.has(c)).concat(paired);

  // 3) compute one trip per cluster
  const trips = [];
  for (const items of clusters) {
    const traveler = travelerOf(items[0]);
    const email = travelerEmailOf(items[0]);
    const flightsIn = items.filter((b) => b.bookingType === 'FLIGHT');
    const hotelsIn = items.filter((b) => b.bookingType === 'HOTEL');
    const hasF = flightsIn.length > 0, hasH = hotelsIn.length > 0;
    const type = hasF && hasH ? 'FLIGHT + HOTEL' : hasF ? 'FLIGHT' : hasH ? 'HOTEL' : (items[0].bookingType || 'OTHER');
    const ref = flightsIn[0] || items[0];

    const amount = items.reduce((s, b) => s + amt(b), 0);
    const flightAmount = flightsIn.reduce((s, b) => s + amt(b), 0);
    const hotelAmount = hotelsIn.reduce((s, b) => s + amt(b), 0);
    const nights = hotelsIn.reduce((s, b) => s + (b.bookingDuration || 0), 0);
    const dailyRate = nights ? hotelAmount / nights : null;

    const starts = items.map((b) => b.startDate).filter(Boolean).sort();
    const ends = items.map((b) => b.endDate).filter(Boolean).sort();
    const startDate = starts[0] || '';
    const endDate = ends[ends.length - 1] || '';

    const origin = placeName(ref.origin);
    let destination = placeName(ref.destination);
    if (!destination) { const d = items.find((b) => placeName(b.destination)); if (d) destination = placeName(d.destination); }
    const route = origin && destination ? `${origin} → ${destination}`
      : (destination || origin || ref.tripName || ref.vendor || '—');
    const tripType = /round/i.test(ref.routeType || '') ? 'ROUND_TRIP' : (ref.routeType ? 'ONE_WAY' : '');

    const overBudget = flightsIn.some(flightOverBudget) || hotelsIn.some(hotelOverBudget);
    const weekend = items.some((b) => isWeekendDate(b.startDate) || isWeekendDate(b.endDate));
    const m = trfConnected
      ? matchTRF({ email, name: traveler, depart: startDate, ret: endDate }, trfs)
      : { request_match: null, match_note: null };

    trips.push({
      id: items.map((b) => b.uuid || b.bookingId).join('+') || `${traveler}|${startDate}`,
      traveler, email, type, route, origin, destination, vendor: ref.vendor || items[0].vendor || '',
      amount, flightAmount, hotelAmount, startDate, endDate, dailyRate, tripType, matchNote: m.match_note || '',
      flags: {
        overBudget, weekend,
        earlyLate: m.request_match === true && !!m.match_note,
        matchedTRF: m.request_match === true && !m.match_note,
        noTRF: trfConnected && m.request_match === false,
      },
      needsReview: overBudget || weekend || (trfConnected && m.request_match === false),
    });
  }
  return trips;
}

// Round-trip propagation: an unmatched flight inherits a TRF match from the same
// traveler's reverse-route matched flight within 21 days (old app behavior).
function propagateRoundTrip(trips) {
  const isFlight = (t) => t.type === 'FLIGHT' || t.type === 'FLIGHT + HOTEL';
  const matched = trips.filter((t) => isFlight(t) && (t.flags.matchedTRF || t.flags.earlyLate) && t.origin && t.destination);
  for (const t of trips) {
    if (!t.flags.noTRF || !isFlight(t) || !t.origin || !t.destination) continue;
    const rev = matched.find((o) => o.traveler === t.traveler
      && o.origin === t.destination && o.destination === t.origin
      && Math.abs(dateMs(t.startDate) - dateMs(o.startDate)) / DAY_MS <= 21);
    if (rev) {
      t.flags.noTRF = false;
      t.flags.matchedTRF = true;
      t.matchNote = t.matchNote || 'Round-trip match';
      t.needsReview = t.flags.overBudget || t.flags.weekend;
    }
  }
}

export async function travelReview(days = 7, { withTRF = true } = {}) {
  try {
    const bs = await fetchBookings(days);
    const trfs = withTRF ? await fetchTravelRequests() : [];
    const trfConnected = trfs.length > 0;
    const trips = buildTrips(bs, trfs, trfConnected);
    if (trfConnected) propagateRoundTrip(trips);

    // Overall stats (every booking in the window).
    const flights = bs.filter((b) => b.bookingType === 'FLIGHT');
    const hotels = bs.filter((b) => b.bookingType === 'HOTEL');
    const totalSpend = bs.reduce((s, b) => s + amt(b), 0);
    const flightAvg = flights.length ? flights.reduce((s, b) => s + amt(b), 0) / flights.length : 0;
    const hotelAvg = hotels.length ? hotels.reduce((s, b) => s + amt(b) / (b.bookingDuration || 1), 0) / hotels.length : 0;

    const reviewTrips = trips.filter((t) => t.needsReview);
    const flaggedSpend = reviewTrips.reduce((s, t) => s + t.amount, 0);

    // Group review trips per traveler (expandable rows in the UI).
    const tmap = {};
    for (const t of reviewTrips) {
      const g = tmap[t.traveler] || (tmap[t.traveler] = { name: t.traveler, email: t.email, total: 0, trips: [], counts: { over: 0, weekend: 0, early: 0, noTRF: 0 } });
      g.total += t.amount;
      g.trips.push(t);
      if (t.flags.overBudget) g.counts.over++;
      if (t.flags.weekend) g.counts.weekend++;
      if (t.flags.earlyLate) g.counts.early++;
      if (t.flags.noTRF) g.counts.noTRF++;
    }
    const score = (g) => g.counts.over * 3 + g.counts.noTRF * 2 + g.counts.weekend + g.counts.early;
    const travelers = Object.values(tmap)
      .map((g) => ({ ...g, trips: g.trips.sort((a, b) => b.amount - a.amount) }))
      .sort((a, b) => score(b) - score(a) || b.total - a.total);

    return {
      ok: true, days, count: reviewTrips.length, trfConnected,
      summary: {
        trips: trips.length, bookings: bs.length, totalSpend,
        flights: { count: flights.length, avg: flightAvg },
        hotels: { count: hotels.length, avgPerNight: hotelAvg },
        overBudget: trips.filter((t) => t.flags.overBudget).length,
        weekend: trips.filter((t) => t.flags.weekend).length,
        matchedTRF: trips.filter((t) => t.flags.matchedTRF).length,
        earlyLate: trips.filter((t) => t.flags.earlyLate).length,
        noTRF: trips.filter((t) => t.flags.noTRF).length,
        flaggedCount: reviewTrips.length, flaggedSpend,
      },
      travelers, error: null,
    };
  } catch (e) {
    return { ok: false, count: 0, error: String(e?.message || e) };
  }
}

// Quick nav-badge count: over-budget or weekend trips (skips the JotForm TRF fetch).
export async function travelCount(days = 7) {
  const r = await travelReview(days, { withTRF: false });
  return r.ok ? r.count : null;
}
