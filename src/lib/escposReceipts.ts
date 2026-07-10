import { EscPosBuilder, printViaBluetooth } from "./escpos";

export const printBluetoothReceipt = async (
  data: any,
  type: "cargo" | "valuejet" | "marketing",
) => {
  const builder = new EscPosBuilder();

  builder.align(1); // center
  builder.bold(true);
  builder.size(2, 2);
  builder.textLine("EHI LOGISTICS");

  builder.size(1, 1);
  if (type === "cargo") {
    builder.textLine(data.airline || "CARGO");
    builder.textLine("CARGO ENTRY RECEIPT");
  } else if (type === "valuejet") {
    builder.textLine("VALUEJET AIRLINES");
    builder.textLine("EXCESS BAGGAGE RECEIPT");
  } else {
    builder.textLine("MARKETING RECEIPT");
  }

  builder.bold(false);
  builder.textLine(`Origin: ${data.hubName}`);
  builder.newLine();

  builder.align(0); // left

  if (data.date) builder.textLine(`Date: ${data.date}`);
  if (data.entryRef) builder.textLine(`Ref: ${data.entryRef}`);
  if (data.serialNumber) builder.textLine(`S/N: ${data.serialNumber}`);
  builder.newLine();

  if (data.consignee) builder.textLine(`Consignee: ${data.consignee}`);
  if (data.name) builder.textLine(`Passenger: ${data.name}`);
  if (data.flight) builder.textLine(`Flight: ${data.flight}`);
  if (data.awbTagNumber) builder.textLine(`AWB/Tag: ${data.awbTagNumber}`);
  if (data.pnr) builder.textLine(`PNR: ${data.pnr}`);
  if (data.pieces) builder.textLine(`Pieces: ${data.pieces}`);

  if (data.kg) builder.textLine(`Total Weight: ${Math.round(data.kg)} KG`);
  if (data.totalBaggage)
    builder.textLine(`Total Baggage: ${Math.round(data.totalBaggage)} KG`);
  if (data.freeAllowance !== undefined)
    builder.textLine(`Free Allowance: ${Math.round(data.freeAllowance)} KG`);
  if (data.excessKg)
    builder.textLine(`Excess Weight: ${Math.round(data.excessKg)} KG`);

  if (data.route) builder.textLine(`Route: ${data.route}`);
  if (data.destination) builder.textLine(`Destination: ${data.destination}`);

  builder.newLine();
  builder.bold(true);
  builder.textLine(`AMOUNT CHARGED: NGN ${data.amount.toLocaleString()}`);
  builder.bold(false);
  builder.textLine(`Payment Mode: ${data.paymentMode || data.mode}`);
  if (data.bankName || data.bank)
    builder.textLine(`Bank: ${data.bankName || data.bank}`);

  builder.newLine();
  if (data.pickupPin) {
    builder.align(1);
    builder.textLine("PICKUP PIN");
    builder.size(2, 2);
    builder.bold(true);
    builder.textLine(data.pickupPin);
    builder.size(1, 1);
    builder.bold(false);
    builder.textLine("Consignee must present PIN");
    builder.newLine();
  }

  builder.align(1);
  builder.textLine("Powered by EHI Platform");
  builder.newLine(3);
  builder.cut();

  await printViaBluetooth(async () => builder.build());
};
