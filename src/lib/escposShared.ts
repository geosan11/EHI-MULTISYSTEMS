export const encoder = new TextEncoder();

export const INIT = [0x1B, 0x40];
export const CENTER = [0x1B, 0x61, 0x01];
export const LEFT = [0x1B, 0x61, 0x00];
export const TEXT_NORMAL = [0x1D, 0x21, 0x00];
export const TEXT_DOUBLE_HEIGHT = [0x1D, 0x21, 0x01];
export const BOLD_ON = [0x1B, 0x45, 0x01];
export const BOLD_OFF = [0x1B, 0x45, 0x00];
export const REVERSE_ON = [0x1D, 0x42, 0x01];
export const REVERSE_OFF = [0x1D, 0x42, 0x00];
export const FEED_AND_CUT = [0x1B, 0x64, 0x03, 0x1D, 0x56, 0x41, 0x00];

export function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.length; }
  return out;
}

export function qrCommands(url: string): Uint8Array[] {
  const dataLen = url.length + 3;
  const pl = dataLen & 0xFF;
  const ph = (dataLen >> 8) & 0xFF;
  return [
    new Uint8Array([0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]),
    new Uint8Array([0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, 0x06]),
    new Uint8Array([0x1D, 0x28, 0x6B, pl, ph, 0x31, 0x50, 0x30, ...encoder.encode(url)]),
    new Uint8Array([0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30]),
  ];
}

// Every document type calls this for its header -- change it once,
// every receipt/tag updates together, instead of three drifting copies.
export function brandingHeader(): Uint8Array[] {
  return [
    new Uint8Array(CENTER),
    new Uint8Array(TEXT_DOUBLE_HEIGHT), new Uint8Array(BOLD_ON),
    encoder.encode("EHI\n"),
    new Uint8Array(BOLD_OFF), new Uint8Array(TEXT_NORMAL),
    new Uint8Array(REVERSE_ON),
    encoder.encode(" MULTISYSTEMS \n"),
    new Uint8Array(REVERSE_OFF),
    encoder.encode("NIGERIA LIMITED\n\n"),
  ];
}

// Shared label/value row formatter for the paired-field sections every
// document type uses (REF/DATE, PASSENGER/FLIGHT, etc). Plain ASCII
// only in both label and value -- no arrow characters, no currency
// symbols. That exact class of character is what corrupted the PDF
// tag's route line and every PDF receipt's amount line; thermal
// printer codepages support even less Unicode than the PDF's font did.
export function fieldRow(label: string, value: string, maxChars: number): string {
  const spaces = maxChars - (label.length + value.length);
  return label + ' '.repeat(spaces > 0 ? spaces : 1) + value + '\n';
}

export function divider(maxChars: number, char = '-'): string {
  return char.repeat(maxChars) + '\n';
}
