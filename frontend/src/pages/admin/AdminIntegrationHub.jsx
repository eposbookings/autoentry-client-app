import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  KeyRound,
  Link2,
  PlugZap,
  RefreshCw,
  RotateCcw,
  Save,
  ServerCog,
  ShieldCheck,
  Webhook,
} from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const emptyHub = {
  dashboard: {},
  catalog: [],
  connections: [],
  sync_runs: [],
  api_keys: [],
  webhooks: [],
  logs: [],
  settings: {},
  health: [],
};

const initialConnection = {
  provider_id: "companies_house",
  environment: "production",
  status: "configured",
  authentication_status: "not_authenticated",
  has_credentials: false,
};

const initialKey = {
  provider_id: "companies_house",
  environment: "production",
  label: "",
  api_key: "",
  api_secret: "",
  expires_at: "",
};

const initialWebhook = {
  provider_id: "companies_house",
  endpoint_url: "",
  event_type: "all_events",
};

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function providerOptions(catalog) {
  return safeArray(catalog).flatMap((group) =>
    safeArray(group?.providers).map((provider) => ({ ...provider, category: group?.category }))
  );
}

function statusClass(status) {
  if (["connected", "success", "active", "healthy", "authenticated"].includes(status)) return "bg-emerald-100 text-emerald-800";
  if (["configured", "unknown", "manual", "planned"].includes(status)) return "bg-stone-100 text-stone-700";
  if (["disabled", "not_authenticated", "attention", "failed", "disconnected"].includes(status)) return "bg-amber-100 text-amber-800";
  return "bg-stone-100 text-stone-700";
}

