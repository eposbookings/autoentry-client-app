import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, Plus, Search, Users } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const emptyForm = {
  name: "", email: "", phone: "", plan: "standard",
  admin_first_name: "", admin_last_name: "", admin_email: "", admin_password: "",
};

export default function PlatformPractices() {
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/platform/practices");
      setRows(Array.isArray(data) ? data : []);
    } catch (error) {
      toast.error(formatApiError(error));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => `${row.name} ${row.email || ""}`.toLowerCase().includes(needle));
  }, [query, rows]);

  async function createPractice(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await api.post("/platform/practices", form);
      toast.success("Practice account created");
      setForm(emptyForm);
      setShowCreate(false);
      await load();
    } catch (error) {
      toast.error(formatApiError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <header className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Platform administration</div>
            <h1 className="mt-1 font-display text-3xl font-bold text-stone-950">Accountancy practices</h1>
            <p className="mt-1 text-stone-600">Create practice tenants and their first administrator. Client data stays inside its assigned practice.</p>
          </div>
          <Button onClick={() => setShowCreate((value) => !value)} className="gap-2">
            <Plus className="h-4 w-4" /> Create practice
          </Button>
        </div>
      </header>

      {showCreate && (
        <form onSubmit={createPractice} className="rounded-xl border border-emerald-200 bg-white p-5 shadow-sm">
          <h2 className="font-display text-xl font-bold text-stone-900">New practice account</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div><Label>Practice name</Label><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label>Practice email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div><Label>Plan</Label><Input value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })} /></div>
            <div><Label>Admin first name</Label><Input required value={form.admin_first_name} onChange={(e) => setForm({ ...form, admin_first_name: e.target.value })} /></div>
            <div><Label>Admin last name</Label><Input required value={form.admin_last_name} onChange={(e) => setForm({ ...form, admin_last_name: e.target.value })} /></div>
            <div><Label>Admin email</Label><Input required type="email" value={form.admin_email} onChange={(e) => setForm({ ...form, admin_email: e.target.value })} /></div>
            <div><Label>Temporary password</Label><Input required minLength={8} type="password" value={form.admin_password} onChange={(e) => setForm({ ...form, admin_password: e.target.value })} /></div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "Creating…" : "Create practice account"}</Button>
          </div>
        </form>
      )}

      <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
        <div className="relative mb-4">
          <Search className="absolute left-3 top-3 h-4 w-4 text-stone-400" />
          <Input className="pl-9" placeholder="Search practices" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((practice) => (
            <article key={practice.id} className="rounded-xl border border-stone-200 bg-stone-50/70 p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 gap-3">
                  <div className="rounded-full bg-emerald-50 p-2 text-emerald-700"><Building2 className="h-5 w-5" /></div>
                  <div className="min-w-0">
                    <h2 className="truncate font-display text-lg font-bold text-stone-950">{practice.name}</h2>
                    <div className="truncate text-sm text-stone-500">{practice.email || "No practice email"}</div>
                  </div>
                </div>
                <span className={`rounded-full px-2 py-1 text-xs font-semibold ${practice.status === "active" ? "bg-emerald-100 text-emerald-800" : "bg-stone-200 text-stone-700"}`}>{practice.status}</span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 border-t border-stone-200 pt-3 text-sm">
                <div><div className="text-xs uppercase text-stone-500">Clients</div><div className="font-bold text-stone-900">{practice.client_count}</div></div>
                <div><div className="text-xs uppercase text-stone-500">Members</div><div className="flex items-center gap-1 font-bold text-stone-900"><Users className="h-3.5 w-3.5" />{practice.member_count}</div></div>
              </div>
            </article>
          ))}
        </div>
        {!filtered.length && <div className="py-10 text-center text-stone-500">No practice accounts found.</div>}
      </section>
    </div>
  );
}
