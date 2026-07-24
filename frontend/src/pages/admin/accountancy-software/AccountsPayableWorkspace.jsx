import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { API, api, formatApiError } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Building2,
  Download,
  Edit3,
  Filter,
  FileText,
  HelpCircle,
  Plus,
  ReceiptText,
  Save,
  Search,
  WalletCards,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  AccountCodeSelect,
  AccountTransactionsAllocationModal,
  ActionDropdown,
  AllocationModal,
  DEFAULT_PAGE_SIZE,
  Panel,
  PaginationFooter,
  TransactionAllocationsModal,
  formatDate,
  formatDateTime,
  formatMoney,
  normalisePaginatedResponse,
  normalisePageSize,
  statusBadgeClass,
  usePersistentTableLayout,
  vatActiveForDate,
} from "./shared";

const apTabs = ["Suppliers", "Create supplier", "General Settings"];
const supplierRecordTabs = ["General", "Ledger", "Audit Trail"];
const transactionTypes = ["Purchase Invoice", "Supplier Credit Note", "Supplier Payment", "Payment on Account"];
const ledgerColumnDefinitions = [
  { key: "date", label: "Date" },
  { key: "type", label: "Type" },
  { key: "reference", label: "Reference" },
  { key: "description", label: "Description" },
  { key: "invoice_value", label: "Invoice value" },
  { key: "allocated", label: "Payment" },
  { key: "balance", label: "Line balance" },
  { key: "status", label: "Status" },
  { key: "allocations", label: "Allocations" },
  { key: "attachment", label: "Attachment" },
];
const defaultLedgerColumnWidths = {
  date: 120,
  type: 160,
  reference: 160,
  description: 280,
  invoice_value: 150,
  allocated: 160,
  balance: 170,
  status: 170,
  allocations: 150,
  attachment: 140,
};
const AP_LEDGER_LAYOUT_STORAGE_KEY = "epos-native-accounting.ap-ledger-layout.v1";
const supplierCategoryLabels = {
  Trade: "Trade supplier",
  HMRC_VAT: "HMRC VAT",
  HMRC_PAYE: "HMRC PAYE",
  HMRC_CT: "HMRC Corporation Tax",
  HMRC_CIS: "HMRC CIS",
  CompaniesHouse: "Companies House",
  Pension: "Pension provider",
};

const emptySupplierForm = {
  name: "",
  supplier_code: "",
  supplier_category: "Trade",
  email: "",
  phone: "",
  website: "",
  vat_number: "",
  company_number: "",
  payment_terms_days: "30",
  default_currency: "GBP",
  default_purchase_account: "5000",
  default_vat_code: "",
  bank_name: "",
  bank_sort_code: "",
  bank_account_number: "",
  payment_reference: "",
  cis_registered: false,
  reverse_charge: false,
  notes: "",
};

function todayInput() {
  return new Date().toISOString().slice(0, 10);
}

function toInputDate(value) {
  return value ? String(value).slice(0, 10) : "";
}

function copiedDocumentNumber(value) {
  const base = String(value || "").trim();
  return base ? `${base}-COPY` : "";
}

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function addDaysInput(value, days) {
  const date = value ? new Date(value) : new Date();
  date.setDate(date.getDate() + asNumber(days));
  return date.toISOString().slice(0, 10);
}

function formatAmount(value) {
  const n = asNumber(value);
  return n ? n.toFixed(2) : "";
}

function purchaseDocumentLine(description = "", amount = "") {
  return {
    description,
    purchase_nominal: "",
    vat_code: "",
    quantity: "1",
    unit_price: amount,
    net: amount,
    vat: "",
    gross: amount,
  };
}

function documentNumberLabel(type) {
  return type === "Supplier Credit Note" ? "Credit note number" : "Invoice / bill number";
}

function documentDateLabel(type) {
  return type === "Supplier Credit Note" ? "Credit note date" : "Invoice date";
}

function isCreditDocument(type) {
  return type === "Supplier Credit Note" || type === "Credit Note";
}

function isPaymentDocument(type) {
  return type === "Supplier Payment" || type === "Payment on Account";
}

function normaliseStatusText(value) {
  return String(value || "").trim().toLowerCase().replace(/[_-]+/g, " ");
}

function displayStatus(value) {
  if (normaliseStatusText(value) === "draft") return "Awaiting Approval";
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function optionLabel(value, options = []) {
  const match = options.find((option) => String(option.value) === String(value));
  return match?.label || displayStatus(value);
}

const supplierNumberingOptions = [
  { value: "manual", label: "Manual" },
  { value: "automatic", label: "Automatic" },
  { value: "prefix", label: "Prefix based" },
];

const paymentOnAccountBehaviourOptions = [
  { value: "hold", label: "Hold for future allocation" },
  { value: "warn", label: "Warn before saving" },
  { value: "require_allocation", label: "Require allocation" },
];

const expenseBehaviourOptions = [
  { value: "allow", label: "Allow expense entries" },
  { value: "review", label: "Review expense entries" },
  { value: "disable", label: "Disable expense entries" },
];

function isReadOnlyTransaction(draft) {
  if (typeof draft?.view_only === "boolean") return draft.view_only;
  return !["draft", "awaiting approval"].includes(normaliseStatusText(draft?.status || "Draft"));
}

function transactionLineTotals(lines = []) {
  return lines.reduce((totals, line) => {
    totals.net += asNumber(line.net);
    totals.vat += asNumber(line.vat);
    totals.gross += asNumber(line.gross);
    return totals;
  }, { net: 0, vat: 0, gross: 0 });
}

function invoiceValue(row = {}) {
  return asNumber(row.invoice_value);
}

function allocatedValue(row = {}) {
  return asNumber(row.paid_allocated);
}

function paymentValue(row = {}) {
  return asNumber(row.payment_value ?? row.payment_amount);
}

function invoiceBalance(row = {}) {
  return asNumber(row.line_balance ?? row.invoice_balance ?? row.account_balance);
}

function normaliseApLedgerType(type = "") {
  const value = String(type || "").toLowerCase();
  if (value.includes("credit")) return "Supplier Credit Note";
  if (value.includes("payment") && !value.includes("account")) return "Supplier Payment";
  if (value.includes("account")) return "Payment on Account";
  if (value.includes("expense")) return "Expense";
  return "Purchase Invoice";
}

function normaliseLedgerSource(type = "") {
  const value = String(type || "").toLowerCase();
  if (value.includes("credit")) return "credit_note";
  if (value.includes("payment")) return "payment";
  if (value.includes("expense")) return "expense";
  return "invoice";
}

function attachmentUrl(row = {}) {
  return row.attachment_url || row.document_url || row.source_document_url || "";
}

function hasAttachment(row = {}) {
  return Boolean(attachmentUrl(row) || row.source_submission_id || row.attachment_path);
}

function isServedDocumentUrl(value) {
  return /^https?:\/\//i.test(String(value || "")) || String(value || "").startsWith("/");
}

function browserDocumentUrl(value) {
  const url = String(value || "").trim();
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/api/")) return `${API.replace(/\/api\/?$/, "")}${url}`;
  if (url.startsWith("/")) return `${API}${url}`;
  return "";
}

function sourceDocumentKind(value = "") {
  const path = String(value).split("?")[0].toLowerCase();
  if (path.endsWith(".pdf")) return "pdf";
  if (/\.(png|jpe?g|gif|webp|bmp)$/i.test(path)) return "image";
  return "unknown";
}

function linePurchaseNominal(line = {}) {
  return line.purchase_nominal || line.purchase_nominal_code || line.purchase_account || line.purchase_account_code || line.account_code || line.nominal_account_code || line.category || "";
}

function normaliseLineItem(line = {}, fallbackDescription = "", fallbackAmount = "") {
  return {
    description: line.description || line.line_description || fallbackDescription,
    purchase_nominal: linePurchaseNominal(line),
    vat_code: line.vat_code || line.tax_code || "",
    quantity: line.quantity ?? line.units ?? "1",
    unit_price: line.unit_price ?? line.price ?? line.rate ?? fallbackAmount,
    net: line.net ?? line.net_amount ?? fallbackAmount,
    vat: line.vat ?? line.vat_amount ?? "",
    gross: line.gross ?? line.gross_amount ?? line.total ?? fallbackAmount,
  };
}

function normaliseTransactionDetailResponse(data = {}) {
  return data.invoice || data.ap_invoice || data.purchase_invoice || data.credit_note || data.payment || data.expense || data.transaction || data;
}

function normaliseVatOption(vat = {}) {
  const code = vat.code || vat.vat_code || vat.tax_code || vat.id || "";
  if (!code) return null;
  const description = vat.description || vat.detail || (vat.name && vat.name !== code ? vat.name : "");
  return {
    value: code,
    label: `${code}${description ? ` - ${description}` : ""}`.trim(),
  };
}

function normaliseOptionText(value) {
  return String(value || "").trim().toLowerCase();
}

function canonicalOptionValue(rawValue, options = []) {
  const raw = String(rawValue || "").trim();
  if (!raw) return "";
  const rawKey = normaliseOptionText(raw);
  const prefixKey = normaliseOptionText(raw.split(" - ")[0]);
  const match = options.find((option) => {
    const valueKey = normaliseOptionText(option.value);
    const labelKey = normaliseOptionText(option.label);
    return valueKey === rawKey || labelKey === rawKey || valueKey === prefixKey;
  });
  return match?.value || raw;
}

function ledgerImpactFor(type) {
  if (isCreditDocument(type)) {
    return {
      debit: "Debit creditors control",
      credit: "Credit purchase nominal/VAT",
    };
  }
  if (isPaymentDocument(type)) {
    return {
      debit: "Debit creditors control",
      credit: "Credit bank/cash",
    };
  }
  return {
    debit: "Debit purchase nominal/VAT",
    credit: "Credit creditors control",
  };
}

function normaliseSupplierDraft(supplier = {}) {
  return {
    name: supplier.name || "",
    supplier_code: supplier.supplier_code || "",
    supplier_category: supplier.supplier_category || supplier.supplierCategory || "Trade",
    trading_name: supplier.trading_name || "",
    email: supplier.email || "",
    phone: supplier.phone || "",
    website: supplier.website || "",
    status: supplier.status || "Active",
    default_currency: supplier.default_currency || "GBP",
    registered_address: supplier.registered_address || supplier.address || "",
    trading_address: supplier.trading_address || "",
    billing_address: supplier.billing_address || "",
    contact_name: supplier.contact_name || "",
    contact_position: supplier.contact_position || "",
    contact_email: supplier.contact_email || supplier.email || "",
    contact_phone: supplier.contact_phone || supplier.phone || "",
    bank_name: supplier.bank_name || "",
    bank_sort_code: supplier.bank_sort_code || "",
    bank_account_number: supplier.bank_account_number || "",
    payment_reference: supplier.payment_reference || "",
    payment_terms_days: supplier.payment_terms_days ?? "30",
    default_purchase_account: supplier.default_purchase_account || "",
    vat_number: supplier.vat_number || "",
    company_number: supplier.company_number || "",
    default_vat_code: supplier.default_vat_code || "",
    cis_registered: Boolean(supplier.cis_registered),
    reverse_charge: Boolean(supplier.reverse_charge),
    notes: supplier.notes || "",
  };
}

function HelpHint({ text }) {
  const [open, setOpen] = useState(false);

  if (!text) return null;

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-stone-400 hover:bg-stone-100 hover:text-stone-700"
        aria-label={text}
        title={text}
        onClick={(event) => {
          event.preventDefault();
          setOpen((value) => !value);
        }}
        onBlur={() => setOpen(false)}
      >
        <HelpCircle className="h-3.5 w-3.5" />
      </button>
      {open ? (
        <span className="absolute left-1/2 top-5 z-30 w-72 -translate-x-1/2 rounded-md border border-stone-200 bg-white p-3 text-left text-xs font-normal leading-5 text-stone-700 shadow-lg">
          {text}
        </span>
      ) : null}
    </span>
  );
}

function Section({ title, children }) {
  return (
    <section className="overflow-hidden rounded-lg border border-stone-300 bg-white shadow-sm">
      <h4 className="border-b border-stone-200 bg-stone-100/80 px-4 py-2.5 text-sm font-bold text-stone-900">{title}</h4>
      <div className="p-4">{children}</div>
    </section>
  );
}

function DisplayValue({ value }) {
  return (
    <div className="mt-1 min-h-9 rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-800">
      {value || "-"}
    </div>
  );
}

function EditableField({
  label,
  value,
  onChange,
  editable,
  type = "text",
  options,
  textarea,
  checkbox,
  help,
  placeholder,
}) {
  return (
    <div className={textarea ? "md:col-span-2" : ""}>
      <div className="flex items-center gap-1.5">
        <Label className="text-xs font-semibold text-stone-600">{label}</Label>
        {help ? <HelpHint text={help} /> : null}
      </div>
      {!editable ? (
        <DisplayValue value={checkbox ? (value ? "Yes" : "No") : value} />
      ) : checkbox ? (
        <label className="mt-2 flex min-h-9 items-center gap-2 rounded-md border border-stone-200 bg-white px-3 text-sm">
          <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
          Enabled
        </label>
      ) : textarea ? (
        <textarea
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="mt-1 min-h-24 w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-emerald-500"
        />
      ) : Array.isArray(options) ? (
        <select
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1 h-9 w-full rounded-md border border-stone-200 bg-white px-3 text-sm shadow-sm outline-none focus:border-emerald-500"
        >
          <option value="">Select</option>
          {options.map((option) => (
            <option key={option.value ?? option} value={option.value ?? option}>
              {option.label ?? option}
            </option>
          ))}
        </select>
      ) : (
        <Input
          type={type}
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="mt-1 h-9"
        />
      )}
    </div>
  );
}

