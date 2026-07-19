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
  Panel,
  SummaryCard,
  formatDate,
  formatDateTime,
  formatMoney,
  statusBadgeClass,
} from "./shared";

const apTabs = ["Dashboard", "Suppliers"];
const supplierRecordTabs = ["General", "Ledger", "Audit Trail"];
const transactionTypes = ["Purchase Invoice", "Supplier Credit Note", "Supplier Payment", "Payment on Account"];
const statusOptions = ["Draft", "Posted", "Approved", "Paid", "Allocated", "Open"];

const emptySupplierForm = {
  name: "",
  supplier_code: "",
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

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
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

function isReadOnlyTransaction(draft) {
  return !["draft", "awaiting approval"].includes(String(draft?.status || "Draft").toLowerCase());
}

function transactionLineTotals(lines = []) {
  return lines.reduce((totals, line) => {
    totals.net += asNumber(line.net);
    totals.vat += asNumber(line.vat);
    totals.gross += asNumber(line.gross);
    return totals;
  }, { net: 0, vat: 0, gross: 0 });
}

function ledgerImpactFor(type) {
  if (isCreditDocument(type)) {
    return {
      debit: "Debit creditors control",
      credit: "Credit purchase nominal/VAT",
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
    <section className="rounded-md border border-stone-200 bg-white p-3">
      <h4 className="mb-3 text-sm font-semibold text-stone-900">{title}</h4>
      {children}
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

function AccountsPayableWorkspace({ workspace, tab, reloadWorkspace, busy }) {
  const ap = workspace.accounts_payable || {};
  const clientId = workspace.client?.id;
  const suppliers = useMemo(() => (Array.isArray(ap.suppliers) ? ap.suppliers : []), [ap.suppliers]);
  const invoices = useMemo(() => (Array.isArray(ap.invoices) ? ap.invoices : []), [ap.invoices]);
  const creditNotes = useMemo(() => (Array.isArray(ap.credit_notes) ? ap.credit_notes : []), [ap.credit_notes]);
  const payments = useMemo(() => (Array.isArray(ap.payments) ? ap.payments : []), [ap.payments]);
  const expenses = useMemo(() => (Array.isArray(ap.expenses) ? ap.expenses : []), [ap.expenses]);
  const accounts = useMemo(() => (Array.isArray(workspace.accounts) ? workspace.accounts : []), [workspace.accounts]);
  const auditTrail = useMemo(() => {
    if (Array.isArray(ap.audit_trail)) return ap.audit_trail;
    if (Array.isArray(workspace.audit_trail)) return workspace.audit_trail;
    return [];
  }, [ap.audit_trail, workspace.audit_trail]);
  const bankAccounts = useMemo(() => accounts.filter((account) => account.purpose === "Bank Account" || account.account_type === "Bank"), [accounts]);
  const expenseAccounts = useMemo(() => accounts.filter((account) => account.category === "Expense" || account.account_type === "Purchases" || account.account_type === "Overheads"), [accounts]);
  const activeTab = apTabs.includes(tab) ? tab : "Dashboard";

  const [saving, setSaving] = useState(false);
  const [supplierQuery, setSupplierQuery] = useState("");
  const [supplierForm, setSupplierForm] = useState(emptySupplierForm);
  const [settingsForm, setSettingsForm] = useState(ap.settings || {});
  const [selectedSupplierId, setSelectedSupplierId] = useState("");
  const [supplierRecordTab, setSupplierRecordTab] = useState("Ledger");
  const [supplierEditMode, setSupplierEditMode] = useState(false);
  const [supplierDraft, setSupplierDraft] = useState(normaliseSupplierDraft());
  const [ledgerSearch, setLedgerSearch] = useState("");
  const [ledgerTypeFilter, setLedgerTypeFilter] = useState("All");
  const [ledgerStatusFilter, setLedgerStatusFilter] = useState("All");
  const [ledgerDateFrom, setLedgerDateFrom] = useState("");
  const [ledgerDateTo, setLedgerDateTo] = useState("");
  const [ledgerDraftRows, setLedgerDraftRows] = useState([]);
  const [transactionDraft, setTransactionDraft] = useState(null);
  const [transactionErrors, setTransactionErrors] = useState({});
  const [auditSearch, setAuditSearch] = useState("");
  const [auditActionFilter, setAuditActionFilter] = useState("All");

  useEffect(() => {
    setSettingsForm(ap.settings || {});
  }, [ap.settings]);

  useEffect(() => {
    if (selectedSupplierId && !suppliers.some((supplier) => supplier.id === selectedSupplierId)) {
      setSelectedSupplierId("");
      setTransactionDraft(null);
    }
  }, [selectedSupplierId, suppliers]);

  const selectedSupplier = suppliers.find((supplier) => supplier.id === selectedSupplierId);

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

  async function createSupplier(e) {
    e.preventDefault();
    if (!supplierForm.name.trim()) return toast.error("Supplier name is required");
    await run(async () => postJson("/ap/suppliers", supplierForm), "Supplier created");
    setSupplierForm(emptySupplierForm);
  }

  function supplierById(id) {
    return suppliers.find((supplier) => supplier.id === id);
  }

  function supplierPaymentOnAccount(supplierId) {
    return payments
      .filter((payment) => payment.supplier_id === supplierId && !payment.invoice_id)
      .reduce((sum, payment) => sum + asNumber(payment.amount || payment.gross_amount), 0);
  }

  const supplierLedgerRows = useCallback((supplierId) => {
    const baseRows = [
      ...invoices
        .filter((invoice) => invoice.supplier_id === supplierId)
        .map((invoice) => ({
          id: invoice.id,
          ledgerKey: `invoice-${invoice.id}`,
          supplier_id: supplierId,
          source: "invoice",
          date: invoice.invoice_date || invoice.date || invoice.created_at,
          type: "Purchase Invoice",
          reference: invoice.invoice_number || invoice.reference || "-",
          description: invoice.description || invoice.supplier_name || "Purchase invoice",
          debit: 0,
          credit: asNumber(invoice.gross_amount || invoice.total || invoice.amount),
          status: invoice.status || "Posted",
        })),
      ...creditNotes
        .filter((note) => note.supplier_id === supplierId)
        .map((note) => ({
          id: note.id,
          ledgerKey: `credit-note-${note.id}`,
          supplier_id: supplierId,
          source: "credit_note",
          date: note.credit_note_date || note.date || note.created_at,
          type: "Supplier Credit Note",
          reference: note.credit_note_number || note.reference || "-",
          description: note.description || "Supplier credit note",
          debit: asNumber(note.gross_amount || note.total || note.amount),
          credit: 0,
          status: note.status || "Posted",
        })),
      ...payments
        .filter((payment) => payment.supplier_id === supplierId)
        .map((payment) => ({
          id: payment.id,
          ledgerKey: `payment-${payment.id}`,
          supplier_id: supplierId,
          source: "payment",
          date: payment.payment_date || payment.date || payment.created_at,
          type: payment.invoice_id ? "Supplier Payment" : "Payment on Account",
          reference: payment.reference || payment.payment_reference || "-",
          description: payment.description || "Supplier payment",
          debit: asNumber(payment.amount || payment.gross_amount),
          credit: 0,
          status: payment.status || (payment.invoice_id ? "Allocated" : "Open"),
        })),
      ...expenses
        .filter((expense) => expense.supplier_id === supplierId)
        .map((expense) => ({
          id: expense.id,
          ledgerKey: `expense-${expense.id}`,
          supplier_id: supplierId,
          source: "expense",
          date: expense.expense_date || expense.date || expense.created_at,
          type: "Expense",
          reference: expense.reference || "-",
          description: expense.description || "Supplier expense",
          debit: 0,
          credit: asNumber(expense.gross_amount || expense.total || expense.amount),
          status: expense.status || "Posted",
        })),
    ];

    const supplierDraftRows = ledgerDraftRows.filter((row) => row.supplier_id === supplierId);
    const draftOverrides = new Map(
      supplierDraftRows.filter((row) => row.originalKey).map((row) => [row.originalKey, row])
    );
    const draftAdditions = supplierDraftRows.filter((row) => !row.originalKey);
    const rows = [
      ...baseRows.map((row) => draftOverrides.get(row.ledgerKey) || row),
      ...draftAdditions,
    ].sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));

    let runningBalance = 0;
    return rows.map((row) => {
      runningBalance += asNumber(row.credit) - asNumber(row.debit);
      return { ...row, runningBalance };
    });
  }, [creditNotes, expenses, invoices, ledgerDraftRows, payments]);

  function supplierLastActivity(supplierId) {
    const rows = supplierLedgerRows(supplierId);
    return rows.length ? rows[rows.length - 1].date : null;
  }

  function openTransactionForm(type, row) {
    setTransactionErrors({});
    const source = row?.source || "frontend";
    const documentType = row?.type === "Credit Note" ? "Supplier Credit Note" : row?.type || type;
    const gross = row?.gross || row?.gross_amount || row?.total || (row?.credit || row?.debit) || "";
    const net = row?.net || row?.net_amount || "";
    const vat = row?.vat || row?.vat_amount || "";
    setTransactionDraft({
      id: row?.id || "",
      ledgerKey: row?.ledgerKey || "",
      originalKey: source === "frontend" ? row?.originalKey || "" : row?.ledgerKey || "",
      supplier_id: row?.supplier_id || selectedSupplier?.id || selectedSupplierId,
      supplier_name: selectedSupplier?.name || "",
      supplier_code: selectedSupplier?.supplier_code || "",
      source,
      type: documentType,
      date: toInputDate(row?.date) || todayInput(),
      due_date: toInputDate(row?.due_date) || toInputDate(row?.date) || todayInput(),
      payment_terms: row?.payment_terms || row?.payment_terms_days || selectedSupplier?.payment_terms_days || "30",
      currency: row?.currency || selectedSupplier?.default_currency || "GBP",
      document_number: row?.document_number || row?.invoice_number || row?.credit_note_number || (row?.reference === "-" ? "" : row?.reference || ""),
      reference: row?.reference === "-" ? "" : row?.reference || "",
      description: row?.description || "",
      purchase_nominal: row?.purchase_nominal || row?.default_purchase_account || selectedSupplier?.default_purchase_account || "",
      vat_code: row?.vat_code || row?.default_vat_code || selectedSupplier?.default_vat_code || "",
      net: formatAmount(net),
      vat: formatAmount(vat),
      gross: formatAmount(gross),
      debit: row?.debit ? String(row.debit) : "",
      credit: row?.credit ? String(row.credit) : "",
      status: row?.status || "Draft",
      attachment_name: row?.attachment_name || row?.attachment_url || row?.document_url || "",
      payment_allocation: row?.payment_allocation || row?.bank_reference || "",
      line_items: Array.isArray(row?.line_items) && row.line_items.length
        ? row.line_items
        : [purchaseDocumentLine(row?.description || "", formatAmount(net || gross))],
      notes: "",
    });
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
    if (transactionDraft?.line_items?.some((line) => !String(line.description || "").trim())) errors.line_items = "Every line needs a description";
    if (!transactionDraft?.status) errors.status = "Status is required";
    setTransactionErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function saveTransactionDraft(e, nextStatus = "Draft") {
    e.preventDefault();
    if (!validateTransaction()) return;
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
    toast.success(status === "Posted" ? "Purchase document posted to Accounts Payable in this ledger" : row.originalKey ? "Purchase document saved in this ledger" : "Purchase document draft added");
    setTransactionDraft(null);
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
    if (!supplierDraft.name.trim()) return toast.error("Supplier name is required");
    if (!selectedSupplier?.id) return toast.error("Supplier record is unavailable");
    const saved = await run(
      async () => {
        await putJson(`/ap/suppliers/${selectedSupplier.id}`, supplierDraft);
        await putJson("/ap/settings", settingsForm);
      },
      "Supplier record saved"
    );
    if (!saved) return;
    setSupplierEditMode(false);
  }

  const overdueSupplierIds = new Set(invoices.filter((invoice) => String(invoice.status || "").toLowerCase() === "overdue").map((invoice) => invoice.supplier_id));
  const awaitingDocumentSupplierIds = new Set(invoices.filter((invoice) => !invoice.attachment_url && !invoice.document_url).map((invoice) => invoice.supplier_id));
  const totalPaymentsOnAccount = suppliers.reduce((sum, supplier) => sum + supplierPaymentOnAccount(supplier.id), 0);
  const recentSupplierActivity = suppliers
    .map((supplier) => ({ supplier, date: supplierLastActivity(supplier.id) }))
    .filter((row) => row.date)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 6);

  const selectedLedgerRows = useMemo(() => (
    selectedSupplier ? supplierLedgerRows(selectedSupplier.id) : []
  ), [selectedSupplier, supplierLedgerRows]);
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
  const ledgerStatuses = useMemo(() => (
    ["All", ...Array.from(new Set(selectedLedgerRows.map((row) => row.status).filter(Boolean)))]
  ), [selectedLedgerRows]);
  const ledgerTotals = useMemo(() => visibleLedgerRows.reduce((totals, row) => ({
    debit: totals.debit + asNumber(row.debit),
    credit: totals.credit + asNumber(row.credit),
  }), { debit: 0, credit: 0 }), [visibleLedgerRows]);
  const ledgerClosingBalance = visibleLedgerRows.length ? visibleLedgerRows[visibleLedgerRows.length - 1].runningBalance : 0;

  function exportLedgerRows() {
    const header = "Date,Type,Reference,Description,Debit,Credit,Running Balance,Status";
    const rows = visibleLedgerRows.map((row) => [
      formatDate(row.date),
      row.type,
      row.reference,
      String(row.description || "").replaceAll("\"", "\"\""),
      asNumber(row.debit).toFixed(2),
      asNumber(row.credit).toFixed(2),
      asNumber(row.runningBalance).toFixed(2),
      row.status,
    ].map((value) => `"${value || ""}"`).join(","));
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${selectedSupplier?.name || "supplier"}-ledger.csv`;
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

    if (realRows.length) return realRows;
    return selectedLedgerRows.map((row) => ({
      id: `${row.source}-${row.id}`,
      date: row.date,
      user: "System",
      action: `${row.type} recorded`,
      description: `${row.reference} - ${row.description}`,
    }));
  }, [auditTrail, selectedLedgerRows, selectedSupplier]);

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

  if (activeTab === "Dashboard" && !selectedSupplier) {
    return (
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-5">
          <SummaryCard label="Outstanding supplier balances" value={formatMoney(ap.dashboard?.outstanding_total || workspace.summary?.ap_outstanding || 0)} tone="amber" />
          <SummaryCard label="Payments on account" value={formatMoney(totalPaymentsOnAccount)} tone="blue" />
          <SummaryCard label="Awaiting documents" value={awaitingDocumentSupplierIds.size} tone="stone" />
          <SummaryCard label="Overdue suppliers" value={overdueSupplierIds.size} tone="amber" />
          <SummaryCard label="Suppliers" value={suppliers.length} tone="emerald" />
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <Panel title="Supplier balances">
            <div className="grid gap-3 md:grid-cols-2">
              {visibleSuppliers.slice(0, 6).map((supplier) => (
                <SupplierCard
                  key={supplier.id}
                  supplier={supplier}
                  outstanding={supplier.current_balance ?? supplier.outstanding_balance ?? 0}
                  paymentOnAccount={supplierPaymentOnAccount(supplier.id)}
                  lastActivity={supplierLastActivity(supplier.id)}
                  onOpen={() => setSelectedSupplierId(supplier.id)}
                />
              ))}
            </div>
          </Panel>
          <Panel title="Recent supplier activity">
            <div className="space-y-2">
              {recentSupplierActivity.length ? recentSupplierActivity.map(({ supplier, date }) => (
                <button key={supplier.id} type="button" onClick={() => setSelectedSupplierId(supplier.id)} className="flex w-full items-center justify-between rounded-md border border-stone-200 bg-white px-3 py-2 text-left text-sm hover:border-emerald-300">
                  <span>
                    <span className="block font-semibold text-stone-900">{supplier.name}</span>
                    <span className="text-stone-500">Last activity {formatDate(date)}</span>
                  </span>
                  <Badge className={statusBadgeClass(supplier.status || "active")}>{supplier.status || "Active"}</Badge>
                </button>
              )) : <div className="py-8 text-center text-sm text-stone-500">No supplier activity yet.</div>}
            </div>
          </Panel>
        </div>
      </div>
    );
  }

  if (activeTab === "Suppliers" || (activeTab === "Dashboard" && selectedSupplier)) {
    if (selectedSupplier) {
      return (
        <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <Button type="button" variant="outline" onClick={() => setSelectedSupplierId("")}>Back to suppliers</Button>
              <h3 className="mt-3 font-display text-2xl font-semibold text-stone-900">{supplierDraft.name || selectedSupplier.name}</h3>
              <p className="text-sm text-stone-500">{supplierDraft.supplier_code || "No supplier code"} - {supplierDraft.email || "No email"}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {supplierRecordTabs.map((recordTab) => (
                <Button
                  key={recordTab}
                  type="button"
                  variant={supplierRecordTab === recordTab ? "default" : "outline"}
                  onClick={() => setSupplierRecordTab(recordTab)}
                >
                  {recordTab}
                </Button>
              ))}
            </div>
          </div>

          {supplierRecordTab === "General" ? (
            <Panel title="Supplier general details">
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
              <div className="grid gap-3 xl:grid-cols-2">
                <Section title="General">
                  <div className="grid gap-3 md:grid-cols-2">
                    <EditableField label="Supplier name" value={supplierDraft.name} editable={supplierEditMode} onChange={(value) => setSupplierDraft((draft) => ({ ...draft, name: value }))} />
                    <EditableField label="Supplier code" value={supplierDraft.supplier_code} editable={supplierEditMode} onChange={(value) => setSupplierDraft((draft) => ({ ...draft, supplier_code: value }))} />
                    <EditableField label="Trading name" value={supplierDraft.trading_name} editable={supplierEditMode} onChange={(value) => setSupplierDraft((draft) => ({ ...draft, trading_name: value }))} />
                    <EditableField label="Status" value={supplierDraft.status} editable={supplierEditMode} options={["Active", "On hold", "Inactive"]} onChange={(value) => setSupplierDraft((draft) => ({ ...draft, status: value }))} />
                    <EditableField label="Email" type="email" value={supplierDraft.email} editable={supplierEditMode} onChange={(value) => setSupplierDraft((draft) => ({ ...draft, email: value }))} />
                    <EditableField label="Phone" value={supplierDraft.phone} editable={supplierEditMode} onChange={(value) => setSupplierDraft((draft) => ({ ...draft, phone: value }))} />
                    <EditableField label="Website" value={supplierDraft.website} editable={supplierEditMode} onChange={(value) => setSupplierDraft((draft) => ({ ...draft, website: value }))} />
                    <EditableField label="Currency" value={supplierDraft.default_currency} editable={supplierEditMode} options={["GBP", "EUR", "USD"]} onChange={(value) => setSupplierDraft((draft) => ({ ...draft, default_currency: value }))} />
                  </div>
                </Section>
                <Section title="Supplier settings">
                  <div className="grid gap-3 md:grid-cols-2">
                    <EditableField label="Approval required" checkbox value={settingsForm.approval_required} editable={supplierEditMode} help="Requires supplier transactions to be approved before posting once posting workflow is connected." onChange={(value) => setSettingsForm((form) => ({ ...form, approval_required: value }))} />
                    <EditableField label="Supplier numbering" value={settingsForm.supplier_numbering || "manual"} editable={supplierEditMode} options={[
                      { value: "manual", label: "Manual" },
                      { value: "automatic", label: "Automatic" },
                      { value: "prefix", label: "Prefix based" },
                    ]} help="Controls how new supplier records are numbered in the supplier master." onChange={(value) => setSettingsForm((form) => ({ ...form, supplier_numbering: value }))} />
                    <EditableField label="Payment on account behaviour" value={settingsForm.payment_on_account_behaviour || "hold"} editable={supplierEditMode} options={[
                      { value: "hold", label: "Hold for future allocation" },
                      { value: "warn", label: "Warn before saving" },
                      { value: "require_allocation", label: "Require allocation" },
                    ]} help="Controls supplier payments where no invoice exists yet." onChange={(value) => setSettingsForm((form) => ({ ...form, payment_on_account_behaviour: value }))} />
                    <EditableField label="Expense behaviour" value={settingsForm.expense_behaviour || "allow"} editable={supplierEditMode} options={[
                      { value: "allow", label: "Allow expense entries" },
                      { value: "review", label: "Review expense entries" },
                      { value: "disable", label: "Disable expense entries" },
                    ]} help="Controls whether small supplier purchases can be entered directly as expenses in the supplier ledger." onChange={(value) => setSettingsForm((form) => ({ ...form, expense_behaviour: value }))} />
                  </div>
                </Section>
                <Section title="Addresses">
                  <div className="grid gap-3 md:grid-cols-2">
                    <EditableField label="Registered address" value={supplierDraft.registered_address} editable={supplierEditMode} textarea onChange={(value) => setSupplierDraft((draft) => ({ ...draft, registered_address: value }))} />
                    <EditableField label="Trading address" value={supplierDraft.trading_address} editable={supplierEditMode} textarea onChange={(value) => setSupplierDraft((draft) => ({ ...draft, trading_address: value }))} />
                    <EditableField label="Billing address" value={supplierDraft.billing_address} editable={supplierEditMode} textarea onChange={(value) => setSupplierDraft((draft) => ({ ...draft, billing_address: value }))} />
                  </div>
                </Section>
                <Section title="Contacts">
                  <div className="grid gap-3 md:grid-cols-2">
                    <EditableField label="Contact name" value={supplierDraft.contact_name} editable={supplierEditMode} onChange={(value) => setSupplierDraft((draft) => ({ ...draft, contact_name: value }))} />
                    <EditableField label="Position" value={supplierDraft.contact_position} editable={supplierEditMode} onChange={(value) => setSupplierDraft((draft) => ({ ...draft, contact_position: value }))} />
                    <EditableField label="Contact email" type="email" value={supplierDraft.contact_email} editable={supplierEditMode} onChange={(value) => setSupplierDraft((draft) => ({ ...draft, contact_email: value }))} />
                    <EditableField label="Contact phone" value={supplierDraft.contact_phone} editable={supplierEditMode} onChange={(value) => setSupplierDraft((draft) => ({ ...draft, contact_phone: value }))} />
                  </div>
                </Section>
                <Section title="Bank details">
                  <div className="grid gap-3 md:grid-cols-2">
                    <EditableField label="Bank name" value={supplierDraft.bank_name} editable={supplierEditMode} onChange={(value) => setSupplierDraft((draft) => ({ ...draft, bank_name: value }))} />
                    <EditableField label="Sort code" value={supplierDraft.bank_sort_code} editable={supplierEditMode} onChange={(value) => setSupplierDraft((draft) => ({ ...draft, bank_sort_code: value }))} />
                    <EditableField label="Account number" value={supplierDraft.bank_account_number} editable={supplierEditMode} onChange={(value) => setSupplierDraft((draft) => ({ ...draft, bank_account_number: value }))} />
                  </div>
                </Section>
                <Section title="Payment terms">
                  <div className="grid gap-3 md:grid-cols-2">
                    <EditableField label="Payment terms days" type="number" value={supplierDraft.payment_terms_days} editable={supplierEditMode} onChange={(value) => setSupplierDraft((draft) => ({ ...draft, payment_terms_days: value }))} />
                    <EditableField label="Default purchase nominal" value={supplierDraft.default_purchase_account} editable={supplierEditMode} options={expenseAccounts.map((account) => ({ value: account.code, label: `${account.code} - ${account.name}` }))} onChange={(value) => setSupplierDraft((draft) => ({ ...draft, default_purchase_account: value }))} />
                  </div>
                </Section>
                <Section title="Tax">
                  <div className="grid gap-3 md:grid-cols-2">
                    <EditableField label="VAT number" value={supplierDraft.vat_number} editable={supplierEditMode} onChange={(value) => setSupplierDraft((draft) => ({ ...draft, vat_number: value }))} />
                    <EditableField label="Company number" value={supplierDraft.company_number} editable={supplierEditMode} onChange={(value) => setSupplierDraft((draft) => ({ ...draft, company_number: value }))} />
                    <EditableField label="Default VAT code" value={supplierDraft.default_vat_code} editable={supplierEditMode} onChange={(value) => setSupplierDraft((draft) => ({ ...draft, default_vat_code: value }))} />
                    <EditableField label="CIS registered" checkbox value={supplierDraft.cis_registered} editable={supplierEditMode} onChange={(value) => setSupplierDraft((draft) => ({ ...draft, cis_registered: value }))} />
                    <EditableField label="Reverse charge" checkbox value={supplierDraft.reverse_charge} editable={supplierEditMode} onChange={(value) => setSupplierDraft((draft) => ({ ...draft, reverse_charge: value }))} />
                  </div>
                </Section>
                <Section title="Notes">
                  <EditableField label="Supplier notes" value={supplierDraft.notes} editable={supplierEditMode} textarea onChange={(value) => setSupplierDraft((draft) => ({ ...draft, notes: value }))} />
                </Section>
              </div>
            </Panel>
          ) : null}

          {supplierRecordTab === "Ledger" ? (
            <Panel title="Supplier ledger">
              <div className="mb-3 grid gap-3 md:grid-cols-4">
                <SummaryCard label="Visible transactions" value={visibleLedgerRows.length} />
                <SummaryCard label="Debit" value={formatMoney(ledgerTotals.debit)} />
                <SummaryCard label="Credit" value={formatMoney(ledgerTotals.credit)} />
                <SummaryCard label="Closing balance" value={formatMoney(ledgerClosingBalance)} />
              </div>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={() => openTransactionForm("Purchase Invoice")}>
                    <Plus className="mr-2 h-4 w-4" /> Add purchase document
                  </Button>
                  <Button type="button" variant="outline" onClick={() => openTransactionForm("Supplier Credit Note")}>
                    <Plus className="mr-2 h-4 w-4" /> Add supplier credit note
                  </Button>
                  <Button type="button" variant="outline" onClick={() => openTransactionForm("Payment on Account")}>
                    <Plus className="mr-2 h-4 w-4" /> Add payment
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
                    <option value="Supplier Payment">Supplier Payment</option>
                  </select>
                  <select value={ledgerStatusFilter} onChange={(e) => setLedgerStatusFilter(e.target.value)} className="h-9 rounded-md border border-stone-200 bg-white px-3 text-sm">
                    {ledgerStatuses.map((status) => <option key={status} value={status}>{status === "All" ? "All statuses" : status}</option>)}
                  </select>
                  <Input type="date" value={ledgerDateFrom} onChange={(e) => setLedgerDateFrom(e.target.value)} className="h-9 w-36" />
                  <Input type="date" value={ledgerDateTo} onChange={(e) => setLedgerDateTo(e.target.value)} className="h-9 w-36" />
                  <Button type="button" variant="outline" onClick={exportLedgerRows}>
                    <Download className="mr-2 h-4 w-4" /> Export
                  </Button>
                </div>
              </div>
              <div className="overflow-hidden rounded-md border border-stone-200">
                <table className="w-full text-sm">
                  <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                    <tr>
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">Reference</th>
                      <th className="px-3 py-2">Description</th>
                      <th className="px-3 py-2 text-right">Debit</th>
                      <th className="px-3 py-2 text-right">Credit</th>
                      <th className="px-3 py-2 text-right">Running Balance</th>
                      <th className="px-3 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleLedgerRows.length ? visibleLedgerRows.map((row) => (
                      <tr key={row.ledgerKey || `${row.source}-${row.id}`} className="cursor-pointer border-t border-stone-100 hover:bg-emerald-50/50" onClick={() => openTransactionForm(row.type, row)}>
                        <td className="px-3 py-2">{formatDate(row.date)}</td>
                        <td className="px-3 py-2 font-medium">
                          <div className="flex flex-wrap items-center gap-2">
                            {row.type}
                            {row.source === "frontend" ? <Badge className="bg-amber-100 text-amber-800">Staged</Badge> : null}
                          </div>
                        </td>
                        <td className="px-3 py-2">{row.reference}</td>
                        <td className="px-3 py-2 text-stone-600">{row.description}</td>
                        <td className="px-3 py-2 text-right">{row.debit ? formatMoney(row.debit) : "-"}</td>
                        <td className="px-3 py-2 text-right">{row.credit ? formatMoney(row.credit) : "-"}</td>
                        <td className="px-3 py-2 text-right font-semibold">{formatMoney(row.runningBalance)}</td>
                        <td className="px-3 py-2"><Badge className={statusBadgeClass(row.status)}>{row.status}</Badge></td>
                      </tr>
                    )) : (
                      <tr>
                        <td colSpan="8" className="px-3 py-8 text-center text-stone-500">No ledger transactions found.</td>
                      </tr>
                    )}
                  </tbody>
                  {visibleLedgerRows.length ? (
                    <tfoot className="border-t border-stone-200 bg-stone-50 text-sm font-semibold">
                      <tr>
                        <td colSpan="4" className="px-3 py-2 text-right">Visible total</td>
                        <td className="px-3 py-2 text-right">{formatMoney(ledgerTotals.debit)}</td>
                        <td className="px-3 py-2 text-right">{formatMoney(ledgerTotals.credit)}</td>
                        <td className="px-3 py-2 text-right">{formatMoney(ledgerClosingBalance)}</td>
                        <td className="px-3 py-2" />
                      </tr>
                    </tfoot>
                  ) : null}
                </table>
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
              </div>
            </Panel>
          ) : null}

          {transactionDraft ? (
            <ManualPurchaseDocumentDrawer
              draft={transactionDraft}
              setDraft={setTransactionDraft}
              errors={transactionErrors}
              supplier={selectedSupplier}
              expenseAccounts={expenseAccounts}
              onClose={() => setTransactionDraft(null)}
              onSave={saveTransactionDraft}
              onPost={postTransactionDraft}
            />
          ) : null}
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <div className="grid gap-4 xl:grid-cols-[1fr_0.8fr]">
          <Panel title="Suppliers">
            <div className="mb-3 flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-stone-400" />
                <Input value={supplierQuery} onChange={(e) => setSupplierQuery(e.target.value)} placeholder="Search supplier cards" className="h-9 pl-9" />
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {visibleSuppliers.map((supplier) => (
                <SupplierCard
                  key={supplier.id}
                  supplier={supplier}
                  outstanding={supplier.current_balance ?? supplier.outstanding_balance ?? 0}
                  paymentOnAccount={supplierPaymentOnAccount(supplier.id)}
                  lastActivity={supplierLastActivity(supplier.id)}
                  onOpen={() => setSelectedSupplierId(supplier.id)}
                />
              ))}
              {!visibleSuppliers.length ? <div className="rounded-md border border-dashed border-stone-200 py-10 text-center text-sm text-stone-500 md:col-span-2">No suppliers found.</div> : null}
            </div>
          </Panel>
          <Panel title="Create supplier">
            <form onSubmit={createSupplier} className="grid gap-3 md:grid-cols-2">
              <FieldControl label="Supplier name">
                <Input value={supplierForm.name} onChange={(e) => setSupplierForm((form) => ({ ...form, name: e.target.value }))} className="h-9" />
              </FieldControl>
              <FieldControl label="Supplier code">
                <Input value={supplierForm.supplier_code} onChange={(e) => setSupplierForm((form) => ({ ...form, supplier_code: e.target.value }))} className="h-9" />
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
              <AccountCodeSelect accounts={expenseAccounts} value={supplierForm.default_purchase_account} onChange={(value) => setSupplierForm((form) => ({ ...form, default_purchase_account: value }))} label="Default purchase nominal" />
              <div className="md:col-span-2">
                <Button type="submit" disabled={saving || busy}>
                  <Plus className="mr-2 h-4 w-4" /> Create supplier
                </Button>
              </div>
            </form>
          </Panel>
        </div>
      </div>
    );
  }

  return null;
}

function ManualPurchaseDocumentDrawer({
  draft,
  setDraft,
  errors,
  supplier,
  expenseAccounts,
  onClose,
  onSave,
  onPost,
}) {
  const readOnly = isReadOnlyTransaction(draft);
  const isCredit = isCreditDocument(draft.type);
  const isPayment = isPaymentDocument(draft.type);
  const lineTotals = transactionLineTotals(draft.line_items);
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
    <div className="fixed inset-y-0 right-0 z-40 w-full max-w-[1180px] overflow-hidden border-l border-stone-200 bg-white shadow-2xl">
      <div className="flex h-full min-h-0 flex-col">
        <header className="border-b border-stone-200 bg-stone-50 px-4 py-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-display text-lg font-semibold text-stone-900">{supplier?.name || draft.supplier_name || "Supplier"}</h3>
                <Badge variant="secondary">{supplier?.supplier_code || draft.supplier_code || "No supplier code"}</Badge>
                <Badge className={statusBadgeClass(draft.status)}>{draft.status || "Draft"}</Badge>
              </div>
              <p className="mt-1 text-sm text-stone-500">
                Manual Accounts Payable purchase document entry. Supplier is locked from the open supplier account.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {draft.originalKey ? <Button type="button" variant="outline" onClick={() => set("showImpact", !draft.showImpact)}>View ledger impact</Button> : null}
              {draft.originalKey ? <Button type="button" variant="outline" onClick={() => set("showAudit", !draft.showAudit)}>View audit trail</Button> : null}
              <Button type="button" variant="outline" onClick={onClose}>Cancel / close</Button>
              {!readOnly ? <Button type="button" variant="outline" onClick={(event) => onSave(event, "Draft")}>Save draft</Button> : null}
              {!readOnly && !isPayment ? <Button type="button" onClick={onPost} style={{ background: "var(--brand)" }}>Post to AP</Button> : null}
              <Button type="button" variant="outline" size="sm" onClick={onClose}><X className="h-4 w-4" /></Button>
            </div>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[minmax(620px,1fr)_380px]">
          <form onSubmit={(event) => onSave(event, draft.status || "Draft")} className="min-h-0 overflow-auto p-4">
            {readOnly ? (
              <div className="mb-3 rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-600">
                Posted, paid and allocated supplier ledger transactions are view only. Corrections should be entered as a supplier credit note or reversal flow.
              </div>
            ) : null}
            {errors.supplier ? <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errors.supplier}</div> : null}

            <section className="rounded-md border border-stone-200 bg-white p-3">
              <h4 className="mb-3 text-sm font-semibold text-stone-900">Coding / accounting fields</h4>
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
                  <select value={draft.type} disabled={readOnly} onChange={(e) => set("type", e.target.value)} className="h-9 w-full rounded-md border border-stone-200 bg-white px-3 text-sm disabled:bg-stone-50">
                    {transactionTypes.map((type) => <option key={type} value={type}>{type === "Purchase Invoice" ? "Purchase Invoice / Bill" : type}</option>)}
                  </select>
                </FieldControl>
                {!isPayment ? (
                  <FieldControl label={documentNumberLabel(draft.type)} error={errors.document_number}>
                    <Input value={draft.document_number || ""} readOnly={readOnly} onChange={(e) => set("document_number", e.target.value)} className="h-9" />
                  </FieldControl>
                ) : null}
                <FieldControl label="Reference">
                  <Input value={draft.reference || ""} readOnly={readOnly} onChange={(e) => set("reference", e.target.value)} className="h-9" />
                </FieldControl>
                <FieldControl label={documentDateLabel(draft.type)} error={errors.date}>
                  <Input type="date" value={draft.date || ""} readOnly={readOnly} onChange={(e) => set("date", e.target.value)} className="h-9" />
                </FieldControl>
                {!isCredit && !isPayment ? (
                  <>
                    <FieldControl label="Due date">
                      <Input type="date" value={draft.due_date || ""} readOnly={readOnly} onChange={(e) => set("due_date", e.target.value)} className="h-9" />
                    </FieldControl>
                    <FieldControl label="Payment terms">
                      <Input value={draft.payment_terms || ""} readOnly={readOnly} onChange={(e) => set("payment_terms", e.target.value)} className="h-9" />
                    </FieldControl>
                  </>
                ) : null}
                <FieldControl label="Currency">
                  <Input value={draft.currency || "GBP"} readOnly={readOnly} onChange={(e) => set("currency", e.target.value)} className="h-9" />
                </FieldControl>
                {!isPayment ? (
                  <>
                    <FieldControl label="Purchase nominal / category" error={errors.purchase_nominal}>
                      <select value={draft.purchase_nominal || ""} disabled={readOnly} onChange={(e) => set("purchase_nominal", e.target.value)} className="h-9 w-full rounded-md border border-stone-200 bg-white px-3 text-sm disabled:bg-stone-50">
                        <option value="">Select purchase nominal</option>
                        {expenseAccounts.map((account) => <option key={account.code} value={account.code}>{account.code} - {account.name}</option>)}
                      </select>
                    </FieldControl>
                    <FieldControl label="VAT code">
                      <Input value={draft.vat_code || ""} readOnly={readOnly} onChange={(e) => set("vat_code", e.target.value)} className="h-9" />
                    </FieldControl>
                  </>
                ) : null}
              </div>
              <div className="mt-3">
                <FieldControl label="Description" error={errors.description}>
                  <textarea value={draft.description || ""} readOnly={readOnly} onChange={(e) => set("description", e.target.value)} className="min-h-20 w-full rounded-md border border-stone-200 px-3 py-2 text-sm read-only:bg-stone-50" />
                </FieldControl>
              </div>
            </section>

            {!isPayment ? (
              <section className="mt-3 rounded-md border border-stone-200 bg-white p-3">
                <h4 className="mb-3 text-sm font-semibold text-stone-900">Amounts</h4>
                <div className="grid gap-3 md:grid-cols-4">
                  <FieldControl label="Net amount" error={errors.amount}>
                    <Input type="number" step="0.01" value={draft.net || ""} readOnly={readOnly} onChange={(e) => set("net", e.target.value)} className="h-9" />
                  </FieldControl>
                  <FieldControl label="VAT amount">
                    <Input type="number" step="0.01" value={draft.vat || ""} readOnly={readOnly} onChange={(e) => set("vat", e.target.value)} className="h-9" />
                  </FieldControl>
                  <FieldControl label="Gross amount">
                    <Input type="number" step="0.01" value={draft.gross || ""} readOnly={readOnly} onChange={(e) => set("gross", e.target.value)} className="h-9" />
                  </FieldControl>
                  <div className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-600">
                    <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">Lines gross</div>
                    <div className="mt-1 font-display text-lg font-semibold text-stone-900">{formatMoney(lineTotals.gross)}</div>
                  </div>
                </div>
              </section>
            ) : (
              <section className="mt-3 rounded-md border border-stone-200 bg-white p-3">
                <h4 className="mb-3 text-sm font-semibold text-stone-900">Supplier payment</h4>
                <div className="grid gap-3 md:grid-cols-3">
                  <FieldControl label="Payment date" error={errors.date}>
                    <Input type="date" value={draft.date || ""} readOnly={readOnly} onChange={(e) => set("date", e.target.value)} className="h-9" />
                  </FieldControl>
                  <FieldControl label="Bank reference">
                    <Input value={draft.reference || ""} readOnly={readOnly} onChange={(e) => set("reference", e.target.value)} className="h-9" />
                  </FieldControl>
                  <FieldControl label="Amount paid" error={errors.amount}>
                    <Input type="number" step="0.01" value={draft.gross || ""} readOnly={readOnly} onChange={(e) => set("gross", e.target.value)} className="h-9" />
                  </FieldControl>
                </div>
              </section>
            )}

            {!isPayment ? (
              <section className="mt-3 rounded-md border border-stone-200 bg-white p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold text-stone-900">Line items</h4>
                  {!readOnly ? <Button type="button" variant="outline" size="sm" onClick={addLine}>Add line item</Button> : null}
                </div>
                {errors.line_items ? <div className="mb-2 text-xs font-medium text-red-600">{errors.line_items}</div> : null}
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] text-xs">
                    <thead className="border-b border-stone-200 text-left text-[10px] uppercase tracking-wider text-stone-500">
                      <tr>
                        <th className="py-1 pr-1.5">Description</th>
                        <th className="py-1 pr-1.5">Purchase nominal/account code</th>
                        <th className="py-1 pr-1.5">VAT code</th>
                        <th className="py-1 pr-1.5">Quantity / units</th>
                        <th className="py-1 pr-1.5">Unit price</th>
                        <th className="py-1 pr-1.5">Net</th>
                        <th className="py-1 pr-1.5">VAT</th>
                        <th className="py-1">Gross</th>
                        <th className="py-1 pl-1.5"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {draft.line_items.map((line, index) => (
                        <tr key={index}>
                          <td className="py-0.5 pr-1.5"><Input value={line.description || ""} readOnly={readOnly} onChange={(e) => setLine(index, "description", e.target.value)} className="h-7 min-w-40 px-1.5 text-xs" /></td>
                          <td className="py-0.5 pr-1.5"><Input value={line.purchase_nominal || ""} readOnly={readOnly} onChange={(e) => setLine(index, "purchase_nominal", e.target.value)} className="h-7 min-w-32 px-1.5 text-xs" /></td>
                          <td className="py-0.5 pr-1.5"><Input value={line.vat_code || ""} readOnly={readOnly} onChange={(e) => setLine(index, "vat_code", e.target.value)} className="h-7 min-w-24 px-1.5 text-xs" /></td>
                          <td className="py-0.5 pr-1.5"><Input type="number" step="0.01" value={line.quantity || ""} readOnly={readOnly} onChange={(e) => setLine(index, "quantity", e.target.value)} className="h-7 min-w-20 px-1.5 text-xs" /></td>
                          <td className="py-0.5 pr-1.5"><Input type="number" step="0.01" value={line.unit_price || ""} readOnly={readOnly} onChange={(e) => setLine(index, "unit_price", e.target.value)} className="h-7 min-w-20 px-1.5 text-xs" /></td>
                          <td className="py-0.5 pr-1.5"><Input type="number" step="0.01" value={line.net || ""} readOnly={readOnly} onChange={(e) => setLine(index, "net", e.target.value)} className="h-7 min-w-20 px-1.5 text-xs" /></td>
                          <td className="py-0.5 pr-1.5"><Input type="number" step="0.01" value={line.vat || ""} readOnly={readOnly} onChange={(e) => setLine(index, "vat", e.target.value)} className="h-7 min-w-20 px-1.5 text-xs" /></td>
                          <td className="py-0.5 pr-1.5"><Input type="number" step="0.01" value={line.gross || ""} readOnly={readOnly} onChange={(e) => setLine(index, "gross", e.target.value)} className="h-7 min-w-20 px-1.5 text-xs" /></td>
                          <td className="py-0.5 pl-1.5">
                            {!readOnly ? <Button type="button" variant="ghost" size="icon" onClick={() => removeLine(index)} className="h-7 w-7 text-stone-500 hover:text-red-600"><X className="h-3.5 w-3.5" /></Button> : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}
          </form>

          <aside className="min-h-0 overflow-auto border-t border-stone-200 bg-stone-50 p-4 lg:border-l lg:border-t-0">
            <section className="rounded-md border border-stone-200 bg-white p-3">
              <h4 className="text-sm font-semibold text-stone-900">Optional attachment preview</h4>
              <div className="mt-3 flex min-h-56 items-center justify-center rounded-md border border-dashed border-stone-300 bg-stone-50 p-4 text-center text-sm text-stone-500">
                {draft.attachment_name ? draft.attachment_name : "No attachment linked to this manual AP entry"}
              </div>
            </section>

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
                  <div>Status: {draft.status || "Draft"}</div>
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
  return (
    <button type="button" onClick={onOpen} className="rounded-md border border-stone-200 bg-white p-4 text-left shadow-sm transition hover:border-emerald-300 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="font-display text-base font-semibold text-stone-900">{supplier.name || "Unnamed supplier"}</h4>
          <p className="mt-0.5 text-xs text-stone-500">{supplier.supplier_code || supplier.email || "No supplier code"}</p>
        </div>
        <Badge className={statusBadgeClass(supplier.status || "active")}>{supplier.status || "Active"}</Badge>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-md bg-amber-50 px-3 py-2">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700"><ReceiptText className="h-3.5 w-3.5" /> Outstanding</div>
          <div className="mt-1 font-display text-lg font-bold text-amber-900">{formatMoney(outstanding)}</div>
        </div>
        <div className="rounded-md bg-sky-50 px-3 py-2">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-sky-700"><WalletCards className="h-3.5 w-3.5" /> On account</div>
          <div className="mt-1 font-display text-lg font-bold text-sky-900">{formatMoney(paymentOnAccount)}</div>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-stone-500">
        <span className="inline-flex items-center gap-1.5"><FileText className="h-3.5 w-3.5" /> Last transaction</span>
        <span className="font-medium text-stone-700">{lastActivity ? formatDate(lastActivity) : "-"}</span>
      </div>
    </button>
  );
}

export default AccountsPayableWorkspace;
