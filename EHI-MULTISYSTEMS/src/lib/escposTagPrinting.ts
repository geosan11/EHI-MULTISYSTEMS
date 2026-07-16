export async function compileGapLabelTag(item: CargoTagData): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [
    new Uint8Array(INIT),
    ...(await brandingHeaderWithAirline(item.airline || '', GAP_LABEL_WIDTH_DOTS, 'cargo')),
  ];

  chunks.push(new Uint8Array(CENTER));
  chunks.push(new Uint8Array(BOLD_ON));
  // Single \n here (was \n\n) -- reclaims one blank line's worth of the
  // fixed 80mm label length to offset WEIGHT/CONSIGNEE now printing
  // double-height below. Unlike the continuous-roll 58mm/80mm tag, this
  // format is a genuinely fixed-length die-cut label with no reflow, so
  // net vertical space is kept roughly unchanged rather than growing.
  chunks.push(encoder.encode("CARGO ROUTING TAG\n"));

  if (item.route) {
    chunks.push(new Uint8Array(TEXT_DOUBLE_HEIGHT));
    chunks.push(encoder.encode(`${item.route.toUpperCase()}\n`));
    chunks.push(new Uint8Array(TEXT_NORMAL));
  }

  chunks.push(new Uint8Array(TEXT_DOUBLE_HEIGHT));
  chunks.push(encoder.encode(`AWB: ${item.id}\n`));
  chunks.push(new Uint8Array(TEXT_NORMAL));
  chunks.push(encoder.encode('\n'));

  const trackingUrl = `https://app.ehimultisystems.com/track/${encodeURIComponent(item.id)}`;
  chunks.push(await qrAsRaster(trackingUrl, 300)); // Reduced QR size from 320 to 300
  chunks.push(encoder.encode('\n'));

  chunks.push(new Uint8Array(LEFT));
  chunks.push(encoder.encode(divider(64, '=')));
  chunks.push(new Uint8Array(CENTER));
  chunks.push(new Uint8Array(TEXT_DOUBLE_HEIGHT), new Uint8Array(BOLD_ON));
  chunks.push(encoder.encode(`PIECE ${item.pieceNo}\n`));
  chunks.push(encoder.encode(`WEIGHT: ${item.weight} KG\n`));
  chunks.push(new Uint8Array(BOLD_OFF), new Uint8Array(TEXT_NORMAL));
  chunks.push(encoder.encode(divider(64, '=')));

  chunks.push(new Uint8Array(LEFT));
  if (item.name) {
    // Capped so a long name can't eat into the fixed label's remaining
    // length at double-height size -- same reasoning as CargoTagPDF's
    // truncateForTag.
    const name = item.name.length > 32 ? item.name.slice(0, 31).trimEnd() + '…' : item.name;
    chunks.push(new Uint8Array(TEXT_DOUBLE_HEIGHT), new Uint8Array(BOLD_ON));
    chunks.push(encoder.encode(`CONSIGNEE: ${name}\n`));
    chunks.push(new Uint8Array(BOLD_OFF), new Uint8Array(TEXT_NORMAL));
  }
  if (item.airline) {
    chunks.push(new Uint8Array(BOLD_ON));
    chunks.push(encoder.encode(`AIRLINE: ${item.airline}\n`));
    chunks.push(new Uint8Array(BOLD_OFF));
  }
  if (item.hubName) {
    chunks.push(new Uint8Array(BOLD_ON));
    chunks.push(encoder.encode(`HUB: ${item.hubName}\n`));
    chunks.push(new Uint8Array(BOLD_OFF));
  }
  if (item.date) {
    chunks.push(new Uint8Array(BOLD_ON));
    chunks.push(encoder.encode(`DATE: ${item.date}\n`));
    chunks.push(new Uint8Array(BOLD_OFF));
  }
  chunks.push(encoder.encode(divider(64)));

  chunks.push(new Uint8Array(FEED_ONLY));
  return concatChunks(chunks);
}