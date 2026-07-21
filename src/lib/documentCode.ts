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
// Zero-width / bidi marks only (NBSP excluded \u2014 it is a real space).
const ZERO_WIDTH = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;
// Every dash / hyphen / minus variant.
const DASHES = /[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g;

// Clean text for reading: drop zero-width/bidi marks but turn NBSP into a real
// space so words stay separated.
function stripMarks(text: string): string {
  return text.replace(ZERO_WIDTH, "").replace(/\u00A0/g, " ");
}

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

// The policy code usually lives in the letterhead header table, which Word
// stores in word/header*.xml — not word/document.xml — so scan every text part.
const DOCX_TEXT_PART = /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/i;

// Use JSZip to unzip the document — it handles every Word quirk (data
// descriptors, ordering, compression) that a hand-rolled parser gets wrong.
async function docxParts(buffer: ArrayBuffer): Promise<{ name: string; text: string }[]> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files)
    .filter((name) => DOCX_TEXT_PART.test(name))
    .sort((a, b) => (a.includes("header") ? 0 : 1) - (b.includes("header") ? 0 : 1));

  const parts: { name: string; text: string }[] = [];
  for (const name of names) {
    try {
      const xml = await zip.files[name].async("string");
      parts.push({ name, text: xml.replace(/<[^>]+>/g, " ") });
    } catch {
      // Skip unreadable parts.
    }
  }
  return parts;
}

async function docxTextParts(buffer: ArrayBuffer): Promise<string[]> {
  return (await docxParts(buffer)).map((part) => part.text);
}

// Only the letterhead header parts carry the labelled field table.
function headerText(parts: { name: string; text: string }[]): string {
  const headers = parts.filter((part) => part.name.includes("header"));
  return (headers.length > 0 ? headers : parts).map((part) => part.text).join(" ");
}

// The policy letterhead is a bilingual labelled table. Split the header text
// on its English labels to read each field's value precisely.
const HEADER_LABELS =
  /(Department|Issue\s*Date|Issue\s*Nu|Effective\s*Date|Code|Review\s*Date|Title|Page)\s*:/gi;

export interface PolicyHeader {
  code: string | null;
  titleAr: string | null;
  titleEn: string | null;
  department: string | null;
  issueDate: string | null;
  effectiveDate: string | null;
  reviewDate: string | null;
  issueNumber: string | null;
}

function labeledFields(rawText: string): Record<string, string> {
  const text = stripMarks(rawText);
  const fields: Record<string, string> = {};
  const matches = [...text.matchAll(HEADER_LABELS)];
  for (let i = 0; i < matches.length; i++) {
    const key = matches[i][1].toLowerCase().replace(/\s+/g, "");
    const start = (matches[i].index ?? 0) + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index ?? text.length : text.length;
    fields[key] = text.slice(start, end).replace(/\s+/g, " ").trim();
  }
  return fields;
}

function joinCodeSegments(segments: string[]): string | null {
  const segs = segments.filter(Boolean);
  return segs.length >= 3 ? segs.join("-") : null;
}

// Collect segments forward from a "JFHC…serial" run, tolerating serials/segments
// Word split across runs (e.g. "HP D" → HPD, "0 8" → 08). Stops at the serial.
function collectForward(fromJfhc: string): string | null {
  const parts = fromJfhc.split(/\s*-\s*/);
  const segs: string[] = [];
  for (const raw of parts) {
    const part = raw.trim();
    if (segs.length > 0 && /^\d/.test(part)) {
      const serial = (part.match(/^[\d\s]+/) ?? [""])[0].replace(/\s+/g, "");
      if (serial) segs.push(serial);
      break;
    }
    const alnum = part.replace(/\s+/g, "").match(/^[A-Z0-9]{1,6}/);
    if (!alnum) break;
    segs.push(alnum[0]);
    if (segs.length >= 8) break;
  }
  return joinCodeSegments(segs);
}

