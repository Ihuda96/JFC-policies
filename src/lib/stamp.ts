import { supabase } from "./supabase";

/** Public URL for a CEO e-stamp image stored in the (public) ceo-stamps
 *  bucket. Returns null when there's no stamp on file — callers should
 *  simply omit the seal rather than show a broken image. */
export function stampPublicUrl(path: string | null | undefined): string | null {
  if (!path || !supabase) {
    return null;
  }

  return supabase.storage.from("ceo-stamps").getPublicUrl(path).data.publicUrl;
}

/** Public URL for a stamped, finally-approved PDF in the (public)
 *  policy-approved bucket. */
export function approvedPdfPublicUrl(path: string | null | undefined): string | null {
  if (!path || !supabase) {
    return null;
  }

  return supabase.storage.from("policy-approved").getPublicUrl(path).data.publicUrl;
}

/** Re-encodes any raster image (PNG/JPEG/WebP) as a clean PNG, so a stamp
 *  upload always ends up in a format pdf-lib can embed directly regardless
 *  of what the CEO originally picked. */
export async function toPngBlob(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("تعذر تجهيز صورة الختم.");
  }
  ctx.drawImage(bitmap, 0, 0);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("تعذر تحويل صورة الختم."));
      }
    }, "image/png");
  });
}
