// Client-side extraction of the full policy code (e.g. JFHC-HRD-HPD-APP-PP-01)
// from an uploaded document, so policies classify automatically and show the
// full code even when the title only carries a short reference.

// The cluster code followed by dash-separated segments ending in a serial.
const FULL_CODE_PATTERN =
  /JFHC(?:\s*[-/_]\s*[A-Z0-9]{1,6}){1,5}\s*[-/_]\s*\d{1,4}/i;

// Any cluster code chain even without the JFHC prefix, e.g. HRD-HPD-APP-PP-01.
const LOOSE_CODE_PATTERN =
  /\b[A-Z]{2,6}(?:\s*[-/_]\s*[A-Z0-9]{1,6}){2,5}\s*[-/_]\s*\d{1,4}\b/;

// Invisible formatting marks Word sprinkles around Latin runs in Arabic text:
// zero-width chars, bidi controls, isolates, BOM and NBSP.
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF\u00A0]/g;
// Every dash / hyphen / minus variant.
const DASHES = /[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g;

// Normalise text so a code survives no matter how it was encoded: drop the
// invisible marks, unify dashes, and convert Arabic-Indic digits to ASCII.
export function normalizeForCode(text: string): string {
  return text
    .replace(INVISIBLE, "")
    .replace(DASHES, "-")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

export function extractCodeFromText(text: string | null | undefined): string | null {
  if (!text) {
    return null;
  }

  const cleaned = normalizeForCode(text);
  const match = cleaned.match(FULL_CODE_PATTERN) ?? cleaned.match(LOOSE_CODE_PATTERN);
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

  if (segments[0] !== "JFHC") {
    segments.unshift("JFHC");
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

async function docxTextParts(buffer: ArrayBuffer): Promise<string[]> {
  const entries = listZipEntries(buffer).filter((entry) => DOCX_TEXT_PART.test(entry.name));
  entries.sort((a, b) => {
    const aHeader = a.name.includes("header") ? 0 : 1;
    const bHeader = b.name.includes("header") ? 0 : 1;
    return aHeader - bHeader;
  });

  const parts: string[] = [];
  for (const entry of entries) {
    try {
      const xml = new TextDecoder().decode(await readEntry(buffer, entry));
      parts.push(xml.replace(/<[^>]+>/g, " "));
    } catch {
      // Skip unreadable parts.
    }
  }
  return parts;
}

async function extractFromDocx(buffer: ArrayBuffer): Promise<string | null> {
  for (const part of await docxTextParts(buffer)) {
    const code = extractCodeFromText(part);
    if (code) {
      return code;
    }
  }
  return null;
}

// Decode the visible text out of a PDF content stream by concatenating the
// string literals — "(...)" and hex "<...>" — that the text operators draw.
function pdfLiteralsToText(content: string): string {
  let out = "";
  let i = 0;
  const n = content.length;

  while (i < n) {
    const ch = content[i];

    if (ch === "(") {
      let depth = 1;
      i += 1;
      while (i < n && depth > 0) {
        const c = content[i];
        if (c === "\\") {
          const next = content[i + 1];
          if (next >= "0" && next <= "7") {
            let oct = "";
            let k = i + 1;
            while (k < n && content[k] >= "0" && content[k] <= "7" && oct.length < 3) {
              oct += content[k];
              k += 1;
            }
            out += String.fromCharCode(parseInt(oct, 8) & 0xff);
            i = k;
            continue;
          }
          const map: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" };
          out += map[next] ?? next ?? "";
          i += 2;
          continue;
        }
        if (c === "(") {
          depth += 1;
          out += c;
        } else if (c === ")") {
          depth -= 1;
          if (depth > 0) out += c;
        } else {
          out += c;
        }
        i += 1;
      }
    } else if (ch === "<" && content[i + 1] !== "<") {
      let j = i + 1;
      let hex = "";
      while (j < n && content[j] !== ">") {
        hex += content[j];
        j += 1;
      }
      hex = hex.replace(/[^0-9A-Fa-f]/g, "");
      for (let k = 0; k + 1 < hex.length; k += 2) {
        out += String.fromCharCode(parseInt(hex.slice(k, k + 2), 16) & 0xff);
      }
      i = j + 1;
    } else {
      i += 1;
    }
  }

  return out;
}

async function pdfText(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);
  const raw = new TextDecoder("latin1").decode(bytes);
  let combined = pdfLiteralsToText(raw);

  const marker = "stream";
  let index = raw.indexOf(marker);
  let attempts = 0;
  while (index !== -1 && attempts < 800) {
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
      combined += " " + pdfLiteralsToText(inflated) + " " + inflated;
    } catch {
      // Not a zlib stream or not text; skip.
    }

    index = raw.indexOf(marker, end + 1);
  }

  return combined;
}

// pdf.js decodes text through each font's ToUnicode map, so it recovers codes
// from subset/encoded-font PDFs that raw literal scanning turns into gibberish.
// It is loaded lazily so it never weighs down the initial page load.
let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;

async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import("pdfjs-dist");
      try {
        const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
        pdfjs.GlobalWorkerOptions.workerSrc = (worker as { default: string }).default;
      } catch {
        // Fall back to the default worker resolution.
      }
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

async function pdfjsText(buffer: ArrayBuffer): Promise<string> {
  try {
    const pdfjs = await loadPdfjs();
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(buffer.slice(0)),
      isEvalSupported: false,
      disableFontFace: true,
    }).promise;

    let text = "";
    const pages = Math.min(doc.numPages, 6);
    for (let p = 1; p <= pages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      text +=
        content.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ") + " ";
      if (extractCodeFromText(text)) {
        break;
      }
    }
    await doc.destroy();
    return text;
  } catch {
    return "";
  }
}

async function extractFromPdf(buffer: ArrayBuffer): Promise<string | null> {
  return (
    extractCodeFromText(await pdfjsText(buffer)) ??
    extractCodeFromText(await pdfText(buffer))
  );
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

// Diagnostic: return a readable snippet of the text actually read from a file,
// so a stubborn document's real format can be seen and matched.
export async function extractPolicyTextSample(
  buffer: ArrayBuffer,
  fileName: string,
  limit = 400,
): Promise<string> {
  try {
    const name = fileName.toLowerCase();
    let text = "";
    if (name.endsWith(".docx")) {
      text = (await docxTextParts(buffer)).join(" ");
    } else if (name.endsWith(".pdf")) {
      text = (await pdfjsText(buffer)) || (await pdfText(buffer));
    }
    const collapsed = normalizeForCode(text).replace(/\s+/g, " ").trim();
    return `[${fileName}] ${collapsed}`.slice(0, limit + fileName.length + 3);
  } catch {
    return "";
  }
}
