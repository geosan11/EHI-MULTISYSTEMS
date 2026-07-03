import {
  encoder, INIT, CENTER, LEFT, TEXT_NORMAL, TEXT_DOUBLE_HEIGHT,
  BOLD_ON, BOLD_OFF, FEED_AND_CUT,
  concatChunks, qrCommands, brandingHeader, fieldRow, divider,
} from './escposShared';

export interface VJReceiptPrintData {
  entryRef: string;
  date: string;
  originState: string;
  agentName: string;
  passengerName: string;
  flight: string;
  destination: string;
  totalPieces: number;
  totalWeightKg: number;
  freeAllowanceKg: number;
  excessChargeKg: number;
  ratePerKg: number;
  amount: number;
  paymentMode: string;
  trackingUrl: string;
}

export function compileVJReceiptStream(data: VJReceiptPrintData, width: '58mm' | '80mm'): Uint8Array {
  const maxChars = width === '58mm' ? 32 : 48;
  const chunks: Uint8Array[] = [new Uint8Array(INIT), ...brandingHeader()];

  chunks.push(new Uint8Array(TEXT_DOUBLE_HEIGHT), new Uint8Array(BOLD_ON));
  chunks.push(encoder.encode("EXCESS BAGGAGE RECEIPT\n"));
  chunks.push(new Uint8Array(BOLD_OFF), new Uint8Array(TEXT_NORMAL));
  chunks.push(encoder.encode("Origin: ValueJet Counter\n\n"));

  chunks.push(...qrCommands(data.trackingUrl));
  chunks.push(new Uint8Array(LEFT));
  chunks.push(encoder.encode(divider(maxChars)));
  chunks.push(encoder.encode(fieldRow('REF:', data.entryRef, maxChars)));
  chunks.push(encoder.encode(fieldRow('DATE:', data.date, maxChars)));
  chunks.push(encoder.encode(fieldRow('ORIGIN STATE:', data.originState, maxChars)));
  chunks.push(encoder.encode(fieldRow('AGENT:', data.agentName, maxChars)));
  chunks.push(encoder.encode(divider(maxChars)));
  chunks.push(encoder.encode(fieldRow('PASSENGER:', data.passengerName, maxChars)));
  chunks.push(encoder.encode(fieldRow('FLIGHT:', data.flight, maxChars)));
  chunks.push(encoder.encode(fieldRow('DESTINATION:', data.destination, maxChars)));
  chunks.push(encoder.encode(divider(maxChars)));

  chunks.push(new Uint8Array(BOLD_ON));
  chunks.push(encoder.encode("BAGGAGE BREAKDOWN\n"));
  chunks.push(new Uint8Array(BOLD_OFF));
  chunks.push(encoder.encode(fieldRow('TOTAL PIECES:', `${data.totalPieces} PCS`, maxChars)));
  chunks.push(encoder.encode(fieldRow('TOTAL WEIGHT:', `${data.totalWeightKg} KG`, maxChars)));
  chunks.push(encoder.encode(fieldRow('FREE ALLOW.:', `${data.freeAllowanceKg} KG`, maxChars)));
  chunks.push(encoder.encode(fieldRow('EXCESS CHRG:', `${data.excessChargeKg} KG`, maxChars)));
  chunks.push(encoder.encode(divider(maxChars)));

  chunks.push(encoder.encode(fieldRow('RATE PER KG:', `NGN ${data.ratePerKg.toLocaleString('en-NG')}`, maxChars)));
  chunks.push(new Uint8Array(TEXT_DOUBLE_HEIGHT), new Uint8Array(BOLD_ON));
  chunks.push(encoder.encode(fieldRow('AMOUNT:', `NGN ${data.amount.toLocaleString('en-NG')}`, maxChars)));
  chunks.push(new Uint8Array(BOLD_OFF), new Uint8Array(TEXT_NORMAL));
  chunks.push(encoder.encode(fieldRow('PAYMENT:', data.paymentMode, maxChars)));

  chunks.push(new Uint8Array(CENTER));
  chunks.push(encoder.encode(`\n${data.entryRef}\n`));
  chunks.push(encoder.encode("Track your cargo: ehimultisystems.com\n"));

  chunks.push(new Uint8Array(FEED_AND_CUT));
  return concatChunks(chunks);
}
