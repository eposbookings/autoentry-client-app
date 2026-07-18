import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bell,
  BriefcaseBusiness,
  ClipboardCheck,
  Database,
  FileSearch,
  LockKeyhole,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const emptyPlatform = {
  dashboard: {},
  permissions: { modules: [], actions: [], roles: [] },
  jobs: [],
  notifications: [],
  activity: [],
  errors: [],
  health: {},
  search: { results: [] },
  api: {},
  testing: { critical_flows: [] },
};

const initialRole = { name: "", description: "" };
const initialJob = { job_type: "ai_processing", module: "submitted_items", description: "" };
const initialNotification = { title: "", message: "", module: "platform", severity: "info" };

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function statusClass(status) {
  if (["healthy", "completed", "read", "active"].includes(String(status || "").toLowerCase())) return "bg-emerald-100 text-emerald-800";
  if (["queued", "running", "attention", "unread", "warning"].includes(String(status || "").toLowerCase())) return "bg-amber-100 text-amber-800";
  if (["failed", "error"].includes(String(status || "").toLowerCase())) return "bg-red-100 text-red-800";
  return "bg-stone-100 text-stone-700";
}

function Kpi({ label, value, icon: Icon, tone = "emerald" }) {
  const tones = {
    emerald: "border-emerald-100 bg-emerald-50 text-emerald-950",
    amber: "border-amber-100 bg-amber-50 text-amber-950",
    red: "border-red-100 bg-red-50 text-red-950",
    stone: "border-stone-100 bg-stone-50 text-stone-950",
  };
  return (
    <div className={`rounded-lg border p-4 shadow-sm ${tones[tone] || tones.stone}`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide opacity-70">{label}</p>
          <p className="mt-2 font-display text-2xl font-bold">{value ?? 0}</p>
        </div>
        <Icon className="h-5 w-5 opacity-70" />
      </div>
    </div>
  );
}

function Panel({ title, children, action }) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-stone-100 px-4 py-3">
        <h2 className="font-display text-base font-semibold text-stone-950">{title}</h2>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Empty({ text }) {
  return <p className="py-8 text-center text-sm text-stone-500">{text}</p>;
}

function Row({ title, subtitle, badge, action }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-stone-100 py-3 last:border-b-0">
      <div className="min-w-0">
        <p className="truncate font-semibold text-stone-900">{title}</p>
        {subtitle && <p className="mt-1 truncate text-xs text-stone-500">{subtitle}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {badge && <Badge className={statusClass(badge)}>{badge}</Badge>}
        {action}
      </div>
    </div>
  );
}

export default function AdminPlatform() {
  const [workspace, setWorkspace] = useState(emptyPlatform);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("dashboard");
  const [query, setQuery] = useState("");
  const [roleDraft, setRoleDraft] = useState(initialRole);
  const [jobDraft, setJobDraft] = useState(initialJob);
  const [notificationDraft, setNotificationDraft] = useState(initialNotification);

  async function load(search = query) {
    try {
      const { data } = await api.get("/admin/platform", { params: search ? { q: search } : {} });
      setWorkspace({ ...emptyPlatform, ...data });
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load("");
  }, []);

  const dashboard = workspace.dashboard || {};
  const permissions = workspace.permissions || {};
  const modules = safeArray(permissions.modules);
  const actions = safeArray(permissions.actions);
  const roles = safeArray(permissions.roles);

  const healthRows = useMemo(() => Object.entries(workspace.health || {}).map(([key, value]) => ({
    component: key,
    ...(value || {}),
  })), [workspace.health]);

  async function createRole() {
    try {
      await api.post("/admin/platform/roles", roleDraft);
      setRoleDraft(initialRole);
      toast.success("Role created");
      load();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  }

  async function queueJob() {
    try {
      await api.post("/admin/platform/jobs", jobDraft);
      setJobDraft(initialJob);
      toast.success("Job queued");
      load();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  }

  async function jobAction(id, action) {
    try {
      await api.post(`/admin/platform/jobs/${id}/${action}`, {});
      toast.success(`Job ${action} recorded`);
      load();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  }

  async function createNotification() {
    try {
      await api.post("/admin/platform/notifications", notificationDraft);
      setNotificationDraft(initialNotification);
      toast.success("Notification created");
      load();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  }

  async function markRead(id) {
    try {
      await api.post(`/admin/platform/notifications/${id}/read`, {});
      load();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  }

  async function runSearch(event) {
    event?.preventDefault();
    setTab("search");
    await load(query);
  }

  if (loading) return <div className="p-6 text-stone-500">Loading platform readiness...</div>;

  return (
    <div className="mx-auto max-w-[1700px] space-y-4 p-2 sm:p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold text-stone-950">Platform hardening</h1>
          <p className="text-sm text-stone-500">Security, jobs, notifications, search, health, errors, API readiness and testing.</p>
        </div>
        <form onSubmit={runSearch} className="flex w-full gap-2 lg:max-w-xl">
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search invoice, journal, supplier, bank transaction..." />
          <Button type="submit" className="gap-2"><Search className="h-4 w-4" /> Search</Button>
          <Button type="button" variant="outline" onClick={() => load(query)} className="gap-2"><RefreshCw className="h-4 w-4" /> Refresh</Button>
        </form>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex h-auto flex-wrap justify-start">
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="permissions">Permissions</TabsTrigger>
          <TabsTrigger value="jobs">Jobs</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="search">Search</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="health">Health</TabsTrigger>
          <TabsTrigger value="errors">Errors</TabsTrigger>
          <TabsTrigger value="api">API & tests</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label="Custom roles" value={dashboard.roles} icon={ShieldCheck} />
            <Kpi label="Queued jobs" value={dashboard.queued_jobs} icon={BriefcaseBusiness} tone="amber" />
            <Kpi label="Failed jobs" value={dashboard.failed_jobs} icon={AlertTriangle} tone={dashboard.failed_jobs ? "red" : "stone"} />
            <Kpi label="Unread notifications" value={dashboard.unread_notifications} icon={Bell} />
            <Kpi label="Recent activity" value={dashboard.recent_activity} icon={Activity} />
            <Kpi label="Errors logged" value={dashboard.open_errors} icon={FileSearch} tone={dashboard.open_errors ? "amber" : "stone"} />
            <Kpi label="Running jobs" value={dashboard.running_jobs} icon={Play} />
            <Kpi label="Permission actions" value={actions.length} icon={LockKeyhole} />
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <Panel title="Recent activity">
              {safeArray(workspace.activity).slice(0, 8).map((item) => <Row key={item.id} title={item.summary || item.action} subtitle={`${item.module || "platform"} · ${item.created_at || ""}`} />)}
              {!safeArray(workspace.activity).length && <Empty text="No platform activity recorded yet." />}
            </Panel>
            <Panel title="System health">
              {healthRows.map((item) => <Row key={item.component} title={item.component} subtitle={item.checked_at || `Backlog: ${item.backlog ?? item.processing_backlog ?? "-"}`} badge={item.status} />)}
            </Panel>
          </div>
        </TabsContent>

        <TabsContent value="permissions" className="space-y-4">
          <Panel title="Create role" action={<Badge>{roles.length} roles</Badge>}>
            <div className="grid gap-3 lg:grid-cols-[1fr_2fr_auto]">
              <Input value={roleDraft.name} onChange={(event) => setRoleDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Role name" />
              <Input value={roleDraft.description} onChange={(event) => setRoleDraft((current) => ({ ...current, description: event.target.value }))} placeholder="Description" />
              <Button onClick={createRole}>Create role</Button>
            </div>
          </Panel>
          <Panel title="Permission matrix">
            <div className="overflow-auto">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead>
                  <tr className="border-b text-xs uppercase text-stone-500">
                    <th className="py-2">Role</th>
                    {modules.map((module) => <th key={module} className="px-2 py-2">{module.replaceAll("_", " ")}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {roles.map((role) => (
                    <tr key={role.id} className="border-b align-top">
                      <td className="w-56 py-3 pr-3">
                        <p className="font-semibold">{role.name}</p>
                        <p className="text-xs text-stone-500">{role.description}</p>
                      </td>
                      {modules.map((module) => (
                        <td key={module} className="px-2 py-3">
                          <div className="flex max-w-48 flex-wrap gap-1">
                            {safeArray(role.permissions?.[module]).map((action) => <Badge key={action} variant="secondary" className="text-[10px]">{action}</Badge>)}
                          </div>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="jobs" className="space-y-4">
          <Panel title="Queue background job">
            <div className="grid gap-3 lg:grid-cols-[1fr_1fr_2fr_auto]">
              <Input value={jobDraft.job_type} onChange={(event) => setJobDraft((current) => ({ ...current, job_type: event.target.value }))} placeholder="Job type" />
              <Input value={jobDraft.module} onChange={(event) => setJobDraft((current) => ({ ...current, module: event.target.value }))} placeholder="Module" />
              <Input value={jobDraft.description} onChange={(event) => setJobDraft((current) => ({ ...current, description: event.target.value }))} placeholder="Description" />
              <Button onClick={queueJob}>Queue</Button>
            </div>
          </Panel>
          <Panel title="Job queue">
            {safeArray(workspace.jobs).map((job) => (
              <Row
                key={job.id}
                title={job.description || job.job_type}
                subtitle={`${job.module} · ${job.progress}% · ${job.correlation_id || "no correlation"}`}
                badge={job.status}
                action={<div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => jobAction(job.id, "start")}>Start</Button><Button size="sm" variant="outline" onClick={() => jobAction(job.id, "complete")}>Complete</Button><Button size="sm" variant="outline" onClick={() => jobAction(job.id, "retry")}>Retry</Button></div>}
              />
            ))}
            {!safeArray(workspace.jobs).length && <Empty text="No background jobs yet." />}
          </Panel>
        </TabsContent>

        <TabsContent value="notifications" className="space-y-4">
          <Panel title="Create notification">
            <div className="grid gap-3 lg:grid-cols-[1fr_2fr_1fr_1fr_auto]">
              <Input value={notificationDraft.title} onChange={(event) => setNotificationDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Title" />
              <Input value={notificationDraft.message} onChange={(event) => setNotificationDraft((current) => ({ ...current, message: event.target.value }))} placeholder="Message" />
              <Input value={notificationDraft.module} onChange={(event) => setNotificationDraft((current) => ({ ...current, module: event.target.value }))} placeholder="Module" />
              <select className="h-10 rounded-md border border-input bg-background px-3" value={notificationDraft.severity} onChange={(event) => setNotificationDraft((current) => ({ ...current, severity: event.target.value }))}>
                <option value="info">Info</option>
                <option value="warning">Warning</option>
                <option value="error">Error</option>
                <option value="success">Success</option>
              </select>
              <Button onClick={createNotification}>Create</Button>
            </div>
          </Panel>
          <Panel title="Notification centre">
            {safeArray(workspace.notifications).map((item) => <Row key={item.id} title={item.title} subtitle={`${item.message || ""} · ${item.module || "platform"}`} badge={item.status} action={item.status !== "read" && <Button size="sm" variant="outline" onClick={() => markRead(item.id)}>Mark read</Button>} />)}
            {!safeArray(workspace.notifications).length && <Empty text="No notifications yet." />}
          </Panel>
        </TabsContent>

        <TabsContent value="search">
          <Panel title="Platform-wide search">
            {safeArray(workspace.search?.results).map((item, index) => <Row key={`${item.type}-${item.record_id}-${index}`} title={item.title || item.record_id} subtitle={`${item.type} · ${item.module}`} badge={item.type} />)}
            {!safeArray(workspace.search?.results).length && <Empty text="Search for an invoice number, supplier, journal, bank reference or document." />}
          </Panel>
        </TabsContent>

        <TabsContent value="activity">
          <Panel title="Global activity feed">
            {safeArray(workspace.activity).map((item) => <Row key={item.id} title={item.summary || item.action} subtitle={`${item.module} · ${item.record_id || ""} · ${item.created_at || ""}`} badge={item.action} />)}
            {!safeArray(workspace.activity).length && <Empty text="No activity recorded yet." />}
          </Panel>
        </TabsContent>

        <TabsContent value="health">
          <Panel title="System health dashboard">
            <div className="grid gap-3 lg:grid-cols-2">
              {healthRows.map((item) => (
                <div key={item.component} className="rounded-lg border bg-stone-50 p-4">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold capitalize">{item.component.replaceAll("_", " ")}</p>
                    <Badge className={statusClass(item.status)}>{item.status || "unknown"}</Badge>
                  </div>
                  <pre className="mt-3 overflow-auto rounded bg-white p-3 text-xs text-stone-600">{JSON.stringify(item, null, 2)}</pre>
                </div>
              ))}
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="errors">
          <Panel title="Error handling and correlation IDs">
            {safeArray(workspace.errors).map((item) => <Row key={item.id} title={`${item.status_code || ""} ${item.path || ""}`} subtitle={`${item.message || ""} · correlation ${item.correlation_id || "-"}`} badge={item.method} />)}
            {!safeArray(workspace.errors).length && <Empty text="No server-side errors logged yet." />}
          </Panel>
        </TabsContent>

        <TabsContent value="api" className="space-y-4">
          <Panel title="API layer">
            <div className="grid gap-3 md:grid-cols-3">
              <Kpi label="Current prefix" value={workspace.api?.current_prefix || "/api"} icon={Database} tone="stone" />
              <Kpi label="Version target" value={workspace.api?.recommended_prefix || "/api/v1"} icon={ClipboardCheck} />
              <Kpi label="OpenAPI docs" value={workspace.api?.docs_url || "/docs"} icon={FileSearch} />
            </div>
          </Panel>
          <Panel title="Automated testing focus">
            {safeArray(workspace.testing?.critical_flows).map((flow) => <Row key={flow} title={flow} subtitle="Critical end-to-end scenario" badge="E2E" />)}
            <div className="mt-4 rounded-lg bg-emerald-50 p-4 text-sm text-emerald-900">
              {workspace.testing?.coverage_target}
            </div>
          </Panel>
        </TabsContent>
      </Tabs>
    </div>
  );
}
