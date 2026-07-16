import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, BookOpen, Building2, Percent, RefreshCw, Search, Store, UsersRound } from "lucide-react";
import { toast } from "sonner";

const providers = [
  { value: "quickbooks", label: "QuickBooks" },
  { value: "sage", label: "Sage" },
  { value: "xero", label: "Xero" },
];

const recordTabs = [
  { key: "account", label: "Chart of Accounts", icon: BookOpen, empty: "No account codes synced or added yet." },
  { key: "supplier", label: "Supplier List", icon: Store, empty: "No suppliers synced or added yet." },
  { key: "customer", label: "Customer List", icon: UsersRound, empty: "No customers synced or added yet." },
  { key: "tax_code", label: "VAT Codes", icon: Percent, empty: "No VAT codes synced or added yet." },
];

const localQuickBooksRedirectUri = "http://localhost:8000/api/integrations/quickbooks/callback";

const defaultSettings = {
  provider: "quickbooks",
  status: "not_connected",
  company_id: "",
  company_name: "",
  sandbox: false,
  auto_create_suppliers: true,
  auto_create_customers: true,
  default_purchase_account: "",
  default_sales_account: "",
  default_vat_code: "",
  notes: "",
};

export default function AdminIntegrations() {
  const [clients, setClients] = useState([]);
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState(null);
  const [settings, setSettings] = useState(defaultSettings);
  const [quickBooksConfig, setQuickBooksConfig] = useState({ configured: false, environment: "sandbox", redirect_uri: "" });
  const [quickBooksForm, setQuickBooksForm] = useState({ client_id: "", client_secret: "", environment: "sandbox", redirect_uri: "" });
  const [tab, setTab] = useState("account");
  const [busy, setBusy] = useState(false);

  const loadClients = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/integrations/clients", { params: q ? { q } : {} });
      setClients(data);
    } catch (e) {
      toast.error(formatApiError(e));
    }
  }, [q]);

  useEffect(() => { loadClients(); }, [loadClients]);

  useEffect(() => {
    api.get("/admin/integrations/quickbooks/config")
      .then(({ data }) => {
        setQuickBooksConfig(data);
        setQuickBooksForm((current) => ({
          ...current,
          environment: data.environment || "sandbox",
          redirect_uri: data.redirect_uri || "",
        }));
      })
      .catch(() => setQuickBooksConfig({ configured: false, environment: "sandbox", redirect_uri: "" }));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const qb = params.get("quickbooks");
    const sync = params.get("sync");
    if (qb === "connected" && sync === "ok") toast.success("QuickBooks connected and lists synced");
    else if (qb === "connected" && sync === "error") toast.warning(params.get("message") || "QuickBooks connected, but list sync failed");
    else if (qb === "connected") toast.success("QuickBooks connected");
    if (qb === "error") toast.error(params.get("message") || "QuickBooks connection failed");
    if (qb) window.history.replaceState({}, "", window.location.pathname);
  }, []);

  async function openClient(clientId) {
    setBusy(true);
    try {
      const { data } = await api.get(`/admin/integrations/clients/${clientId}`);
      setSelectedId(clientId);
      setDetail(data);
      setSettings({ ...defaultSettings, ...(data.integration || {}) });
      setTab("account");
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(false);
    }
  }

  async function refreshDetail() {
    if (!selectedId) return;
    const { data } = await api.get(`/admin/integrations/clients/${selectedId}`);
    setDetail(data);
    setSettings({ ...defaultSettings, ...(data.integration || {}) });
  }

  async function persistSettings(showToast = true) {
    if (!selectedId) return;
    await api.put(`/admin/integrations/clients/${selectedId}/settings`, settings);
    if (showToast) toast.success("Integration settings saved");
    await refreshDetail();
    await loadClients();
  }

  async function saveSettings(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await persistSettings(true);
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setBusy(false);
    }
  }

  async function deleteRecord(recordId) {
    setBusy(true);
    try {
      await api.delete(`/admin/integrations/records/${recordId}`);
      toast.success("Record removed");
      await refreshDetail();
      await loadClients();
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setBusy(false);
    }
  }

  async function connectQuickBooks() {
    if (!selectedId) return;
    if (settings.provider !== "quickbooks") {
      toast.error("Select QuickBooks as the software first");
      return;
    }
    setBusy(true);
    try {
      await persistSettings(false);
      const { data } = await api.get(`/admin/integrations/clients/${selectedId}/quickbooks/connect`);
      window.location.href = data.auth_url;
    } catch (err) {
      toast.error(formatApiError(err));
      setBusy(false);
    }
  }

  async function syncQuickBooks() {
    if (!selectedId) return;
    setBusy(true);
    try {
      const { data } = await api.post(`/admin/integrations/clients/${selectedId}/quickbooks/sync`);
      toast.success(`Synced ${data.counts.account} accounts, ${data.counts.supplier} suppliers, ${data.counts.customer} customers, ${data.counts.tax_code || 0} VAT codes`);
      if (data.warnings?.length) {
        toast.warning(data.warnings.join(" "));
      }
      await refreshDetail();
      await loadClients();
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveQuickBooksConfig(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = {
        ...quickBooksForm,
        redirect_uri: (quickBooksForm.redirect_uri || localQuickBooksRedirectUri).trim(),
      };
      if (!payload.client_id) delete payload.client_id;
      if (!payload.client_secret) delete payload.client_secret;
      const { data } = await api.put("/admin/integrations/quickbooks/config", payload);
      setQuickBooksConfig(data);
      setQuickBooksForm({ client_id: "", client_secret: "", environment: data.environment || "sandbox", redirect_uri: data.redirect_uri || "" });
      toast.success("QuickBooks app credentials saved securely");
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setBusy(false);
    }
  }

  if (selectedId && detail) {
    return (
      <DetailView
        detail={detail}
        settings={settings}
        setSettings={setSettings}
        tab={tab}
        setTab={setTab}
        busy={busy}
        quickBooksConfig={quickBooksConfig}
        saveSettings={saveSettings}
        connectQuickBooks={connectQuickBooks}
        syncQuickBooks={syncQuickBooks}
        deleteRecord={deleteRecord}
        back={() => {
          setSelectedId("");
          setDetail(null);
          loadClients();
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-stone-900">Client integrations</h1>
          <p className="text-sm text-stone-600">Keep each client&apos;s accounting software, accounts, suppliers, and customers ready for AI coding.</p>
        </div>
        <div className="relative w-full max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clients" className="h-9 pl-10" />
        </div>
      </header>

      <QuickBooksGlobalSettings
        config={quickBooksConfig}
        form={quickBooksForm}
        setForm={setQuickBooksForm}
        onSave={saveQuickBooksConfig}
        busy={busy}
      />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {clients.map((client) => (
          <ClientCard key={client._id} client={client} onOpen={() => openClient(client._id)} disabled={busy} />
        ))}
      </div>

      {clients.length === 0 && (
        <div className="rounded-lg border border-dashed border-stone-300 bg-white p-12 text-center text-stone-500">
          No clients found.
        </div>
      )}
    </div>
  );
}

function QuickBooksGlobalSettings({ config, form, setForm, onSave, busy }) {
  const savedRedirect = config.redirect_uri || form.redirect_uri || localQuickBooksRedirectUri;
  return (
    <section className="rounded-md border border-stone-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-emerald-800" />
            <h2 className="font-display text-xl font-bold text-stone-900">QuickBooks app settings</h2>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-stone-600">
            Admin-level developer credentials used automatically whenever a client connects QuickBooks. Client pages only store that client&apos;s connected company and synced account lists.
          </p>
        </div>
        <Badge variant={config.configured ? "secondary" : "outline"}>
          {config.configured ? "Configured" : "Needs credentials"}
        </Badge>
      </div>

      <form onSubmit={onSave} className="mt-4 grid gap-3 lg:grid-cols-[1fr_1fr_200px_1.4fr_auto] lg:items-end">
        <Field
          label={config.client_id_saved ? "Client ID (saved)" : "Client ID"}
          value={form.client_id}
          onChange={(value) => setForm({ ...form, client_id: value })}
          required={!config.client_id_saved}
        />
        <Field
          label={config.client_secret_saved ? "Client secret (saved - leave blank)" : "Client secret"}
          type="password"
          value={form.client_secret}
          onChange={(value) => setForm({ ...form, client_secret: value })}
          required={!config.client_secret_saved}
        />
        <SelectField
          label="Environment"
          value={form.environment}
          onChange={(value) => setForm({ ...form, environment: value })}
        >
          <option value="sandbox">Sandbox / development</option>
          <option value="production">Production</option>
        </SelectField>
        <Field
          label="Redirect URI"
          value={form.redirect_uri}
          onChange={(value) => setForm({ ...form, redirect_uri: value })}
          required={false}
        />
        <Button type="submit" disabled={busy} className="h-9" style={{ background: "var(--brand)" }}>
          Save
        </Button>
      </form>

      <div className="mt-3 flex flex-col gap-3 text-xs text-stone-500 sm:flex-row sm:items-center sm:justify-between">
        <p>
          Local testing redirect URI for Intuit: <span className="font-mono text-stone-700">{savedRedirect}</span>
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setForm({ ...form, redirect_uri: localQuickBooksRedirectUri })}
        >
          Use local callback
        </Button>
      </div>
    </section>
  );
}

function ClientCard({ client, onOpen, disabled }) {
  const integration = client.integration || defaultSettings;
  const counts = client.integration_counts || {};
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={disabled}
      className="rounded-md border border-stone-200 bg-white p-4 text-left shadow-sm transition hover:border-emerald-200 hover:shadow-md disabled:opacity-60"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-bold text-stone-900">{client.business_name || "Unnamed client"}</h2>
          <p className="mt-1 text-sm text-stone-500">{client.email}</p>
        </div>
        <Badge variant="secondary">{providerLabel(integration.provider)}</Badge>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <SmallCount label="Accounts" value={counts.account || 0} />
        <SmallCount label="Suppliers" value={counts.supplier || 0} />
        <SmallCount label="Customers" value={counts.customer || 0} />
        <SmallCount label="VAT codes" value={counts.tax_code || 0} />
      </div>
      <div className="mt-4 text-sm font-semibold text-emerald-800">{statusLabel(integration.status)}</div>
    </button>
  );
}

function DetailView({ detail, settings, setSettings, tab, setTab, busy, quickBooksConfig, saveSettings, connectQuickBooks, syncQuickBooks, deleteRecord, back }) {
  const client = detail.client || {};
  const records = detail.records || {};
  const activeRecords = records[tab] || [];
  const activeTab = recordTabs.find((item) => item.key === tab) || recordTabs[0];
  const connectedEnvironment = settings.sandbox ? "sandbox" : "production";
  const environmentMismatch = settings.connected && quickBooksConfig.environment && quickBooksConfig.environment !== connectedEnvironment;
  const accountOptions = useMemo(() => (records.account || []).map((record) => ({
    value: record.code || record.name,
    label: [record.code, record.name].filter(Boolean).join(" - "),
  })), [records.account]);

  return (
    <div className="flex h-[calc(100vh-2rem)] min-h-[680px] flex-col overflow-hidden">
      <header className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <Button type="button" variant="outline" onClick={back} className="h-9 gap-2">
            <ArrowLeft className="h-4 w-4" /> Clients
          </Button>
          <div className="min-w-0">
            <h1 className="truncate font-display text-2xl font-bold text-stone-900">{client.business_name || "Client integration"}</h1>
            <p className="truncate text-sm text-stone-500">{client.email}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            onClick={connectQuickBooks}
            disabled={busy || settings.provider !== "quickbooks" || !quickBooksConfig.configured}
            className="h-9 gap-2"
            style={{ background: "var(--brand)" }}
          >
            <Building2 className="h-4 w-4" /> {settings.connected ? "Reconnect QuickBooks" : "Connect QuickBooks"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={syncQuickBooks}
            disabled={busy || settings.provider !== "quickbooks" || !settings.connected}
            className="h-9 gap-2"
          >
            <RefreshCw className="h-4 w-4" /> Sync lists
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(400px,0.8fr)_minmax(640px,1.2fr)]">
        <section className="min-h-0 overflow-auto rounded-md border border-stone-200 bg-white">
          <form onSubmit={saveSettings} className="space-y-4 p-4">
            <div>
              <h2 className="font-display text-xl font-bold text-stone-900">Integration</h2>
              <p className="mt-1 text-sm text-stone-500">QuickBooks is first; Sage and Xero use the same local profile shape for later connection.</p>
            </div>
            {!quickBooksConfig.configured && settings.provider === "quickbooks" && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                QuickBooks OAuth is not configured yet. Save the admin QuickBooks app settings on the main Client integrations page, then connect this client.
              </div>
            )}
            {quickBooksConfig.configured && settings.provider === "quickbooks" && (
              <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-900">
                This client will use the admin QuickBooks app settings automatically ({quickBooksConfig.environment}).
              </div>
            )}
            {settings.connected && (
              <div className={`rounded-lg border p-3 text-sm ${settings.sandbox ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-100 bg-emerald-50 text-emerald-900"}`}>
                Connected QuickBooks company: <strong>{settings.company_name || "Unknown company"}</strong> ({connectedEnvironment}).
                {settings.sandbox && " Sandbox companies return sample US tax codes such as Arizona/Tucson, not the live UK VAT list."}
              </div>
            )}
            {environmentMismatch && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                Admin QuickBooks app settings are now {quickBooksConfig.environment}, but this client is still connected to {connectedEnvironment}. Reconnect QuickBooks to switch company/environment before syncing lists.
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField label="Software" value={settings.provider} onChange={(value) => setSettings({ ...settings, provider: value })}>
                {providers.map((provider) => <option key={provider.value} value={provider.value}>{provider.label}</option>)}
              </SelectField>
              <SelectField label="Status" value={settings.status} onChange={(value) => setSettings({ ...settings, status: value })}>
                <option value="not_connected">Not connected</option>
                <option value="ready">Ready to connect</option>
                <option value="connected">Connected</option>
                <option value="sync_error">Sync error</option>
              </SelectField>
              <Field label="Company ID / Realm ID" value={settings.company_id || ""} onChange={(value) => setSettings({ ...settings, company_id: value })} />
              <Field label="Company name" value={settings.company_name || ""} onChange={(value) => setSettings({ ...settings, company_name: value })} />
            </div>

            <div className="rounded-md border border-stone-200 bg-stone-50 p-3">
              <h3 className="font-semibold text-stone-900">Account settings</h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <ComboField label="Default purchase account" value={settings.default_purchase_account || ""} options={accountOptions} onChange={(value) => setSettings({ ...settings, default_purchase_account: value })} />
                <ComboField label="Default sales account" value={settings.default_sales_account || ""} options={accountOptions} onChange={(value) => setSettings({ ...settings, default_sales_account: value })} />
                <Field label="Default VAT code" value={settings.default_vat_code || ""} onChange={(value) => setSettings({ ...settings, default_vat_code: value })} />
                <label className="flex items-center gap-2 pt-7 text-sm font-medium text-stone-700">
                  <input
                    type="checkbox"
                    checked={!!settings.sandbox}
                    disabled={settings.connected}
                    onChange={(e) => setSettings({ ...settings, sandbox: e.target.checked })}
                  />
                  {settings.connected ? "Environment set by connection" : "Sandbox company"}
                </label>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <label className="flex items-start gap-3 rounded-lg bg-white p-3 text-sm">
                  <input type="checkbox" checked={!!settings.auto_create_suppliers} onChange={(e) => setSettings({ ...settings, auto_create_suppliers: e.target.checked })} className="mt-1" />
                  <span><strong>Create missing suppliers</strong><span className="block text-stone-500">When publishing purchase documents later.</span></span>
                </label>
                <label className="flex items-start gap-3 rounded-lg bg-white p-3 text-sm">
                  <input type="checkbox" checked={!!settings.auto_create_customers} onChange={(e) => setSettings({ ...settings, auto_create_customers: e.target.checked })} className="mt-1" />
                  <span><strong>Create missing customers</strong><span className="block text-stone-500">When publishing sales documents later.</span></span>
                </label>
              </div>
            </div>

            <div>
              <Label>Notes</Label>
              <Textarea value={settings.notes || ""} onChange={(e) => setSettings({ ...settings, notes: e.target.value })} className="mt-1 min-h-24" placeholder="Anything useful for account mapping, VAT behaviour, or future sync rules" />
            </div>

            <Button type="submit" disabled={busy} style={{ background: "var(--brand)" }}>
              Save integration settings
            </Button>
          </form>
        </section>

        <section className="min-h-0 overflow-hidden rounded-md border border-stone-200 bg-white">
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex flex-col gap-2 border-b border-stone-200 p-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap gap-2">
                {recordTabs.map((item) => {
                  const Icon = item.icon;
                  const active = tab === item.key;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setTab(item.key)}
                      className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-semibold ${active ? "bg-emerald-900 text-white" : "bg-stone-100 text-stone-700 hover:bg-stone-200"}`}
                    >
                      <Icon className="h-4 w-4" /> {item.label}
                    </button>
                  );
                })}
              </div>
              <div className="rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-600">
                Synced from QuickBooks. Create missing suppliers from invoice review.
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
              {activeRecords.length === 0 ? (
                <div className="flex h-full min-h-[420px] items-center justify-center p-8 text-center text-stone-500">
                  {activeTab.empty}
                </div>
              ) : (
                <div className="divide-y divide-stone-100">
                  {activeRecords.map((record) => (
                    <RecordRow key={record.id} record={record} recordType={tab} onDelete={() => deleteRecord(record.id)} busy={busy} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function RecordRow({ record, recordType, onDelete, busy }) {
  return (
    <div className="grid gap-2 p-3 lg:grid-cols-[minmax(0,1fr)_150px_100px_auto] lg:items-center">
      <div className="min-w-0">
        <div className="truncate font-semibold text-stone-900">{record.name}</div>
        <div className="mt-1 truncate text-sm text-stone-500">{record.description || record.email || "No description"}</div>
      </div>
        <div className="text-sm text-stone-600">{record.code || "-"}</div>
      <Badge variant={record.active ? "secondary" : "outline"}>{record.active ? "Active" : "Inactive"}</Badge>
      {record.external_id ? (
        <Badge variant="outline">Synced</Badge>
      ) : recordType === "supplier" ? (
        <Button type="button" variant="outline" size="sm" onClick={onDelete} disabled={busy}>
          Remove
        </Button>
      ) : (
        <span className="text-sm text-stone-400">Read only</span>
      )}
      {recordType !== "account" && record.external_id && (
        <div className="lg:col-span-4 text-xs text-stone-400">External ID: {record.external_id}</div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, type = "text", required = true }) {
  return (
    <div>
      <Label>{label}</Label>
      <Input type={type} required={required} value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 h-9" />
    </div>
  );
}

function SelectField({ label, value, onChange, children }) {
  return (
    <div>
      <Label>{label}</Label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-stone-200 bg-white px-3 text-sm shadow-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100">
        {children}
      </select>
    </div>
  );
}

function ComboField({ label, value, options, onChange }) {
  return (
    <div>
      <Label>{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} list={`${label.replace(/\W+/g, "-")}-options`} className="mt-1 h-9" />
      <datalist id={`${label.replace(/\W+/g, "-")}-options`}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </datalist>
    </div>
  );
}

function SmallCount({ label, value }) {
  return (
    <span className="rounded-md bg-stone-100 px-2.5 py-1 text-xs font-semibold text-stone-700">
      {label}: {value}
    </span>
  );
}

function providerLabel(value) {
  return providers.find((provider) => provider.value === value)?.label || "QuickBooks";
}

function statusLabel(value) {
  const labels = {
    not_connected: "Not connected",
    ready: "Ready to connect",
    connected: "Connected",
    sync_error: "Sync error",
  };
  return labels[value] || "Not connected";
}
