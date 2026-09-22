import express from 'express';
import { getAiClient } from './gemini.js';
import { getAdminClient, getOrFetchDeparturesBoard } from './flightRadar.js';
import { CARGO_ROUTES } from '../src/lib/constants.js';
import { lagosBusinessDate, getHubCode } from '../src/lib/helpers.js';

const router = express.Router();

// "AI Chat Buddy" -- a one-shot Q&A assistant for questions like "what's
// the price for Lagos to Enugu" or "flights from Lagos to Abuja". Every
// number or flight time it states comes from a deterministic DB lookup
// BEFORE Gemini is ever called -- Gemini's only job is phrasing that
// already-resolved fact into a sentence, never inventing or recalling a
// price/time itself (see buildSystemPrompt below). This mirrors the
// "Financial build care" standard the rest of this app's pricing code
// holds itself to: a chatbot hallucinating a freight rate is a real-money
// mistake, not a cosmetic one.

function normalizeText(s: string): string {
  return ' ' + s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
}

// A couple of common short-form aliases CARGO_ROUTES' own "IATA/City" text
// doesn't already cover -- matched only if the full city/code didn't.
const ROUTE_ALIASES: Record<string, string> = {
  'ph': 'PHC/Port Harcourt',
  'warri': 'QRW/Warri (Osubi Airstrip)',
  'osubi': 'QRW/Warri (Osubi Airstrip)',
  'benin': 'BNI/Benin City',
};

// Finds every CARGO_ROUTES city/code mentioned in the message, in the order
// they appear -- "Lagos to Enugu" -> ['LOS/Lagos', 'ENU/Enugu']. Callers
// treat the first match as origin and the second as destination when two
// are found, or as destination-only (origin defaults to the caller's own
// hub -- the "auto detecting which hub I am" behavior) when only one is.
function findRouteMentions(text: string): string[] {
  const norm = normalizeText(text);
  const matches: { route: string; index: number }[] = [];
  for (const route of CARGO_ROUTES) {
    if (route === 'Other') continue;
    const [code, cityRaw] = route.split('/');
    const city = cityRaw.replace(/\s*\(.*?\)\s*/g, '').trim().toLowerCase();
    const cityIdx = norm.indexOf(` ${city} `);
    const codeIdx = norm.indexOf(` ${code.toLowerCase()} `);
    const idx = cityIdx >= 0 ? cityIdx : codeIdx;
    if (idx >= 0) matches.push({ route, index: idx });
  }
  for (const [alias, route] of Object.entries(ROUTE_ALIASES)) {
    if (matches.some(m => m.route === route)) continue;
    const idx = norm.indexOf(` ${alias} `);
    if (idx >= 0) matches.push({ route, index: idx });
  }
  matches.sort((a, b) => a.index - b.index);
  // Dedupe consecutive/repeated mentions of the same route.
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const m of matches) {
    if (seen.has(m.route)) continue;
    seen.add(m.route);
    ordered.push(m.route);
  }
  return ordered;
}

function detectIntent(text: string): 'price' | 'flight' | 'general' {
  const t = text.toLowerCase();
  const priceWords = ['price', 'cost', 'rate', 'charge', 'how much', 'naira', '₦'];
  const flightWords = ['flight', 'depart', 'schedule', 'plane', 'what time', 'when does', 'when is'];
  const isPrice = priceWords.some(w => t.includes(w));
  const isFlight = flightWords.some(w => t.includes(w));
  if (isPrice) return 'price'; // mentioning both -> price is the more consequential answer to get right
  if (isFlight) return 'flight';
  return 'general';
}

async function resolveHubForRoute(admin: any, routeStr: string | undefined, hubs: Array<{ id: string; name: string; code: string }>): Promise<{ id: string; name: string; code: string } | null> {
  if (!routeStr) return null;
  const [iata, cityRaw] = routeStr.split('/');
  const city = cityRaw.replace(/\s*\(.*?\)\s*/g, '').trim().toLowerCase();
  return hubs.find(h => (h.code || '').toUpperCase() === iata || (h.name || '').toLowerCase().includes(city)) || null;
}

