import React, { useCallback, useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { CheckCircle2, AlertTriangle, Save } from "lucide-react";
import { toast } from "sonner";

export default function AdminSettings() {
  const [form, setForm] = useState({
    host: "", port: 587, username: "", password: "",
    sender_email: "", sender_name: "", use_tls: true, aws_iam_secret: false,
  });
  const [aiForm, setAiForm] = useState({ api_key: "", model: "gpt-5.6-luna" });
  const [featureForm, setFeatureForm] = useState({ document_processing_enabled: true });
  const [configured, setConfigured] = useState(false);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [aiSource, setAiSource] = useState("missing");
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [featureBusy, setFeatureBusy] = useState(false);

  const load = useCallback(async () => {
    const errors = [];
    try {
      const smtp = await api.get("/admin/settings/smtp");
      setForm({ ...smtp.data, password: "", aws_iam_secret: false });
      setConfigured(!!smtp.data.configured);
    } catch (e) {
      errors.push(`SMTP: ${formatApiError(e)}`);
    }

    try {
      const ai = await api.get("/admin/settings/openai");
      setAiForm({ api_key: "", model: ai.data.model || "gpt-5.6-luna" });
      setAiConfigured(!!ai.data.configured);
      setAiSource(ai.data.source || "missing");
    } catch (e) {
      setAiConfigured(false);
      setAiSource("missing");
      errors.push(`OpenAI: ${formatApiError(e)}`);
    }

    try {
      const features = await api.get("/admin/settings/features");
      setFeatureForm({ document_processing_enabled: features.data.document_processing_enabled !== false });
    } catch (e) {
      errors.push(`Features: ${formatApiError(e)}`);
    }

    if (errors.length) toast.error(errors.join(" | "));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = { ...form };
      if (!payload.password) delete payload.password;
      await api.put("/admin/settings/smtp", payload);
      toast.success("SMTP settings saved — password stored securely");
      setForm({ ...form, password: "" });
      load();
    } catch (err) { toast.error(formatApiError(err)); }
    finally { setBusy(false); }
  }

  async function saveAi(e) {
    e.preventDefault();
    setAiBusy(true);
    try {
      const payload = { ...aiForm };
      if (!payload.api_key) delete payload.api_key;
      await api.put("/admin/settings/openai", payload);
      toast.success("OpenAI settings saved");
      setAiForm({ ...aiForm, api_key: "" });
      load();
    } catch (err) { toast.error(formatApiError(err)); }
    finally { setAiBusy(false); }
  }

  async function saveFeatures(e) {
    e.preventDefault();
    setFeatureBusy(true);
    try {
      await api.put("/admin/settings/features", featureForm);
      toast.success("Feature settings saved");
      window.dispatchEvent(new Event("feature-settings-updated"));
      load();
    } catch (err) { toast.error(formatApiError(err)); }
    finally { setFeatureBusy(false); }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <header>
        <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-stone-900">Settings</h1>
        <p className="mt-1 text-stone-600">Configure email delivery and optional AI document checks.</p>
      </header>

      <form onSubmit={saveFeatures} className="bg-white border border-stone-200 rounded-2xl p-6 space-y-4">
        <div>
          <h2 className="font-display text-xl font-semibold text-stone-900">Feature modules</h2>
          <p className="text-sm text-stone-500 mt-1">Controls admin modules only. Client uploads, AI pre-email checks, stamps, and email delivery stay unchanged.</p>
        </div>
        <div className="rounded-xl border border-stone-200 bg-stone-50 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Label className="text-sm font-semibold text-stone-800">Document processing inbox</Label>
              <p className="mt-1 text-xs leading-relaxed text-stone-600">
                Shows the admin Submitted items inbox, coding fields, archive, AI prefill and line suggestions. Turn off while testing live integrations without changing the client submission flow.
              </p>
            </div>
            <Switch
              checked={featureForm.document_processing_enabled}
              onCheckedChange={(v) => setFeatureForm({ ...featureForm, document_processing_enabled: v })}
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={featureBusy} className="gap-2" style={{ background: "var(--brand)" }}>
            <Save className="h-4 w-4" /> {featureBusy ? "Saving…" : "Save feature settings"}
          </Button>
        </div>
      </form>

      <div className={`rounded-xl p-4 flex items-start gap-3 border ${configured ? "border-emerald-200" : "border-amber-200"}`}
        style={{ background: configured ? "var(--success-bg)" : "var(--outstanding-bg)" }}>
        {configured ? <CheckCircle2 className="h-5 w-5 mt-0.5" style={{ color: "var(--success)" }} /> : <AlertTriangle className="h-5 w-5 mt-0.5" style={{ color: "var(--outstanding)" }} />}
        <div className="text-sm">
          <div className="font-semibold" style={{ color: configured ? "var(--success)" : "var(--outstanding)" }}>
            {configured ? "SMTP is configured" : "SMTP not yet configured"}
          </div>
          <div className="text-stone-700">{configured ? "Submissions will be emailed automatically." : "Clients will see an error when they try to submit until you save valid credentials."}</div>
        </div>
      </div>

      <form onSubmit={save} className="bg-white border border-stone-200 rounded-2xl p-6 space-y-4" data-testid="smtp-form">
        <h2 className="font-display text-xl font-semibold text-stone-900">SMTP email</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="SMTP Host" value={form.host} onChange={(v)=>setForm({...form, host:v})} placeholder="email-smtp.eu-west-2.amazonaws.com" testid="smtp-host" />
          <Field label="Port" type="number" value={form.port} onChange={(v)=>setForm({...form, port: Number(v)})} placeholder="587" testid="smtp-port" />
          <Field label="Username" value={form.username} onChange={(v)=>setForm({...form, username:v})} testid="smtp-username" />
          <Field label={configured ? (form.aws_iam_secret ? "AWS IAM Secret Access Key (leave blank to keep)" : "Password (leave blank to keep)") : (form.aws_iam_secret ? "AWS IAM Secret Access Key" : "Password")} type="password" required={!configured} placeholder={configured ? "•••••••• saved — leave blank to keep" : (form.aws_iam_secret ? "Paste your IAM Secret Access Key" : "Enter SMTP password")} value={form.password} onChange={(v)=>setForm({...form, password:v})} testid="smtp-password" />
          <Field label="Sender Email" type="email" value={form.sender_email} onChange={(v)=>setForm({...form, sender_email:v})} testid="smtp-sender-email" />
          <Field label="Sender Name" value={form.sender_name} onChange={(v)=>setForm({...form, sender_name:v})} testid="smtp-sender-name" />
        </div>
        <div className="flex items-center gap-3 pt-1">
          <Switch checked={form.use_tls} onCheckedChange={(v)=>setForm({...form, use_tls:v})} data-testid="smtp-tls-switch" />
          <Label className="text-sm">Use STARTTLS (recommended for port 587)</Label>
        </div>

        <div className="rounded-xl border border-stone-200 bg-stone-50 p-4 space-y-2" data-testid="aws-iam-box">
          <div className="flex items-center gap-3">
            <Switch checked={form.aws_iam_secret} onCheckedChange={(v)=>setForm({...form, aws_iam_secret:v})} data-testid="aws-iam-switch" />
            <Label className="text-sm font-semibold text-stone-800">I'm pasting an AWS IAM Secret Access Key</Label>
          </div>
          <p className="text-xs text-stone-600 leading-relaxed">
            Amazon SES needs a special <strong>SMTP password</strong> — not your IAM secret access key. If you only have IAM keys
            (an <code className="text-[11px]">AKIA…</code> access key + a secret), turn this on: enter the access key as the
            <strong> Username</strong> and paste the <strong>Secret Access Key</strong> above, and we'll automatically convert it
            to the correct SES SMTP password (region is detected from your host). The IAM user must have the
            <em> ses:SendRawEmail</em> permission.
          </p>
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={busy} className="gap-2" style={{ background: "var(--brand)" }} data-testid="save-smtp-btn">
            <Save className="h-4 w-4" /> {busy ? "Saving…" : "Save settings"}
          </Button>
        </div>
      </form>

      <div className={`rounded-xl p-4 flex items-start gap-3 border ${aiConfigured ? "border-emerald-200" : "border-amber-200"}`}
        style={{ background: aiConfigured ? "var(--success-bg)" : "var(--outstanding-bg)" }}>
        {aiConfigured ? <CheckCircle2 className="h-5 w-5 mt-0.5" style={{ color: "var(--success)" }} /> : <AlertTriangle className="h-5 w-5 mt-0.5" style={{ color: "var(--outstanding)" }} />}
        <div className="text-sm">
          <div className="font-semibold" style={{ color: aiConfigured ? "var(--success)" : "var(--outstanding)" }}>
            {aiConfigured ? "OpenAI is configured" : "OpenAI not yet configured"}
          </div>
          <div className="text-stone-700">
            {aiConfigured
              ? `AI analysis can be enabled per client. Key source: ${aiSource}.`
              : "Clients with AI analysis enabled will be blocked until an API key is saved."}
          </div>
        </div>
      </div>

      <form onSubmit={saveAi} className="bg-white border border-stone-200 rounded-2xl p-6 space-y-4" data-testid="openai-form">
        <div>
          <h2 className="font-display text-xl font-semibold text-stone-900">OpenAI document check</h2>
          <p className="text-sm text-stone-500 mt-1">Used only for clients where AI analysis is enabled.</p>
        </div>
        <Field
          label={aiConfigured ? "OpenAI API key (leave blank to keep)" : "OpenAI API key"}
          type="password"
          required={!aiConfigured}
          placeholder={aiConfigured ? "Saved - leave blank to keep" : "sk-..."}
          value={aiForm.api_key}
          onChange={(v)=>setAiForm({...aiForm, api_key:v})}
          testid="openai-api-key"
        />
        <div>
          <Label className="text-sm font-semibold text-stone-700">AI model</Label>
          <select
            value={aiForm.model}
            onChange={(e) => setAiForm({ ...aiForm, model: e.target.value })}
            className="mt-1.5 h-11 w-full rounded-md border border-stone-200 bg-white px-3 text-sm"
            data-testid="openai-model"
          >
            <option value="gpt-5.6-luna">gpt-5.6-luna - efficient</option>
            <option value="gpt-5.6-terra">gpt-5.6-terra - stronger check</option>
            <option value="gpt-5.6-sol">gpt-5.6-sol - highest capability</option>
          </select>
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={aiBusy} className="gap-2" style={{ background: "var(--brand)" }} data-testid="save-openai-btn">
            <Save className="h-4 w-4" /> {aiBusy ? "Saving…" : "Save OpenAI settings"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", placeholder, required = true, testid }) {
  return (
    <div>
      <Label className="text-sm font-semibold text-stone-700">{label}</Label>
      <Input type={type} required={required} value={value ?? ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className="mt-1.5 h-11" data-testid={testid} />
    </div>
  );
}
