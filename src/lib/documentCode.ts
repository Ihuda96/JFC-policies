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

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localOffset: number;
}

// Enumerate the entries of a ZIP archive (DOCX/XLSX are ZIP files) from its
// central directory, using only native browser APIs.
function listZipEntries(buffer: ArrayBuffer): ZipEntry[] {
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
    return [];
  }

  const centralOffset = view.getUint32(eocd + 16, true);
  const entryCount = view.getUint16(eocd + 10, true);
  const entries: ZipEntry[] = [];

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
    const name = new TextDecoder().decode(
      bytes.subarray(pointer + 46, pointer + 46 + nameLength),
    );

    entries.push({ name, method, compressedSize, localOffset });
    pointer += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

async function readEntry(buffer: ArrayBuffer, entry: ZipEntry): Promise<Uint8Array> {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const localNameLength = view.getUint16(entry.localOffset + 26, true);
  const localExtraLength = view.getUint16(entry.localOffset + 28, true);
  const dataStart = entry.localOffset + 30 + localNameLength + localExtraLength;
  const compressed = bytes.subarray(dataStart, dataStart + entry.compressedSize);
  return entry.method === 0 ? compressed : await inflateRaw(compressed);
}

// The policy code usually lives in the letterhead header table, which Word
// stores in word/header*.xml — not word/document.xml — so scan every text part.
const DOCX_TEXT_PART = /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/i;

async function extractFromDocx(buffer: ArrayBuffer): Promise<string | null> {
  const entries = listZipEntries(buffer).filter((entry) => DOCX_TEXT_PART.test(entry.name));
  // Headers first — the code is normally in the letterhead.
  entries.sort((a, b) => {
    const aHeader = a.name.includes("header") ? 0 : 1;
    const bHeader = b.name.includes("header") ? 0 : 1;
    return aHeader - bHeader;
  });

  for (const entry of entries) {
    try {
      const xml = new TextDecoder().decode(await readEntry(buffer, entry));
      const text = xml.replace(/<[^>]+>/g, " ");
      const code = extractCodeFromText(text);
      if (code) {
        return code;
      }
    } catch {
      // Skip unreadable parts.
    }
  }

  return null;
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
  while (index !== -1 && attempts < 400) {
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

async function extractFromBuffer(
  buffer: ArrayBuffer,
  fileName: string,
): Promise<string | null> {
  const name = fileName.toLowerCase();
  if (name.endsWith(".docx")) {
    return extractFromDocx(buffer);
  }
  if (name.endsWith(".pdf")) {
    return extractFromPdf(buffer);
  }
  return null;
}

export async function extractPolicyCode(file: File): Promise<string | null> {
  try {
    return await extractFromBuffer(await file.arrayBuffer(), file.name);
  } catch {
    return null;
  }
}

// Extract the code from an already-downloaded file (used to backfill existing
// policies whose stored number is missing).
export async function extractPolicyCodeFromBuffer(
  buffer: ArrayBuffer,
  fileName: string,
): Promise<string | null> {
  try {
    return await extractFromBuffer(buffer, fileName);
  } catch {
    return null;
  }
}
