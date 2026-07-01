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
  const [configured, setConfigured] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/settings/smtp");
      setForm({ ...data, password: "", aws_iam_secret: false });
      setConfigured(!!data.configured);
    } catch (e) { toast.error(formatApiError(e)); }
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

  return (
    <div className="space-y-6 max-w-2xl">
      <header>
        <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-stone-900">SMTP Settings</h1>
        <p className="mt-1 text-stone-600">Used to forward every client submission to their AutoEntry email address.</p>
      </header>

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
