import express from 'express';
import axios from 'axios';
import { CARGO_ROUTES } from '../src/lib/constants.js';

const router = express.Router();

// Every airport EHI actually ships to/from, derived from the same route
// list CargoForm/PackageForm use -- Part C's "Nigeria Today" board is
// scoped to this known-size list (not literally every Nigerian airport,
// which would need a paid AeroDataBox plan to cover the call volume).
const NATIONAL_AIRPORTS = CARGO_ROUTES.filter(r => r !== 'Other').map(r => r.split('/')[0]);

// How long a cached AeroDataBox lookup is considered fresh before a GET
// /status request triggers a live re-fetch. Deliberately generous -- the
// free/low tier AeroDataBox plan (600 API units/month, ~1 req/sec) can't
// support tight polling, so this is what actually keeps usage bounded:
// opening the board (GET /board) never calls AeroDataBox at all, only
// opening a specific flight's detail (GET /status) can, and at most once
// per TTL window per flight+date, shared across every viewer.
const CACHE_TTL_MS = 10 * 60 * 1000;

// Departures-board cache TTL for CargoForm's flight-number auto-fill --
// longer than CACHE_TTL_MS above since a whole-airport board is a much
// heavier AeroDataBox call than a single flight lookup, and this one gets
// hit far more often (every cargo intake, not just Flight Radar opens).
// One fetch per hub per window covers every agent at that hub, regardless
// of how many different airline/route combinations get typed in that time.
const DEPARTURES_CACHE_TTL_MS = 20 * 60 * 1000;

// flight_status_cache.raw stores AeroDataBox's full response (kept for
// future fields without a migration, per that table's own header comment)
// but nothing in the UI reads it -- every read of this table below selects
// this explicit column list instead of '*' so a board with many tracked
// flights isn't shipping a full raw AeroDataBox payload per flight to the
// browser on every load.
const FLIGHT_STATUS_CACHE_COLUMNS = 'flight_number,flight_date,airline_name,status,scheduled_departure,actual_departure,scheduled_arrival,actual_arrival,delay_minutes,departure_airport,arrival_airport,diverted_airport,fetched_at';

async function getAdminClient() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return null;
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

// Same is_hub_unrestricted() role set every other hub-scoped view in this
// codebase uses (20260708_hub_isolation_rls.sql; mirrored client-side in
// WeightManifest.tsx/OutboundArrivals.tsx/IncomingToHub.tsx). The board
// endpoint below queries cargo_entries/manifests with the service-role
// client (bypasses RLS entirely), so it has to redo this scoping itself --
// without it, a hub-restricted agent would see every other hub's flights
// too, unlike every other screen in the app.
const UNRESTRICTED_ROLES = ['super_admin', 'admin', 'accountant', 'auditor'];

async function getCallerProfile(req: any, admin: any): Promise<{ role: string; hub_id: string | null } | null> {
  const token = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
  if (!token) return null;
  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) return null;
  const { data: profile } = await admin.from('user_profiles').select('role,hub_id').eq('id', user.id).single();
  return profile || null;
}

// Maps AeroDataBox's raw flight-status response onto the normalized shape
// flight_status_cache stores. AeroDataBox's own status field values were
// confirmed against a live response during implementation (its docs site
// is JS-rendered and couldn't be scraped ahead of time) -- this switch is
// deliberately defensive (falls back to 'unknown') so an unrecognized or
// future status string never crashes the board, it just shows as
// untracked rather than mis-labeled.
// Shared by normalizeStatus (single-flight lookup) and
// normalizeDepartureEntry (airport board) below -- both get a raw AeroDataBox
// status string and need the same coarse bucketing.
function mapRawStatusString(rawStatus: string): string {
  const s = rawStatus.toLowerCase();
  if (s.includes('cancel')) return 'cancelled';
  if (s.includes('divert')) return 'diverted';
  if (s.includes('delay')) return 'delayed';
  if (s.includes('landed') || s.includes('arrived')) return 'landed';
  if (s.includes('en-route') || s.includes('enroute') || s.includes('departed')) return 'departed';
  if (s.includes('board')) return 'boarding';
  if (s.includes('expect') || s.includes('schedul')) return 'scheduled';
  return 'unknown';
}

