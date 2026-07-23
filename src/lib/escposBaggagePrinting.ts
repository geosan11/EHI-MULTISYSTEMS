import {
  encoder, INIT, CENTER, LEFT, TEXT_NORMAL, TEXT_DOUBLE_HEIGHT,
  BOLD_ON, BOLD_OFF, FEED_AND_CUT,
  concatChunks, qrAsRaster, brandingHeader, textHeaderWithAirline, fieldRow, divider,
  getAirlineLogoRaster, imageToEscPosRaster, setPrintArea,
} from './escposShared';

export interface BaggageReceiptPrintData {
  airlineName: string;
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
  paymentNarration?: string;
  bankName?: string;
}

export async function compileBaggageReceiptStream(data: BaggageReceiptPrintData, width: '58mm' | '80mm'): Promise<Uint8Array> {
  const maxChars = width === '58mm' ? 32 : 48;
  const airlineUpper = data.airlineName.toUpperCase();
  // CUSTOMER/MERCHANT copy split -- matches escposCargoReceiptPrinting.ts,
  // which already does this; baggage never had it.
  const copies = ['CUSTOMER COPY', 'MERCHANT COPY'];
  let allChunks: Uint8Array[] = [];

  for (const copyType of copies) {
    const chunks: Uint8Array[] = [new Uint8Array(INIT), new Uint8Array(setPrintArea(width))];
    if (width === '58mm') {
      // Plain-text EHI header (no logo raster), then the airline's own logo --
      // keeps this width fast to print.
      chunks.push(...(await textHeaderWithAirline(data.airlineName, 100, airlineUpper)));
    } else {
      chunks.push(...(await brandingHeader()));
      const airlineRaster = await getAirlineLogoRaster(data.airlineName, 130);
      if (airlineRaster) {
        chunks.push(airlineRaster);
        chunks.push(encoder.encode('\n'));
      } else {
        chunks.push(new Uint8Array(BOLD_ON));
        chunks.push(encoder.encode(`${airlineUpper}\n`));
        chunks.push(new Uint8Array(BOLD_OFF));
      }
    }

    chunks.push(new Uint8Array(TEXT_DOUBLE_HEIGHT), new Uint8Array(BOLD_ON));
    chunks.push(encoder.encode("EXCESS BAGGAGE RECEIPT\n"));
    chunks.push(new Uint8Array(BOLD_OFF), new Uint8Array(TEXT_NORMAL));
    chunks.push(encoder.encode(`${data.airlineName} Counter - ${data.originState}\n\n`));

    chunks.push(new Uint8Array(CENTER), new Uint8Array(BOLD_ON));
    chunks.push(encoder.encode(`*** ${copyType} ***\n\n`));
    chunks.push(new Uint8Array(BOLD_OFF));

    // QR dropped on 58mm -- keeps the receipt shorter/faster to print; the
    // ref number below is still there for manual lookup/tracking.
    if (width !== '58mm') {
      chunks.push(await qrAsRaster(data.trackingUrl, 280));
      chunks.push(encoder.encode('\n\n'));
    }
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

    // Clean, structured border for Baggage Breakdown section
    chunks.push(encoder.encode(divider(maxChars, '=')));
    chunks.push(new Uint8Array(CENTER), new Uint8Array(BOLD_ON));
    chunks.push(encoder.encode("BAGGAGE BREAKDOWN\n"));
    chunks.push(new Uint8Array(BOLD_OFF), new Uint8Array(LEFT));
    chunks.push(encoder.encode(divider(maxChars, '=')));

    chunks.push(encoder.encode(fieldRow('  Total Pieces:', `${data.totalPieces} PCS`, maxChars)));
    chunks.push(encoder.encode(fieldRow('  Total Weight:', `${data.totalWeightKg} KG`, maxChars)));
    chunks.push(encoder.encode(fieldRow('  Free Allowance:', `${data.freeAllowanceKg} KG`, maxChars)));

    if (data.excessChargeKg > 0) {
      chunks.push(new Uint8Array(BOLD_ON));
      chunks.push(encoder.encode(fieldRow('  EXCESS WEIGHT:', `${data.excessChargeKg} KG`, maxChars)));
      chunks.push(new Uint8Array(BOLD_OFF));
    } else {
      chunks.push(encoder.encode(fieldRow('  Excess Weight:', '0 KG', maxChars)));
    }

    chunks.push(encoder.encode(fieldRow('  Rate per KG:', `NGN ${data.ratePerKg.toLocaleString('en-NG')}`, maxChars)));
    chunks.push(encoder.encode(divider(maxChars)));

    // Double-height highlight on amount to capture attention clearly
    chunks.push(new Uint8Array(TEXT_DOUBLE_HEIGHT), new Uint8Array(BOLD_ON));
    chunks.push(encoder.encode(fieldRow('AMOUNT:', `NGN ${data.amount.toLocaleString('en-NG')}`, maxChars)));
    chunks.push(new Uint8Array(BOLD_OFF), new Uint8Array(TEXT_NORMAL));
    chunks.push(encoder.encode(fieldRow('PAYMENT MODE:', data.paymentMode, maxChars)));

    if (data.paymentMode === 'Transfer' && data.paymentNarration) {
      chunks.push(encoder.encode(fieldRow('NARRATION:', data.paymentNarration, maxChars)));
    }
    if (data.bankName) {
      chunks.push(encoder.encode(fieldRow('BANK:', data.bankName, maxChars)));
    }

    chunks.push(new Uint8Array(CENTER));
    chunks.push(encoder.encode(`\n${data.entryRef}\n`));
    chunks.push(encoder.encode("Track your cargo: app.ehimultisystems.com\n"));

    chunks.push(new Uint8Array(FEED_AND_CUT));
    allChunks.push(...chunks);
  }

  return concatChunks(allChunks);
}