function AccountsPayableWorkspace({ workspace, tab, setTab, reloadWorkspace, busy, setHeaderContext }) {
  const ap = workspace.accounts_payable || {};
  const clientId = workspace.client?.id;
  const [supplierSummaries, setSupplierSummaries] = useState(() => (Array.isArray(ap.suppliers) ? ap.suppliers : []));
  const suppliers = supplierSummaries;
  const accounts = useMemo(() => (Array.isArray(workspace.accounts) ? workspace.accounts : []), [workspace.accounts]);
  const bankAccounts = useMemo(() => accounts.filter((account) => account.purpose === "Bank Account" || account.account_type === "Bank"), [accounts]);
  const expenseAccounts = useMemo(() => accounts.filter((account) => account.category === "Expense" || account.account_type === "Purchases" || account.account_type === "Overheads"), [accounts]);
  const vatCodes = useMemo(() => {
    const lists = [
      workspace.vat_codes,
      workspace.native_vat_codes,
      workspace.vat?.codes,
      workspace.vat?.vat_codes,
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
  }, [workspace.accounting?.vat_codes, workspace.native_vat_codes, workspace.vat?.codes, workspace.vat?.vat_codes, workspace.vat_codes]);
  const defaultCurrency = workspace.client?.default_currency || workspace.accounting?.default_currency || workspace.accounting_default_currency || workspace.default_currency || ap.settings?.default_currency || "GBP";
  const activeTab = apTabs.includes(tab) ? tab : "Suppliers";

  const [saving, setSaving] = useState(false);
  const [supplierQuery, setSupplierQuery] = useState("");
  const [supplierForm, setSupplierForm] = useState(emptySupplierForm);
  const [createSupplierOpen, setCreateSupplierOpen] = useState(false);
  const [settingsForm, setSettingsForm] = useState(ap.settings || {});
  const [selectedSupplierId, setSelectedSupplierId] = useState("");
  const [supplierRecordTab, setSupplierRecordTab] = useState("General");
  const [supplierEditMode, setSupplierEditMode] = useState(false);
  const [supplierDraft, setSupplierDraft] = useState(normaliseSupplierDraft());
  const [ledgerSearch, setLedgerSearch] = useState("");
  const [ledgerTypeFilter, setLedgerTypeFilter] = useState("All");
  const [ledgerStatusFilter, setLedgerStatusFilter] = useState("All");
  const [ledgerDateFrom, setLedgerDateFrom] = useState("");
  const [ledgerDateTo, setLedgerDateTo] = useState("");
  const [ledgerReferenceFilter, setLedgerReferenceFilter] = useState("");
  const [ledgerDescriptionFilter, setLedgerDescriptionFilter] = useState("");
  const [ledgerAttachmentFilter, setLedgerAttachmentFilter] = useState("All");
  const [ledgerInvoiceValueMin, setLedgerInvoiceValueMin] = useState("");
  const [ledgerInvoiceValueMax, setLedgerInvoiceValueMax] = useState("");
  const [ledgerAllocatedMin, setLedgerAllocatedMin] = useState("");
  const [ledgerAllocatedMax, setLedgerAllocatedMax] = useState("");
  const [ledgerBalanceMin, setLedgerBalanceMin] = useState("");
  const [ledgerBalanceMax, setLedgerBalanceMax] = useState("");
  const [ledgerSort, setLedgerSort] = useState({ key: "date", direction: "desc" });
  const [openLedgerFilter, setOpenLedgerFilter] = useState("");
  const [selectedLedgerKeys, setSelectedLedgerKeys] = useState([]);
  const [columnSelectorOpen, setColumnSelectorOpen] = useState(false);
  const {
    visibleColumns: visibleLedgerColumns,
    setVisibleColumns: setVisibleLedgerColumns,
    columnWidths: ledgerColumnWidths,
    setColumnWidths: setLedgerColumnWidths,
  } = usePersistentTableLayout(AP_LEDGER_LAYOUT_STORAGE_KEY, ledgerColumnDefinitions, defaultLedgerColumnWidths);
  const [ledgerPage, setLedgerPage] = useState(1);
  const [ledgerPageSize, setLedgerPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [ledgerData, setLedgerData] = useState(() => normalisePaginatedResponse({ rows: [], page_size: DEFAULT_PAGE_SIZE }));
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerError, setLedgerError] = useState("");
  const [allocationRow, setAllocationRow] = useState(null);
  const [allocationData, setAllocationData] = useState(null);
  const [allocationLoading, setAllocationLoading] = useState(false);
  const [allocationSaving, setAllocationSaving] = useState(false);
  const [allocationError, setAllocationError] = useState("");
  const [accountAllocationOpen, setAccountAllocationOpen] = useState(false);
  const [accountAllocationData, setAccountAllocationData] = useState({ credits: [], debits: [], summary: {} });
  const [accountAllocationLoading, setAccountAllocationLoading] = useState(false);
  const [accountAllocationSaving, setAccountAllocationSaving] = useState(false);
  const [accountAllocationError, setAccountAllocationError] = useState("");
  const [viewAllocationRow, setViewAllocationRow] = useState(null);
  const [ledgerDraftRows, setLedgerDraftRows] = useState([]);
  const [transactionDraft, setTransactionDraft] = useState(null);
  const transactionVatActive = !transactionDraft || isPaymentDocument(transactionDraft.type) || vatActiveForDate(workspace, transactionDraft.date);
  const transactionVatCodes = transactionVatActive ? vatCodes : vatCodes.filter((option) => String(option.value).toUpperCase() === "NO VAT");
  useEffect(() => {
    if (!transactionDraft || isPaymentDocument(transactionDraft.type) || transactionVatActive) return;
    setTransactionDraft((current) => {
      if (!current || (current.vat_code === "NO VAT" && asNumber(current.vat) === 0 && (current.line_items || []).every((line) => line.vat_code === "NO VAT" && asNumber(line.vat) === 0))) return current;
      return {
        ...current,
        vat_code: "NO VAT",
        vat: "0.00",
        gross: current.net,
        line_items: (current.line_items || []).map((line) => ({ ...line, vat_code: "NO VAT", vat: "0.00", gross: line.net })),
      };
    });
  }, [transactionDraft, transactionVatActive]);
  const [transactionEntryMode, setTransactionEntryMode] = useState("");
  const [transactionErrors, setTransactionErrors] = useState({});
  const [auditSearch, setAuditSearch] = useState("");
  const [auditActionFilter, setAuditActionFilter] = useState("All");
  const [auditPage, setAuditPage] = useState(1);
  const [auditPageSize, setAuditPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [auditData, setAuditData] = useState(() => normalisePaginatedResponse({ page_size: DEFAULT_PAGE_SIZE }));
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState("");
  const auditTrail = auditData.rows;

  useEffect(() => { setAuditPage(1); }, [selectedSupplierId, auditSearch, auditActionFilter, auditPageSize]);
  useEffect(() => {
    if (supplierRecordTab !== "Audit Trail" || !clientId || !selectedSupplierId) return;
    let cancelled = false;
    const params = new URLSearchParams({ page: String(auditPage), page_size: String(auditPageSize) });
    if (auditSearch) params.set("search", auditSearch);
    if (auditActionFilter !== "All") params.set("action", auditActionFilter);
    setAuditLoading(true); setAuditError("");
    api.get(`/admin/accounting/clients/${clientId}/ap/suppliers/${selectedSupplierId}/audit-trail?${params.toString()}`)
      .then(({ data }) => { if (!cancelled) setAuditData(normalisePaginatedResponse(data, auditPageSize)); })
      .catch((error) => { if (!cancelled) setAuditError(formatApiError(error)); })
      .finally(() => { if (!cancelled) setAuditLoading(false); });
    return () => { cancelled = true; };
  }, [supplierRecordTab, clientId, selectedSupplierId, auditPage, auditPageSize, auditSearch, auditActionFilter]);

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    api.get(`/admin/accounting/clients/${clientId}/ap/suppliers`)
      .then(({ data }) => {
        if (!cancelled) setSupplierSummaries(Array.isArray(data?.rows) ? data.rows : []);
      })
      .catch((error) => {
        if (!cancelled) toast.error(`Unable to load supplier summaries: ${formatApiError(error)}`);
      });
    return () => { cancelled = true; };
  }, [clientId, workspace]);

  useEffect(() => {
    setSettingsForm(ap.settings || {});
  }, [ap.settings]);

  useEffect(() => {
    setLedgerPage(1);
  }, [selectedSupplierId, ledgerSearch, ledgerTypeFilter, ledgerStatusFilter, ledgerDateFrom, ledgerDateTo, ledgerReferenceFilter, ledgerDescriptionFilter, ledgerAttachmentFilter, ledgerInvoiceValueMin, ledgerInvoiceValueMax, ledgerAllocatedMin, ledgerAllocatedMax, ledgerBalanceMin, ledgerBalanceMax]);

  useEffect(() => {
    setSelectedLedgerKeys([]);
  }, [selectedSupplierId, ledgerPage, ledgerPageSize, ledgerTypeFilter, ledgerStatusFilter, ledgerDateFrom, ledgerDateTo, ledgerReferenceFilter, ledgerDescriptionFilter, ledgerAttachmentFilter, ledgerInvoiceValueMin, ledgerInvoiceValueMax, ledgerAllocatedMin, ledgerAllocatedMax, ledgerBalanceMin, ledgerBalanceMax]);

  useEffect(() => {
    if (activeTab === "Create supplier") {
      setSelectedSupplierId("");
      setTransactionDraft(null);
      setTransactionEntryMode("");
      setCreateSupplierOpen(true);
    }
  }, [activeTab]);

  function closeCreateSupplier() {
    setCreateSupplierOpen(false);
    setTab?.("Suppliers");
  }

  function createPensionProviderFromTemplate() {
    if (!selectedSupplierIsSystem || selectedSupplier?.supplier_category !== "Pension") return;
    setSupplierForm({
      ...emptySupplierForm,
      supplier_category: "Pension",
      payment_terms_days: String(selectedSupplier.payment_terms_days || 30),
      default_currency: selectedSupplier.default_currency || "GBP",
      default_purchase_account: selectedSupplier.default_purchase_account || "5000",
      default_vat_code: selectedSupplier.default_vat_code || "",
      notes: "Created from the protected Pension Provider system template.",
    });
    setCreateSupplierOpen(true);
  }

  useEffect(() => {
    if (selectedSupplierId && !suppliers.some((supplier) => supplier.id === selectedSupplierId)) {
      setSelectedSupplierId("");
      setTransactionDraft(null);
      setTransactionEntryMode("");
    }
  }, [selectedSupplierId, suppliers]);

  const selectedSupplier = suppliers.find((supplier) => supplier.id === selectedSupplierId);
  const selectedSupplierIsSystem = Boolean(selectedSupplier?.is_system_supplier || selectedSupplier?.isSystemSupplier);

  useEffect(() => {
    setSupplierDraft(normaliseSupplierDraft(selectedSupplier));
    setSupplierEditMode(false);
  }, [selectedSupplier]);

  const visibleSuppliers = suppliers.filter((supplier) => {
    const needle = supplierQuery.trim().toLowerCase();
    if (!needle) return true;
    return `${supplier.name || ""} ${supplier.trading_name || ""} ${supplier.supplier_code || ""} ${supplier.email || ""}`.toLowerCase().includes(needle);
  });

  async function run(action, success) {
    setSaving(true);
    try {
      await action();
      toast.success(success);
      await reloadWorkspace();
      if (selectedSupplierId) await refreshSupplierLedger();
      return true;
    } catch (e) {
      const message = formatApiError(e);
      setTransactionErrors((current) => ({ ...current, backend: message }));
      toast.error(message);
      return false;
    } finally {
      setSaving(false);
    }
  }

  const postJson = (url, payload) => api.post(`/admin/accounting/clients/${clientId}${url}`, payload);
  const putJson = (url, payload) => api.put(`/admin/accounting/clients/${clientId}${url}`, payload);

  const refreshSupplierLedger = useCallback(async () => {
    if (!clientId || !selectedSupplierId) {
      setLedgerData(normalisePaginatedResponse({ rows: [], page_size: ledgerPageSize }));
      return;
    }
    const params = new URLSearchParams({
      page: String(ledgerPage),
      page_size: String(ledgerPageSize),
      supplier_id: selectedSupplierId,
    });
    if (ledgerSearch.trim()) params.set("search", ledgerSearch.trim());
    if (ledgerTypeFilter !== "All") params.set("type", ledgerTypeFilter);
    if (ledgerStatusFilter !== "All") params.set("status", ledgerStatusFilter);
    if (ledgerDateFrom) params.set("date_from", ledgerDateFrom);
    if (ledgerDateTo) params.set("date_to", ledgerDateTo);
    setLedgerLoading(true);
    setLedgerError("");
    try {
      const { data } = await api.get(`/admin/accounting/clients/${clientId}/ap/suppliers/${selectedSupplierId}/ledger?${params.toString()}`);
      setLedgerData(normalisePaginatedResponse(data, ledgerPageSize));
    } catch (error) {
      setLedgerData(normalisePaginatedResponse({ rows: [], page: ledgerPage, page_size: ledgerPageSize }));
      setLedgerError(formatApiError(error));
    } finally {
      setLedgerLoading(false);
    }
  }, [clientId, ledgerDateFrom, ledgerDateTo, ledgerPage, ledgerPageSize, ledgerSearch, ledgerStatusFilter, ledgerTypeFilter, selectedSupplierId]);

  useEffect(() => {
    if (!selectedSupplierId) return;
    refreshSupplierLedger();
  }, [refreshSupplierLedger, selectedSupplierId]);

  async function createSupplier(e) {
    e.preventDefault();
    if (!supplierForm.name.trim()) return toast.error("Supplier name is required");
    await run(async () => postJson("/ap/suppliers", supplierForm), "Supplier created");
    setSupplierForm(emptySupplierForm);
    closeCreateSupplier();
  }

  function supplierById(id) {
    return suppliers.find((supplier) => supplier.id === id);
  }

  function openSupplier(supplierId) {
    setSelectedSupplierId(supplierId);
    setSupplierRecordTab("Ledger");
    setTransactionDraft(null);
    setTransactionEntryMode("");
  }

  const supplierLedgerRows = useCallback((supplierId) => {
    const baseRows = (ledgerData.rows || []).map((row) => ({
      ...row,
      id: row.id,
      ledgerKey: row.ledgerKey || row.ledger_key || `${row.source || row.type || "ledger"}-${row.id || row.reference || row.date}`,
      supplier_id: row.supplier_id || supplierId,
      source: row.source || row.record_type || normaliseLedgerSource(row.type),
      date: row.invoice_date || row.credit_note_date || row.payment_date || row.expense_date || row.date || row.created_at,
      type: normaliseApLedgerType(row.type || row.record_type || row.document_type),
      reference: row.invoice_number || row.credit_note_number || row.payment_reference || row.reference || "-",
      description: row.description || row.supplier_name || "Supplier ledger item",
      invoice_value: invoiceValue(row),
      paid_allocated: allocatedValue(row),
      payment_value: paymentValue(row),
      invoice_balance: invoiceBalance(row),
      status: row.status || "Open",
    }));

    const supplierDraftRows = ledgerDraftRows.filter((row) => row.supplier_id === supplierId);
    const draftOverrides = new Map(
      supplierDraftRows.filter((row) => row.originalKey).map((row) => [row.originalKey, row])
    );
    const draftAdditions = supplierDraftRows.filter((row) => !row.originalKey);
    const rows = [
      ...baseRows.map((row) => draftOverrides.get(row.ledgerKey) || row),
      ...draftAdditions,
    ].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

    return rows;
  }, [ledgerData.rows, ledgerDraftRows]);

  function supplierLastActivity(supplierId) {
    const supplier = supplierById(supplierId);
    return supplier?.last_transaction_date || supplier?.last_activity_date || supplier?.last_transaction_at || null;
  }

  function buildTransactionDraft(type, row = {}) {
    const source = row?.source || "frontend";
    const documentType = row?.type === "Credit Note" ? "Supplier Credit Note" : row?.type || type;
    const gross = row?.gross || row?.gross_amount || row?.amount || row?.payment_amount || row?.total || (row?.credit || row?.debit) || "";
    const net = row?.net || row?.net_amount || row?.subtotal || "";
    const vat = row?.vat || row?.vat_amount || row?.tax_amount || "";
    const documentDate = toInputDate(row?.invoice_date || row?.document_date || row?.date) || todayInput();
    const paymentTerms = selectedSupplier?.payment_terms_days || row?.payment_terms || row?.payment_terms_days || "30";
    const sourceLines = row?.line_items || row?.lines || row?.items || row?.invoice_lines || row?.coding_lines;
    const lineItems = Array.isArray(sourceLines) && sourceLines.length
      ? sourceLines.map((line) => normaliseLineItem(line, row?.description || "", formatAmount(net || gross)))
      : [purchaseDocumentLine(row?.description || "", formatAmount(net || gross))];
    const firstLineNominal = lineItems.find((line) => line.purchase_nominal)?.purchase_nominal || "";
    const firstLineVatCode = lineItems.find((line) => line.vat_code)?.vat_code || "";
    return {
      id: row?.id || "",
      ledgerKey: row?.ledgerKey || "",
      originalKey: source === "frontend" ? row?.originalKey || "" : row?.ledgerKey || "",
      supplier_id: row?.supplier_id || selectedSupplier?.id || selectedSupplierId,
      supplier_name: row?.supplier_name || selectedSupplier?.name || "",
      supplier_code: row?.supplier_code || selectedSupplier?.supplier_code || "",
      source,
      type: documentType,
      date: documentDate,
      due_date: toInputDate(row?.due_date) || addDaysInput(documentDate, paymentTerms),
      payment_terms: paymentTerms,
      currency: selectedSupplier?.default_currency || defaultCurrency,
      document_number: row?.document_number || row?.invoice_number || row?.credit_note_number || (row?.reference === "-" ? "" : row?.reference || ""),
      reference: row?.reference === "-" ? "" : row?.reference || "",
      description: row?.description || "",
      purchase_nominal: row?.purchase_nominal || row?.purchase_nominal_code || row?.purchase_account_code || row?.account_code || row?.nominal_account_code || firstLineNominal || row?.default_purchase_account || selectedSupplier?.default_purchase_account || "",
      vat_code: row?.vat_code || row?.tax_code || firstLineVatCode || row?.default_vat_code || selectedSupplier?.default_vat_code || "",
      net: formatAmount(net),
      vat: formatAmount(vat),
      gross: formatAmount(gross),
      debit: row?.debit ? String(row.debit) : "",
      credit: row?.credit ? String(row.credit) : "",
      status: row?.status || "Awaiting approval",
      view_only: row?.view_only,
      attachment_name: row?.attachment_name || row?.attachment_path || row?.attachment_url || row?.document_url || row?.source_document_url || "",
      attachment_path: row?.attachment_path || "",
      attachment_url: row?.attachment_url || "",
      document_url: row?.document_url || "",
      source_document_url: row?.source_document_url || "",
      source_submission_id: row?.source_submission_id || "",
      payment_allocation: row?.payment_allocation || row?.bank_reference || "",
      bank_account_code: row?.bank_account_code || "",
      payment_method: row?.payment_method || "Bank Transfer",
      allocation_target: row?.allocation_target || (documentType === "Payment on Account" ? "on_account" : "oldest"),
      invoice_id: row?.invoice_id || "",
      line_items: lineItems,
      notes: "",
    };
  }

  async function loadTransactionDetail(row, initialDraft) {
    if (!row?.id || row?.source === "frontend") return;
    const endpoints = {
      invoice: `/ap/invoices/${row.id}`,
      credit_note: `/ap/credit-notes/${row.id}`,
      payment: `/ap/payments/${row.id}`,
      expense: `/ap/expenses/${row.id}`,
    };
    const endpoint = endpoints[row.source];
    if (!endpoint) return;
    try {
      const response = await api.get(`/admin/accounting/clients/${clientId}${endpoint}`);
      const detail = normaliseTransactionDetailResponse(response.data);
      const merged = {
        ...initialDraft,
        ...row,
        ...detail,
        source: row.source,
        ledgerKey: initialDraft.ledgerKey,
        originalKey: initialDraft.originalKey,
      };
      setTransactionDraft((current) => (
        current?.ledgerKey === initialDraft.ledgerKey ? buildTransactionDraft(initialDraft.type, merged) : current
      ));
    } catch {
      // Keep the ledger row values visible if the optional detail endpoint is not available.
    }
  }

  function openTransactionForm(type, row) {
    if (row && transactionEntryMode === "inline" && transactionDraft && (
      transactionDraft.ledgerKey === row.ledgerKey ||
      (transactionDraft.id && transactionDraft.id === row.id && transactionDraft.source === row.source)
    )) {
      setTransactionErrors({});
      setTransactionDraft(null);
      setTransactionEntryMode("");
      return;
    }
    setTransactionErrors({});
    const draft = buildTransactionDraft(type, row || {});
    setTransactionEntryMode(row ? "inline" : "modal");
    setTransactionDraft(draft);
    loadTransactionDetail(row || {}, draft);
  }

  async function copyPurchaseInvoiceToNew() {
    if (!transactionDraft || transactionDraft.source !== "invoice" || !transactionDraft.id) return;
    setSaving(true);
    setTransactionErrors({});
    try {
      const { data } = await postJson(`/ap/invoices/${transactionDraft.id}/copy`, {});
      const detail = normaliseTransactionDetailResponse(data);
      const copied = buildTransactionDraft("Purchase Invoice", { ...detail, source: "invoice", type: "Purchase Invoice" });
      setTransactionEntryMode("modal");
      setTransactionDraft(copied);
      toast.success("Copied to a new purchase invoice");
      await reloadWorkspace?.();
      await refreshSupplierLedger();
    } catch (error) {
      setTransactionErrors((current) => ({ ...current, backend: formatApiError(error) }));
      toast.error(formatApiError(error));
    } finally {
      setSaving(false);
    }
  }

  async function approvePurchaseInvoice(invoice) {
    if (!invoice?.id) return;
    setSaving(true);
    setTransactionErrors({});
    try {
      let response;
      try {
        response = await postJson(`/ap/invoices/${invoice.id}/approve`, {});
      } catch (error) {
        const detail = error?.response?.data?.detail;
        if (error?.response?.status !== 409 || detail?.code !== "prior_period_vat_adjustment_confirmation") throw error;
        const confirmed = window.confirm(`${detail.message}\n\nOriginal period: ${detail.original_period?.label || "closed period"}\nReport in: ${detail.reported_period?.label || "current open period"}\nVAT amount: ${formatMoney(detail.vat_amount)}\n\nThe invoice date will be preserved and no duplicate VAT-control journal will be created.`);
        if (!confirmed) return;
        response = await postJson(`/ap/invoices/${invoice.id}/approve`, { confirm_prior_period_vat_adjustment: true });
      }
      const { data } = response;
      const detail = normaliseTransactionDetailResponse(data?.detail || data);
      setTransactionDraft(buildTransactionDraft("Purchase Invoice", { ...detail, source: "invoice", type: "Purchase Invoice" }));
      toast.success("Purchase invoice approved and posted");
      await reloadWorkspace?.();
      await refreshSupplierLedger();
    } catch (error) {
      const message = formatApiError(error);
      setTransactionErrors((current) => ({ ...current, backend: message }));
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function unallocateApRow(row) {
    const allocations = row?.allocation_summary?.allocations || [];
    if (!allocations.length || !window.confirm(`Unallocate ${allocations.length === 1 ? "this allocation" : `all ${allocations.length} allocations`}? The supplier payment will be preserved.`)) return;
    const saved = await run(async () => {
      for (const allocation of allocations) {
        const paymentId = allocation.payment_id || (row.source === "payment" ? row.id : "");
        if (!paymentId) throw new Error("The allocation is missing its supplier payment reference.");
        await postJson(`/ap/payments/${paymentId}/allocations/${allocation.id}/unallocate`, {});
      }
    }, "Invoice allocation removed");
    if (saved) await refreshSupplierLedger();
  }

  async function loadApAllocation(paymentId) {
    setAllocationLoading(true);
    setAllocationError("");
    try {
      const { data } = await api.get(`/admin/accounting/clients/${clientId}/ap/payments/${paymentId}/allocation-options`);
      setAllocationData(data || {});
    } catch (error) {
      setAllocationError(formatApiError(error));
    } finally {
      setAllocationLoading(false);
    }
  }

  function openApAllocation(row) {
    setAllocationRow(row);
    setAllocationData(null);
    loadApAllocation(row.id);
  }

  async function saveApAllocations(allocations) {
    if (!allocationRow?.id) return;
    setAllocationSaving(true);
    setAllocationError("");
    try {
      await postJson(`/ap/payments/${allocationRow.id}/allocations`, { allocations });
      toast.success("Supplier payment allocations saved");
      await Promise.all([loadApAllocation(allocationRow.id), refreshSupplierLedger()]);
    } catch (error) {
      setAllocationError(formatApiError(error));
    } finally {
      setAllocationSaving(false);
    }
  }

  async function unallocateApFromModal(allocation) {
    if (!allocationRow?.id || !window.confirm(`Unallocate ${formatMoney(allocation.amount)} from ${allocation.invoice_number || "this invoice"}?`)) return;
    setAllocationSaving(true);
    setAllocationError("");
    try {
      await postJson(`/ap/payments/${allocationRow.id}/allocations/${allocation.id}/unallocate`, {});
      toast.success("Supplier payment allocation removed");
      await Promise.all([loadApAllocation(allocationRow.id), refreshSupplierLedger()]);
    } catch (error) {
      setAllocationError(formatApiError(error));
    } finally {
      setAllocationSaving(false);
    }
  }

  async function loadAccountAllocationWorkspace() {
    if (!selectedSupplierId) return;
    setAccountAllocationLoading(true);
    setAccountAllocationError("");
    try {
      const { data } = await api.get(`/admin/accounting/clients/${clientId}/ap/suppliers/${selectedSupplierId}/allocation-workspace`);
      setAccountAllocationData(data || { credits: [], debits: [], summary: {} });
    } catch (error) {
      setAccountAllocationError(formatApiError(error));
    } finally {
      setAccountAllocationLoading(false);
    }
  }

  function openAccountAllocation() {
    setAccountAllocationOpen(true);
    setAccountAllocationData({ credits: [], debits: [], summary: {} });
    loadAccountAllocationWorkspace();
  }

  async function saveAccountAllocation(payload) {
    if (!selectedSupplierId) return;
    setAccountAllocationSaving(true);
    setAccountAllocationError("");
    try {
      await postJson(`/ap/suppliers/${selectedSupplierId}/allocate-transactions`, payload);
      toast.success("Supplier transactions allocated");
      setAccountAllocationOpen(false);
      await Promise.all([refreshSupplierLedger(), reloadWorkspace?.()]);
    } catch (error) {
      setAccountAllocationError(formatApiError(error));
    } finally {
      setAccountAllocationSaving(false);
    }
  }

  async function unallocateLedgerAllocation(allocation) {
    if (!allocation?.id || !window.confirm(`Unallocate ${formatMoney(allocation.amount)}? The underlying payment or credit note will remain posted.`)) return;
    setAllocationSaving(true);
    setAllocationError("");
    try {
      if (allocation.allocation_kind === "credit_note") {
        await postJson(`/ap/suppliers/${selectedSupplierId}/credit-allocations/${allocation.id}/unallocate`, {});
      } else {
        if (!allocation.payment_id) throw new Error("The allocation is missing its supplier payment reference.");
        await postJson(`/ap/payments/${allocation.payment_id}/allocations/${allocation.id}/unallocate`, {});
      }
      toast.success("Transaction allocation removed");
      setViewAllocationRow(null);
      await Promise.all([refreshSupplierLedger(), reloadWorkspace?.()]);
    } catch (error) {
      setAllocationError(formatApiError(error));
    } finally {
      setAllocationSaving(false);
    }
  }

  function validateTransaction() {
    const errors = {};
    if (!transactionDraft?.type) errors.type = "Transaction type is required";
    if (!transactionDraft?.supplier_id) errors.supplier = "Supplier is required";
    if (!transactionDraft?.date) errors.date = "Date is required";
    if (!isPaymentDocument(transactionDraft?.type) && !transactionDraft?.document_number?.trim()) errors.document_number = `${documentNumberLabel(transactionDraft?.type)} is required`;
    if (!transactionDraft?.description?.trim()) errors.description = "Description is required";
    if (!isPaymentDocument(transactionDraft?.type) && !transactionDraft?.purchase_nominal?.trim()) errors.purchase_nominal = "Purchase nominal is required";
    if (!isPaymentDocument(transactionDraft?.type) && asNumber(transactionDraft?.gross) <= 0) errors.amount = "Gross amount is required";
    if (isPaymentDocument(transactionDraft?.type) && asNumber(transactionDraft?.gross) === 0) errors.amount = "Payment amount must not be zero";
    if (isPaymentDocument(transactionDraft?.type) && !transactionDraft?.bank_account_code) errors.bank_account = "Bank account is required";
    if (!isPaymentDocument(transactionDraft?.type) && transactionDraft?.line_items?.some((line) => !String(line.description || "").trim())) errors.line_items = "Every line needs a description";
    if (!transactionDraft?.status) errors.status = "Status is required";
    setTransactionErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function transactionPayload(nextStatus = "Draft") {
    const supplierId = transactionDraft.supplier_id || selectedSupplier?.id || selectedSupplierId;
    const isRefundPayment = isPaymentDocument(transactionDraft.type) && asNumber(transactionDraft.gross) < 0;
    return {
      supplier_id: supplierId,
      supplier_name: selectedSupplier?.name || transactionDraft.supplier_name || "",
      supplier_code: selectedSupplier?.supplier_code || transactionDraft.supplier_code || "",
      invoice_number: transactionDraft.document_number?.trim() || "",
      document_number: transactionDraft.document_number?.trim() || "",
      reference: (transactionDraft.reference || transactionDraft.document_number || "").trim(),
      invoice_date: transactionDraft.date,
      date: transactionDraft.date,
      due_date: transactionDraft.due_date,
      payment_terms: transactionDraft.payment_terms,
      payment_terms_days: transactionDraft.payment_terms,
      currency: transactionDraft.currency || "GBP",
      description: transactionDraft.description?.trim() || "",
      purchase_nominal: transactionDraft.purchase_nominal,
      vat_code: transactionDraft.vat_code,
      net_amount: asNumber(transactionDraft.net),
      vat_amount: asNumber(transactionDraft.vat),
      gross_amount: asNumber(transactionDraft.gross),
      amount: asNumber(transactionDraft.gross),
      amount_paid: asNumber(transactionDraft.gross),
      payment_date: transactionDraft.date,
      bank_account_code: transactionDraft.bank_account_code,
      payment_method: transactionDraft.payment_method || "Bank Transfer",
      allocation_target: isRefundPayment ? "on_account" : (transactionDraft.allocation_target || (transactionDraft.type === "Payment on Account" ? "on_account" : "oldest")),
      allocations: !isRefundPayment && transactionDraft.allocation_target === "selected" && transactionDraft.invoice_id
        ? [{ invoice_id: transactionDraft.invoice_id, amount: asNumber(transactionDraft.gross) }]
        : [],
      credit_note_number: transactionDraft.document_number?.trim() || "",
      credit_note_date: transactionDraft.date,
      status: nextStatus,
      line_items: transactionDraft.line_items,
      lines: transactionDraft.line_items,
      attachment_path: transactionDraft.attachment_path,
      attachment_url: transactionDraft.attachment_url,
      document_url: transactionDraft.document_url,
      source_document_url: transactionDraft.source_document_url,
      source_submission_id: transactionDraft.source_submission_id,
    };
  }

  async function updateExistingApInvoice(nextStatus) {
    setSaving(true);
    try {
      await putJson(`/ap/invoices/${transactionDraft.id}`, transactionPayload(nextStatus));
      toast.success("AP invoice updated");
      await reloadWorkspace();
      await refreshSupplierLedger();
      setTransactionDraft(null);
      setTransactionEntryMode("");
    } catch (error) {
      const status = error?.response?.status;
      if ([404, 405, 501].includes(status)) {
        setTransactionErrors((current) => ({
          ...current,
          backend: "Backend endpoint required: update AP invoice",
        }));
      } else {
        toast.error(formatApiError(error));
      }
    } finally {
      setSaving(false);
    }
  }

  async function saveTransactionDraft(e, nextStatus = "Draft") {
    e.preventDefault();
    if (!validateTransaction()) return;
    if (transactionDraft.source === "invoice" && transactionDraft.id) {
      await updateExistingApInvoice(nextStatus);
      return;
    }
    if (transactionDraft.source === "frontend") {
      const payload = transactionPayload(nextStatus);
      const saved = await run(async () => {
        if (isPaymentDocument(transactionDraft.type)) {
          await postJson("/ap/payments", payload);
          return;
        }
        if (isCreditDocument(transactionDraft.type)) {
          await postJson("/ap/credit-notes", { ...payload, post: nextStatus === "Posted" });
          return;
        }
        await postJson("/ap/invoices", { ...payload, post: nextStatus === "Posted" });
      }, nextStatus === "Posted" ? "Purchase document posted to Accounts Payable" : "Purchase document submitted for approval");
      if (saved) {
        setTransactionDraft(null);
        setTransactionEntryMode("");
      }
      return;
    }
    const supplierId = transactionDraft.supplier_id || selectedSupplier?.id || selectedSupplierId;
    const isExistingFrontendRow = transactionDraft.source === "frontend" && transactionDraft.ledgerKey;
    const ledgerKey = isExistingFrontendRow ? transactionDraft.ledgerKey : `frontend-${Date.now()}`;
    const status = nextStatus;
    const gross = asNumber(transactionDraft.gross);
    const debit = isCreditDocument(transactionDraft.type) || isPaymentDocument(transactionDraft.type) ? gross : 0;
    const credit = !isCreditDocument(transactionDraft.type) && !isPaymentDocument(transactionDraft.type) ? gross : 0;
    const row = {
      ...transactionDraft,
      id: transactionDraft.id || ledgerKey,
      ledgerKey,
      supplier_id: supplierId,
      source: "frontend",
      debit,
      credit,
      status,
      reference: (transactionDraft.reference || transactionDraft.document_number).trim(),
      document_number: transactionDraft.document_number.trim(),
      description: transactionDraft.description.trim(),
      gross,
      total: gross,
      net: asNumber(transactionDraft.net),
      vat: asNumber(transactionDraft.vat),
    };
    setLedgerDraftRows((rows) => {
      const replaceKey = row.originalKey || row.ledgerKey;
      return [
        ...rows.filter((existing) => (existing.originalKey || existing.ledgerKey) !== replaceKey),
        row,
      ];
    });
    toast.success(status === "Posted" ? "Purchase document posted to Accounts Payable in this ledger" : row.originalKey ? "Purchase document saved in this ledger" : "Purchase document submitted for approval");
    setTransactionDraft(null);
    setTransactionEntryMode("");
  }

  function postTransactionDraft(e) {
    const impact = ledgerImpactFor(transactionDraft?.type);
    const summary = [
      "Post this purchase document to Accounts Payable?",
      "",
      `Supplier: ${selectedSupplier?.name || transactionDraft?.supplier_name || "Not set"}`,
      `Type: ${transactionDraft?.type || "Not set"}`,
      `${documentNumberLabel(transactionDraft?.type)}: ${transactionDraft?.document_number || "Not set"}`,
      `Date: ${transactionDraft?.date || "Not set"}`,
      !isCreditDocument(transactionDraft?.type) ? `Due date: ${transactionDraft?.due_date || "Not set"}` : "",
      `Net / VAT / Gross: ${transactionDraft?.net || "0.00"} / ${transactionDraft?.vat || "0.00"} / ${transactionDraft?.gross || "0.00"}`,
      "Destination: Accounts Payable",
      "Ledger impact:",
      impact.debit,
      impact.credit,
    ].filter(Boolean).join("\n");
    if (window.confirm(summary)) saveTransactionDraft(e, "Posted");
  }

  async function saveSupplierDraft() {
    if (!selectedSupplierIsSystem && !supplierDraft.name.trim()) return toast.error("Supplier name is required");
    if (!selectedSupplier?.id) return toast.error("Supplier record is unavailable");
    const payload = selectedSupplierIsSystem ? {
      bank_name: supplierDraft.bank_name,
      bank_sort_code: supplierDraft.bank_sort_code,
      bank_account_number: supplierDraft.bank_account_number,
      payment_reference: supplierDraft.payment_reference,
      notes: supplierDraft.notes,
    } : supplierDraft;
    const saved = await run(
      async () => {
        await putJson(`/ap/suppliers/${selectedSupplier.id}`, payload);
      },
      "Supplier record saved"
    );
    if (!saved) return;
    setSupplierEditMode(false);
  }

  const selectedLedgerRows = useMemo(() => (
    selectedSupplier ? supplierLedgerRows(selectedSupplier.id) : []
  ), [selectedSupplier, supplierLedgerRows]);
  const ledgerRowKey = (row) => row.ledgerKey || `${row.source}-${row.id}`;
  const toggleLedgerSort = (key, direction) => setLedgerSort((current) => (
    direction
      ? { key, direction }
      : current.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: key === "date" ? "desc" : "asc" }
  ));
  const clearLedgerColumnFilters = () => {
    setLedgerSearch("");
    setLedgerTypeFilter("All");
    setLedgerStatusFilter("All");
    setLedgerDateFrom("");
    setLedgerDateTo("");
    setLedgerReferenceFilter("");
    setLedgerDescriptionFilter("");
    setLedgerAttachmentFilter("All");
    setLedgerInvoiceValueMin("");
    setLedgerInvoiceValueMax("");
    setLedgerAllocatedMin("");
    setLedgerAllocatedMax("");
    setLedgerBalanceMin("");
    setLedgerBalanceMax("");
    setLedgerSort({ key: "date", direction: "desc" });
  };
  const visibleLedgerRows = useMemo(() => {
    const refNeedle = ledgerReferenceFilter.trim().toLowerCase();
    const descriptionNeedle = ledgerDescriptionFilter.trim().toLowerCase();
    const attachmentMode = ledgerAttachmentFilter;
    const inRange = (value, min, max) => (
      (!String(min).trim() || value >= asNumber(min)) &&
      (!String(max).trim() || value <= asNumber(max))
    );
    const filtered = selectedLedgerRows.filter((row) => {
      const refOk = !refNeedle || String(row.reference || "").toLowerCase().includes(refNeedle);
      const descriptionOk = !descriptionNeedle || String(row.description || "").toLowerCase().includes(descriptionNeedle);
      const attachmentOk = attachmentMode === "All" || (attachmentMode === "Attached" ? hasAttachment(row) : !hasAttachment(row));
      const invoiceValueOk = inRange(invoiceValue(row), ledgerInvoiceValueMin, ledgerInvoiceValueMax);
      const allocatedOk = inRange(paymentValue(row), ledgerAllocatedMin, ledgerAllocatedMax);
      const balanceOk = inRange(invoiceBalance(row), ledgerBalanceMin, ledgerBalanceMax);
      return refOk && descriptionOk && attachmentOk && invoiceValueOk && allocatedOk && balanceOk;
    });
    const direction = ledgerSort.direction === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const key = ledgerSort.key;
      if (key === "date") return (new Date(a.date || 0) - new Date(b.date || 0)) * direction;
      if (key === "invoice_value") return (invoiceValue(a) - invoiceValue(b)) * direction;
      if (key === "allocated") return (paymentValue(a) - paymentValue(b)) * direction;
      if (key === "balance") return (invoiceBalance(a) - invoiceBalance(b)) * direction;
      if (key === "attachment") return ((hasAttachment(a) ? 1 : 0) - (hasAttachment(b) ? 1 : 0)) * direction;
      return String(a[key] || "").localeCompare(String(b[key] || "")) * direction;
    });
  }, [ledgerAllocatedMax, ledgerAllocatedMin, ledgerAttachmentFilter, ledgerBalanceMax, ledgerBalanceMin, ledgerDescriptionFilter, ledgerInvoiceValueMax, ledgerInvoiceValueMin, ledgerReferenceFilter, ledgerSort, selectedLedgerRows]);
  const ledgerStatuses = useMemo(() => (
    ["All", ...Array.from(new Set(selectedLedgerRows.map((row) => row.status).filter((status) => status && normaliseStatusText(status) !== "draft")))]
  ), [selectedLedgerRows]);
  const ledgerVisibleCount = Number(ledgerData.summary.visible_transaction_count ?? ledgerData.total_rows ?? visibleLedgerRows.length) || 0;
  const pagedLedgerRows = visibleLedgerRows;
  const selectedLedgerRowsForExport = visibleLedgerRows.filter((row) => selectedLedgerKeys.includes(ledgerRowKey(row)));
  const allVisibleLedgerSelected = pagedLedgerRows.length > 0 && pagedLedgerRows.every((row) => selectedLedgerKeys.includes(ledgerRowKey(row)));
  const hasLedgerFilters = Boolean(ledgerSearch || ledgerTypeFilter !== "All" || ledgerStatusFilter !== "All" || ledgerDateFrom || ledgerDateTo || ledgerReferenceFilter || ledgerDescriptionFilter || ledgerAttachmentFilter !== "All" || ledgerInvoiceValueMin || ledgerInvoiceValueMax || ledgerAllocatedMin || ledgerAllocatedMax || ledgerBalanceMin || ledgerBalanceMax);
  const ledgerTableColumnCount = visibleLedgerColumns.length + 1;
  const ledgerTableMinWidth = 48 + visibleLedgerColumns.reduce((total, key) => total + (ledgerColumnWidths[key] || 120), 0);
  const isLedgerColumnVisible = (key) => visibleLedgerColumns.includes(key);
  const ledgerCellStyle = (key) => ({ width: ledgerColumnWidths[key] || 120, minWidth: ledgerColumnWidths[key] || 120 });
  const resizeLedgerColumn = (key, width) => setLedgerColumnWidths((current) => ({ ...current, [key]: width }));

  function exportLedgerRows() {
    const header = "Date,Type,Reference,Description,Invoice value,Payment,Line balance,Status,Allocations,Attachment";
    const rows = selectedLedgerRowsForExport.map((row) => [
      formatDate(row.date),
      row.type,
      row.reference,
      String(row.description || "").replaceAll("\"", "\"\""),
      invoiceValue(row).toFixed(2),
      paymentValue(row).toFixed(2),
      invoiceBalance(row).toFixed(2),
      row.status,
      (row.allocation_summary?.allocations || []).length,
      hasAttachment(row) ? "Yes" : "No",
    ].map((value) => `"${value || ""}"`).join(","));
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${selectedSupplier?.name || "supplier"}-selected-ledger.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const supplierAuditRows = useMemo(() => {
    const realRows = auditTrail
      .filter((row) => {
        if (!selectedSupplier) return false;
        return row.supplier_id === selectedSupplier.id || row.record_id === selectedSupplier.id || String(row.description || "").includes(selectedSupplier.name || "");
      })
      .map((row) => ({
        id: row.id,
        date: row.created_at || row.date,
        user: row.user || row.user_name || "System",
        action: row.action || row.event || "Updated",
        description: row.description || row.new_value || row.module || "Supplier activity",
      }));

    return realRows;
  }, [auditTrail, selectedSupplier]);

  const auditActions = useMemo(() => (
    ["All", ...Array.from(new Set(supplierAuditRows.map((row) => row.action).filter(Boolean)))]
  ), [supplierAuditRows]);
  const visibleAuditRows = useMemo(() => supplierAuditRows.filter((row) => {
    const actionOk = auditActionFilter === "All" || row.action === auditActionFilter;
    const needle = auditSearch.trim().toLowerCase();
    const searchOk = !needle || `${row.date} ${row.user} ${row.action} ${row.description}`.toLowerCase().includes(needle);
    return actionOk && searchOk;
  }), [auditActionFilter, auditSearch, supplierAuditRows]);

  function exportAuditRows() {
    const header = "Date,User,Action,Description";
    const rows = visibleAuditRows.map((row) => [
      formatDateTime(row.date),
      row.user,
      row.action,
      String(row.description || "").replaceAll("\"", "\"\""),
    ].map((value) => `"${value || ""}"`).join(","));
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${selectedSupplier?.name || "supplier"}-audit.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function saveGeneralSettings() {
    await run(async () => {
      await putJson("/ap/settings", settingsForm);
      await reloadWorkspace?.();
    }, "Accounts Payable settings saved");
  }

  useEffect(() => {
    if (!setHeaderContext) return undefined;
    if (!selectedSupplier) {
      setHeaderContext(null);
      return undefined;
    }
    setHeaderContext({
      backLabel: "Back to suppliers",
      onBack: () => setSelectedSupplierId(""),
      title: supplierDraft.name || selectedSupplier.name,
      subtitle: `${supplierDraft.supplier_code || "No supplier code"} - ${supplierDraft.email || "No email"}`,
      titlePrefix: selectedSupplier.system_icon || "",
      badges: selectedSupplierIsSystem ? [
        { label: "SYSTEM SUPPLIER", className: "bg-emerald-100 text-emerald-800" },
        { label: selectedSupplier.system_authority_label || supplierCategoryLabels[selectedSupplier.supplier_category] || "Protected account", className: "bg-stone-100 text-stone-700" },
      ] : [],
      tabs: supplierRecordTabs,
      activeTab: supplierRecordTab,
      onTabChange: setSupplierRecordTab,
    });
    return () => setHeaderContext(null);
    // Header action callbacks intentionally use the current workspace handlers without forcing the header context to churn every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSupplier, selectedSupplierIsSystem, supplierDraft.name, supplierDraft.supplier_code, supplierDraft.email, supplierRecordTab, setHeaderContext]);

  if (activeTab === "General Settings") {
    return (
      <Panel title="Accounts Payable General Settings">
        <div className="grid gap-4 md:grid-cols-2">
          <EditableField label="Approval required" checkbox value={settingsForm.approval_required} editable onChange={(value) => setSettingsForm((row) => ({ ...row, approval_required: value }))} />
          <EditableField label="Supplier numbering" value={settingsForm.supplier_numbering || "automatic"} editable options={supplierNumberingOptions} onChange={(value) => setSettingsForm((row) => ({ ...row, supplier_numbering: value }))} />
          <EditableField label="Default payment terms (days)" type="number" value={settingsForm.default_payment_terms_days || 30} editable onChange={(value) => setSettingsForm((row) => ({ ...row, default_payment_terms_days: value }))} />
          <EditableField label="Default purchase nominal" value={settingsForm.default_purchase_account || "5000"} editable options={expenseAccounts.map((account) => ({ value: account.code, label: `${account.code} - ${account.name}` }))} onChange={(value) => setSettingsForm((row) => ({ ...row, default_purchase_account: value }))} />
          <EditableField label="Default VAT code" value={settingsForm.default_vat_code || ""} editable options={vatCodes} onChange={(value) => setSettingsForm((row) => ({ ...row, default_vat_code: value }))} />
          <EditableField label="Payment on account behaviour" value={settingsForm.payment_on_account_behaviour || "hold"} editable options={paymentOnAccountBehaviourOptions} onChange={(value) => setSettingsForm((row) => ({ ...row, payment_on_account_behaviour: value }))} />
          <EditableField label="Supplier expense behaviour" value={settingsForm.expense_behaviour || "allow"} editable options={expenseBehaviourOptions} onChange={(value) => setSettingsForm((row) => ({ ...row, expense_behaviour: value }))} />
        </div>
        <div className="mt-5 flex justify-end"><Button type="button" disabled={saving} onClick={saveGeneralSettings}><Save className="mr-2 h-4 w-4" />Save settings</Button></div>
      </Panel>
    );
  }

  if (activeTab === "Suppliers" || activeTab === "Create supplier") {
    if (selectedSupplier) {
      return (
        <div className="space-y-3">
          {selectedSupplierIsSystem ? (
            <div className="overflow-hidden rounded-lg border border-emerald-300 bg-white shadow-sm">
              <div className="h-1.5 bg-emerald-600" />
              <div className="grid gap-4 p-4 lg:grid-cols-[1fr_auto] lg:items-start">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-2xl" aria-hidden="true">{selectedSupplier.system_icon || "🛡️"}</span>
                    <h3 className="font-display text-lg font-bold text-emerald-950">This is a protected system supplier</h3>
                    <Badge className="bg-emerald-100 text-emerald-800">SYSTEM SUPPLIER</Badge>
                  </div>
                  <p className="mt-2 text-sm text-stone-700">
                    This statutory account can receive automatically generated supplier invoices and supplier payments.
                  </p>
                  <div className="mt-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-stone-500">Used by</p>
                    <ul className="mt-1 grid gap-1 text-sm text-stone-700 sm:grid-cols-2">
                      {(selectedSupplier.system_usage || []).map((item) => <li key={item}>• {item}</li>)}
                    </ul>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
                    This supplier cannot be deleted, made inactive, renamed, or recategorised.
                  </div>
                  {selectedSupplier.supplier_category === "Pension" ? (
                    <Button type="button" variant="outline" className="w-full border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100" onClick={createPensionProviderFromTemplate}>
                      <Plus className="mr-2 h-4 w-4" /> Create pension provider from template
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
          {supplierRecordTab === "General" ? (
            <Panel title="Supplier general details">
              <div className="-mx-3 -mt-3 mb-4 h-1 bg-emerald-600" />
              <div className="mb-4 flex justify-end gap-2">
                {supplierEditMode ? (
                  <>
                    <Button type="button" variant="outline" onClick={() => { setSupplierDraft(normaliseSupplierDraft(selectedSupplier)); setSupplierEditMode(false); }}>
                      <X className="mr-2 h-4 w-4" /> Cancel
                    </Button>
                    <Button type="button" onClick={saveSupplierDraft} disabled={saving || busy}>
                      <Save className="mr-2 h-4 w-4" /> Save
                    </Button>
                  </>
                ) : (
                  <Button type="button" onClick={() => setSupplierEditMode(true)}>
                    <Edit3 className="mr-2 h-4 w-4" /> Edit
                  </Button>
                )}
              </div>
              <div className="grid gap-5 xl:grid-cols-2">
                <Section title="General">
                  <div className="grid gap-3 md:grid-cols-2">
                    <EditableField label="Supplier name" value={supplierDraft.name} editable={supplierEditMode && !selectedSupplierIsSystem} onChange={(value) => setSupplierDraft((draft) => ({ ...draft, name: value }))} />
                    <EditableField label="Supplier code" value={supplierDraft.supplier_code} editable={supplierEditMode && !selectedSupplierIsSystem} onChange={(value) => setSupplierDraft((draft) => ({ ...draft, supplier_code: value }))} />
                    <EditableField label="Category" value={supplierEditMode && !selectedSupplierIsSystem ? supplierDraft.supplier_category : (supplierCategoryLabels[supplierDraft.supplier_category] || supplierDraft.supplier_category)} editable={supplierEditMode && !selectedSupplierIsSystem} options={[{ value: "Trade", label: "Trade supplier" }, { value: "Pension", label: "Pension provider" }]} onChange={(value) => setSupplierDraft((draft) => ({ ...draft, supplier_category: value }))} />
                    <EditableField label="Trading name" value={supplierDraft.trading_name} editable={supplierEditMode && !selectedSupplierIsSystem} onChange={(value) => setSupplierDraft((draft) => ({ ...draft, trading_name: value }))} />
                    <EditableField label="Status" value={supplierDraft.status} editable={supplierEditMode && !selectedSupplierIsSystem} options={["Active", "On hold", "Inactive"]} onChange={(value) => setSupplierDraft((draft) => ({ ...draft, status: value }))} />
                    <EditableField label="Email" type="email" value={supplierDraft.email} editable={supplierEditMode && !selectedSupplierIsSystem} onChange={(value) => setSupplierDraft((draft) => ({ ...draft, email: value }))} />
                    <EditableField label="Phone" value={supplierDraft.phone} editable={supplierEditMode && !selectedSupplierIsSystem} onChange={(value) => setSupplierDraft((draft) => ({ ...draft, phone: value }))} />
                    <EditableField label="Website" value={supplierDraft.website} editable={supplierEditMode && !selectedSupplierIsSystem} onChange={(value) => setSupplierDraft((draft) => ({ ...draft, website: value }))} />
                    <EditableField label="Currency" value={supplierDraft.default_currency} editable={supplierEditMode && !selectedSupplierIsSystem} options={["GBP", "EUR", "USD"]} onChange={(value) => setSupplierDraft((draft) => ({ ...draft, default_currency: value }))} />
                  </div>
                </Section>
                <Section title="Addresses">
                  <div className="grid gap-3 md:grid-cols-2">
                    <EditableField label="Registered address" value={supplierDraft.registered_address} editable={supplierEditMode && !selectedSupplierIsSystem} textarea onChange={(value) => setSupplierDraft((draft) => ({ ...draft, registered_address: value }))} />
                    <EditableField label="Trading address" value={supplierDraft.trading_address} editable={supplierEditMode && !selectedSupplierIsSystem} textarea onChange={(value) => setSupplierDraft((draft) => ({ ...draft, trading_address: value }))} />
                    <EditableField label="Billing address" value={supplierDraft.billing_address} editable={supplierEditMode && !selectedSupplierIsSystem} textarea onChange={(value) => setSupplierDraft((draft) => ({ ...draft, billing_address: value }))} />
                  </div>
                </Section>
                <Section title="Contacts">
                  <div className="grid gap-3 md:grid-cols-2">
                    <EditableField label="Contact name" value={supplierDraft.contact_name} editable={supplierEditMode && !selectedSupplierIsSystem} onChange={(value) => setSupplierDraft((draft) => ({ ...draft, contact_name: value }))} />
                    <EditableField label="Position" value={supplierDraft.contact_position} editable={supplierEditMode && !selectedSupplierIsSystem} onChange={(value) => setSupplierDraft((draft) => ({ ...draft, contact_position: value }))} />
                    <EditableField label="Contact email" type="email" value={supplierDraft.contact_email} editable={supplierEditMode && !selectedSupplierIsSystem} onChange={(value) => setSupplierDraft((draft) => ({ ...draft, contact_email: value }))} />
                    <EditableField label="Contact phone" value={supplierDraft.contact_phone} editable={supplierEditMode && !selectedSupplierIsSystem} onChange={(value) => setSupplierDraft((draft) => ({ ...draft, contact_phone: value }))} />
                  </div>
                </Section>
                <Section title="Bank details">
                  <div className="grid gap-3 md:grid-cols-2">
                    <EditableField label="Bank name" value={supplierDraft.bank_name} editable={supplierEditMode} onChange={(value) => setSupplierDraft((draft) => ({ ...draft, bank_name: value }))} />
                    <EditableField label="Sort code" value={supplierDraft.bank_sort_code} editable={supplierEditMode} onChange={(value) => setSupplierDraft((draft) => ({ ...draft, bank_sort_code: value }))} />
                    <EditableField label="Account number" value={supplierDraft.bank_account_number} editable={supplierEditMode} onChange={(value) => setSupplierDraft((draft) => ({ ...draft, bank_account_number: value }))} />
                    <EditableField label="Payment reference" value={supplierDraft.payment_reference} editable={supplierEditMode} onChange={(value) => setSupplierDraft((draft) => ({ ...draft, payment_reference: value }))} />
                  </div>
                </Section>
                <Section title="Payment terms">
                  <div className="grid gap-3 md:grid-cols-2">
                    <EditableField label="Payment terms days" type="number" value={supplierDraft.payment_terms_days} editable={supplierEditMode && !selectedSupplierIsSystem} onChange={(value) => setSupplierDraft((draft) => ({ ...draft, payment_terms_days: value }))} />
                    <EditableField label="Default purchase nominal" value={supplierDraft.default_purchase_account} editable={supplierEditMode && !selectedSupplierIsSystem} options={expenseAccounts.map((account) => ({ value: account.code, label: `${account.code} - ${account.name}` }))} onChange={(value) => setSupplierDraft((draft) => ({ ...draft, default_purchase_account: value }))} />
                  </div>
                </Section>
                <Section title="Tax">
                  <div className="grid gap-3 md:grid-cols-2">
                    <EditableField label="VAT number" value={supplierDraft.vat_number} editable={supplierEditMode && !selectedSupplierIsSystem} onChange={(value) => setSupplierDraft((draft) => ({ ...draft, vat_number: value }))} />
                    <EditableField label="Company number" value={supplierDraft.company_number} editable={supplierEditMode && !selectedSupplierIsSystem} onChange={(value) => setSupplierDraft((draft) => ({ ...draft, company_number: value }))} />
                    <EditableField label="Default VAT code" value={supplierDraft.default_vat_code} editable={supplierEditMode && !selectedSupplierIsSystem} onChange={(value) => setSupplierDraft((draft) => ({ ...draft, default_vat_code: value }))} />
                    <EditableField label="CIS registered" checkbox value={supplierDraft.cis_registered} editable={supplierEditMode && !selectedSupplierIsSystem} onChange={(value) => setSupplierDraft((draft) => ({ ...draft, cis_registered: value }))} />
                    <EditableField label="Reverse charge" checkbox value={supplierDraft.reverse_charge} editable={supplierEditMode && !selectedSupplierIsSystem} onChange={(value) => setSupplierDraft((draft) => ({ ...draft, reverse_charge: value }))} />
                  </div>
                </Section>
                <Section title="Notes">
                  <EditableField label="Supplier notes" value={supplierDraft.notes} editable={supplierEditMode} textarea onChange={(value) => setSupplierDraft((draft) => ({ ...draft, notes: value }))} />
                </Section>
              </div>
            </Panel>
          ) : null}

          {supplierRecordTab === "Ledger" ? (
            <Panel
              title="Supplier ledger"
              action={(
                <ActionDropdown
                  actions={[
                    { label: "Add purchase invoice", onClick: () => openTransactionForm("Purchase Invoice") },
                    { label: "Add supplier credit note", onClick: () => openTransactionForm("Supplier Credit Note") },
                    { label: "Add payment", onClick: () => openTransactionForm("Payment on Account") },
                    { label: "Allocate transactions", onClick: openAccountAllocation },
                    { label: "Select Columns", onClick: () => setColumnSelectorOpen((open) => !open) },
                  ]}
                />
              )}
            >
              {columnSelectorOpen ? (
                <ColumnSelectorPanel
                  columns={ledgerColumnDefinitions}
                  visibleColumns={visibleLedgerColumns}
                  setVisibleColumns={setVisibleLedgerColumns}
                  onClose={() => setColumnSelectorOpen(false)}
                />
              ) : null}
              {ledgerError ? <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{ledgerError}</div> : null}
              {ledgerLoading ? <div className="mb-3 rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-600">Loading supplier ledger...</div> : null}
              {(selectedLedgerRowsForExport.length || hasLedgerFilters) ? (
                <div className="mb-2 flex flex-wrap justify-end gap-2">
                  {hasLedgerFilters ? <Button type="button" variant="outline" size="sm" onClick={clearLedgerColumnFilters}>Clear filters</Button> : null}
                  {selectedLedgerRowsForExport.length ? (
                    <Button type="button" variant="outline" size="sm" onClick={exportLedgerRows}>
                      <Download className="mr-2 h-4 w-4" /> Export selected ({selectedLedgerRowsForExport.length})
                    </Button>
                  ) : null}
                </div>
              ) : null}
              <div className="overflow-auto rounded-md border border-stone-200">
                <table className="w-full text-sm" style={{ minWidth: ledgerTableMinWidth }}>
                  <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                    <tr>
                      <th className="w-9 px-2 py-1.5">
                        <input
                          type="checkbox"
                          checked={allVisibleLedgerSelected}
                          onChange={(event) => {
                            const pageKeys = pagedLedgerRows.map(ledgerRowKey);
                            setSelectedLedgerKeys((current) => event.target.checked
                              ? Array.from(new Set([...current, ...pageKeys]))
                              : current.filter((key) => !pageKeys.includes(key)));
                          }}
                          aria-label="Select visible ledger rows"
                        />
                      </th>
                      {isLedgerColumnVisible("date") ? <LedgerColumnHeader label="Date" sortKey="date" sort={ledgerSort} onSort={toggleLedgerSort} openKey={openLedgerFilter} setOpenKey={setOpenLedgerFilter} activeFilter={Boolean(ledgerDateFrom || ledgerDateTo)} width={ledgerColumnWidths.date} onResize={(width) => resizeLedgerColumn("date", width)}>
                        <div className="grid gap-2">
                          <SortControls sortKey="date" onSort={toggleLedgerSort} />
                          <Label className="text-[10px] uppercase text-stone-500">From</Label>
                          <Input type="date" value={ledgerDateFrom} onChange={(e) => setLedgerDateFrom(e.target.value)} className="h-8 text-xs" />
                          <Label className="text-[10px] uppercase text-stone-500">To</Label>
                          <Input type="date" value={ledgerDateTo} onChange={(e) => setLedgerDateTo(e.target.value)} className="h-8 text-xs" />
                          <ClearFilterButton onClick={() => { setLedgerDateFrom(""); setLedgerDateTo(""); }}>Clear date filter</ClearFilterButton>
                        </div>
                      </LedgerColumnHeader> : null}
                      {isLedgerColumnVisible("type") ? <LedgerColumnHeader label="Type" sortKey="type" sort={ledgerSort} onSort={toggleLedgerSort} openKey={openLedgerFilter} setOpenKey={setOpenLedgerFilter} activeFilter={ledgerTypeFilter !== "All"} width={ledgerColumnWidths.type} onResize={(width) => resizeLedgerColumn("type", width)}>
                        <SortControls sortKey="type" onSort={toggleLedgerSort} />
                        <select value={ledgerTypeFilter} onChange={(e) => setLedgerTypeFilter(e.target.value)} className="mt-2 h-8 w-full rounded-md border border-stone-200 bg-white px-2 text-xs normal-case">
                          <option value="All">All types</option>
                          {transactionTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                          <option value="Supplier Payment">Supplier Payment</option>
                        </select>
                        <ClearFilterButton onClick={() => setLedgerTypeFilter("All")} />
                      </LedgerColumnHeader> : null}
                      {isLedgerColumnVisible("reference") ? <LedgerColumnHeader label="Reference" sortKey="reference" sort={ledgerSort} onSort={toggleLedgerSort} openKey={openLedgerFilter} setOpenKey={setOpenLedgerFilter} activeFilter={Boolean(ledgerReferenceFilter)} width={ledgerColumnWidths.reference} onResize={(width) => resizeLedgerColumn("reference", width)}>
                        <SortControls sortKey="reference" onSort={toggleLedgerSort} />
                        <Input value={ledgerReferenceFilter} onChange={(e) => setLedgerReferenceFilter(e.target.value)} placeholder="Filter reference" className="mt-2 h-8 text-xs normal-case" />
                        <ClearFilterButton onClick={() => setLedgerReferenceFilter("")} />
                      </LedgerColumnHeader> : null}
                      {isLedgerColumnVisible("description") ? <LedgerColumnHeader label="Description" sortKey="description" sort={ledgerSort} onSort={toggleLedgerSort} openKey={openLedgerFilter} setOpenKey={setOpenLedgerFilter} activeFilter={Boolean(ledgerDescriptionFilter)} width={ledgerColumnWidths.description} onResize={(width) => resizeLedgerColumn("description", width)}>
                        <SortControls sortKey="description" onSort={toggleLedgerSort} />
                        <Input value={ledgerDescriptionFilter} onChange={(e) => setLedgerDescriptionFilter(e.target.value)} placeholder="Filter description" className="mt-2 h-8 text-xs normal-case" />
                        <ClearFilterButton onClick={() => setLedgerDescriptionFilter("")} />
                      </LedgerColumnHeader> : null}
                      {isLedgerColumnVisible("invoice_value") ? <LedgerColumnHeader label="Invoice value" sortKey="invoice_value" sort={ledgerSort} onSort={toggleLedgerSort} openKey={openLedgerFilter} setOpenKey={setOpenLedgerFilter} align="right" activeFilter={Boolean(ledgerInvoiceValueMin || ledgerInvoiceValueMax)} width={ledgerColumnWidths.invoice_value} onResize={(width) => resizeLedgerColumn("invoice_value", width)}>
                        <SortControls sortKey="invoice_value" onSort={toggleLedgerSort} />
                        <div className="mt-2 grid grid-cols-2 gap-1">
                          <Input type="number" step="0.01" value={ledgerInvoiceValueMin} onChange={(e) => setLedgerInvoiceValueMin(e.target.value)} placeholder="Min" className="h-8 text-xs" />
                          <Input type="number" step="0.01" value={ledgerInvoiceValueMax} onChange={(e) => setLedgerInvoiceValueMax(e.target.value)} placeholder="Max" className="h-8 text-xs" />
                        </div>
                        <ClearFilterButton onClick={() => { setLedgerInvoiceValueMin(""); setLedgerInvoiceValueMax(""); }} />
                      </LedgerColumnHeader> : null}
                      {isLedgerColumnVisible("allocated") ? <LedgerColumnHeader label="Payment" sortKey="allocated" sort={ledgerSort} onSort={toggleLedgerSort} openKey={openLedgerFilter} setOpenKey={setOpenLedgerFilter} align="right" activeFilter={Boolean(ledgerAllocatedMin || ledgerAllocatedMax)} width={ledgerColumnWidths.allocated} onResize={(width) => resizeLedgerColumn("allocated", width)}>
                        <SortControls sortKey="allocated" onSort={toggleLedgerSort} />
                        <div className="mt-2 grid grid-cols-2 gap-1">
                          <Input type="number" step="0.01" value={ledgerAllocatedMin} onChange={(e) => setLedgerAllocatedMin(e.target.value)} placeholder="Min" className="h-8 text-xs" />
                          <Input type="number" step="0.01" value={ledgerAllocatedMax} onChange={(e) => setLedgerAllocatedMax(e.target.value)} placeholder="Max" className="h-8 text-xs" />
                        </div>
                        <ClearFilterButton onClick={() => { setLedgerAllocatedMin(""); setLedgerAllocatedMax(""); }} />
                      </LedgerColumnHeader> : null}
                      {isLedgerColumnVisible("balance") ? <LedgerColumnHeader label="Line balance" sortKey="balance" sort={ledgerSort} onSort={toggleLedgerSort} openKey={openLedgerFilter} setOpenKey={setOpenLedgerFilter} align="right" activeFilter={Boolean(ledgerBalanceMin || ledgerBalanceMax)} width={ledgerColumnWidths.balance} onResize={(width) => resizeLedgerColumn("balance", width)}>
                        <SortControls sortKey="balance" onSort={toggleLedgerSort} />
                        <div className="mt-2 grid grid-cols-2 gap-1">
                          <Input type="number" step="0.01" value={ledgerBalanceMin} onChange={(e) => setLedgerBalanceMin(e.target.value)} placeholder="Min" className="h-8 text-xs" />
                          <Input type="number" step="0.01" value={ledgerBalanceMax} onChange={(e) => setLedgerBalanceMax(e.target.value)} placeholder="Max" className="h-8 text-xs" />
                        </div>
                        <ClearFilterButton onClick={() => { setLedgerBalanceMin(""); setLedgerBalanceMax(""); }} />
                      </LedgerColumnHeader> : null}
                      {isLedgerColumnVisible("status") ? <LedgerColumnHeader label="Status" sortKey="status" sort={ledgerSort} onSort={toggleLedgerSort} openKey={openLedgerFilter} setOpenKey={setOpenLedgerFilter} activeFilter={ledgerStatusFilter !== "All"} width={ledgerColumnWidths.status} onResize={(width) => resizeLedgerColumn("status", width)}>
                        <SortControls sortKey="status" onSort={toggleLedgerSort} />
                        <select value={ledgerStatusFilter} onChange={(e) => setLedgerStatusFilter(e.target.value)} className="mt-2 h-8 w-full rounded-md border border-stone-200 bg-white px-2 text-xs normal-case">
                          {ledgerStatuses.map((status) => <option key={status} value={status}>{status === "All" ? "All statuses" : status}</option>)}
                        </select>
                        <ClearFilterButton onClick={() => setLedgerStatusFilter("All")} />
                      </LedgerColumnHeader> : null}
                      {isLedgerColumnVisible("allocations") ? <th className="px-2 py-1.5 text-left" style={ledgerCellStyle("allocations")}>Allocations</th> : null}
                      {isLedgerColumnVisible("attachment") ? <LedgerColumnHeader label="Attachment" sortKey="attachment" sort={ledgerSort} onSort={toggleLedgerSort} openKey={openLedgerFilter} setOpenKey={setOpenLedgerFilter} align="right" activeFilter={ledgerAttachmentFilter !== "All"} width={ledgerColumnWidths.attachment} onResize={(width) => resizeLedgerColumn("attachment", width)}>
                        <SortControls sortKey="attachment" onSort={toggleLedgerSort} />
                        <select value={ledgerAttachmentFilter} onChange={(e) => setLedgerAttachmentFilter(e.target.value)} className="mt-2 h-8 w-full rounded-md border border-stone-200 bg-white px-2 text-xs normal-case">
                          <option value="All">All</option>
                          <option value="Attached">Attached</option>
                          <option value="Missing">Missing</option>
                        </select>
                        <ClearFilterButton onClick={() => setLedgerAttachmentFilter("All")} />
                      </LedgerColumnHeader> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleLedgerRows.length ? pagedLedgerRows.map((row) => {
                      const selected = transactionEntryMode === "inline" && transactionDraft && (transactionDraft.ledgerKey === row.ledgerKey || (transactionDraft.id && transactionDraft.id === row.id && transactionDraft.source === row.source));
                      return (
                        <React.Fragment key={row.ledgerKey || `${row.source}-${row.id}`}>
                          <tr className={`cursor-pointer border-t border-stone-100 hover:bg-emerald-50/50 ${selected ? "bg-emerald-50 ring-1 ring-inset ring-emerald-200" : ""}`} onClick={() => openTransactionForm(row.type, row)}>
                            <td className="px-2 py-1.5" onClick={(event) => event.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={selectedLedgerKeys.includes(ledgerRowKey(row))}
                                onChange={(event) => {
                                  const key = ledgerRowKey(row);
                                  setSelectedLedgerKeys((current) => event.target.checked ? [...current, key] : current.filter((item) => item !== key));
                                }}
                                aria-label={`Select ${row.reference || row.type}`}
                              />
                            </td>
                            {isLedgerColumnVisible("date") ? <td className="px-2 py-1.5" style={ledgerCellStyle("date")}>{formatDate(row.date)}</td> : null}
                            {isLedgerColumnVisible("type") ? <td className="px-2 py-1.5 font-medium" style={ledgerCellStyle("type")}>
                              <div className="flex flex-wrap items-center gap-2">
                                {row.type}
                                {row.source === "frontend" ? <Badge className="bg-amber-100 text-amber-800">Staged</Badge> : null}
                              </div>
                            </td> : null}
                            {isLedgerColumnVisible("reference") ? <td className="px-2 py-1.5" style={ledgerCellStyle("reference")}>{row.reference}</td> : null}
                            {isLedgerColumnVisible("description") ? <td className="px-2 py-1.5 text-stone-600" style={ledgerCellStyle("description")}>{row.description}</td> : null}
                            {isLedgerColumnVisible("invoice_value") ? <td className="px-2 py-1.5 text-right" style={ledgerCellStyle("invoice_value")}>{invoiceValue(row) ? formatMoney(invoiceValue(row)) : "-"}</td> : null}
                            {isLedgerColumnVisible("allocated") ? <td className="px-2 py-1.5 text-right" style={ledgerCellStyle("allocated")}>{paymentValue(row) ? formatMoney(paymentValue(row)) : "-"}</td> : null}
                            {isLedgerColumnVisible("balance") ? <td className="px-2 py-1.5 text-right font-semibold" style={ledgerCellStyle("balance")}>{invoiceBalance(row) ? formatMoney(invoiceBalance(row)) : "-"}</td> : null}
                            {isLedgerColumnVisible("status") ? <td className="px-2 py-1.5" style={ledgerCellStyle("status")}>
                              <Badge className={row.is_over_allocated ? "bg-red-100 text-red-800" : statusBadgeClass(row.status)}>{row.display_status || displayStatus(row.status)}</Badge>
                              {row.is_over_allocated ? <div className="mt-1 text-xs font-medium text-red-700">Allocation exceeds invoice value</div> : null}
                            </td> : null}
                            {isLedgerColumnVisible("allocations") ? <td className="px-2 py-1.5" style={ledgerCellStyle("allocations")}>{(row.allocation_summary?.allocations || []).length ? <Button type="button" variant="outline" size="sm" onClick={(event) => { event.stopPropagation(); setAllocationError(""); setViewAllocationRow(row); }}>View Allocation</Button> : "-"}</td> : null}
                            {isLedgerColumnVisible("attachment") ? <td className="px-2 py-1.5" style={ledgerCellStyle("attachment")}>{hasAttachment(row) ? <Badge className="bg-emerald-100 text-emerald-800">Attached</Badge> : "-"}</td> : null}
                          </tr>
                          {selected ? (
                            <tr className="border-t border-emerald-200 bg-emerald-50/40">
                              <td colSpan={ledgerTableColumnCount} className="p-0">
                                <ManualPurchaseDocumentDrawer
                                  draft={transactionDraft}
                                  setDraft={setTransactionDraft}
                                  errors={transactionErrors}
                                  supplier={selectedSupplier}
                                  expenseAccounts={expenseAccounts}
                                  bankAccounts={bankAccounts}
                                  vatCodes={vatCodes}
                                  saving={saving}
                                  onClose={() => {
                                    setTransactionDraft(null);
                                    setTransactionEntryMode("");
                                  }}
                                  onSave={saveTransactionDraft}
                                  onPost={postTransactionDraft}
                                  onApproveInvoice={approvePurchaseInvoice}
                                  onCopyInvoice={copyPurchaseInvoiceToNew}
                                  approvalRequired={Boolean(settingsForm.approval_required)}
                                  openInvoices={supplierLedgerRows(selectedSupplierId).filter((item) => item.source === "invoice" && asNumber(item.invoice_balance) > 0)}
                                />
                              </td>
                            </tr>
                          ) : null}
                        </React.Fragment>
                      );
                    }) : (
                      <tr>
                        <td colSpan={ledgerTableColumnCount} className="px-3 py-8 text-center text-stone-500">No ledger transactions found.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
                {ledgerVisibleCount ? (
                  <PaginationFooter
                    page={ledgerPage}
                    pageSize={ledgerPageSize}
                    totalRows={ledgerVisibleCount}
                    totalPages={ledgerData.total_pages}
                    disabled={ledgerLoading}
                    onPageChange={setLedgerPage}
                    onPageSizeChange={(size) => {
                      setLedgerPageSize(normalisePageSize(size));
                      setLedgerPage(1);
                    }}
                  />
                ) : null}
              </div>
            </Panel>
          ) : null}

          {supplierRecordTab === "Audit Trail" ? (
            <Panel title="Supplier audit trail">
              <div className="mb-3 flex flex-wrap gap-2">
                <div className="relative min-w-72 flex-1">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-stone-400" />
                  <Input value={auditSearch} onChange={(e) => setAuditSearch(e.target.value)} placeholder="Search audit trail" className="h-9 pl-9" />
                </div>
                <select value={auditActionFilter} onChange={(e) => setAuditActionFilter(e.target.value)} className="h-9 rounded-md border border-stone-200 bg-white px-3 text-sm">
                  {auditActions.map((action) => <option key={action} value={action}>{action}</option>)}
                </select>
                <Button type="button" variant="outline" onClick={exportAuditRows}>
                  <Download className="mr-2 h-4 w-4" /> Export
                </Button>
              </div>
              {auditError ? <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{auditError}</div> : null}
              {auditLoading && !visibleAuditRows.length ? <div className="py-8 text-center text-sm text-stone-500">Loading supplier audit trail...</div> : null}
              <div className="overflow-hidden rounded-md border border-stone-200">
                <table className="w-full text-sm">
                  <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                    <tr>
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">User</th>
                      <th className="px-3 py-2">Action</th>
                      <th className="px-3 py-2">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleAuditRows.length ? visibleAuditRows.map((row) => (
                      <tr key={row.id} className="border-t border-stone-100">
                        <td className="px-3 py-2">{formatDateTime(row.date)}</td>
                        <td className="px-3 py-2">{row.user}</td>
                        <td className="px-3 py-2 font-medium">{row.action}</td>
                        <td className="px-3 py-2 text-stone-600">{row.description}</td>
                      </tr>
                    )) : (
                      <tr>
                        <td colSpan="4" className="px-3 py-8 text-center text-stone-500">No audit records found.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
                <PaginationFooter page={auditData.page} pageSize={auditData.page_size} totalRows={auditData.total_rows} totalPages={auditData.total_pages} onPageChange={setAuditPage} onPageSizeChange={setAuditPageSize} disabled={auditLoading} />
              </div>
            </Panel>
          ) : null}

          {transactionEntryMode === "modal" && transactionDraft ? (
            <TransactionEntryModal onClose={() => {
              setTransactionDraft(null);
              setTransactionEntryMode("");
            }}>
              <ManualPurchaseDocumentDrawer
                draft={transactionDraft}
                setDraft={setTransactionDraft}
                errors={transactionErrors}
                supplier={selectedSupplier}
                expenseAccounts={expenseAccounts}
                bankAccounts={bankAccounts}
                vatCodes={transactionVatCodes}
                outsideVatPeriod={!transactionVatActive}
                saving={saving}
                onClose={() => {
                  setTransactionDraft(null);
                  setTransactionEntryMode("");
                }}
                onSave={saveTransactionDraft}
                onPost={postTransactionDraft}
                onApproveInvoice={approvePurchaseInvoice}
                onCopyInvoice={copyPurchaseInvoiceToNew}
                approvalRequired={Boolean(settingsForm.approval_required)}
                openInvoices={supplierLedgerRows(selectedSupplierId).filter((item) => item.source === "invoice" && asNumber(item.invoice_balance) > 0)}
              />
            </TransactionEntryModal>
          ) : null}
          <AllocationModal
            open={Boolean(allocationRow)}
            title="Supplier payment allocation"
            accountName={selectedSupplier?.name || allocationRow?.supplier_name}
            source={allocationData?.payment || {}}
            sourceLabel="Payment"
            invoices={allocationData?.invoices || []}
            existingAllocations={allocationData?.existing_allocations || []}
            loading={allocationLoading}
            saving={allocationSaving}
            error={allocationError}
            onClose={() => { if (!allocationSaving) { setAllocationRow(null); setAllocationData(null); setAllocationError(""); } }}
            onAllocate={saveApAllocations}
            onUnallocate={unallocateApFromModal}
          />
          <AccountTransactionsAllocationModal
            open={accountAllocationOpen}
            accountName={selectedSupplier?.name || selectedSupplier?.business_name}
            credits={accountAllocationData.credits || []}
            debits={accountAllocationData.debits || []}
            summary={accountAllocationData.summary || {}}
            loading={accountAllocationLoading}
            saving={accountAllocationSaving}
            error={accountAllocationError}
            onClose={() => { if (!accountAllocationSaving) setAccountAllocationOpen(false); }}
            onSave={saveAccountAllocation}
          />
          <TransactionAllocationsModal
            open={Boolean(viewAllocationRow)}
            transaction={viewAllocationRow || {}}
            saving={allocationSaving}
            error={allocationError}
            onClose={() => { if (!allocationSaving) setViewAllocationRow(null); }}
            onUnallocate={unallocateLedgerAllocation}
          />

        </div>
      );
    }

    return (
      <div className="space-y-4">
        <Panel title="Suppliers">
          <div className="mb-3 flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-stone-400" />
              <Input value={supplierQuery} onChange={(e) => setSupplierQuery(e.target.value)} placeholder="Search supplier cards" className="h-9 pl-9" />
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {visibleSuppliers.map((supplier) => (
              <SupplierCard
                key={supplier.id}
                supplier={supplier}
                outstanding={supplier.current_balance ?? supplier.outstanding_balance ?? 0}
                paymentOnAccount={supplier.on_account_balance ?? supplier.payment_on_account_balance ?? 0}
                lastActivity={supplierLastActivity(supplier.id)}
                onOpen={() => openSupplier(supplier.id)}
              />
            ))}
            {!visibleSuppliers.length ? <div className="rounded-md border border-dashed border-stone-200 py-10 text-center text-sm text-stone-500 md:col-span-2">No suppliers found.</div> : null}
          </div>
        </Panel>
        {createSupplierOpen ? (
          <div className="fixed inset-y-0 right-0 z-40 w-full max-w-xl overflow-auto border-l border-stone-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-stone-200 bg-stone-50 px-4 py-3">
              <div>
                <h3 className="font-display text-lg font-semibold text-stone-900">Create supplier</h3>
                <p className="text-sm text-stone-500">Add a supplier account for Accounts Payable.</p>
              </div>
              <Button type="button" variant="outline" size="icon" onClick={closeCreateSupplier}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <form onSubmit={createSupplier} className="grid gap-3 p-4 md:grid-cols-2">
              <FieldControl label="Supplier name">
                <Input value={supplierForm.name} onChange={(e) => setSupplierForm((form) => ({ ...form, name: e.target.value }))} className="h-9" />
              </FieldControl>
              <FieldControl label="Supplier code">
                <Input value={supplierForm.supplier_code} onChange={(e) => setSupplierForm((form) => ({ ...form, supplier_code: e.target.value }))} className="h-9" />
              </FieldControl>
              <FieldControl label="Supplier category">
                <select value={supplierForm.supplier_category} onChange={(e) => setSupplierForm((form) => ({ ...form, supplier_category: e.target.value }))} className="h-9 w-full rounded-md border border-stone-200 bg-white px-3 text-sm shadow-sm">
                  <option value="Trade">Trade supplier</option>
                  <option value="Pension">Pension provider</option>
                </select>
              </FieldControl>
              <FieldControl label="Email">
                <Input type="email" value={supplierForm.email} onChange={(e) => setSupplierForm((form) => ({ ...form, email: e.target.value }))} className="h-9" />
              </FieldControl>
              <FieldControl label="Phone">
                <Input value={supplierForm.phone} onChange={(e) => setSupplierForm((form) => ({ ...form, phone: e.target.value }))} className="h-9" />
              </FieldControl>
              <FieldControl label="Payment terms">
                <Input type="number" value={supplierForm.payment_terms_days} onChange={(e) => setSupplierForm((form) => ({ ...form, payment_terms_days: e.target.value }))} className="h-9" />
              </FieldControl>
              <FieldControl label="Payment reference">
                <Input value={supplierForm.payment_reference} onChange={(e) => setSupplierForm((form) => ({ ...form, payment_reference: e.target.value }))} className="h-9" />
              </FieldControl>
              <AccountCodeSelect accounts={expenseAccounts} value={supplierForm.default_purchase_account} onChange={(value) => setSupplierForm((form) => ({ ...form, default_purchase_account: value }))} label="Default purchase nominal" />
              <div className="flex justify-end gap-2 md:col-span-2">
                <Button type="button" variant="outline" onClick={closeCreateSupplier}>Cancel</Button>
                <Button type="submit" disabled={saving || busy}>
                  <Plus className="mr-2 h-4 w-4" /> Create supplier
                </Button>
              </div>
            </form>
          </div>
          ) : null}

          {transactionEntryMode === "modal" && transactionDraft ? (
            <TransactionEntryModal onClose={() => {
              setTransactionDraft(null);
              setTransactionEntryMode("");
            }}>
              <ManualPurchaseDocumentDrawer
                draft={transactionDraft}
                setDraft={setTransactionDraft}
                errors={transactionErrors}
                supplier={selectedSupplier}
                expenseAccounts={expenseAccounts}
                bankAccounts={bankAccounts}
                vatCodes={transactionVatCodes}
                outsideVatPeriod={!transactionVatActive}
                saving={saving}
                onClose={() => {
                  setTransactionDraft(null);
                  setTransactionEntryMode("");
                }}
                onSave={saveTransactionDraft}
                onPost={postTransactionDraft}
                onApproveInvoice={approvePurchaseInvoice}
                onCopyInvoice={copyPurchaseInvoiceToNew}
                approvalRequired={Boolean(settingsForm.approval_required)}
                openInvoices={supplierLedgerRows(selectedSupplierId).filter((item) => item.source === "invoice" && asNumber(item.invoice_balance) > 0)}
              />
            </TransactionEntryModal>
          ) : null}
        </div>
      );
  }

  return null;
}

function TransactionEntryModal({ children, onClose }) {
  const dialogRef = useRef(null);
  const initialDraftRef = useRef(JSON.stringify(children?.props?.draft || {}));
  const isDirty = JSON.stringify(children?.props?.draft || {}) !== initialDraftRef.current;
  const requestClose = useCallback(() => {
    if (isDirty && !window.confirm("You have unsaved changes. Close this transaction without saving?")) return;
    onClose();
  }, [isDirty, onClose]);

  useEffect(() => {
    const scrollY = window.scrollY;
    const previous = {
      overflow: document.body.style.overflow,
      htmlOverflow: document.documentElement.style.overflow,
    };
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    const dialog = dialogRef.current;
    const focusable = dialog?.querySelector('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
    focusable?.focus();
    return () => {
      document.body.style.overflow = previous.overflow;
      document.documentElement.style.overflow = previous.htmlOverflow;
      window.scrollTo(0, scrollY);
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        requestClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') || [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [requestClose]);

  const guardedChildren = React.isValidElement(children) ? React.cloneElement(children, { onClose: requestClose }) : children;
  return (
    <div className="fixed inset-0 z-50 h-[100dvh] w-screen overflow-hidden bg-stone-950/60 p-0 sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}>
      <div className="mx-auto flex h-full w-full max-w-[1500px] items-stretch sm:items-center" onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}>
        <div ref={dialogRef} role="dialog" aria-modal="true" tabIndex={-1} className="relative flex max-h-full min-h-0 w-full max-w-[min(1380px,calc(100vw-24px))] overflow-hidden rounded-none bg-white shadow-2xl sm:max-h-[calc(100dvh-32px)] sm:rounded-md">
          <Button type="button" variant="outline" size="icon" onClick={requestClose} className="absolute right-3 top-3 z-20 bg-white">
            <X className="h-4 w-4" />
          </Button>
          <div className="min-h-0 w-full overflow-hidden">
            {guardedChildren}
          </div>
        </div>
      </div>
    </div>
  );
}

function LedgerColumnHeader({ label, sortKey, sort, onSort, children, align = "left", activeFilter = false, openKey = "", setOpenKey = () => {}, width, onResize }) {
  const wrapperRef = useRef(null);
  const open = openKey === sortKey;
  const sorted = sort?.key === sortKey;
  const indicator = sorted ? (sort.direction === "asc" ? "Asc" : "Desc") : "";
  const startResize = (event) => {
    if (!onResize) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = width || wrapperRef.current?.getBoundingClientRect().width || 120;
    const handleMouseMove = (moveEvent) => {
      onResize(Math.max(88, Math.round(startWidth + moveEvent.clientX - startX)));
    };
    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsideClick = (event) => {
      if (wrapperRef.current?.contains(event.target)) return;
      setOpenKey("");
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [open, setOpenKey]);

  return (
    <th ref={wrapperRef} className={`relative select-none px-2 py-1.5 align-top ${align === "right" ? "text-right" : "text-left"}`} style={width ? { width, minWidth: width } : undefined}>
      <div className={`flex items-center gap-1 ${align === "right" ? "justify-end" : "justify-start"}`}>
        <span className="font-semibold text-stone-600">{label}</span>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setOpenKey(open ? "" : sortKey);
          }}
          className={`inline-flex h-6 w-6 items-center justify-center rounded-md border transition ${activeFilter || sorted ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-transparent text-stone-400 hover:border-stone-200 hover:bg-white hover:text-stone-700"}`}
          aria-label={`${label} filter and sort`}
          title={`${label} filter and sort`}
        >
          <Filter className="h-3.5 w-3.5" />
        </button>
        {indicator ? <span className="text-[10px] normal-case text-emerald-700">{indicator}</span> : null}
      </div>
      {open ? (
        <div className={`absolute z-30 mt-1 w-56 rounded-md border border-stone-200 bg-white p-2 text-left normal-case tracking-normal shadow-lg ${align === "right" ? "right-0" : "left-0"}`}>
          {children || <SortControls sortKey={sortKey} onSort={onSort} />}
        </div>
      ) : null}
      {onResize ? <span role="separator" aria-orientation="vertical" className="absolute right-0 top-0 h-full w-1 cursor-col-resize bg-transparent hover:bg-emerald-200" onMouseDown={startResize} /> : null}
    </th>
  );
}

function ColumnSelectorPanel({ columns, visibleColumns, setVisibleColumns, onClose }) {
  const visibleSet = new Set(visibleColumns);
  const toggleColumn = (key) => {
    setVisibleColumns((current) => {
      if (current.includes(key)) return current.length === 1 ? current : current.filter((item) => item !== key);
      const order = columns.map((column) => column.key);
      return [...current, key].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    });
  };
  return (
    <div className="mb-3 flex justify-end">
      <div className="w-full max-w-sm rounded-md border border-stone-200 bg-white p-3 shadow-lg">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold text-stone-900">Select columns</h4>
            <p className="text-xs text-stone-500">Choose the columns shown in this ledger.</p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>Close</Button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {columns.map((column) => (
            <label key={column.key} className="flex items-center gap-2 text-sm text-stone-700">
              <input type="checkbox" checked={visibleSet.has(column.key)} onChange={() => toggleColumn(column.key)} />
              <span>{column.label}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

function SortControls({ sortKey, onSort }) {
  return (
    <div className="grid grid-cols-2 gap-1">
      <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => onSort(sortKey, "asc")}>Asc</Button>
      <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => onSort(sortKey, "desc")}>Desc</Button>
    </div>
  );
}

function ClearFilterButton({ children = "Clear filter", onClick }) {
  return (
    <Button type="button" variant="ghost" size="sm" className="mt-2 h-7 w-full justify-center text-xs" onClick={onClick}>
      {children}
    </Button>
  );
}

function ManualPurchaseDocumentDrawer({
  draft,
  setDraft,
  errors,
  supplier,
  expenseAccounts,
  bankAccounts,
  vatCodes,
  outsideVatPeriod,
  saving,
  onClose,
  onSave,
  onPost,
  onApproveInvoice,
  onCopyInvoice,
  approvalRequired,
  openInvoices = [],
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const readOnly = isReadOnlyTransaction(draft);
  const existingLedgerRecord = Boolean(draft.id) && draft.source !== "frontend";
  const [editMode, setEditMode] = useState(false);
  const formReadOnly = readOnly || (existingLedgerRecord && !editMode);
  useEffect(() => {
    setEditMode(false);
  }, [draft.id, draft.ledgerKey]);
  const isCredit = isCreditDocument(draft.type);
  const isPayment = isPaymentDocument(draft.type);
  const lineTotals = transactionLineTotals(draft.line_items);
  const totalsDifference = {
    net: asNumber(draft.net) - lineTotals.net,
    vat: asNumber(draft.vat) - lineTotals.vat,
    gross: asNumber(draft.gross) - lineTotals.gross,
  };
  const totalsDiffer = Math.abs(totalsDifference.net) > 0.01 || Math.abs(totalsDifference.vat) > 0.01 || Math.abs(totalsDifference.gross) > 0.01;
  const sourceUrl = attachmentUrl(draft);
  const previewUrl = browserDocumentUrl(sourceUrl);
  const canOpenSourceUrl = Boolean(previewUrl) && isServedDocumentUrl(sourceUrl);
  const sourceKind = sourceDocumentKind(previewUrl || draft.attachment_name || draft.attachment_path);
  const sourceLabel = draft.source_submission_id ? "Source: Submitted Items" : "Source document";
  const isExistingApInvoice = draft.source === "invoice" && draft.id;
  const existingInvoiceStatus = String(draft.status || "").trim().toLowerCase().replaceAll(" ", "_");
  const canApproveExistingInvoice = isExistingApInvoice && !draft.posted_journal_id && ["awaiting_approval", "draft"].includes(existingInvoiceStatus);
  const saveLabel = draft.source === "invoice" && draft.id ? "Update AP invoice" : (approvalRequired ? "Submit for approval" : "Post to AP");
  const showPostAction = !isExistingApInvoice && !isPayment;
  const accountOptions = useMemo(() => {
    const seen = new Set();
    const baseOptions = expenseAccounts
      .map((account) => ({ value: account.code, label: `${account.code} - ${account.name}` }))
      .filter((option) => {
        if (!option.value || seen.has(normaliseOptionText(option.value))) return false;
        seen.add(normaliseOptionText(option.value));
        return true;
      });
    const currentValues = [draft.purchase_nominal, ...draft.line_items.map((line) => line.purchase_nominal)]
      .filter(Boolean)
      .map((value) => canonicalOptionValue(value, baseOptions))
      .filter((value) => value && !seen.has(normaliseOptionText(value)))
      .map((value) => {
        seen.add(normaliseOptionText(value));
        return { value, label: value };
      });
    return [...baseOptions, ...currentValues];
  }, [draft.line_items, draft.purchase_nominal, expenseAccounts]);
  const vatOptions = useMemo(() => {
    const seen = new Set();
    return vatCodes.filter((option) => {
      if (!option.value || seen.has(normaliseOptionText(option.value))) return false;
      seen.add(normaliseOptionText(option.value));
      return true;
    });
  }, [vatCodes]);
  const hasVatOptions = vatOptions.length > 0;
  const impact = ledgerImpactFor(draft.type);
  const set = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  const setLine = (index, key, value) => {
    setDraft((current) => ({
      ...current,
      line_items: current.line_items.map((line, i) => (i === index ? { ...line, [key]: value } : line)),
    }));
  };
  const addLine = () => {
    setDraft((current) => ({
      ...current,
      line_items: [...current.line_items, purchaseDocumentLine()],
    }));
  };
  const removeLine = (index) => {
    setDraft((current) => {
      const lines = current.line_items.filter((_, i) => i !== index);
      return { ...current, line_items: lines.length ? lines : [purchaseDocumentLine()] };
    });
  };

  return (
    <div className="w-full overflow-hidden rounded-b-md border-t border-emerald-200 bg-white shadow-inner">
      <div className="flex max-h-[calc(100dvh-32px)] min-h-0 flex-col">
        <header className="sticky top-0 z-10 border-b border-stone-200 bg-stone-50 px-4 py-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-display text-lg font-semibold text-stone-900">{supplier?.name || draft.supplier_name || "Supplier"}</h3>
                <Badge variant="secondary">{supplier?.supplier_code || draft.supplier_code || "No supplier code"}</Badge>
                <Badge className={statusBadgeClass(draft.status)}>{displayStatus(draft.status || "Awaiting approval")}</Badge>
              </div>
              <p className="mt-1 text-sm text-stone-500">
                {isPayment ? "Accounts Payable supplier payment details. The unallocated amount remains on the supplier account until matched." : isExistingApInvoice ? "Accounts Payable invoice details. Editable fields can be updated here." : "Manual Accounts Payable purchase document entry. Supplier is locked from the open supplier account."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {draft.originalKey ? <Button type="button" variant="outline" onClick={() => set("showImpact", !draft.showImpact)}>View ledger impact</Button> : null}
              {draft.originalKey ? <Button type="button" variant="outline" onClick={() => set("showAudit", !draft.showAudit)}>View audit trail</Button> : null}
              {isExistingApInvoice ? <Button type="button" variant="outline" disabled={saving} onClick={onCopyInvoice}>Copy to new purchase invoice</Button> : null}
              {existingLedgerRecord && !readOnly && !editMode ? <Button type="button" onClick={() => setEditMode(true)} style={{ background: "var(--brand)" }}><Edit3 className="mr-2 h-4 w-4" /> Edit</Button> : null}
              {existingLedgerRecord && editMode ? <Button type="button" variant="outline" onClick={() => setEditMode(false)}>Cancel edit</Button> : null}
              <Button type="button" variant="outline" onClick={onClose}>Cancel / close</Button>
              {!formReadOnly ? <Button type="button" variant="outline" disabled={saving} onClick={(event) => onSave(event, draft.status || "Awaiting approval")}>{saveLabel}</Button> : null}
              {!formReadOnly && showPostAction ? <Button type="button" disabled={saving} onClick={onPost} style={{ background: "var(--brand)" }}>Post to AP</Button> : null}
              {canApproveExistingInvoice ? <Button type="button" disabled={saving} onClick={() => onApproveInvoice(draft)} style={{ background: "var(--brand)" }}>Approve</Button> : null}
              <Button type="button" variant="outline" size="sm" onClick={onClose}><X className="h-4 w-4" /></Button>
            </div>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 gap-0 overflow-y-auto overflow-x-hidden xl:grid-cols-[minmax(0,1fr)_340px]">
          <form onSubmit={(event) => onSave(event, draft.status || "Awaiting approval")} className="min-h-0 min-w-0 p-3">
            {readOnly ? (
              <div className="mb-3 rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-600">
                This {isPayment ? "supplier payment" : "AP invoice"} is view-only because its status is {displayStatus(draft.status)}. Corrections should be entered through the appropriate AP adjustment flow.
              </div>
            ) : null}
            {existingLedgerRecord && !readOnly && !editMode ? (
              <div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                This AP ledger item is open in read-only view mode. Select Edit to update its header or line items.
              </div>
            ) : null}
            {errors.backend ? <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{errors.backend}</div> : null}
            {errors.supplier ? <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errors.supplier}</div> : null}

            <section className="rounded-md border border-stone-200 bg-white p-3">
              <h4 className="mb-3 text-sm font-semibold text-stone-900">Coding / accounting fields</h4>
              {outsideVatPeriod && !isPayment ? <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">Outside VAT registration period. NO VAT applied.</p> : null}
              <div className="grid gap-3 md:grid-cols-3">
                <FieldControl label="Supplier ID">
                  <Input value={draft.supplier_id || ""} readOnly className="h-9 bg-stone-50" />
                </FieldControl>
                <FieldControl label="Supplier name">
                  <Input value={supplier?.name || draft.supplier_name || ""} readOnly className="h-9 bg-stone-50" />
                </FieldControl>
                <FieldControl label="Supplier code">
                  <Input value={supplier?.supplier_code || draft.supplier_code || ""} readOnly className="h-9 bg-stone-50" />
                </FieldControl>
                <FieldControl label="Type" error={errors.type}>
                  <select value={draft.type} disabled={formReadOnly} onChange={(e) => set("type", e.target.value)} className="h-9 w-full rounded-md border border-stone-200 bg-white px-3 text-sm disabled:bg-stone-50">
                    {transactionTypes.map((type) => <option key={type} value={type}>{type === "Purchase Invoice" ? "Purchase Invoice / Bill" : type}</option>)}
                  </select>
                </FieldControl>
                {!isPayment ? (
                  <FieldControl label={documentNumberLabel(draft.type)} error={errors.document_number}>
                    <Input value={draft.document_number || ""} readOnly={formReadOnly} onChange={(e) => set("document_number", e.target.value)} className="h-9" />
                  </FieldControl>
                ) : null}
                <FieldControl label="Reference">
                  <Input value={draft.reference || ""} readOnly={formReadOnly} onChange={(e) => set("reference", e.target.value)} className="h-9" />
                </FieldControl>
                <FieldControl label={documentDateLabel(draft.type)} error={errors.date}>
                  <Input type="date" value={draft.date || ""} readOnly={formReadOnly} onChange={(e) => set("date", e.target.value)} className="h-9" />
                </FieldControl>
                {!isCredit && !isPayment ? (
                  <>
                    <FieldControl label="Due date">
                      <Input type="date" value={draft.due_date || ""} readOnly={formReadOnly} onChange={(e) => set("due_date", e.target.value)} className="h-9" />
                    </FieldControl>
                    <FieldControl label="Payment terms">
                      <Input value={supplier?.payment_terms_days || draft.payment_terms || ""} readOnly className="h-9 bg-stone-50" />
                    </FieldControl>
                  </>
                ) : null}
                <FieldControl label="Currency">
                  <Input value={draft.currency || "GBP"} readOnly className="h-9 bg-stone-50" />
                </FieldControl>
                {!isPayment ? (
                  <>
                    <FieldControl label="Purchase nominal / category" error={errors.purchase_nominal}>
                      <select value={canonicalOptionValue(draft.purchase_nominal, accountOptions)} disabled={formReadOnly} onChange={(e) => set("purchase_nominal", e.target.value)} className="h-9 w-full rounded-md border border-stone-200 bg-white px-3 text-sm disabled:bg-stone-50">
                        <option value="">Select purchase nominal</option>
                        {accountOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </FieldControl>
                    <FieldControl label="VAT code">
                      {hasVatOptions ? (
                        <select value={canonicalOptionValue(draft.vat_code, vatOptions)} disabled={formReadOnly} onChange={(e) => set("vat_code", e.target.value)} className="h-9 w-full rounded-md border border-stone-200 bg-white px-3 text-sm disabled:bg-stone-50">
                          <option value="">Select VAT code</option>
                          {vatOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                      ) : (
                        <>
                          <Input value={draft.vat_code || ""} readOnly={formReadOnly} onChange={(e) => set("vat_code", e.target.value)} className="h-9" />
                          <p className="mt-1 text-xs text-amber-700">VAT code list unavailable. Free text is enabled until native VAT codes are returned.</p>
                        </>
                      )}
                    </FieldControl>
                  </>
                ) : null}
              </div>
              <div className="mt-3">
                <FieldControl label="Description" error={errors.description}>
                  <textarea value={draft.description || ""} readOnly={formReadOnly} onChange={(e) => set("description", e.target.value)} className="min-h-20 w-full rounded-md border border-stone-200 px-3 py-2 text-sm read-only:bg-stone-50" />
                </FieldControl>
              </div>
            </section>

            {!isPayment ? (
              <section className="mt-3 rounded-md border border-stone-200 bg-white p-3">
                <h4 className="mb-3 text-sm font-semibold text-stone-900">Amounts</h4>
                <div className="grid gap-3 md:grid-cols-4">
                  <FieldControl label="Net amount" error={errors.amount}>
                    <Input type="number" step="0.01" value={draft.net || ""} readOnly={formReadOnly} onChange={(e) => set("net", e.target.value)} className="h-9" />
                  </FieldControl>
                  <FieldControl label="VAT amount">
                    <Input type="number" step="0.01" value={draft.vat || ""} readOnly={formReadOnly} onChange={(e) => set("vat", e.target.value)} className="h-9" />
                  </FieldControl>
                  <FieldControl label="Gross amount">
                    <Input type="number" step="0.01" value={draft.gross || ""} readOnly={formReadOnly} onChange={(e) => set("gross", e.target.value)} className="h-9" />
                  </FieldControl>
                  <div className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-600">
                    <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">Lines gross</div>
                    <div className="mt-1 font-display text-lg font-semibold text-stone-900">{formatMoney(lineTotals.gross)}</div>
                  </div>
                </div>
                {totalsDiffer ? (
                  <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                    Header totals differ from line totals: net {formatMoney(totalsDifference.net)}, VAT {formatMoney(totalsDifference.vat)}, gross {formatMoney(totalsDifference.gross)}.
                  </div>
                ) : null}
              </section>
            ) : (
              <section className="mt-3 rounded-md border border-stone-200 bg-white p-3">
                <h4 className="mb-3 text-sm font-semibold text-stone-900">Supplier payment</h4>
                <div className="grid gap-3 md:grid-cols-3">
                  <FieldControl label="Bank account" error={errors.bank_account}>
                    <select value={draft.bank_account_code || ""} disabled={formReadOnly} onChange={(e) => set("bank_account_code", e.target.value)} className="h-9 w-full rounded-md border border-stone-200 bg-white px-3 text-sm disabled:bg-stone-50">
                      <option value="">Select bank account</option>
                      {bankAccounts.map((account) => <option key={account.code} value={account.code}>{account.code} - {account.name}</option>)}
                    </select>
                  </FieldControl>
                  <FieldControl label="Payment date" error={errors.date}>
                    <Input type="date" value={draft.date || ""} readOnly={formReadOnly} onChange={(e) => set("date", e.target.value)} className="h-9" />
                  </FieldControl>
                  <FieldControl label="Payment method">
                    <select value={draft.payment_method || "Bank Transfer"} disabled={formReadOnly} onChange={(e) => set("payment_method", e.target.value)} className="h-9 w-full rounded-md border border-stone-200 bg-white px-3 text-sm disabled:bg-stone-50">
                      {["Bank Transfer", "Card", "Cash", "Cheque", "Direct Debit"].map((method) => <option key={method} value={method}>{method}</option>)}
                    </select>
                  </FieldControl>
                  <FieldControl label="Bank reference">
                    <Input value={draft.reference || ""} readOnly={formReadOnly} onChange={(e) => set("reference", e.target.value)} className="h-9" />
                  </FieldControl>
                  <FieldControl label="Amount paid" error={errors.amount}>
                    <Input type="number" step="0.01" value={draft.gross || ""} readOnly={formReadOnly} onChange={(e) => set("gross", e.target.value)} className="h-9" />
                  </FieldControl>
                  <FieldControl label="Allocation target">
                    <select value={draft.allocation_target || "on_account"} disabled={formReadOnly} onChange={(e) => set("allocation_target", e.target.value)} className="h-9 w-full rounded-md border border-stone-200 bg-white px-3 text-sm disabled:bg-stone-50">
                      <option value="on_account">Leave as payment on account</option>
                      <option value="oldest">Oldest invoices automatically</option>
                      <option value="selected">Selected invoice</option>
                    </select>
                  </FieldControl>
                  {draft.allocation_target === "selected" ? (
                    <FieldControl label="Selected invoice">
                      <select value={draft.invoice_id || ""} disabled={formReadOnly} onChange={(e) => set("invoice_id", e.target.value)} className="h-9 w-full rounded-md border border-stone-200 bg-white px-3 text-sm disabled:bg-stone-50">
                        <option value="">Select invoice</option>
                        {openInvoices.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.reference || invoice.invoice_number} - {formatMoney(invoice.invoice_balance ?? invoice.outstanding_amount)}</option>)}
                      </select>
                    </FieldControl>
                  ) : null}
                </div>
                <p className="mt-3 text-xs text-stone-500">{asNumber(draft.gross) < 0 ? "A negative amount records a supplier refund on account. After posting, allocate it to one or more supplier credit notes." : draft.allocation_target === "on_account" ? "This payment posts only to bank and creditors control and remains available for later allocation." : "Allocation changes the supplier subledger only; it does not create another general-ledger posting."}</p>
              </section>
            )}

            {!isPayment ? (
              <section className="mt-3 rounded-md border border-stone-200 bg-white p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold text-stone-900">Line items</h4>
                  {!formReadOnly ? <Button type="button" variant="outline" size="sm" onClick={addLine}>Add line item</Button> : null}
                </div>
                {errors.line_items ? <div className="mb-2 text-xs font-medium text-red-600">{errors.line_items}</div> : null}
                <div className="w-full overflow-x-auto">
                  <table className="w-full table-fixed text-xs">
                    <thead className="border-b border-stone-200 text-left text-[10px] uppercase tracking-wider text-stone-500">
                      <tr>
                        <th className="w-[20%] py-1 pr-1.5">Description</th>
                        <th className="w-[19%] py-1 pr-1.5">Purchase nominal</th>
                        <th className="w-[17%] py-1 pr-1.5">VAT code</th>
                        <th className="py-1 pr-1.5">Quantity / units</th>
                        <th className="py-1 pr-1.5">Unit price</th>
                        <th className="py-1 pr-1.5">Net</th>
                        <th className="py-1 pr-1.5">VAT</th>
                        <th className="py-1">Total</th>
                        <th className="w-8 py-1 pl-1.5"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {draft.line_items.map((line, index) => (
                        <tr key={index}>
                          <td className="py-0.5 pr-1.5"><Input value={line.description || ""} readOnly={formReadOnly} onChange={(e) => setLine(index, "description", e.target.value)} className="h-8 w-full px-1.5 text-xs" /></td>
                          <td className="py-0.5 pr-1.5">
                            <select value={canonicalOptionValue(line.purchase_nominal, accountOptions)} disabled={formReadOnly} onChange={(e) => setLine(index, "purchase_nominal", e.target.value)} className="h-8 w-full rounded-md border border-stone-200 bg-white px-1.5 text-xs disabled:bg-stone-50">
                              <option value="">Select nominal</option>
                              {accountOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                            </select>
                          </td>
                          <td className="py-0.5 pr-1.5">
                            {hasVatOptions ? (
                              <select value={canonicalOptionValue(line.vat_code, vatOptions)} disabled={formReadOnly} onChange={(e) => setLine(index, "vat_code", e.target.value)} className="h-8 w-full rounded-md border border-stone-200 bg-white px-1.5 text-xs disabled:bg-stone-50">
                                <option value="">Select VAT code</option>
                                {vatOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                              </select>
                            ) : (
                              <Input value={line.vat_code || ""} readOnly={formReadOnly} onChange={(e) => setLine(index, "vat_code", e.target.value)} className="h-8 w-full px-1.5 text-xs" />
                            )}
                          </td>
                          <td className="py-0.5 pr-1.5"><Input type="number" step="0.01" value={line.quantity || ""} readOnly={formReadOnly} onChange={(e) => setLine(index, "quantity", e.target.value)} className="h-7 w-full px-1 text-xs" /></td>
                          <td className="py-0.5 pr-1.5"><Input type="number" step="0.01" value={line.unit_price || ""} readOnly={formReadOnly} onChange={(e) => setLine(index, "unit_price", e.target.value)} className="h-7 w-full px-1 text-xs" /></td>
                          <td className="py-0.5 pr-1.5"><Input type="number" step="0.01" value={line.net || ""} readOnly={formReadOnly} onChange={(e) => setLine(index, "net", e.target.value)} className="h-7 w-full px-1 text-xs" /></td>
                          <td className="py-0.5 pr-1.5"><Input type="number" step="0.01" value={line.vat || ""} readOnly={formReadOnly} onChange={(e) => setLine(index, "vat", e.target.value)} className="h-7 w-full px-1 text-xs" /></td>
                          <td className="py-0.5 pr-1.5"><Input type="number" step="0.01" value={line.gross || ""} readOnly={formReadOnly} onChange={(e) => setLine(index, "gross", e.target.value)} className="h-7 w-full px-1 text-xs" /></td>
                          <td className="py-0.5 pl-1.5">
                            {!formReadOnly ? <Button type="button" variant="ghost" size="icon" onClick={() => removeLine(index)} className="h-7 w-7 text-stone-500 hover:text-red-600"><X className="h-3.5 w-3.5" /></Button> : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!hasVatOptions ? (
                  <p className="mt-2 text-xs text-amber-700">VAT code list unavailable. Line VAT codes can be entered as text until native VAT codes are returned.</p>
                ) : null}
              </section>
            ) : null}
          </form>

          <aside className="min-h-0 min-w-0 border-t border-stone-200 bg-stone-50 p-3 xl:border-l xl:border-t-0">
            <section className="rounded-md border border-stone-200 bg-white p-3">
              <h4 className="text-sm font-semibold text-stone-900">Source document</h4>
              <div className="mt-3 min-h-56 rounded-md border border-dashed border-stone-300 bg-stone-50 p-4 text-sm text-stone-600">
                {hasAttachment(draft) ? (
                  <div className="flex h-full min-h-48 flex-col items-center justify-center gap-3 text-center">
                    <Badge className="bg-emerald-100 text-emerald-800">{sourceLabel}</Badge>
                    <div className="max-w-full break-words text-stone-700">
                      {draft.attachment_name || sourceUrl || draft.source_submission_id}
                    </div>
                    {canOpenSourceUrl ? (
                      <div className="flex flex-wrap justify-center gap-2">
                        <Button type="button" size="sm" onClick={() => setPreviewOpen(true)} style={{ background: "var(--brand)" }}>
                          <FileText className="mr-2 h-4 w-4" /> View document
                        </Button>
                        <a href={previewUrl} target="_blank" rel="noreferrer">
                          <Button type="button" variant="outline" size="sm">
                            Open in new tab
                          </Button>
                        </a>
                      </div>
                    ) : (
                      <Button type="button" variant="outline" size="sm" onClick={() => toast.info("Backend endpoint required: open Submitted Items source document.")}>
                        <FileText className="mr-2 h-4 w-4" /> View document
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="flex h-full min-h-48 items-center justify-center text-center text-stone-500">
                    No attachment linked to this manual AP entry
                  </div>
                )}
              </div>
            </section>

            {previewOpen && canOpenSourceUrl ? (
              <div className="fixed inset-0 z-50 bg-stone-950/70 p-4">
                <div className="mx-auto flex h-full max-w-5xl flex-col overflow-hidden rounded-md bg-white shadow-2xl">
                  <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3">
                    <div className="min-w-0">
                      <h4 className="font-display text-base font-semibold text-stone-900">Source document preview</h4>
                      <p className="truncate text-xs text-stone-500">{draft.attachment_name || previewUrl}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <a href={previewUrl} target="_blank" rel="noreferrer">
                        <Button type="button" variant="outline" size="sm">Open in new tab</Button>
                      </a>
                      <Button type="button" variant="outline" size="icon" onClick={() => setPreviewOpen(false)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="min-h-0 flex-1 bg-stone-100 p-3">
                    {sourceKind === "image" ? (
                      <div className="flex h-full items-center justify-center overflow-auto">
                        <img src={previewUrl} alt="Source document preview" className="max-h-full max-w-full rounded-md bg-white object-contain shadow" />
                      </div>
                    ) : sourceKind === "pdf" || sourceKind === "unknown" ? (
                      <iframe title="Source document preview" src={previewUrl} className="h-full w-full rounded-md border border-stone-200 bg-white" />
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}

            <section className="mt-3 rounded-md border border-stone-200 bg-white p-3">
              <h4 className="text-sm font-semibold text-stone-900">Totals</h4>
              <div className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-stone-500">Net</span><span className="font-semibold">{formatMoney(asNumber(draft.net))}</span></div>
                <div className="flex justify-between"><span className="text-stone-500">VAT</span><span className="font-semibold">{formatMoney(asNumber(draft.vat))}</span></div>
                <div className="flex justify-between"><span className="text-stone-500">Gross</span><span className="font-semibold">{formatMoney(asNumber(draft.gross))}</span></div>
              </div>
            </section>

            <section className="mt-3 rounded-md border border-stone-200 bg-white p-3">
              <h4 className="text-sm font-semibold text-stone-900">Ledger impact</h4>
              <div className="mt-3 space-y-2 text-sm text-stone-700">
                <div>{impact.debit}</div>
                <div>{impact.credit}</div>
                <div className="rounded-md bg-stone-50 px-3 py-2 text-xs text-stone-500">Destination: Accounts Payable</div>
              </div>
            </section>

            {draft.payment_allocation || String(draft.status || "").toLowerCase().includes("paid") ? (
              <section className="mt-3 rounded-md border border-stone-200 bg-white p-3">
                <h4 className="text-sm font-semibold text-stone-900">Payment allocation</h4>
                <p className="mt-2 text-sm text-stone-600">{draft.payment_allocation || "Payment allocation exists for this supplier ledger item."}</p>
              </section>
            ) : null}

            {draft.showAudit ? (
              <section className="mt-3 rounded-md border border-stone-200 bg-white p-3">
                <h4 className="text-sm font-semibold text-stone-900">Audit trail</h4>
                <div className="mt-2 space-y-1 text-sm text-stone-600">
                  <div>Opened from supplier ledger</div>
                  <div>Status: {displayStatus(draft.status || "Awaiting approval")}</div>
                  <div>Source: {draft.source === "frontend" ? "Manual AP entry" : "Accounts Payable ledger"}</div>
                </div>
              </section>
            ) : null}
          </aside>
        </div>
      </div>
    </div>
  );
}

function FieldControl({ label, error, children }) {
  return (
    <div>
      <Label className="text-xs font-semibold text-stone-600">{label}</Label>
      <div className="mt-1">{children}</div>
      {error ? <div className="mt-1 text-xs font-medium text-red-600">{error}</div> : null}
    </div>
  );
}

function SupplierCard({ supplier, outstanding, paymentOnAccount, lastActivity, onOpen }) {
  const systemSupplier = Boolean(supplier.is_system_supplier || supplier.isSystemSupplier);
  return (
    <button type="button" onClick={onOpen} className={`group flex min-h-[190px] flex-col overflow-hidden rounded-xl bg-white p-4 text-left shadow-[0_3px_12px_rgba(28,25,23,0.07)] transition duration-150 hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-[0_10px_26px_rgba(6,78,59,0.13)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 ${systemSupplier ? "border-2 border-emerald-400" : "border border-stone-200"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
            {systemSupplier
              ? <span className="text-xl" aria-hidden="true">{supplier.system_icon || "🛡️"}</span>
              : <Building2 className="h-6 w-6" />}
          </span>
          <div className="min-w-0 pt-0.5">
            <h4 className="truncate font-display text-base font-bold leading-tight text-stone-950">{supplier.name || "Unnamed supplier"}</h4>
            <p className="mt-1 truncate text-xs font-medium text-stone-500">{supplier.supplier_code || supplier.email || "No supplier code"}</p>
            <p className="mt-1.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">{systemSupplier ? "System supplier" : "Supplier account"}</p>
          </div>
        </div>
        <Badge className={`${statusBadgeClass(supplier.status || "active")} mt-1 shrink-0 shadow-sm`}>{supplier.status || "Active"}</Badge>
      </div>
      <div className="mt-4 grid flex-1 grid-cols-2 gap-3 border-t border-stone-200 pt-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-700"><ReceiptText className="h-4 w-4" /></span>
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-stone-500">Outstanding</div>
            <div className="mt-0.5 truncate font-display text-sm font-bold text-amber-900">{formatMoney(outstanding)}</div>
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-50 text-sky-700"><WalletCards className="h-4 w-4" /></span>
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-stone-500">On account</div>
            <div className="mt-0.5 truncate font-display text-sm font-bold text-sky-900">{formatMoney(paymentOnAccount)}</div>
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-stone-100 pt-2 text-[11px] text-stone-500">
        <span className="inline-flex min-w-0 items-center gap-1"><FileText className="h-3 w-3 shrink-0" /> <span className="truncate">Last transaction</span></span>
        <span className="shrink-0 font-medium text-stone-700">{lastActivity ? formatDate(lastActivity) : "-"}</span>
      </div>
    </button>
  );
}

export default AccountsPayableWorkspace;
