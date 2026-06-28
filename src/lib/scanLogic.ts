import { supabase } from './supabase';
import { ScanMode, ScanValidationResult, TrackingEvent } from './types';

// Fetch cargo record by QR ref from any table or local transactions
export async function fetchCargoByRef(ref: string, localTransactions?: any[]): Promise<any | null> {
  const cleanRef = ref.trim().toUpperCase();

  // Try local transactions first (for demo mode)
  if (localTransactions && localTransactions.length > 0) {
    const localMatch = localTransactions.find(t => 
      t.id?.toUpperCase() === cleanRef || 
      (t.awb_tag_number && t.awb_tag_number.toUpperCase() === cleanRef)
    );
    if (localMatch) {
      return {
        ...localMatch,
        _table: localMatch.type === 'cargo' ? 'cargo_entries' : 
                localMatch.type === 'baggage' ? 'manifests' : 'marketing_entries',
        awb_tag_number: localMatch.awb_tag_number || localMatch.id,
        route: localMatch.detail?.split(' · ')[4] || '',
        destination: localMatch.detail?.split(' · ')[4] || '',
        consignee_name: localMatch.name,
        passenger_name: localMatch.name,
        customer_name: localMatch.name,
        content_type: localMatch.detail?.split(' · ')[5] || 'Package',
        total_pcs: localMatch.pieces || 1,
        total_kg: localMatch.kg || 0
      };
    }
  }

  // Try cargo_entries first — quote values to handle special characters safely
  const safeRef = cleanRef.replace(/"/g, '');
  const { data: cargoData } = await supabase
    .from('cargo_entries')
    .select('*')
    .or(`entry_ref.eq."${safeRef}",awb_tag_number.eq."${safeRef}"`)
    .limit(1)
    .maybeSingle();

  if (cargoData) return { ...cargoData, _table: 'cargo_entries' };

  // Try manifests (ValueJet)
  const { data: vjData } = await supabase
    .from('manifests')
    .select('*')
    .eq('transaction_id', cleanRef)
    .limit(1)
    .maybeSingle();

  if (vjData) return { ...vjData, _table: 'manifests' };

  // Try marketing_entries (marketing)
  const { data: mktData } = await supabase
    .from('marketing_entries')
    .select('*')
    .eq('entry_ref', cleanRef)
    .limit(1)
    .maybeSingle();

  if (mktData) return { ...mktData, _table: 'marketing_entries' };

  return null;
}

// Check if a hub is a valid transit point for a route
export async function isValidTransitHub(
  origin: string,
  destination: string,
  transitHub: string
): Promise<boolean> {
  // Route definitions table not yet configured.
  // Always returns false — cargo must go directly to destination.
  return false;
}

// Get the last tracking event for a cargo ref at a specific hub
export async function getLastEventAtHub(
  ref: string,
  hubName: string
): Promise<TrackingEvent | null> {
  const { data } = await supabase
    .from('tracking_events')
    .select('*')
    .eq('cargo_ref', ref)
    .ilike('hub_name', `%${hubName.split(' ')[0]}%`)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return data as TrackingEvent | null;
}

// Get the most recent event for any hub
export async function getLastEventAnywhere(
  ref: string
): Promise<TrackingEvent | null> {
  const { data } = await supabase
    .from('tracking_events')
    .select('*')
    .eq('cargo_ref', ref)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return data as TrackingEvent | null;
}

// Core validation function
export async function validateScan(
  rawRef: string,
  mode: ScanMode,
  currentHub: string,
  localTransactions?: any[]
): Promise<ScanValidationResult> {

  let ref = rawRef;
  let inlineCargoData: any = null;

  // Try parsing the QR code as JSON to support offline payloads
  if (rawRef.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(rawRef);
      if (parsed.ref || parsed.id || parsed.awb) {
        ref = parsed.ref || parsed.id || parsed.awb;
        inlineCargoData = parsed;
      }
    } catch {
      // ignore, fall back to string
    }
  }

  // 1. Fetch cargo record
  let cargo = await fetchCargoByRef(ref, localTransactions);

  // If not found in DB but we have inline payload from QR code, use it!
  if (!cargo && inlineCargoData) {
    cargo = {
      id: ref,
      awb_tag_number: ref,
      route: inlineCargoData.destination || inlineCargoData.route || '',
      consignee_name: inlineCargoData.name || inlineCargoData.customerName || 'Unknown',
      content_type: inlineCargoData.content || inlineCargoData.type || 'Baggage',
      total_pcs: inlineCargoData.pieces || inlineCargoData.pcs || 1,
      total_kg: inlineCargoData.kg || inlineCargoData.weight || 0,
      _table: 'inline_qr_payload',
    };
  }

  if (!cargo) {
    return {
      type: 'NOT_FOUND',
      currentHub,
      message: `No cargo found for "${ref}". Check the code and try again.`
    };
  }

  // Map cargo fields regardless of which table it came from
  const destination = cargo.route || cargo.destination || cargo.destination_route || '';
  const cargoName = cargo.consignee_name || cargo.passenger_name || cargo.customer_name || 'Unknown';
  const awb = cargo.awb_tag_number || cargo.transaction_id || cargo.entry_ref || ref;
  const content = cargo.content_type || 'Cargo';

  const cargoInfo = {
    ref,
    name: cargoName,
    destination,
    awb,
    content,
    pieces: cargo.total_pcs,
    kg: cargo.total_kg || cargo.gross_weight,
  };

  // 2. Normalize hub name for comparison
  // "Murtala Air Cargo Station" → check if destination contains "Lagos" or "Murtala"
  const hubWords = currentHub.toLowerCase().split(' ');
  const destLower = destination.toLowerCase();

  // 3. Check if this hub is the final destination
  const isCorrectDestination =
    destLower.includes(hubWords[0]) ||
    hubWords.some(w => w.length > 3 && destLower.includes(w));

  // 4. ARRIVE MODE validation
  if (mode === 'ARRIVE') {

    const lastAnyForArrive = await getLastEventAnywhere(ref);
    // Relaxed constraint: if no event exists, we can still ARRIVE it at a hub (e.g., origin Intake)
    /* if (!lastAnyForArrive) {
      return {
        type: 'NOT_LOGGED_IN',
        cargo: cargoInfo,
        currentHub,
        message: `Data hasn't been logged from depart.`
      };
    } */

    // Check if cargo belongs here (final dest or valid transit)
    if (!isCorrectDestination) {
      const isTransit = await isValidTransitHub('Lagos', destination, currentHub);

      if (!isTransit) {
        // Log the wrong destination alert event
        await supabase.from('tracking_events').insert({
          cargo_ref: ref,
          event_type: 'WRONG_DESTINATION_ALERT',
          hub_name: currentHub,
          cargo_destination: destination,
          alert_reason: `Cargo destined for ${destination} was scanned at ${currentHub}`,
        });

        return {
          type: 'WRONG_DESTINATION',
          cargo: cargoInfo,
          currentHub,
          message: `This cargo is going to ${destination.toUpperCase()}, not ${currentHub.toUpperCase()}.`
        };
      }
    }

    // Check if already arrived here (prevent duplicate ARRIVE)
    const lastEvent = await getLastEventAtHub(ref, currentHub);
    if (lastEvent?.event_type === 'ARRIVE') {
      // Check if it has departed since then
      const allEvents = await supabase
        .from('tracking_events')
        .select('*')
        .eq('cargo_ref', ref)
        .order('created_at', { ascending: false })
        .limit(5);

      const events = allEvents.data || [];
      const lastEventAny = events[0];
      if (lastEventAny?.event_type === 'ARRIVE' &&
          lastEventAny.hub_name.includes(currentHub.split(' ')[0])) {
        return {
          type: 'ALREADY_PROCESSED',
          cargo: cargoInfo,
          lastEvent: {
            type: 'ARRIVE',
            hub: lastEvent.hub_name,
            time: new Date(lastEvent.created_at).toLocaleString('en-NG'),
            by: lastEvent.scanned_by_name || 'Unknown',
          },
          currentHub,
          message: `Already logged as ARRIVED at ${currentHub}.`
        };
      }
    }

    return { type: 'SUCCESS_ARRIVE', cargo: cargoInfo, currentHub };
  }

  // 5. DEPART MODE validation
  if (mode === 'DEPART') {

    // Check if cargo has an ARRIVE record at this hub
    const arriveEvent = await getLastEventAtHub(ref, currentHub);
    const lastAny = await getLastEventAnywhere(ref);

    // Relaxed constraint: if it's the very first event ever, allow it to DEPART (e.g. from origin)
    if (!lastAny && (!arriveEvent || arriveEvent.event_type !== 'ARRIVE')) {
       // Proceed, it's the origin depart
    } else if (lastAny && (!arriveEvent || arriveEvent.event_type !== 'ARRIVE')) {
      return {
        type: 'NOT_LOGGED_IN',
        cargo: cargoInfo,
        lastEvent: lastAny ? {
          type: lastAny.event_type,
          hub: lastAny.hub_name,
          time: new Date(lastAny.created_at).toLocaleString('en-NG'),
          by: lastAny.scanned_by_name || 'Unknown',
        } : undefined,
        currentHub,
        message: `Cargo has no ARRIVE record at ${currentHub}. Scan ARRIVE first.`
      };
    }

    // Check if already departed
    const recentEvents = await supabase
      .from('tracking_events')
      .select('*')
      .eq('cargo_ref', ref)
      .order('created_at', { ascending: false })
      .limit(3);

    const events = recentEvents.data || [];
    if (events[0]?.event_type === 'DEPART') {
      return {
        type: 'ALREADY_PROCESSED',
        cargo: cargoInfo,
        lastEvent: {
          type: 'DEPART',
          hub: events[0].hub_name,
          time: new Date(events[0].created_at).toLocaleString('en-NG'),
          by: events[0].scanned_by_name || 'Unknown',
        },
        currentHub,
        message: `Already logged as DEPARTED from ${currentHub}.`
      };
    }

    return { type: 'SUCCESS_DEPART', cargo: cargoInfo, currentHub };
  }

  // 6. DELIVER MODE validation
  if (mode === 'DELIVER') {
    const arriveEvent = await getLastEventAtHub(ref, currentHub);
    const lastAny = await getLastEventAnywhere(ref);

    // If it's the very first event, just let it deliver for demo purposes (or fail appropriately)
    if (lastAny && (!arriveEvent || arriveEvent.event_type !== 'ARRIVE')) {
      return {
        type: 'NOT_LOGGED_IN',
        cargo: cargoInfo,
        lastEvent: lastAny ? {
          type: lastAny.event_type,
          hub: lastAny.hub_name,
          time: new Date(lastAny.created_at).toLocaleString('en-NG'),
          by: lastAny.scanned_by_name || 'Unknown',
        } : undefined,
        currentHub,
        message: `Cargo has no ARRIVE record at ${currentHub}. Scan ARRIVE first before Delivery.`
      };
    }

    // Check if already delivered
    const recentEvents = await supabase
      .from('tracking_events')
      .select('*')
      .eq('cargo_ref', ref)
      .order('created_at', { ascending: false })
      .limit(3);

    const events = recentEvents.data || [];
    if (events[0]?.event_type === 'DELIVER') {
      return {
        type: 'ALREADY_PROCESSED',
        cargo: cargoInfo,
        lastEvent: {
          type: 'DELIVER',
          hub: events[0].hub_name,
          time: new Date(events[0].created_at).toLocaleString('en-NG'),
          by: events[0].scanned_by_name || 'Unknown',
        },
        currentHub,
        message: `Already logged as DELIVERED.`
      };
    }

    return { type: 'SUCCESS_DELIVER', cargo: cargoInfo, currentHub };
  }

  return { type: 'ERROR', currentHub, message: 'Unknown scan mode.' };
}

