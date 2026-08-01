import React, { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import eposLogo from "@/assets/epos-logo.png";
import Login from "@/pages/Login";
import AdminLayout from "@/pages/admin/AdminLayout";
import AdminClients from "@/pages/admin/AdminClients";
import AdminClientDetail from "@/pages/admin/AdminClientDetail";
import AdminSubmissions from "@/pages/admin/AdminSubmissions";
import AdminIntegrations from "@/pages/admin/AdminIntegrations";
import AdminIntegrationHub from "@/pages/admin/AdminIntegrationHub";
import AdminPlatform from "@/pages/admin/AdminPlatform";
import AdminAccountancySettings from "@/pages/admin/AdminAccountancySettings";
import AdminAccountancySoftware from "@/pages/admin/AdminAccountancySoftware";
import AdminAutomation from "@/pages/admin/AdminAutomation";
import AdminSettings from "@/pages/admin/AdminSettings";
import AdminPractice from "@/pages/admin/AdminPractice";
import PlatformLayout from "@/pages/platform/PlatformLayout";
import PlatformPractices from "@/pages/platform/PlatformPractices";
import ClientLayout from "@/pages/client/ClientLayout";
import ClientDashboard from "@/pages/client/ClientDashboard";
import ClientList from "@/pages/client/ClientList";
import ClientSubmit from "@/pages/client/ClientSubmit";
import ClientSubmitAdditional from "@/pages/client/ClientSubmitAdditional";

const AdminPayroll = React.lazy(() => import("@/pages/admin/AdminPayroll"));

const practiceRoles = ["admin", "practice_admin", "practice_manager", "practice_staff", "practice_readonly"];

function homeForRole(role) {
  if (role === "platform_admin") return "/platform";
  if (practiceRoles.includes(role)) return "/admin";
  return "/portal";
}

function Protected({ role, roles, children }) {
  const { user } = useAuth();
  if (user === null) {
    return (
      <div className="min-h-screen flex items-center justify-center" data-testid="auth-loading">
        <div className="text-stone-500 font-display">Loading…</div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  const allowed = roles || (role ? [role] : []);
  if (allowed.length && !allowed.includes(user.role)) {
    return <Navigate to={homeForRole(user.role)} replace />;
  }
  return children;
}

function Root() {
  const { user } = useAuth();
  if (user === null) return null;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={homeForRole(user.role)} replace />;
}

function PracticeHome() {
  const { user } = useAuth();
  const permissions = new Set(user?.permissions || []);
  if (permissions.has("accounting.manage")) return <Navigate to="/admin/accounting" replace />;
  if (permissions.has("clients.manage")) return <AdminClients />;
  if (permissions.has("submitted_items.manage")) return <Navigate to="/admin/submissions" replace />;
  if (permissions.has("automation.manage")) return <Navigate to="/admin/automation" replace />;
  if (permissions.has("practice_settings.manage") || permissions.has("practice_members.manage")) return <Navigate to="/admin/practice" replace />;
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
      <h1 className="font-display text-2xl font-bold text-stone-900">No operational permissions assigned</h1>
      <p className="mt-2 text-stone-600">Ask a practice administrator to assign access to the areas you need.</p>
    </div>
  );
}

function BrowserBranding() {
  useEffect(() => {
    document.title = "EPOS Accountancy";
    let icon = document.querySelector("link[rel~='icon']");
    if (!icon) {
      icon = document.createElement("link");
      icon.rel = "icon";
      document.head.appendChild(icon);
    }
    icon.type = "image/png";
    icon.href = eposLogo;
  }, []);

  return null;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <BrowserBranding />
        <Toaster position="top-center" richColors />
        <Routes>
          <Route path="/" element={<Root />} />
          <Route path="/login" element={<Login />} />

          <Route path="/platform" element={<Protected role="platform_admin"><PlatformLayout /></Protected>}>
            <Route index element={<PlatformPractices />} />
            <Route path="integrations" element={<AdminIntegrations />} />
            <Route path="integration-hub" element={<AdminIntegrationHub />} />
            <Route path="health" element={<AdminPlatform />} />
            <Route path="settings" element={<AdminSettings />} />
          </Route>

          <Route path="/admin" element={<Protected roles={practiceRoles}><AdminLayout /></Protected>}>
            <Route index element={<PracticeHome />} />
            <Route path="clients/:id" element={<AdminClientDetail />} />
            <Route path="submissions" element={<AdminSubmissions />} />
            <Route path="integrations" element={<Navigate to="/admin" replace />} />
            <Route path="accounting" element={<AdminAccountancySoftware />} />
            <Route path="accountancy" element={<AdminAccountancySettings />} />
            <Route path="automation" element={<AdminAutomation />} />
            <Route path="practice" element={<AdminPractice />} />
            <Route path="payroll" element={<React.Suspense fallback={null}><AdminPayroll /></React.Suspense>} />
            <Route path="payroll/:clientId" element={<React.Suspense fallback={null}><AdminPayroll /></React.Suspense>} />
          </Route>

          <Route path="/portal" element={<Protected role="client"><ClientLayout /></Protected>}>
            <Route index element={<ClientDashboard />} />
            <Route path="list/:type" element={<ClientList />} />
            <Route path="submit-additional/:type" element={<ClientSubmitAdditional />} />
            <Route path="submit/:itemId" element={<ClientSubmit />} />
          </Route>

          <Route path="*" element={<Root />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
