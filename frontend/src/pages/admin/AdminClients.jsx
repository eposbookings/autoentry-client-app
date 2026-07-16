import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Building2, Plus, Search, ArrowRight } from "lucide-react";
import { toast } from "sonner";

export default function AdminClients() {
  const [clients, setClients] = useState([]);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [companyQuery, setCompanyQuery] = useState("");
  const [companyResults, setCompanyResults] = useState([]);
  const [companyBusy, setCompanyBusy] = useState(false);
  const nav = useNavigate();

  const [form, setForm] = useState(emptyClientForm());

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
      setForm(emptyClientForm());
      setCompanyQuery("");
      setCompanyResults([]);
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

  async function searchCompaniesHouse() {
    if (!companyQuery.trim()) return;
    setCompanyBusy(true);
    try {
      const { data } = await api.get("/admin/companies-house/search", { params: { q: companyQuery.trim() } });
      setCompanyResults(data || []);
      if (!data?.length) toast.info("No Companies House matches found");
    } catch (e) {
      toast.error(formatApiError(e), { duration: 9000 });
    } finally {
      setCompanyBusy(false);
    }
  }

  async function importCompany(companyNumber) {
    setCompanyBusy(true);
    try {
      const { data } = await api.get(`/admin/companies-house/profile/${companyNumber}`);
      setForm((current) => mergeCompanyProfile(current, data));
      setCompanyResults([]);
      toast.success("Companies House details added");
    } catch (e) {
      toast.error(formatApiError(e), { duration: 9000 });
    } finally {
      setCompanyBusy(false);
    }
  }

  const contacts = parseStoredList(form.company_contacts);

  function selectContactAsMain(contact) {
    const names = splitPersonName(contact?.name);
    setForm((current) => ({
      ...current,
      first_name: names.first_name || current.first_name,
      last_name: names.last_name || current.last_name,
      main_contact_name: contact?.name || current.main_contact_name,
      main_contact_role: contact?.role || contact?.kind || current.main_contact_role,
    }));
  }

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
          <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
            <DialogHeader>
              <DialogTitle className="font-display text-2xl">Create client account</DialogTitle>
            </DialogHeader>
            <form onSubmit={onCreate} className="space-y-4" data-testid="create-client-form">
              <div className="rounded-md border border-stone-200 bg-stone-50/70 p-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-stone-900">
                  <Building2 className="h-4 w-4 text-[var(--brand)]" /> Companies House lookup
                </div>
                <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                  <Input value={companyQuery} onChange={(e) => setCompanyQuery(e.target.value)} placeholder="Search company name or number" className="h-9 bg-white" />
                  <Button type="button" variant="outline" onClick={searchCompaniesHouse} disabled={companyBusy} className="gap-2">
                    <Search className="h-4 w-4" /> Search
                  </Button>
                </div>
                {companyResults.length > 0 && (
                  <div className="mt-2 max-h-48 overflow-auto rounded-md border border-stone-200 bg-white">
                    {companyResults.map((company) => (
                      <button
                        key={company.company_number}
                        type="button"
                        onClick={() => importCompany(company.company_number)}
                        className="flex w-full items-start justify-between gap-3 border-b border-stone-100 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-stone-50"
                      >
                        <span>
                          <span className="block font-semibold text-stone-900">{company.title}</span>
                          <span className="block text-xs text-stone-500">{company.company_number} - {company.address || "No address shown"}</span>
                        </span>
                        <Badge variant="secondary">{company.company_status}</Badge>
                      </button>
                    ))}
                  </div>
                )}
                {form.company_number && (
                  <div className="mt-2 grid gap-2 text-xs sm:grid-cols-3">
                    <Summary label="Company no." value={form.company_number} />
                    <Summary label="Status" value={form.company_status} />
                    <Summary label="Incorporated" value={form.incorporation_date} />
                  </div>
                )}
                {contacts.length > 0 && (
                  <div className="mt-2">
                    <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-500">Choose main contact</div>
                    <div className="flex flex-wrap gap-2">
                      {contacts.slice(0, 10).map((contact, index) => (
                        <button
                          key={`${contact.name}-${index}`}
                          type="button"
                          onClick={() => selectContactAsMain(contact)}
                          className="rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-stone-700 hover:border-emerald-300 hover:bg-emerald-50"
                        >
                          {contact.name} <span className="font-normal text-stone-500">{contact.role || contact.kind}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="First name" id="first_name" value={form.first_name} onChange={(v)=>setForm({...form, first_name: v})} testid="client-first-name" />
                <Field label="Last name" id="last_name" value={form.last_name} onChange={(v)=>setForm({...form, last_name: v})} testid="client-last-name" />
              </div>
              <Field label="Business name" id="business_name" value={form.business_name} onChange={(v)=>setForm({...form, business_name: v})} testid="client-business-name" />
              <Field label="Login email" id="email" type="email" value={form.email} onChange={(v)=>setForm({...form, email: v})} testid="client-email" />
              <Field label="Purchase AutoEntry email" id="autoentry_email" type="email" value={form.autoentry_email} onChange={(v)=>setForm({...form, autoentry_email: v})} testid="client-autoentry-email" />
              <Field label="Sales AutoEntry email (optional)" id="sales_autoentry_email" type="email" value={form.sales_autoentry_email} onChange={(v)=>setForm({...form, sales_autoentry_email: v})} required={false} testid="client-sales-autoentry-email" />
              <Field label="Initial password" id="password" type="password" value={form.password} onChange={(v)=>setForm({...form, password: v})} testid="client-password" />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Company number" id="company_number" value={form.company_number} onChange={(v)=>setForm({...form, company_number: v})} required={false} />
                <Field label="Main contact role" id="main_contact_role" value={form.main_contact_role} onChange={(v)=>setForm({...form, main_contact_role: v})} required={false} />
              </div>
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

function Summary({ label, value }) {
  return (
    <div className="rounded-md border border-stone-200 bg-white px-2.5 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-stone-500">{label}</div>
      <div className="truncate text-sm font-semibold text-stone-900">{value || "-"}</div>
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

function emptyClientForm() {
  return {
    first_name: "",
    last_name: "",
    business_name: "",
    email: "",
    autoentry_email: "",
    sales_autoentry_email: "",
    password: "",
    status: "active",
    is_vat_client: false,
    ai_analysis_enabled: false,
    client_type: "",
    industry: "",
    company_number: "",
    company_status: "",
    incorporation_date: "",
    registered_office_address: "",
    trading_address: "",
    phone: "",
    utr: "",
    vat_number: "",
    paye_reference: "",
    accounts_office_reference: "",
    authorisation_codes: "",
    services_required: "",
    statutory_deadlines: "",
    bookkeeping_frequency: "",
    payroll_frequency: "",
    year_end: "",
    practice_manager: "",
    companies_house_last_checked: "",
    main_contact_name: "",
    main_contact_role: "",
    company_directors: "",
    company_pscs: "",
    company_contacts: "",
    companies_house_filings: "",
  };
}

function mergeCompanyProfile(current, data) {
  const imported = Object.fromEntries(Object.entries(data || {}).filter(([, value]) => value != null && value !== ""));
  const next = { ...current, ...imported };
  if (current.first_name || current.last_name) {
    next.first_name = current.first_name;
    next.last_name = current.last_name;
  } else if (imported.main_contact_name) {
    const names = splitPersonName(imported.main_contact_name);
    next.first_name = names.first_name;
    next.last_name = names.last_name;
  }
  next.email = current.email;
  next.autoentry_email = current.autoentry_email;
  next.sales_autoentry_email = current.sales_autoentry_email;
  next.password = current.password;
  return next;
}

function parseStoredList(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function splitPersonName(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { first_name: parts[0] || "", last_name: "" };
  return { first_name: parts.slice(0, -1).join(" "), last_name: parts[parts.length - 1] };
}
