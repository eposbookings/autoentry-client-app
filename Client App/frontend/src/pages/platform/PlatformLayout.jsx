import React, { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { Building2, LogOut, PlugZap, ServerCog, Settings, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { EposLogo } from "@/components/Brand";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";

const linkBase = "admin-nav-link flex items-center gap-2.5 whitespace-nowrap rounded-md text-sm font-medium transition-colors";

export default function PlatformLayout() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(() => window.localStorage.getItem("platform-sidebar-collapsed") === "true");
  const labelClass = collapsed ? "hidden" : "";
  const layoutClass = collapsed ? "justify-center px-0 py-2" : "px-3 py-2";
  const linkClass = (active) => `${linkBase} ${layoutClass} ${active ? "admin-nav-link-active" : "text-stone-600 hover:bg-white/80 hover:text-stone-900"}`;

  function toggle() {
    setCollapsed((value) => {
      window.localStorage.setItem("platform-sidebar-collapsed", String(!value));
      return !value;
    });
  }

  async function signOut() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="app-shell-bg flex h-screen overflow-hidden text-[14px]" data-testid="platform-shell">
      <aside className={`admin-sidebar flex h-screen shrink-0 flex-col overflow-hidden border-r border-stone-200 transition-[width] ${collapsed ? "w-16" : "w-56"}`}>
        <div className={`admin-brand-panel flex shrink-0 items-center gap-2.5 px-3 py-3 ${collapsed ? "justify-center px-2" : ""}`}>
          {!collapsed && <EposLogo size={34} />}
          {!collapsed && (
            <div className="min-w-0">
              <div className="font-display text-sm font-bold leading-tight text-stone-900">EPOS Accountancy</div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500">Platform Admin</div>
            </div>
          )}
          <Button type="button" variant="ghost" size="icon" onClick={toggle} className={`hidden h-8 w-8 md:inline-flex ${collapsed ? "" : "ml-auto"}`}>
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </Button>
        </div>

        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-4 pt-1">
          <NavLink end to="/platform" className={({ isActive }) => linkClass(isActive)} title="Accountancy practices">
            <Building2 className="h-4 w-4 shrink-0" /><span className={labelClass}>Practices</span>
          </NavLink>
          <NavLink to="/platform/integrations" className={({ isActive }) => linkClass(isActive)} title="Global integrations">
            <PlugZap className="h-4 w-4 shrink-0" /><span className={labelClass}>Global integrations</span>
          </NavLink>
          <NavLink to="/platform/integration-hub" className={({ isActive }) => linkClass(isActive)} title="Integration hub">
            <ServerCog className="h-4 w-4 shrink-0" /><span className={labelClass}>Integration hub</span>
          </NavLink>
          <NavLink to="/platform/health" className={({ isActive }) => linkClass(isActive)} title="Platform health">
            <ServerCog className="h-4 w-4 shrink-0" /><span className={labelClass}>Platform health</span>
          </NavLink>
          <NavLink to="/platform/settings" className={({ isActive }) => linkClass(isActive)} title="Platform settings">
            <Settings className="h-4 w-4 shrink-0" /><span className={labelClass}>Platform settings</span>
          </NavLink>
        </nav>

        <div className="mt-auto shrink-0 px-3 pb-3">
          <Button variant="outline" onClick={signOut} className={`h-8 w-full gap-2 ${collapsed ? "justify-center px-0" : "justify-start"}`}>
            <LogOut className="h-4 w-4 shrink-0" /> {!collapsed && "Sign out"}
          </Button>
        </div>
      </aside>
      <main className="admin-main h-screen min-w-0 flex-1 overflow-y-auto p-2 sm:p-3">
        <Outlet />
      </main>
    </div>
  );
}
