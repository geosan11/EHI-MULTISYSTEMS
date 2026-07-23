import {
  encoder, INIT, CENTER, LEFT, TEXT_NORMAL, TEXT_DOUBLE_HEIGHT,
  BOLD_ON, BOLD_OFF, FEED_AND_CUT,
  concatChunks, qrAsRaster, brandingHeaderWithAirline, textHeaderWithAirline, fieldRow, divider,
} from './escposShared';

export interface PackageReceiptPrintData {
  entryRef: string;
  date: string;
  agentName: string;
  customerName: string;
  phone?: string;
  destination: string;
  contentType: string;
  pieces?: number;
  kg?: number;
  contents?: string;
  amount: number;
  paymentMode: string;
  paymentNarration?: string;
  bankName?: string;
  trackingUrl: string;
}

export async function compilePackageReceiptStream(data: PackageReceiptPrintData, width: '58mm' | '80mm'): Promise<Uint8Array> {
  const maxChars = width === '58mm' ? 32 : 48;
  // CUSTOMER/MERCHANT copy split -- matches escposCargoReceiptPrinting.ts,
  // which already does this; package never had it.
  const copies = ['CUSTOMER COPY', 'MERCHANT COPY'];
  let allChunks: Uint8Array[] = [];

  for (const copyType of copies) {
    // No airline for this desk. 58mm: plain-text EHI header, no logo raster
    // at all -- keeps this width fast to print. 80mm keeps the full EHI logo
    // image via brandingHeaderWithAirline('', width), which falls back to
    // the plain EHI-only header since there's no airline.
    const chunks: Uint8Array[] = [
      new Uint8Array(INIT),
      ...(width === '58mm' ? await textHeaderWithAirline('', 100) : await brandingHeaderWithAirline('', width)),
    ];

    chunks.push(new Uint8Array(TEXT_DOUBLE_HEIGHT), new Uint8Array(BOLD_ON));
    chunks.push(encoder.encode("PACKAGE / PARCEL RECEIPT\n\n"));
    chunks.push(new Uint8Array(BOLD_OFF), new Uint8Array(TEXT_NORMAL));

    chunks.push(new Uint8Array(CENTER), new Uint8Array(BOLD_ON));
    chunks.push(encoder.encode(`*** ${copyType} ***\n\n`));
    chunks.push(new Uint8Array(BOLD_OFF));

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
    if (data.pieces) chunks.push(encoder.encode(fieldRow('PCS:', String(data.pieces), maxChars)));
    if (data.kg) chunks.push(encoder.encode(fieldRow('KG:', String(data.kg), maxChars)));
    if (data.contents) chunks.push(encoder.encode(fieldRow('CONTENTS:', data.contents, maxChars)));
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
    chunks.push(encoder.encode("Track your package: app.ehimultisystems.com\n"));

    chunks.push(new Uint8Array(FEED_AND_CUT));
    allChunks.push(...chunks);
  }

  return concatChunks(allChunks);
}
