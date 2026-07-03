import {
  encoder, INIT, CENTER, LEFT, TEXT_NORMAL, TEXT_DOUBLE_HEIGHT,
  BOLD_ON, BOLD_OFF, FEED_AND_CUT,
  concatChunks, brandingHeader, fieldRow, divider,
  getAirlineLogoPath, imageToEscPosRaster,
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
  const chunks: Uint8Array[] = [
    new Uint8Array(INIT),
    ...(await brandingHeader())
  ];

  const airlineLogoPath = getAirlineLogoPath(item.airline || '');
  if (airlineLogoPath) {
    try {
      chunks.push(await imageToEscPosRaster(airlineLogoPath, 120));
      chunks.push(encoder.encode('\n'));
    } catch {
      // No airline logo available -- print without one rather than fail
    }
  }

  chunks.push(new Uint8Array(CENTER));
  chunks.push(new Uint8Array(TEXT_DOUBLE_HEIGHT), new Uint8Array(BOLD_ON));
  chunks.push(encoder.encode("CARGO TAG\n"));
  chunks.push(new Uint8Array(BOLD_OFF), new Uint8Array(TEXT_NORMAL));
  chunks.push(encoder.encode(`PIECE ${item.pieceNo}\n\n`));

  chunks.push(new Uint8Array(LEFT));
  chunks.push(encoder.encode(divider(maxChars)));
  chunks.push(encoder.encode(fieldRow('TAG/AWB:', item.id, maxChars)));
  chunks.push(encoder.encode(fieldRow('ROUTE:', item.route, maxChars)));
  chunks.push(encoder.encode(fieldRow('CONSIGNEE:', item.name, maxChars)));
  chunks.push(encoder.encode(fieldRow('WEIGHT:', `${item.weight} KG`, maxChars)));
  if (item.airline) chunks.push(encoder.encode(fieldRow('AIRLINE:', item.airline, maxChars)));
  if (item.hubName) chunks.push(encoder.encode(fieldRow('HUB:', item.hubName, maxChars)));
  if (item.date) chunks.push(encoder.encode(fieldRow('DATE:', item.date, maxChars)));
  chunks.push(encoder.encode(divider(maxChars)));

  chunks.push(new Uint8Array(CENTER));
  chunks.push(encoder.encode(`\n${item.id}\n`));

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