// Collect a code that runs backward into JFHC (reversed RTL order).
function collectReversed(endingAtJfhc: string): string | null {
  const parts = endingAtJfhc.split(/\s*-\s*/).filter((p) => p.trim());
  const segs: string[] = [];
  for (let k = parts.length - 1; k >= 0; k--) {
    const part = parts[k].trim();
    if (segs.length >= 2) {
      const serial = part.match(/(\d[\d\s]*)$/);
      if (serial) {
        segs.push(serial[1].replace(/\s+/g, ""));
        break;
      }
    }
    const alnum = part.replace(/\s+/g, "").match(/[A-Z0-9]{1,6}$/);
    if (!alnum) break;
    segs.push(alnum[0]);
    if (segs.length >= 8) break;
  }
  return joinCodeSegments(segs);
}

// Read the policy's own code from the FIRST JFHC occurrence (the letterhead is
// always at the top), ignoring reference-document codes that appear later in
// the body. Handles Word run-splits and the reversed order of RTL PDFs.
function readPolicyCode(text: string | undefined): string | null {
  if (!text) {
    return null;
  }
  const upper = normalizeForCode(stripMarks(text)).toUpperCase();
  const index = upper.indexOf("JFHC");
  if (index === -1) {
    return null;
  }
  return (
    collectForward(upper.slice(index)) ??
    collectReversed(upper.slice(Math.max(0, index - 70), index + 4))
  );
}

function dateFromField(value: string | undefined): string | null {
  const match = value?.replace(/\s+/g, "").match(/\d{1,2}\/\d{1,2}\/\d{2,4}/);
  return match ? match[0] : null;
}

function stripArabicLabel(value: string | undefined, ...labels: string[]): string | null {
  if (!value) {
    return null;
  }
  let out = value;
  for (const label of labels) {
    out = out.replace(label, " ");
  }
  out = out.replace(/\s+/g, " ").trim();
  return out || null;
}

export function parsePolicyHeader(text: string): PolicyHeader {
  const fields = labeledFields(text);
  const titleField = fields["title"] ?? "";
  const [titleEnRaw, titleArRaw] = titleField.split(/العنوان|Title/i);

  return {
    code: readPolicyCode(text),
    titleEn: (titleEnRaw ?? "").trim() || null,
    titleAr: (titleArRaw ?? "").trim() || null,
    department: stripArabicLabel(fields["department"], "الإدارة", "الادارة", "القسم"),
    issueDate: dateFromField(fields["issuedate"]),
    effectiveDate: dateFromField(fields["effectivedate"]),
    reviewDate: dateFromField(fields["reviewdate"]),
    issueNumber:
      stripArabicLabel(fields["issuenu"], "رقم الإصدار", "رقم الاصدار")?.match(/\d+/)?.[0] ??
      null,
  };
}

async function extractFromDocx(buffer: ArrayBuffer): Promise<string | null> {
  const parts = await docxParts(buffer);
  // Read from the letterhead header first so body reference codes are ignored.
  return (
    readPolicyCode(headerText(parts)) ??
    readPolicyCode(parts.map((part) => part.text).join(" "))
  );
}

// Parse the full policy header (code, title, department, dates) from a file.
export async function extractPolicyHeaderFromBuffer(
  buffer: ArrayBuffer,
  fileName: string,
): Promise<PolicyHeader | null> {
  try {
    const name = fileName.toLowerCase();
    let text = "";
    if (name.endsWith(".docx")) {
      text = headerText(await docxParts(buffer));
    } else if (name.endsWith(".pdf")) {
      text = (await pdfjsText(buffer)) || (await pdfText(buffer));
    }
    return text ? parsePolicyHeader(text) : null;
  } catch {
    return null;
  }
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
  const text = (await pdfjsText(buffer)) || (await pdfText(buffer));
  return readPolicyCode(text);
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
