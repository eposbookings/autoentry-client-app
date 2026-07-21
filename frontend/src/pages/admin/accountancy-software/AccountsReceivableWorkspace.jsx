import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "@/lib/api";
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
  Field,
  Panel,
  SummaryCard,
  VatCodeSelect,
  canonicalVatCodeValue,
  formatDate,
  formatDateTime,
  formatMoney,
  statusBadgeClass,
  vatCodeOptionsFromWorkspace,
} from "./shared";

const arTabs = ["Dashboard", "Customers", "Settings"];
const customerRecordTabs = ["General", "Ledger", "Audit Trail"];
const transactionTypes = ["Sales Invoice", "Customer Credit Note", "Customer Receipt", "Receipt on Account"];
const editableStatuses = ["draft", "awaiting approval"];

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

function EditableField({ label, value, onChange, editable, type = "text", options, textarea }) {
  return (
    <div className={textarea ? "md:col-span-2" : ""}>
      <Label className="text-xs font-semibold text-stone-600">{label}</Label>
      {!editable ? (
        <DisplayValue value={value} />
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
  return type === "Customer Receipt" || type === "Receipt on Account";
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

function ledgerImpactFor(type) {
  if (isCreditDocument(type)) {
    return ["Debit sales nominal/VAT", "Credit debtors control"];
  }
  if (isReceiptDocument(type)) {
    return ["Debit bank", "Credit debtors control"];
  }
  return ["Debit debtors control", "Credit sales nominal", "Credit VAT control"];
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
    bank_account_code: bankAccountCode || "1200",
    payment_method: "Bank Transfer",
    allocation_target: isReceipt ? "oldest" : "",
    invoice_id: "",
    lines: isReceipt ? [] : [{ ...emptyArLine, nominal_account_code: customer?.default_sales_account || "4000", vat_code: customer?.default_vat_code || "" }],
    showImpact: true,
    showAudit: false,
  };
}

export default function AccountsReceivableWorkspace({ workspace, tab, reloadWorkspace, busy }) {
  const ar = workspace.accounts_receivable || {};
  const clientId = workspace.client?.id;
  const customers = useMemo(() => (Array.isArray(ar.customers) ? ar.customers : []), [ar.customers]);
  const invoices = useMemo(() => (Array.isArray(ar.invoices) ? ar.invoices : []), [ar.invoices]);
  const creditNotes = useMemo(() => (Array.isArray(ar.credit_notes) ? ar.credit_notes : []), [ar.credit_notes]);
  const receipts = useMemo(() => (Array.isArray(ar.receipts) ? ar.receipts : []), [ar.receipts]);
  const accounts = useMemo(() => (Array.isArray(workspace.accounts) ? workspace.accounts : []), [workspace.accounts]);
  const auditTrail = useMemo(() => {
    if (Array.isArray(ar.audit_trail)) return ar.audit_trail;
    if (Array.isArray(workspace.audit_trail)) return workspace.audit_trail;
    return [];
  }, [ar.audit_trail, workspace.audit_trail]);
  const bankAccounts = useMemo(() => accounts.filter((account) => account.purpose === "Bank Account" || account.account_type === "Bank"), [accounts]);
  const incomeAccounts = useMemo(() => accounts.filter((account) => account.category === "Income" || account.account_type === "Sales"), [accounts]);
  const vatCodes = useMemo(() => vatCodeOptionsFromWorkspace(workspace), [workspace]);
  const activeTab = arTabs.includes(tab) ? tab : "Dashboard";

  const [saving, setSaving] = useState(false);
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerForm, setCustomerForm] = useState(emptyCustomerForm);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [customerRecordTab, setCustomerRecordTab] = useState("Ledger");
  const [customerEditMode, setCustomerEditMode] = useState(false);
  const [customerDraft, setCustomerDraft] = useState(normaliseCustomerDraft());
  const [transactionDraft, setTransactionDraft] = useState(null);
  const [transactionErrors, setTransactionErrors] = useState({});
  const [ledgerSearch, setLedgerSearch] = useState("");
  const [ledgerTypeFilter, setLedgerTypeFilter] = useState("All");
  const [ledgerStatusFilter, setLedgerStatusFilter] = useState("All");
  const [ledgerDateFrom, setLedgerDateFrom] = useState("");
  const [ledgerDateTo, setLedgerDateTo] = useState("");
  const [auditSearch, setAuditSearch] = useState("");
  const [settingsForm, setSettingsForm] = useState(ar.settings || {});
  const [statementCustomerId, setStatementCustomerId] = useState("");

  useEffect(() => {
    setSettingsForm(ar.settings || {});
  }, [ar.settings]);

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

  async function createCustomer(e) {
    e.preventDefault();
    if (!customerForm.business_name.trim()) return toast.error("Customer name is required");
    if (requiresVatOptions(customerForm.default_vat_code, vatCodes)) return toast.error("Native VAT code list is unavailable. Clear the VAT code or load EPOS Native VAT Codes before saving.");
    await run(async () => postJson("/ar/customers", normaliseVatPayload(customerForm, vatCodes)), "Customer created");
    setCustomerForm(emptyCustomerForm);
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

  const customerLedgerRows = useCallback((customerId) => {
    const rows = [
      ...invoices.filter((invoice) => invoice.customer_id === customerId).map((invoice) => ({
        id: invoice.id,
        ledgerKey: `invoice-${invoice.id}`,
        source: "invoice",
        customer_id: customerId,
        date: invoice.invoice_date || invoice.date || invoice.created_at,
        type: "Sales Invoice",
        reference: invoice.invoice_number || invoice.reference || "-",
        description: invoice.description || invoice.customer_name || "Sales invoice",
        status: invoice.status || "Posted",
        debit: asNumber(invoice.gross_amount || invoice.total || invoice.amount),
        credit: 0,
        outstanding: asNumber(invoice.outstanding_amount),
        raw: invoice,
      })),
      ...creditNotes.filter((note) => note.customer_id === customerId).map((note) => ({
        id: note.id,
        ledgerKey: `credit-note-${note.id}`,
        source: "credit_note",
        customer_id: customerId,
        date: note.credit_note_date || note.date || note.created_at,
        type: "Customer Credit Note",
        reference: note.credit_note_number || note.reference || "-",
        description: note.description || "Customer credit note",
        status: note.status || "Posted",
        debit: 0,
        credit: asNumber(note.gross_amount || note.total || note.amount),
        outstanding: asNumber(note.unallocated_amount),
        raw: note,
      })),
      ...receipts.filter((receipt) => receipt.customer_id === customerId).map((receipt) => ({
        id: receipt.id,
        ledgerKey: `receipt-${receipt.id}`,
        source: "receipt",
        customer_id: customerId,
        date: receipt.receipt_date || receipt.date || receipt.created_at,
        type: receipt.invoice_id ? "Customer Receipt" : "Receipt on Account",
        reference: receipt.reference || receipt.payment_reference || "-",
        description: receipt.description || "Customer receipt",
        status: receipt.status || (receipt.invoice_id ? "Allocated" : "Open"),
        debit: 0,
        credit: asNumber(receipt.amount || receipt.gross_amount),
        outstanding: asNumber(receipt.unallocated_amount),
        raw: receipt,
      })),
    ].sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
    let runningBalance = 0;
    return rows.map((row) => {
      runningBalance += row.debit - row.credit;
      return { ...row, runningBalance };
    });
  }, [creditNotes, invoices, receipts]);

  const selectedLedgerRows = useMemo(() => selectedCustomer ? customerLedgerRows(selectedCustomer.id) : [], [customerLedgerRows, selectedCustomer]);
  const visibleLedgerRows = useMemo(() => selectedLedgerRows.filter((row) => {
    const typeOk = ledgerTypeFilter === "All" || row.type === ledgerTypeFilter;
    const statusOk = ledgerStatusFilter === "All" || row.status === ledgerStatusFilter;
    const rowDate = toInputDate(row.date);
    const fromOk = !ledgerDateFrom || rowDate >= ledgerDateFrom;
    const toOk = !ledgerDateTo || rowDate <= ledgerDateTo;
    const needle = ledgerSearch.trim().toLowerCase();
    const searchOk = !needle || `${row.type} ${row.reference} ${row.description} ${row.status}`.toLowerCase().includes(needle);
    return typeOk && statusOk && fromOk && toOk && searchOk;
  }), [ledgerDateFrom, ledgerDateTo, ledgerSearch, ledgerStatusFilter, ledgerTypeFilter, selectedLedgerRows]);

  const ledgerStatuses = useMemo(() => ["All", ...Array.from(new Set(selectedLedgerRows.map((row) => row.status).filter(Boolean)))], [selectedLedgerRows]);
  const ledgerTotals = useMemo(() => visibleLedgerRows.reduce((totals, row) => ({
    debit: totals.debit + asNumber(row.debit),
    credit: totals.credit + asNumber(row.credit),
  }), { debit: 0, credit: 0 }), [visibleLedgerRows]);
  const ledgerClosingBalance = visibleLedgerRows.length ? visibleLedgerRows[visibleLedgerRows.length - 1].runningBalance : 0;

  const visibleCustomers = useMemo(() => customers.filter((customer) => {
    const needle = customerQuery.trim().toLowerCase();
    if (!needle) return true;
    return `${customer.name || ""} ${customer.business_name || ""} ${customer.trading_name || ""} ${customer.customer_code || ""} ${customer.email || ""}`.toLowerCase().includes(needle);
  }), [customerQuery, customers]);

  function openTransaction(type, row) {
    setTransactionErrors({});
    const customer = selectedCustomer || customers.find((item) => item.id === row?.customer_id);
    const next = emptyTransactionDraft(type || row?.type || "Sales Invoice", customer, bankAccounts[0]?.code);
    const raw = row?.raw || row || {};
    const gross = raw.gross_amount || raw.amount || row?.debit || row?.credit || "";
    setTransactionDraft({
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
    });
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
      vat_code: canonicalVatCodeValue(transactionDraft.vat_code, vatCodes),
      lines: normaliseLineVatPayload(transactionDraft.lines, vatCodes),
    };
    const saved = await run(async () => {
      const { data } = await postJson("/ar/invoices", payload);
      if (approve && data?.id) await postJson(`/ar/invoices/${data.id}/approve`, {});
    }, approve ? "Sales invoice approved" : "Sales invoice draft saved");
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
      vat_code: canonicalVatCodeValue(transactionDraft.vat_code, vatCodes),
      lines: normaliseLineVatPayload(transactionDraft.lines, vatCodes),
    };
    const saved = await run(async () => {
      const { data } = await postJson("/ar/credit-notes", payload);
      if (post && data?.id) await postJson(`/ar/credit-notes/${data.id}/post`, {});
    }, post ? "Customer credit note posted" : "Customer credit note draft saved");
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

  async function saveSettings(e) {
    e.preventDefault();
    if (requiresVatOptions(settingsForm.default_vat_code, vatCodes)) return toast.error("Native VAT code list is unavailable. Clear the VAT code or load EPOS Native VAT Codes before saving.");
    await run(async () => putJson("/ar/settings", normaliseVatPayload(settingsForm, vatCodes)), "Accounts Receivable settings saved");
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
    if (realRows.length) return realRows;
    return selectedLedgerRows.map((row) => ({
      id: `${row.source}-${row.id}`,
      date: row.date,
      user: "System",
      action: `${row.type} recorded`,
      description: `${row.reference} - ${row.description}`,
    }));
  }, [auditTrail, selectedCustomer, selectedLedgerRows]);

  if (activeTab === "Dashboard" && !selectedCustomer) {
    const dashboard = ar.dashboard || {};
    const overdueCustomerIds = new Set(invoices.filter((invoice) => String(invoice.status || "").toLowerCase() === "overdue" || (invoice.due_date && toInputDate(invoice.due_date) < todayInput() && asNumber(invoice.outstanding_amount) > 0)).map((invoice) => invoice.customer_id));
    const awaitingInvoiceCustomerIds = new Set(invoices.filter((invoice) => ["draft", "awaiting_approval", "awaiting approval"].includes(String(invoice.status || "").toLowerCase())).map((invoice) => invoice.customer_id));
    const totalReceiptsOnAccount = receipts.reduce((sum, receipt) => sum + asNumber(receipt.unallocated_amount || (!receipt.invoice_id ? receipt.amount : 0)), 0);
    const recentCustomerActivity = customers
      .map((customer) => ({ customer, rows: customerLedgerRows(customer.id) }))
      .filter((entry) => entry.rows.length)
      .sort((a, b) => new Date(b.rows[b.rows.length - 1].date || 0) - new Date(a.rows[a.rows.length - 1].date || 0))
      .slice(0, 6);
    return (
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-5">
          <SummaryCard label="Outstanding customer balances" value={formatMoney(dashboard.outstanding_total || workspace.summary?.ar_outstanding || workspace.summary?.receivables || 0)} tone="amber" />
          <SummaryCard label="Receipts on account" value={formatMoney(totalReceiptsOnAccount)} tone="blue" />
          <SummaryCard label="Awaiting invoices / drafts" value={awaitingInvoiceCustomerIds.size} tone="stone" />
          <SummaryCard label="Overdue customers" value={overdueCustomerIds.size} tone="amber" />
          <SummaryCard label="Customers" value={customers.length} tone="emerald" />
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <Panel title="Customer balances">
            <div className="grid gap-3 md:grid-cols-2">
              {visibleCustomers.slice(0, 6).map((customer) => (
                <CustomerCard
                  key={customer.id}
                  customer={customer}
                  outstanding={customer.outstanding_balance ?? customer.current_balance ?? 0}
                  receiptsOnAccount={receipts.filter((receipt) => receipt.customer_id === customer.id).reduce((sum, receipt) => sum + asNumber(receipt.unallocated_amount || (!receipt.invoice_id ? receipt.amount : 0)), 0)}
                  lastActivity={customerLedgerRows(customer.id).at(-1)?.date}
                  onOpen={() => setSelectedCustomerId(customer.id)}
                />
              ))}
              {!visibleCustomers.length ? <div className="rounded-md border border-dashed border-stone-200 py-10 text-center text-sm text-stone-500 md:col-span-2">No customers found.</div> : null}
            </div>
          </Panel>
          <Panel title="Recent customer activity">
            <div className="space-y-2">
              {recentCustomerActivity.length ? recentCustomerActivity.map(({ customer, rows }) => (
                <button key={customer.id} type="button" onClick={() => setSelectedCustomerId(customer.id)} className="flex w-full items-center justify-between rounded-md border border-stone-200 bg-white px-3 py-2 text-left text-sm hover:border-emerald-300">
                  <span>
                    <span className="block font-semibold text-stone-900">{customer.name || customer.business_name}</span>
                    <span className="text-stone-500">Last activity {formatDate(rows[rows.length - 1].date)}</span>
                  </span>
                  <Badge className={statusBadgeClass(customer.status || "active")}>{customer.status || "Active"}</Badge>
                </button>
              )) : <div className="py-8 text-center text-sm text-stone-500">No customer activity yet.</div>}
            </div>
          </Panel>
        </div>
      </div>
    );
  }

  if (activeTab === "Customers" || (activeTab === "Dashboard" && selectedCustomer)) {
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
                <SummaryCard label="Visible transactions" value={visibleLedgerRows.length} />
                <SummaryCard label="Debit" value={formatMoney(ledgerTotals.debit)} />
                <SummaryCard label="Credit" value={formatMoney(ledgerTotals.credit)} />
                <SummaryCard label="Closing balance" value={formatMoney(ledgerClosingBalance)} />
              </div>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={() => openTransaction("Sales Invoice")}>
                    <Plus className="mr-2 h-4 w-4" /> Add sales invoice
                  </Button>
                  <Button type="button" variant="outline" onClick={() => openTransaction("Customer Credit Note")}>
                    <Plus className="mr-2 h-4 w-4" /> Add customer credit note
                  </Button>
                  <Button type="button" variant="outline" onClick={() => openTransaction("Customer Receipt")}>
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
              <LedgerTable rows={visibleLedgerRows} onOpen={(row) => openTransaction(row.type, row)} totals={ledgerTotals} closingBalance={ledgerClosingBalance} />
            </Panel>
          ) : null}

          {customerRecordTab === "Audit Trail" ? (
            <Panel title="Customer audit trail">
              <div className="mb-3 relative max-w-lg">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-stone-400" />
                <Input value={auditSearch} onChange={(e) => setAuditSearch(e.target.value)} placeholder="Search audit trail" className="h-9 pl-9" />
              </div>
              <AuditTable rows={customerAuditRows.filter((row) => `${row.date} ${row.user} ${row.action} ${row.description}`.toLowerCase().includes(auditSearch.trim().toLowerCase()))} />
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
              saving={saving || busy}
            />
          ) : null}
        </div>
      );
    }

    return (
      <div className="grid gap-4 xl:grid-cols-[1fr_390px]">
        <Panel title="Customer master file">
          <Input className="mb-3 h-9" value={customerQuery} onChange={(e) => setCustomerQuery(e.target.value)} placeholder="Search customers by name, code or email" />
          <div className="grid gap-3 md:grid-cols-2">
            {visibleCustomers.map((customer) => (
              <CustomerCard
                key={customer.id}
                customer={customer}
                outstanding={customer.outstanding_balance ?? customer.current_balance ?? 0}
                receiptsOnAccount={receipts.filter((receipt) => receipt.customer_id === customer.id).reduce((sum, receipt) => sum + asNumber(receipt.unallocated_amount || (!receipt.invoice_id ? receipt.amount : 0)), 0)}
                lastActivity={customerLedgerRows(customer.id).at(-1)?.date}
                onOpen={() => setSelectedCustomerId(customer.id)}
              />
            ))}
            {!visibleCustomers.length ? <div className="rounded-md border border-dashed border-stone-200 py-10 text-center text-sm text-stone-500 md:col-span-2">No customers found.</div> : null}
          </div>
        </Panel>
        <Panel title="Create customer">
          <form onSubmit={createCustomer} className="space-y-3">
            <Field label="Customer name" value={customerForm.business_name} onChange={(value) => setCustomerForm((current) => ({ ...current, business_name: value }))} />
            <div className="grid grid-cols-2 gap-2">
              <Field label="Customer code" value={customerForm.customer_code} onChange={(value) => setCustomerForm((current) => ({ ...current, customer_code: value }))} />
              <Field label="Payment terms" value={customerForm.payment_terms_days} onChange={(value) => setCustomerForm((current) => ({ ...current, payment_terms_days: value }))} />
            </div>
            <Field label="Trading name" value={customerForm.trading_name} onChange={(value) => setCustomerForm((current) => ({ ...current, trading_name: value }))} />
            <Field label="Email" type="email" value={customerForm.email} onChange={(value) => setCustomerForm((current) => ({ ...current, email: value }))} />
            <div className="grid grid-cols-2 gap-2">
              <Field label="Phone" value={customerForm.phone} onChange={(value) => setCustomerForm((current) => ({ ...current, phone: value }))} />
              <Field label="Website" value={customerForm.website} onChange={(value) => setCustomerForm((current) => ({ ...current, website: value }))} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Company number" value={customerForm.company_number} onChange={(value) => setCustomerForm((current) => ({ ...current, company_number: value }))} />
              <Field label="VAT number" value={customerForm.vat_number} onChange={(value) => setCustomerForm((current) => ({ ...current, vat_number: value }))} />
            </div>
            <AccountCodeSelect label="Default sales nominal" accounts={incomeAccounts} value={customerForm.default_sales_account} onChange={(value) => setCustomerForm((current) => ({ ...current, default_sales_account: value }))} />
            <div className="grid grid-cols-2 gap-2">
              <VatCodeSelect label="Default VAT code" value={customerForm.default_vat_code} options={vatCodes} onChange={(value) => setCustomerForm((current) => ({ ...current, default_vat_code: value }))} />
              <Field label="Credit limit" value={customerForm.credit_limit} onChange={(value) => setCustomerForm((current) => ({ ...current, credit_limit: value }))} />
            </div>
            <Button disabled={busy || saving} className="w-full gap-2" style={{ background: "var(--brand)" }}><Plus className="h-4 w-4" /> Create customer</Button>
          </form>
        </Panel>
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
    return <RegisterPanel title="Customer receipts" rows={receipts} numberKey="reference" dateKey="receipt_date" amountKey="amount" empty="No customer receipts yet." customerOpen={setSelectedCustomerId} onOpen={(row) => { setSelectedCustomerId(row.customer_id); openTransaction("Customer Receipt", { ...row, type: "Customer Receipt", source: "receipt", raw: row }); }} />;
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

  if (activeTab === "Settings") {
    return (
      <Panel title="Accounts Receivable settings">
        <form onSubmit={saveSettings} className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="flex items-center gap-2 rounded-md border border-stone-200 p-3 text-sm font-semibold text-stone-700"><input type="checkbox" checked={!!settingsForm.approval_required} onChange={(e) => setSettingsForm((current) => ({ ...current, approval_required: e.target.checked }))} /> Approval required</label>
          <label className="flex items-center gap-2 rounded-md border border-stone-200 p-3 text-sm font-semibold text-stone-700"><input type="checkbox" checked={!!settingsForm.duplicate_invoice_warning} onChange={(e) => setSettingsForm((current) => ({ ...current, duplicate_invoice_warning: e.target.checked }))} /> Duplicate invoice warning</label>
          <label className="flex items-center gap-2 rounded-md border border-stone-200 p-3 text-sm font-semibold text-stone-700"><input type="checkbox" checked={!!settingsForm.credit_limit_warnings} onChange={(e) => setSettingsForm((current) => ({ ...current, credit_limit_warnings: e.target.checked }))} /> Credit limit warnings</label>
          <label className="flex items-center gap-2 rounded-md border border-stone-200 p-3 text-sm font-semibold text-stone-700"><input type="checkbox" checked={!!settingsForm.automatic_customer_numbering} onChange={(e) => setSettingsForm((current) => ({ ...current, automatic_customer_numbering: e.target.checked }))} /> Automatic customer numbering</label>
          <Field label="Default terms days" value={settingsForm.default_payment_terms_days} onChange={(value) => setSettingsForm((current) => ({ ...current, default_payment_terms_days: value }))} />
          <AccountCodeSelect label="Default sales nominal" accounts={incomeAccounts} value={settingsForm.default_sales_account} onChange={(value) => setSettingsForm((current) => ({ ...current, default_sales_account: value }))} />
          <VatCodeSelect label="Default VAT code" value={settingsForm.default_vat_code} options={vatCodes} onChange={(value) => setSettingsForm((current) => ({ ...current, default_vat_code: value }))} />
          <Field label="Invoice prefix" value={settingsForm.invoice_number_prefix} onChange={(value) => setSettingsForm((current) => ({ ...current, invoice_number_prefix: value }))} />
          <Field label="Next invoice number" value={settingsForm.next_invoice_number} onChange={(value) => setSettingsForm((current) => ({ ...current, next_invoice_number: value }))} />
          <div className="md:col-span-2 xl:col-span-4"><Button disabled={busy || saving} style={{ background: "var(--brand)" }}>Save AR settings</Button></div>
        </form>
      </Panel>
    );
  }

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

function LedgerTable({ rows, onOpen, totals, closingBalance }) {
  return (
    <div className="overflow-hidden rounded-md border border-stone-200">
      <table className="w-full text-sm">
        <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
          <tr>
            <th className="px-3 py-2 text-left">Date</th>
            <th className="px-3 py-2 text-left">Type</th>
            <th className="px-3 py-2 text-left">Reference</th>
            <th className="px-3 py-2 text-left">Description</th>
            <th className="px-3 py-2 text-right">Debit</th>
            <th className="px-3 py-2 text-right">Credit</th>
            <th className="px-3 py-2 text-right">Running Balance</th>
            <th className="px-3 py-2 text-left">Status</th>
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
              <td className="px-3 py-2 text-right">{row.debit ? formatMoney(row.debit) : "-"}</td>
              <td className="px-3 py-2 text-right">{row.credit ? formatMoney(row.credit) : "-"}</td>
              <td className="px-3 py-2 text-right font-semibold">{formatMoney(row.runningBalance)}</td>
              <td className="px-3 py-2"><Badge className={statusBadgeClass(row.status)}>{row.status || "Open"}</Badge></td>
            </tr>
          )) : (
            <tr><td colSpan="8" className="px-3 py-10 text-center text-stone-500">No customer ledger activity yet.</td></tr>
          )}
        </tbody>
        {totals && rows.length ? (
          <tfoot className="border-t border-stone-200 bg-stone-50 text-sm font-semibold">
            <tr>
              <td colSpan="4" className="px-3 py-2 text-right">Visible total</td>
              <td className="px-3 py-2 text-right">{formatMoney(totals.debit)}</td>
              <td className="px-3 py-2 text-right">{formatMoney(totals.credit)}</td>
              <td className="px-3 py-2 text-right">{formatMoney(closingBalance)}</td>
              <td className="px-3 py-2" />
            </tr>
          </tfoot>
        ) : null}
      </table>
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

