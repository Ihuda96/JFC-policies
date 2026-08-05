import { supabase } from "./supabase";

/** Public URL for a user's own profile photo, stored in the (public)
 *  profile-avatars bucket. Returns null when there's no photo on file —
 *  callers should fall back to the JFHC badge rather than a broken image. */
export function avatarPublicUrl(path: string | null | undefined): string | null {
  if (!path || !supabase) {
    return null;
  }

  return supabase.storage.from("profile-avatars").getPublicUrl(path).data.publicUrl;
}