function normalizeStatus(raw: any): {
  status: string;
  scheduled_departure: string | null;
  actual_departure: string | null;
  scheduled_arrival: string | null;
  actual_arrival: string | null;
  delay_minutes: number | null;
  departure_airport: string | null;
  arrival_airport: string | null;
  diverted_airport: string | null;
  airline_name: string | null;
} {
  const dep = raw?.departure || {};
  const arr = raw?.arrival || {};
  let status = mapRawStatusString(String(raw?.status || ''));

  const scheduledDeparture = dep.scheduledTime?.utc || null;
  const actualDeparture = dep.actualTime?.utc || dep.runwayTime?.utc || null;
  const scheduledArrival = arr.scheduledTime?.utc || null;
  const actualArrival = arr.actualTime?.utc || arr.runwayTime?.utc || null;

  let delayMinutes: number | null = null;
  if (scheduledDeparture && (actualDeparture || dep.predictedTime?.utc)) {
    const base = new Date(scheduledDeparture).getTime();
    const compare = new Date(actualDeparture || dep.predictedTime.utc).getTime();
    const diff = Math.round((compare - base) / 60000);
    if (diff > 0) delayMinutes = diff;
  }
  if (status === 'unknown' && delayMinutes && delayMinutes > 0) status = 'delayed';

  const departureAirport = dep.airport?.iata || dep.airport?.icao || dep.airport?.name || null;
  const arrivalAirport = arr.airport?.iata || arr.airport?.icao || arr.airport?.name || null;
  const divertedAirport = status === 'diverted'
    ? (raw?.diversionAirport?.iata || raw?.diversionAirport?.icao || raw?.diversionAirport?.name || null)
    : null;

  return {
    status,
    scheduled_departure: scheduledDeparture,
    actual_departure: actualDeparture,
    scheduled_arrival: scheduledArrival,
    actual_arrival: actualArrival,
    delay_minutes: delayMinutes,
    departure_airport: departureAirport,
    arrival_airport: arrivalAirport,
    diverted_airport: divertedAirport,
    airline_name: raw?.airline?.name || null,
  };
}

async function fetchFromAeroDataBox(flightNumber: string, date: string) {
  const apiKey = process.env.AERODATABOX_API_KEY;
  if (!apiKey) return null;
  const url = `https://aerodatabox.p.rapidapi.com/flights/number/${encodeURIComponent(flightNumber)}/${encodeURIComponent(date)}`;
  const response = await axios.get(url, {
    headers: {
      'X-RapidAPI-Key': apiKey,
      'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com',
    },
    timeout: 10_000,
  });
  // AeroDataBox returns an array (a flight number can have multiple legs/
  // codeshares on the same date) -- the first entry is the primary leg.
  const first = Array.isArray(response.data) ? response.data[0] : response.data;
  return first || null;
}

