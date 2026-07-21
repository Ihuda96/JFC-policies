// Client-side extraction of the full policy code (e.g. JFHC-HRD-HPD-APP-PP-01)
// from an uploaded document, so policies classify automatically and show the
// full code even when the title only carries a short reference.

// Match the cluster code followed by dash-separated segments ending in a
// serial number, e.g. JFHC-HRD-HPD-APP-PP-01. A dash/slash/underscore is
// required between segments (optionally padded with spaces from run splitting)
// so trailing words are not swallowed.
const FULL_CODE_PATTERN =
  /JFHC(?:\s*[-–/_]\s*[A-Z0-9]{1,6}){1,5}\s*[-–/_]\s*\d{1,4}/i;

export function extractCodeFromText(text: string | null | undefined): string | null {
  if (!text) {
    return null;
  }

  const match = text.match(FULL_CODE_PATTERN);
  if (!match) {
    return null;
  }

  const segments = match[0]
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);

  if (segments.length < 3) {
    return null;
  }

  return segments.join("-");
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Read a single entry out of a ZIP archive (DOCX/XLSX are ZIP files) using
// only native browser APIs.
async function readZipEntry(buffer: ArrayBuffer, name: string): Promise<Uint8Array | null> {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    return null;
  }

  const centralOffset = view.getUint32(eocd + 16, true);
  const entryCount = view.getUint16(eocd + 10, true);

  let pointer = centralOffset;
  for (let n = 0; n < entryCount; n++) {
    if (view.getUint32(pointer, true) !== 0x02014b50) {
      break;
    }

    const method = view.getUint16(pointer + 10, true);
    const compressedSize = view.getUint32(pointer + 20, true);
    const nameLength = view.getUint16(pointer + 28, true);
    const extraLength = view.getUint16(pointer + 30, true);
    const commentLength = view.getUint16(pointer + 32, true);
    const localOffset = view.getUint32(pointer + 42, true);
    const entryName = new TextDecoder().decode(
      bytes.subarray(pointer + 46, pointer + 46 + nameLength),
    );

    if (entryName === name) {
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
      return method === 0 ? compressed : await inflateRaw(compressed);
    }

    pointer += 46 + nameLength + extraLength + commentLength;
  }

  return null;
}

async function extractFromDocx(buffer: ArrayBuffer): Promise<string | null> {
  const documentXml = await readZipEntry(buffer, "word/document.xml");
  if (!documentXml) {
    return null;
  }

  const xml = new TextDecoder().decode(documentXml);
  const text = xml.replace(/<[^>]+>/g, " ");
  return extractCodeFromText(text);
}

// Best-effort scan of a PDF: search the raw bytes, then try inflating any
// FlateDecode content streams and search those too.
async function extractFromPdf(buffer: ArrayBuffer): Promise<string | null> {
  const raw = new TextDecoder("latin1").decode(new Uint8Array(buffer));
  const direct = extractCodeFromText(raw);
  if (direct) {
    return direct;
  }

  const bytes = new Uint8Array(buffer);
  const marker = "stream";
  let index = raw.indexOf(marker);
  let attempts = 0;
  while (index !== -1 && attempts < 200) {
    attempts += 1;
    let start = index + marker.length;
    if (bytes[start] === 0x0d) start += 1;
    if (bytes[start] === 0x0a) start += 1;
    const end = raw.indexOf("endstream", start);
    if (end === -1) {
      break;
    }

    try {
      const slice = bytes.subarray(start, end);
      const inflated = await new Response(
        new Blob([slice as BlobPart])
          .stream()
          .pipeThrough(new DecompressionStream("deflate")),
      ).text();
      const found = extractCodeFromText(inflated);
      if (found) {
        return found;
      }
    } catch {
      // Not a zlib stream or not text; skip.
    }

    index = raw.indexOf(marker, end + 1);
  }

  return null;
}

export async function extractPolicyCode(file: File): Promise<string | null> {
  try {
    const name = file.name.toLowerCase();
    const buffer = await file.arrayBuffer();
    if (name.endsWith(".docx")) {
      return await extractFromDocx(buffer);
    }
    if (name.endsWith(".pdf")) {
      return await extractFromPdf(buffer);
    }
  } catch {
    // Extraction is best-effort; never block the caller on failure.
  }
  return null;
}

// Extract the code from an already-downloaded file (used to backfill existing
// policies whose stored number is missing).
export async function extractPolicyCodeFromBuffer(
  buffer: ArrayBuffer,
  fileName: string,
): Promise<string | null> {
  try {
    const name = fileName.toLowerCase();
    if (name.endsWith(".docx")) {
      return await extractFromDocx(buffer);
    }
    if (name.endsWith(".pdf")) {
      return await extractFromPdf(buffer);
    }
  } catch {
    // best-effort
  }
  return null;
}