function ManualSalesDocumentDrawer({ draft, setDraft, errors, customer, customers, invoices, incomeAccounts, vatCodes, bankAccounts, onClose, onSave, onPost, onApproveInvoice, onPostInvoice, onArchiveInvoice, saving }) {
  const readOnly = isReadOnlyTransaction(draft);
  const existingLedgerRecord = !!draft.originalKey && draft.source !== "frontend";
  const formReadOnly = readOnly || existingLedgerRecord;
  const isReceipt = isReceiptDocument(draft.type);
  const isCredit = isCreditDocument(draft.type);
  const totals = transactionTotals(draft);
  const impact = ledgerImpactFor(draft.type);
  const customerInvoices = invoices.filter((invoice) => invoice.customer_id === draft.customer_id && Number(invoice.outstanding_amount || 0) > 0);
  const set = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  const setLine = (index, key, value) => setDraft((current) => ({ ...current, lines: current.lines.map((line, lineIndex) => lineIndex === index ? { ...line, [key]: value } : line) }));
  const existingInvoiceStatus = String(draft.status || "").toLowerCase();
  const canApproveExistingInvoice = draft.source === "invoice" && !draft.posted_journal_id && ["draft", "awaiting_approval"].includes(existingInvoiceStatus);
  const canPostExistingInvoice = draft.source === "invoice" && !draft.posted_journal_id && existingInvoiceStatus === "approved";
  const canArchiveExistingInvoice = draft.source === "invoice" && ["posted", "paid", "part_paid"].includes(String(draft.status || "").toLowerCase());

  return (
    <div className="fixed inset-y-0 right-0 z-40 w-full max-w-[1180px] overflow-hidden border-l border-stone-200 bg-white shadow-2xl">
      <div className="flex h-full min-h-0 flex-col">
        <header className="border-b border-stone-200 bg-stone-50 px-4 py-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-display text-lg font-semibold text-stone-900">{customer?.name || customer?.business_name || draft.customer_name || "Customer"}</h3>
                <Badge variant="secondary">{customer?.customer_code || draft.customer_code || "No customer code"}</Badge>
                <Badge className={statusBadgeClass(draft.status)}>{draft.status || "Draft"}</Badge>
              </div>
              <p className="mt-1 text-sm text-stone-500">
                Manual Accounts Receivable sales document entry. Customer is locked from the open customer account.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {draft.originalKey ? <Button type="button" variant="outline" onClick={() => set("showImpact", !draft.showImpact)}>View ledger impact</Button> : null}
              {draft.originalKey ? <Button type="button" variant="outline" onClick={() => set("showAudit", !draft.showAudit)}>View audit trail</Button> : null}
              <Button type="button" variant="outline" onClick={onClose}>Cancel / close</Button>
              {!formReadOnly && !isReceipt ? <Button type="button" variant="outline" disabled={saving} onClick={(event) => onSave(event)}>Save draft</Button> : null}
              {!formReadOnly ? <Button type="button" disabled={saving} onClick={onPost} style={{ background: "var(--brand)" }}>{isReceipt ? "Post receipt" : isCredit ? "Post credit note" : "Approve"}</Button> : null}
              {canApproveExistingInvoice ? <Button type="button" disabled={saving} onClick={() => onApproveInvoice(draft)} style={{ background: "var(--brand)" }}>Approve</Button> : null}
              {canPostExistingInvoice ? <Button type="button" disabled={saving} onClick={() => onPostInvoice(draft)} style={{ background: "var(--brand)" }}>Post</Button> : null}
              {canArchiveExistingInvoice ? <Button type="button" variant="outline" disabled={saving} onClick={() => onArchiveInvoice(draft)}>Archive</Button> : null}
              <Button type="button" variant="outline" size="sm" onClick={onClose}><X className="h-4 w-4" /></Button>
            </div>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[minmax(620px,1fr)_380px]">
          <form onSubmit={onSave} className="min-h-0 overflow-auto p-4">
            {readOnly ? <div className="mb-3 rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-600">Posted, paid, part-paid, allocated and archived customer ledger records are view only. Corrections should be entered as a customer credit note or receipt allocation flow.</div> : null}
            {existingLedgerRecord && !readOnly ? <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">Editing existing Accounts Receivable records is unavailable until backend update endpoints are added. Available workflow actions remain enabled.</div> : null}
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
                      <FieldControl label="Currency"><Input value={draft.currency || ""} disabled={formReadOnly} onChange={(e) => set("currency", e.target.value)} className="h-9" /></FieldControl>
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
              </Section>
              {!isReceipt ? (
                <Section title="Line items">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    {errors.lines ? <div className="text-xs font-medium text-red-600">{errors.lines}</div> : <span />}
                    {!formReadOnly ? <Button type="button" variant="outline" size="sm" onClick={() => setDraft((current) => ({ ...current, lines: [...current.lines, { ...emptyArLine, nominal_account_code: draft.sales_nominal, vat_code: draft.vat_code }] }))}>Add line item</Button> : null}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[900px] text-xs">
                      <thead className="border-b border-stone-200 text-left text-[10px] uppercase tracking-wider text-stone-500">
                        <tr>
                          <th className="py-1 pr-1.5">Description</th>
                          <th className="py-1 pr-1.5">Sales nominal/account code</th>
                          <th className="py-1 pr-1.5">VAT code</th>
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
                            <td className="py-0.5 pr-1.5"><Input value={line.description || ""} readOnly={formReadOnly} onChange={(e) => setLine(index, "description", e.target.value)} className="h-7 min-w-40 px-1.5 text-xs" /></td>
                            <td className="py-0.5 pr-1.5">
                              <select value={line.nominal_account_code || ""} disabled={formReadOnly} onChange={(e) => setLine(index, "nominal_account_code", e.target.value)} className="h-7 min-w-32 rounded-md border border-stone-200 bg-white px-1.5 text-xs disabled:bg-stone-50">
                                <option value="">Select</option>
                                {incomeAccounts.map((account) => <option key={account.code} value={account.code}>{account.code} - {account.name}</option>)}
                              </select>
                            </td>
                            <td className="py-0.5 pr-1.5"><VatCodeSelect label="" value={line.vat_code || ""} options={vatCodes} disabled={formReadOnly} compact onChange={(value) => setLine(index, "vat_code", value)} /></td>
                            <td className="py-0.5 pr-1.5"><Input type="number" step="0.01" value={line.quantity || ""} readOnly={formReadOnly} onChange={(e) => setLine(index, "quantity", e.target.value)} className="h-7 min-w-20 px-1.5 text-xs" /></td>
                            <td className="py-0.5 pr-1.5"><Input type="number" step="0.01" value={line.unit_price || ""} readOnly={formReadOnly} onChange={(e) => setLine(index, "unit_price", e.target.value)} className="h-7 min-w-20 px-1.5 text-xs" /></td>
                            <td className="py-0.5 pr-1.5"><Input type="number" step="0.01" value={line.net_amount || ""} readOnly={formReadOnly} onChange={(e) => setLine(index, "net_amount", e.target.value)} className="h-7 min-w-20 px-1.5 text-xs" /></td>
                            <td className="py-0.5 pr-1.5"><Input type="number" step="0.01" value={line.vat_amount || ""} readOnly={formReadOnly} onChange={(e) => setLine(index, "vat_amount", e.target.value)} className="h-7 min-w-20 px-1.5 text-xs" /></td>
                            <td className="py-0.5 pr-1.5"><Input type="number" step="0.01" value={line.gross_amount || ""} readOnly={formReadOnly} onChange={(e) => setLine(index, "gross_amount", e.target.value)} className="h-7 min-w-20 px-1.5 text-xs" /></td>
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
            <Section title="Optional attachment preview">
              <div className="flex min-h-56 items-center justify-center rounded-md border border-dashed border-stone-300 bg-stone-50 p-4 text-center text-sm text-stone-500">
                {draft.attachment_name || "No attachment linked to this manual AR entry"}
              </div>
            </Section>
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
            {draft.showAudit ? <Section title="Audit trail"><div className="mt-2 space-y-1 text-sm text-stone-600"><div>Opened from customer ledger</div><div>Status: {draft.status || "Draft"}</div><div>Source: {draft.source === "frontend" ? "Manual AR entry" : "Accounts Receivable ledger"}</div></div></Section> : null}
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
  const header = "Date,Type,Reference,Status,Debit,Credit,Running Balance,Outstanding";
  const lines = rows.map((row) => [
    formatDate(row.date),
    row.type,
    row.reference,
    row.status,
    asNumber(row.debit).toFixed(2),
    asNumber(row.credit).toFixed(2),
    asNumber(row.runningBalance).toFixed(2),
    asNumber(row.outstanding).toFixed(2),
  ].map((value) => `"${String(value || "").replaceAll("\"", "\"\"")}"`).join(","));
  const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
