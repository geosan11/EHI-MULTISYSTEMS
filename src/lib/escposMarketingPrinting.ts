import {
  encoder, INIT, CENTER, LEFT, TEXT_NORMAL, TEXT_DOUBLE_HEIGHT,
  BOLD_ON, BOLD_OFF, FEED_AND_CUT,
  concatChunks, qrAsRaster, textHeaderWithAirline, fieldRow, divider,
} from './escposShared';

export interface MarketingReceiptPrintData {
  entryRef: string;
  date: string;
  agentName: string;
  customerName: string;
  phone?: string;
  route: string;
  bigBags: number;
  medBags: number;
  smallBags: number;
  amount: number;
  paymentMode: string;
  paymentNarration?: string;
  bankName?: string;
  airline?: string;
  trackingUrl: string;
}

export async function compileMarketingReceiptStream(data: MarketingReceiptPrintData, width: '58mm' | '80mm'): Promise<Uint8Array> {
  const maxChars = width === '58mm' ? 32 : 48;
  // CUSTOMER/MERCHANT copy split -- matches escposCargoReceiptPrinting.ts,
  // which already does this; marketing never had it.
  const copies = ['CUSTOMER COPY', 'MERCHANT COPY'];
  let allChunks: Uint8Array[] = [];

  for (const copyType of copies) {
    // Text-only header, no EHI logo, no airline logo, at either width --
    // keeps this receipt as short/fast to print as possible. Passing '' as
    // the airline skips the logo/fallback section entirely.
    const chunks: Uint8Array[] = [new Uint8Array(INIT), ...(await textHeaderWithAirline('', 0))];

    chunks.push(new Uint8Array(TEXT_DOUBLE_HEIGHT), new Uint8Array(BOLD_ON));
    chunks.push(encoder.encode("MARKETING SALES RECEIPT\n\n"));
    chunks.push(new Uint8Array(BOLD_OFF), new Uint8Array(TEXT_NORMAL));

    chunks.push(new Uint8Array(CENTER), new Uint8Array(BOLD_ON));
    chunks.push(encoder.encode(`*** ${copyType} ***\n\n`));
    chunks.push(new Uint8Array(BOLD_OFF));

    // QR dropped on 58mm -- see note above.
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
    chunks.push(encoder.encode(fieldRow('ROUTE:', data.route, maxChars)));
    chunks.push(encoder.encode(divider(maxChars)));

    // Clean, structured border for Bag Breakdown section
    chunks.push(encoder.encode(divider(maxChars, '=')));
    chunks.push(new Uint8Array(CENTER), new Uint8Array(BOLD_ON));
    chunks.push(encoder.encode("BAG BREAKDOWN\n"));
    chunks.push(new Uint8Array(BOLD_OFF), new Uint8Array(LEFT));
    chunks.push(encoder.encode(divider(maxChars, '=')));

    if (data.bigBags > 0) chunks.push(encoder.encode(fieldRow('  Big Bags:', `${data.bigBags}`, maxChars)));
    if (data.medBags > 0) chunks.push(encoder.encode(fieldRow('  Medium Bags:', `${data.medBags}`, maxChars)));
    if (data.smallBags > 0) chunks.push(encoder.encode(fieldRow('  Small Bags:', `${data.smallBags}`, maxChars)));
    chunks.push(encoder.encode(divider(maxChars)));

    // Double-height highlight on amount to capture attention clearly
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
    chunks.push(encoder.encode("Track your cargo: app.ehimultisystems.com\n"));

    chunks.push(new Uint8Array(FEED_AND_CUT));
    allChunks.push(...chunks);
  }

  return concatChunks(allChunks);
}
