import React from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { EposLogo, EposWordmark } from "@/components/Brand";
import { LogOut } from "lucide-react";

export default function ClientLayout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();

  async function onLogout() {
    await logout();
    nav("/login", { replace: true });
  }

  return (
    <div className="app-shell-bg min-h-screen flex flex-col" data-testid="client-shell">
      <header className="client-topbar border-b border-stone-200">
        <div className="max-w-3xl mx-auto px-5 py-4 flex items-center justify-between">
          <button onClick={() => nav("/portal")} className="flex items-center gap-2.5" data-testid="brand-link">
            <EposLogo size={40} />
            <div className="text-left leading-tight">
              <div className="font-display font-bold text-stone-900">{user?.business_name}</div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-stone-500 font-semibold">EPOS Accountancy · Portal</div>
            </div>
          </button>
          <Button variant="ghost" onClick={onLogout} className="gap-2" data-testid="logout-btn">
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        </div>
      </header>
      <main className="client-main flex-1 px-5 py-8 max-w-3xl w-full mx-auto fade-up">
        <Outlet />
      </main>
    </div>
  );
}
