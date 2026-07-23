import {
  encoder, INIT, CENTER, LEFT, TEXT_NORMAL, TEXT_DOUBLE_HEIGHT,
  BOLD_ON, BOLD_OFF, FEED_AND_CUT,
  concatChunks, qrAsRaster, brandingHeaderWithAirline, textHeaderWithAirline, fieldRow, divider, setPrintArea,
} from './escposShared';

export interface CargoReceiptPrintData {
  entryRef: string;
  serialNumber: number;
  date: string;
  hubName: string;
  agentName: string;
  airline: string;
  consignee: string;
  awbTagNumber: string;
  pieces: number;
  kg: number;
  route: string;
  contentType: string;
  amount: number;
  paymentMode: string;
  bankName?: string;
  paymentNarration?: string;
  remark?: string;
  pickupPin?: string;
  trackingUrl: string;
}


export async function compileCargoReceiptStream(data: CargoReceiptPrintData, width: '58mm' | '80mm'): Promise<Uint8Array> {
  const maxChars = width === '58mm' ? 32 : 48;
  const copies = ['CUSTOMER COPY', 'MERCHANT COPY'];
  let allChunks: Uint8Array[] = [];

  for (const copyType of copies) {
    const chunks: Uint8Array[] = [
      new Uint8Array(INIT),
      new Uint8Array(setPrintArea(width)),
      ...(width === '58mm'
        ? await textHeaderWithAirline(data.airline || '', 100)
        : await brandingHeaderWithAirline(data.airline || '', width)),
    ];

    chunks.push(new Uint8Array(TEXT_DOUBLE_HEIGHT), new Uint8Array(BOLD_ON));
    chunks.push(encoder.encode("CARGO ENTRY RECEIPT\n"));
    chunks.push(new Uint8Array(BOLD_OFF), new Uint8Array(TEXT_NORMAL));
    chunks.push(encoder.encode(`Origin: ${data.hubName}\n\n`));

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
    chunks.push(encoder.encode(fieldRow('ENTRY REF:', data.entryRef, maxChars)));
    chunks.push(encoder.encode(fieldRow('S/N:', `Entry #${data.serialNumber}`, maxChars)));
    chunks.push(encoder.encode(fieldRow('DATE:', data.date, maxChars)));
    chunks.push(encoder.encode(divider(maxChars)));
    chunks.push(encoder.encode(fieldRow('AIRLINE:', data.airline, maxChars)));
    chunks.push(encoder.encode(fieldRow('AWB/TAG:', data.awbTagNumber, maxChars)));
    chunks.push(encoder.encode(fieldRow('CONSIGNEE:', data.consignee, maxChars)));
    chunks.push(encoder.encode(fieldRow('ROUTE:', data.route, maxChars)));
    
    // Clean, structured border for Cargo Breakdown section
    chunks.push(encoder.encode(divider(maxChars, '=')));
    chunks.push(new Uint8Array(CENTER), new Uint8Array(BOLD_ON));
    chunks.push(encoder.encode("CARGO BREAKDOWN\n"));
    chunks.push(new Uint8Array(BOLD_OFF), new Uint8Array(LEFT));
    chunks.push(encoder.encode(divider(maxChars, '=')));

    chunks.push(encoder.encode(fieldRow('  Content Type:', data.contentType, maxChars)));
    chunks.push(encoder.encode(fieldRow('  Total Pieces:', `${data.pieces} PCS`, maxChars)));
    chunks.push(encoder.encode(fieldRow('  Total Weight:', `${data.kg} KG`, maxChars)));
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
    if (data.remark) chunks.push(encoder.encode(fieldRow('REMARK:', data.remark, maxChars)));

    if (data.pickupPin) {
      chunks.push(encoder.encode(divider(maxChars, '*')));
      chunks.push(new Uint8Array(CENTER));
      const { REVERSE_ON, REVERSE_OFF } = await import('./escposShared');
      chunks.push(new Uint8Array(REVERSE_ON));
      chunks.push(encoder.encode(`  PICKUP PIN: ${data.pickupPin}  \n`));
      chunks.push(new Uint8Array(REVERSE_OFF));
      chunks.push(new Uint8Array(LEFT));
      chunks.push(encoder.encode("Share this PIN with the consignee.\nThey must present it to collect cargo.\n"));
      chunks.push(new Uint8Array(CENTER));
      chunks.push(encoder.encode(divider(maxChars, '*')));
    }

    chunks.push(new Uint8Array(CENTER));
    chunks.push(encoder.encode(`\n${data.entryRef}\n`));
    chunks.push(encoder.encode("Track your cargo: app.ehimultisystems.com\n"));

    chunks.push(new Uint8Array(FEED_AND_CUT));
    allChunks.push(...chunks);
  }

  return concatChunks(allChunks);
}