async function getOrRefresh(flightNumber: string, date: string, forceRefresh: boolean) {
  const admin = await getAdminClient();
  if (!admin) return { error: 'Server not configured', code: 503 };

  if (!forceRefresh) {
    const { data: cached } = await admin
      .from('flight_status_cache')
      .select(FLIGHT_STATUS_CACHE_COLUMNS)
      .eq('flight_number', flightNumber)
      .eq('flight_date', date)
      .maybeSingle();
    if (cached && Date.now() - new Date(cached.fetched_at).getTime() < CACHE_TTL_MS) {
      return { data: cached };
    }
  }

  if (!process.env.AERODATABOX_API_KEY) {
    // Not configured -- serve whatever's cached (even if stale) rather
    // than a hard error, so the board still shows last-known status.
    const { data: cached } = await admin
      .from('flight_status_cache')
      .select(FLIGHT_STATUS_CACHE_COLUMNS)
      .eq('flight_number', flightNumber)
      .eq('flight_date', date)
      .maybeSingle();
    return cached ? { data: cached } : { error: 'Flight tracking not configured', code: 503 };
  }

  let raw: any;
  try {
    raw = await fetchFromAeroDataBox(flightNumber, date);
  } catch (err: any) {
    // A failed live call falls back to whatever's cached rather than
    // surfacing an error to every viewer -- AeroDataBox's free/low tier is
    // easy to exhaust, and a quota-exceeded response shouldn't blank out a
    // status the app already knew a moment ago.
    const { data: cached } = await admin
      .from('flight_status_cache')
      .select(FLIGHT_STATUS_CACHE_COLUMNS)
      .eq('flight_number', flightNumber)
      .eq('flight_date', date)
      .maybeSingle();
    if (cached) return { data: cached };
    return { error: err?.response?.data?.message || err.message || 'Flight lookup failed', code: 502 };
  }

  if (!raw) {
    return { error: 'No matching flight found', code: 404 };
  }

  const normalized = normalizeStatus(raw);
  const row = {
    flight_number: flightNumber,
    flight_date: date,
    ...normalized,
    raw,
    fetched_at: new Date().toISOString(),
  };

  const { data: saved, error: saveError } = await admin
    .from('flight_status_cache')
    .upsert(row, { onConflict: 'flight_number,flight_date' })
    .select(FLIGHT_STATUS_CACHE_COLUMNS)
    .single();

  // Falls back to `row` (which still carries `raw`) only when the upsert's
  // own SELECT failed -- res.json(result.data) is the only caller, and it's
  // fine for that one edge case to include the extra field; every normal
  // response goes through the trimmed `saved` shape above.
  if (saveError) return { data: row };
  return { data: saved };
}

// Airport departures FIDS response -> the trimmed shape CargoForm needs to
// find "the next flight to X on airline Y" client-side. Field names
// confirmed against a live response during implementation (same caveat as
// normalizeStatus above) -- an airport-board entry's "other end" comes back
// as `movement.airport` (not a separate departure/arrival pair the way the
// single-flight endpoint returns), so that's read with a couple of
// fallbacks in case AeroDataBox varies the shape by airport/carrier.
function normalizeDepartureEntry(raw: any): { flightNumber: string | null; airline: string | null; destinationIata: string | null; scheduledDeparture: string | null; status: string } {
  const movement = raw?.movement || raw?.departure || {};
  return {
    flightNumber: raw?.number || raw?.callSign || null,
    airline: raw?.airline?.name || null,
    destinationIata: movement?.airport?.iata || raw?.arrival?.airport?.iata || null,
    scheduledDeparture: movement?.scheduledTime?.utc || raw?.departure?.scheduledTime?.utc || null,
    status: mapRawStatusString(String(raw?.status || '')),
  };
}

async function fetchDeparturesFromAeroDataBox(originIata: string, date: string): Promise<any[]> {
  const apiKey = process.env.AERODATABOX_API_KEY;
  if (!apiKey) return [];
  // AeroDataBox's airport FIDS endpoint caps each request window at 12
  // hours, so the full day is split into two half-day calls and merged.
  const windows: [string, string][] = [
    [`${date}T00:00`, `${date}T11:59`],
    [`${date}T12:00`, `${date}T23:59`],
  ];
  const results = await Promise.all(windows.map(async ([from, to]) => {
    const url = `https://aerodatabox.p.rapidapi.com/flights/airports/iata/${encodeURIComponent(originIata)}/${from}/${to}`;
    const response = await axios.get(url, {
      params: { direction: 'Departure', withLeg: false },
      headers: {
        'X-RapidAPI-Key': apiKey,
        'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com',
      },
      timeout: 10_000,
    });
    return response.data?.departures || [];
  }));
  return results.flat().map(normalizeDepartureEntry).filter(f => f.flightNumber);
}

