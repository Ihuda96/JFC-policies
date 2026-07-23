import {
  BookOpen,
  ClipboardCheck,
  FilePlus2,
  FileText,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  ScrollText,
  Search,
  Settings,
  Shield,
  Users,
} from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useAppData } from "../context/AppDataContext";
import { CommandPalette } from "./CommandPalette";
import { NotificationBell } from "./NotificationBell";
import { initials, roleLabels } from "../lib/format";
import type { AppRole } from "../lib/types";

type NavItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  roles?: AppRole[];
  badge?: number;
};

export function AppShell() {
  const { profile, signOut } = useAuth();
  const { actionCount } = useAppData();
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 8);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const role = profile?.role ?? "quality_staff";

  const baseItems: NavItem[] = [
    { to: "/app", label: "الرئيسية", icon: LayoutDashboard },
    { to: "/app/upload", label: "إضافة سياسة", icon: FilePlus2, roles: ["quality_staff", "quality_manager"] },
    { to: "/app/actions", label: "ما يحتاج إجراء", icon: ListChecks, badge: actionCount },
    { to: "/app/workspace", label: "سياساتي", icon: FileText },
    { to: "/app/library", label: "المكتبة", icon: BookOpen },
  ];
  const managerItems: NavItem[] = [
    { to: "/app/approvals", label: "طلبات الاعتماد", icon: ClipboardCheck },
    { to: "/app/reports", label: "التقارير", icon: ScrollText },
  ];
  const adminItems: NavItem[] = [
    { to: "/app/admin/users", label: "المستخدمون", icon: Users },
    { to: "/app/admin/audit", label: "سجل العمليات", icon: Shield },
  ];

  const navItems = [
    ...baseItems,
    ...(role === "quality_manager" ? managerItems : []),
    ...(role === "system_admin" ? adminItems : []),
  ].filter((item) => !item.roles || item.roles.includes(role));

  return (
    <div className="app-layout">
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="brand-block">
          <img src="/brand/jfc-logo-stacked-white.jpg" alt="تجمع جدة الصحي الأول" />
          <div>
            <strong>منصة السياسات</strong>
            <span>JFC Policies</span>
          </div>
        </div>
        <nav className="sidebar-nav" aria-label="التنقل الرئيسي">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/app"}
              onClick={() => setOpen(false)}
            >
              <item.icon aria-hidden="true" />
              <span>{item.label}</span>
              {item.badge ? <span className="nav-badge">{item.badge}</span> : null}
            </NavLink>
          ))}
        </nav>
        <NavLink className="settings-link" to="/app/settings" onClick={() => setOpen(false)}>
          <Settings aria-hidden="true" />
          <span>الإعدادات</span>
        </NavLink>
      </aside>

      <div className="main-shell">
        <header className={scrolled ? "topbar scrolled" : "topbar"}>
          <button className="icon-button mobile-only" onClick={() => setOpen(true)} aria-label="فتح القائمة">
            <Menu aria-hidden="true" />
          </button>
          <div className="topbar-title">
            <span>تجمع جدة الصحي الأول</span>
            <strong>إدارة السياسات والإجراءات</strong>
          </div>
          <div className="topbar-actions">
            <button
              type="button"
              className="command-trigger"
              onClick={() => {
                window.dispatchEvent(
                  new KeyboardEvent("keydown", { key: "k", ctrlKey: true }),
                );
              }}
              aria-label="بحث سريع"
            >
              <Search aria-hidden="true" />
              <span>بحث سريع</span>
            </button>
            <NotificationBell />
            <div className="account-chip" ref={menuRef}>
              <button
                type="button"
                className="account-trigger"
                onClick={() => setMenuOpen((value) => !value)}
              >
                <span className="avatar">{initials(profile?.full_name)}</span>
                <div>
                  <strong>{profile?.full_name ?? profile?.email ?? "مستخدم"}</strong>
                  <span>{roleLabels[role]}</span>
                </div>
              </button>
              {menuOpen ? (
                <>
                  <button
                    type="button"
                    className="sheet-backdrop"
                    aria-label="إغلاق"
                    onClick={() => setMenuOpen(false)}
                  />
                  <div className="account-menu">
                    <NavLink to="/app/settings" onClick={() => setMenuOpen(false)}>
                      <Settings aria-hidden="true" />
                      الإعدادات
                    </NavLink>
                    <button type="button" onClick={() => void signOut()}>
                      <LogOut aria-hidden="true" />
                      تسجيل الخروج
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </header>
        <main className="content-area">
          <Outlet />
        </main>
      </div>

      <nav className="bottom-nav" aria-label="التنقل السريع">
        <NavLink to="/app" end>
          <LayoutDashboard aria-hidden="true" />
          <span>الرئيسية</span>
        </NavLink>
        <NavLink to="/app/library">
          <BookOpen aria-hidden="true" />
          <span>المكتبة</span>
        </NavLink>
        <NavLink to="/app/actions">
          <span className="bottom-nav-icon">
            <ListChecks aria-hidden="true" />
            {actionCount ? <span className="nav-dot" /> : null}
          </span>
          <span>المهام</span>
        </NavLink>
        <NavLink to="/app/workspace">
          <FileText aria-hidden="true" />
          <span>سياساتي</span>
        </NavLink>
        <button type="button" onClick={() => setOpen(true)}>
          <Menu aria-hidden="true" />
          <span>القائمة</span>
        </button>
      </nav>

      {open ? <button className="scrim" aria-label="إغلاق القائمة" onClick={() => setOpen(false)} /> : null}
      <CommandPalette />
    </div>
  );
}
