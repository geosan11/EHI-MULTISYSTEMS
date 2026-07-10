import {
  encoder, INIT, CENTER, LEFT, TEXT_NORMAL, TEXT_DOUBLE_HEIGHT,
  BOLD_ON, BOLD_OFF, FEED_AND_CUT,
  concatChunks, qrAsRaster, brandingHeaderWithAirline, fieldRow, divider,
} from './escposShared';

export interface PackageReceiptPrintData {
  entryRef: string;
  date: string;
  agentName: string;
  customerName: string;
  phone?: string;
  destination: string;
  contentType: string;
  amount: number;
  paymentMode: string;
  paymentNarration?: string;
  bankName?: string;
  trackingUrl: string;
}

export async function compilePackageReceiptStream(data: PackageReceiptPrintData, width: '58mm' | '80mm'): Promise<Uint8Array> {
  const maxChars = width === '58mm' ? 32 : 48;
  // No airline for this desk -- brandingHeaderWithAirline('') falls back to
  // the plain EHI-only header, same as Cargo entries with no airline set.
  const chunks: Uint8Array[] = [new Uint8Array(INIT), ...(await brandingHeaderWithAirline('', width))];

  chunks.push(new Uint8Array(TEXT_DOUBLE_HEIGHT), new Uint8Array(BOLD_ON));
  chunks.push(encoder.encode("PACKAGE / PARCEL RECEIPT\n\n"));
  chunks.push(new Uint8Array(BOLD_OFF), new Uint8Array(TEXT_NORMAL));

  // QR dropped on 58mm -- keeps the receipt shorter/faster to print.
  if (width !== '58mm') {
    chunks.push(await qrAsRaster(data.trackingUrl, 280));
    chunks.push(encoder.encode('\n\n'));
  }

  chunks.push(new Uint8Array(LEFT));
  chunks.push(encoder.encode(divider(maxChars)));
  chunks.push(encoder.encode(fieldRow('REF:', data.entryRef, maxChars)));
  chunks.push(encoder.encode(fieldRow('DATE:', data.date, maxChars)));
  chunks.push(encoder.encode(fieldRow('AGENT:', data.agentName, maxChars)));
  chunks.push(encoder.encode(divider(maxChars)));
  chunks.push(encoder.encode(fieldRow('CUSTOMER:', data.customerName, maxChars)));
  if (data.phone) chunks.push(encoder.encode(fieldRow('PHONE:', data.phone, maxChars)));
  chunks.push(encoder.encode(fieldRow('DESTINATION:', data.destination, maxChars)));
  chunks.push(encoder.encode(fieldRow('TYPE:', data.contentType, maxChars)));
  chunks.push(encoder.encode(divider(maxChars)));

  chunks.push(new Uint8Array(TEXT_DOUBLE_HEIGHT), new Uint8Array(BOLD_ON));
  chunks.push(encoder.encode(fieldRow('AMOUNT:', `NGN ${data.amount.toLocaleString('en-NG')}`, maxChars)));
  chunks.push(new Uint8Array(BOLD_OFF), new Uint8Array(TEXT_NORMAL));
  chunks.push(encoder.encode(fieldRow('PAYMENT MODE:', data.paymentMode, maxChars)));
  if (data.paymentMode === 'Transfer' && data.paymentNarration) {
    chunks.push(encoder.encode(fieldRow('NARRATION:', data.paymentNarration, maxChars)));
  }
  if (data.bankName) chunks.push(encoder.encode(fieldRow('BANK:', data.bankName, maxChars)));

  chunks.push(new Uint8Array(CENTER));
  chunks.push(encoder.encode(`\n${data.entryRef}\n`));
  chunks.push(encoder.encode("Track your package: ehimultisystems.com\n"));

  chunks.push(new Uint8Array(FEED_AND_CUT));
  return concatChunks(chunks);
}
