import React, { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { EposLogo } from "@/components/Brand";
import { Users, FileText, Settings, LogOut, PlugZap } from "lucide-react";
import { Button } from "@/components/ui/button";

const linkBase =
  "flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors";

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [features, setFeatures] = useState({ document_processing_enabled: true });

  useEffect(() => {
    const loadFeatures = () => api.get("/admin/settings/features")
      .then(({ data }) => setFeatures({ document_processing_enabled: data.document_processing_enabled !== false }))
      .catch(() => setFeatures({ document_processing_enabled: true }));
    loadFeatures();
    window.addEventListener("feature-settings-updated", loadFeatures);
    return () => window.removeEventListener("feature-settings-updated", loadFeatures);
  }, []);

  async function onLogout() {
    await logout();
    nav("/login", { replace: true });
  }

  return (
    <div className="min-h-screen flex flex-col md:flex-row" data-testid="admin-shell">
      <aside className="md:w-64 md:min-h-screen border-b md:border-b-0 md:border-r border-stone-200 bg-white">
        <div className="px-6 py-6 flex items-center gap-3">
          <EposLogo size={42} />
          <div>
            <div className="font-display font-bold text-stone-900 leading-tight">EPOS Accountancy</div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-stone-500 font-semibold">Practice Admin</div>
          </div>
        </div>

        <nav className="px-3 pt-2 pb-6 space-y-1">
          <NavLink end to="/admin" data-testid="nav-clients"
            className={({isActive}) => `${linkBase} ${isActive ? "bg-stone-100 text-stone-900" : "text-stone-600 hover:bg-stone-50"}`}>
            <Users className="h-4 w-4" /> Client settings
          </NavLink>
          {features.document_processing_enabled && (
            <NavLink to="/admin/submissions" data-testid="nav-submissions"
              className={({isActive}) => `${linkBase} ${isActive ? "bg-stone-100 text-stone-900" : "text-stone-600 hover:bg-stone-50"}`}>
              <FileText className="h-4 w-4" /> Submitted items
            </NavLink>
          )}
          <NavLink to="/admin/integrations" data-testid="nav-integrations"
            className={({isActive}) => `${linkBase} ${isActive ? "bg-stone-100 text-stone-900" : "text-stone-600 hover:bg-stone-50"}`}>
            <PlugZap className="h-4 w-4" /> Client integrations
          </NavLink>
          <NavLink to="/admin/settings" data-testid="nav-settings"
            className={({isActive}) => `${linkBase} ${isActive ? "bg-stone-100 text-stone-900" : "text-stone-600 hover:bg-stone-50"}`}>
            <Settings className="h-4 w-4" /> SMTP Settings
          </NavLink>
        </nav>

        <div className="px-4 pb-6 mt-auto md:absolute md:bottom-4 md:w-60">
          <Button variant="outline" onClick={onLogout} className="w-full justify-start gap-2" data-testid="logout-btn">
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        </div>
      </aside>

      <main className="flex-1 p-4 sm:p-6 max-w-none w-full fade-up overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
