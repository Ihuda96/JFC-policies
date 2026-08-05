import { PDFDocument } from "pdf-lib";

/** Draws the CEO's e-stamp (a PNG) onto the last page of a policy PDF,
 *  large and centered near the bottom, and returns the resulting
 *  document's bytes. */
export async function embedStampInPdf(
  pdfBytes: ArrayBuffer,
  stampPngBytes: ArrayBuffer,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const stampImage = await pdfDoc.embedPng(stampPngBytes);

  const pages = pdfDoc.getPages();
  const lastPage = pages[pages.length - 1];
  const { width } = lastPage.getSize();

  const targetSize = 230;
  const largestSide = Math.max(stampImage.width, stampImage.height);
  const scale = targetSize / largestSide;
  const stampWidth = stampImage.width * scale;
  const stampHeight = stampImage.height * scale;
  const margin = 48;

  lastPage.drawImage(stampImage, {
    x: (width - stampWidth) / 2,
    y: margin,
    width: stampWidth,
    height: stampHeight,
    opacity: 1,
  });

  return pdfDoc.save();
}
