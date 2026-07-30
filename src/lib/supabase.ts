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

export function createDetachedSupabaseClient() {
  if (!hasSupabaseConfig) {
    return null;
  }

  return createClient(supabaseUrl, supabasePublishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export function assertSupabase() {
  if (!supabase) {
    throw new Error("الخدمة غير متاحة حاليًا. يرجى المحاولة لاحقًا.");
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

// A handful of common Supabase Auth errors that surface raw English text —
// translated so operators see something actionable instead of a technical
// message. Every account in this app logs in by username, not a real
// mailbox, so an email-sending failure here is never something the user
// caused; it just needs to be explained.
const KNOWN_ERROR_PATTERNS: Array<{ test: RegExp; message: string }> = [
  {
    test: /email rate limit exceeded/i,
    message:
      'تم تجاوز الحد المسموح به لإرسال رسائل التفعيل من Supabase خلال فترة قصيرة. انتظر بضع دقائق ثم أعد المحاولة. لتفادي هذا نهائيًا، عطّل خيار "Confirm email" من إعدادات Supabase (Authentication → Providers → Email) — الحسابات هنا تُنشأ بعنوان داخلي لا يستقبل رسائل فعليًا فلا حاجة لتأكيده.',
  },
  {
    test: /user already registered|already been registered/i,
    message: "اسم المستخدم هذا مستخدم بالفعل. اختر اسمًا آخر.",
  },
];

function translateKnownError(raw: string) {
  for (const pattern of KNOWN_ERROR_PATTERNS) {
    if (pattern.test.test(raw)) {
      return pattern.message;
    }
  }
  return raw;
}

export function errorMessage(error: unknown) {
  if (!error) {
    return "حدث خطأ غير معروف.";
  }

  if (typeof error === "string") {
    return translateKnownError(error);
  }

  if (error instanceof Error) {
    return translateKnownError(error.message);
  }

  const maybeError = error as { message?: string; details?: string };
  return translateKnownError(maybeError.message ?? maybeError.details ?? "حدث خطأ غير معروف.");
}
