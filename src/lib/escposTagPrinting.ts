import {
  encoder, INIT, CENTER, LEFT, TEXT_NORMAL, TEXT_DOUBLE_HEIGHT,
  BOLD_ON, BOLD_OFF, FEED_AND_CUT, FEED_ONLY,
  concatChunks, brandingHeader, brandingHeaderWithAirline, fieldRow, divider, qrAsRaster
} from './escposShared';
import { printViaBluetooth } from './escpos';

export interface CargoTagData {
  id: string; // AWB Tag number / Ref
  name: string; // Consignee / Passenger name
  route: string;
  pieceNo: string; // e.g. "1 of 5"
  weight: number | string;
  airline?: string;
  hubName?: string;
  date?: string;
}

export async function compileSingleTag(
  item: CargoTagData,
  width: '58mm' | '80mm',
  precomputed?: { header: Uint8Array[]; qr: Uint8Array }
): Promise<Uint8Array> {
  const maxChars = width === '58mm' ? 32 : 48;
  // EHI + airline logos side-by-side in a single composite raster.
  // Reuses a pre-computed header/QR when supplied (see
  // compileCargoTagStream) rather than re-rasterizing the identical image
  // for every piece in a multi-piece shipment.
  const chunks: Uint8Array[] = [
    new Uint8Array(INIT),
    ...(precomputed?.header ?? await brandingHeaderWithAirline(item.airline || '', width, 'cargo')),
  ];

  chunks.push(new Uint8Array(CENTER));
  chunks.push(new Uint8Array(BOLD_ON));
  chunks.push(encoder.encode("CARGO ROUTING TAG\n\n"));
  
  if (item.route) {
    chunks.push(new Uint8Array(TEXT_DOUBLE_HEIGHT));
    chunks.push(encoder.encode(`${item.route.toUpperCase()}\n`));
    chunks.push(new Uint8Array(TEXT_NORMAL));
  }
  
  chunks.push(new Uint8Array(TEXT_DOUBLE_HEIGHT));
  chunks.push(encoder.encode(`AWB: ${item.id}\n`));
  chunks.push(new Uint8Array(TEXT_NORMAL));
  chunks.push(encoder.encode('\n'));

  if (precomputed?.qr) {
    chunks.push(precomputed.qr);
  } else {
    const trackingUrl = `https://app.ehimultisystems.com/track?ref=${encodeURIComponent(item.id)}`;
    chunks.push(await qrAsRaster(trackingUrl, width === '58mm' ? 260 : 280));
  }
  chunks.push(encoder.encode('\n\n'));

    chunks.push(new Uint8Array(LEFT));
  chunks.push(encoder.encode(divider(maxChars, '=')));
  chunks.push(new Uint8Array(CENTER));
  chunks.push(new Uint8Array(TEXT_DOUBLE_HEIGHT), new Uint8Array(BOLD_ON));
  chunks.push(encoder.encode(`PIECE ${item.pieceNo}\n`));
  // Weight stays double-height+bold (was reset to TEXT_NORMAL here before,
  // the only field on the tag besides route/AWB/piece that a handler reads
  // at a glance -- it shouldn't print smaller than those.
  chunks.push(encoder.encode(`WEIGHT: ${item.weight} KG\n`));
  chunks.push(new Uint8Array(BOLD_OFF), new Uint8Array(TEXT_NORMAL));
  chunks.push(encoder.encode(divider(maxChars, '=')));

  chunks.push(new Uint8Array(LEFT));
  if (item.name) {
    // Consignee likewise bumped to double-height+bold, then reset before
    // the secondary fields (airline/hub/date) that stay small.
    chunks.push(new Uint8Array(TEXT_DOUBLE_HEIGHT), new Uint8Array(BOLD_ON));
    chunks.push(encoder.encode(`CONSIGNEE: ${item.name}\n`));
    chunks.push(new Uint8Array(BOLD_OFF), new Uint8Array(TEXT_NORMAL));
  }
  if (item.airline) chunks.push(encoder.encode(`AIRLINE: ${item.airline}\n`));
  if (item.hubName) chunks.push(encoder.encode(`HUB: ${item.hubName}\n`));
  if (item.date) chunks.push(encoder.encode(`DATE: ${item.date}\n`));
  chunks.push(encoder.encode(divider(maxChars)));

  chunks.push(new Uint8Array(FEED_AND_CUT));
  return concatChunks(chunks);
}

