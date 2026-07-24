import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Activity } from "lucide-react";

export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100, 250];
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 250;

export function usePersistentTableLayout(storageKey, columns, defaultWidths) {
  const [initialLayout] = useState(() => {
    const defaultColumns = columns.map((column) => column.key);
    try {
      const stored = JSON.parse(window.localStorage.getItem(storageKey) || "null");
      const storedColumns = Array.isArray(stored?.visibleColumns)
        ? stored.visibleColumns.filter((key) => defaultColumns.includes(key))
        : [];
      const storedWidths = Object.fromEntries(
        Object.entries(stored?.columnWidths || {}).filter(([key, width]) => (
          defaultColumns.includes(key)
          && Number.isFinite(Number(width))
          && Number(width) >= 88
          && Number(width) <= 1000
        )).map(([key, width]) => [key, Number(width)])
      );
      return {
        visibleColumns: storedColumns.length ? storedColumns : defaultColumns,
        columnWidths: { ...defaultWidths, ...storedWidths },
      };
    } catch {
      return { visibleColumns: defaultColumns, columnWidths: { ...defaultWidths } };
    }
  });
  const [visibleColumns, setVisibleColumns] = useState(initialLayout.visibleColumns);
  const [columnWidths, setColumnWidths] = useState(initialLayout.columnWidths);

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({ visibleColumns, columnWidths }));
    } catch {
      // Storage can be unavailable in a private or restricted browser session.
    }
  }, [storageKey, visibleColumns, columnWidths]);

  return { visibleColumns, setVisibleColumns, columnWidths, setColumnWidths };
}

export function normalisePageSize(value) {
  const size = Number(value) || DEFAULT_PAGE_SIZE;
  if (size > MAX_PAGE_SIZE) return MAX_PAGE_SIZE;
  return PAGE_SIZE_OPTIONS.includes(size) ? size : DEFAULT_PAGE_SIZE;
}

export function pageSlice(rows = [], page = 1, pageSize = DEFAULT_PAGE_SIZE) {
  const safePageSize = normalisePageSize(pageSize);
  const safePage = Math.max(1, Number(page) || 1);
  const start = (safePage - 1) * safePageSize;
  return rows.slice(start, start + safePageSize);
}

export function normalisePaginatedResponse(payload = {}, fallbackPageSize = DEFAULT_PAGE_SIZE) {
  const source = payload?.data || payload;
  const nested = source?.ledger || source?.statements || source?.reconciliation || source?.account_transactions || source;
  const firstArray = (...lists) => lists.find((list) => Array.isArray(list)) || [];
  const rows = firstArray(
    source?.rows,
    nested?.rows,
    source?.items,
    source?.suppliers,
    source?.customers,
    source?.statement_lines,
    source?.ledger_rows,
    source?.transactions,
    source?.lines
  );
  const pageSize = normalisePageSize(source?.page_size || nested?.page_size || source?.pageSize || fallbackPageSize);
  const totalRows = Number(source?.total_rows ?? nested?.total_rows ?? source?.totalRows ?? nested?.totalRows ?? source?.count ?? rows.length) || 0;
  return {
    rows,
    page: Math.max(1, Number(source?.page ?? nested?.page) || 1),
    page_size: pageSize,
    total_rows: totalRows,
    total_pages: Math.max(1, Number(source?.total_pages ?? nested?.total_pages ?? source?.totalPages ?? nested?.totalPages) || Math.ceil(totalRows / pageSize) || 1),
    summary: source?.summary || nested?.summary || {},
    imports: firstArray(source?.imports, source?.import_batches, source?.batches),
  };
}