// Same 3-tier cascade CargoForm.tsx's resolveRate() uses for retail cargo
// pricing (special-goods/flat/size-tier overrides need a content type and
// weight this chat query never has, so those tiers are out of scope here --
// this answers "what's the general per-kg rate", the same number CargoForm
// falls back to when nothing more specific is configured).
async function resolveChatRate(admin: any, hubId: string | null, routeName: string): Promise<number | null> {
  if (hubId) {
    const { data: hubDefault } = await admin.from('hub_route_rates').select('rate_per_kg').eq('hub_id', hubId).eq('route_name', routeName).maybeSingle();
    if (hubDefault) return Number(hubDefault.rate_per_kg);
  }
  const { data: company } = await admin.from('standard_cargo_rates').select('rate_per_kg').eq('route_name', routeName).maybeSingle();
  if (company) return Number(company.rate_per_kg);
  return null;
}

async function getCallerHub(req: any, admin: any): Promise<{ role: string; hub_id: string | null; hub_name: string; hub_code: string } | null> {
  const token = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
  if (!token) return null;
  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) return null;
  const { data: profile, error: profileError } = await admin
    .from('user_profiles')
    .select('role, hub_id, hubs(name, code)')
    .eq('id', user.id)
    .single();
  if (profileError || !profile) return null;
  const hub = Array.isArray(profile.hubs) ? profile.hubs[0] : profile.hubs;
  return {
    role: profile.role,
    hub_id: profile.hub_id,
    hub_name: hub?.name || 'your hub',
    hub_code: hub?.code || 'XXX',
  };
}

// Everything Gemini is allowed to state as fact is injected here as plain
// text BEFORE the model sees the question -- the prompt explicitly forbids
// stating any figure not present in this block, so a route/price this app
// genuinely doesn't have configured comes back as "I don't have that rate,
// ask a hub agent" instead of a plausible-sounding guess.
function buildPrompt(message: string, callerHubName: string, facts: string): string {
  return `You are "EHI Buddy", a short, friendly logistics assistant chat widget for EHI Multisystems Nigeria Limited staff (a cargo/baggage logistics company). The staff member asking is based at the ${callerHubName} hub.

STRICT RULE: Only state a price, rate, or flight time if it is explicitly given to you below in FACTS. Never invent, estimate, or recall a number from general knowledge -- if FACTS says a rate or flight isn't available, tell the user that plainly and suggest they ask a hub agent or check the Flight Radar / Cargo Entry screens instead. Do not add prices in Naira unless FACTS gave you the exact figure.

FACTS:
${facts || '(none found for this question)'}

Staff member's question: "${message}"

Reply in 1-3 short, conversational sentences. No markdown, no bullet points, no preamble like "Sure!" -- just answer directly.`;
}