// Cache-or-fetch the whole day's departures board for one airport -- shared
// by GET /departures (single airport, CargoForm's auto-fill) and the
// national-board routes below (looped across NATIONAL_AIRPORTS). See this
// file's DEPARTURES_CACHE_TTL_MS comment for why this is a board-per-airport
// cache rather than a call-per-lookup like getOrRefresh.
async function getOrFetchDeparturesBoard(admin: any, originIata: string, date: string, forceRefresh: boolean): Promise<any[]> {
  const { data: cached } = await admin
    .from('flight_departures_board_cache')
    .select('*')
    .eq('origin_iata', originIata)
    .eq('board_date', date)
    .maybeSingle();
  if (!forceRefresh && cached && Date.now() - new Date(cached.fetched_at).getTime() < DEPARTURES_CACHE_TTL_MS) {
    return cached.flights;
  }

  if (!process.env.AERODATABOX_API_KEY) {
    // Not configured -- serve stale cache if any exists, otherwise an
    // empty board (CargoForm just leaves Flight No. blank, same as today).
    return cached?.flights || [];
  }

  let flights: any[];
  try {
    flights = await fetchDeparturesFromAeroDataBox(originIata, date);
  } catch (err: any) {
    // A failed live call falls back to stale cache rather than breaking
    // cargo intake or the national board -- same fallback philosophy as
    // getOrRefresh.
    return cached?.flights || [];
  }

  await admin
    .from('flight_departures_board_cache')
    .upsert({ origin_iata: originIata, board_date: date, flights, fetched_at: new Date().toISOString() }, { onConflict: 'origin_iata,board_date' });

  return flights;
}

router.get('/departures', async (req, res) => {
  const originIata = String(req.query.originIata || '').trim().toUpperCase();
  const date = String(req.query.date || '').trim();
  if (!originIata || !date) {
    res.status(400).json({ error: 'originIata and date are required' });
    return;
  }
  const admin = await getAdminClient();
  if (!admin) { res.status(503).json({ error: 'Server not configured' }); return; }

  const flights = await getOrFetchDeparturesBoard(admin, originIata, date, false);
  res.json({ originIata, date, flights });
});

// "Nigeria Today" board (Part C) -- cache-only read across every airport in
// NATIONAL_AIRPORTS, never triggers a live AeroDataBox call itself (many
// will already be warm from /departures' own CargoForm-driven usage at each
// hub). Returns a flat list, each flight tagged with its origin airport.
router.get('/national-board', async (req, res) => {
  const date = String(req.query.date || '').trim();
  if (!date) { res.status(400).json({ error: 'date is required' }); return; }
  const admin = await getAdminClient();
  if (!admin) { res.status(503).json({ error: 'Server not configured' }); return; }

  const { data: cachedRows } = await admin
    .from('flight_departures_board_cache')
    .select('origin_iata,flights,fetched_at')
    .in('origin_iata', NATIONAL_AIRPORTS)
    .eq('board_date', date);

  const flights = (cachedRows || []).flatMap((row: any) =>
    (row.flights || []).map((f: any) => ({ ...f, originIata: row.origin_iata }))
  );
  const airportsCovered = (cachedRows || []).map((row: any) => row.origin_iata);
  res.json({
    date,
    flights,
    airportsTotal: NATIONAL_AIRPORTS.length,
    airportsCached: airportsCovered.length,
  });
});

// Force-refreshes every airport in NATIONAL_AIRPORTS regardless of TTL --
// up to 19 airports x 2 half-day calls = ~38 AeroDataBox calls in one click,
// so this is deliberately admin/super_admin-only (real cost on a metered
// plan), unlike every other read in this router.
router.post('/national-board/refresh', async (req, res) => {
  const date = String(req.body?.date || '').trim();
  if (!date) { res.status(400).json({ error: 'date is required' }); return; }
  const admin = await getAdminClient();
  if (!admin) { res.status(503).json({ error: 'Server not configured' }); return; }

  const profile = await getCallerProfile(req, admin);
  if (!profile || !['super_admin', 'admin'].includes(profile.role)) {
    res.status(403).json({ error: 'Only admins can refresh the national board' });
    return;
  }

  await Promise.all(NATIONAL_AIRPORTS.map(iata => getOrFetchDeparturesBoard(admin, iata, date, true)));
  res.json({ ok: true, airportsRefreshed: NATIONAL_AIRPORTS.length });
});

