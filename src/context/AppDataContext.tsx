import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "./AuthContext";
import { supabase } from "../lib/supabase";
import type { NotificationItem, Policy } from "../lib/types";

export interface ActionItem {
  id: string;
  title: string;
  to: string;
  meta?: string | null;
}

export interface ActionGroup {
  key: string;
  title: string;
  items: ActionItem[];
}

interface AppDataValue {
  notifications: NotificationItem[];
  unreadCount: number;
  actionGroups: ActionGroup[];
  actionCount: number;
  loading: boolean;
  refresh: () => Promise<void>;
}

const AppDataContext = createContext<AppDataValue | null>(null);

const REVIEW_WINDOW_DAYS = 90;

export function AppDataProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!supabase || !profile) {
      setLoading(false);
      return;
    }

    const [notifResult, policyResult] = await Promise.all([
      supabase
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("policies")
        .select("id,title,status,owner_id,next_review_at,policy_number")
        .neq("status", "archived")
        .order("updated_at", { ascending: false }),
    ]);

    if (!notifResult.error) {
      setNotifications((notifResult.data as NotificationItem[]) ?? []);
    }
    if (!policyResult.error) {
      setPolicies((policyResult.data as Policy[]) ?? []);
    }
    setLoading(false);
  }, [profile]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<AppDataValue>(() => {
    const unread = notifications.filter((item) => !item.read_at);

    const groups: ActionGroup[] = [];
    const link = (policy: Policy): ActionItem => ({
      id: policy.id,
      title: policy.title,
      to: `/app/policies/${policy.id}`,
    });

    if (profile?.role === "quality_manager") {
      const pending = policies.filter((policy) =>
        ["pending_approval", "resubmitted"].includes(policy.status),
      );
      if (pending.length > 0) {
        groups.push({ key: "approvals", title: "بانتظار اعتمادك", items: pending.map(link) });
      }
    }

    const mine = policies.filter((policy) => policy.owner_id === profile?.id);
    const returned = mine.filter((policy) => policy.status === "returned_for_revision");
    if (returned.length > 0) {
      groups.push({ key: "returned", title: "أُعيدت إليك للتعديل", items: returned.map(link) });
    }
    const drafts = mine.filter((policy) => policy.status === "draft");
    if (drafts.length > 0) {
      groups.push({ key: "drafts", title: "مسودات لم تُرسل بعد", items: drafts.map(link) });
    }

    const soon = Date.now() + REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const dueForReview = policies
      .filter(
        (policy) =>
          policy.status === "approved" &&
          policy.next_review_at &&
          new Date(policy.next_review_at).getTime() <= soon,
      )
      .map((policy) => ({
        ...link(policy),
        meta: policy.next_review_at,
      }));
    if (dueForReview.length > 0) {
      groups.push({ key: "review", title: "تحتاج مراجعة قريبًا", items: dueForReview });
    }

    const actionCount = groups.reduce((total, group) => total + group.items.length, 0);

    return {
      notifications,
      unreadCount: unread.length,
      actionGroups: groups,
      actionCount,
      loading,
      refresh,
    };
  }, [notifications, policies, profile, loading, refresh]);

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAppData() {
  const value = useContext(AppDataContext);
  if (!value) {
    throw new Error("useAppData must be used inside AppDataProvider.");
  }
  return value;
}
