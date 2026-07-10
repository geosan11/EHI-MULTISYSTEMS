export class EscPosBuilder {
  private buffer: number[] = [];

  constructor() {
    this.init();
  }

  // Initialize printer
  init() {
    this.buffer.push(0x1b, 0x40);
  }

  // Text alignment (0 = left, 1 = center, 2 = right)
  align(align: 0 | 1 | 2) {
    this.buffer.push(0x1b, 0x61, align);
  }

  // Set text size (1-8 for width/height multiplier)
  size(width: number, height: number) {
    const w = Math.min(8, Math.max(1, width)) - 1;
    const h = Math.min(8, Math.max(1, height)) - 1;
    this.buffer.push(0x1d, 0x21, (w << 4) | h);
  }

  // Bold text
  bold(on: boolean) {
    this.buffer.push(0x1b, 0x45, on ? 1 : 0);
  }

  // Print text
  text(str: string) {
    for (let i = 0; i < str.length; i++) {
      this.buffer.push(str.charCodeAt(i));
    }
  }

  // Print text with newline
  textLine(str: string) {
    this.text(str);
    this.newLine();
  }

  // Feed n lines
  newLine(n = 1) {
    for (let i = 0; i < n; i++) {
      this.buffer.push(0x0a);
    }
  }

  // Cut paper
  cut() {
    this.buffer.push(0x1d, 0x56, 0x41, 0x00);
  }

  // Get raw bytes
  build(): Uint8Array {
    return new Uint8Array(this.buffer);
  }
}

async function connectBluetoothPrinter(): Promise<{ device: any; writeCharacteristic: any }> {
  const nav = navigator as any;
  if (!nav.bluetooth) {
    throw new Error(
      "Web Bluetooth is not supported in this browser. Please use Chrome on Android or Desktop.",
    );
  }

  // Request thermal printer device
  // Most BLE ESC/POS printers use a standard UUID or just a generic request
  const device = await nav.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: [
      "000018f0-0000-1000-8000-00805f9b34fb",
      "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
    ],
  });

  if (!device.gatt) throw new Error("Bluetooth GATT not found.");

  const server = await device.gatt.connect();

  // We try to find common thermal printer write characteristics
  let writeCharacteristic;
  const services = await server.getPrimaryServices();

  for (const service of services) {
    const characteristics = await service.getCharacteristics();
    for (const characteristic of characteristics) {
      if (
        characteristic.properties.write ||
        characteristic.properties.writeWithoutResponse
      ) {
        writeCharacteristic = characteristic;
        break;
      }
    }
    if (writeCharacteristic) break;
  }

  if (!writeCharacteristic)
    throw new Error(
      "Could not find a writable characteristic for this printer.",
    );

  return { device, writeCharacteristic };
}

async function sendToBluetoothPrinter(writeCharacteristic: any, data: Uint8Array): Promise<void> {
  // Web Bluetooth doesn't expose the negotiated ATT MTU, and Chrome on
  // Android will silently truncate a writeValue() call larger than it
  // instead of throwing. The default ATT MTU is 23 bytes (20 usable
  // payload), so 256-byte chunks were being clipped mid-write on many
  // Android/printer combos, corrupting everything downstream in the
  // stream (this is why the logo image and the fields right after it
  // were the ones coming out garbled). Use the universally-safe chunk
  // size, but prefer the modern explicit writeValueWithResponse() over
  // the deprecated, ambiguous writeValue() when the characteristic
  // supports it -- a "with response" write waits for the printer's own
  // acknowledgment before resolving, which paces transmission at
  // whatever rate the actual hardware can handle instead of guessing a
  // fixed delay. That means no artificial setTimeout is needed on that
  // path. Falls back to writeValueWithoutResponse() + the original
  // conservative delay for printers that only support write-without-
  // response, to avoid reintroducing the truncation/corruption bug.
  const supportsResponse = !!writeCharacteristic.properties.write;
  const chunkSize = 20;
  for (let i = 0; i < data.length; i += chunkSize) {
    const chunk = data.slice(i, i + chunkSize);
    if (supportsResponse) {
      await writeCharacteristic.writeValueWithResponse(chunk);
    } else {
      await writeCharacteristic.writeValueWithoutResponse(chunk);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
}

// Guards against overlapping print jobs -- e.g. an impatient agent
// double-tapping a print button before the first job finishes. Two
// concurrent calls would each open their own GATT connection and write to
// the same characteristic at the same time; there's no hardware-level
// arbitration for that, so the two byte streams would interleave into a
// single, genuinely corrupted printout (not just a rendering glitch --
// actually scrambled bytes). Enforced once here since every print path in
// the app funnels through this one function.
let printInProgress = false;

// Connects to the Bluetooth printer FIRST, before compileBytes() runs --
// navigator.bluetooth.requestDevice() requires an unbroken user gesture,
// and compiling a receipt/tag (loading logo images, drawing to canvas,
// generating a QR code, sometimes a dynamic import()) is real async work
// that can easily outlast the click's transient activation window if done
// beforehand. That silently turns "printer is paired and on" into a
// connection failure. Connecting first, then compiling, then sending
// preserves the gesture regardless of how long compilation takes.
export const printViaBluetooth = async (compileBytes: () => Promise<Uint8Array>): Promise<void> => {
  if (printInProgress) {
    throw new Error("A print job is already in progress. Please wait for it to finish.");
  }
  printInProgress = true;
  try {
    const { device, writeCharacteristic } = await connectBluetoothPrinter();
    const data = await compileBytes();
    await sendToBluetoothPrinter(writeCharacteristic, data);

    // Give it a moment to finish printing before disconnecting
    setTimeout(() => {
      if (device.gatt?.connected) {
        device.gatt.disconnect();
      }
    }, 2000);
  } catch (error) {
    console.error("Bluetooth print error:", error);
    throw error;
  } finally {
    printInProgress = false;
  }
};
