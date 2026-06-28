import React from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Users, FileText, Settings, LogOut, FileCheck2 } from "lucide-react";
import { Button } from "@/components/ui/button";

const linkBase =
  "flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors";

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();

  async function onLogout() {
    await logout();
    nav("/login", { replace: true });
  }

  return (
    <div className="min-h-screen flex flex-col md:flex-row" data-testid="admin-shell">
      <aside className="md:w-64 md:min-h-screen border-b md:border-b-0 md:border-r border-stone-200 bg-white">
        <div className="px-6 py-6 flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-[var(--brand)] flex items-center justify-center">
            <FileCheck2 className="h-5 w-5 text-white" />
          </div>
          <div>
            <div className="font-display font-bold text-stone-900 leading-tight">Practice Admin</div>
            <div className="text-xs text-stone-500">{user?.email}</div>
          </div>
        </div>

        <nav className="px-3 pt-2 pb-6 space-y-1">
          <NavLink end to="/admin" data-testid="nav-clients"
            className={({isActive}) => `${linkBase} ${isActive ? "bg-stone-100 text-stone-900" : "text-stone-600 hover:bg-stone-50"}`}>
            <Users className="h-4 w-4" /> Clients
          </NavLink>
          <NavLink to="/admin/submissions" data-testid="nav-submissions"
            className={({isActive}) => `${linkBase} ${isActive ? "bg-stone-100 text-stone-900" : "text-stone-600 hover:bg-stone-50"}`}>
            <FileText className="h-4 w-4" /> Submissions
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

      <main className="flex-1 p-6 sm:p-10 max-w-7xl w-full mx-auto fade-up">
        <Outlet />
      </main>
    </div>
  );
}
