import React, { useCallback, useEffect, useMemo, useState } from "react";
import { API, api, formatApiError } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Download,
  Edit3,
  FileText,
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
  BankReportLine,
  DEFAULT_PAGE_SIZE,
  Field,
  Panel,
  PaginationFooter,
  SummaryCard,
  VatCodeSelect,
  canonicalVatCodeValue,
  formatDate,
  formatDateTime,
  formatMoney,
  normalisePaginatedResponse,
  normalisePageSize,
  statusBadgeClass,
  vatCodeOptionsFromWorkspace,
} from "./shared";

const arTabs = ["Customers", "Create customer"];
const customerRecordTabs = ["General", "Ledger", "Audit Trail"];
const transactionTypes = ["Sales Invoice", "Customer Credit Note", "Receipt", "Receipt on Account"];
const editableStatuses = ["draft", "awaiting approval", "awaiting_approval"];
const customerNumberingOptions = [
  { value: "manual", label: "Manual" },
  { value: "automatic", label: "Automatic" },
  { value: "prefix", label: "Prefix based" },
];
const receiptOnAccountBehaviourOptions = [
  { value: "hold", label: "Hold for future allocation" },
  { value: "warn", label: "Warn before saving" },
  { value: "require_allocation", label: "Require allocation" },
];
const salesCreditControlBehaviourOptions = [
  { value: "allow", label: "Allow sales entries" },
  { value: "warn", label: "Warn on credit limits" },
  { value: "hold", label: "Hold for credit control review" },
];

const emptyCustomerForm = {
  business_name: "",
  customer_code: "",
  trading_name: "",
  email: "",
  phone: "",
  website: "",
  contact_name: "",
  contact_position: "",
  contact_email: "",
  contact_phone: "",
  registered_address: "",
  trading_address: "",
  billing_address: "",
  vat_number: "",
  company_number: "",
  payment_terms_days: "30",
  default_currency: "GBP",
  default_sales_account: "4000",
  default_vat_code: "",
  credit_limit: "",
  status: "active",
  notes: "",
};

const emptyArLine = {
  description: "",
  nominal_account_code: "4000",
  vat_code: "",
  quantity: "1",
  unit_price: "",
  net_amount: "",
  vat_amount: "",
  gross_amount: "",
};

function todayInput() {
  return new Date().toISOString().slice(0, 10);
}

function toInputDate(value) {
  return value ? String(value).slice(0, 10) : "";
}

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatAmount(value) {
  const n = asNumber(value);
  return n ? n.toFixed(2) : "";
}

function normaliseCustomerDraft(customer = {}) {
  return {
    business_name: customer.business_name || customer.name || "",
    customer_code: customer.customer_code || "",
    trading_name: customer.trading_name || "",
    email: customer.email || "",
    phone: customer.phone || "",
    website: customer.website || "",
    contact_name: customer.contact_name || "",
    contact_position: customer.contact_position || "",
    contact_email: customer.contact_email || "",
    contact_phone: customer.contact_phone || "",
    registered_address: customer.registered_address || customer.address || "",
    trading_address: customer.trading_address || "",
    billing_address: customer.billing_address || "",
    vat_number: customer.vat_number || "",
    company_number: customer.company_number || "",
    payment_terms_days: customer.payment_terms_days ?? "30",
    default_currency: customer.default_currency || "GBP",
    default_sales_account: customer.default_sales_account || "",
    default_vat_code: customer.default_vat_code || "",
    credit_limit: customer.credit_limit ?? "",
    status: customer.status || "active",
    notes: customer.notes || "",
  };
}

function DisplayValue({ value }) {
  return (
    <div className="mt-1 min-h-9 rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-800">
      {value || "-"}
    </div>
  );
}

function EditableField({ label, value, onChange, editable, type = "text", options, textarea, checkbox }) {
  return (
    <div className={textarea ? "md:col-span-2" : ""}>
      <Label className="text-xs font-semibold text-stone-600">{label}</Label>
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
          className="mt-1 min-h-24 w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-emerald-500"
        />
      ) : Array.isArray(options) ? (
        <select value={value || ""} onChange={(e) => onChange(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-stone-200 bg-white px-3 text-sm shadow-sm">
          <option value="">Select</option>
          {options.map((option) => (
            <option key={option.value ?? option} value={option.value ?? option}>{option.label ?? option}</option>
          ))}
        </select>
      ) : (
        <Input type={type} value={value || ""} onChange={(e) => onChange(e.target.value)} className="mt-1 h-9" />
      )}
    </div>
  );
}

function isCreditDocument(type) {
  return type === "Customer Credit Note" || type === "Credit Note";
}

function isReceiptDocument(type) {
  return type === "Receipt" || type === "Customer Receipt" || type === "Receipt on Account";
}

function isReadOnlyTransaction(draft) {
  return !editableStatuses.includes(String(draft?.status || "draft").toLowerCase());
}

function lineTotals(lines = []) {
  return lines.reduce((totals, line) => {
    totals.net += asNumber(line.net_amount);
    totals.vat += asNumber(line.vat_amount);
    totals.gross += asNumber(line.gross_amount);
    return totals;
  }, { net: 0, vat: 0, gross: 0 });
}

function vatCodeLabel(value, vatOptions = []) {
  const code = canonicalVatCodeValue(value, vatOptions);
  return vatOptions.find((option) => option.value === code)?.label || code || "";
}