function KpiCard({ label, value, icon: Icon, tone = "emerald" }) {
  const tones = {
    emerald: "border-emerald-100 bg-emerald-50 text-emerald-950",
    amber: "border-amber-100 bg-amber-50 text-amber-950",
    red: "border-red-100 bg-red-50 text-red-950",
    stone: "border-stone-100 bg-stone-50 text-stone-900",
  };
  return (
    <div className={`rounded-lg border p-4 shadow-sm ${tones[tone] || tones.stone}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide opacity-70">{label}</p>
          <p className="mt-2 font-display text-2xl font-bold">{value ?? 0}</p>
        </div>
        <Icon className="h-5 w-5 opacity-70" />
      </div>
    </div>
  );
}

function Panel({ title, subtitle, children, action }) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-3 border-b border-stone-100 px-4 py-3">
        <div>
          <h2 className="font-display text-base font-bold text-stone-900">{title}</h2>
          {subtitle && <p className="mt-1 text-sm text-stone-500">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function EmptyState({ text }) {
  return <div className="rounded-lg border border-dashed border-stone-200 bg-stone-50 px-4 py-8 text-center text-sm text-stone-500">{text}</div>;
}

function ProviderSelect({ value, onChange, providers }) {
  return (
    <select className="h-10 rounded-md border border-stone-200 bg-white px-3 text-sm shadow-sm" value={value} onChange={(event) => onChange(event.target.value)}>
      {providers.map((provider) => (
        <option key={provider.id} value={provider.id}>
          {provider.name}
        </option>
      ))}
    </select>
  );
}

function ConnectionCard({ connection, onAction, onSync }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-base font-bold text-stone-900">{connection.provider_name}</h3>
          <p className="text-sm text-stone-500">{connection.category} - {connection.environment}</p>
        </div>
        <Badge className={statusClass(connection.disabled ? "disabled" : connection.status)}>{connection.disabled ? "Disabled" : connection.status}</Badge>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-xs font-semibold uppercase text-stone-400">Last sync</p>
          <p className="text-stone-700">{connection.last_sync_at || "Not synced"}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase text-stone-400">Next sync</p>
          <p className="text-stone-700">{connection.next_sync_at || "Manual"}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase text-stone-400">Auth</p>
          <p className="text-stone-700">{connection.authentication_status || "Unknown"}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase text-stone-400">Health</p>
          <p className="text-stone-700">{connection.health_status || "Unknown"}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => onAction(connection.id, "test")}>Test</Button>
        <Button size="sm" variant="outline" onClick={() => onAction(connection.id, "reconnect")}>Reconnect</Button>
        <Button size="sm" variant="outline" onClick={() => onSync(connection.id)}>Sync</Button>
        <Button size="sm" variant="outline" onClick={() => onAction(connection.id, connection.disabled ? "enable" : "disable")}>
          {connection.disabled ? "Enable" : "Disable"}
        </Button>
      </div>
    </div>
  );
}

export default function AdminIntegrationHub() {
  const [hub, setHub] = useState(emptyHub);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [connectionDraft, setConnectionDraft] = useState(initialConnection);
  const [keyDraft, setKeyDraft] = useState(initialKey);
  const [webhookDraft, setWebhookDraft] = useState(initialWebhook);
  const [settingsDraft, setSettingsDraft] = useState({});

  const providers = useMemo(() => providerOptions(hub.catalog), [hub.catalog]);
  const connections = safeArray(hub.connections);
  const syncRuns = safeArray(hub.sync_runs);
  const apiKeys = safeArray(hub.api_keys);
  const webhooks = safeArray(hub.webhooks);
  const logs = safeArray(hub.logs);

  async function loadHub() {
    try {
      const { data } = await api.get("/admin/integration-hub");
      setHub({ ...emptyHub, ...(data || {}) });
      setSettingsDraft(data?.settings || {});
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadHub();
  }, []);

  useEffect(() => {
    if (providers.length && !providers.some((provider) => provider.id === connectionDraft.provider_id)) {
      const first = providers[0];
      setConnectionDraft((current) => ({ ...current, provider_id: first.id }));
      setKeyDraft((current) => ({ ...current, provider_id: first.id }));
      setWebhookDraft((current) => ({ ...current, provider_id: first.id }));
    }
  }, [providers, connectionDraft.provider_id]);

  async function createConnection(providerId = connectionDraft.provider_id) {
    setSaving(true);
    try {
      await api.post("/admin/integration-hub/connections", { ...connectionDraft, provider_id: providerId });
      toast.success("Integration connection created");
      await loadHub();
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setSaving(false);
    }
  }

  async function runAction(connectionId, action) {
    try {
      await api.post(`/admin/integration-hub/connections/${connectionId}/${action}`, {});
      toast.success("Connection updated");
      await loadHub();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  }

  async function runSync(connectionId) {
    try {
      await api.post("/admin/integration-hub/sync", { connection_id: connectionId, sync_type: "manual" });
      toast.success("Sync run recorded");
      await loadHub();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  }

  async function saveKey() {
    if (!keyDraft.api_key && !keyDraft.api_secret) {
      toast.error("Enter a key or secret to save the credential metadata.");
      return;
    }
    setSaving(true);
    try {
      await api.post("/admin/integration-hub/api-keys", keyDraft);
      toast.success("API key metadata saved");
      setKeyDraft(initialKey);
      await loadHub();
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setSaving(false);
    }
  }

  async function rotateKey(keyId) {
    try {
      await api.post(`/admin/integration-hub/api-keys/${keyId}/rotate`, {});
      toast.success("Key rotation recorded");
      await loadHub();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  }

  async function saveWebhook() {
    if (!webhookDraft.endpoint_url.trim()) {
      toast.error("Webhook endpoint is required.");
      return;
    }
    setSaving(true);
    try {
      await api.post("/admin/integration-hub/webhooks", webhookDraft);
      toast.success("Webhook registered");
      setWebhookDraft(initialWebhook);
      await loadHub();
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setSaving(false);
    }
  }

  async function replayWebhook(webhookId) {
    try {
      await api.post(`/admin/integration-hub/webhooks/${webhookId}/replay`, {});
      toast.success("Webhook replay recorded");
      await loadHub();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  }

  async function saveSettings() {
    setSaving(true);
    try {
      await api.put("/admin/integration-hub/settings", settingsDraft);
      toast.success("Integration Hub settings saved");
      await loadHub();
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="p-6 text-stone-500">Loading Integration Hub...</div>;
  }

  return (
    <div className="mx-auto flex max-w-[1680px] flex-col gap-4 p-2 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold text-stone-950">Integration Hub</h1>
          <p className="text-sm text-stone-500">Central connections, authentication, synchronisation and integration monitoring.</p>
        </div>
        <Button onClick={loadHub} variant="outline" className="gap-2">
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </div>

      <Tabs defaultValue="dashboard" className="space-y-4">
        <TabsList className="flex h-auto flex-wrap justify-start gap-2 bg-stone-100 p-1">
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="connected">Connected Services</TabsTrigger>
          <TabsTrigger value="available">Available Integrations</TabsTrigger>
          <TabsTrigger value="manager">Connection Manager</TabsTrigger>
          <TabsTrigger value="sync">Synchronisation</TabsTrigger>
          <TabsTrigger value="keys">API Keys</TabsTrigger>
          <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            <KpiCard label="Active integrations" value={hub.dashboard?.active_integrations} icon={PlugZap} />
            <KpiCard label="Syncs today" value={hub.dashboard?.syncs_today} icon={RefreshCw} />
            <KpiCard label="Failed syncs" value={hub.dashboard?.failed_syncs} icon={AlertTriangle} tone={hub.dashboard?.failed_syncs ? "red" : "stone"} />
            <KpiCard label="Pending actions" value={hub.dashboard?.pending_actions} icon={Clock} tone={hub.dashboard?.pending_actions ? "amber" : "stone"} />
            <KpiCard label="API usage" value={hub.dashboard?.api_usage} icon={Activity} tone="stone" />
            <KpiCard label="Last success" value={hub.dashboard?.last_successful_sync ? "Saved" : "None"} icon={CheckCircle2} tone="stone" />
          </div>
          <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <Panel title="Recent activity">
              {logs.length ? (
                <div className="divide-y divide-stone-100">
                  {logs.slice(0, 8).map((log) => (
                    <div key={log.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                      <div>
                        <p className="font-semibold text-stone-900">{log.action}</p>
                        <p className="text-stone-500">{log.provider_id || "integration hub"} - {log.created_at}</p>
                      </div>
                      <Badge className={statusClass(log.status)}>{log.status}</Badge>
                    </div>
                  ))}
                </div>
              ) : <EmptyState text="No integration activity recorded yet." />}
            </Panel>
            <Panel title="Health status">
              {safeArray(hub.health).length ? safeArray(hub.health).map((item, index) => (
                <div key={`${item.provider}-${index}`} className="mb-3 rounded-lg border border-stone-100 bg-stone-50 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-stone-900">{item.provider}</p>
                    <Badge className={statusClass(item.status)}>{item.status}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-stone-500">{item.message}</p>
                </div>
              )) : <EmptyState text="Connect a service to begin health monitoring." />}
            </Panel>
          </div>
        </TabsContent>

        <TabsContent value="connected">
          <Panel title="Connected services" subtitle="Configured integrations are tested, disabled, reconnected and synced from here.">
            {connections.length ? (
              <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                {connections.map((connection) => (
                  <ConnectionCard key={connection.id} connection={connection} onAction={runAction} onSync={runSync} />
                ))}
              </div>
            ) : <EmptyState text="No connected services yet. Add one from Available Integrations or Connection Manager." />}
          </Panel>
        </TabsContent>

        <TabsContent value="available">
          <div className="space-y-4">
            {safeArray(hub.catalog).map((group) => (
              <Panel key={group.category} title={group.category}>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {safeArray(group.providers).map((provider) => (
                    <div key={provider.id} className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="font-display text-base font-bold text-stone-900">{provider.name}</h3>
                          <p className="text-sm text-stone-500">{provider.auth_type} authentication</p>
                        </div>
                        <Badge className={statusClass(provider.status)}>{provider.status}</Badge>
                      </div>
                      <Button className="mt-4 w-full gap-2" variant="outline" onClick={() => createConnection(provider.id)} disabled={saving}>
                        <Link2 className="h-4 w-4" /> Add connection
                      </Button>
                    </div>
                  ))}
                </div>
              </Panel>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="manager">
          <Panel title="Connection Manager" subtitle="Standard flow: connect, authenticate, test, save, disconnect.">
            <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
              <div className="rounded-lg border border-stone-200 bg-stone-50 p-4">
                <div className="grid gap-3">
                  <Label>Provider</Label>
                  <ProviderSelect providers={providers} value={connectionDraft.provider_id} onChange={(value) => setConnectionDraft((current) => ({ ...current, provider_id: value }))} />
                  <Label>Environment</Label>
                  <select className="h-10 rounded-md border border-stone-200 bg-white px-3 text-sm shadow-sm" value={connectionDraft.environment} onChange={(event) => setConnectionDraft((current) => ({ ...current, environment: event.target.value }))}>
                    <option value="development">Development</option>
                    <option value="production">Production</option>
                  </select>
                  <label className="flex items-center gap-2 text-sm font-semibold text-stone-700">
                    <input type="checkbox" checked={connectionDraft.has_credentials} onChange={(event) => setConnectionDraft((current) => ({ ...current, has_credentials: event.target.checked }))} />
                    Credentials are stored outside the UI
                  </label>
                  <Button onClick={() => createConnection()} disabled={saving} className="gap-2">
                    <Save className="h-4 w-4" /> Save connection
                  </Button>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-4">
                  <ShieldCheck className="mb-2 h-5 w-5 text-emerald-800" />
                  <h3 className="font-bold text-emerald-950">Credentials stay masked</h3>
                  <p className="mt-1 text-sm text-emerald-900">The hub stores only metadata and hints in the UI. Provider adapters should read secrets from secure server-side storage.</p>
                </div>
                <div className="rounded-lg border border-stone-200 bg-white p-4">
                  <ServerCog className="mb-2 h-5 w-5 text-stone-700" />
                  <h3 className="font-bold text-stone-900">Provider-neutral flow</h3>
                  <p className="mt-1 text-sm text-stone-500">Accounting, practice and document modules should call this hub instead of talking to third-party APIs directly.</p>
                </div>
              </div>
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="sync">
          <Panel title="Synchronisation" subtitle="Manual and scheduled sync runs are recorded with totals, status and error detail.">
            <div className="mb-4 flex flex-wrap gap-2">
              {connections.map((connection) => (
                <Button key={connection.id} variant="outline" onClick={() => runSync(connection.id)} className="gap-2">
                  <RefreshCw className="h-4 w-4" /> Sync {connection.provider_name}
                </Button>
              ))}
            </div>
            {syncRuns.length ? (
              <div className="divide-y divide-stone-100">
                {syncRuns.map((run) => (
                  <div key={run.id} className="grid gap-2 py-3 text-sm md:grid-cols-[1fr_120px_120px_120px_160px]">
                    <div>
                      <p className="font-semibold text-stone-900">{run.provider_id}</p>
                      <p className="text-stone-500">{run.started_at}</p>
                    </div>
                    <Badge className={statusClass(run.status)}>{run.status}</Badge>
                    <span>{run.records_processed || 0} records</span>
                    <span>{run.failures || 0} failures</span>
                    <span>{run.duration_ms || 0} ms</span>
                  </div>
                ))}
              </div>
            ) : <EmptyState text="No synchronisation runs recorded yet." />}
          </Panel>
        </TabsContent>

        <TabsContent value="keys">
          <Panel title="API Keys" subtitle="Manage key metadata, rotation dates and expiry warnings without exposing secrets.">
            <div className="mb-5 grid gap-3 rounded-lg border border-stone-200 bg-stone-50 p-4 md:grid-cols-6">
              <ProviderSelect providers={providers} value={keyDraft.provider_id} onChange={(value) => setKeyDraft((current) => ({ ...current, provider_id: value }))} />
              <Input placeholder="Label" value={keyDraft.label} onChange={(event) => setKeyDraft((current) => ({ ...current, label: event.target.value }))} />
              <Input placeholder="API key / client ID" value={keyDraft.api_key} onChange={(event) => setKeyDraft((current) => ({ ...current, api_key: event.target.value }))} />
              <Input placeholder="Secret" type="password" value={keyDraft.api_secret} onChange={(event) => setKeyDraft((current) => ({ ...current, api_secret: event.target.value }))} />
              <Input type="date" value={keyDraft.expires_at} onChange={(event) => setKeyDraft((current) => ({ ...current, expires_at: event.target.value }))} />
              <Button onClick={saveKey} disabled={saving} className="gap-2"><KeyRound className="h-4 w-4" /> Save key</Button>
            </div>
            {apiKeys.length ? (
              <div className="grid gap-3 lg:grid-cols-2">
                {apiKeys.map((key) => (
                  <div key={key.id} className="rounded-lg border border-stone-200 bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-bold text-stone-900">{key.label || key.provider_name}</h3>
                        <p className="text-sm text-stone-500">{key.provider_name} - {key.environment}</p>
                      </div>
                      <Badge className={statusClass(key.status)}>{key.status}</Badge>
                    </div>
                    <p className="mt-3 text-sm text-stone-600">Key {key.key_hint || "saved"} / Secret {key.secret_hint || "saved"}</p>
                    <p className="text-sm text-stone-500">Expires {key.expires_at || "No expiry"} - Rotated {key.rotated_at || "Not rotated"}</p>
                    <Button size="sm" className="mt-3 gap-2" variant="outline" onClick={() => rotateKey(key.id)}>
                      <RotateCcw className="h-4 w-4" /> Record rotation
                    </Button>
                  </div>
                ))}
              </div>
            ) : <EmptyState text="No API key metadata saved yet." />}
          </Panel>
        </TabsContent>

        <TabsContent value="webhooks">
          <Panel title="Webhooks" subtitle="Monitor registered endpoints, failed deliveries, retry counts and replay actions.">
            <div className="mb-5 grid gap-3 rounded-lg border border-stone-200 bg-stone-50 p-4 md:grid-cols-[220px_1fr_220px_150px]">
              <ProviderSelect providers={providers} value={webhookDraft.provider_id} onChange={(value) => setWebhookDraft((current) => ({ ...current, provider_id: value }))} />
              <Input placeholder="Endpoint URL" value={webhookDraft.endpoint_url} onChange={(event) => setWebhookDraft((current) => ({ ...current, endpoint_url: event.target.value }))} />
              <Input placeholder="Event type" value={webhookDraft.event_type} onChange={(event) => setWebhookDraft((current) => ({ ...current, event_type: event.target.value }))} />
              <Button onClick={saveWebhook} disabled={saving} className="gap-2"><Webhook className="h-4 w-4" /> Save</Button>
            </div>
            {webhooks.length ? webhooks.map((hook) => (
              <div key={hook.id} className="mb-3 rounded-lg border border-stone-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="font-bold text-stone-900">{hook.provider_name}</h3>
                    <p className="text-sm text-stone-500">{hook.event_type} - {hook.endpoint_url}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={statusClass(hook.status)}>{hook.status}</Badge>
                    <Button size="sm" variant="outline" onClick={() => replayWebhook(hook.id)}>Replay</Button>
                  </div>
                </div>
                <p className="mt-2 text-sm text-stone-500">Last delivery {hook.last_delivery_at || "None"} - Failures {hook.failures || 0} - Retries {hook.retry_count || 0}</p>
              </div>
            )) : <EmptyState text="No webhooks registered yet." />}
          </Panel>
        </TabsContent>

        <TabsContent value="logs">
          <Panel title="Integration logs" subtitle="Complete provider action log with status, duration and error detail.">
            {logs.length ? (
              <div className="divide-y divide-stone-100">
                {logs.map((log) => (
                  <div key={log.id} className="grid gap-2 py-3 text-sm md:grid-cols-[180px_1fr_120px_120px]">
                    <span className="text-stone-500">{log.created_at}</span>
                    <span><strong>{log.provider_id || "hub"}</strong> - {log.action}{log.error_details ? ` - ${log.error_details}` : ""}</span>
                    <Badge className={statusClass(log.status)}>{log.status}</Badge>
                    <span>{log.duration_ms || 0} ms</span>
                  </div>
                ))}
              </div>
            ) : <EmptyState text="No logs yet." />}
          </Panel>
        </TabsContent>

        <TabsContent value="settings">
          <Panel title="Settings" subtitle="Default sync behaviour, retry policy, timeout and audit retention.">
            <div className="grid max-w-4xl gap-4 md:grid-cols-2">
              <div>
                <Label>Default sync frequency</Label>
                <select className="mt-1 h-10 w-full rounded-md border border-stone-200 bg-white px-3 text-sm shadow-sm" value={settingsDraft.default_sync_frequency || "manual"} onChange={(event) => setSettingsDraft((current) => ({ ...current, default_sync_frequency: event.target.value }))}>
                  <option value="manual">Manual</option>
                  <option value="hourly">Hourly</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                </select>
              </div>
              <div>
                <Label>Notification preferences</Label>
                <Input className="mt-1" value={settingsDraft.notification_preferences || ""} onChange={(event) => setSettingsDraft((current) => ({ ...current, notification_preferences: event.target.value }))} />
              </div>
              <div>
                <Label>Retry policy</Label>
                <Input className="mt-1" value={settingsDraft.retry_policy || ""} onChange={(event) => setSettingsDraft((current) => ({ ...current, retry_policy: event.target.value }))} />
              </div>
              <div>
                <Label>Timeout seconds</Label>
                <Input className="mt-1" type="number" value={settingsDraft.timeout_seconds || 30} onChange={(event) => setSettingsDraft((current) => ({ ...current, timeout_seconds: event.target.value }))} />
              </div>
              <div>
                <Label>Audit retention days</Label>
                <Input className="mt-1" type="number" value={settingsDraft.audit_retention_days || 365} onChange={(event) => setSettingsDraft((current) => ({ ...current, audit_retention_days: event.target.value }))} />
              </div>
            </div>
            <Button onClick={saveSettings} disabled={saving} className="mt-5 gap-2"><Save className="h-4 w-4" /> Save settings</Button>
          </Panel>
        </TabsContent>
      </Tabs>
    </div>
  );
}
