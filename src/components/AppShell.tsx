import {
  Bell,
  BookOpen,
  ClipboardCheck,
  FilePlus2,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  ScrollText,
  Settings,
  Shield,
  Users,
} from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";
import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { initials, roleLabels } from "../lib/format";
import type { AppRole } from "../lib/types";

type NavItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  roles?: AppRole[];
};

const baseItems: NavItem[] = [
  { to: "/app", label: "الرئيسية", icon: LayoutDashboard },
  { to: "/app/upload", label: "إضافة سياسة", icon: FilePlus2, roles: ["quality_staff", "quality_manager"] },
  { to: "/app/workspace", label: "سياساتي", icon: FileText },
  { to: "/app/library", label: "المكتبة", icon: BookOpen },
  { to: "/app/notifications", label: "الإشعارات", icon: Bell },
];

const managerItems: NavItem[] = [
  { to: "/app/approvals", label: "طلبات الاعتماد", icon: ClipboardCheck },
  { to: "/app/reports", label: "التقارير", icon: ScrollText },
];

const adminItems: NavItem[] = [
  { to: "/app/admin/users", label: "المستخدمون", icon: Users },
  { to: "/app/admin/audit", label: "سجل العمليات", icon: Shield },
];

export function AppShell() {
  const { profile, signOut } = useAuth();
  const [open, setOpen] = useState(false);

  const role = profile?.role ?? "quality_staff";
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
            </NavLink>
          ))}
        </nav>
        <NavLink className="settings-link" to="/app/settings" onClick={() => setOpen(false)}>
          <Settings aria-hidden="true" />
          <span>الإعدادات</span>
        </NavLink>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <button className="icon-button mobile-only" onClick={() => setOpen(true)} aria-label="فتح القائمة">
            <Menu aria-hidden="true" />
          </button>
          <div className="topbar-title">
            <span>تجمع جدة الصحي الأول</span>
            <strong>إدارة السياسات والإجراءات</strong>
          </div>
          <div className="account-chip">
            <span className="avatar">{initials(profile?.full_name)}</span>
            <div>
              <strong>{profile?.full_name ?? profile?.email ?? "مستخدم"}</strong>
              <span>{roleLabels[role]}</span>
            </div>
            <button onClick={() => void signOut()} aria-label="تسجيل الخروج">
              <LogOut aria-hidden="true" />
            </button>
          </div>
        </header>
        <main className="content-area">
          <Outlet />
        </main>
      </div>
      {open ? <button className="scrim" aria-label="إغلاق القائمة" onClick={() => setOpen(false)} /> : null}
    </div>
  );
}
