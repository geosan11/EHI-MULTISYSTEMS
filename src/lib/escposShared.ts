import QRCode from 'qrcode';

import ehiLogoFile from '../assets/branding/ehi-logo.png';
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
  const dataUrl = await QRCode.toDataURL(url, { margin: 1, width: sizeDots });
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
  try {
    return await imageToEscPosRaster(url, widthDots, 160);
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

// Every document type calls this for its header -- change it once,
// every receipt/tag updates together, instead of three drifting copies.
// Uses the actual ehi-logo.png at threshold 200 so the amber MULTISYSTEMS
// banner prints as a solid black rectangle with white text -- exactly the
// "background" effect on thermal paper. The PNG already contains all text
// (EHI, MULTISYSTEMS, NIGERIA LIMITED) so no separate text lines needed.
export async function brandingHeader(logoWidthDots = 160): Promise<Uint8Array[]> {
  const chunks: Uint8Array[] = [new Uint8Array(CENTER)];
  try {
    const logoRaster = await imageToEscPosRaster(ehiLogoFile, logoWidthDots, 200);
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
  paperWidth: '58mm' | '80mm' = '80mm',
): Promise<Uint8Array[]> {
  const widthDots = paperWidth === '58mm' ? 280 : 360;
  if (!airline) return brandingHeader(widthDots);

  const { airlineLogoUrl } = await import('./airlineLogos');
  const airlineUrl = airlineLogoUrl(airline);
  if (!airlineUrl) return brandingHeader(widthDots);

  const chunks: Uint8Array[] = [new Uint8Array(CENTER)];
  const logoH = Math.round(widthDots * 0.52);
  const halfW = Math.floor(widthDots / 2);

  try {
    const [ehiImg, airlineImg] = await Promise.all([
      loadImageElement(ehiLogoFile),
      loadImageElement(airlineUrl),
    ]);

    const canvas = document.createElement('canvas');
    canvas.width = widthDots;
    canvas.height = logoH;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, widthDots, logoH);

    // EHI on left half — scale to fit, keep aspect ratio, centre in cell
    const ehiAspect = ehiImg.width / ehiImg.height;
    const ehiH = Math.min(logoH - 6, (halfW - 10) / ehiAspect);
    const ehiW = ehiH * ehiAspect;
    ctx.drawImage(ehiImg,
      Math.floor((halfW - ehiW) / 2), Math.floor((logoH - ehiH) / 2),
      ehiW, ehiH);

    // Thin separator line between logos
    ctx.fillStyle = '#aaaaaa';
    ctx.fillRect(halfW - 1, 6, 1, logoH - 12);

    // Airline logo on right half — same fit logic
    const alAspect = airlineImg.width / airlineImg.height;
    const alH = Math.min(logoH - 6, (halfW - 10) / alAspect);
    const alW = alH * alAspect;
    ctx.drawImage(airlineImg,
      halfW + Math.floor((halfW - alW) / 2), Math.floor((logoH - alH) / 2),
      alW, alH);

    // Use threshold 200 so amber areas (MULTISYSTEMS banner in EHI logo) print as solid black
    const dataUrl = canvas.toDataURL('image/png');
    const raster = await imageToEscPosRaster(dataUrl, widthDots, 200);
    chunks.push(raster);
    chunks.push(encoder.encode('\n'));

  } catch {
    return brandingHeader(widthDots);
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
