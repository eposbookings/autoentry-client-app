import React, { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { EposLogo } from "@/components/Brand";
import { Users, FileText, Settings, LogOut, PlugZap, ClipboardList, Landmark, Workflow, ServerCog, ShieldCheck, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Button } from "@/components/ui/button";

const linkBase =
  "admin-nav-link flex items-center gap-2.5 whitespace-nowrap rounded-md text-sm font-medium transition-colors";

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [features, setFeatures] = useState({ document_processing_enabled: true });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.localStorage.getItem("admin-sidebar-collapsed") === "true");

  function toggleSidebar() {
    setSidebarCollapsed((current) => {
      window.localStorage.setItem("admin-sidebar-collapsed", String(!current));
      return !current;
    });
  }

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

  const navLabelClass = sidebarCollapsed ? "hidden" : "";
  const navLinkLayoutClass = sidebarCollapsed ? "justify-center px-0 py-2" : "px-3 py-2";
  const navLinkClass = (isActive) => `${linkBase} ${navLinkLayoutClass} ${isActive ? "admin-nav-link-active" : "text-stone-600 hover:bg-white/80 hover:text-stone-900"}`;

  return (
    <div className="app-shell-bg flex h-screen overflow-hidden text-[14px]" data-testid="admin-shell">
      <aside className={`admin-sidebar flex h-screen shrink-0 flex-col overflow-hidden border-r border-stone-200 transition-[width] ${sidebarCollapsed ? "w-16" : "w-52"}`}>
        <div className={`admin-brand-panel flex shrink-0 items-center gap-2.5 px-3 py-3 ${sidebarCollapsed ? "justify-center px-2" : ""}`}>
          {!sidebarCollapsed && <EposLogo size={34} />}
          {!sidebarCollapsed && <div className="min-w-0">
            <div className="font-display text-sm font-bold text-stone-900 leading-tight">EPOS Accountancy</div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-stone-500 font-semibold">Practice Admin</div>
          </div>}
          <Button type="button" variant="ghost" size="icon" onClick={toggleSidebar} className={`hidden h-8 w-8 md:inline-flex ${sidebarCollapsed ? "" : "ml-auto"}`} aria-label={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"} title={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"}>
            {sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </Button>
        </div>

        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-4 pt-1">
          <NavLink end to="/admin" data-testid="nav-clients"
            title="Client settings"
            className={({isActive}) => navLinkClass(isActive)}>
            <Users className="h-4 w-4 shrink-0" /> <span className={navLabelClass}>Client settings</span>
          </NavLink>
          {features.document_processing_enabled && (
            <NavLink to="/admin/submissions" data-testid="nav-submissions"
              title="Submitted items"
              className={({isActive}) => navLinkClass(isActive)}>
              <FileText className="h-4 w-4 shrink-0" /> <span className={navLabelClass}>Submitted items</span>
            </NavLink>
          )}
          <NavLink to="/admin/integrations" data-testid="nav-integrations"
            title="Global integrations"
            className={({isActive}) => navLinkClass(isActive)}>
            <PlugZap className="h-4 w-4 shrink-0" /> <span className={navLabelClass}>Global integrations</span>
          </NavLink>
          <NavLink to="/admin/accounting" data-testid="nav-accounting"
            title="Accountancy software"
            className={({isActive}) => navLinkClass(isActive)}>
            <Landmark className="h-4 w-4 shrink-0" /> <span className={navLabelClass}>Accountancy software</span>
          </NavLink>
          <NavLink to="/admin/accountancy" data-testid="nav-accountancy"
            title="Accountancy settings"
            className={({isActive}) => navLinkClass(isActive)}>
            <ClipboardList className="h-4 w-4 shrink-0" /> <span className={navLabelClass}>Accountancy settings</span>
          </NavLink>
          <NavLink to="/admin/automation" data-testid="nav-automation"
            title="Automation"
            className={({isActive}) => navLinkClass(isActive)}>
            <Workflow className="h-4 w-4 shrink-0" /> <span className={navLabelClass}>Automation</span>
          </NavLink>
          <NavLink to="/admin/integration-hub" data-testid="nav-integration-hub"
            title="Integration Hub"
            className={({isActive}) => navLinkClass(isActive)}>
            <ServerCog className="h-4 w-4 shrink-0" /> <span className={navLabelClass}>Integration Hub</span>
          </NavLink>
          <NavLink to="/admin/platform" data-testid="nav-platform"
            title="Platform"
            className={({isActive}) => navLinkClass(isActive)}>
            <ShieldCheck className="h-4 w-4 shrink-0" /> <span className={navLabelClass}>Platform</span>
          </NavLink>
          <NavLink to="/admin/settings" data-testid="nav-settings"
            title="SMTP Settings"
            className={({isActive}) => navLinkClass(isActive)}>
            <Settings className="h-4 w-4 shrink-0" /> <span className={navLabelClass}>SMTP Settings</span>
          </NavLink>
        </nav>

        <div className="mt-auto shrink-0 px-3 pb-3">
          <Button variant="outline" onClick={onLogout} className={`h-8 w-full gap-2 ${sidebarCollapsed ? "justify-center px-0" : "justify-start"}`} data-testid="logout-btn" title="Sign out">
            <LogOut className="h-4 w-4 shrink-0" /> {!sidebarCollapsed && "Sign out"}
          </Button>
        </div>
      </aside>

      <main className="admin-main h-screen min-w-0 flex-1 overflow-y-auto p-2 sm:p-3 max-w-none w-full fade-up">
        <Outlet />
      </main>
    </div>
  );
}
