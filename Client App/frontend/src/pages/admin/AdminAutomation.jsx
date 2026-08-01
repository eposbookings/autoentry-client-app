import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Copy,
  GitBranch,
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
import { formatUkDateTime } from "@/lib/date";
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
  native_automation: [],
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

const tabValues = ["overview", "live", "builder", "rules", "reviews", "history", "templates", "settings"];

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function readable(value) {
  if (value && typeof value === "object") {
    return String(value.label || value.name || value.type || value.id || "-").replaceAll("_", " ");
  }
  return String(value || "-").replaceAll("_", " ");
}

function statusClass(status) {
  if (["active", "live", "completed", "test_completed", "approved", "resolved"].includes(status)) return "bg-emerald-100 text-emerald-800";
  if (["pending", "waiting_approval", "queued", "draft", "test_only"].includes(status)) return "bg-amber-100 text-amber-800";
  if (["failed", "rejected", "open"].includes(status)) return "bg-red-100 text-red-800";
  return "bg-stone-100 text-stone-700";
}

function initialTab() {
  const requested = new URLSearchParams(window.location.search).get("tab");
  return tabValues.includes(requested) ? requested : "overview";
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

function Panel({ title, children, action, description }) {
  return (
    <section className="rounded-xl border border-stone-200 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-3 border-b border-stone-100 px-4 py-3">
        <div>
          <h2 className="font-display text-base font-bold text-stone-900">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-stone-500">{description}</p>}
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

function WorkflowMiniMap({ workflow }) {
  const blocks = safeArray(workflow?.blocks);
  const visible = blocks.length ? blocks : ["Trigger", "Condition", "Action"];
  return (
    <div className="flex flex-wrap items-center gap-2">
      {visible.map((block, index) => (
        <React.Fragment key={`${readable(block)}-${index}`}>
          <span className="rounded-md border border-emerald-100 bg-emerald-50 px-2 py-1 text-xs font-semibold capitalize text-emerald-900">{readable(block)}</span>
          {index < visible.length - 1 && <span className="text-stone-400">→</span>}
        </React.Fragment>
      ))}
    </div>
  );
}

export default function AdminAutomation() {
  const [workspace, setWorkspace] = useState(emptyWorkspace);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState(initialTab);
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
  const nativeAutomation = safeArray(workspace.native_automation);
  const pendingApprovals = useMemo(() => approvals.filter((item) => item.status === "pending"), [approvals]);
  const openExceptions = useMemo(() => exceptions.filter((item) => item.status !== "resolved"), [exceptions]);

  async function loadWorkspace() {
    setLoading(true);
    setLoadError("");
    try {
      const { data } = await api.get("/admin/automation");
      setWorkspace({ ...emptyWorkspace, ...(data || {}) });
      setSettingsDraft(data?.settings || {});
    } catch (err) {
      const message = formatApiError(err);
      setLoadError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadWorkspace();
  }, []);

  function changeTab(nextTab) {
    setActiveTab(nextTab);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", nextTab);
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function updateBuilder(field, value) {
    setBuilder((current) => ({ ...current, [field]: value }));
  }

  async function createWorkflow() {
    if (!builder.name.trim()) {
      toast.error("Rule name is required.");
      return;
    }
    setSaving(true);
    try {
      const selectedTrigger = triggers.find((item) => item.id === builder.trigger_type);
      const selectedAction = actions.find((item) => item.id === builder.action_type);
      await api.post("/admin/automation/workflows", {
        name: builder.name,
        description: builder.description,
        trigger_type: builder.trigger_type,
        approval_required: builder.approval_required,
        time_saved_minutes: Number(builder.time_saved_minutes || 0),
        blocks: [
          selectedTrigger?.label || "Trigger",
          "Evaluate conditions",
          builder.approval_required ? "Approval checkpoint" : "Continue",
          selectedAction?.label || "Action",
        ],
        conditions: [{ field: builder.condition_field, operator: builder.condition_operator, value: builder.condition_value, logic: "AND" }],
        actions: [{ type: builder.action_type, target: builder.action_target || "existing module service" }],
      });
      toast.success("Custom rule created as a definition");
      setBuilder(initialBuilder);
      await loadWorkspace();
      changeTab("rules");
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setSaving(false);
    }
  }

  async function updateWorkflow(workflow, values) {
    try {
      const { data } = await api.put(`/admin/automation/workflows/${workflow.id}`, { ...workflow, ...values });
      setWorkspace((current) => ({
        ...current,
        workflows: safeArray(current.workflows).map((item) => (item.id === workflow.id ? data?.workflow : item)),
      }));
      toast.success("Rule updated");
    } catch (err) {
      toast.error(formatApiError(err));
    }
  }

  async function testWorkflow(workflow) {
    try {
      const { data } = await api.post(`/admin/automation/workflows/${workflow.id}/execute`, { mode: "test" });
      setWorkspace(data?.workspace || workspace);
      toast.success("Rule test passed. No accounting records were changed.");
    } catch (err) {
      toast.error(formatApiError(err));
    }
  }

  async function resolveApproval(approval, action) {
    try {
      const { data } = await api.post(`/admin/automation/approvals/${approval.id}/${action}`, {});
      setWorkspace(data || workspace);
      toast.success(action === "approve" ? "Review approved" : "Review rejected");
    } catch (err) {
      toast.error(formatApiError(err));
    }
  }

  async function resolveException(exception, action) {
    try {
      const { data } = await api.post(`/admin/automation/exceptions/${exception.id}/${action}`, {});
      setWorkspace(data || workspace);
      toast.success(action === "retry" ? "Test retry queued" : "Exception resolved");
    } catch (err) {
      toast.error(formatApiError(err));
    }
  }

  async function duplicateTemplate(template) {
    try {
      await api.post(`/admin/automation/templates/${template.id}/duplicate`, {});
      toast.success("Blueprint copied to Custom Rules as a draft");
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

  if (loading) return <div className="p-8 text-sm text-stone-500">Loading automation workspace...</div>;

  if (loadError) {
    return (
      <div className="mx-auto max-w-3xl rounded-xl border border-red-200 bg-red-50 p-6">
        <h1 className="font-display text-xl font-bold text-red-950">Automation could not be loaded</h1>
        <p className="mt-2 text-sm text-red-800">{loadError}</p>
        <Button onClick={loadWorkspace} className="mt-4 gap-2"><RefreshCw className="h-4 w-4" /> Try again</Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1720px] space-y-3 pb-8">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-100 bg-gradient-to-r from-emerald-50 via-white to-cyan-50 px-5 py-4 shadow-sm">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">
            <Workflow className="h-4 w-4" /> EPOS Native Accounting
          </div>
          <h1 className="font-display text-3xl font-bold text-stone-950">Automation</h1>
          <p className="text-sm text-stone-600">See what is genuinely automated, configure safe rules, and review tests and exceptions in one place.</p>
        </div>
        <Button onClick={loadWorkspace} variant="outline" className="gap-2"><RefreshCw className="h-4 w-4" /> Refresh</Button>
      </header>

      <Tabs value={activeTab} onValueChange={changeTab}>
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 rounded-lg bg-stone-100 p-1 md:grid-cols-4 xl:grid-cols-8">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="live">Live Automation</TabsTrigger>
          <TabsTrigger value="builder">Rule Builder</TabsTrigger>
          <TabsTrigger value="rules">Custom Rules</TabsTrigger>
          <TabsTrigger value="reviews">Reviews ({pendingApprovals.length + openExceptions.length})</TabsTrigger>
          <TabsTrigger value="history">Test History</TabsTrigger>
          <TabsTrigger value="templates">Blueprints</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-3">
          <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950">
            <strong>Clear separation:</strong> Live Automation documents native behaviours connected to EPOS Accounting. Custom Rules are definitions that can be tested safely, but they do not post or change accounting records.
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <KpiCard label="Live native behaviours" value={nativeAutomation.filter((item) => item.status === "live").length} icon={CheckCircle2} />
            <KpiCard label="Configured custom rules" value={workflows.length} icon={Workflow} />
            <KpiCard label="Rule tests today" value={workspace.dashboard?.executed_today} icon={Play} />
            <KpiCard label="Pending reviews" value={pendingApprovals.length + openExceptions.length} icon={ShieldCheck} tone="amber" />
            <KpiCard label="Open exceptions" value={openExceptions.length} icon={AlertTriangle} tone="red" />
          </div>
          <div className="grid gap-3 xl:grid-cols-2">
            <Panel title="Recent rule tests">
              {runs.length ? runs.slice(0, 6).map((run) => (
                <div key={run.id} className="flex items-center justify-between gap-3 border-b border-stone-100 py-2 last:border-b-0">
                  <div>
                    <p className="font-semibold text-stone-900">{run.workflow_name || "Rule"}</p>
                    <p className="text-xs text-stone-500">{readable(run.trigger_type)} · {formatUkDateTime(run.started_at)}</p>
                  </div>
                  <Badge className={statusClass(run.status)}>{readable(run.status)}</Badge>
                </div>
              )) : <EmptyState text="No rule tests have been recorded." />}
            </Panel>
            <Panel title="How to use this area">
              <ol className="space-y-3 text-sm text-stone-700">
                <li><strong>1. Live Automation</strong> — understand what already runs and where confirmation is required.</li>
                <li><strong>2. Rule Builder</strong> — define a rule from supported triggers, conditions and actions.</li>
                <li><strong>3. Custom Rules</strong> — enable, pause and safely test definitions without changing ledgers.</li>
                <li><strong>4. Reviews</strong> — resolve legacy review records and rule-test exceptions.</li>
              </ol>
            </Panel>
          </div>
          <Panel title="Suggested rules — not active" description="These are starting ideas, not AI decisions and not running automations.">
            <div className="grid gap-3 md:grid-cols-3">
              {safeArray(workspace.recommendations).map((item) => (
                <div key={item.title} className="rounded-lg border border-cyan-100 bg-cyan-50 p-4">
                  <div className="flex items-start gap-2">
                    <Sparkles className="mt-0.5 h-4 w-4 text-cyan-700" />
                    <div>
                      <p className="font-semibold text-cyan-950">{item.title}</p>
                      <p className="mt-1 text-sm text-cyan-800">{item.message}</p>
                      <p className="mt-2 text-[10px] font-bold uppercase tracking-wide text-cyan-700">{item.source}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="live">
          <Panel
            title="Live native accounting automation"
            description="Built-in behaviours already connected to EPOS Native Accounting."
            action={<Badge className="bg-emerald-100 text-emerald-800">{nativeAutomation.filter((item) => item.status === "live").length} connected</Badge>}
          >
            <div className="mb-4 rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm text-stone-700">
              “AI assisted” means AI suggests values for a person to review. It does not have authority to change the purchase/sales route, approve, post, or reconcile.
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              {nativeAutomation.map((item) => (
                <article key={item.id} className={`rounded-xl border p-4 shadow-sm ${item.status === "live" ? "border-emerald-200 bg-white" : "border-amber-200 bg-amber-50"}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">{item.module}</p>
                      <h3 className="mt-1 font-display text-lg font-bold text-stone-950">{item.name}</h3>
                    </div>
                    <div className="flex gap-2">
                      <Badge className="bg-stone-100 text-stone-700">{readable(item.kind)}</Badge>
                      <Badge className={statusClass(item.status)}>{item.status === "test_only" ? "Test only" : "Live"}</Badge>
                    </div>
                  </div>
                  <dl className="mt-4 grid gap-3 text-sm">
                    <div><dt className="font-semibold text-stone-500">Trigger</dt><dd className="text-stone-900">{item.trigger}</dd></div>
                    <div><dt className="font-semibold text-stone-500">What happens</dt><dd className="text-stone-900">{item.outcome}</dd></div>
                    <div className="rounded-lg bg-stone-50 p-3"><dt className="font-semibold text-stone-700">Control / safeguard</dt><dd className="mt-1 text-stone-600">{item.safeguard}</dd></div>
                  </dl>
                </article>
              ))}
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="builder" className="grid gap-3 xl:grid-cols-[420px_1fr]">
          <Panel title="Create custom rule" action={<Badge className="bg-amber-100 text-amber-800">Test only</Badge>}>
            <div className="space-y-3">
              <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                This creates a rule definition. It cannot post documents, reconcile banking or create journals.
              </p>
              <div><Label>Name</Label><Input value={builder.name} onChange={(e) => updateBuilder("name", e.target.value)} placeholder="Purchase invoice review rule" /></div>
              <div><Label>Description</Label><Input value={builder.description} onChange={(e) => updateBuilder("description", e.target.value)} placeholder="Explain what this rule should control" /></div>
              <div>
                <Label>When this happens</Label>
                <select className="h-10 w-full rounded-md border border-stone-200 bg-white px-3 text-sm" value={builder.trigger_type} onChange={(e) => updateBuilder("trigger_type", e.target.value)}>
                  {triggers.map((item) => <option key={item.id} value={item.id}>{item.module}: {item.label}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div><Label>Field</Label><select className="h-10 w-full rounded-md border border-stone-200 bg-white px-2 text-sm" value={builder.condition_field} onChange={(e) => updateBuilder("condition_field", e.target.value)}>{conditions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div>
                <div><Label>Rule</Label><Input value={builder.condition_operator} onChange={(e) => updateBuilder("condition_operator", e.target.value)} /></div>
                <div><Label>Value</Label><Input value={builder.condition_value} onChange={(e) => updateBuilder("condition_value", e.target.value)} /></div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>Proposed action</Label><select className="h-10 w-full rounded-md border border-stone-200 bg-white px-3 text-sm" value={builder.action_type} onChange={(e) => updateBuilder("action_type", e.target.value)}>{actions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div>
                <div><Label>Target</Label><Input value={builder.action_target} onChange={(e) => updateBuilder("action_target", e.target.value)} /></div>
              </div>
              <label className="flex items-center gap-2 rounded-md bg-stone-50 px-3 py-2 text-sm font-semibold text-stone-700">
                <input type="checkbox" checked={builder.approval_required} onChange={(e) => updateBuilder("approval_required", e.target.checked)} />
                Include an approval checkpoint
              </label>
              <Button onClick={createWorkflow} disabled={saving} className="w-full gap-2"><Plus className="h-4 w-4" /> Create rule definition</Button>
            </div>
          </Panel>
          <Panel title="Rule preview" description="A readable preview of the saved definition.">
            <div className="rounded-xl border border-emerald-100 bg-gradient-to-br from-emerald-50 to-white p-5">
              <div className="flex flex-col items-center gap-3 text-center">
                {[builder.trigger_type, "Evaluate condition", builder.approval_required ? "Approval checkpoint" : "Continue", builder.action_type].map((block, index) => (
                  <React.Fragment key={`${block}-${index}`}>
                    <div className="w-full max-w-md rounded-lg border border-white bg-white px-4 py-3 text-sm font-bold capitalize text-stone-900 shadow-sm">{readable(block)}</div>
                    {index < 3 && <GitBranch className="h-5 w-5 text-emerald-700" />}
                  </React.Fragment>
                ))}
              </div>
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="rules">
          <Panel title="Custom rule definitions" description="Enabled means available for testing; it does not mean connected to accounting posting.">
            <div className="grid gap-3 xl:grid-cols-2">
              {workflows.length ? workflows.map((workflow) => (
                <article key={workflow.id} className="flex min-h-[230px] flex-col rounded-xl border border-stone-200 bg-white p-4 shadow-[0_3px_12px_rgba(28,25,23,0.07)]">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"><Workflow className="h-6 w-6" /></span>
                      <div className="min-w-0 pt-0.5">
                        <h3 className="truncate font-display text-base font-bold text-stone-950">{workflow.name}</h3>
                        <p className="mt-1 line-clamp-2 text-sm text-stone-500">{workflow.description || "No description"}</p>
                        <p className="mt-1.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">Definition · test only</p>
                      </div>
                    </div>
                    <Badge className={statusClass(workflow.status)}>{readable(workflow.status)}</Badge>
                  </div>
                  <div className="mt-4 border-t border-stone-200 pt-3"><WorkflowMiniMap workflow={workflow} /></div>
                  <div className="mt-auto flex flex-wrap gap-2 border-t border-stone-100 pt-3">
                    <Button variant="outline" onClick={() => updateWorkflow(workflow, { status: workflow.status === "active" ? "paused" : "active" })}>{workflow.status === "active" ? "Pause tests" : "Enable tests"}</Button>
                    <Button className="gap-2" onClick={() => testWorkflow(workflow)} disabled={workflow.status !== "active"}><Play className="h-4 w-4" /> Test rule</Button>
                  </div>
                </article>
              )) : <EmptyState text="No custom rules yet. Create one in Rule Builder or copy a blueprint." />}
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="reviews" className="space-y-3">
          <Panel title="Pending approvals" description="Existing review records from earlier workflow tests.">
            <div className="space-y-3">
              {pendingApprovals.length ? pendingApprovals.map((approval) => (
                <div key={approval.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-100 bg-amber-50 p-4">
                  <div><p className="font-bold text-amber-950">{approval.title}</p><p className="text-sm text-amber-800">{approval.summary}</p></div>
                  <div className="flex gap-2"><Button variant="outline" onClick={() => resolveApproval(approval, "reject")}>Reject</Button><Button onClick={() => resolveApproval(approval, "approve")} className="gap-2"><CheckCircle2 className="h-4 w-4" /> Approve</Button></div>
                </div>
              )) : <EmptyState text="No approvals pending." />}
            </div>
          </Panel>
          <Panel title="Open exceptions">
            <div className="space-y-3">
              {openExceptions.length ? openExceptions.map((item) => (
                <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-100 bg-red-50 p-4">
                  <div><p className="font-bold text-red-950">{readable(item.exception_type)}</p><p className="text-sm text-red-800">{item.message}</p></div>
                  <div className="flex gap-2"><Button variant="outline" onClick={() => resolveException(item, "resolve")}>Resolve</Button><Button onClick={() => resolveException(item, "retry")} className="gap-2"><RefreshCw className="h-4 w-4" /> Retry test</Button></div>
                </div>
              )) : <EmptyState text="No open exceptions." />}
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="history">
          <Panel title="Rule test history" description="These records are diagnostics. A test does not mutate AP, AR, Banking, VAT or General Ledger.">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-stone-500"><tr><th className="py-2">Rule</th><th>Mode</th><th>Trigger</th><th>Status</th><th>Result</th><th>Duration</th><th>Started</th></tr></thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.id} className="border-t border-stone-100">
                      <td className="py-3 font-semibold">{run.workflow_name}</td>
                      <td><Badge className="bg-blue-100 text-blue-800">{readable(run.execution_mode || "legacy")}</Badge></td>
                      <td>{readable(run.trigger_type)}</td>
                      <td><Badge className={statusClass(run.status)}>{readable(run.status)}</Badge></td>
                      <td>{run.result}</td><td>{run.duration_ms ?? 0}ms</td><td>{formatUkDateTime(run.started_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!runs.length && <EmptyState text="No rule-test history yet." />}
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="templates">
          <Panel title="Rule blueprints" description="Copying a blueprint creates an editable draft. It does not activate accounting automation.">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {templates.map((template) => (
                <article key={template.id} className="flex min-h-[230px] flex-col rounded-xl border border-stone-200 bg-white p-4 shadow-[0_3px_12px_rgba(28,25,23,0.07)]">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"><Copy className="h-6 w-6" /></span>
                      <div className="min-w-0 pt-0.5"><h3 className="font-display text-base font-bold text-stone-950">{template.name}</h3><Badge className="mt-2 bg-stone-100 text-stone-700">{template.category}</Badge></div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => duplicateTemplate(template)} className="gap-2"><Copy className="h-4 w-4" /> Copy draft</Button>
                  </div>
                  <p className="mt-3 line-clamp-2 text-sm text-stone-600">{template.description}</p>
                  <div className="mt-auto border-t border-stone-200 pt-3"><WorkflowMiniMap workflow={template} /></div>
                </article>
              ))}
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="settings">
          <Panel title="Rule workspace settings" description="These settings apply to custom rule definitions and their test records." action={<Settings className="h-4 w-4 text-stone-500" />}>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <label className="flex items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm font-semibold"><input type="checkbox" checked={settingsDraft.approval_required_by_default !== false} onChange={(e) => setSettingsDraft((cur) => ({ ...cur, approval_required_by_default: e.target.checked }))} />Approval checkpoint by default</label>
              <label className="flex items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm font-semibold"><input type="checkbox" checked={!!settingsDraft.auto_retry_enabled} onChange={(e) => setSettingsDraft((cur) => ({ ...cur, auto_retry_enabled: e.target.checked }))} />Allow automatic retry for failed tests</label>
              <div><Label>Default reviewer</Label><Input value={settingsDraft.default_assignee || "admin"} onChange={(e) => setSettingsDraft((cur) => ({ ...cur, default_assignee: e.target.value }))} /></div>
              <div><Label>Recommendation mode</Label><select className="h-10 w-full rounded-md border border-stone-200 bg-white px-3 text-sm" value={settingsDraft.recommendation_mode || "rule_based"} onChange={(e) => setSettingsDraft((cur) => ({ ...cur, recommendation_mode: e.target.value }))}><option value="rule_based">Rule based suggestions</option><option value="disabled">Disabled</option></select></div>
              <div><Label>Permission mode</Label><select className="h-10 w-full rounded-md border border-stone-200 bg-white px-3 text-sm" value={settingsDraft.permission_mode || "admin_only"} onChange={(e) => setSettingsDraft((cur) => ({ ...cur, permission_mode: e.target.value }))}><option value="admin_only">Administrators only</option><option value="role_based">Role based</option></select></div>
              <div><Label>Test history retention (days)</Label><Input type="number" min="1" max="3650" value={settingsDraft.execution_retention_days || 365} onChange={(e) => setSettingsDraft((cur) => ({ ...cur, execution_retention_days: Number(e.target.value) }))} /></div>
            </div>
            <Button onClick={saveSettings} className="mt-4 gap-2"><Bell className="h-4 w-4" /> Save settings</Button>
          </Panel>
        </TabsContent>
      </Tabs>
    </div>
  );
}
