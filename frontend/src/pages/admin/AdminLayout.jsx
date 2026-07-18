import React, { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { EposLogo } from "@/components/Brand";
import { Users, FileText, Settings, LogOut, PlugZap, ClipboardList, Landmark } from "lucide-react";
import { Button } from "@/components/ui/button";

const linkBase =
  "admin-nav-link flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors";

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
    <div className="app-shell-bg min-h-screen flex flex-col md:flex-row text-[14px]" data-testid="admin-shell">
      <aside className="admin-sidebar md:w-52 md:min-h-screen border-b md:border-b-0 md:border-r border-stone-200">
        <div className="admin-brand-panel px-3 py-3 flex items-center gap-2.5">
          <EposLogo size={34} />
          <div>
            <div className="font-display text-sm font-bold text-stone-900 leading-tight">EPOS Accountancy</div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-stone-500 font-semibold">Practice Admin</div>
          </div>
        </div>

        <nav className="px-2 pt-1 pb-4 space-y-1">
          <NavLink end to="/admin" data-testid="nav-clients"
            className={({isActive}) => `${linkBase} ${isActive ? "admin-nav-link-active" : "text-stone-600 hover:bg-white/80 hover:text-stone-900"}`}>
            <Users className="h-4 w-4" /> Client settings
          </NavLink>
          {features.document_processing_enabled && (
            <NavLink to="/admin/submissions" data-testid="nav-submissions"
              className={({isActive}) => `${linkBase} ${isActive ? "admin-nav-link-active" : "text-stone-600 hover:bg-white/80 hover:text-stone-900"}`}>
              <FileText className="h-4 w-4" /> Submitted items
            </NavLink>
          )}
          <NavLink to="/admin/integrations" data-testid="nav-integrations"
            className={({isActive}) => `${linkBase} ${isActive ? "admin-nav-link-active" : "text-stone-600 hover:bg-white/80 hover:text-stone-900"}`}>
            <PlugZap className="h-4 w-4" /> Global integrations
          </NavLink>
          <NavLink to="/admin/accounting" data-testid="nav-accounting"
            className={({isActive}) => `${linkBase} ${isActive ? "admin-nav-link-active" : "text-stone-600 hover:bg-white/80 hover:text-stone-900"}`}>
            <Landmark className="h-4 w-4" /> Accountancy software
          </NavLink>
          <NavLink to="/admin/accountancy" data-testid="nav-accountancy"
            className={({isActive}) => `${linkBase} ${isActive ? "admin-nav-link-active" : "text-stone-600 hover:bg-white/80 hover:text-stone-900"}`}>
            <ClipboardList className="h-4 w-4" /> Accountancy settings
          </NavLink>
          <NavLink to="/admin/settings" data-testid="nav-settings"
            className={({isActive}) => `${linkBase} ${isActive ? "admin-nav-link-active" : "text-stone-600 hover:bg-white/80 hover:text-stone-900"}`}>
            <Settings className="h-4 w-4" /> SMTP Settings
          </NavLink>
        </nav>

        <div className="px-3 pb-3 mt-auto md:absolute md:bottom-3 md:w-52">
          <Button variant="outline" onClick={onLogout} className="h-8 w-full justify-start gap-2" data-testid="logout-btn">
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        </div>
      </aside>

      <main className="admin-main flex-1 p-2 sm:p-3 max-w-none w-full fade-up overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