router.post('/message', async (req, res) => {
  try {
    const message = String(req.body?.message || '').trim();
    if (!message) { res.status(400).json({ error: 'message is required' }); return; }
    if (message.length > 500) { res.status(400).json({ error: 'message is too long' }); return; }

    const admin = await getAdminClient();
    if (!admin) { res.status(503).json({ error: 'Server not configured' }); return; }

    const caller = await getCallerHub(req, admin);
    if (!caller) { res.status(401).json({ error: 'Invalid session' }); return; }

    const ai = getAiClient();
    if (!ai) { res.json({ reply: "AI Buddy isn't configured yet -- ask an admin to set GEMINI_API_KEY." }); return; }

    const routeMentions = findRouteMentions(message);
    const intent = detectIntent(message);

    const { data: hubRows } = await admin.from('hubs').select('id, name, code').eq('active', true);
    const hubs: Array<{ id: string; name: string; code: string }> = hubRows || [];

    let facts = '';

    if (intent === 'price') {
      // Two mentions ("Lagos to Enugu") -> [origin, destination]. One
      // mention ("price for Enugu") -> destination only, origin defaults to
      // the caller's own hub (the auto-detected-hub behavior).
      const destRoute = routeMentions.length >= 2 ? routeMentions[1] : routeMentions[0];
      const originRoute = routeMentions.length >= 2 ? routeMentions[0] : undefined;
      if (!destRoute) {
        facts = 'The staff member did not name a recognizable destination city/route.';
      } else {
        const originHub = originRoute ? await resolveHubForRoute(admin, originRoute, hubs) : null;
        const hubIdForLookup = originHub?.id || caller.hub_id;
        const hubNameForLookup = originHub?.name || caller.hub_name;
        const rate = await resolveChatRate(admin, hubIdForLookup, destRoute);
        const destCity = destRoute.split('/')[1];
        facts = rate != null
          ? `The cargo rate from ${hubNameForLookup} to ${destCity} is ₦${rate.toLocaleString()} per kg (subject to minimum charges and any content-specific pricing at intake).`
          : `No configured rate was found from ${hubNameForLookup} to ${destCity} -- this route/hub combination has no rate set up.`;
      }
    } else if (intent === 'flight') {
      const destRoute = routeMentions.length >= 2 ? routeMentions[1] : routeMentions[0];
      const originRoute = routeMentions.length >= 2 ? routeMentions[0] : undefined;
      // AeroDataBox needs a real airport IATA code -- NEVER hubs.code
      // directly, that column is a company-internal code (e.g. Lagos Head
      // Office is stored as "HQ", not "LOS") and 404s against AeroDataBox.
      // An explicit origin mention already carries a real IATA (it came from
      // CARGO_ROUTES via findRouteMentions), so use that; otherwise derive
      // one from the caller's hub NAME via getHubCode() -- the same
      // city/code-matching helper CargoForm.tsx uses for this exact purpose
      // (getHubCode(user.hub_code || user.hub)), never the raw hub_code column.
      const originIata = originRoute ? originRoute.split('/')[0] : getHubCode(caller.hub_name || caller.hub_code);
      if (!originIata || originIata === 'XXX') {
        facts = "The staff member's origin hub/airport could not be determined.";
      } else {
        const date = lagosBusinessDate();
        const board = await getOrFetchDeparturesBoard(admin, originIata, date, false);
        const destIata = destRoute ? destRoute.split('/')[0] : null;
        const now = Date.now();
        const upcoming = (board || [])
          .filter((f: any) => f.scheduledDeparture && new Date(f.scheduledDeparture).getTime() >= now)
          .filter((f: any) => !destIata || f.destinationIata === destIata)
          .sort((a: any, b: any) => new Date(a.scheduledDeparture).getTime() - new Date(b.scheduledDeparture).getTime())
          .slice(0, 5);
        if (upcoming.length === 0) {
          facts = `No cached upcoming flights were found from ${originIata}${destIata ? ` to ${destIata}` : ''} for today (${date}). The board may not be warmed up for this route yet.`;
        } else {
          facts = `Today's (${date}) upcoming flights from ${originIata}${destIata ? ` to ${destIata}` : ''}: ` +
            upcoming.map((f: any) => `${f.flightNumber} (${f.airline || 'unknown airline'}) departing ${new Date(f.scheduledDeparture).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' })} Lagos time, status ${f.status}`).join('; ') + '.';
        }
      }
    } else {
      facts = 'No specific price or flight lookup was triggered for this message -- answer generally and briefly, and if the question sounds like it needs a specific price or flight, ask which route (e.g. "Lagos to Enugu").';
    }

    const prompt = buildPrompt(message, caller.hub_name, facts);
    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: prompt,
    });

    res.json({ reply: (response.text || '').trim() || "Sorry, I couldn't come up with an answer -- try rephrasing." });
  } catch (error: any) {
    if (error?.message?.includes('429') || error?.status === 429 || error?.status === 'RESOURCE_EXHAUSTED') {
      res.json({ reply: 'AI Buddy is getting a lot of questions right now -- try again in a minute.' });
      return;
    }
    console.error('[aiChat] /message error:', error);
    res.status(500).json({ error: error?.message || 'Chat failed' });
  }
});

export default router;
