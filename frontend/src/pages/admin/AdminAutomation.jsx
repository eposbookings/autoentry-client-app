import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Copy,
  GitBranch,
  History,
  Play,
  Plus,
  RefreshCw,
  Settings,
  ShieldCheck,
  Sparkles,
  Workflow,
} from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const emptyWorkspace = {
  dashboard: {},
  workflows: [],
  runs: [],
  approvals: [],
  exceptions: [],
  templates: [],
  settings: {},
  recommendations: [],
  performance: [],
  catalog: { triggers: [], actions: [], conditions: [] },
};

const initialBuilder = {
  name: "",
  description: "",
  trigger_type: "document_uploaded",
  condition_field: "confidence_score",
  condition_operator: ">=",
  condition_value: "95",
  action_type: "request_approval",
  action_target: "manager",
  approval_required: true,
  time_saved_minutes: 10,
};

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function statusClass(status) {
  if (["active", "completed", "approved", "resolved"].includes(status)) return "bg-emerald-100 text-emerald-800";
  if (["pending", "waiting_approval", "queued", "draft"].includes(status)) return "bg-amber-100 text-amber-800";
  if (["failed", "rejected", "open"].includes(status)) return "bg-red-100 text-red-800";
  return "bg-stone-100 text-stone-700";
}

