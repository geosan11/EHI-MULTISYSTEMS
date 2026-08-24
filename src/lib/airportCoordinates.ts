// Static IATA -> {lat, lng, name} lookup for Flight Radar's route map
// (src/components/views/FlightRadar.tsx). Airport locations never change,
// so this is a one-time hardcoded table rather than a live API call --
// coordinates for the 19 Nigerian airports came from each airport's own
// Wikipedia infobox (verified individually, not guessed); the
// international entries are well-known major hub coordinates.
//
// Covers every airport in CARGO_ROUTES (src/lib/constants.ts) plus common
// international destinations Nigerian carriers/foreign airlines actually
// fly to from these airports. An airport missing from this table just
// means FlightRouteMap skips the map for that flight (falls back to the
// existing text-only departure/arrival card) -- never an error.
export interface AirportCoordinate {
  lat: number;
  lng: number;
  name: string;
}

export const AIRPORT_COORDINATES: Record<string, AirportCoordinate> = {
  // ── Nigeria (every CARGO_ROUTES airport) ──────────────────────────
  LOS: { lat: 6.5774, lng: 3.3212, name: 'Lagos (Murtala Muhammed Intl)' },
  ABV: { lat: 9.0068, lng: 7.2632, name: 'Abuja (Nnamdi Azikiwe Intl)' },
  PHC: { lat: 5.0153, lng: 6.9500, name: 'Port Harcourt Intl' },
  KAN: { lat: 12.0486, lng: 8.5222, name: 'Kano (Mallam Aminu Kano Intl)' },
  ENU: { lat: 6.4739, lng: 7.5611, name: 'Enugu (Akanu Ibiam Intl)' },
  ABB: { lat: 6.2042, lng: 6.6653, name: 'Asaba Intl' },
  AKR: { lat: 7.2486, lng: 5.3014, name: 'Akure Airport' },
  BCU: { lat: 10.4833, lng: 9.7444, name: 'Bauchi State Airport' },
  BNI: { lat: 6.3167, lng: 5.6000, name: 'Benin Airport' },
  CBQ: { lat: 4.9758, lng: 8.3472, name: 'Calabar (Margaret Ekpo Intl)' },
  GMO: { lat: 10.2989, lng: 10.9000, name: 'Gombe Lawanti Intl' },
  IBA: { lat: 7.3597, lng: 3.9758, name: 'Ibadan Airport' },
  ILR: { lat: 8.4403, lng: 4.4944, name: 'Ilorin Intl' },
  KAD: { lat: 10.6958, lng: 7.3208, name: 'Kaduna Intl' },
  MIU: { lat: 11.8556, lng: 13.0819, name: 'Maiduguri Intl' },
  QOW: { lat: 5.4264, lng: 7.2056, name: 'Owerri (Sam Mbakwe Intl)' },
  QUO: { lat: 4.8736, lng: 8.0944, name: 'Uyo (Victor Attah Intl)' },
  QRW: { lat: 5.5972, lng: 5.8194, name: 'Warri (Osubi Airport)' },
  YOL: { lat: 9.2575, lng: 12.4303, name: 'Yola Airport' },

  // ── Common international destinations ─────────────────────────────
  CMN: { lat: 33.3675, lng: -7.5900, name: 'Casablanca (Mohammed V Intl)' },
  LHR: { lat: 51.4700, lng: -0.4543, name: 'London Heathrow' },
  LGW: { lat: 51.1537, lng: -0.1821, name: 'London Gatwick' },
  EBB: { lat: 0.0424, lng: 32.4436, name: 'Entebbe Intl (Uganda)' },
  ACC: { lat: 5.6052, lng: -0.1668, name: 'Accra (Kotoka Intl)' },
  DXB: { lat: 25.2532, lng: 55.3657, name: 'Dubai Intl' },
  JNB: { lat: -26.1392, lng: 28.2460, name: 'Johannesburg (OR Tambo Intl)' },
  ADD: { lat: 8.9779, lng: 38.7993, name: 'Addis Ababa (Bole Intl)' },
  NBO: { lat: -1.3192, lng: 36.9278, name: 'Nairobi (Jomo Kenyatta Intl)' },
  CAI: { lat: 30.1219, lng: 31.4056, name: 'Cairo Intl' },
  IST: { lat: 41.2753, lng: 28.7519, name: 'Istanbul Airport' },
  AMS: { lat: 52.3105, lng: 4.7683, name: 'Amsterdam (Schiphol)' },
  FRA: { lat: 50.0379, lng: 8.5622, name: 'Frankfurt Airport' },
  CDG: { lat: 49.0097, lng: 2.5479, name: 'Paris (Charles de Gaulle)' },
  ATL: { lat: 33.6407, lng: -84.4277, name: 'Atlanta Intl' },
  JFK: { lat: 40.6413, lng: -73.7781, name: 'New York (JFK)' },
  IAD: { lat: 38.9531, lng: -77.4565, name: 'Washington Dulles' },
  DSS: { lat: 14.6708, lng: -17.0733, name: 'Dakar (Blaise Diagne Intl)' },
  LFW: { lat: 6.1656, lng: 1.2545, name: 'Lomé Airport (Togo)' },
  COO: { lat: 6.3572, lng: 2.3844, name: 'Cotonou Airport (Benin)' },
  ABJ: { lat: 5.2614, lng: -3.9263, name: 'Abidjan Airport' },
};

export function getAirportCoordinate(iata: string | null | undefined): AirportCoordinate | null {
  if (!iata) return null;
  return AIRPORT_COORDINATES[iata.trim().toUpperCase()] || null;
}
