import React from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { FileCheck2, LogOut } from "lucide-react";

export default function ClientLayout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();

  async function onLogout() {
    await logout();
    nav("/login", { replace: true });
  }

  return (
    <div className="min-h-screen flex flex-col" data-testid="client-shell">
      <header className="border-b border-stone-200 bg-white">
        <div className="max-w-3xl mx-auto px-5 py-4 flex items-center justify-between">
          <button onClick={() => nav("/portal")} className="flex items-center gap-2.5" data-testid="brand-link">
            <div className="h-9 w-9 rounded-xl bg-[var(--brand)] flex items-center justify-center">
              <FileCheck2 className="h-5 w-5 text-white" />
            </div>
            <div className="text-left">
              <div className="font-display font-bold leading-tight text-stone-900">{user?.business_name}</div>
              <div className="text-[11px] uppercase tracking-wider text-stone-500">Documents portal</div>
            </div>
          </button>
          <Button variant="ghost" onClick={onLogout} className="gap-2" data-testid="logout-btn">
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        </div>
      </header>
      <main className="flex-1 px-5 py-8 max-w-3xl w-full mx-auto fade-up">
        <Outlet />
      </main>
    </div>
  );
}
