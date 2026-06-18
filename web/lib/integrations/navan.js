// Navan Travel Expense Review — computed from the DB (ext.navan_booking), modeled
// on the old app's /travel/dashboard. Bookings are grouped into TRIPS (a traveler's
// flight + hotel for the same Navan tripUuid become one "FLIGHT + HOTEL" trip), each
// trip carries flags (over budget 🔴, weekend 🚩, early/late ⏰, matched ✅, no-TRF ❌),
// and the "needs review" trips are grouped per traveler for the clickable UI.
import { query } from '../db';
import { fetchTravelRequests, matchTRF } from './trf';

// Old-app budget thresholds.
const FLIGHT_RT_MAX = 500;   // round-trip
const FLIGHT_OW_MAX = 250;   // one-way
const HOTEL_NIGHT_MAX = 200; // per night

// Smart window (matches the old app's _smart_include): include a booking if it
// TRAVELED within the last `days` (past/today → by start_date), OR it's a future/
// undated trip that was BOOKED within the last `days` (→ by created_at). This
// catches trips booked earlier whose travel falls inside the window, plus
// recently-booked upcoming trips.
async function fetchBookings(days) {
  const { rows } = await query(
    `select raw from ext.navan_booking
       where (start_date is not null and start_date <= current_date and start_date >= current_date - $1::int)
          or ((start_date is null or start_date > current_date) and created_at >= now() - ($1::int * interval '1 day'))`,
    [String(days)],
  );
  return rows.map((r) => r.raw).filter((b) => b && b.bookingStatus !== 'CANCELLED' && !b.cancelledAt);
}

const amt = (b) => Number(b.usdGrandTotal || b.grandTotal || b.travelSpend || 0);
const travelerOf = (b) => b.passengers?.[0]?.person?.name || b.booker?.name || '—';
const travelerEmailOf = (b) => (b.passengers?.[0]?.person?.email || b.booker?.email || '').trim().toLowerCase();
// Navan origin/destination are objects ({city,state,airportCode,...}); show the city.
const placeName = (o) => (!o ? '' : typeof o === 'string' ? o : (o.city || o.airportCode || o.name || ''));
const isWeekendDate = (d) => { if (!d) return false; const g = new Date(d + 'T00:00:00Z').getUTCDay(); return g === 0 || g === 6; };
const flightOverBudget = (b) => amt(b) > (/round/i.test(b.routeType || '') ? FLIGHT_RT_MAX : FLIGHT_OW_MAX);
const hotelOverBudget = (b) => amt(b) / (b.bookingDuration || 1) > HOTEL_NIGHT_MAX;

// Group a window's bookings into trips (per traveler + Navan tripUuid; solo otherwise),
// resolve flags + TRF match per trip.
function buildTrips(bs, trfs, trfConnected) {
  const groups = {};
  for (const b of bs) {
    const key = travelerOf(b) + '||' + ((b.tripUuids && b.tripUuids[0]) || ('solo:' + (b.uuid || b.bookingId || '')));
    (groups[key] = groups[key] || []).push(b);
  }

  const trips = [];
  for (const [key, items] of Object.entries(groups)) {
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
    const matchedTRF = m.request_match === true && !m.match_note;
    const earlyLate = m.request_match === true && !!m.match_note;
    const noTRF = trfConnected && m.request_match === false;

    trips.push({
      id: key, traveler, email, type, route, origin, destination, vendor: ref.vendor || items[0].vendor || '',
      amount, flightAmount, hotelAmount, startDate, endDate, dailyRate, tripType, matchNote: m.match_note || '',
      flags: { overBudget, weekend, earlyLate, matchedTRF, noTRF },
      needsReview: overBudget || weekend || noTRF,
    });
  }
  return trips;
}

export async function travelReview(days = 7, { withTRF = true } = {}) {
  try {
    const bs = await fetchBookings(days);
    const trfs = withTRF ? await fetchTravelRequests() : [];
    const trfConnected = trfs.length > 0;
    const trips = buildTrips(bs, trfs, trfConnected);

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
