import {
  encoder, INIT, CENTER, LEFT, TEXT_NORMAL, TEXT_DOUBLE_HEIGHT,
  BOLD_ON, BOLD_OFF, FEED_AND_CUT,
  concatChunks, qrCommands, brandingHeader, fieldRow, divider,
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
  trackingUrl: string;
}

export function compileMarketingReceiptStream(data: MarketingReceiptPrintData, width: '58mm' | '80mm'): Uint8Array {
  const maxChars = width === '58mm' ? 32 : 48;
  const chunks: Uint8Array[] = [new Uint8Array(INIT), ...brandingHeader()];

  chunks.push(new Uint8Array(TEXT_DOUBLE_HEIGHT), new Uint8Array(BOLD_ON));
  chunks.push(encoder.encode("MARKETING SALES RECEIPT\n"));
  chunks.push(new Uint8Array(BOLD_OFF), new Uint8Array(TEXT_NORMAL));

  chunks.push(...qrCommands(data.trackingUrl));

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

  chunks.push(new Uint8Array(BOLD_ON));
  chunks.push(encoder.encode("BAG BREAKDOWN\n"));
  chunks.push(new Uint8Array(BOLD_OFF));
  if (data.bigBags > 0) chunks.push(encoder.encode(fieldRow('BIG BAGS:', `${data.bigBags}`, maxChars)));
  if (data.medBags > 0) chunks.push(encoder.encode(fieldRow('MEDIUM BAGS:', `${data.medBags}`, maxChars)));
  if (data.smallBags > 0) chunks.push(encoder.encode(fieldRow('SMALL BAGS:', `${data.smallBags}`, maxChars)));
  chunks.push(encoder.encode(divider(maxChars)));

  chunks.push(new Uint8Array(TEXT_DOUBLE_HEIGHT), new Uint8Array(BOLD_ON));
  chunks.push(encoder.encode(fieldRow('AMOUNT:', `NGN ${data.amount.toLocaleString('en-NG')}`, maxChars)));
  chunks.push(new Uint8Array(BOLD_OFF), new Uint8Array(TEXT_NORMAL));
  chunks.push(encoder.encode(fieldRow('PAYMENT:', data.paymentMode, maxChars)));
  if (data.paymentMode === 'Transfer' && data.paymentNarration) {
    chunks.push(encoder.encode(fieldRow('NARRATION:', data.paymentNarration, maxChars)));
  }
  if (data.bankName) chunks.push(encoder.encode(fieldRow('BANK:', data.bankName, maxChars)));

  chunks.push(new Uint8Array(CENTER));
  chunks.push(encoder.encode(`\n${data.entryRef}\n`));
  chunks.push(encoder.encode("Track your cargo: ehimultisystems.com\n"));

  chunks.push(new Uint8Array(FEED_AND_CUT));
  return concatChunks(chunks);
}
