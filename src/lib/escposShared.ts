import QRCode from 'qrcode';

import ehiLogoFile from '../assets/branding/ehi-logo-bw.jpg';
import ehiLogoCargoFile from '../assets/branding/ehi-logo-cargo.png';
import { airlineLogoUrl } from './airlineLogos';

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
// For gap/die-cut label printers with no cutting blade (e.g. the XP-402B)
// -- feed enough for the label to clear the tear bar, no cut command.
export const FEED_ONLY = [0x1B, 0x64, 0x05];

// Explicit printable-area declaration for continuous-roll receipts/tags --
// GS L (left margin) + GS W (print area width), both in absolute dots.
// Needed because ESC @ (INIT) resets the print area back to whatever the
// printer's own DIP-switch/firmware default is, not to what our 32/48-char
// layout assumes. On a printer provisioned for 80mm (576 dots) that default
// is wider than a 58mm receipt's 384-dot content -- without this, printer
// firmware can stretch or pad the narrower text to fill its own configured
// width instead of respecting the layout actually sent, which is what makes
// a "58mm" receipt look mis-sized/gappy when printed on an 80mm-provisioned
// printer. Sending this right after every INIT makes the printable region
// explicit and consistent regardless of how the physical printer is set up.
const PRINT_AREA_DOTS: Record<'58mm' | '80mm', number> = { '58mm': 384, '80mm': 576 };

export function setPrintArea(width: '58mm' | '80mm'): number[] {
  const dots = PRINT_AREA_DOTS[width];
  const wL = dots & 0xFF, wH = (dots >> 8) & 0xFF;
  return [
    0x1D, 0x4C, 0x00, 0x00, // GS L: left margin = 0 dots
    0x1D, 0x57, wL, wH,     // GS W: print area width = `dots`
  ];
}

export function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.length; }
  return out;
}

// Renders a QR code as an actual bitmap image and prints it via the
// same raster path as logos, rather than relying on printer-native
// GS(k 2D symbol commands -- confirmed via real prints that at least
// one deployed printer doesn't properly support those commands, even
// though basic text/reverse-print work fine on it.
export async function qrAsRaster(url: string, sizeDots: number): Promise<Uint8Array> {
  // errorCorrectionLevel 'L' (~7% redundancy) instead of the library's
  // default 'M' (~15%) -- safe here because the content is always a
  // fixed, known tracking URL, never arbitrary user input. Fewer required
  // modules for the same data means each module is physically LARGER at a
  // given print size: more reliably scannable, and fewer tiny black/white
  // dot transitions for the thermal print head to resolve.
  const dataUrl = await QRCode.toDataURL(url, { margin: 1, width: sizeDots, errorCorrectionLevel: 'L' });
  return imageToEscPosRaster(dataUrl, sizeDots);
}

