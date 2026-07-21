import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export function Panel({ title, children }) {
  return (
    <section className="rounded-md border border-stone-200 bg-white">
      <div className="border-b border-stone-100 px-3 py-2">
        <h3 className="font-display text-base font-semibold text-stone-900">{title}</h3>
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}

export function SummaryCard({ label, value, tone }) {
  const tones = {
    emerald: "bg-emerald-50 text-emerald-900 border-emerald-100",
    blue: "bg-sky-50 text-sky-900 border-sky-100",
    amber: "bg-amber-50 text-amber-900 border-amber-100",
    stone: "bg-stone-50 text-stone-900 border-stone-100",
  };
  return (
    <div className={`min-w-28 rounded-md border px-3 py-2 ${tones[tone] || tones.stone}`}>
      <div className="text-[11px] font-semibold uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-1 font-display text-lg font-bold">{value}</div>
    </div>
  );
}

export function SmallStat({ label, value }) {
  return <span className="rounded bg-white/80 px-1.5 py-0.5 text-[11px] text-stone-600">{label}: {value}</span>;
}

export function ContactCount({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center justify-between rounded-md bg-stone-50 px-3 py-2 text-sm">
      <span className="inline-flex items-center gap-2 text-stone-700"><Icon className="h-4 w-4" /> {label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function Field({ label, value, onChange, type = "text" }) {
  return (
    <div>
      <Label className="text-xs font-semibold text-stone-600">{label}</Label>
      <Input type={type} value={value || ""} onChange={(e) => onChange(e.target.value)} className="mt-1 h-9" />
    </div>
  );
}

export function SelectField({ label, value, onChange, options = [] }) {
  const optionRows = (Array.isArray(options) ? options : []).map((option) => {
    if (Array.isArray(option)) return { value: option[0] ?? "", label: option[1] ?? option[0] ?? "Select" };
    if (option && typeof option === "object") return { value: option.value ?? option.id ?? "", label: option.label ?? option.name ?? option.value ?? option.id ?? "Select" };
    return { value: option ?? "", label: option || "Any" };
  });
  return (
    <div>
      <Label className="text-xs font-semibold text-stone-600">{label}</Label>
      <select value={value || ""} onChange={(e) => onChange(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-stone-200 bg-white px-3 text-sm shadow-sm">
        <option value="">Select</option>
        {optionRows.map((option) => <option key={option.value || option.label} value={option.value}>{option.label}</option>)}
      </select>
    </div>
  );
}

export function normaliseVatOption(vat = {}) {
  const code = vat.code || vat.vat_code || vat.tax_code || vat.id || "";
  if (!code) return null;
  const description = vat.description || vat.detail || vat.name || vat.label || "";
  return {
    value: String(code),
    label: `${code}${description && description !== code ? ` - ${description}` : ""}`,
  };
}

export function vatCodeOptionsFromWorkspace(workspace = {}) {
  const lists = [
    workspace.vat_codes,
    workspace.native_vat_codes,
    workspace.vat?.codes,
    workspace.vat?.vat_codes,
    workspace.vat_engine?.codes,
    workspace.accounting?.vat_codes,
  ];
  const seen = new Set();
  return lists
    .flatMap((list) => (Array.isArray(list) ? list : []))
    .filter((record) => record?.active !== false)
    .map(normaliseVatOption)
    .filter((option) => {
      if (!option || seen.has(option.value)) return false;
      seen.add(option.value);
      return true;
    });
}

export function canonicalVatCodeValue(rawValue, options = []) {
  const raw = String(rawValue || "").trim();
  if (!raw) return "";
  const rawKey = raw.toLowerCase();
  const prefixKey = raw.split(" - ")[0].trim().toLowerCase();
  const match = options.find((option) => {
    const valueKey = String(option.value || "").trim().toLowerCase();
    const labelKey = String(option.label || "").trim().toLowerCase();
    return valueKey === rawKey || labelKey === rawKey || valueKey === prefixKey;
  });
  return match?.value || raw;
}

export function VatCodeSelect({ label = "VAT code", value, onChange, options = [], disabled = false, compact = false }) {
  const hasOptions = options.length > 0;
  return (
    <div>
      {label ? <Label className="text-xs font-semibold text-stone-600">{label}</Label> : null}
      <select
        value={canonicalVatCodeValue(value, options)}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled || !hasOptions}
        className={`${compact ? "h-7 text-xs" : "h-9 text-sm"} mt-1 w-full rounded-md border border-stone-200 bg-white px-3 shadow-sm disabled:bg-stone-50`}
      >
        <option value="">Select VAT code</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      {!hasOptions ? <p className="mt-1 text-xs text-amber-700">Native VAT code list unavailable. VAT code must come from EPOS Native VAT Codes.</p> : null}
    </div>
  );
}

export function AccountCodeSelect({ accounts, value, onChange, label }) {
  const accountRows = Array.isArray(accounts) ? accounts : [];
  return (
    <div>
      <Label className="text-xs font-semibold text-stone-600">{label}</Label>
      <select value={value || ""} onChange={(e) => onChange(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-stone-200 bg-white px-3 text-sm shadow-sm">
        <option value="">Select account</option>
        {accountRows.map((account) => <option key={account.id || account.code} value={account.code}>{account.code} - {account.name}</option>)}
      </select>
    </div>
  );
}

export function BankReportLine({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 text-sm">
      <span className="text-stone-600">{label}</span>
      <strong className="font-display text-stone-900">{value}</strong>
    </div>
  );
}

export function ReadOnly({ label, value }) {
  return (
    <div>
      <Label className="text-xs font-semibold text-stone-600">{label}</Label>
      <div className="mt-1 min-h-9 rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-sm font-medium text-stone-800">
        {value || "-"}
      </div>
    </div>
  );
}

export function Info({ label, value }) {
  return (
    <div className="rounded-md bg-stone-50 px-3 py-2 text-sm">
      <div className="text-xs font-semibold text-stone-500">{label}</div>
      <div className="mt-1 font-medium text-stone-900">{value || "-"}</div>
    </div>
  );
}

export function formatMoney(value) {
  const n = Number(value || 0);
  return n.toLocaleString("en-GB", { style: "currency", currency: "GBP" });
}

export function formatReportValue(value) {
  if (value === null || value === undefined || value === "") return "-";
  const n = Number(value);
  return Number.isFinite(n) && String(value).trim() !== "" ? formatMoney(value) : String(value);
}

export function formatDate(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-GB");
}

export function formatDateTime(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("en-GB");
}

export function statusBadgeClass(status) {
  const value = String(status || "").toLowerCase();
  if (["posted", "paid", "allocated", "active", "reconciled", "approved"].includes(value)) {
    return "bg-emerald-100 text-emerald-800";
  }
  if (["draft", "part_paid", "part paid", "unreconciled", "pending"].includes(value)) {
    return "bg-amber-100 text-amber-800";
  }
  if (["void", "voided", "cancelled", "rejected", "failed"].includes(value)) {
    return "bg-red-100 text-red-800";
  }
  return "bg-stone-100 text-stone-700";
}

export function displayAuditValue(value) {
  if (!value) return "-";
  if (typeof value === "string") return value.length > 160 ? `${value.slice(0, 160)}...` : value;
  try {
    const text = JSON.stringify(value);
    return text.length > 160 ? `${text.slice(0, 160)}...` : text;
  } catch {
    return "-";
  }
}

export function downloadReportCsv(filename, rows, mimeType = "text/csv;charset=utf-8", delimiter = ",") {
  if (!rows?.length) {
    toast.info("There are no rows to export yet.");
    return;
  }
  const keys = Array.from(rows.reduce((set, row) => {
    Object.keys(row || {}).forEach((key) => {
      if (typeof row[key] !== "object") set.add(key);
    });
    return set;
  }, new Set()));
  const escape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const csv = [keys.map(escape).join(delimiter), ...rows.map((row) => keys.map((key) => escape(row[key])).join(delimiter))].join("\n");
  const blob = new Blob([csv], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.replace(/\s+/g, "-").toLowerCase();
  link.click();
  URL.revokeObjectURL(url);
}

export function ReportRows({ rows }) {
  const safeRows = Array.isArray(rows) ? rows : [];
  return (
    <div className="divide-y divide-stone-100">
      {safeRows.map((item) => {
        const [label, value] = Array.isArray(item)
          ? item
          : [item?.label ?? item?.name ?? "Value", item?.value ?? item?.amount ?? ""];
        return (
          <div key={label} className="flex items-center justify-between gap-4 py-2 text-sm">
            <span className="text-stone-600">{label}</span>
            <strong className="font-display text-stone-900">{formatReportValue(value)}</strong>
          </div>
        );
      })}
    </div>
  );
}