export function PaginationFooter({
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
  totalRows = 0,
  totalPages,
  onPageChange,
  onPageSizeChange,
  disabled = false,
}) {
  const safeTotalRows = Number(totalRows) || 0;
  const safePageSize = normalisePageSize(pageSize);
  const calculatedPages = Math.max(1, Math.ceil(safeTotalRows / safePageSize));
  const safeTotalPages = Math.max(1, Number(totalPages) || calculatedPages);
  const safePage = Math.min(Math.max(1, Number(page) || 1), safeTotalPages);
  const start = safeTotalRows ? ((safePage - 1) * safePageSize) + 1 : 0;
  const end = Math.min(safeTotalRows, safePage * safePageSize);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 px-3 py-3 text-sm text-stone-600">
      <div className="font-medium text-stone-700">Showing {start}-{end} of {safeTotalRows}</div>
      <div className="flex flex-wrap items-center gap-2">
        <Label className="text-xs font-semibold text-stone-600">Rows per page</Label>
        <select
          value={safePageSize}
          disabled={disabled}
          onChange={(event) => onPageSizeChange?.(normalisePageSize(event.target.value))}
          className="h-8 rounded-md border border-stone-200 bg-white px-2 text-sm disabled:bg-stone-50"
        >
          {PAGE_SIZE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
        <button
          type="button"
          disabled={disabled || safePage <= 1}
          onClick={() => onPageChange?.(safePage - 1)}
          className="h-8 rounded-md border border-stone-200 bg-white px-3 font-semibold text-stone-700 disabled:cursor-not-allowed disabled:bg-stone-50 disabled:text-stone-400"
        >
          Previous
        </button>
        <span className="min-w-20 text-center font-semibold text-stone-800">Page {safePage}</span>
        <button
          type="button"
          disabled={disabled || safePage >= safeTotalPages}
          onClick={() => onPageChange?.(safePage + 1)}
          className="h-8 rounded-md border border-stone-200 bg-white px-3 font-semibold text-stone-700 disabled:cursor-not-allowed disabled:bg-stone-50 disabled:text-stone-400"
        >
          Next
        </button>
      </div>
    </div>
  );
}