export async function compileCargoTagStream(tx: any, width: '58mm' | '80mm'): Promise<Uint8Array> {
  const piecesCount = tx.pieces || 1;
  const tagChunks: Uint8Array[] = [];
  const sharedId = tx.awbTagNumber || tx.entryRef || tx.id;

  // The logo header and QR code are identical for every piece in this
  // shipment (same airline, same tracking reference) -- compute both once
  // instead of re-rasterizing and re-transmitting the same bytes over
  // Bluetooth for every single piece.
  const precomputed = {
    header: await brandingHeaderWithAirline(tx.airline || '', width, 'cargo'),
    qr: await qrAsRaster(
      `https://app.ehimultisystems.com/track?ref=${encodeURIComponent(sharedId)}`,
      width === '58mm' ? 260 : 280
    ),
  };

  for (let i = 1; i <= piecesCount; i++) {
    const tagData: CargoTagData = {
      id: sharedId,
      name: tx.consignee || tx.name,
      route: tx.route || '',
      pieceNo: `${i} of ${piecesCount}`,
      weight: Math.round((tx.kg || 0) / piecesCount) || tx.kg || 0,
      airline: tx.airline,
      hubName: tx.hubName,
      date: tx.date || new Date().toLocaleDateString('en-GB'),
    };
    tagChunks.push(await compileSingleTag(tagData, width, precomputed));
  }

  return concatChunks(tagChunks);
}

export async function printBluetoothTag(tx: any, width: '58mm' | '80mm'): Promise<void> {
  await printViaBluetooth(() => compileCargoTagStream(tx, width));
}

// ── MARKETING ROUTING TAGS ──────────────────────────────────────────────────
// One tag per bag (BB/MB/SB). Each tag shows customer, route, AWB, bag type.

interface MarketingTagData {
  awb: string;
  customerName: string;
  route: string;
  bagType: 'BB' | 'MB' | 'SB';
  bagTypeFull: string;
  pieceNo: string; // e.g. "1 of 2"
  airline?: string;
  hubName?: string;
  date?: string;
}

async function compileSingleMarketingTag(
  item: MarketingTagData,
  width: '58mm' | '80mm',
  precomputed?: { header: Uint8Array[]; qr: Uint8Array }
): Promise<Uint8Array> {
  const maxChars = width === '58mm' ? 32 : 48;
  const chunks: Uint8Array[] = [
    new Uint8Array(INIT),
    ...(precomputed?.header ?? await brandingHeaderWithAirline(item.airline || '', width, 'cargo')),
  ];

  chunks.push(new Uint8Array(CENTER));
  chunks.push(new Uint8Array(BOLD_ON));
  chunks.push(encoder.encode('CARGO ROUTING TAG\n\n'));

  if (item.route) {
    chunks.push(new Uint8Array(TEXT_DOUBLE_HEIGHT));
    chunks.push(encoder.encode(`${item.route.toUpperCase()}\n`));
    chunks.push(new Uint8Array(TEXT_NORMAL));
  }

  chunks.push(new Uint8Array(TEXT_DOUBLE_HEIGHT));
  chunks.push(encoder.encode(`AWB: ${item.awb}\n`));
  chunks.push(new Uint8Array(TEXT_NORMAL));
  chunks.push(new Uint8Array(BOLD_OFF));
  chunks.push(encoder.encode('\n'));

  if (precomputed?.qr) {
    chunks.push(precomputed.qr);
  } else {
    const trackingUrl = `https://app.ehimultisystems.com/track?ref=${encodeURIComponent(item.awb)}`;
    chunks.push(await qrAsRaster(trackingUrl, width === '58mm' ? 260 : 280));
  }
  chunks.push(encoder.encode('\n\n'));

  chunks.push(new Uint8Array(LEFT));
  chunks.push(encoder.encode(divider(maxChars, '=')));
  chunks.push(new Uint8Array(CENTER));
  chunks.push(new Uint8Array(TEXT_DOUBLE_HEIGHT), new Uint8Array(BOLD_ON));
  chunks.push(encoder.encode(`${item.bagType} - ${item.pieceNo}\n`));
  chunks.push(new Uint8Array(BOLD_OFF), new Uint8Array(TEXT_NORMAL));
  chunks.push(encoder.encode(`${item.bagTypeFull}\n`));
  chunks.push(encoder.encode(divider(maxChars, '=')));

  chunks.push(new Uint8Array(LEFT));
  chunks.push(encoder.encode(`CUSTOMER: ${item.customerName}\n`));
  if (item.hubName) chunks.push(encoder.encode(`HUB: ${item.hubName}\n`));
  if (item.date) chunks.push(encoder.encode(`DATE: ${item.date}\n`));
  chunks.push(encoder.encode(divider(maxChars)));

  chunks.push(new Uint8Array(FEED_AND_CUT));
  return concatChunks(chunks);
}

