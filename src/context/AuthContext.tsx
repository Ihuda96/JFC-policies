import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { hasSupabaseConfig } from "../lib/config";
import { isPlatformSuperAdminMetadata } from "../lib/authClaims";
import { isSetupError, supabase } from "../lib/supabase";
import type { Profile } from "../lib/types";

interface AuthContextValue {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  setupRequired: boolean;
  profileError: string | null;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function applyAuthClaims(profile: Profile | null, appMetadata: unknown) {
  if (!profile || !isPlatformSuperAdminMetadata(appMetadata)) {
    return profile;
  }

  return {
    ...profile,
    role: "system_admin" as const,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [setupRequired, setSetupRequired] = useState(!hasSupabaseConfig);
  const [profileError, setProfileError] = useState<string | null>(null);

  const loadProfile = useCallback(async (userId: string, appMetadata?: unknown) => {
    if (!supabase) {
      setSetupRequired(true);
      setProfile(null);
      return;
    }

    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      if (isSetupError(error)) {
        setSetupRequired(true);
      }

      setProfileError(error.message);
      setProfile(null);
      return;
    }

    setSetupRequired(false);
    setProfileError(null);
    setProfile(applyAuthClaims((data as Profile | null) ?? null, appMetadata));
  }, []);

  const refreshProfile = useCallback(async () => {
    if (session?.user.id) {
      await loadProfile(session.user.id, session.user.app_metadata);
    }
  }, [loadProfile, session?.user.app_metadata, session?.user.id]);

  useEffect(() => {
    let isMounted = true;

    async function boot() {
      if (!supabase) {
        if (isMounted) {
          setLoading(false);
          setSetupRequired(true);
        }
        return;
      }

      const {
        data: { session: currentSession },
      } = await supabase.auth.getSession();

      if (!isMounted) {
        return;
      }

      setSession(currentSession);
      if (currentSession?.user.id) {
        await loadProfile(currentSession.user.id, currentSession.user.app_metadata);
      }
      setLoading(false);
    }

    void boot();

    if (!supabase) {
      return () => {
        isMounted = false;
      };
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (nextSession?.user.id) {
        void loadProfile(nextSession.user.id, nextSession.user.app_metadata);
      } else {
        setProfile(null);
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signOut = useCallback(async () => {
    if (supabase) {
      await supabase.auth.signOut();
    }
    setSession(null);
    setProfile(null);
  }, []);

  const value = useMemo(
    () => ({
      session,
      profile,
      loading,
      setupRequired,
      profileError,
      refreshProfile,
      signOut,
    }),
    [loading, profile, profileError, refreshProfile, session, setupRequired, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used inside AuthProvider.");
  }

  return value;
}