// Log a successful scan event
export async function logScanEvent(
  ref: string,
  mode: ScanMode,
  currentHub: string,
  scannedByName: string,
  cargoDestination?: string
): Promise<void> {
  await supabase.from('tracking_events').insert({
    cargo_ref: ref,
    event_type: mode,
    hub_name: currentHub,
    scanned_by_name: scannedByName,
    cargo_destination: cargoDestination,
  });

  // Map scan mode to status
  let newStatus = '';
  if (mode === 'ARRIVE')  newStatus = 'Arrived';
  if (mode === 'DEPART')  newStatus = 'In-Transit';
  if (mode === 'DELIVER') newStatus = 'Delivered';
  if (!newStatus) return;

  // Find which table the ref belongs to, update status, and collect phone numbers for notification
  let consigneeName    = '';
  let consigneePhone   = '';
  let senderPhone      = '';
  let pin: string | undefined;

  const cargoHit = await supabase.from('cargo_entries').select('entry_ref, consignee_name, consignee_phone, sender_phone, pickup_pin').eq('entry_ref', ref).limit(1).maybeSingle();
  if (cargoHit.data) {
    await supabase.from('cargo_entries').update({ status: newStatus }).eq('entry_ref', ref);
    consigneeName  = cargoHit.data.consignee_name || '';
    consigneePhone = cargoHit.data.consignee_phone || '';
    senderPhone    = cargoHit.data.sender_phone || '';
    pin            = cargoHit.data.pickup_pin || undefined;
  } else {
    const vjHit = await supabase.from('manifests').select('transaction_id, passenger_name, passenger_phone').eq('transaction_id', ref).limit(1).maybeSingle();
    if (vjHit.data) {
      await supabase.from('manifests').update({ status: newStatus }).eq('transaction_id', ref);
      consigneeName  = vjHit.data.passenger_name || '';
      consigneePhone = vjHit.data.passenger_phone || '';
    } else {
      const mktHit = await supabase.from('marketing_entries').select('entry_ref, customer_name, customer_phone').eq('entry_ref', ref).limit(1).maybeSingle();
      if (mktHit.data) {
        await supabase.from('marketing_entries').update({ status: newStatus }).eq('entry_ref', ref);
        consigneeName  = mktHit.data.customer_name || '';
        consigneePhone = mktHit.data.customer_phone || '';
      }
    }
  }

  // Fire scan-status notification (no await — background)
  if (consigneePhone || senderPhone) {
    fetch('/api/notify/scan-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: mode,
        cargoRef: ref,
        consigneeName,
        consigneePhone: consigneePhone || undefined,
        senderPhone: senderPhone || undefined,
        hubName: currentHub,
        pin: mode === 'ARRIVE' ? pin : undefined,
      }),
    }).catch(() => { /* fire and forget */ });
  }
}
