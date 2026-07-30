import React, { useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Building2, KeyRound } from "lucide-react";
import { toast } from "sonner";

const PROVIDERS = [
  { key: "quickbooks", label: "QuickBooks", developer: "Intuit" },
  { key: "xero", label: "Xero", developer: "Xero Developer" },
  { key: "sage", label: "Sage", developer: "Sage Developer" },
];

function defaultRedirectUri(provider) {
  return `http://localhost:8000/api/integrations/${provider}/callback`;
}

function emptyProviderConfig(provider) {
  return {
    provider,
    configured: false,
    enabled: true,
    environment: provider === "quickbooks" ? "sandbox" : "production",
    environments: provider === "quickbooks" ? ["production", "sandbox"] : ["production"],
    redirect_uri: defaultRedirectUri(provider),
  };
}

function emptyProviderForm(provider) {
  const config = emptyProviderConfig(provider);
  return {
    client_id: "",
    client_secret: "",
    environment: config.environment,
    redirect_uri: config.redirect_uri,
    enabled: true,
  };
}

export default function AdminIntegrations() {
  const [providerConfigs, setProviderConfigs] = useState(() => Object.fromEntries(PROVIDERS.map(({ key }) => [key, emptyProviderConfig(key)])));
  const [providerForms, setProviderForms] = useState(() => Object.fromEntries(PROVIDERS.map(({ key }) => [key, emptyProviderForm(key)])));
  const [companiesHouseConfig, setCompaniesHouseConfig] = useState({
    configured: false,
    enabled: true,
    source: "missing",
    api_key_saved: false,
  });
  const [companiesHouseForm, setCompaniesHouseForm] = useState({ api_key: "", enabled: true });
  const [busyProvider, setBusyProvider] = useState("");

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    try {
      const [providerResponses, companiesHouse] = await Promise.all([
        Promise.all(PROVIDERS.map(({ key }) => api.get(`/admin/integrations/${key}/config`))),
        api.get("/admin/integrations/companies-house/config"),
      ]);
      const configs = {};
      const forms = {};
      providerResponses.forEach(({ data }, index) => {
        const provider = PROVIDERS[index].key;
        configs[provider] = data;
        forms[provider] = {
          client_id: data.client_id_saved ? "saved" : "",
          client_secret: "",
          environment: data.environment || emptyProviderConfig(provider).environment,
          redirect_uri: data.redirect_uri || defaultRedirectUri(provider),
          enabled: data.enabled !== false,
        };
      });
      setProviderConfigs(configs);
      setProviderForms(forms);
      setCompaniesHouseConfig(companiesHouse.data);
      setCompaniesHouseForm({ api_key: "", enabled: companiesHouse.data.enabled !== false });
    } catch (error) {
      toast.error(formatApiError(error));
    }
  }

  function updateProviderForm(provider, key, value) {
    setProviderForms((current) => ({
      ...current,
      [provider]: { ...current[provider], [key]: value },
    }));
  }

  async function saveProvider(event, provider) {
    event.preventDefault();
    setBusyProvider(provider);
    try {
      const form = providerForms[provider];
      const { data } = await api.put(`/admin/integrations/${provider}/config`, {
        client_id: form.client_id === "saved" ? "" : form.client_id,
        client_secret: form.client_secret,
        environment: form.environment,
        redirect_uri: form.redirect_uri || defaultRedirectUri(provider),
        enabled: form.enabled !== false,
      });
      setProviderConfigs((current) => ({ ...current, [provider]: data }));
      setProviderForms((current) => ({
        ...current,
        [provider]: {
          ...current[provider],
          client_id: data.client_id_saved ? "saved" : "",
          client_secret: "",
          enabled: data.enabled !== false,
        },
      }));
      toast.success(`${data.label || provider} app settings saved`);
    } catch (error) {
      toast.error(formatApiError(error));
    } finally {
      setBusyProvider("");
    }
  }

  async function saveCompaniesHouse(event) {
    event.preventDefault();
    setBusyProvider("companies_house");
    try {
      const { data } = await api.put("/admin/integrations/companies-house/config", {
        api_key: companiesHouseForm.api_key,
        enabled: companiesHouseForm.enabled !== false,
      });
      setCompaniesHouseConfig(data);
      setCompaniesHouseForm({ api_key: "", enabled: data.enabled !== false });
      toast.success("Companies House settings saved");
    } catch (error) {
      toast.error(formatApiError(error));
    } finally {
      setBusyProvider("");
    }
  }

  return (
    <div className="space-y-4">
      <header className="rounded-md border border-stone-200 bg-white p-4">
        <h1 className="font-display text-2xl font-bold text-stone-900">Global integrations</h1>
        <p className="mt-1 max-w-3xl text-sm text-stone-600">
          Configure practice-level OAuth app credentials. Each client can connect to one external accounting package at a time.
        </p>
      </header>

      <section className="grid gap-4 xl:grid-cols-2">
        {PROVIDERS.map(({ key: provider, label, developer }) => {
          const config = providerConfigs[provider] || emptyProviderConfig(provider);
          const form = providerForms[provider] || emptyProviderForm(provider);
          const environments = config.environments?.length ? config.environments : [form.environment || "production"];
          return (
            <form key={provider} onSubmit={(event) => saveProvider(event, provider)} className="rounded-md border border-stone-200 bg-white p-4">
              <ModuleHeader
                icon={Building2}
                title={`${label} app settings`}
                subtitle={`OAuth credentials from the ${developer} portal. Used by client-specific ${label} connections.`}
                enabled={form.enabled}
                configured={config.configured}
              />
              <ModuleToggle
                label={`Enable ${label} integration`}
                description="Disabling prevents new connections and syncs while retaining encrypted credentials."
                checked={form.enabled}
                onChange={(checked) => updateProviderForm(provider, "enabled", checked)}
              />
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                <Field
                  label="Client ID"
                  value={form.client_id}
                  onChange={(value) => updateProviderForm(provider, "client_id", value)}
                  placeholder={config.client_id_saved ? "saved - leave as saved" : `${label} client ID`}
                />
                <Field
                  label="Client secret"
                  type="password"
                  value={form.client_secret}
                  onChange={(value) => updateProviderForm(provider, "client_secret", value)}
                  placeholder={config.client_secret_saved ? "saved - leave blank to keep" : `${label} client secret`}
                />
                <SelectField
                  label="Environment"
                  value={form.environment}
                  onChange={(value) => updateProviderForm(provider, "environment", value)}
                  options={environments.map((environment) => [environment, environment === "sandbox" ? "Sandbox / development" : "Production"])}
                />
                <Field
                  label="Redirect URI"
                  value={form.redirect_uri}
                  onChange={(value) => updateProviderForm(provider, "redirect_uri", value)}
                  placeholder={defaultRedirectUri(provider)}
                />
              </div>
              <p className="mt-3 text-xs text-stone-500">
                Register this exact callback URI in the {developer} portal. Requested scope: {config.scope || "accounting data"}.
              </p>
              <div className="mt-4 flex justify-end">
                <Button type="submit" disabled={!!busyProvider} style={{ background: "var(--brand)" }}>
                  {busyProvider === provider ? "Saving..." : `Save ${label} settings`}
                </Button>
              </div>
            </form>
          );
        })}

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
            <Button type="submit" disabled={!!busyProvider} style={{ background: "var(--brand)" }}>Save Companies House settings</Button>
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
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-1 h-4 w-4" />
    </label>
  );
}

function Field({ label, value, onChange, type = "text", placeholder = "" }) {
  return (
    <div>
      <Label className="text-xs font-semibold text-stone-600">{label}</Label>
      <Input type={type} value={value || ""} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="mt-1 h-9" />
    </div>
  );
}

function SelectField({ label, value, onChange, options }) {
  return (
    <div>
      <Label className="text-xs font-semibold text-stone-600">{label}</Label>
      <select value={value || ""} onChange={(event) => onChange(event.target.value)} className="mt-1 h-9 w-full rounded-md border border-stone-200 bg-white px-3 text-sm shadow-sm">
        {options.map(([optionValue, labelText]) => <option key={optionValue} value={optionValue}>{labelText}</option>)}
      </select>
    </div>
  );
}