function KpiCard({ label, value, icon: Icon, tone = "emerald" }) {
  const tones = {
    emerald: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    amber: "bg-amber-50 text-amber-700 ring-amber-100",
    red: "bg-red-50 text-red-700 ring-red-100",
    stone: "bg-stone-100 text-stone-600 ring-stone-200",
  };
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-[0_3px_12px_rgba(28,25,23,0.06)]">
      <div className="flex items-center gap-3">
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ring-1 ${tones[tone] || tones.stone}`}>
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-stone-500">{label}</p>
          <p className="mt-1 truncate font-display text-xl font-bold text-stone-950">{value ?? 0}</p>
        </div>
      </div>
    </div>
  );
}

function Panel({ title, children, action }) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-stone-100 px-4 py-3">
        <h2 className="font-display text-base font-bold text-stone-900">{title}</h2>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function EmptyState({ text }) {
  return <div className="rounded-lg border border-dashed border-stone-200 bg-stone-50 px-4 py-8 text-center text-sm text-stone-500">{text}</div>;
}

function WorkflowMiniMap({ workflow }) {
  const blocks = safeArray(workflow?.blocks);
  const visible = blocks.length ? blocks : ["Trigger", "Condition", "Action"];
  return (
    <div className="flex flex-wrap items-center gap-2">
      {visible.map((block, index) => (
        <React.Fragment key={`${block}-${index}`}>
          <span className="rounded-md border border-emerald-100 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-900">{block}</span>
          {index < visible.length - 1 && <span className="text-stone-300">→</span>}
        </React.Fragment>
      ))}
    </div>
  );
}

export default function AdminAutomation() {
  const [workspace, setWorkspace] = useState(emptyWorkspace);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [builder, setBuilder] = useState(initialBuilder);
  const [settingsDraft, setSettingsDraft] = useState({});

  const triggers = safeArray(workspace.catalog?.triggers);
  const actions = safeArray(workspace.catalog?.actions);
  const conditions = safeArray(workspace.catalog?.conditions);
  const workflows = safeArray(workspace.workflows);
  const runs = safeArray(workspace.runs);
  const approvals = safeArray(workspace.approvals);
  const exceptions = safeArray(workspace.exceptions);
  const templates = safeArray(workspace.templates);

  const pendingApprovals = useMemo(() => approvals.filter((approval) => approval.status === "pending"), [approvals]);
  const openExceptions = useMemo(() => exceptions.filter((item) => item.status !== "resolved"), [exceptions]);

  async function loadWorkspace() {
    try {
      const { data } = await api.get("/admin/automation");
      setWorkspace({ ...emptyWorkspace, ...(data || {}) });
      setSettingsDraft(data?.settings || {});
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadWorkspace();
  }, []);

  function updateBuilder(field, value) {
    setBuilder((current) => ({ ...current, [field]: value }));
  }

  async function createWorkflow() {
    if (!builder.name.trim()) {
      toast.error("Workflow name is required.");
      return;
    }
    setSaving(true);
    try {
      const selectedTrigger = triggers.find((trigger) => trigger.id === builder.trigger_type);
      const selectedAction = actions.find((action) => action.id === builder.action_type);
      const payload = {
        name: builder.name,
        description: builder.description,
        trigger_type: builder.trigger_type,
        approval_required: builder.approval_required,
        time_saved_minutes: Number(builder.time_saved_minutes || 0),
        blocks: [
          selectedTrigger?.label || "Trigger",
          "Evaluate conditions",
          builder.approval_required ? "Approval queue" : "Run action",
          selectedAction?.label || "Action",
        ],
        conditions: [
          {
            field: builder.condition_field,
            operator: builder.condition_operator,
            value: builder.condition_value,
            logic: "AND",
          },
        ],
        actions: [
          {
            type: builder.action_type,
            target: builder.action_target || "existing module service",
          },
        ],
      };
      await api.post("/admin/automation/workflows", payload);
      toast.success("Workflow created");
      setBuilder(initialBuilder);
      await loadWorkspace();
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setSaving(false);
    }
  }

  async function updateWorkflow(workflow, values) {
    try {
      const { data } = await api.put(`/admin/automation/workflows/${workflow.id}`, { ...workflow, ...values });
      const updated = data?.workflow;
      setWorkspace((current) => ({
        ...current,
        workflows: safeArray(current.workflows).map((item) => (item.id === workflow.id ? updated : item)),
      }));
      toast.success("Workflow updated");
    } catch (err) {
      toast.error(formatApiError(err));
    }
  }

  async function runWorkflow(workflow) {
    try {
      const { data } = await api.post(`/admin/automation/workflows/${workflow.id}/execute`, { manual: true });
      setWorkspace(data?.workspace || workspace);
      toast.success(data?.run?.status === "waiting_approval" ? "Workflow paused for approval" : "Workflow executed");
    } catch (err) {
      toast.error(formatApiError(err));
    }
  }

  async function resolveApproval(approval, action) {
    try {
      const { data } = await api.post(`/admin/automation/approvals/${approval.id}/${action}`, {});
      setWorkspace(data || workspace);
      toast.success(action === "approve" ? "Approval accepted" : "Approval rejected");
    } catch (err) {
      toast.error(formatApiError(err));
    }
  }

  async function resolveException(exception, action) {
    try {
      const { data } = await api.post(`/admin/automation/exceptions/${exception.id}/${action}`, {});
      setWorkspace(data || workspace);
      toast.success(action === "retry" ? "Retry queued" : "Exception resolved");
    } catch (err) {
      toast.error(formatApiError(err));
    }
  }

  async function duplicateTemplate(template) {
    try {
      await api.post(`/admin/automation/templates/${template.id}/duplicate`, {});
      toast.success("Template copied into workflow drafts");
      await loadWorkspace();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  }

  async function saveSettings() {
    try {
      const { data } = await api.put("/admin/automation/settings", settingsDraft);
      setWorkspace(data || workspace);
      toast.success("Automation settings saved");
    } catch (err) {
      toast.error(formatApiError(err));
    }
  }

  if (loading) {
    return <div className="p-8 text-sm text-stone-500">Loading automation workspace...</div>;
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-24px)] max-w-[1720px] flex-col gap-3 overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-100 bg-gradient-to-r from-emerald-50 via-white to-cyan-50 px-5 py-4 shadow-sm">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">
            <Workflow className="h-4 w-4" /> Platform orchestration
          </div>
          <h1 className="font-display text-3xl font-bold text-stone-950">Automation</h1>
          <p className="text-sm text-stone-600">Build transparent workflows across practice management, documents, portal and native accounting.</p>
        </div>
        <Button onClick={loadWorkspace} variant="outline" className="gap-2">
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </header>

      <Tabs defaultValue="dashboard" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 rounded-lg bg-stone-100 p-1 md:grid-cols-4 xl:grid-cols-8">
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="builder">Workflow Builder</TabsTrigger>
          <TabsTrigger value="rules">Automation Rules</TabsTrigger>
          <TabsTrigger value="approvals">Approval Queues</TabsTrigger>
          <TabsTrigger value="exceptions">Exceptions</TabsTrigger>
          <TabsTrigger value="history">Execution History</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <div className="min-h-0 flex-1 overflow-auto pb-4">
          <TabsContent value="dashboard" className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
              <KpiCard label="Active Automations" value={workspace.dashboard?.active_automations} icon={Workflow} />
              <KpiCard label="Executed Today" value={workspace.dashboard?.executed_today} icon={Play} />
              <KpiCard label="Pending Approvals" value={workspace.dashboard?.pending_approvals} icon={ShieldCheck} tone="amber" />
              <KpiCard label="Failed Automations" value={workspace.dashboard?.failed_automations} icon={AlertTriangle} tone="red" />
              <KpiCard label="Time Saved" value={`${workspace.dashboard?.time_saved_minutes ?? 0}m`} icon={Sparkles} />
              <KpiCard label="Exception Rate" value={`${workspace.dashboard?.exception_rate ?? 0}%`} icon={History} tone="stone" />
            </div>
            <div className="grid gap-3 xl:grid-cols-3">
              <Panel title="Recent Executions">
                {runs.length ? runs.slice(0, 6).map((run) => (
                  <div key={run.id} className="flex items-center justify-between gap-3 border-b border-stone-100 py-2 last:border-b-0">
                    <div>
                      <p className="font-semibold text-stone-900">{run.workflow_name || "Workflow"}</p>
                      <p className="text-xs text-stone-500">{run.trigger_type} · {run.started_at?.slice(0, 16) || "-"}</p>
                    </div>
                    <Badge className={statusClass(run.status)}>{run.status}</Badge>
                  </div>
                )) : <EmptyState text="No executions yet." />}
              </Panel>
              <Panel title="Pending Reviews">
                {pendingApprovals.length ? pendingApprovals.slice(0, 6).map((approval) => (
                  <div key={approval.id} className="rounded-md border border-amber-100 bg-amber-50 p-3">
                    <p className="font-semibold text-amber-950">{approval.title}</p>
                    <p className="mt-1 text-xs text-amber-800">{approval.summary}</p>
                  </div>
                )) : <EmptyState text="No approvals waiting." />}
              </Panel>
              <Panel title="Workflow Performance">
                {safeArray(workspace.performance).map((item) => (
                  <div key={item.label} className="flex items-center justify-between gap-3 border-b border-stone-100 py-2 last:border-b-0">
                    <div>
                      <p className="font-semibold text-stone-900">{item.label}</p>
                      <p className="text-xs text-stone-500">Average duration {item.avg_duration}</p>
                    </div>
                    <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-800">{item.success_rate}%</span>
                  </div>
                ))}
              </Panel>
            </div>
            <Panel title="AI Automation Recommendations">
              <div className="grid gap-3 md:grid-cols-3">
                {safeArray(workspace.recommendations).map((item) => (
                  <div key={item.title} className="rounded-lg border border-cyan-100 bg-cyan-50 p-4">
                    <div className="flex items-start gap-2">
                      <Sparkles className="mt-0.5 h-4 w-4 text-cyan-700" />
                      <div>
                        <p className="font-semibold text-cyan-950">{item.title}</p>
                        <p className="mt-1 text-sm text-cyan-800">{item.message}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          </TabsContent>

          <TabsContent value="builder" className="grid gap-3 xl:grid-cols-[420px_1fr]">
            <Panel title="Create Workflow" action={<Badge className="bg-emerald-100 text-emerald-800">Visual blocks</Badge>}>
              <div className="space-y-3">
                <div>
                  <Label>Name</Label>
                  <Input value={builder.name} onChange={(e) => updateBuilder("name", e.target.value)} placeholder="Purchase invoice automation" />
                </div>
                <div>
                  <Label>Description</Label>
                  <Input value={builder.description} onChange={(e) => updateBuilder("description", e.target.value)} placeholder="What this workflow controls" />
                </div>
                <div>
                  <Label>Trigger</Label>
                  <select className="h-10 w-full rounded-md border border-stone-200 bg-white px-3 text-sm" value={builder.trigger_type} onChange={(e) => updateBuilder("trigger_type", e.target.value)}>
                    {triggers.map((trigger) => <option key={trigger.id} value={trigger.id}>{trigger.label}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <Label>Condition</Label>
                    <select className="h-10 w-full rounded-md border border-stone-200 bg-white px-3 text-sm" value={builder.condition_field} onChange={(e) => updateBuilder("condition_field", e.target.value)}>
                      {conditions.map((condition) => <option key={condition.id} value={condition.id}>{condition.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <Label>Rule</Label>
                    <Input value={builder.condition_operator} onChange={(e) => updateBuilder("condition_operator", e.target.value)} />
                  </div>
                  <div>
                    <Label>Value</Label>
                    <Input value={builder.condition_value} onChange={(e) => updateBuilder("condition_value", e.target.value)} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label>Action</Label>
                    <select className="h-10 w-full rounded-md border border-stone-200 bg-white px-3 text-sm" value={builder.action_type} onChange={(e) => updateBuilder("action_type", e.target.value)}>
                      {actions.map((action) => <option key={action.id} value={action.id}>{action.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <Label>Target</Label>
                    <Input value={builder.action_target} onChange={(e) => updateBuilder("action_target", e.target.value)} />
                  </div>
                </div>
                <label className="flex items-center gap-2 rounded-md bg-stone-50 px-3 py-2 text-sm font-semibold text-stone-700">
                  <input type="checkbox" checked={builder.approval_required} onChange={(e) => updateBuilder("approval_required", e.target.checked)} />
                  Pause for approval
                </label>
                <Button onClick={createWorkflow} disabled={saving} className="w-full gap-2">
                  <Plus className="h-4 w-4" /> Create workflow
                </Button>
              </div>
            </Panel>
            <Panel title="Workflow Preview">
              <div className="rounded-xl border border-emerald-100 bg-gradient-to-br from-emerald-50 to-white p-5">
                <div className="flex flex-col items-center gap-3 text-center">
                  {[builder.trigger_type, "Evaluate condition", builder.approval_required ? "Manager approval" : "Continue", builder.action_type].map((block, index) => (
                    <React.Fragment key={`${block}-${index}`}>
                      <div className="w-full max-w-md rounded-lg border border-white bg-white px-4 py-3 text-sm font-bold text-stone-900 shadow-sm">{block.replaceAll("_", " ")}</div>
                      {index < 3 && <GitBranch className="h-5 w-5 text-emerald-700" />}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </Panel>
          </TabsContent>

          <TabsContent value="rules">
            <Panel title="Automation Rules">
              <div className="grid gap-3 xl:grid-cols-2">
                {workflows.length ? workflows.map((workflow) => (
                  <div key={workflow.id} className="flex min-h-[230px] flex-col rounded-xl border border-stone-200 bg-white p-4 shadow-[0_3px_12px_rgba(28,25,23,0.07)]">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
                          <Workflow className="h-6 w-6" />
                        </span>
                        <div className="min-w-0 pt-0.5">
                          <h3 className="truncate font-display text-base font-bold text-stone-950">{workflow.name}</h3>
                          <p className="mt-1 line-clamp-2 text-sm text-stone-500">{workflow.description || "No description"}</p>
                          <p className="mt-1.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">Automation rule</p>
                        </div>
                      </div>
                      <Badge className={statusClass(workflow.status)}>{workflow.status}</Badge>
                    </div>
                    <div className="mt-4 border-t border-stone-200 pt-3"><WorkflowMiniMap workflow={workflow} /></div>
                    <div className="mt-auto flex flex-wrap gap-2 border-t border-stone-100 pt-3">
                      <Button variant="outline" className="gap-2" onClick={() => updateWorkflow(workflow, { status: workflow.status === "active" ? "paused" : "active" })}>
                        {workflow.status === "active" ? "Pause" : "Enable"}
                      </Button>
                      <Button className="gap-2" onClick={() => runWorkflow(workflow)} disabled={workflow.status !== "active"}>
                        <Play className="h-4 w-4" /> Run now
                      </Button>
                    </div>
                  </div>
                )) : <EmptyState text="No workflows yet. Create one in Workflow Builder or copy a template." />}
              </div>
            </Panel>
          </TabsContent>

          <TabsContent value="approvals">
            <Panel title="Approval Queues">
              <div className="space-y-3">
                {pendingApprovals.length ? pendingApprovals.map((approval) => (
                  <div key={approval.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-100 bg-amber-50 p-4">
                    <div>
                      <p className="font-bold text-amber-950">{approval.title}</p>
                      <p className="text-sm text-amber-800">{approval.summary}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={() => resolveApproval(approval, "reject")}>Reject</Button>
                      <Button onClick={() => resolveApproval(approval, "approve")} className="gap-2"><CheckCircle2 className="h-4 w-4" /> Approve</Button>
                    </div>
                  </div>
                )) : <EmptyState text="No approvals pending." />}
              </div>
            </Panel>
          </TabsContent>

          <TabsContent value="exceptions">
            <Panel title="Exceptions">
              <div className="space-y-3">
                {openExceptions.length ? openExceptions.map((item) => (
                  <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-100 bg-red-50 p-4">
                    <div>
                      <p className="font-bold text-red-950">{item.exception_type}</p>
                      <p className="text-sm text-red-800">{item.message}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={() => resolveException(item, "resolve")}>Resolve</Button>
                      <Button onClick={() => resolveException(item, "retry")} className="gap-2"><RefreshCw className="h-4 w-4" /> Retry</Button>
                    </div>
                  </div>
                )) : <EmptyState text="No open exceptions." />}
              </div>
            </Panel>
          </TabsContent>

          <TabsContent value="history">
            <Panel title="Execution History">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-stone-500">
                    <tr><th className="py-2">Workflow</th><th>Trigger</th><th>Status</th><th>Result</th><th>Duration</th><th>Started</th></tr>
                  </thead>
                  <tbody>
                    {runs.map((run) => (
                      <tr key={run.id} className="border-t border-stone-100">
                        <td className="py-3 font-semibold">{run.workflow_name}</td>
                        <td>{run.trigger_type}</td>
                        <td><Badge className={statusClass(run.status)}>{run.status}</Badge></td>
                        <td>{run.result}</td>
                        <td>{run.duration_ms ?? 0}ms</td>
                        <td>{run.started_at?.slice(0, 16) || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!runs.length && <EmptyState text="No execution history yet." />}
              </div>
            </Panel>
          </TabsContent>

          <TabsContent value="templates">
            <Panel title="Templates">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {templates.map((template) => (
                  <div key={template.id} className="flex min-h-[230px] flex-col rounded-xl border border-stone-200 bg-white p-4 shadow-[0_3px_12px_rgba(28,25,23,0.07)]">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
                          <Copy className="h-6 w-6" />
                        </span>
                        <div className="min-w-0 pt-0.5">
                          <h3 className="truncate font-display text-base font-bold text-stone-950">{template.name}</h3>
                          <p className="mt-1.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">Workflow template</p>
                          <Badge className="mt-2 bg-stone-100 text-stone-700">{template.category}</Badge>
                        </div>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => duplicateTemplate(template)} className="gap-2"><Copy className="h-4 w-4" /> Copy</Button>
                    </div>
                    <p className="mt-3 line-clamp-2 text-sm text-stone-600">{template.description}</p>
                    <div className="mt-auto border-t border-stone-200 pt-3"><WorkflowMiniMap workflow={template} /></div>
                  </div>
                ))}
              </div>
            </Panel>
          </TabsContent>

          <TabsContent value="settings">
            <Panel title="Automation Settings" action={<Settings className="h-4 w-4 text-stone-500" />}>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <label className="flex items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm font-semibold">
                  <input type="checkbox" checked={settingsDraft.approval_required_by_default !== false} onChange={(e) => setSettingsDraft((cur) => ({ ...cur, approval_required_by_default: e.target.checked }))} />
                  Approval required by default
                </label>
                <label className="flex items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm font-semibold">
                  <input type="checkbox" checked={!!settingsDraft.auto_retry_enabled} onChange={(e) => setSettingsDraft((cur) => ({ ...cur, auto_retry_enabled: e.target.checked }))} />
                  Auto retry enabled
                </label>
                <div>
                  <Label>Default assignee</Label>
                  <Input value={settingsDraft.default_assignee || "admin"} onChange={(e) => setSettingsDraft((cur) => ({ ...cur, default_assignee: e.target.value }))} />
                </div>
                <div>
                  <Label>Recommendation mode</Label>
                  <Input value={settingsDraft.recommendation_mode || "rule_based"} onChange={(e) => setSettingsDraft((cur) => ({ ...cur, recommendation_mode: e.target.value }))} />
                </div>
                <div>
                  <Label>Permission mode</Label>
                  <Input value={settingsDraft.permission_mode || "admin_only"} onChange={(e) => setSettingsDraft((cur) => ({ ...cur, permission_mode: e.target.value }))} />
                </div>
                <div>
                  <Label>Execution retention days</Label>
                  <Input type="number" value={settingsDraft.execution_retention_days || 365} onChange={(e) => setSettingsDraft((cur) => ({ ...cur, execution_retention_days: Number(e.target.value) }))} />
                </div>
              </div>
              <Button onClick={saveSettings} className="mt-4 gap-2"><Bell className="h-4 w-4" /> Save settings</Button>
            </Panel>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
