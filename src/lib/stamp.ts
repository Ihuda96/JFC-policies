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