router.get('/status', async (req, res) => {
  const flightNumber = String(req.query.flightNumber || '').trim();
  const date = String(req.query.date || '').trim();
  if (!flightNumber || !date) {
    res.status(400).json({ error: 'flightNumber and date are required' });
    return;
  }
  const result = await getOrRefresh(flightNumber, date, false);
  if (result.error) { res.status(result.code || 500).json({ error: result.error }); return; }
  res.json(result.data);
});

router.post('/refresh', async (req, res) => {
  const flightNumber = String(req.body?.flightNumber || '').trim();
  const date = String(req.body?.date || '').trim();
  if (!flightNumber || !date) {
    res.status(400).json({ error: 'flightNumber and date are required' });
    return;
  }
  const result = await getOrRefresh(flightNumber, date, true);
  if (result.error) { res.status(result.code || 500).json({ error: result.error }); return; }
  res.json(result.data);
});

// Board list: distinct (flight_number, date) pairs currently in use across
// cargo_entries/manifests for the given date, left-joined against whatever
// is already cached -- deliberately never calls AeroDataBox itself, so
// opening the board is always free regardless of how many flights are on
// it. Individual flight detail views (GET /status above) are what trigger
// a live fetch, at most once per flight+date per CACHE_TTL_MS window.
router.get('/board', async (req, res) => {
  const date = String(req.query.date || '').trim();
  if (!date) { res.status(400).json({ error: 'date is required' }); return; }
  const admin = await getAdminClient();
  if (!admin) { res.status(503).json({ error: 'Server not configured' }); return; }

  const profile = await getCallerProfile(req, admin);
  if (!profile) { res.status(401).json({ error: 'Invalid session' }); return; }
  const isUnrestricted = UNRESTRICTED_ROLES.includes(profile.role);

  const dayStart = `${date}T00:00:00.000Z`;
  const dayEnd = `${date}T23:59:59.999Z`;

  let cargoQuery = admin.from('cargo_entries')
    .select('entry_ref,awb_tag_number,flight_number,airline,route,consignee_name,created_at,hub_id')
    .not('flight_number', 'is', null)
    .gte('created_at', dayStart).lte('created_at', dayEnd);
  let manifestQuery = admin.from('manifests')
    .select('transaction_id,flight_no,airline,destination,passenger_name,created_at,hub_id')
    .not('flight_no', 'is', null)
    .gte('created_at', dayStart).lte('created_at', dayEnd);
  // Plain own-hub scoping, not sibling_hub_ids()-aware (20260817_state_
  // visibility.sql's cross-hub grouping for e.g. Lagos's two stations) --
  // a conservative simplification: a restricted user sees strictly a
  // subset of what they'd see elsewhere in the app, never more.
  if (!isUnrestricted) {
    cargoQuery = cargoQuery.eq('hub_id', profile.hub_id);
    manifestQuery = manifestQuery.eq('hub_id', profile.hub_id);
  }

  const [cargoRes, manifestRes, cacheRes] = await Promise.all([
    cargoQuery,
    manifestQuery,
    admin.from('flight_status_cache').select(FLIGHT_STATUS_CACHE_COLUMNS).eq('flight_date', date),
  ]);

  const cacheByFlight = new Map((cacheRes.data || []).map((c: any) => [c.flight_number, c]));

  const flights = new Map<string, any>();
  for (const c of cargoRes.data || []) {
    const fn = (c.flight_number || '').trim();
    if (!fn) continue;
    if (!flights.has(fn)) {
      flights.set(fn, { flightNumber: fn, airline: c.airline, route: c.route, entries: [], status: cacheByFlight.get(fn) || null });
    }
    flights.get(fn).entries.push({ type: 'cargo', id: c.entry_ref, awb: c.awb_tag_number, name: c.consignee_name });
  }
  for (const m of manifestRes.data || []) {
    const fn = (m.flight_no || '').trim();
    if (!fn) continue;
    if (!flights.has(fn)) {
      flights.set(fn, { flightNumber: fn, airline: m.airline, route: m.destination, entries: [], status: cacheByFlight.get(fn) || null });
    }
    flights.get(fn).entries.push({ type: 'baggage', id: m.transaction_id, name: m.passenger_name });
  }

  res.json({ date, flights: Array.from(flights.values()) });
});

export default router;