export async function compileMarketingTagStream(
  tx: { awb_tag_number?: string; id: string; name: string; route?: string; hub?: string; airline?: string },
  bbCount: number,
  mbCount: number,
  sbCount: number,
  width: '58mm' | '80mm',
): Promise<Uint8Array> {
  const awb = tx.awb_tag_number || tx.id;
  const date = new Date().toLocaleDateString('en-GB');
  const tagChunks: Uint8Array[] = [];

  // Same reasoning as compileCargoTagStream -- every bag tag in this
  // shipment shares the same airline logo and the same tracking reference,
  // so compute both once instead of re-rasterizing per piece.
  const precomputed = {
    header: await brandingHeaderWithAirline(tx.airline || '', width, 'cargo'),
    qr: await qrAsRaster(
      `https://app.ehimultisystems.com/track?ref=${encodeURIComponent(awb)}`,
      width === '58mm' ? 260 : 280
    ),
  };

  const bags: Array<{ type: 'BB' | 'MB' | 'SB'; full: string; count: number }> = [
    { type: 'BB', full: 'BIG BAG',   count: bbCount },
    { type: 'MB', full: 'MED BAG',   count: mbCount },
    { type: 'SB', full: 'SMALL BAG', count: sbCount },
  ];

  // Running count across all bags (not per-type) so every physical bag in
  // this shipment gets its own sequential tag number -- base AWB plus this
  // suffix -- instead of every tag showing the identical AWB. The QR code
  // above still points at the shared base AWB via `precomputed`.
  let pieceSeq = 0;
  for (const bag of bags) {
    for (let i = 1; i <= bag.count; i++) {
      pieceSeq++;
      tagChunks.push(await compileSingleMarketingTag({
        awb: `${awb}-${pieceSeq}`,
        customerName: tx.name,
        route: tx.route || '',
        bagType: bag.type,
        bagTypeFull: bag.full,
        pieceNo: `${i} of ${bag.count}`,
        airline: tx.airline,
        hubName: tx.hub,
        date,
      }, width, precomputed));
    }
  }

  return concatChunks(tagChunks);
}

export async function printMarketingTags(
  tx: { awb_tag_number?: string; id: string; name: string; route?: string; hub?: string; airline?: string },
  bbCount: number,
  mbCount: number,
  sbCount: number,
  width: '58mm' | '80mm',
): Promise<void> {
  await printViaBluetooth(() => compileMarketingTagStream(tx, bbCount, mbCount, sbCount, width));
}

// 100mm x 80mm gap/die-cut label format for the XP-402B and similar label
// printers -- a DISCRETE fixed-size label, not continuous roll paper like
// the 58mm/80mm formats above. Two things are therefore different from
// the continuous-roll tag functions: the width is a raw dot count (100mm
// at 203dpi, rounded down to a multiple of 8) rather than one of the
// '58mm'/'80mm' presets, and it ends with FEED_ONLY instead of
// FEED_AND_CUT, since gap/die-cut label printers commonly have no cutting
// blade at all -- they just feed to the next label's tear/perforation
// point using their own gap-sensor.
const GAP_LABEL_WIDTH_DOTS = 792; // 100mm at 203dpi, rounded to a multiple of 8

