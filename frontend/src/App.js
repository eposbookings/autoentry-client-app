import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import Login from "@/pages/Login";
import AdminLayout from "@/pages/admin/AdminLayout";
import AdminClients from "@/pages/admin/AdminClients";
import AdminClientDetail from "@/pages/admin/AdminClientDetail";
import AdminSubmissions from "@/pages/admin/AdminSubmissions";
import AdminSettings from "@/pages/admin/AdminSettings";
import ClientLayout from "@/pages/client/ClientLayout";
import ClientDashboard from "@/pages/client/ClientDashboard";
import ClientList from "@/pages/client/ClientList";
import ClientSubmit from "@/pages/client/ClientSubmit";

function Protected({ role, children }) {
  const { user } = useAuth();
  if (user === null) {
    return (
      <div className="min-h-screen flex items-center justify-center" data-testid="auth-loading">
        <div className="text-stone-500 font-display">Loading…</div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (role && user.role !== role) {
    return <Navigate to={user.role === "admin" ? "/admin" : "/portal"} replace />;
  }
  return children;
}

function Root() {
  const { user } = useAuth();
  if (user === null) return null;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.role === "admin" ? "/admin" : "/portal"} replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Toaster position="top-center" richColors />
        <Routes>
          <Route path="/" element={<Root />} />
          <Route path="/login" element={<Login />} />

          <Route path="/admin" element={<Protected role="admin"><AdminLayout /></Protected>}>
            <Route index element={<AdminClients />} />
            <Route path="clients/:id" element={<AdminClientDetail />} />
            <Route path="submissions" element={<AdminSubmissions />} />
            <Route path="settings" element={<AdminSettings />} />
          </Route>

          <Route path="/portal" element={<Protected role="client"><ClientLayout /></Protected>}>
            <Route index element={<ClientDashboard />} />
            <Route path="list/:type" element={<ClientList />} />
            <Route path="submit/:itemId" element={<ClientSubmit />} />
          </Route>

          <Route path="*" element={<Root />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
