import React, { useCallback, useEffect, useMemo, useState } from "react";
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
    email: "", autoentry_email: "", sales_autoentry_email: "", password: "", status: "active", is_vat_client: false, ai_analysis_enabled: false,
  });

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/clients", { params: q ? { q } : {} });
      setClients(data);
    } catch (e) {
      toast.error(formatApiError(e));
    }
  }, [q]);
  useEffect(() => { load(); }, [load]);

  async function onCreate(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/admin/clients", {
        ...form,
        sales_autoentry_email: form.sales_autoentry_email || null,
      });
      toast.success("Client created");
      setOpen(false);
      setForm({ first_name: "", last_name: "", business_name: "", email: "", autoentry_email: "", sales_autoentry_email: "", password: "", status: "active", is_vat_client: false, ai_analysis_enabled: false });
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
    <div className="space-y-4">
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-stone-900">Client settings</h1>
          <p className="text-sm text-stone-600">
            {clients.length} {clients.length === 1 ? "client" : "clients"} · {totalOutstanding} outstanding items total
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="h-9 gap-2" style={{ background: "var(--brand)" }} data-testid="add-client-btn">
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
              <Field label="Purchase AutoEntry email" id="autoentry_email" type="email" value={form.autoentry_email} onChange={(v)=>setForm({...form, autoentry_email: v})} testid="client-autoentry-email" />
              <Field label="Sales AutoEntry email (optional)" id="sales_autoentry_email" type="email" value={form.sales_autoentry_email} onChange={(v)=>setForm({...form, sales_autoentry_email: v})} required={false} testid="client-sales-autoentry-email" />
              <Field label="Initial password" id="password" type="password" value={form.password} onChange={(v)=>setForm({...form, password: v})} testid="client-password" />
              <label className="flex items-start gap-3 rounded-xl border border-stone-200 bg-stone-50/60 p-3 text-sm">
                <input
                  type="checkbox"
                  checked={form.is_vat_client}
                  onChange={(e) => setForm({ ...form, is_vat_client: e.target.checked })}
                  className="mt-1 h-4 w-4"
                  data-testid="client-vat-client"
                />
                <span>
                  <span className="font-semibold text-stone-800">VAT client</span>
                  <span className="block text-stone-500">Ask the document check to look for VAT invoice details.</span>
                </span>
              </label>
              <label className="flex items-start gap-3 rounded-xl border border-stone-200 bg-stone-50/60 p-3 text-sm">
                <input
                  type="checkbox"
                  checked={form.ai_analysis_enabled}
                  onChange={(e) => setForm({ ...form, ai_analysis_enabled: e.target.checked })}
                  className="mt-1 h-4 w-4"
                  data-testid="client-ai-analysis"
                />
                <span>
                  <span className="font-semibold text-stone-800">AI analysis</span>
                  <span className="block text-stone-500">Run invoice photos through AI review before emailing.</span>
                </span>
              </label>
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
          className="h-9 pl-10"
          data-testid="client-search"
        />
      </div>

      {clients.length === 0 ? (
        <div className="border border-dashed border-stone-300 rounded-md bg-white p-10 text-center" data-testid="empty-clients">
          <p className="font-display text-xl text-stone-700">No clients yet</p>
          <p className="text-sm text-stone-500 mt-2">Add your first client to start uploading their outstanding invoices.</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3">
          {clients.map((c) => (
            <button
              key={c._id}
              onClick={() => nav(`/admin/clients/${c._id}`)}
              className="text-left bg-white border border-stone-200 rounded-md p-4 card-hover"
              data-testid={`client-card-${c._id}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-display font-semibold text-base text-stone-900 leading-tight">{c.business_name}</div>
                  <div className="text-sm text-stone-500">{c.first_name} {c.last_name}</div>
                </div>
                <Badge variant={c.status === "active" ? "default" : "secondary"} className={c.status === "active" ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-100" : ""}>
                  {c.status}
                </Badge>
              </div>
              {c.is_vat_client && (
                <Badge className="mt-3 bg-sky-100 text-sky-800 hover:bg-sky-100">VAT client</Badge>
              )}
              {c.ai_analysis_enabled && (
                <Badge className="mt-3 ml-2 bg-violet-100 text-violet-800 hover:bg-violet-100">AI analysis</Badge>
              )}
              <div className="mt-4 grid grid-cols-2 gap-2">
                <Stat label="Purchase" value={c.purchase_outstanding} />
                <Stat label="Sales" value={c.sales_outstanding} />
              </div>
              <div className="mt-4 flex items-center justify-between text-sm">
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

function Field({ label, id, value, onChange, type = "text", required = true, testid }) {
  return (
    <div>
      <Label htmlFor={id} className="text-sm font-semibold text-stone-700">{label}</Label>
      <Input id={id} type={type} required={required} value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 h-9" data-testid={testid} />
    </div>
  );
}

function Stat({ label, value }) {
  const empty = !value;
  return (
    <div className={`rounded-md px-3 py-2 border ${empty ? "bg-stone-50 border-stone-200" : "border-amber-200"}`}
      style={!empty ? { background: "var(--outstanding-bg)" } : undefined}>
      <div className="text-[11px] uppercase tracking-wider font-semibold text-stone-500">{label}</div>
      <div className={`font-display text-xl font-bold ${empty ? "text-stone-400" : ""}`}
        style={!empty ? { color: "var(--outstanding)" } : undefined}>{value || 0}</div>
    </div>
  );
}
