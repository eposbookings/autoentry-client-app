import React, { useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Building2, KeyRound } from "lucide-react";
import { toast } from "sonner";

const LOCAL_QUICKBOOKS_REDIRECT_URI = "http://localhost:8000/api/integrations/quickbooks/callback";

export default function AdminIntegrations() {
  const [quickBooksConfig, setQuickBooksConfig] = useState({
    configured: false,
    enabled: true,
    environment: "sandbox",
    redirect_uri: "",
  });
  const [quickBooksForm, setQuickBooksForm] = useState({
    client_id: "",
    client_secret: "",
    environment: "sandbox",
    redirect_uri: "",
    enabled: true,
  });
  const [companiesHouseConfig, setCompaniesHouseConfig] = useState({
    configured: false,
    enabled: true,
    source: "missing",
    api_key_saved: false,
  });
  const [companiesHouseForm, setCompaniesHouseForm] = useState({
    api_key: "",
    enabled: true,
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    try {
      const [quickBooks, companiesHouse] = await Promise.all([
        api.get("/admin/integrations/quickbooks/config"),
        api.get("/admin/integrations/companies-house/config"),
      ]);
      setQuickBooksConfig(quickBooks.data);
      setQuickBooksForm({
        client_id: quickBooks.data.client_id_saved ? "saved" : "",
        client_secret: "",
        environment: quickBooks.data.environment || "sandbox",
        redirect_uri: quickBooks.data.redirect_uri || LOCAL_QUICKBOOKS_REDIRECT_URI,
        enabled: quickBooks.data.enabled !== false,
      });
      setCompaniesHouseConfig(companiesHouse.data);
      setCompaniesHouseForm({
        api_key: "",
        enabled: companiesHouse.data.enabled !== false,
      });
    } catch (e) {
      toast.error(formatApiError(e));
    }
  }

  async function saveQuickBooks(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const clientId = quickBooksForm.client_id === "saved" ? "" : quickBooksForm.client_id;
      const payload = {
        client_id: clientId,
        client_secret: quickBooksForm.client_secret,
        environment: quickBooksForm.environment,
        redirect_uri: quickBooksForm.redirect_uri || LOCAL_QUICKBOOKS_REDIRECT_URI,
        enabled: quickBooksForm.enabled !== false,
      };
      const { data } = await api.put("/admin/integrations/quickbooks/config", payload);
      setQuickBooksConfig(data);
      setQuickBooksForm((current) => ({
        ...current,
        client_id: data.client_id_saved ? "saved" : "",
        client_secret: "",
        enabled: data.enabled !== false,
      }));
      toast.success("Accounting software app settings saved");
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveCompaniesHouse(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await api.put("/admin/integrations/companies-house/config", {
        api_key: companiesHouseForm.api_key,
        enabled: companiesHouseForm.enabled !== false,
      });
      setCompaniesHouseConfig(data);
      setCompaniesHouseForm({ api_key: "", enabled: data.enabled !== false });
      toast.success("Companies House settings saved");
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <header className="rounded-md border border-stone-200 bg-white p-4">
        <h1 className="font-display text-2xl font-bold text-stone-900">Global integrations</h1>
        <p className="mt-1 max-w-3xl text-sm text-stone-600">
          Configure practice-level app credentials and subscription-controlled modules. Client-specific accountancy software connections live inside each client account.
        </p>
      </header>

      <section className="grid gap-4 xl:grid-cols-2">
        <form onSubmit={saveQuickBooks} className="rounded-md border border-stone-200 bg-white p-4">
          <ModuleHeader
            icon={Building2}
            title="Accounting software app settings"
            subtitle="QuickBooks is active first. Sage and Xero will use this same global module pattern later."
            enabled={quickBooksForm.enabled}
            configured={quickBooksConfig.configured}
          />
          <ModuleToggle
            label="Enable accountancy software integration"
            description="When disabled, clients cannot connect or sync accounting software, but saved credentials are kept."
            checked={quickBooksForm.enabled}
            onChange={(checked) => setQuickBooksForm((current) => ({ ...current, enabled: checked }))}
          />
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <Field
              label="Client ID"
              value={quickBooksForm.client_id}
              onChange={(value) => setQuickBooksForm((current) => ({ ...current, client_id: value }))}
              placeholder={quickBooksConfig.client_id_saved ? "saved - leave as saved" : "Intuit client ID"}
            />
            <Field
              label="Client secret"
              type="password"
              value={quickBooksForm.client_secret}
              onChange={(value) => setQuickBooksForm((current) => ({ ...current, client_secret: value }))}
              placeholder={quickBooksConfig.client_secret_saved ? "saved - leave blank to keep" : "Intuit client secret"}
            />
            <SelectField
              label="Environment"
              value={quickBooksForm.environment}
              onChange={(value) => setQuickBooksForm((current) => ({ ...current, environment: value }))}
              options={[["sandbox", "Sandbox / development"], ["production", "Production"]]}
            />
            <Field
              label="Redirect URI"
              value={quickBooksForm.redirect_uri}
              onChange={(value) => setQuickBooksForm((current) => ({ ...current, redirect_uri: value }))}
              placeholder={LOCAL_QUICKBOOKS_REDIRECT_URI}
            />
          </div>
          <p className="mt-3 text-xs text-stone-500">
            Add the exact redirect URI above in the Intuit developer portal before connecting a client.
          </p>
          <div className="mt-4 flex justify-end">
            <Button type="submit" disabled={busy} style={{ background: "var(--brand)" }}>Save accountancy app settings</Button>
          </div>
        </form>

        <form onSubmit={saveCompaniesHouse} className="rounded-md border border-stone-200 bg-white p-4">
          <ModuleHeader
            icon={KeyRound}
            title="Companies House app settings"
            subtitle="Used for company lookup and importing registered details into client records."
            enabled={companiesHouseForm.enabled}
            configured={companiesHouseConfig.configured}
          />
          <ModuleToggle
            label="Enable Companies House integration"
            description="Keep the key saved but disable the feature for subscription control or testing."
            checked={companiesHouseForm.enabled}
            onChange={(checked) => setCompaniesHouseForm((current) => ({ ...current, enabled: checked }))}
          />
          <div className="mt-4">
            <Field
              label="API key"
              type="password"
              value={companiesHouseForm.api_key}
              onChange={(value) => setCompaniesHouseForm((current) => ({ ...current, api_key: value }))}
              placeholder={companiesHouseConfig.api_key_saved ? "saved - leave blank to keep" : "Companies House REST API key"}
            />
            <p className="mt-2 text-xs text-stone-500">
              Source: {companiesHouseConfig.source || "missing"}. A saved key is encrypted in the app settings.
            </p>
          </div>
          <div className="mt-4 flex justify-end">
            <Button type="submit" disabled={busy} style={{ background: "var(--brand)" }}>Save Companies House settings</Button>
          </div>
        </form>
      </section>
    </div>
  );
}

function ModuleHeader({ icon: Icon, title, subtitle, enabled, configured }) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-[var(--brand-soft)] text-[var(--brand)]">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <h2 className="font-display text-lg font-semibold text-stone-900">{title}</h2>
          <p className="mt-1 text-sm text-stone-600">{subtitle}</p>
        </div>
      </div>
      <div className="flex gap-2">
        <Badge className={enabled ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-100" : "bg-stone-100 text-stone-700 hover:bg-stone-100"}>
          {enabled ? "Enabled" : "Disabled"}
        </Badge>
        <Badge variant="outline">{configured ? "Configured" : "Needs credentials"}</Badge>
      </div>
    </div>
  );
}

function ModuleToggle({ label, description, checked, onChange }) {
  return (
    <label className="flex items-start justify-between gap-3 rounded-md border border-stone-200 bg-stone-50 p-3 text-sm">
      <span>
        <span className="block font-semibold text-stone-800">{label}</span>
        <span className="block text-xs text-stone-500">{description}</span>
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 h-4 w-4" />
    </label>
  );
}

function Field({ label, value, onChange, type = "text", placeholder = "" }) {
  return (
    <div>
      <Label className="text-xs font-semibold text-stone-600">{label}</Label>
      <Input type={type} value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="mt-1 h-9" />
    </div>
  );
}

function SelectField({ label, value, onChange, options }) {
  return (
    <div>
      <Label className="text-xs font-semibold text-stone-600">{label}</Label>
      <select value={value || ""} onChange={(e) => onChange(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-stone-200 bg-white px-3 text-sm shadow-sm">
        {options.map(([optionValue, labelText]) => (
          <option key={optionValue} value={optionValue}>{labelText}</option>
        ))}
      </select>
    </div>
  );
}
