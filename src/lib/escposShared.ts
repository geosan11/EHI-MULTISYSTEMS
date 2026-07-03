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

async function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

// Converts any image (PNG/JPG) into the ESC/POS GS v 0 raster bit-image
// format at print time. targetWidthDots should be a multiple of 8 --
// round down if not, since raster rows are byte-packed. Transparent
// pixels are treated as white/unprinted, not black.
export async function imageToEscPosRaster(imageUrl: string, targetWidthDots: number): Promise<Uint8Array> {
  const img = await loadImageElement(imageUrl);
  const widthDots = targetWidthDots - (targetWidthDots % 8);
  const scale = widthDots / img.width;
  const heightDots = Math.round(img.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = widthDots;
  canvas.height = heightDots;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, widthDots, heightDots);
  ctx.drawImage(img, 0, 0, widthDots, heightDots);

  const imageData = ctx.getImageData(0, 0, widthDots, heightDots).data;
  const widthBytes = widthDots / 8;
  const raster = new Uint8Array(widthBytes * heightDots);

  for (let y = 0; y < heightDots; y++) {
    for (let x = 0; x < widthDots; x++) {
      const idx = (y * widthDots + x) * 4;
      const r = imageData[idx], g = imageData[idx + 1], b = imageData[idx + 2], a = imageData[idx + 3];
      const luminance = r * 0.299 + g * 0.587 + b * 0.114;
      if (a > 128 && luminance < 128) {
        const byteIndex = y * widthBytes + Math.floor(x / 8);
        raster[byteIndex] |= (1 << (7 - (x % 8)));
      }
    }
  }

  const xL = widthBytes & 0xFF, xH = (widthBytes >> 8) & 0xFF;
  const yL = heightDots & 0xFF, yH = (heightDots >> 8) & 0xFF;
  const header = new Uint8Array([0x1D, 0x76, 0x30, 0x00, xL, xH, yL, yH]);

  const out = new Uint8Array(header.length + raster.length);
  out.set(header, 0);
  out.set(raster, header.length);
  return out;
}

// Same city/airline name matching AirlineLogoPDF.tsx already uses --
// don't invent different matching rules, reuse the logic, just return
// a file path instead of a React component.
export function getAirlineLogoPath(airline: string): string | null {
  const norm = airline.toLowerCase();
  if (norm.includes('aero')) return '/src/assets/airlines/aero-contractors.png';
  if (norm.includes('arik')) return '/src/assets/airlines/arik-air.png';
  if (norm.includes('valuejet')) return '/src/assets/airlines/valuejet.png';
  if (norm.includes('united') || norm.includes('un')) return '/src/assets/airlines/united-nigeria.png';
  if (norm.includes('green africa') || norm.includes('greenafrica')) return '/src/assets/airlines/green-africa.png';
  return null;
}

// Every document type calls this for its header -- change it once,
// every receipt/tag updates together, instead of three drifting copies.
export async function brandingHeader(logoWidthDots = 160): Promise<Uint8Array[]> {
  const chunks: Uint8Array[] = [new Uint8Array(CENTER)];
  try {
    const logoPath = '/src/assets/branding/ehi-logo.png';
    const logoRaster = await imageToEscPosRaster(logoPath, logoWidthDots);
    chunks.push(logoRaster);
    chunks.push(encoder.encode('\n'));
  } catch {
    // Fall back to text branding if the logo file isn't there yet or
    // fails to load -- never let a missing image break printing entirely.
    chunks.push(new Uint8Array(TEXT_DOUBLE_HEIGHT), new Uint8Array(BOLD_ON));
    chunks.push(encoder.encode("EHI\n"));
    chunks.push(new Uint8Array(BOLD_OFF), new Uint8Array(TEXT_NORMAL));
  }
  chunks.push(new Uint8Array(REVERSE_ON));
  chunks.push(encoder.encode(" MULTISYSTEMS \n"));
  chunks.push(new Uint8Array(REVERSE_OFF));
  chunks.push(encoder.encode("NIGERIA LIMITED\n\n"));
  return chunks;
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
