import { createClient } from "@supabase/supabase-js";
import { hasSupabaseConfig, supabasePublishableKey, supabaseUrl } from "./config";

export const supabase = hasSupabaseConfig
  ? createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export function assertSupabase() {
  if (!supabase) {
    throw new Error("Supabase public browser configuration is missing.");
  }

  return supabase;
}

export function isSetupError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const maybeError = error as { code?: string; message?: string };
  return (
    maybeError.code === "42P01" ||
    maybeError.code === "42703" ||
    maybeError.code === "PGRST205" ||
    maybeError.message?.toLowerCase().includes("does not exist") === true ||
    maybeError.message?.toLowerCase().includes("schema cache") === true
  );
}

export function errorMessage(error: unknown) {
  if (!error) {
    return "حدث خطأ غير معروف.";
  }

  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  const maybeError = error as { message?: string; details?: string };
  return maybeError.message ?? maybeError.details ?? "حدث خطأ غير معروف.";
}
