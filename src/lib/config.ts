export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? "";
export const supabasePublishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";

export const hasSupabaseConfig =
  supabaseUrl.length > 0 && supabasePublishableKey.length > 0;

export const deploymentProject = {
  url: "https://sbhpbfoadltmjsziayum.supabase.co",
  ref: "sbhpbfoadltmjsziayum",
};
