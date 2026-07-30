import React, { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { EposLogo } from "@/components/Brand";
import { Users, FileText, Settings, LogOut, ClipboardList, Workflow, PanelLeftClose, PanelLeftOpen } from "lucide-react";
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
  const permissions = new Set(user?.permissions || []);
  const can = (permission) => permissions.has(permission);

  return (
    <div className="app-shell-bg flex h-screen overflow-hidden text-[14px]" data-testid="admin-shell">
      <aside className={`admin-sidebar flex h-screen shrink-0 flex-col overflow-hidden border-r border-stone-200 transition-[width] ${sidebarCollapsed ? "w-16" : "w-52"}`}>
        <div className={`admin-brand-panel flex shrink-0 items-center gap-2.5 px-3 py-3 ${sidebarCollapsed ? "justify-center px-2" : ""}`}>
          {!sidebarCollapsed && <EposLogo size={34} />}
          {!sidebarCollapsed && <div className="min-w-0">
            <div className="truncate font-display text-sm font-bold text-stone-900 leading-tight">{user?.practice_name || "EPOS Accountancy"}</div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-stone-500 font-semibold">Accountancy Practice</div>
          </div>}
          <Button type="button" variant="ghost" size="icon" onClick={toggleSidebar} className={`hidden h-8 w-8 md:inline-flex ${sidebarCollapsed ? "" : "ml-auto"}`} aria-label={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"} title={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"}>
            {sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </Button>
        </div>

        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-4 pt-1">
          {can("submitted_items.manage") && features.document_processing_enabled && (
            <NavLink to="/admin/submissions" data-testid="nav-submissions"
              title="Submitted items"
              className={({isActive}) => navLinkClass(isActive)}>
              <FileText className="h-4 w-4 shrink-0" /> <span className={navLabelClass}>Submitted items</span>
            </NavLink>
          )}
          {(can("accounting.manage") || can("clients.manage")) && <NavLink to={can("accounting.manage") ? "/admin/accounting" : "/admin"} data-testid="nav-accounting"
            title="Clients"
            className={({isActive}) => navLinkClass(isActive)}>
            <Users className="h-4 w-4 shrink-0" /> <span className={navLabelClass}>Clients</span>
          </NavLink>}
          {can("practice_settings.manage") && <NavLink to="/admin/accountancy" data-testid="nav-accountancy"
            title="Accountancy settings"
            className={({isActive}) => navLinkClass(isActive)}>
            <ClipboardList className="h-4 w-4 shrink-0" /> <span className={navLabelClass}>Accountancy settings</span>
          </NavLink>}
          {can("automation.manage") && <NavLink to="/admin/automation" data-testid="nav-automation"
            title="Automation"
            className={({isActive}) => navLinkClass(isActive)}>
            <Workflow className="h-4 w-4 shrink-0" /> <span className={navLabelClass}>Automation</span>
          </NavLink>}
          {(can("practice_settings.manage") || can("practice_members.manage")) && <NavLink to="/admin/practice" data-testid="nav-practice"
            title="Practice profile and users"
            className={({isActive}) => navLinkClass(isActive)}>
            <Settings className="h-4 w-4 shrink-0" /> <span className={navLabelClass}>Practice settings</span>
          </NavLink>}
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