export function qrCommands(url: string): Uint8Array[] {
  const dataLen = url.length + 3;
  const pl = dataLen & 0xFF;
  const ph = (dataLen >> 8) & 0xFF;
  // Use module size 4 for longer tracking URLs to prevent clipping/bleeding, and 6 for shorter references
  const moduleSize = url.length > 30 ? 0x04 : 0x06;
  return [
    // Model 2
    new Uint8Array([0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]),
    // Module size
    new Uint8Array([0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, moduleSize]),
    // Set error correction level M (15%) for high scanning reliability on thermal prints
    new Uint8Array([0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 0x31]),
    // Store symbol data
    new Uint8Array([0x1D, 0x28, 0x6B, pl, ph, 0x31, 0x50, 0x30, ...encoder.encode(url)]),
    // Print QR symbol
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
export async function imageToEscPosRaster(
  imageUrl: string,
  targetWidthDots: number,
  threshold = 160
): Promise<Uint8Array> {
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
      if (a > 128 && luminance < threshold) {
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

// Now async — fetches from Supabase Storage, no hardcoded airline list.
// Any airline whose logo has been uploaded via AirlineLogoManager will print correctly.
export async function getAirlineLogoRaster(
  airline: string,
  widthDots: number
): Promise<Uint8Array | null> {
  if (!airline) return null;
  const url = airlineLogoUrl(airline);
  if (!url) return null;
  const isWideAirline = /aero|contractors|overland|valuejet/i.test(airline);
  const targetWidth = isWideAirline ? Math.round(widthDots * 1.35) : widthDots;
  try {
    return await imageToEscPosRaster(url, targetWidth, 180);
  } catch {
    return null;
  }
}

const EHI_SVG = `<svg viewBox="0 0 400 300" xmlns="http://www.w3.org/2000/svg">
  <rect width="400" height="300" fill="white"/>
  <path d="M 180 140 C 140 140 90 110 70 95 C 110 115 150 160 170 170 Z" fill="#000000"/>
  <path d="M 170 170 C 190 120 250 80 350 70 C 290 90 220 130 180 180 Z" fill="#000000"/>
  <text x="210" y="240" font-family="Arial,sans-serif" font-weight="900" font-size="110" fill="#000000" text-anchor="middle">EHI</text>
  <rect x="95" y="255" width="230" height="30" fill="#000000"/>
  <text x="210" y="277" font-family="Arial,sans-serif" font-weight="bold" font-size="19" fill="#ffffff" text-anchor="middle">MULTISYSTEMS</text>
</svg>`;

export async function ehiSvgToRaster(widthDots: number): Promise<Uint8Array> {
  const blob = new Blob([EHI_SVG], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  try {
    return await imageToEscPosRaster(url, widthDots, 200);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// 58mm-only header: plain "EHI MULTISYSTEMS NIG LTD" text instead of the
// rasterized EHI logo image, with the airline's own logo (if resolvable)
// printed right after it. The EHI logo raster was consistently the single
// biggest chunk of a 58mm receipt's Bluetooth payload -- dropping it here
// is what actually shortens print time on this width; 80mm keeps the full
// composite logo via brandingHeader/brandingHeaderWithAirline. Pass
// fallbackAirlineText to print a bold text line when no logo image is
// available for that airline (omit it to print nothing in that case).
export async function textHeaderWithAirline(
  airline: string,
  airlineLogoWidthDots: number,
  fallbackAirlineText?: string,
): Promise<Uint8Array[]> {
  // Reverse video (white text on a black band) instead of plain bold --
  // same GS B treatment already used for the 80mm banner and the pickup-
  // PIN block, so the brand line reads as a solid header instead of just
  // another line of text.
  const chunks: Uint8Array[] = [
    new Uint8Array(CENTER),
    new Uint8Array(REVERSE_ON),
    new Uint8Array(BOLD_ON),
    encoder.encode(" EHI MULTISYSTEMS NIG LTD \n"),
    new Uint8Array(BOLD_OFF),
    new Uint8Array(REVERSE_OFF),
    encoder.encode('\n'),
  ];

  if (airline) {
    const airlineRaster = await getAirlineLogoRaster(airline, airlineLogoWidthDots);
    if (airlineRaster) {
      chunks.push(airlineRaster);
      chunks.push(encoder.encode('\n'));
    } else if (fallbackAirlineText) {
      chunks.push(new Uint8Array(BOLD_ON));
      chunks.push(encoder.encode(`${fallbackAirlineText}\n`));
      chunks.push(new Uint8Array(BOLD_OFF));
    }
  }
  return chunks;
}

// Every document type calls this for its header -- change it once,
// every receipt/tag updates together, instead of three drifting copies.
// Uses ehi-logo-bw.png -- a dedicated, pre-made pure black-and-white
// export of the logo, smaller and simpler to rasterize than running the
// full-color logo through a threshold each time (which previously needed
// threshold 200 specifically to force the amber MULTISYSTEMS banner to
// convert to solid black -- that workaround is no longer needed since
// this source has no color to threshold away in the first place).
// logoVariant 'cargo' swaps in ehi-logo-cargo.png -- a distinct olive-green
// variant used for tag printing specifically -- which thresholds cleanly
// at the same standard level, so no separate threshold is needed per variant.
export async function brandingHeader(logoWidthDots = 160, logoVariant: 'default' | 'cargo' = 'default'): Promise<Uint8Array[]> {
  const chunks: Uint8Array[] = [new Uint8Array(CENTER)];
  const logoSrc = logoVariant === 'cargo' ? ehiLogoCargoFile : ehiLogoFile;
  try {
    const logoRaster = await imageToEscPosRaster(logoSrc, logoWidthDots, 160);
    chunks.push(logoRaster);
    chunks.push(encoder.encode('\n\n'));
  } catch {
    chunks.push(new Uint8Array(BOLD_ON));
    chunks.push(encoder.encode("EHI MULTISYSTEMS\n"));
    chunks.push(new Uint8Array(BOLD_OFF));
    chunks.push(encoder.encode("NIGERIA LIMITED\n\n"));
  }
  return chunks;
}

// Composites EHI logo and airline logo side-by-side into a single raster
// image, sized to the paper width so both are clearly readable at any scale.
// Falls back to brandingHeader() if the airline logo cannot be loaded.
export async function brandingHeaderWithAirline(
  airline: string,
  paperWidth: '58mm' | '80mm' | number = '80mm',
  logoVariant: 'default' | 'cargo' = 'default',
): Promise<Uint8Array[]> {
  const widthDots = typeof paperWidth === 'number' ? paperWidth : (paperWidth === '58mm' ? 280 : 360);
  if (!airline) return brandingHeader(widthDots, logoVariant);

  const { airlineLogoUrl } = await import('./airlineLogos');
  const airlineUrl = airlineLogoUrl(airline);
  if (!airlineUrl) return brandingHeader(widthDots, logoVariant);

  const chunks: Uint8Array[] = [new Uint8Array(CENTER)];
  const halfW = Math.floor(widthDots / 2);
  // Tiny gap either side of the divider line so neither logo overlaps it.
  const logoSlotW = halfW - 2;
  const ehiLogoSrc = logoVariant === 'cargo' ? ehiLogoCargoFile : ehiLogoFile;

  try {
    const [ehiImg, airlineImg] = await Promise.all([
      loadImageElement(ehiLogoSrc),
      loadImageElement(airlineUrl),
    ]);

    // Each logo fills its entire half -- from the center split out to the
    // paper's outer margin -- instead of a small logo centered with
    // padding on both sides. Height is derived from each logo's own aspect
    // ratio at that width, and the canvas grows to fit the taller one.
    const ehiAspect = ehiImg.width / ehiImg.height;
    const alAspect = airlineImg.width / airlineImg.height;
    const ehiW = logoSlotW;
    const ehiH = ehiW / ehiAspect;
    const alW = logoSlotW;
    const alH = alW / alAspect;
    // Safety cap for unusually tall (portrait-ish) logos -- real wordmark
    // logos land well under this, so it won't affect normal prints.
    const logoH = Math.min(Math.ceil(Math.max(ehiH, alH)) + 8, Math.round(widthDots * 0.75));

    const canvas = document.createElement('canvas');
    canvas.width = widthDots;
    canvas.height = logoH;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, widthDots, logoH);

    // EHI flush against the left margin, spanning to the center split
    ctx.drawImage(ehiImg, 0, Math.floor((logoH - Math.min(ehiH, logoH)) / 2), ehiW, Math.min(ehiH, logoH));

    // Thin separator line between logos
    ctx.fillStyle = '#aaaaaa';
    ctx.fillRect(halfW, 4, 1, logoH - 8);

    // Airline flush against the right margin, spanning from the split
    ctx.drawImage(airlineImg, widthDots - alW, Math.floor((logoH - Math.min(alH, logoH)) / 2), alW, Math.min(alH, logoH));

    // Standard threshold -- the EHI portion is already pure black-and-
    // white (ehi-logo-bw.png), and this matches the default threshold
    // used for airline logos everywhere else in the app.
    const dataUrl = canvas.toDataURL('image/png');
    const raster = await imageToEscPosRaster(dataUrl, widthDots, 160);
    chunks.push(raster);
    chunks.push(encoder.encode('\n'));

  } catch {
    return brandingHeader(widthDots, logoVariant);
  }

  // The composite image contains the EHI logo scaled to the left half;
  // the MULTISYSTEMS banner is small at that scale, so print it full-width below.
  chunks.push(new Uint8Array(REVERSE_ON));
  chunks.push(encoder.encode(" EHI MULTISYSTEMS NIGERIA LIMITED \n"));
  chunks.push(new Uint8Array(REVERSE_OFF));
  chunks.push(encoder.encode('\n'));
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
