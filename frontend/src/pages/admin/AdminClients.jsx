import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, ArrowRight } from "lucide-react";
import { toast } from "sonner";

export default function AdminClients() {
  const [clients, setClients] = useState([]);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  const [form, setForm] = useState({
    first_name: "", last_name: "", business_name: "",
    email: "", autoentry_email: "", password: "", status: "active",
  });

  async function load() {
    try {
      const { data } = await api.get("/admin/clients", { params: q ? { q } : {} });
      setClients(data);
    } catch (e) {
      toast.error(formatApiError(e));
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [q]);

  async function onCreate(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/admin/clients", form);
      toast.success("Client created");
      setOpen(false);
      setForm({ first_name: "", last_name: "", business_name: "", email: "", autoentry_email: "", password: "", status: "active" });
      load();
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setBusy(false);
    }
  }

  const totalOutstanding = useMemo(
    () => clients.reduce((s, c) => s + (c.purchase_outstanding || 0) + (c.sales_outstanding || 0), 0),
    [clients]
  );

  return (
    <div className="space-y-8">
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-stone-900">Clients</h1>
          <p className="mt-1 text-stone-600">
            {clients.length} {clients.length === 1 ? "client" : "clients"} · {totalOutstanding} outstanding items total
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="h-11 px-5 rounded-xl gap-2" style={{ background: "var(--brand)" }} data-testid="add-client-btn">
              <Plus className="h-4 w-4" /> New client
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle className="font-display text-2xl">Create client account</DialogTitle>
            </DialogHeader>
            <form onSubmit={onCreate} className="space-y-4" data-testid="create-client-form">
              <div className="grid grid-cols-2 gap-3">
                <Field label="First name" id="first_name" value={form.first_name} onChange={(v)=>setForm({...form, first_name: v})} testid="client-first-name" />
                <Field label="Last name" id="last_name" value={form.last_name} onChange={(v)=>setForm({...form, last_name: v})} testid="client-last-name" />
              </div>
              <Field label="Business name" id="business_name" value={form.business_name} onChange={(v)=>setForm({...form, business_name: v})} testid="client-business-name" />
              <Field label="Login email" id="email" type="email" value={form.email} onChange={(v)=>setForm({...form, email: v})} testid="client-email" />
              <Field label="AutoEntry email (where submissions go)" id="autoentry_email" type="email" value={form.autoentry_email} onChange={(v)=>setForm({...form, autoentry_email: v})} testid="client-autoentry-email" />
              <Field label="Initial password" id="password" type="password" value={form.password} onChange={(v)=>setForm({...form, password: v})} testid="client-password" />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)} data-testid="cancel-create-btn">Cancel</Button>
                <Button type="submit" disabled={busy} style={{ background: "var(--brand)" }} data-testid="submit-create-btn">
                  {busy ? "Creating…" : "Create client"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </header>

      <div className="relative max-w-md">
        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
        <Input
          placeholder="Search by business, name or email"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="h-11 pl-10"
          data-testid="client-search"
        />
      </div>

      {clients.length === 0 ? (
        <div className="border border-dashed border-stone-300 rounded-2xl bg-white p-12 text-center" data-testid="empty-clients">
          <p className="font-display text-xl text-stone-700">No clients yet</p>
          <p className="text-sm text-stone-500 mt-2">Add your first client to start uploading their outstanding invoices.</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {clients.map((c) => (
            <button
              key={c._id}
              onClick={() => nav(`/admin/clients/${c._id}`)}
              className="text-left bg-white border border-stone-200 rounded-2xl p-6 card-hover"
              data-testid={`client-card-${c._id}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-display font-semibold text-lg text-stone-900 leading-tight">{c.business_name}</div>
                  <div className="text-sm text-stone-500">{c.first_name} {c.last_name}</div>
                </div>
                <Badge variant={c.status === "active" ? "default" : "secondary"} className={c.status === "active" ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-100" : ""}>
                  {c.status}
                </Badge>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-3">
                <Stat label="Purchase" value={c.purchase_outstanding} />
                <Stat label="Sales" value={c.sales_outstanding} />
              </div>
              <div className="mt-5 flex items-center justify-between text-sm">
                <span className="text-stone-500 truncate">{c.email}</span>
                <span className="inline-flex items-center gap-1 text-[var(--brand)] font-medium">Manage <ArrowRight className="h-3.5 w-3.5" /></span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, id, value, onChange, type = "text", testid }) {
  return (
    <div>
      <Label htmlFor={id} className="text-sm font-semibold text-stone-700">{label}</Label>
      <Input id={id} type={type} required value={value} onChange={(e) => onChange(e.target.value)} className="mt-1.5 h-11" data-testid={testid} />
    </div>
  );
}

function Stat({ label, value }) {
  const empty = !value;
  return (
    <div className={`rounded-xl px-3 py-2.5 border ${empty ? "bg-stone-50 border-stone-200" : "border-amber-200"}`}
      style={!empty ? { background: "var(--outstanding-bg)" } : undefined}>
      <div className="text-[11px] uppercase tracking-wider font-semibold text-stone-500">{label}</div>
      <div className={`font-display text-2xl font-bold ${empty ? "text-stone-400" : ""}`}
        style={!empty ? { color: "var(--outstanding)" } : undefined}>{value || 0}</div>
    </div>
  );
}
