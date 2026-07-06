import {
  encoder, INIT, CENTER, LEFT, TEXT_NORMAL, TEXT_DOUBLE_HEIGHT,
  BOLD_ON, BOLD_OFF, FEED_AND_CUT,
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

export async function compileSingleTag(item: CargoTagData, width: '58mm' | '80mm'): Promise<Uint8Array> {
  const maxChars = width === '58mm' ? 32 : 48;
  // EHI + airline logos side-by-side in a single composite raster
  const chunks: Uint8Array[] = [
    new Uint8Array(INIT),
    ...(await brandingHeaderWithAirline(item.airline || '', width)),
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

  // Use qrAsRaster for the QR code
  const trackingUrl = `https://ehimultisystems.com/track?ref=${encodeURIComponent(item.id)}`;
  chunks.push(await qrAsRaster(trackingUrl, width === '58mm' ? 140 : 180));
  chunks.push(encoder.encode('\n\n'));

    chunks.push(new Uint8Array(LEFT));
  chunks.push(encoder.encode(divider(maxChars, '=')));
  chunks.push(new Uint8Array(CENTER));
  chunks.push(new Uint8Array(TEXT_DOUBLE_HEIGHT), new Uint8Array(BOLD_ON));
  chunks.push(encoder.encode(`PIECE ${item.pieceNo}\n`));
  chunks.push(new Uint8Array(BOLD_OFF), new Uint8Array(TEXT_NORMAL));
  chunks.push(encoder.encode(`WEIGHT: ${item.weight} KG\n`));
  chunks.push(encoder.encode(divider(maxChars, '=')));
  
  chunks.push(new Uint8Array(LEFT));
  if (item.name) chunks.push(encoder.encode(`CONSIGNEE: ${item.name}\n`));
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
  
  for (let i = 1; i <= piecesCount; i++) {
    const tagData: CargoTagData = {
      id: tx.awbTagNumber || tx.entryRef || tx.id,
      name: tx.consignee || tx.name,
      route: tx.route || '',
      pieceNo: `${i} of ${piecesCount}`,
      weight: Math.round((tx.kg || 0) / piecesCount) || tx.kg || 0,
      airline: tx.airline,
      hubName: tx.hubName,
      date: tx.date || new Date().toLocaleDateString('en-GB'),
    };
    tagChunks.push(await compileSingleTag(tagData, width));
  }
  
  return concatChunks(tagChunks);
}

export async function printBluetoothTag(tx: any, width: '58mm' | '80mm'): Promise<void> {
  const bytes = await compileCargoTagStream(tx, width);
  await printViaBluetooth(bytes);
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

async function compileSingleMarketingTag(item: MarketingTagData, width: '58mm' | '80mm'): Promise<Uint8Array> {
  const maxChars = width === '58mm' ? 32 : 48;
  const chunks: Uint8Array[] = [
    new Uint8Array(INIT),
    ...(await brandingHeaderWithAirline(item.airline || '', width)),
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

  const trackingUrl = `https://ehimultisystems.com/track?ref=${encodeURIComponent(item.awb)}`;
  chunks.push(await qrAsRaster(trackingUrl, width === '58mm' ? 140 : 180));
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

  const bags: Array<{ type: 'BB' | 'MB' | 'SB'; full: string; count: number }> = [
    { type: 'BB', full: 'BIG BAG',   count: bbCount },
    { type: 'MB', full: 'MED BAG',   count: mbCount },
    { type: 'SB', full: 'SMALL BAG', count: sbCount },
  ];

  for (const bag of bags) {
    for (let i = 1; i <= bag.count; i++) {
      tagChunks.push(await compileSingleMarketingTag({
        awb,
        customerName: tx.name,
        route: tx.route || '',
        bagType: bag.type,
        bagTypeFull: bag.full,
        pieceNo: `${i} of ${bag.count}`,
        airline: tx.airline,
        hubName: tx.hub,
        date,
      }, width));
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
  const bytes = await compileMarketingTagStream(tx, bbCount, mbCount, sbCount, width);
  await printViaBluetooth(bytes);
}