export function Panel({ title, action = null, children }) {
  return (
    <section className="rounded-md border border-stone-200 bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-stone-100 px-3 py-2">
        <h3 className="font-display text-base font-semibold text-stone-900">{title}</h3>
        {action}
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}

export function ActionDropdown({ actions = [], label = "Action" }) {
  const [open, setOpen] = useState(false);
  if (!actions.length) return null;
  return (
    <div className="relative">
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen((current) => !current)}>{label}</Button>
      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-64 rounded-md border border-stone-200 bg-white p-1 shadow-lg">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={() => {
                setOpen(false);
                action.onClick?.();
              }}
              className="block w-full rounded px-3 py-2 text-left text-sm font-semibold text-stone-700 hover:bg-stone-100"
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function SummaryCard({ label, value, tone, icon: Icon = Activity }) {
  const tones = {
    emerald: { icon: "bg-emerald-50 text-emerald-700 ring-emerald-100", value: "text-emerald-800" },
    blue: { icon: "bg-sky-50 text-sky-700 ring-sky-100", value: "text-sky-800" },
    amber: { icon: "bg-amber-50 text-amber-700 ring-amber-100", value: "text-amber-800" },
    stone: { icon: "bg-stone-100 text-stone-600 ring-stone-200", value: "text-stone-900" },
  };
  const selectedTone = tones[tone] || tones.stone;
  return (
    <div className="min-w-28 rounded-xl border border-stone-200 bg-white p-3 shadow-[0_3px_12px_rgba(28,25,23,0.06)]">
      <div className="flex items-center gap-3">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ring-1 ${selectedTone.icon}`}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <div className="truncate text-[10px] font-semibold uppercase tracking-wide text-stone-500">{label}</div>
          <div className={`mt-0.5 truncate font-display text-lg font-bold ${selectedTone.value}`}>{value}</div>
        </div>
      </div>
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

export function Field({ label, value, onChange, type = "text", disabled = false }) {
  return (
    <div>
      <Label className="text-xs font-semibold text-stone-600">{label}</Label>
      <Input type={type} value={value || ""} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={`mt-1 h-9 ${disabled ? "cursor-not-allowed bg-stone-100 text-stone-500" : ""}`} />
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

export function vatActiveForDate(workspace = {}, rawDate = "") {
  const status = workspace.vat_status || {};
  const transactionDate = String(rawDate || "").slice(0, 10);
  const start = String(status.vat_start_date || workspace.vat_engine?.settings?.vat_start_date || "").slice(0, 10);
  const end = String(status.vat_end_date || workspace.vat_engine?.settings?.vat_end_date || "").slice(0, 10);
  const vatClient = status.vat_client ?? workspace.client?.is_vat_client ?? false;
  return Boolean(vatClient && transactionDate && start && transactionDate >= start && (!end || transactionDate <= end));
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

export function AllocationModal({
  open,
  title,
  accountName,
  source = {},
  sourceLabel = "Payment",
  invoices = [],
  existingAllocations = [],
  loading = false,
  saving = false,
  error = "",
  onClose,
  onAllocate,
  onUnallocate,
}) {
  const [amounts, setAmounts] = useState({});

  useEffect(() => {
    if (open) setAmounts({});
  }, [open, source?.id]);

  useEffect(() => {
    if (!open) return undefined;
    const scrollY = window.scrollY;
    const previousBody = document.body.style.overflow;
    const previousHtml = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    const escape = (event) => {
      if (event.key === "Escape" && !saving) onClose?.();
    };
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("keydown", escape);
      document.body.style.overflow = previousBody;
      document.documentElement.style.overflow = previousHtml;
      window.scrollTo(0, scrollY);
    };
  }, [open, onClose, saving]);

  const requested = useMemo(() => Object.values(amounts).reduce((sum, value) => sum + (Number(value) || 0), 0), [amounts]);
  const available = Number(source?.unallocated_amount || 0);
  const targetName = source?.is_refund ? "credit note" : "invoice";
  const targetNamePlural = source?.is_refund ? "credit notes" : "invoices";
  const remaining = Math.max(0, available - requested);
  const invalid = requested <= 0 || requested > available + 0.001 || invoices.some((invoice) => (Number(amounts[invoice.id]) || 0) > Number(invoice.outstanding_amount || 0) + 0.001);
  if (!open) return null;

  const toggleInvoice = (invoice, checked) => {
    setAmounts((current) => {
      if (!checked) {
        const next = { ...current };
        delete next[invoice.id];
        return next;
      }
      const alreadyRequested = Object.entries(current).reduce((sum, [id, value]) => sum + (id === invoice.id ? 0 : Number(value) || 0), 0);
      const suggested = Math.min(Number(invoice.outstanding_amount || 0), Math.max(0, available - alreadyRequested));
      return { ...current, [invoice.id]: suggested.toFixed(2) };
    });
  };

  const modal = (
    <div className="fixed inset-0 z-[70] flex h-[100dvh] items-center justify-center bg-stone-950/60 p-3" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose?.(); }}>
      <div role="dialog" aria-modal="true" aria-label={title} className="flex max-h-[calc(100dvh-24px)] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-stone-200 bg-white px-5 py-4">
          <div>
            <h3 className="font-display text-lg font-semibold text-stone-900">{title}</h3>
            <p className="mt-1 text-sm text-stone-500">{accountName || "Account"} · {sourceLabel} {source.reference || source.id || ""}</p>
          </div>
          <Button type="button" variant="outline" size="sm" disabled={saving} onClick={onClose}>Close</Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="grid gap-3 sm:grid-cols-4">
            <AllocationSummary label={`${sourceLabel} total`} value={source.amount} />
            <AllocationSummary label="Already allocated" value={source.allocated_amount} />
            <AllocationSummary label="Available before save" value={source.unallocated_amount} />
            <AllocationSummary label="Remaining after save" value={remaining} />
          </div>
          {error ? <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}

          <section className="mt-5 rounded-md border border-stone-200">
            <div className="border-b border-stone-200 bg-stone-50 px-4 py-3">
              <h4 className="text-sm font-semibold text-stone-900">Existing allocations</h4>
              <p className="text-xs text-stone-500">Removing an allocation restores both the {targetName} balance and the amount available on account.</p>
            </div>
            {existingAllocations.length ? (
              <div className="divide-y divide-stone-100">
                {existingAllocations.map((allocation) => (
                  <div key={allocation.id} className="grid items-center gap-3 px-4 py-3 sm:grid-cols-[1fr_130px_auto]">
                    <div><div className="font-medium text-stone-900">{allocation.invoice_number || allocation.invoice_id}</div><div className="text-xs text-stone-500">{formatDate(allocation.invoice_date)}</div></div>
                    <div className="text-right font-semibold">{formatMoney(allocation.amount)}</div>
                    <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => onUnallocate?.(allocation)}>Unallocate</Button>
                  </div>
                ))}
              </div>
            ) : <div className="px-4 py-5 text-sm text-stone-500">No allocations have been made yet.</div>}
          </section>

          <section className="mt-5 rounded-md border border-stone-200">
            <div className="border-b border-stone-200 bg-stone-50 px-4 py-3">
              <h4 className="text-sm font-semibold text-stone-900">Allocate outstanding {targetNamePlural}</h4>
              <p className="text-xs text-stone-500">Select any number of {targetNamePlural} and enter a full or partial amount for each.</p>
            </div>
            {loading ? <div className="px-4 py-5 text-sm text-stone-500">Loading outstanding invoices…</div> : invoices.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] text-sm">
                  <thead className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500"><tr><th className="w-12 px-4 py-2">Use</th><th className="px-3 py-2">{targetName}</th><th className="px-3 py-2">Date</th><th className="px-3 py-2 text-right">Document total</th><th className="px-3 py-2 text-right">Outstanding</th><th className="w-44 px-4 py-2 text-right">Allocate</th></tr></thead>
                  <tbody>
                    {invoices.map((invoice) => {
                      const selected = Object.prototype.hasOwnProperty.call(amounts, invoice.id);
                      return <tr key={invoice.id} className="border-b border-stone-100">
                        <td className="px-4 py-2"><input type="checkbox" checked={selected} disabled={saving || available <= 0} onChange={(event) => toggleInvoice(invoice, event.target.checked)} /></td>
                        <td className="px-3 py-2 font-medium">{invoice.invoice_number}</td>
                        <td className="px-3 py-2">{formatDate(invoice.invoice_date)}</td>
                        <td className="px-3 py-2 text-right">{formatMoney(invoice.gross_amount)}</td>
                        <td className="px-3 py-2 text-right font-semibold">{formatMoney(invoice.outstanding_amount)}</td>
                        <td className="px-4 py-2"><Input type="number" min="0" step="0.01" max={invoice.outstanding_amount} disabled={!selected || saving} value={selected ? amounts[invoice.id] : ""} onChange={(event) => setAmounts((current) => ({ ...current, [invoice.id]: event.target.value }))} className="h-8 text-right" /></td>
                      </tr>;
                    })}
                  </tbody>
                </table>
              </div>
            ) : <div className="px-4 py-5 text-sm text-stone-500">There are no posted {targetNamePlural} with an outstanding balance.</div>}
          </section>
        </div>

        <footer className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 bg-white px-5 py-4">
          <div className={`text-sm font-medium ${requested > available + 0.001 ? "text-red-700" : "text-stone-600"}`}>Selected: {formatMoney(requested)} · Remaining: {formatMoney(remaining)}</div>
          <div className="flex gap-2"><Button type="button" variant="outline" disabled={saving} onClick={onClose}>Cancel</Button><Button type="button" disabled={saving || invalid} onClick={() => onAllocate?.(Object.entries(amounts).map(([invoice_id, amount]) => ({ invoice_id, amount: Number(amount) })))} style={{ background: "var(--brand)" }}>{saving ? "Saving…" : "Save allocations"}</Button></div>
        </footer>
      </div>
    </div>
  );
  return createPortal(modal, document.body);
}

export function AccountTransactionsAllocationModal({
  open,
  accountName,
  credits = [],
  debits = [],
  summary = {},
  loading = false,
  saving = false,
  error = "",
  onClose,
  onSave,
}) {
  const [creditAmounts, setCreditAmounts] = useState({});
  const [debitAmounts, setDebitAmounts] = useState({});
  useEffect(() => {
    if (open) {
      setCreditAmounts({});
      setDebitAmounts({});
    }
  }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const scrollY = window.scrollY;
    const bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const escape = (event) => {
      if (event.key === "Escape" && !saving) onClose?.();
    };
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("keydown", escape);
      document.body.style.overflow = bodyOverflow;
      window.scrollTo(0, scrollY);
    };
  }, [open, onClose, saving]);
  if (!open) return null;
  const creditTotal = Object.values(creditAmounts).reduce((sum, value) => sum + (Number(value) || 0), 0);
  const debitTotal = Object.values(debitAmounts).reduce((sum, value) => sum + (Number(value) || 0), 0);
  const balanced = creditTotal > 0 && Math.abs(creditTotal - debitTotal) < 0.005;
  const toggle = (row, checked, kind) => {
    const setter = kind === "credit" ? setCreditAmounts : setDebitAmounts;
    const limit = Number(kind === "credit" ? row.available_amount : row.outstanding_amount) || 0;
    setter((current) => {
      const next = { ...current };
      if (!checked) delete next[row.id];
      else next[row.id] = limit.toFixed(2);
      return next;
    });
  };
  const renderList = (rows, kind) => {
    const amounts = kind === "credit" ? creditAmounts : debitAmounts;
    const setter = kind === "credit" ? setCreditAmounts : setDebitAmounts;
    return (
      <div className="overflow-hidden rounded-md border border-stone-200">
        <div className="grid grid-cols-[36px_1fr_130px] border-b border-stone-200 bg-stone-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
          <span />
          <span>{kind === "credit" ? "Credit / payment" : "Debit invoice"}</span>
          <span className="text-right">Allocate</span>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {rows.length ? rows.map((row) => {
            const selected = Object.prototype.hasOwnProperty.call(amounts, row.id);
            const limit = Number(kind === "credit" ? row.available_amount : row.outstanding_amount) || 0;
            return (
              <div key={`${kind}-${row.source_type || "invoice"}-${row.id}`} className="grid grid-cols-[36px_1fr_130px] items-center gap-2 border-b border-stone-100 px-3 py-2 last:border-0">
                <input type="checkbox" checked={selected} disabled={saving} onChange={(event) => toggle(row, event.target.checked, kind)} />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-stone-900">{row.reference || row.id}</div>
                  <div className="truncate text-xs text-stone-500">{formatDate(row.date)} · {row.description || (kind === "credit" ? row.source_type : "Invoice")} · Available {formatMoney(limit)}</div>
                </div>
                <Input type="number" min="0" step="0.01" max={limit} disabled={!selected || saving} value={selected ? amounts[row.id] : ""} onChange={(event) => setter((current) => ({ ...current, [row.id]: event.target.value }))} className="h-8 text-right" />
              </div>
            );
          }) : <div className="px-4 py-8 text-center text-sm text-stone-500">No open {kind === "credit" ? "credits" : "debits"} available.</div>}
        </div>
      </div>
    );
  };
  return createPortal(
    <div className="fixed inset-0 z-[80] flex h-[100dvh] items-center justify-center bg-stone-950/60 p-3">
      <div role="dialog" aria-modal="true" aria-label="Allocate transactions" className="flex max-h-[calc(100dvh-24px)] w-full max-w-6xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-stone-200 bg-white px-5 py-4">
          <div><h3 className="font-display text-lg font-semibold text-stone-900">Allocate transactions</h3><p className="mt-1 text-sm text-stone-500">{accountName || "Customer account"} · Match multiple credits against multiple debit invoices.</p></div>
          <Button type="button" variant="outline" disabled={saving} onClick={onClose}>Close</Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="mb-4 grid gap-3 sm:grid-cols-4">
            <AllocationSummary label="Available credits" value={summary.available_credits} />
            <AllocationSummary label="Outstanding debits" value={summary.outstanding_debits} />
            <AllocationSummary label="Selected credits" value={creditTotal} />
            <AllocationSummary label="Selected debits" value={debitTotal} />
          </div>
          {error ? <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
          {loading ? <div className="py-10 text-center text-sm text-stone-500">Loading open transactions…</div> : (
            <div className="grid gap-4 lg:grid-cols-2">
              <section><h4 className="mb-2 font-semibold text-stone-900">Credits</h4>{renderList(credits, "credit")}</section>
              <section><h4 className="mb-2 font-semibold text-stone-900">Debits</h4>{renderList(debits, "debit")}</section>
            </div>
          )}
        </div>
        <footer className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 bg-white px-5 py-4">
          <div className={`text-sm font-medium ${creditTotal && !balanced ? "text-red-700" : "text-stone-600"}`}>{balanced ? `Balanced allocation: ${formatMoney(creditTotal)}` : "Selected credit and debit totals must match."}</div>
          <div className="flex gap-2"><Button type="button" variant="outline" disabled={saving} onClick={onClose}>Cancel</Button><Button type="button" disabled={saving || loading || !balanced} onClick={() => onSave?.({
            credits: credits.filter((row) => creditAmounts[row.id]).map((row) => ({ id: row.id, source_type: row.source_type, reference: row.reference, amount: Number(creditAmounts[row.id]) })),
            debits: debits.filter((row) => debitAmounts[row.id]).map((row) => ({ id: row.id, reference: row.reference, amount: Number(debitAmounts[row.id]) })),
          })} style={{ background: "var(--brand)" }}>{saving ? "Allocating…" : "Allocate transactions"}</Button></div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

export function TransactionAllocationsModal({
  open,
  transaction = {},
  saving = false,
  error = "",
  onClose,
  onUnallocate,
}) {
  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const escape = (event) => {
      if (event.key === "Escape" && !saving) onClose?.();
    };
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("keydown", escape);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose, saving]);
  if (!open) return null;
  const allocations = transaction.allocation_summary?.allocations || [];
  return createPortal(
    <div className="fixed inset-0 z-[85] flex h-[100dvh] items-center justify-center bg-stone-950/60 p-3">
      <div role="dialog" aria-modal="true" aria-label="View allocations" className="flex max-h-[calc(100dvh-24px)] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-stone-200 px-5 py-4">
          <div><h3 className="font-display text-lg font-semibold text-stone-900">Transaction allocations</h3><p className="mt-1 text-sm text-stone-500">{transaction.type} · {transaction.reference || transaction.id}</p></div>
          <Button type="button" variant="outline" disabled={saving} onClick={onClose}>Close</Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {error ? <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
          <div className="overflow-hidden rounded-md border border-stone-200">
            <div className="grid grid-cols-[1fr_1fr_120px_110px] gap-3 border-b border-stone-200 bg-stone-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
              <span>Credit source</span><span>Debit target</span><span className="text-right">Amount</span><span />
            </div>
            {allocations.length ? allocations.map((allocation) => (
              <div key={allocation.id} className="grid grid-cols-[1fr_1fr_120px_110px] items-center gap-3 border-b border-stone-100 px-4 py-3 text-sm last:border-0">
                <div><div className="font-semibold text-stone-900">{allocation.source_reference || allocation.receipt_id || allocation.credit_note_id || "Credit"}</div><div className="text-xs text-stone-500">{formatDate(allocation.source_date)}</div></div>
                <div><div className="font-semibold text-stone-900">{allocation.target_reference || allocation.invoice_number || allocation.invoice_id || "Invoice"}</div><div className="text-xs text-stone-500">{formatDate(allocation.target_date || allocation.invoice_date)}</div></div>
                <div className="text-right font-semibold">{formatMoney(allocation.amount)}</div>
                <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => onUnallocate?.(allocation)}>Unallocate</Button>
              </div>
            )) : <div className="px-4 py-8 text-center text-sm text-stone-500">No allocations are recorded against this transaction.</div>}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function AllocationSummary({ label, value }) {
  return <div className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2"><div className="text-xs font-semibold uppercase tracking-wide text-stone-500">{label}</div><div className="mt-1 font-display text-lg font-semibold text-stone-900">{formatMoney(value)}</div></div>;
}
