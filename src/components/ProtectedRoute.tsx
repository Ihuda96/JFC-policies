import { Navigate, Outlet, useLocation } from "react-router-dom";
import { LoadingState } from "./LoadingState";
import { SetupRequired } from "./SetupRequired";
import { useAuth } from "../context/AuthContext";

export function ProtectedRoute() {
  const { session, profile, loading, setupRequired, profileError } = useAuth();
  const location = useLocation();

  if (loading) {
    return <LoadingState label="جاري التحقق من الجلسة..." />;
  }

  if (setupRequired) {
    return <SetupRequired message={profileError} />;
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (!profile) {
    return (
      <main className="setup-screen">
        <section className="setup-panel">
          <p className="eyebrow">الحساب غير مكتمل</p>
          <h1>لم يتم العثور على ملف حسابك</h1>
          <p>
            تم تسجيل الدخول بنجاح، لكن لم يكتمل إعداد ملف حسابك بعد. يرجى التواصل
            مع مدير النظام لتفعيل حسابك.
          </p>
        </section>
      </main>
    );
  }

  if (profile.status !== "active") {
    return (
      <main className="setup-screen">
        <section className="setup-panel">
          <p className="eyebrow">الحساب غير مفعل</p>
          <h1>حسابك بانتظار تفعيل مدير النظام</h1>
          <p>
            تم إنشاء ملف حسابك، لكن الدخول إلى المنصة يتطلب تعيين الدور وتفعيل
            الحساب من قبل مدير النظام.
          </p>
        </section>
      </main>
    );
  }

  return <Outlet />;
}
