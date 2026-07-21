import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BookOpen,
  ClipboardCheck,
  FilePlus2,
  FileText,
  LayoutDashboard,
  Search,
  Settings,
  Users,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { policyReference } from "../lib/departments";
import { supabase } from "../lib/supabase";
import type { AppRole, Policy } from "../lib/types";

interface Command {
  id: string;
  label: string;
  hint?: string;
  to: string;
  icon: typeof LayoutDashboard;
}

const NAV_COMMANDS: (Command & { roles?: AppRole[] })[] = [
  { id: "home", label: "الرئيسية", to: "/app", icon: LayoutDashboard },
  { id: "upload", label: "إضافة سياسة", to: "/app/upload", icon: FilePlus2, roles: ["quality_staff", "quality_manager"] },
  { id: "workspace", label: "سياساتي", to: "/app/workspace", icon: FileText },
  { id: "library", label: "مكتبة السياسات", to: "/app/library", icon: BookOpen },
  { id: "actions", label: "ما يحتاج إجراء", to: "/app/actions", icon: ClipboardCheck },
  { id: "approvals", label: "طلبات الاعتماد", to: "/app/approvals", icon: ClipboardCheck, roles: ["quality_manager"] },
  { id: "users", label: "المستخدمون", to: "/app/admin/users", icon: Users, roles: ["system_admin"] },
  { id: "settings", label: "الإعدادات", to: "/app/settings", icon: Settings },
];

export function CommandPalette() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loaded, setLoaded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      } else if (event.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActive(0);
      return;
    }
    inputRef.current?.focus();
    if (!loaded && supabase) {
      void supabase
        .from("policies")
        .select("id,title,policy_number,status")
        .neq("status", "archived")
        .order("updated_at", { ascending: false })
        .limit(500)
        .then(({ data }) => {
          setPolicies((data as Policy[]) ?? []);
          setLoaded(true);
        });
    }
  }, [open, loaded]);

  const role = profile?.role ?? "quality_staff";
  const navResults = useMemo(
    () =>
      NAV_COMMANDS.filter((command) => !command.roles || command.roles.includes(role)).filter(
        (command) => command.label.includes(query.trim()),
      ),
    [query, role],
  );

  const policyResults = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return [];
    }
    return policies
      .filter((policy) =>
        [policy.title, policy.policy_number]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(normalized),
      )
      .slice(0, 8);
  }, [policies, query]);

  const results: Command[] = useMemo(
    () => [
      ...navResults.map((command) => ({
        id: command.id,
        label: command.label,
        to: command.to,
        icon: command.icon,
      })),
      ...policyResults.map((policy) => ({
        id: policy.id,
        label: policy.title,
        hint: policyReference(policy) ?? undefined,
        to: `/app/policies/${policy.id}`,
        icon: FileText,
      })),
    ],
    [navResults, policyResults],
  );

  useEffect(() => {
    setActive(0);
  }, [query]);

  if (!open) {
    return null;
  }

  function go(to: string) {
    navigate(to);
    setOpen(false);
  }

  function onInputKey(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((value) => Math.min(value + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((value) => Math.max(value - 1, 0));
    } else if (event.key === "Enter" && results[active]) {
      event.preventDefault();
      go(results[active].to);
    }
  }

  return (
    <div className="command-scrim" onClick={() => setOpen(false)}>
      <div className="command-palette" onClick={(event) => event.stopPropagation()}>
        <label className="command-input">
          <Search aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onInputKey}
            placeholder="ابحث عن سياسة أو انتقل إلى صفحة…"
          />
          <kbd>Esc</kbd>
        </label>
        <div className="command-results">
          {results.length === 0 ? (
            <p className="command-empty">لا توجد نتائج</p>
          ) : (
            results.map((command, index) => (
              <button
                type="button"
                key={command.id}
                className={index === active ? "command-item active" : "command-item"}
                onMouseEnter={() => setActive(index)}
                onClick={() => go(command.to)}
              >
                <command.icon aria-hidden="true" />
                <span>{command.label}</span>
                {command.hint ? <em dir="ltr">{command.hint}</em> : null}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
