import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FileCheck2 } from "lucide-react";

export default function Login() {
  const { login, error } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const user = await login(email.trim(), password);
      nav(user.role === "admin" ? "/admin" : "/portal", { replace: true });
    } catch (_) {
      // error already set by context
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen grid md:grid-cols-2">
      <div className="hidden md:block paper-bg relative">
        <div
          className="absolute inset-0 bg-cover bg-center opacity-90 mix-blend-multiply"
          style={{ backgroundImage: "url(https://images.pexels.com/photos/7599590/pexels-photo-7599590.jpeg)" }}
        />
        <div className="absolute inset-0 bg-gradient-to-tr from-stone-900/30 via-stone-900/10 to-transparent" />
        <div className="relative z-10 flex flex-col justify-between h-full p-12 text-white">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-white/95 flex items-center justify-center">
              <FileCheck2 className="h-6 w-6" style={{ color: "var(--brand)" }} />
            </div>
            <div className="font-display font-bold text-2xl tracking-tight">Outstanding Documents</div>
          </div>
          <div className="space-y-4 max-w-md">
            <h2 className="font-display text-4xl font-bold leading-tight">
              Finish your bookkeeping in minutes — not weekends.
            </h2>
            <p className="text-white/85 text-base leading-relaxed">
              See every outstanding invoice. Submit a photo or a quick note.
              It goes straight to your accountant's AutoEntry inbox.
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center p-6 sm:p-12 bg-[var(--bg)]">
        <div className="w-full max-w-md fade-up">
          <div className="mb-10 md:hidden flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-[var(--brand)] flex items-center justify-center">
              <FileCheck2 className="h-6 w-6 text-white" />
            </div>
            <div className="font-display font-bold text-xl">Outstanding Documents</div>
          </div>
          <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight text-stone-900">
            Welcome back
          </h1>
          <p className="mt-3 text-stone-600 text-base">
            Sign in to view and submit your outstanding documents.
          </p>

          <form onSubmit={onSubmit} className="mt-10 space-y-5" data-testid="login-form">
            <div>
              <Label htmlFor="email" className="text-sm font-semibold text-stone-700">Email address</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@business.com"
                className="mt-2 h-12 text-base"
                data-testid="login-email-input"
              />
            </div>
            <div>
              <Label htmlFor="password" className="text-sm font-semibold text-stone-700">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="mt-2 h-12 text-base"
                data-testid="login-password-input"
              />
            </div>

            {error && (
              <div
                className="rounded-lg px-4 py-3 text-sm border"
                style={{ background: "var(--error-bg)", color: "var(--error)", borderColor: "#fecaca" }}
                data-testid="login-error"
              >
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={busy}
              className="w-full h-12 text-base font-semibold rounded-xl"
              style={{ background: "var(--brand)" }}
              data-testid="login-submit-btn"
            >
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          <p className="mt-8 text-xs text-stone-500">
            Need access? Contact your accountant — they will issue your credentials.
          </p>
        </div>
      </div>
    </div>
  );
}