export async function compileGapLabelTag(item: CargoTagData): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [
    new Uint8Array(INIT),
    ...(await brandingHeaderWithAirline(item.airline || '', GAP_LABEL_WIDTH_DOTS, 'cargo')),
  ];

  chunks.push(new Uint8Array(CENTER));
  chunks.push(new Uint8Array(BOLD_ON));
  // Single \n here (was \n\n) -- reclaims one blank line's worth of the
  // fixed 80mm label length to offset WEIGHT/CONSIGNEE now printing
  // double-height below. Unlike the continuous-roll 58mm/80mm tag, this
  // format is a genuinely fixed-length die-cut label with no reflow, so
  // net vertical space is kept roughly unchanged rather than growing.
  chunks.push(encoder.encode("CARGO ROUTING TAG\n"));

  if (item.route) {
    chunks.push(new Uint8Array(TEXT_DOUBLE_HEIGHT));
    chunks.push(encoder.encode(`${item.route.toUpperCase()}\n`));
    chunks.push(new Uint8Array(TEXT_NORMAL));
  }

  chunks.push(new Uint8Array(TEXT_DOUBLE_HEIGHT));
  chunks.push(encoder.encode(`AWB: ${item.id}\n`));
  chunks.push(new Uint8Array(TEXT_NORMAL));
  chunks.push(encoder.encode('\n'));

  const trackingUrl = `https://app.ehimultisystems.com/track?ref=${encodeURIComponent(item.id)}`;
  chunks.push(await qrAsRaster(trackingUrl, 320));
  chunks.push(encoder.encode('\n'));

  chunks.push(new Uint8Array(LEFT));
  chunks.push(encoder.encode(divider(64, '=')));
  chunks.push(new Uint8Array(CENTER));
  chunks.push(new Uint8Array(TEXT_DOUBLE_HEIGHT), new Uint8Array(BOLD_ON));
  chunks.push(encoder.encode(`PIECE ${item.pieceNo}\n`));
  chunks.push(encoder.encode(`WEIGHT: ${item.weight} KG\n`));
  chunks.push(new Uint8Array(BOLD_OFF), new Uint8Array(TEXT_NORMAL));
  chunks.push(encoder.encode(divider(64, '=')));

  chunks.push(new Uint8Array(LEFT));
  if (item.name) {
    // Capped so a long name can't eat into the fixed label's remaining
    // length at double-height size -- same reasoning as CargoTagPDF's
    // truncateForTag.
    const name = item.name.length > 32 ? item.name.slice(0, 31).trimEnd() + '…' : item.name;
    chunks.push(new Uint8Array(TEXT_DOUBLE_HEIGHT), new Uint8Array(BOLD_ON));
    chunks.push(encoder.encode(`CONSIGNEE: ${name}\n`));
    chunks.push(new Uint8Array(BOLD_OFF), new Uint8Array(TEXT_NORMAL));
  }
  if (item.airline) chunks.push(encoder.encode(`AIRLINE: ${item.airline}\n`));
  if (item.hubName) chunks.push(encoder.encode(`HUB: ${item.hubName}\n`));
  if (item.date) chunks.push(encoder.encode(`DATE: ${item.date}\n`));
  chunks.push(encoder.encode(divider(64)));

  chunks.push(new Uint8Array(FEED_ONLY));
  return concatChunks(chunks);
}

export async function printGapLabelTag(tx: any): Promise<void> {
  const tagData: CargoTagData = {
    id: tx.awbTagNumber || tx.entryRef || tx.id,
    name: tx.consignee || tx.name,
    route: tx.route || '',
    pieceNo: `1 of ${tx.pieces || 1}`,
    weight: tx.kg || 0,
    airline: tx.airline,
    hubName: tx.hubName,
    date: tx.date || new Date().toLocaleDateString('en-GB'),
  };
  await printViaBluetooth(() => compileGapLabelTag(tagData));
}