function displayStatus(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function optionLabel(value, options = []) {
  const match = options.find((option) => String(option.value) === String(value));
  return match?.label || displayStatus(value);
}

function hasAttachment(row = {}) {
  return Boolean(row.attachment_url || row.document_url || row.source_document_url || row.source_submission_id || row.attachment_path || row.attachment_name);
}

function attachmentUrl(row = {}) {
  return row.attachment_url || row.document_url || row.source_document_url || "";
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

function normaliseVatPayload(payload = {}, vatOptions = []) {
  const next = { ...payload };
  if ("default_vat_code" in next) next.default_vat_code = canonicalVatCodeValue(next.default_vat_code, vatOptions);
  if ("vat_code" in next) next.vat_code = canonicalVatCodeValue(next.vat_code, vatOptions);
  return next;
}

function normaliseLineVatPayload(lines = [], vatOptions = []) {
  return lines.map((line) => ({
    ...line,
    vat_code: canonicalVatCodeValue(line.vat_code, vatOptions),
  }));
}

function requiresVatOptions(value, vatOptions = []) {
  return !!String(value || "").trim() && vatOptions.length === 0;
}

function arInvoiceValue(row = {}) {
  return asNumber(row.invoice_value ?? row.gross_amount ?? row.gross ?? row.total ?? row.amount ?? row.debit);
}

function arAllocatedValue(row = {}) {
  return asNumber(row.paid_allocated ?? row.paid_amount ?? row.allocated_amount ?? row.amount_paid ?? row.credit);
}

function arInvoiceBalance(row = {}) {
  const supplied = row.invoice_balance ?? row.balance ?? row.outstanding_amount ?? row.amount_due ?? row.outstanding;
  if (supplied !== undefined && supplied !== null && supplied !== "") return asNumber(supplied);
  if (isReceiptDocument(row.type) || isCreditDocument(row.type)) return 0;
  return arInvoiceValue(row) - arAllocatedValue(row);
}

function normaliseArLedgerType(type = "") {
  const value = String(type || "").toLowerCase();
  if (value.includes("credit")) return "Customer Credit Note";
  if (value.includes("receipt") && value.includes("account")) return "Receipt on Account";
  if (value.includes("receipt") || value.includes("payment")) return "Receipt";
  return "Sales Invoice";
}

function normaliseArLedgerSource(type = "") {
  const value = String(type || "").toLowerCase();
  if (value.includes("credit")) return "credit_note";
  if (value.includes("receipt") || value.includes("payment")) return "receipt";
  return "invoice";
}

function ledgerImpactFor(type) {
  if (isCreditDocument(type)) {
    return ["Debit sales/VAT", "Credit debtors control"];
  }
  if (isReceiptDocument(type)) {
    if (type === "Receipt on Account") return ["Debit bank/cash", "Credit customer balance/on-account"];
    return ["Debit bank/cash", "Credit debtors control"];
  }
  return ["Debit debtors control", "Credit sales/VAT"];
}

function emptyTransactionDraft(type, customer, bankAccountCode) {
  const isReceipt = isReceiptDocument(type);
  return {
    id: "",
    ledgerKey: "",
    originalKey: "",
    source: "frontend",
    customer_id: customer?.id || "",
    customer_name: customer?.name || customer?.business_name || "",
    customer_code: customer?.customer_code || "",
    type,
    status: "Draft",
    date: todayInput(),
    invoice_date: todayInput(),
    due_date: todayInput(),
    credit_note_date: todayInput(),
    receipt_date: todayInput(),
    payment_terms: customer?.payment_terms_days || "30",
    currency: customer?.default_currency || "GBP",
    document_number: "",
    reference: "",
    description: "",
    sales_nominal: customer?.default_sales_account || "4000",
    vat_code: customer?.default_vat_code || "",
    amount: "",
    net_amount: "",
    vat_amount: "",
    gross_amount: "",
    bank_account_code: bankAccountCode || "1200",
    payment_method: "Bank Transfer",
    allocation_target: isReceipt ? "oldest" : "",
    invoice_id: "",
    lines: isReceipt ? [] : [{ ...emptyArLine, nominal_account_code: customer?.default_sales_account || "4000", vat_code: customer?.default_vat_code || "" }],
    showImpact: true,
    showAudit: false,
  };
}

export default function AccountsReceivableWorkspace({ workspace, tab, setTab, reloadWorkspace, busy }) {
  const ar = workspace.accounts_receivable || {};
  const clientId = workspace.client?.id;
  const [customerSummaries, setCustomerSummaries] = useState(() => (Array.isArray(ar.customers) ? ar.customers : []));
  const customers = customerSummaries;
  const invoices = useMemo(() => (Array.isArray(ar.invoices) ? ar.invoices : []), [ar.invoices]);
  const creditNotes = useMemo(() => (Array.isArray(ar.credit_notes) ? ar.credit_notes : []), [ar.credit_notes]);
  const receipts = useMemo(() => (Array.isArray(ar.receipts) ? ar.receipts : []), [ar.receipts]);
  const accounts = useMemo(() => (Array.isArray(workspace.accounts) ? workspace.accounts : []), [workspace.accounts]);
  const bankAccounts = useMemo(() => accounts.filter((account) => account.purpose === "Bank Account" || account.account_type === "Bank"), [accounts]);
  const incomeAccounts = useMemo(() => accounts.filter((account) => account.category === "Income" || account.account_type === "Sales"), [accounts]);
  const vatCodes = useMemo(() => vatCodeOptionsFromWorkspace(workspace), [workspace]);
  const activeTab = arTabs.includes(tab) ? tab : "Customers";

  const [saving, setSaving] = useState(false);
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerForm, setCustomerForm] = useState(emptyCustomerForm);
  const [createCustomerOpen, setCreateCustomerOpen] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [customerRecordTab, setCustomerRecordTab] = useState("General");
  const [customerEditMode, setCustomerEditMode] = useState(false);
  const [customerDraft, setCustomerDraft] = useState(normaliseCustomerDraft());
  const [transactionDraft, setTransactionDraft] = useState(null);
  const [transactionEditMode, setTransactionEditMode] = useState(false);
  const [transactionErrors, setTransactionErrors] = useState({});
  const [ledgerSearch, setLedgerSearch] = useState("");
  const [ledgerTypeFilter, setLedgerTypeFilter] = useState("All");
  const [ledgerStatusFilter, setLedgerStatusFilter] = useState("All");
  const [ledgerDateFrom, setLedgerDateFrom] = useState("");
  const [ledgerDateTo, setLedgerDateTo] = useState("");
  const [ledgerPage, setLedgerPage] = useState(1);
  const [ledgerPageSize, setLedgerPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [ledgerData, setLedgerData] = useState(() => normalisePaginatedResponse({ rows: [], page_size: DEFAULT_PAGE_SIZE }));
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerError, setLedgerError] = useState("");
  const [auditSearch, setAuditSearch] = useState("");
  const [auditPage, setAuditPage] = useState(1);
  const [auditPageSize, setAuditPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [auditData, setAuditData] = useState(() => normalisePaginatedResponse({ page_size: DEFAULT_PAGE_SIZE }));
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState("");
  const auditTrail = auditData.rows;
  const [settingsForm, setSettingsForm] = useState(ar.settings || {});
  const [statementCustomerId, setStatementCustomerId] = useState("");

  useEffect(() => { setAuditPage(1); }, [selectedCustomerId, auditSearch, auditPageSize]);
  useEffect(() => {
    if (customerRecordTab !== "Audit Trail" || !clientId || !selectedCustomerId) return;
    let cancelled = false;
    const params = new URLSearchParams({ page: String(auditPage), page_size: String(auditPageSize) });
    if (auditSearch) params.set("search", auditSearch);
    setAuditLoading(true); setAuditError("");
    api.get(`/admin/accounting/clients/${clientId}/ar/customers/${selectedCustomerId}/audit-trail?${params.toString()}`)
      .then(({ data }) => { if (!cancelled) setAuditData(normalisePaginatedResponse(data, auditPageSize)); })
      .catch((error) => { if (!cancelled) setAuditError(formatApiError(error)); })
      .finally(() => { if (!cancelled) setAuditLoading(false); });
    return () => { cancelled = true; };
  }, [customerRecordTab, clientId, selectedCustomerId, auditPage, auditPageSize, auditSearch]);

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    api.get(`/admin/accounting/clients/${clientId}/ar/customers`)
      .then(({ data }) => {
        if (!cancelled) setCustomerSummaries(Array.isArray(data?.rows) ? data.rows : []);
      })
      .catch((error) => {
        if (!cancelled) toast.error(`Unable to load customer summaries: ${formatApiError(error)}`);
      });
    return () => { cancelled = true; };
  }, [clientId, workspace]);

  useEffect(() => {
    setSettingsForm(ar.settings || {});
  }, [ar.settings]);

  useEffect(() => {
    setLedgerPage(1);
  }, [selectedCustomerId, ledgerSearch, ledgerTypeFilter, ledgerStatusFilter, ledgerDateFrom, ledgerDateTo]);

  useEffect(() => {
    if (activeTab === "Create customer") setCreateCustomerOpen(true);
  }, [activeTab]);

  function closeCreateCustomer() {
    setCreateCustomerOpen(false);
    setTab?.("Customers");
  }

  useEffect(() => {
    if (selectedCustomerId && !customers.some((customer) => customer.id === selectedCustomerId)) {
      setSelectedCustomerId("");
      setTransactionDraft(null);
    }
  }, [customers, selectedCustomerId]);

  const selectedCustomer = customers.find((customer) => customer.id === selectedCustomerId);

  useEffect(() => {
    setCustomerDraft(normaliseCustomerDraft(selectedCustomer));
    setCustomerEditMode(false);
  }, [selectedCustomer]);

  async function run(action, success) {
    setSaving(true);
    try {
      await action();
      toast.success(success);
      await reloadWorkspace?.();
      if (selectedCustomerId) await refreshCustomerLedger();
      return true;
    } catch (e) {
      toast.error(formatApiError(e));
      return false;
    } finally {
      setSaving(false);
    }
  }

  const postJson = (url, payload) => api.post(`/admin/accounting/clients/${clientId}${url}`, payload);
  const putJson = (url, payload) => api.put(`/admin/accounting/clients/${clientId}${url}`, payload);

  const refreshCustomerLedger = useCallback(async () => {
    if (!clientId || !selectedCustomerId) {
      setLedgerData(normalisePaginatedResponse({ rows: [], page_size: ledgerPageSize }));
      return;
    }
    const params = new URLSearchParams({
      page: String(ledgerPage),
      page_size: String(ledgerPageSize),
      customer_id: selectedCustomerId,
    });
    if (ledgerSearch.trim()) params.set("search", ledgerSearch.trim());
    if (ledgerTypeFilter !== "All") params.set("type", ledgerTypeFilter);
    if (ledgerStatusFilter !== "All") params.set("status", ledgerStatusFilter);
    if (ledgerDateFrom) params.set("date_from", ledgerDateFrom);
    if (ledgerDateTo) params.set("date_to", ledgerDateTo);
    setLedgerLoading(true);
    setLedgerError("");
    try {
      const { data } = await api.get(`/admin/accounting/clients/${clientId}/ar/customers/${selectedCustomerId}/ledger?${params.toString()}`);
      setLedgerData(normalisePaginatedResponse(data, ledgerPageSize));
    } catch (error) {
      setLedgerData(normalisePaginatedResponse({ rows: [], page: ledgerPage, page_size: ledgerPageSize }));
      setLedgerError(formatApiError(error));
    } finally {
      setLedgerLoading(false);
    }
  }, [clientId, ledgerDateFrom, ledgerDateTo, ledgerPage, ledgerPageSize, ledgerSearch, ledgerStatusFilter, ledgerTypeFilter, selectedCustomerId]);

  useEffect(() => {
    if (!selectedCustomerId) return;
    refreshCustomerLedger();
  }, [refreshCustomerLedger, selectedCustomerId]);

  async function createCustomer(e) {
    e.preventDefault();
    if (!customerForm.business_name.trim()) return toast.error("Customer name is required");
    if (requiresVatOptions(customerForm.default_vat_code, vatCodes)) return toast.error("Native VAT code list is unavailable. Clear the VAT code or load EPOS Native VAT Codes before saving.");
    await run(async () => postJson("/ar/customers", normaliseVatPayload(customerForm, vatCodes)), "Customer created");
    setCustomerForm(emptyCustomerForm);
    closeCreateCustomer();
  }

  async function saveCustomerDraft() {
    if (!customerDraft.business_name.trim()) return toast.error("Customer name is required");
    if (!selectedCustomer?.id) return toast.error("Customer record is unavailable");
    if (requiresVatOptions(customerDraft.default_vat_code, vatCodes)) return toast.error("Native VAT code list is unavailable. Clear the VAT code or load EPOS Native VAT Codes before saving.");
    const saved = await run(
      async () => putJson(`/ar/customers/${selectedCustomer.id}`, normaliseVatPayload(customerDraft, vatCodes)),
      "Customer record saved"
    );
    if (saved) setCustomerEditMode(false);
  }

  function openCustomer(customerId) {
    setSelectedCustomerId(customerId);
    setCustomerRecordTab("General");
  }

  const customerLedgerRows = useCallback((customerId) => {
    const rows = (ledgerData.rows || []).map((row) => ({
      ...row,
      id: row.id,
      ledgerKey: row.ledgerKey || row.ledger_key || `${row.source || row.type || "ledger"}-${row.id || row.reference || row.date}`,
      source: row.source || row.record_type || normaliseArLedgerSource(row.type || row.record_type || row.document_type),
      customer_id: row.customer_id || customerId,
      date: row.invoice_date || row.credit_note_date || row.receipt_date || row.date || row.created_at,
      type: normaliseArLedgerType(row.type || row.record_type || row.document_type),
      reference: row.invoice_number || row.credit_note_number || row.payment_reference || row.reference || "-",
      description: row.description || row.customer_name || "Customer ledger item",
      status: row.status || "Open",
      debit: row.debit ?? arInvoiceValue(row),
      credit: row.credit ?? arAllocatedValue(row),
      invoice_value: arInvoiceValue(row),
      paid_allocated: arAllocatedValue(row),
      invoice_balance: arInvoiceBalance(row),
      outstanding: asNumber(row.outstanding_amount ?? row.unallocated_amount),
      raw: row,
    }));
    let runningBalance = 0;
    return rows.map((row) => {
      runningBalance += row.debit - row.credit;
      return { ...row, runningBalance };
    });
  }, [ledgerData.rows]);

  const selectedLedgerRows = useMemo(() => selectedCustomer ? customerLedgerRows(selectedCustomer.id) : [], [customerLedgerRows, selectedCustomer]);
  const visibleLedgerRows = selectedLedgerRows;

  const ledgerStatuses = useMemo(() => ["All", ...Array.from(new Set(selectedLedgerRows.map((row) => row.status).filter(Boolean)))], [selectedLedgerRows]);
  const ledgerTotals = {
    debit: asNumber(ledgerData.summary.debit),
    credit: asNumber(ledgerData.summary.credit),
    invoiceValue: asNumber(ledgerData.summary.invoice_value ?? ledgerData.summary.total_invoice_value ?? ledgerData.summary.visible_invoice_value),
    allocated: asNumber(ledgerData.summary.paid_allocated ?? ledgerData.summary.receipts_credits_allocated ?? ledgerData.summary.allocated),
    balance: asNumber(ledgerData.summary.invoice_balance ?? ledgerData.summary.outstanding ?? ledgerData.summary.outstanding_balance),
  };
  const ledgerVisibleCount = Number(ledgerData.summary.visible_transaction_count ?? ledgerData.total_rows ?? visibleLedgerRows.length) || 0;
  const pagedLedgerRows = visibleLedgerRows;
  const visibleCustomers = useMemo(() => customers.filter((customer) => {
    const needle = customerQuery.trim().toLowerCase();
    if (!needle) return true;
    return `${customer.name || ""} ${customer.business_name || ""} ${customer.trading_name || ""} ${customer.customer_code || ""} ${customer.email || ""}`.toLowerCase().includes(needle);
  }), [customerQuery, customers]);

  async function loadTransactionDetail(row, initialDraft) {
    if (!clientId || !row?.id || row?.source === "frontend") return;
    const endpoint = row.source === "credit_note" ? `/ar/credit-notes/${row.id}` : row.source === "invoice" ? `/ar/invoices/${row.id}` : row.source === "receipt" ? `/ar/receipts/${row.id}` : "";
    if (!endpoint) return;
    try {
      const { data } = await api.get(`/admin/accounting/clients/${clientId}${endpoint}`);
      const detail = data?.invoice || data?.credit_note || data?.receipt || data;
      const detailLines = Array.isArray(data?.lines) ? data.lines : Array.isArray(detail?.lines) ? detail.lines : [];
      setTransactionDraft((current) => current?.id === initialDraft.id ? {
        ...current,
        ...detail,
        source: row.source,
        originalKey: initialDraft.originalKey,
        ledgerKey: initialDraft.ledgerKey,
        type: initialDraft.type,
        document_number: detail.invoice_number || detail.credit_note_number || current.document_number,
        date: toInputDate(detail.invoice_date || detail.credit_note_date || detail.receipt_date || current.date),
        invoice_date: toInputDate(detail.invoice_date || current.invoice_date),
        credit_note_date: toInputDate(detail.credit_note_date || current.credit_note_date),
        receipt_date: toInputDate(detail.receipt_date || current.receipt_date),
        due_date: toInputDate(detail.due_date || current.due_date),
        payment_terms: detail.payment_terms_days ?? current.payment_terms,
        sales_nominal: detail.nominal_account_code || detail.sales_nominal || detailLines[0]?.nominal_account_code || current.sales_nominal,
        lines: detailLines.length ? detailLines : current.lines,
        audit_trail: data?.audit_trail || detail.audit_trail || [],
        allocation_summary: detail.allocation_summary || data?.allocation_summary || {},
        ledger_effect: data?.ledger_effect || detail.ledger_effect,
        source_document: data?.source_document || detail.source_document,
        editable: data?.editable ?? detail.editable,
        view_only: data?.view_only ?? detail.view_only,
      } : current);
    } catch (error) {
      toast.error(`Unable to load AR document detail: ${formatApiError(error)}`);
    }
  }

  function openTransaction(type, row) {
    setTransactionErrors({});
    setTransactionEditMode(false);
    const customer = selectedCustomer || customers.find((item) => item.id === row?.customer_id);
    const next = emptyTransactionDraft(type || row?.type || "Sales Invoice", customer, bankAccounts[0]?.code);
    const raw = row?.raw || row || {};
    const gross = raw.gross_amount || raw.amount || row?.debit || row?.credit || "";
    const draft = {
      ...next,
      ...raw,
      id: raw.id || row?.id || "",
      ledgerKey: row?.ledgerKey || "",
      originalKey: row?.ledgerKey || "",
      source: row?.source || "frontend",
      type: row?.type || type || next.type,
      status: raw.status || row?.status || "Draft",
      customer_id: customer?.id || raw.customer_id || "",
      customer_name: customer?.name || customer?.business_name || raw.customer_name || "",
      customer_code: customer?.customer_code || "",
      date: toInputDate(row?.date || raw.invoice_date || raw.credit_note_date || raw.receipt_date) || todayInput(),
      invoice_date: toInputDate(raw.invoice_date || row?.date) || todayInput(),
      credit_note_date: toInputDate(raw.credit_note_date || row?.date) || todayInput(),
      receipt_date: toInputDate(raw.receipt_date || row?.date) || todayInput(),
      due_date: toInputDate(raw.due_date) || toInputDate(raw.invoice_date) || todayInput(),
      payment_terms: raw.payment_terms_days || raw.payment_terms || customer?.payment_terms_days || "30",
      document_number: raw.invoice_number || raw.credit_note_number || row?.reference || "",
      reference: raw.reference || row?.reference || "",
      description: raw.description || row?.description || "",
      sales_nominal: raw.default_sales_account || raw.nominal_account_code || customer?.default_sales_account || "4000",
      vat_code: raw.vat_code || customer?.default_vat_code || "",
      amount: formatAmount(raw.amount || row?.credit),
      net_amount: formatAmount(raw.net_amount),
      vat_amount: formatAmount(raw.vat_amount),
      gross_amount: formatAmount(raw.gross_amount || gross),
      lines: Array.isArray(raw.lines) && raw.lines.length ? raw.lines : (isReceiptDocument(row?.type || type) ? [] : [{
        ...emptyArLine,
        description: raw.description || row?.description || "",
        nominal_account_code: raw.nominal_account_code || customer?.default_sales_account || "4000",
        vat_code: raw.vat_code || customer?.default_vat_code || "",
        net_amount: formatAmount(raw.net_amount),
        vat_amount: formatAmount(raw.vat_amount),
        gross_amount: formatAmount(gross),
      }]),
      showImpact: true,
    };
    setTransactionDraft(draft);
    loadTransactionDetail({ ...row, source: row?.source || draft.source, id: draft.id }, draft);
  }

  function validateTransaction() {
    const errors = {};
    if (!transactionDraft?.customer_id) errors.customer = "Customer is required";
    if (!transactionDraft?.type) errors.type = "Type is required";
    if (isReceiptDocument(transactionDraft?.type)) {
      if (!transactionDraft.receipt_date) errors.date = "Receipt date is required";
      if (asNumber(transactionDraft.amount) <= 0) errors.amount = "Receipt amount is required";
      if (!transactionDraft.bank_account_code) errors.bank = "Bank account is required";
    } else {
      if (!transactionDraft.document_number?.trim()) errors.document_number = "Document number is required";
      if (!transactionDraft.description?.trim()) errors.description = "Description is required";
      if (!transactionDraft.sales_nominal?.trim()) errors.sales_nominal = "Sales nominal is required";
      if (!transactionDraft.lines?.length) errors.lines = "At least one line is required";
      if (transactionDraft.lines?.some((line) => !String(line.description || "").trim())) errors.lines = "Every line needs a description";
      if (!vatCodes.length) errors.vat = "Native VAT code list is unavailable. VAT code must come from EPOS Native VAT Codes.";
    }
    setTransactionErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function createInvoiceFromDraft(e, approve = false) {
    e.preventDefault();
    if (!validateTransaction()) return;
    const payload = {
      customer_id: transactionDraft.customer_id,
      invoice_number: transactionDraft.document_number,
      reference: transactionDraft.reference,
      invoice_date: transactionDraft.invoice_date || transactionDraft.date,
      due_date: transactionDraft.due_date,
      currency: transactionDraft.currency,
      description: transactionDraft.description,
      sales_nominal: transactionDraft.sales_nominal,
      nominal_account_code: transactionDraft.sales_nominal,
      vat_code: canonicalVatCodeValue(transactionDraft.vat_code, vatCodes),
      net_amount: transactionDraft.net_amount,
      vat_amount: transactionDraft.vat_amount,
      gross_amount: transactionDraft.gross_amount,
      lines: normaliseLineVatPayload(transactionDraft.lines, vatCodes),
    };
    const saved = await run(async () => {
      const existing = transactionDraft.source === "invoice" && transactionDraft.id;
      const { data } = existing ? await putJson(`/ar/invoices/${transactionDraft.id}`, { ...payload, payment_terms_days: transactionDraft.payment_terms }) : await postJson("/ar/invoices", { ...payload, payment_terms_days: transactionDraft.payment_terms });
      if (approve && data?.id) await postJson(`/ar/invoices/${data.id}/approve`, {});
    }, approve ? "Sales invoice approved" : transactionDraft.source === "invoice" && transactionDraft.id ? "Sales invoice updated" : "Sales invoice draft saved");
    if (saved) setTransactionDraft(null);
  }

  async function postInvoice(invoice) {
    await run(async () => postJson(`/ar/invoices/${invoice.id}/post`, {}), "Sales invoice posted to the ledger");
  }

  async function approveInvoice(invoice) {
    await run(async () => postJson(`/ar/invoices/${invoice.id}/approve`, {}), "Sales invoice approved");
  }

  async function archiveInvoice(invoice) {
    await run(async () => postJson(`/ar/invoices/${invoice.id}/archive`, {}), "Sales invoice archived");
  }

  async function createCreditNoteFromDraft(e, post = false) {
    e.preventDefault();
    if (!validateTransaction()) return;
    const payload = {
      customer_id: transactionDraft.customer_id,
      credit_note_number: transactionDraft.document_number,
      reference: transactionDraft.reference,
      credit_note_date: transactionDraft.credit_note_date || transactionDraft.date,
      currency: transactionDraft.currency,
      description: transactionDraft.description,
      sales_nominal: transactionDraft.sales_nominal,
      nominal_account_code: transactionDraft.sales_nominal,
      vat_code: canonicalVatCodeValue(transactionDraft.vat_code, vatCodes),
      net_amount: transactionDraft.net_amount,
      vat_amount: transactionDraft.vat_amount,
      gross_amount: transactionDraft.gross_amount,
      lines: normaliseLineVatPayload(transactionDraft.lines, vatCodes),
    };
    const saved = await run(async () => {
      const existing = transactionDraft.source === "credit_note" && transactionDraft.id;
      const { data } = existing ? await putJson(`/ar/credit-notes/${transactionDraft.id}`, payload) : await postJson("/ar/credit-notes", payload);
      if (post && data?.id) await postJson(`/ar/credit-notes/${data.id}/post`, {});
    }, post ? "Customer credit note posted" : transactionDraft.source === "credit_note" && transactionDraft.id ? "Customer credit note updated" : "Customer credit note draft saved");
    if (saved) setTransactionDraft(null);
  }

  async function createReceiptFromDraft(e) {
    e.preventDefault();
    if (!validateTransaction()) return;
    const allocations = transactionDraft.allocation_target === "selected" && transactionDraft.invoice_id
      ? [{ invoice_id: transactionDraft.invoice_id, amount: transactionDraft.amount }]
      : [];
    const payload = {
      customer_id: transactionDraft.customer_id,
      receipt_date: transactionDraft.receipt_date || transactionDraft.date,
      reference: transactionDraft.reference,
      payment_method: transactionDraft.payment_method,
      bank_account_code: transactionDraft.bank_account_code,
      amount: transactionDraft.amount,
      allocations,
    };
    const saved = await run(async () => postJson("/ar/receipts", payload), "Customer receipt posted");
    if (saved) setTransactionDraft(null);
  }

  function saveTransactionDraft(e) {
    if (isCreditDocument(transactionDraft?.type)) return createCreditNoteFromDraft(e, false);
    if (isReceiptDocument(transactionDraft?.type)) return createReceiptFromDraft(e);
    return createInvoiceFromDraft(e, false);
  }

  async function copyInvoiceToNew() {
    if (!transactionDraft?.id || transactionDraft.source !== "invoice") return;
    setSaving(true);
    try {
      const { data } = await postJson(`/ar/invoices/${transactionDraft.id}/copy`, {});
      const invoice = data?.invoice || data;
      toast.success("Copied to a new draft sales invoice");
      await reloadWorkspace?.();
      openTransaction("Sales Invoice", { ...invoice, raw: invoice, source: "invoice", type: "Sales Invoice" });
    } catch (error) {
      toast.error(formatApiError(error));
    } finally {
      setSaving(false);
    }
  }

  function primaryPostAction(e) {
    const impact = ledgerImpactFor(transactionDraft?.type);
    const summary = [
      `${isReceiptDocument(transactionDraft?.type) ? "Post receipt" : `Post ${transactionDraft?.type?.toLowerCase()}`} to Accounts Receivable?`,
      "",
      `Customer: ${selectedCustomer?.name || transactionDraft?.customer_name || "Not set"}`,
      `Reference: ${transactionDraft?.document_number || transactionDraft?.reference || "Not set"}`,
      `Net / VAT / Gross: ${transactionTotals(transactionDraft).net} / ${transactionTotals(transactionDraft).vat} / ${transactionTotals(transactionDraft).gross}`,
      "Ledger impact:",
      ...impact,
    ].join("\n");
    if (!window.confirm(summary)) return;
    if (isCreditDocument(transactionDraft?.type)) return createCreditNoteFromDraft(e, true);
    if (isReceiptDocument(transactionDraft?.type)) return createReceiptFromDraft(e);
    return createInvoiceFromDraft(e, true);
  }

  const customerAuditRows = useMemo(() => {
    const realRows = auditTrail.filter((row) => {
      if (!selectedCustomer) return false;
      return row.customer_id === selectedCustomer.id || row.record_id === selectedCustomer.id || String(row.description || "").includes(selectedCustomer.name || "");
    }).map((row) => ({
      id: row.id,
      date: row.created_at || row.date,
      user: row.user || row.user_name || "System",
      action: row.action || row.event || "Updated",
      description: row.description || row.new_value || row.module || "Customer activity",
    }));
    return realRows;
  }, [auditTrail, selectedCustomer]);

  if (activeTab === "Customers" || activeTab === "Create customer") {
    if (selectedCustomer) {
      return (
        <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <Button type="button" variant="outline" onClick={() => setSelectedCustomerId("")}>Back to customers</Button>
              <h3 className="mt-3 font-display text-2xl font-semibold text-stone-900">{customerDraft.business_name || selectedCustomer.name}</h3>
              <p className="text-sm text-stone-500">{customerDraft.customer_code || "No customer code"} - {customerDraft.email || "No email"}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {customerRecordTabs.map((recordTab) => (
                <Button key={recordTab} type="button" variant={customerRecordTab === recordTab ? "default" : "outline"} onClick={() => setCustomerRecordTab(recordTab)}>
                  {recordTab}
                </Button>
              ))}
            </div>
          </div>

          {customerRecordTab === "General" ? (
            <Panel title="Customer general details">
              <div className="mb-4 flex justify-end gap-2">
                {customerEditMode ? (
                  <>
                    <Button type="button" variant="outline" onClick={() => setCustomerEditMode(false)}>Cancel</Button>
                    <Button type="button" disabled={saving || busy} onClick={saveCustomerDraft} style={{ background: "var(--brand)" }}><Save className="mr-2 h-4 w-4" /> Save customer</Button>
                  </>
                ) : (
                  <Button type="button" onClick={() => setCustomerEditMode(true)} style={{ background: "var(--brand)" }}><Edit3 className="mr-2 h-4 w-4" /> Edit</Button>
                )}
              </div>
              <div className="grid gap-3 xl:grid-cols-2">
                <Section title="General">
                  <div className="grid gap-3 md:grid-cols-2">
                    <EditableField label="Customer name" value={customerDraft.business_name} editable={customerEditMode} onChange={(value) => setCustomerDraft((current) => ({ ...current, business_name: value }))} />
                    <EditableField label="Customer code" value={customerDraft.customer_code} editable={customerEditMode} onChange={(value) => setCustomerDraft((current) => ({ ...current, customer_code: value }))} />
                    <EditableField label="Trading name" value={customerDraft.trading_name} editable={customerEditMode} onChange={(value) => setCustomerDraft((current) => ({ ...current, trading_name: value }))} />
                    <EditableField label="Status" value={customerDraft.status} editable={customerEditMode} options={["active", "on_hold", "archived"]} onChange={(value) => setCustomerDraft((current) => ({ ...current, status: value }))} />
                    <EditableField label="Email" value={customerDraft.email} editable={customerEditMode} onChange={(value) => setCustomerDraft((current) => ({ ...current, email: value }))} />
                    <EditableField label="Phone" value={customerDraft.phone} editable={customerEditMode} onChange={(value) => setCustomerDraft((current) => ({ ...current, phone: value }))} />
                    <EditableField label="Website" value={customerDraft.website} editable={customerEditMode} onChange={(value) => setCustomerDraft((current) => ({ ...current, website: value }))} />
                    <EditableField label="Currency" value={customerDraft.default_currency} editable={customerEditMode} onChange={(value) => setCustomerDraft((current) => ({ ...current, default_currency: value }))} />
                  </div>
                </Section>
                <Section title="Customer settings">
                  <div className="grid gap-3 md:grid-cols-2">
                    <EditableField label="Approval required" checkbox value={settingsForm.approval_required} editable={false} />
                    <EditableField label="Customer numbering" value={optionLabel(settingsForm.customer_numbering || (settingsForm.automatic_customer_numbering ? "automatic" : "manual"), customerNumberingOptions)} editable={false} />
                    <EditableField label="Receipt/on-account behaviour" value={optionLabel(settingsForm.receipt_on_account_behaviour || "hold", receiptOnAccountBehaviourOptions)} editable={false} />
                    <EditableField label="Sales/credit control behaviour" value={optionLabel(settingsForm.sales_credit_control_behaviour || (settingsForm.credit_limit_warnings ? "warn" : "allow"), salesCreditControlBehaviourOptions)} editable={false} />
                  </div>
                </Section>
                <Section title="Addresses">
                  <div className="grid gap-3 md:grid-cols-2">
                    <EditableField label="Registered address" value={customerDraft.registered_address} editable={customerEditMode} textarea onChange={(value) => setCustomerDraft((current) => ({ ...current, registered_address: value }))} />
                    <EditableField label="Trading address" value={customerDraft.trading_address} editable={customerEditMode} textarea onChange={(value) => setCustomerDraft((current) => ({ ...current, trading_address: value }))} />
                    <EditableField label="Billing address" value={customerDraft.billing_address} editable={customerEditMode} textarea onChange={(value) => setCustomerDraft((current) => ({ ...current, billing_address: value }))} />
                  </div>
                </Section>
                <Section title="Contacts">
                  <div className="grid gap-3 md:grid-cols-2">
                    <EditableField label="Contact name" value={customerDraft.contact_name} editable={customerEditMode} onChange={(value) => setCustomerDraft((current) => ({ ...current, contact_name: value }))} />
                    <EditableField label="Position" value={customerDraft.contact_position} editable={customerEditMode} onChange={(value) => setCustomerDraft((current) => ({ ...current, contact_position: value }))} />
                    <EditableField label="Contact email" value={customerDraft.contact_email} editable={customerEditMode} onChange={(value) => setCustomerDraft((current) => ({ ...current, contact_email: value }))} />
                    <EditableField label="Contact phone" value={customerDraft.contact_phone} editable={customerEditMode} onChange={(value) => setCustomerDraft((current) => ({ ...current, contact_phone: value }))} />
                  </div>
                </Section>
                <Section title="Bank/payment details">
                  <div className="grid gap-3 md:grid-cols-2">
                    <EditableField label="Preferred receipt method" value={selectedCustomer.default_receipt_method || selectedCustomer.payment_method || "Not set"} editable={false} />
                    <EditableField label="Statement email" value={customerDraft.email || selectedCustomer.statement_email || ""} editable={false} />
                    <EditableField label="Currency" value={customerDraft.default_currency} editable={false} />
                  </div>
                </Section>
                <Section title="Payment terms">
                  <div className="grid gap-3 md:grid-cols-2">
                    <EditableField label="Payment terms days" value={customerDraft.payment_terms_days} editable={customerEditMode} onChange={(value) => setCustomerDraft((current) => ({ ...current, payment_terms_days: value }))} />
                    <EditableField label="Credit limit" value={customerDraft.credit_limit} editable={customerEditMode} onChange={(value) => setCustomerDraft((current) => ({ ...current, credit_limit: value }))} />
                    <EditableField label="Default sales nominal" value={customerDraft.default_sales_account} editable={customerEditMode} options={incomeAccounts.map((account) => ({ value: account.code, label: `${account.code} - ${account.name}` }))} onChange={(value) => setCustomerDraft((current) => ({ ...current, default_sales_account: value }))} />
                  </div>
                </Section>
                <Section title="Tax">
                  <div className="grid gap-3 md:grid-cols-2">
                    <EditableField label="VAT number" value={customerDraft.vat_number} editable={customerEditMode} onChange={(value) => setCustomerDraft((current) => ({ ...current, vat_number: value }))} />
                    <EditableField label="Company number" value={customerDraft.company_number} editable={customerEditMode} onChange={(value) => setCustomerDraft((current) => ({ ...current, company_number: value }))} />
                    {customerEditMode ? (
                      <VatCodeSelect label="Default VAT code" value={customerDraft.default_vat_code} options={vatCodes} onChange={(value) => setCustomerDraft((current) => ({ ...current, default_vat_code: value }))} />
                    ) : (
                      <EditableField label="Default VAT code" value={vatCodeLabel(customerDraft.default_vat_code, vatCodes)} editable={false} onChange={() => {}} />
                    )}
                  </div>
                </Section>
                <Section title="Notes">
                  <EditableField label="Customer notes" value={customerDraft.notes} editable={customerEditMode} textarea onChange={(value) => setCustomerDraft((current) => ({ ...current, notes: value }))} />
                </Section>
              </div>
            </Panel>
          ) : null}

          {customerRecordTab === "Ledger" ? (
            <Panel title="Customer ledger">
              <div className="mb-3 grid gap-3 md:grid-cols-4">
                <SummaryCard label="Visible transactions" value={ledgerVisibleCount} />
                <SummaryCard label="Invoice value" value={formatMoney(ledgerTotals.invoiceValue)} />
                <SummaryCard label="Invoice balance / outstanding" value={formatMoney(ledgerTotals.balance)} />
                <SummaryCard label="Receipts / credits allocated" value={formatMoney(ledgerTotals.allocated)} />
              </div>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={() => openTransaction("Sales Invoice")}>
                    <Plus className="mr-2 h-4 w-4" /> Add sales invoice
                  </Button>
                  <Button type="button" variant="outline" onClick={() => openTransaction("Customer Credit Note")}>
                    <Plus className="mr-2 h-4 w-4" /> Add customer credit note
                  </Button>
                  <Button type="button" variant="outline" onClick={() => openTransaction("Receipt")}>
                    <Plus className="mr-2 h-4 w-4" /> Add receipt
                  </Button>
                </div>
                <div className="flex min-w-72 flex-1 flex-wrap justify-end gap-2">
                  <div className="relative max-w-sm flex-1">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-stone-400" />
                    <Input value={ledgerSearch} onChange={(e) => setLedgerSearch(e.target.value)} placeholder="Search ledger" className="h-9 pl-9" />
                  </div>
                  <select value={ledgerTypeFilter} onChange={(e) => setLedgerTypeFilter(e.target.value)} className="h-9 rounded-md border border-stone-200 bg-white px-3 text-sm">
                    <option value="All">All types</option>
                    {transactionTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                  </select>
                  <select value={ledgerStatusFilter} onChange={(e) => setLedgerStatusFilter(e.target.value)} className="h-9 rounded-md border border-stone-200 bg-white px-3 text-sm">
                    {ledgerStatuses.map((status) => <option key={status} value={status}>{status === "All" ? "All statuses" : status}</option>)}
                  </select>
                  <Input type="date" value={ledgerDateFrom} onChange={(e) => setLedgerDateFrom(e.target.value)} className="h-9 w-36" />
                  <Input type="date" value={ledgerDateTo} onChange={(e) => setLedgerDateTo(e.target.value)} className="h-9 w-36" />
                  <Button type="button" variant="outline" onClick={() => exportRows(visibleLedgerRows, `${selectedCustomer?.name || "customer"}-ledger.csv`)}>
                    <Download className="mr-2 h-4 w-4" /> Export
                  </Button>
                </div>
              </div>
              {ledgerError ? <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{ledgerError}</div> : null}
              {ledgerLoading ? <div className="mb-3 rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-600">Loading customer ledger...</div> : null}
              <LedgerTable
                rows={pagedLedgerRows}
                totalRows={ledgerVisibleCount}
                page={ledgerPage}
                pageSize={ledgerPageSize}
                totalPages={ledgerData.total_pages}
                loading={ledgerLoading}
                onPageChange={setLedgerPage}
                onPageSizeChange={(size) => {
                  setLedgerPageSize(normalisePageSize(size));
                  setLedgerPage(1);
                }}
                onOpen={(row) => openTransaction(row.type, row)}
                totals={ledgerTotals}
              />
            </Panel>
          ) : null}

          {customerRecordTab === "Audit Trail" ? (
            <Panel title="Customer audit trail">
              <div className="mb-3 relative max-w-lg">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-stone-400" />
                <Input value={auditSearch} onChange={(e) => setAuditSearch(e.target.value)} placeholder="Search audit trail" className="h-9 pl-9" />
              </div>
              {auditError ? <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{auditError}</div> : null}
              {auditLoading && !customerAuditRows.length ? <div className="py-8 text-center text-sm text-stone-500">Loading customer audit trail...</div> : null}
              <AuditTable rows={customerAuditRows.filter((row) => `${row.date} ${row.user} ${row.action} ${row.description}`.toLowerCase().includes(auditSearch.trim().toLowerCase()))} />
              <PaginationFooter page={auditData.page} pageSize={auditData.page_size} totalRows={auditData.total_rows} totalPages={auditData.total_pages} onPageChange={setAuditPage} onPageSizeChange={setAuditPageSize} disabled={auditLoading} />
            </Panel>
          ) : null}

          {transactionDraft ? (
            <ManualSalesDocumentDrawer
              draft={transactionDraft}
              setDraft={setTransactionDraft}
              errors={transactionErrors}
              customer={selectedCustomer}
              customers={customers}
              invoices={invoices}
              incomeAccounts={incomeAccounts}
              vatCodes={vatCodes}
              bankAccounts={bankAccounts}
              onClose={() => setTransactionDraft(null)}
              onSave={saveTransactionDraft}
              onPost={primaryPostAction}
              onApproveInvoice={approveInvoice}
              onPostInvoice={postInvoice}
              onArchiveInvoice={archiveInvoice}
              editMode={transactionEditMode}
              setEditMode={setTransactionEditMode}
              onCopyInvoice={copyInvoiceToNew}
              saving={saving || busy}
            />
          ) : null}
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <Panel title="Customers">
          <div className="mb-3 flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-stone-400" />
              <Input value={customerQuery} onChange={(e) => setCustomerQuery(e.target.value)} placeholder="Search customer cards" className="h-9 pl-9" />
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {visibleCustomers.map((customer) => (
              <CustomerCard
                key={customer.id}
                customer={customer}
                outstanding={customer.outstanding_balance ?? customer.current_balance ?? 0}
                receiptsOnAccount={customer.on_account_balance ?? customer.receipts_on_account_balance ?? 0}
                lastActivity={customer.last_transaction_date || customer.last_activity_date || customer.last_transaction_at}
                onOpen={() => openCustomer(customer.id)}
              />
            ))}
            {!visibleCustomers.length ? <div className="rounded-md border border-dashed border-stone-200 py-10 text-center text-sm text-stone-500 md:col-span-2">No customers found.</div> : null}
          </div>
        </Panel>
        {createCustomerOpen ? (
          <div className="fixed inset-y-0 right-0 z-40 w-full max-w-xl overflow-auto border-l border-stone-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-stone-200 bg-stone-50 px-4 py-3">
              <div>
                <h3 className="font-display text-lg font-semibold text-stone-900">Create customer</h3>
                <p className="text-sm text-stone-500">Add a customer account for Accounts Receivable.</p>
              </div>
              <Button type="button" variant="outline" size="icon" onClick={closeCreateCustomer}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <form onSubmit={createCustomer} className="grid gap-3 p-4 md:grid-cols-2">
              <Field label="Customer name" value={customerForm.business_name} onChange={(value) => setCustomerForm((current) => ({ ...current, business_name: value }))} />
              <Field label="Customer code" value={customerForm.customer_code} onChange={(value) => setCustomerForm((current) => ({ ...current, customer_code: value }))} />
              <Field label="Email" type="email" value={customerForm.email} onChange={(value) => setCustomerForm((current) => ({ ...current, email: value }))} />
              <Field label="Phone" value={customerForm.phone} onChange={(value) => setCustomerForm((current) => ({ ...current, phone: value }))} />
              <Field label="Payment terms" value={customerForm.payment_terms_days} onChange={(value) => setCustomerForm((current) => ({ ...current, payment_terms_days: value }))} />
              <AccountCodeSelect label="Default sales nominal" accounts={incomeAccounts} value={customerForm.default_sales_account} onChange={(value) => setCustomerForm((current) => ({ ...current, default_sales_account: value }))} />
              <div className="flex justify-end gap-2 md:col-span-2">
                <Button type="button" variant="outline" onClick={closeCreateCustomer}>Cancel</Button>
                <Button disabled={busy || saving} className="gap-2" style={{ background: "var(--brand)" }}><Plus className="h-4 w-4" /> Create customer</Button>
              </div>
            </form>
          </div>
        ) : null}
      </div>
    );
  }

  if (activeTab === "Sales Invoices") {
    return <RegisterPanel title="Sales invoices" rows={invoices} numberKey="invoice_number" dateKey="invoice_date" amountKey="gross_amount" empty="No sales invoices yet." customerOpen={setSelectedCustomerId} onOpen={(row) => { setSelectedCustomerId(row.customer_id); openTransaction("Sales Invoice", { ...row, type: "Sales Invoice", source: "invoice", raw: row }); }} />;
  }

  if (activeTab === "Credit Notes") {
    return <RegisterPanel title="Customer credit notes" rows={creditNotes} numberKey="credit_note_number" dateKey="credit_note_date" amountKey="gross_amount" empty="No customer credit notes yet." customerOpen={setSelectedCustomerId} onOpen={(row) => { setSelectedCustomerId(row.customer_id); openTransaction("Customer Credit Note", { ...row, type: "Customer Credit Note", source: "credit_note", raw: row }); }} />;
  }

  if (activeTab === "Receipts") {
    return <RegisterPanel title="Customer receipts" rows={receipts} numberKey="reference" dateKey="receipt_date" amountKey="amount" empty="No customer receipts yet." customerOpen={setSelectedCustomerId} onOpen={(row) => { setSelectedCustomerId(row.customer_id); openTransaction("Receipt", { ...row, type: "Receipt", source: "receipt", raw: row }); }} />;
  }

  if (activeTab === "Customer Statements") {
    const rows = statementCustomerId ? customerLedgerRows(statementCustomerId) : [];
    return (
      <Panel title="Customer statement">
        <div className="mb-3 max-w-lg"><CustomerSelect customers={customers} value={statementCustomerId} onChange={setStatementCustomerId} /></div>
        {rows.length ? <LedgerTable rows={rows} onOpen={() => {}} /> : <p className="py-8 text-center text-sm text-stone-500">Select a customer to view statement activity.</p>}
      </Panel>
    );
  }

  if (activeTab === "Aged Debtors") return <AgedDebtorsTable rows={ar.aged_debtors || []} />;
  if (activeTab === "Reports") return <ArReports ar={ar} />;

  return null;
}

function Section({ title, children }) {
  return (
    <section className="rounded-md border border-stone-200 bg-white p-3">
      <h4 className="mb-3 text-sm font-semibold text-stone-900">{title}</h4>
      {children}
    </section>
  );
}

function CustomerCard({ customer, outstanding, receiptsOnAccount, lastActivity, onOpen }) {
  return (
    <button type="button" onClick={onOpen} className="rounded-md border border-stone-200 bg-white p-4 text-left shadow-sm transition hover:border-emerald-300 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="font-display text-base font-semibold text-stone-900">{customer.name || customer.business_name || "Unnamed customer"}</h4>
          <p className="mt-0.5 text-xs text-stone-500">{customer.customer_code || customer.email || "No customer code"}</p>
        </div>
        <Badge className={statusBadgeClass(customer.status || "active")}>{customer.status || "Active"}</Badge>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-md bg-amber-50 px-3 py-2">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700"><ReceiptText className="h-3.5 w-3.5" /> Outstanding</div>
          <div className="mt-1 font-display text-lg font-bold text-amber-900">{formatMoney(outstanding)}</div>
        </div>
        <div className="rounded-md bg-sky-50 px-3 py-2">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-sky-700"><WalletCards className="h-3.5 w-3.5" /> On account</div>
          <div className="mt-1 font-display text-lg font-bold text-sky-900">{formatMoney(receiptsOnAccount)}</div>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-stone-500">
        <span className="inline-flex items-center gap-1.5"><FileText className="h-3.5 w-3.5" /> Last transaction</span>
        <span className="font-medium text-stone-700">{lastActivity ? formatDate(lastActivity) : "-"}</span>
      </div>
    </button>
  );
}

function LedgerTable({ rows, onOpen, totals, totalRows, totalPages, page, pageSize, loading = false, onPageChange, onPageSizeChange }) {
  const footerTotalRows = totalRows;
  return (
    <div className="overflow-hidden rounded-md border border-stone-200">
      <table className="w-full text-sm">
        <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
          <tr>
            <th className="px-3 py-2 text-left">Date</th>
            <th className="px-3 py-2 text-left">Type</th>
            <th className="px-3 py-2 text-left">Reference</th>
            <th className="px-3 py-2 text-left">Description</th>
            <th className="px-3 py-2 text-right">Invoice value</th>
            <th className="px-3 py-2 text-right">Paid / allocated</th>
            <th className="px-3 py-2 text-right">Invoice balance</th>
            <th className="px-3 py-2 text-left">Status</th>
            <th className="px-3 py-2 text-left">Attachment</th>
          </tr>
        </thead>
        <tbody>
          {rows.length ? rows.map((row) => (
            <tr key={row.ledgerKey || row.id} onClick={() => onOpen(row)} className="cursor-pointer border-t border-stone-100 hover:bg-emerald-50/50">
              <td className="px-3 py-2">{formatDate(row.date)}</td>
              <td className="px-3 py-2 font-medium">
                <div className="flex flex-wrap items-center gap-2">
                  {row.type}
                  {row.source === "frontend" ? <Badge className="bg-amber-100 text-amber-800">Staged</Badge> : null}
                </div>
              </td>
              <td className="px-3 py-2">{row.reference || "-"}</td>
              <td className="px-3 py-2 text-stone-600">{row.description}</td>
              <td className="px-3 py-2 text-right">{arInvoiceValue(row) ? formatMoney(arInvoiceValue(row)) : "-"}</td>
              <td className="px-3 py-2 text-right">{arAllocatedValue(row) ? formatMoney(arAllocatedValue(row)) : "-"}</td>
              <td className="px-3 py-2 text-right font-semibold">{arInvoiceBalance(row) ? formatMoney(arInvoiceBalance(row)) : "-"}</td>
              <td className="px-3 py-2"><Badge className={statusBadgeClass(row.status)}>{row.status || "Open"}</Badge></td>
              <td className="px-3 py-2">{hasAttachment(row) ? <Badge className="bg-emerald-100 text-emerald-800">Attached</Badge> : "-"}</td>
            </tr>
          )) : (
            <tr><td colSpan="9" className="px-3 py-10 text-center text-stone-500">No customer ledger activity yet.</td></tr>
          )}
        </tbody>
        {totals && rows.length ? (
          <tfoot className="border-t border-stone-200 bg-stone-50 text-sm font-semibold">
            <tr>
              <td colSpan="4" className="px-3 py-2 text-right">Visible total</td>
              <td className="px-3 py-2 text-right">{formatMoney(totals.invoiceValue)}</td>
              <td className="px-3 py-2 text-right">{formatMoney(totals.allocated)}</td>
              <td className="px-3 py-2 text-right">{formatMoney(totals.balance)}</td>
              <td className="px-3 py-2" />
              <td className="px-3 py-2" />
            </tr>
          </tfoot>
        ) : null}
      </table>
      {footerTotalRows ? (
        <PaginationFooter
          page={page || 1}
          pageSize={pageSize || DEFAULT_PAGE_SIZE}
          totalRows={footerTotalRows}
          totalPages={totalPages}
          disabled={loading}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
        />
      ) : null}
    </div>
  );
}

function AuditTable({ rows }) {
  return (
    <div className="overflow-auto rounded-md border border-stone-200">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500"><tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">User</th><th className="px-3 py-2">Action</th><th className="px-3 py-2">Detail</th></tr></thead>
        <tbody>
          {rows.length ? rows.map((row) => <tr key={row.id} className="border-t border-stone-100"><td className="px-3 py-2">{formatDateTime(row.date)}</td><td className="px-3 py-2">{row.user}</td><td className="px-3 py-2 font-semibold">{row.action}</td><td className="px-3 py-2 text-stone-600">{row.description}</td></tr>) : <tr><td colSpan="4" className="px-3 py-8 text-center text-stone-500">No audit records found.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function RegisterPanel({ title, rows = [], numberKey, dateKey, amountKey, empty, onOpen }) {
  return (
    <Panel title={title}>
      {rows.length ? (
        <div className="overflow-auto rounded-md border border-stone-200">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500"><tr><th className="px-3 py-2">Customer</th><th className="px-3 py-2">Reference</th><th className="px-3 py-2">Date</th><th className="px-3 py-2">Due</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Net</th><th className="px-3 py-2 text-right">VAT</th><th className="px-3 py-2 text-right">Gross</th><th className="px-3 py-2 text-right">Outstanding</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} onClick={() => onOpen(row)} className="cursor-pointer border-t border-stone-100 align-top hover:bg-emerald-50/40">
                  <td className="px-3 py-2 font-semibold text-stone-900">{row.customer_name || "-"}</td>
                  <td className="px-3 py-2">{row[numberKey] || row.reference || "-"}</td>
                  <td className="px-3 py-2">{formatDate(row[dateKey])}</td>
                  <td className="px-3 py-2">{formatDate(row.due_date)}</td>
                  <td className="px-3 py-2"><Badge className={statusBadgeClass(row.status)}>{row.status}</Badge></td>
                  <td className="px-3 py-2 text-right">{formatMoney(row.net_amount)}</td>
                  <td className="px-3 py-2 text-right">{formatMoney(row.vat_amount)}</td>
                  <td className="px-3 py-2 text-right">{formatMoney(row[amountKey])}</td>
                  <td className="px-3 py-2 text-right">{row.outstanding_amount ? formatMoney(row.outstanding_amount) : row.unallocated_amount ? formatMoney(row.unallocated_amount) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="py-10 text-center text-sm text-stone-500">{empty}</p>}
    </Panel>
  );
}

function ManualSalesDocumentDrawer({ draft, setDraft, errors, customer, customers, invoices, incomeAccounts, vatCodes, bankAccounts, onClose, onSave, onPost, onApproveInvoice, onPostInvoice, onArchiveInvoice, editMode, setEditMode, onCopyInvoice, saving }) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const readOnly = isReadOnlyTransaction(draft);
  const existingLedgerRecord = Boolean(draft.id) && draft.source !== "frontend";
  const formReadOnly = readOnly || (existingLedgerRecord && !editMode);
  const isReceipt = isReceiptDocument(draft.type);
  const isCredit = isCreditDocument(draft.type);
  const totals = transactionTotals(draft);
  const totalsDifference = {
    net: asNumber(draft.net_amount) - asNumber(totals.net),
    vat: asNumber(draft.vat_amount) - asNumber(totals.vat),
    gross: asNumber(draft.gross_amount) - asNumber(totals.gross),
  };
  const totalsDiffer = Math.abs(totalsDifference.net) > 0.01 || Math.abs(totalsDifference.vat) > 0.01 || Math.abs(totalsDifference.gross) > 0.01;
  const impact = ledgerImpactFor(draft.type);
  const customerInvoices = invoices.filter((invoice) => invoice.customer_id === draft.customer_id && Number(invoice.outstanding_amount || 0) > 0);
  const set = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  const setLine = (index, key, value) => setDraft((current) => ({ ...current, lines: current.lines.map((line, lineIndex) => lineIndex === index ? { ...line, [key]: value } : line) }));
  const existingInvoiceStatus = String(draft.status || "").toLowerCase();
  const canApproveExistingInvoice = draft.source === "invoice" && !draft.posted_journal_id && ["draft", "awaiting_approval"].includes(existingInvoiceStatus);
  const canPostExistingInvoice = draft.source === "invoice" && !draft.posted_journal_id && existingInvoiceStatus === "approved";
  const canArchiveExistingInvoice = draft.source === "invoice" && ["posted", "paid", "part_paid"].includes(String(draft.status || "").toLowerCase());
  const sourceUrl = attachmentUrl(draft);
  const previewUrl = browserDocumentUrl(sourceUrl);
  const canOpenSourceUrl = Boolean(previewUrl) && isServedDocumentUrl(sourceUrl);
  const sourceKind = sourceDocumentKind(previewUrl || draft.attachment_name || draft.attachment_path);
  const sourceLabel = draft.source_submission_id ? "Source: Submitted Items" : "Source document";

  return (
    <div className="fixed inset-2 z-40 overflow-hidden rounded-md border border-stone-200 bg-white shadow-2xl sm:inset-4">
      <div className="flex h-full min-h-0 flex-col">
        <header className="border-b border-stone-200 bg-stone-50 px-4 py-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-display text-lg font-semibold text-stone-900">{customer?.name || customer?.business_name || draft.customer_name || "Customer"}</h3>
                <Badge variant="secondary">{customer?.customer_code || draft.customer_code || "No customer code"}</Badge>
                <Badge className={statusBadgeClass(draft.status)}>{displayStatus(draft.status || "Draft")}</Badge>
              </div>
              <p className="mt-1 text-sm text-stone-500">
                Manual Accounts Receivable sales document entry. Customer is locked from the open customer account.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {existingLedgerRecord ? <Button type="button" variant="outline" onClick={() => set("showImpact", !draft.showImpact)}>View ledger impact</Button> : null}
              {existingLedgerRecord ? <Button type="button" variant="outline" onClick={() => set("showAudit", !draft.showAudit)}>View audit trail</Button> : null}
              {draft.source === "invoice" && draft.id ? <Button type="button" variant="outline" disabled={saving} onClick={onCopyInvoice}>Copy to new invoice</Button> : null}
              {existingLedgerRecord && !readOnly && !editMode ? <Button type="button" onClick={() => setEditMode(true)} style={{ background: "var(--brand)" }}><Edit3 className="mr-2 h-4 w-4" /> Edit</Button> : null}
              {existingLedgerRecord && editMode ? <Button type="button" variant="outline" onClick={() => setEditMode(false)}>Cancel edit</Button> : null}
              <Button type="button" variant="outline" onClick={onClose}>Cancel / close</Button>
              {!formReadOnly && !isReceipt ? <Button type="button" variant="outline" disabled={saving} onClick={(event) => onSave(event)}>Save draft</Button> : null}
              {!formReadOnly && !existingLedgerRecord ? <Button type="button" disabled={saving} onClick={onPost} style={{ background: "var(--brand)" }}>{isReceipt ? "Post receipt" : "Post to AR"}</Button> : null}
              {canApproveExistingInvoice ? <Button type="button" disabled={saving} onClick={() => onApproveInvoice(draft)} style={{ background: "var(--brand)" }}>Approve</Button> : null}
              {canPostExistingInvoice ? <Button type="button" disabled={saving} onClick={() => onPostInvoice(draft)} style={{ background: "var(--brand)" }}>Post</Button> : null}
              {canArchiveExistingInvoice ? <Button type="button" variant="outline" disabled={saving} onClick={() => onArchiveInvoice(draft)}>Archive</Button> : null}
              <Button type="button" variant="outline" size="sm" onClick={onClose}><X className="h-4 w-4" /></Button>
            </div>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 gap-0 xl:grid-cols-[minmax(0,1fr)_340px]">
          <form onSubmit={onSave} className="min-h-0 overflow-auto p-4">
            {readOnly ? <div className="mb-3 rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-600">Posted, paid, part-paid, allocated and archived customer ledger records are view only. Corrections should be entered as a customer credit note or receipt allocation flow.</div> : null}
            {existingLedgerRecord && !readOnly && !editMode ? <div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">This document is open in read-only view mode. Select Edit to update its header or line items.</div> : null}
            {errors.customer ? <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errors.customer}</div> : null}
            <div className="grid gap-4">
              <Section title="Coding / accounting fields">
                <div className="grid gap-3 md:grid-cols-3">
                  <ReadOnlyField label="Customer ID" value={draft.customer_id} />
                  <ReadOnlyField label="Customer name" value={customer?.name || customer?.business_name || draft.customer_name} />
                  <ReadOnlyField label="Customer code" value={customer?.customer_code || draft.customer_code} />
                  <FieldControl label="Type" error={errors.type}>
                    <select value={draft.type} disabled={formReadOnly || !!draft.originalKey} onChange={(e) => setDraft((current) => ({ ...emptyTransactionDraft(e.target.value, customer, bankAccounts[0]?.code), customer_id: current.customer_id, customer_name: current.customer_name, customer_code: current.customer_code }))} className="h-9 w-full rounded-md border border-stone-200 bg-white px-3 text-sm disabled:bg-stone-50">
                      {transactionTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                    </select>
                  </FieldControl>
                  {isReceipt ? (
                    <>
                      <FieldControl label="Receipt date" error={errors.date}><Input type="date" value={draft.receipt_date || ""} disabled={formReadOnly} onChange={(e) => set("receipt_date", e.target.value)} className="h-9" /></FieldControl>
                      <FieldControl label="Reference"><Input value={draft.reference || ""} disabled={formReadOnly} onChange={(e) => set("reference", e.target.value)} className="h-9" /></FieldControl>
                      <FieldControl label="Payment method"><select value={draft.payment_method || ""} disabled={formReadOnly} onChange={(e) => set("payment_method", e.target.value)} className="h-9 w-full rounded-md border border-stone-200 bg-white px-3 text-sm disabled:bg-stone-50">{["Bank Transfer", "Card", "Cash", "Cheque", "Direct Debit"].map((method) => <option key={method} value={method}>{method}</option>)}</select></FieldControl>
                      <FieldControl label="Bank account" error={errors.bank}><select value={draft.bank_account_code || ""} disabled={formReadOnly} onChange={(e) => set("bank_account_code", e.target.value)} className="h-9 w-full rounded-md border border-stone-200 bg-white px-3 text-sm disabled:bg-stone-50">{bankAccounts.map((account) => <option key={account.code} value={account.code}>{account.code} - {account.name}</option>)}</select></FieldControl>
                      <FieldControl label="Amount" error={errors.amount}><Input value={draft.amount || ""} disabled={formReadOnly} onChange={(e) => set("amount", e.target.value)} className="h-9" /></FieldControl>
                      <FieldControl label="Allocation target"><select value={draft.allocation_target || "oldest"} disabled={formReadOnly} onChange={(e) => set("allocation_target", e.target.value)} className="h-9 w-full rounded-md border border-stone-200 bg-white px-3 text-sm disabled:bg-stone-50"><option value="oldest">Oldest invoices automatically</option><option value="selected">Selected invoice</option><option value="on_account">Leave as payment on account</option></select></FieldControl>
                      {draft.allocation_target === "selected" ? <FieldControl label="Selected invoice"><select value={draft.invoice_id || ""} disabled={formReadOnly} onChange={(e) => set("invoice_id", e.target.value)} className="h-9 w-full rounded-md border border-stone-200 bg-white px-3 text-sm disabled:bg-stone-50"><option value="">Select invoice</option>{customerInvoices.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.invoice_number} - {formatMoney(invoice.outstanding_amount)}</option>)}</select></FieldControl> : null}
                    </>
                  ) : (
                    <>
                      <FieldControl label={isCredit ? "Credit note number" : "Sales invoice number"} error={errors.document_number}><Input value={draft.document_number || ""} disabled={formReadOnly} onChange={(e) => set("document_number", e.target.value)} className="h-9" /></FieldControl>
                      <FieldControl label="Reference"><Input value={draft.reference || ""} disabled={formReadOnly} onChange={(e) => set("reference", e.target.value)} className="h-9" /></FieldControl>
                      <FieldControl label={isCredit ? "Credit note date" : "Invoice date"}><Input type="date" value={isCredit ? draft.credit_note_date || "" : draft.invoice_date || ""} disabled={formReadOnly} onChange={(e) => set(isCredit ? "credit_note_date" : "invoice_date", e.target.value)} className="h-9" /></FieldControl>
                      {!isCredit ? <FieldControl label="Due date"><Input type="date" value={draft.due_date || ""} disabled={formReadOnly} onChange={(e) => set("due_date", e.target.value)} className="h-9" /></FieldControl> : null}
                      <FieldControl label="Payment terms"><Input value={draft.payment_terms || ""} disabled={formReadOnly || isCredit} onChange={(e) => set("payment_terms", e.target.value)} className="h-9" /></FieldControl>
                      <FieldControl label="Currency"><Input value={draft.currency || ""} readOnly className="h-9 bg-stone-50" /></FieldControl>
                      <FieldControl label="Sales nominal / category" error={errors.sales_nominal}>
                        <select value={draft.sales_nominal || ""} disabled={formReadOnly} onChange={(e) => set("sales_nominal", e.target.value)} className="h-9 w-full rounded-md border border-stone-200 bg-white px-3 text-sm disabled:bg-stone-50">
                          <option value="">Select sales nominal</option>
                          {incomeAccounts.map((account) => <option key={account.code} value={account.code}>{account.code} - {account.name}</option>)}
                        </select>
                      </FieldControl>
                      <FieldControl label="VAT code" error={errors.vat}>
                        <VatCodeSelect label="" value={draft.vat_code} options={vatCodes} disabled={formReadOnly} onChange={(value) => set("vat_code", value)} />
                      </FieldControl>
                    </>
                  )}
                </div>
                {!isReceipt ? (
                  <div className="mt-3">
                    <FieldControl label="Description" error={errors.description}>
                      <textarea value={draft.description || ""} readOnly={formReadOnly} onChange={(e) => set("description", e.target.value)} className="min-h-20 w-full rounded-md border border-stone-200 px-3 py-2 text-sm read-only:bg-stone-50" />
                    </FieldControl>
                  </div>
                ) : null}
                {!isReceipt ? (
                  <div className="mt-3">
                    <div className="grid gap-3 md:grid-cols-4">
                      <FieldControl label="Net amount"><Input type="number" step="0.01" value={draft.net_amount || ""} readOnly={formReadOnly} onChange={(e) => set("net_amount", e.target.value)} className="h-9" /></FieldControl>
                      <FieldControl label="VAT amount"><Input type="number" step="0.01" value={draft.vat_amount || ""} readOnly={formReadOnly} onChange={(e) => set("vat_amount", e.target.value)} className="h-9" /></FieldControl>
                      <FieldControl label="Gross amount"><Input type="number" step="0.01" value={draft.gross_amount || ""} readOnly={formReadOnly} onChange={(e) => set("gross_amount", e.target.value)} className="h-9" /></FieldControl>
                      <div className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-600"><div className="text-xs font-semibold uppercase tracking-wide text-stone-500">Lines gross</div><div className="mt-1 font-display text-lg font-semibold text-stone-900">{formatMoney(totals.gross)}</div></div>
                    </div>
                    {totalsDiffer ? <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">Header totals differ from line totals: net {formatMoney(totalsDifference.net)}, VAT {formatMoney(totalsDifference.vat)}, gross {formatMoney(totalsDifference.gross)}.</div> : null}
                  </div>
                ) : null}
              </Section>
              {!isReceipt ? (
                <Section title="Line items">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    {errors.lines ? <div className="text-xs font-medium text-red-600">{errors.lines}</div> : <span />}
                    {!formReadOnly ? <Button type="button" variant="outline" size="sm" onClick={() => setDraft((current) => ({ ...current, lines: [...current.lines, { ...emptyArLine, nominal_account_code: draft.sales_nominal, vat_code: draft.vat_code }] }))}>Add line item</Button> : null}
                  </div>
                  <div className="w-full overflow-hidden">
                  <table className="w-full table-fixed text-xs">
                    <thead className="border-b border-stone-200 text-left text-[10px] uppercase tracking-wider text-stone-500">
                      <tr>
                          <th className="w-[22%] py-1 pr-1.5">Description</th>
                          <th className="w-[17%] py-1 pr-1.5">Sales nominal</th>
                          <th className="w-[14%] py-1 pr-1.5">VAT code</th>
                          <th className="py-1 pr-1.5">Quantity</th>
                          <th className="py-1 pr-1.5">Unit price</th>
                          <th className="py-1 pr-1.5">Net</th>
                          <th className="py-1 pr-1.5">VAT</th>
                          <th className="py-1">Gross</th>
                          <th className="py-1 pl-1.5"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {(draft.lines || []).map((line, index) => (
                          <tr key={index}>
                            <td className="py-0.5 pr-1.5"><Input value={line.description || ""} readOnly={formReadOnly} onChange={(e) => setLine(index, "description", e.target.value)} className="h-8 w-full px-1.5 text-xs" /></td>
                            <td className="py-0.5 pr-1.5">
                              <select value={line.nominal_account_code || ""} disabled={formReadOnly} onChange={(e) => setLine(index, "nominal_account_code", e.target.value)} className="h-8 w-full rounded-md border border-stone-200 bg-white px-1.5 text-xs disabled:bg-stone-50">
                                <option value="">Select</option>
                                {incomeAccounts.map((account) => <option key={account.code} value={account.code}>{account.code} - {account.name}</option>)}
                              </select>
                            </td>
                            <td className="py-0.5 pr-1.5"><VatCodeSelect label="" value={line.vat_code || ""} options={vatCodes} disabled={formReadOnly} compact onChange={(value) => setLine(index, "vat_code", value)} /></td>
                            <td className="py-0.5 pr-1.5"><Input type="number" step="0.01" value={line.quantity || ""} readOnly={formReadOnly} onChange={(e) => setLine(index, "quantity", e.target.value)} className="h-7 w-full px-1 text-xs" /></td>
                            <td className="py-0.5 pr-1.5"><Input type="number" step="0.01" value={line.unit_price || ""} readOnly={formReadOnly} onChange={(e) => setLine(index, "unit_price", e.target.value)} className="h-7 w-full px-1 text-xs" /></td>
                            <td className="py-0.5 pr-1.5"><Input type="number" step="0.01" value={line.net_amount || ""} readOnly={formReadOnly} onChange={(e) => setLine(index, "net_amount", e.target.value)} className="h-7 w-full px-1 text-xs" /></td>
                            <td className="py-0.5 pr-1.5"><Input type="number" step="0.01" value={line.vat_amount || ""} readOnly={formReadOnly} onChange={(e) => setLine(index, "vat_amount", e.target.value)} className="h-7 w-full px-1 text-xs" /></td>
                            <td className="py-0.5 pr-1.5"><Input type="number" step="0.01" value={line.gross_amount || ""} readOnly={formReadOnly} onChange={(e) => setLine(index, "gross_amount", e.target.value)} className="h-7 w-full px-1 text-xs" /></td>
                            <td className="py-0.5 pl-1.5">
                              {!formReadOnly ? <Button type="button" variant="ghost" size="icon" onClick={() => setDraft((current) => ({ ...current, lines: current.lines.length > 1 ? current.lines.filter((_, lineIndex) => lineIndex !== index) : current.lines }))} className="h-7 w-7 text-stone-500 hover:text-red-600"><X className="h-3.5 w-3.5" /></Button> : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Section>
              ) : null}
            </div>
          </form>
          <aside className="min-h-0 space-y-3 overflow-auto border-t border-stone-200 bg-stone-50 p-4 lg:border-l lg:border-t-0">
            <Section title="Source document">
              <div className="flex min-h-56 items-center justify-center rounded-md border border-dashed border-stone-300 bg-stone-50 p-4 text-center text-sm text-stone-500">
                {hasAttachment(draft) ? (
                  <div className="flex h-full min-h-48 flex-col items-center justify-center gap-3 text-center">
                    <Badge className="bg-emerald-100 text-emerald-800">{sourceLabel}</Badge>
                    <div className="max-w-full break-words text-stone-700">
                      {draft.attachment_name || sourceUrl || draft.source_submission_id}
                    </div>
                    {draft.source_document_missing || draft.source_document_status === "missing" ? (
                      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">The original source document is no longer available. The accounting record remains accessible.</div>
                    ) : canOpenSourceUrl ? (
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
                    No attachment linked to this manual AR entry
                  </div>
                )}
              </div>
            </Section>
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
            <Section title="Totals">
              <div className="mt-3 space-y-2 text-sm">
                <BankReportLine label="Net" value={formatMoney(totals.net)} />
                <BankReportLine label="VAT" value={formatMoney(totals.vat)} />
                <BankReportLine label="Gross" value={formatMoney(totals.gross)} />
              </div>
            </Section>
            {draft.showImpact ? <Section title="Ledger impact"><div className="mt-3 space-y-2 text-sm text-stone-700">{impact.map((item) => <div key={item}>{item}</div>)}<div className="rounded-md bg-stone-50 px-3 py-2 text-xs text-stone-500">Destination: Accounts Receivable</div></div></Section> : null}
            <Section title="Allocation summary">
              <p className="text-sm text-stone-600">{isReceipt ? (draft.allocation_target === "on_account" ? "Receipt will remain as payment on account." : draft.allocation_target === "selected" ? "Receipt will allocate to the selected invoice." : "Receipt will allocate against oldest invoices automatically.") : "Allocations appear here once receipts or credit notes are matched."}</p>
            </Section>
            {draft.showAudit ? <Section title="Audit trail"><div className="mt-2 space-y-2 text-sm text-stone-600">{Array.isArray(draft.audit_trail) && draft.audit_trail.length ? draft.audit_trail.map((event) => <div key={event.id || `${event.created_at}-${event.action}`} className="rounded-md border border-stone-200 bg-white px-3 py-2"><div className="font-semibold text-stone-800">{displayStatus(event.action || "Updated")}</div><div className="text-xs text-stone-500">{formatDateTime(event.created_at)} · {event.user_name || event.user || "System"}</div></div>) : <div>No audit events recorded for this document.</div>}</div></Section> : null}
          </aside>
        </div>
      </div>
    </div>
  );
}

function transactionTotals(draft) {
  if (isReceiptDocument(draft?.type)) {
    const amount = asNumber(draft?.amount);
    return { net: amount, vat: 0, gross: amount };
  }
  const totals = lineTotals(draft?.lines || []);
  return {
    net: totals.net.toFixed(2),
    vat: totals.vat.toFixed(2),
    gross: totals.gross.toFixed(2),
  };
}

function FieldControl({ label, error, children }) {
  return (
    <div>
      <Label className="text-xs font-semibold text-stone-600">{label}</Label>
      <div className="mt-1">{children}</div>
      {error ? <div className="mt-1 text-xs text-red-600">{error}</div> : null}
    </div>
  );
}

function ReadOnlyField({ label, value }) {
  return (
    <div>
      <Label className="text-xs font-semibold text-stone-600">{label}</Label>
      <div className="mt-1 min-h-9 rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-800">{value || "-"}</div>
    </div>
  );
}

function CustomerSelect({ customers, value, onChange }) {
  return (
    <div>
      <Label className="text-xs font-semibold text-stone-600">Customer</Label>
      <select value={value || ""} onChange={(e) => onChange(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-stone-200 bg-white px-3 text-sm shadow-sm">
        <option value="">Select customer</option>
        {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name || customer.business_name}</option>)}
      </select>
    </div>
  );
}

function AgedDebtorsTable({ rows = [] }) {
  return (
    <Panel title="Aged debtors">
      {rows.length === 0 ? <p className="py-10 text-center text-sm text-stone-500">No outstanding customer balances.</p> : (
        <div className="overflow-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500"><tr><th className="px-3 py-2">Customer</th><th className="px-3 py-2 text-right">Current</th><th className="px-3 py-2 text-right">1-30</th><th className="px-3 py-2 text-right">31-60</th><th className="px-3 py-2 text-right">61-90</th><th className="px-3 py-2 text-right">90+</th><th className="px-3 py-2 text-right">Total</th></tr></thead>
            <tbody>{rows.map((row) => <tr key={row.customer_id || row.customer_name} className="border-t border-stone-100"><td className="px-3 py-2 font-semibold">{row.customer_name}</td><td className="px-3 py-2 text-right">{formatMoney(row.current)}</td><td className="px-3 py-2 text-right">{formatMoney(row.days_1_30)}</td><td className="px-3 py-2 text-right">{formatMoney(row.days_31_60)}</td><td className="px-3 py-2 text-right">{formatMoney(row.days_61_90)}</td><td className="px-3 py-2 text-right">{formatMoney(row.days_90_plus)}</td><td className="px-3 py-2 text-right font-semibold">{formatMoney(row.total)}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function ArReports({ ar }) {
  const invoices = ar.invoices || [];
  const unpaid = invoices.filter((invoice) => Number(invoice.outstanding_amount || 0) > 0);
  const receipts = ar.receipts || [];
  const vat = invoices.reduce((sum, invoice) => sum + Number(invoice.vat_amount || 0), 0);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <SummaryCard label="Sales day book" value={invoices.length} tone="blue" />
        <SummaryCard label="Outstanding invoices" value={unpaid.length} tone="amber" />
        <SummaryCard label="VAT on sales" value={formatMoney(vat)} tone="emerald" />
        <SummaryCard label="Receipts" value={receipts.length} tone="stone" />
      </div>
      <RegisterPanel title="Outstanding invoices" rows={unpaid} numberKey="invoice_number" dateKey="invoice_date" amountKey="gross_amount" empty="No outstanding invoices." onOpen={() => {}} />
    </div>
  );
}

function exportRows(rows, filename) {
  const header = "Date,Type,Reference,Description,Invoice value,Paid / allocated,Invoice balance,Status,Attachment";
  const lines = rows.map((row) => [
    formatDate(row.date),
    row.type,
    row.reference,
    row.description,
    arInvoiceValue(row).toFixed(2),
    arAllocatedValue(row).toFixed(2),
    arInvoiceBalance(row).toFixed(2),
    row.status,
    hasAttachment(row) ? "Yes" : "No",
  ].map((value) => `"${String(value || "").replaceAll("\"", "\"\"")}"`).join(","));
  const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
