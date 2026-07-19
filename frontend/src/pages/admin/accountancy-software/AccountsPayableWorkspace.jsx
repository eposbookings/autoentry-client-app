import React, { useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import {
  AccountCodeSelect,
  Field,
  Panel,
  ReadOnly,
  SummaryCard,
  formatDate,
  formatDateTime,
  formatMoney,
  statusBadgeClass,
} from "./shared";

function AccountsPayableWorkspace({ workspace, tab, reloadWorkspace, busy }) {
  const ap = workspace.accounts_payable || {};
  const suppliers = useMemo(() => (Array.isArray(ap.suppliers) ? ap.suppliers : []), [ap.suppliers]);
  const invoices = useMemo(() => (Array.isArray(ap.invoices) ? ap.invoices : []), [ap.invoices]);
  const creditNotes = useMemo(() => (Array.isArray(ap.credit_notes) ? ap.credit_notes : []), [ap.credit_notes]);
  const payments = useMemo(() => (Array.isArray(ap.payments) ? ap.payments : []), [ap.payments]);
  const accounts = useMemo(() => (Array.isArray(workspace.accounts) ? workspace.accounts : []), [workspace.accounts]);
  const bankAccounts = useMemo(() => accounts.filter((account) => account.purpose === "Bank Account" || account.account_type === "Bank"), [accounts]);
  const expenseAccounts = useMemo(() => accounts.filter((account) => account.category === "Expense" || account.account_type === "Purchases" || account.account_type === "Overheads"), [accounts]);
  const [saving, setSaving] = useState(false);
  const [supplierQuery, setSupplierQuery] = useState("");
  const emptySupplierForm = { name: "", supplier_code: "", email: "", phone: "", website: "", vat_number: "", company_number: "", payment_terms_days: "30", default_currency: "GBP", default_purchase_account: "5000", default_vat_code: "", bank_name: "", bank_sort_code: "", bank_account_number: "", cis_registered: false, reverse_charge: false, notes: "" };
  const [supplierForm, setSupplierForm] = useState(emptySupplierForm);
  const [settingsForm, setSettingsForm] = useState(ap.settings || {});
  const [selectedSupplierId, setSelectedSupplierId] = useState("");
  const [supplierRecordTab, setSupplierRecordTab] = useState("Ledger");
  const [selectedTransaction, setSelectedTransaction] = useState(null);
  const apTabs = ["Dashboard", "Suppliers", "Settings"];
  const activeTab = apTabs.includes(tab) ? tab : "Dashboard";

  useEffect(() => {
    setSettingsForm(ap.settings || {});
  }, [ap.settings]);

  useEffect(() => {
    if (selectedSupplierId && !suppliers.some((supplier) => supplier.id === selectedSupplierId)) {
      setSelectedSupplierId("");
      setSelectedTransaction(null);
    }
  }, [selectedSupplierId, suppliers]);

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
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setSaving(false);
    }
  }

  const postJson = (url, payload) => api.post(`/admin/accounting/clients/${workspace.client.id}${url}`, payload);
  const putJson = (url, payload) => api.put(`/admin/accounting/clients/${workspace.client.id}${url}`, payload);

  async function createSupplier(e) {
    e.preventDefault();
    if (!supplierForm.name.trim()) return toast.error("Supplier name is required");
    await run(async () => postJson("/ap/suppliers", supplierForm), "Supplier created");
    setSupplierForm(emptySupplierForm);
  }

  async function saveSettings(e) {
    e.preventDefault();
    await run(async () => putJson("/ap/settings", settingsForm), "Accounts Payable settings saved");
  }

  const selectedSupplier = suppliers.find((supplier) => supplier.id === selectedSupplierId);
  const supplierById = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
  const supplierPaymentOnAccount = (supplierId) => payments
    .filter((payment) => payment.supplier_id === supplierId)
    .reduce((sum, payment) => {
      const allocated = (Array.isArray(payment.allocations) ? payment.allocations : []).reduce((total, allocation) => total + Number(allocation.amount || 0), 0);
      return sum + Math.max(0, Number(payment.amount || 0) - allocated);
    }, 0);
  const supplierLastActivity = (supplierId) => {
    const dates = [
      ...invoices.filter((item) => item.supplier_id === supplierId).map((item) => item.invoice_date || item.created_at),
      ...creditNotes.filter((item) => item.supplier_id === supplierId).map((item) => item.credit_note_date || item.created_at),
      ...payments.filter((item) => item.supplier_id === supplierId).map((item) => item.payment_date || item.created_at),
    ].filter(Boolean).sort((a, b) => new Date(b) - new Date(a));
    return dates[0] || null;
  };
  const overdueSupplierIds = new Set(invoices
    .filter((invoice) => Number(invoice.outstanding_amount || 0) > 0 && invoice.due_date && new Date(invoice.due_date) < new Date())
    .map((invoice) => invoice.supplier_id));
  const awaitingDocumentSupplierIds = new Set(invoices
    .filter((invoice) => ["draft", "awaiting_approval"].includes(String(invoice.status || "").toLowerCase()))
    .map((invoice) => invoice.supplier_id));
  const recentSupplierActivity = [
    ...invoices.map((item) => ({ ...item, activityType: "Invoice posted", supplierName: supplierById.get(item.supplier_id)?.name || item.supplier_name, activityDate: item.invoice_date || item.created_at, activityAmount: item.gross_amount })),
    ...creditNotes.map((item) => ({ ...item, activityType: "Credit note", supplierName: supplierById.get(item.supplier_id)?.name || item.supplier_name, activityDate: item.credit_note_date || item.created_at, activityAmount: item.gross_amount })),
    ...payments.map((item) => ({ ...item, activityType: "Payment posted", supplierName: supplierById.get(item.supplier_id)?.name || item.supplier_name, activityDate: item.payment_date || item.created_at, activityAmount: item.amount })),
  ].filter((item) => item.activityDate).sort((a, b) => new Date(b.activityDate) - new Date(a.activityDate)).slice(0, 8);
  const supplierLedgerRows = (supplierId) => {
    const rows = [
      ...invoices.filter((invoice) => invoice.supplier_id === supplierId).map((invoice) => ({
        id: invoice.id,
        source: invoice,
        date: invoice.invoice_date || invoice.created_at,
        type: "Purchase Invoice",
        reference: invoice.invoice_number || invoice.reference || "-",
        description: invoice.description || invoice.supplier_name || "Purchase invoice",
        debit: 0,
        credit: Number(invoice.gross_amount || invoice.total || 0),
        status: invoice.status || "draft",
      })),
      ...creditNotes.filter((creditNote) => creditNote.supplier_id === supplierId).map((creditNote) => ({
        id: creditNote.id,
        source: creditNote,
        date: creditNote.credit_note_date || creditNote.created_at,
        type: "Credit Note",
        reference: creditNote.credit_note_number || creditNote.reference || "-",
        description: creditNote.description || "Supplier credit note",
        debit: Number(creditNote.gross_amount || creditNote.total || 0),
        credit: 0,
        status: creditNote.status || "draft",
      })),
      ...payments.filter((payment) => payment.supplier_id === supplierId).map((payment) => {
        const allocated = (Array.isArray(payment.allocations) ? payment.allocations : []).reduce((total, allocation) => total + Number(allocation.amount || 0), 0);
        const unallocated = Math.max(0, Number(payment.amount || 0) - allocated);
        return {
          id: payment.id,
          source: payment,
          date: payment.payment_date || payment.created_at,
          type: unallocated > 0 ? "Payment on Account" : "Supplier Payment",
          reference: payment.reference || "-",
          description: unallocated > 0 ? "Payment awaiting future invoice allocation" : "Supplier payment",
          debit: Number(payment.amount || 0),
          credit: 0,
          status: payment.status || "posted",
        };
      }),
    ].filter((row) => row.date).sort((a, b) => new Date(a.date) - new Date(b.date));
    let runningBalance = 0;
    return rows.map((row) => {
      runningBalance += Number(row.credit || 0) - Number(row.debit || 0);
      return { ...row, runningBalance };
    });
  };

  if (activeTab === "Dashboard") {
    const dashboard = ap.dashboard || {};
    const supplierAttention = suppliers
      .filter((supplier) => overdueSupplierIds.has(supplier.id) || supplierPaymentOnAccount(supplier.id) > 0 || awaitingDocumentSupplierIds.has(supplier.id))
      .slice(0, 8);
    return (
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <button type="button" className="text-left" onClick={() => { setSupplierQuery(""); setSelectedSupplierId(""); }}>
            <SummaryCard label="Outstanding supplier balances" value={formatMoney(dashboard.outstanding_total)} tone="amber" />
          </button>
          <button type="button" className="text-left" onClick={() => { setSupplierQuery(""); setSelectedSupplierId(""); }}>
            <SummaryCard label="Payments on account" value={formatMoney(suppliers.reduce((sum, supplier) => sum + supplierPaymentOnAccount(supplier.id), 0))} tone="blue" />
          </button>
          <button type="button" className="text-left" onClick={() => { setSupplierQuery(""); setSelectedSupplierId(""); }}>
            <SummaryCard label="Suppliers awaiting documents" value={awaitingDocumentSupplierIds.size} tone="blue" />
          </button>
          <button type="button" className="text-left" onClick={() => { setSupplierQuery(""); setSelectedSupplierId(""); }}>
            <SummaryCard label="Overdue supplier accounts" value={overdueSupplierIds.size || dashboard.overdue_invoices || 0} tone="amber" />
          </button>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <Panel title="Supplier attention">
            {supplierAttention.map((supplier) => (
              <button key={supplier.id} type="button" onClick={() => { setSelectedSupplierId(supplier.id); setSupplierRecordTab("Ledger"); }} className="flex w-full items-center justify-between border-b border-stone-100 py-2 text-left last:border-0">
                <div>
                  <div className="font-semibold text-stone-900">{supplier.name}</div>
                  <div className="text-xs text-stone-500">
                    {overdueSupplierIds.has(supplier.id) ? "Overdue balance" : supplierPaymentOnAccount(supplier.id) > 0 ? "Payment on account" : "Awaiting document"}
                  </div>
                </div>
                <span className="font-semibold">{formatMoney(supplier.balance)}</span>
              </button>
            ))}
            {supplierAttention.length === 0 && <p className="py-8 text-center text-sm text-stone-500">No suppliers need attention.</p>}
          </Panel>
          <Panel title="Recent supplier activity">
            {recentSupplierActivity.length === 0 ? <p className="py-8 text-center text-sm text-stone-500">No supplier ledger activity yet.</p> : recentSupplierActivity.map((item) => (
              <div key={`${item.activityType}-${item.id}`} className="flex items-center justify-between border-b border-stone-100 py-2 last:border-0">
                <div>
                  <div className="font-semibold text-stone-900">{item.activityType}</div>
                  <div className="text-xs text-stone-500">{item.supplierName || "-"} - {formatDate(item.activityDate)}</div>
                </div>
                <span className="font-semibold">{formatMoney(item.activityAmount)}</span>
              </div>
            ))}
          </Panel>
        </div>
      </div>
    );
  }

  if (activeTab === "Suppliers") {
    if (selectedSupplier) {
      const ledgerRows = supplierLedgerRows(selectedSupplier.id);
      const supplierDocuments = [
        ...invoices.filter((invoice) => invoice.supplier_id === selectedSupplier.id).map((invoice) => ({ ...invoice, documentType: "Purchase Invoice", documentNumber: invoice.invoice_number, documentDate: invoice.invoice_date, documentAmount: invoice.gross_amount })),
        ...creditNotes.filter((creditNote) => creditNote.supplier_id === selectedSupplier.id).map((creditNote) => ({ ...creditNote, documentType: "Credit Note", documentNumber: creditNote.credit_note_number, documentDate: creditNote.credit_note_date, documentAmount: creditNote.gross_amount })),
      ].sort((a, b) => new Date(b.documentDate || b.created_at || 0) - new Date(a.documentDate || a.created_at || 0));
      const auditRows = (Array.isArray(workspace.audit_trail) ? workspace.audit_trail : []).filter((entry) => {
        const haystack = `${entry.record_id || ""} ${entry.record_type || ""} ${entry.new_value || ""} ${entry.previous_value || ""}`.toLowerCase();
        return haystack.includes(String(selectedSupplier.id).toLowerCase()) || haystack.includes(String(selectedSupplier.name || "").toLowerCase());
      });

      return (
        <div className="space-y-4">
          <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
            <button type="button" onClick={() => { setSelectedSupplierId(""); setSelectedTransaction(null); }} className="mb-3 text-sm font-semibold text-[var(--brand)]">← Back to supplier cards</button>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-xl font-bold text-stone-950">{selectedSupplier.name}</h3>
                <p className="text-sm text-stone-500">{selectedSupplier.supplier_code || "No supplier code"} - {selectedSupplier.email || "No email saved"}</p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-right text-sm md:grid-cols-4">
                <div className="rounded-md bg-stone-50 px-3 py-2"><div className="text-xs uppercase text-stone-500">Outstanding</div><div className="font-bold">{formatMoney(selectedSupplier.balance)}</div></div>
                <div className="rounded-md bg-blue-50 px-3 py-2"><div className="text-xs uppercase text-blue-700">On account</div><div className="font-bold">{formatMoney(supplierPaymentOnAccount(selectedSupplier.id))}</div></div>
                <div className="rounded-md bg-stone-50 px-3 py-2"><div className="text-xs uppercase text-stone-500">Last activity</div><div className="font-bold">{supplierLastActivity(selectedSupplier.id) ? formatDate(supplierLastActivity(selectedSupplier.id)) : "-"}</div></div>
                <div className="rounded-md bg-emerald-50 px-3 py-2"><div className="text-xs uppercase text-emerald-700">Status</div><div className="font-bold">{selectedSupplier.status || "active"}</div></div>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {["General", "Ledger", "Documents", "Activity", "Audit Trail", "Settings"].map((item) => (
                <button key={item} type="button" onClick={() => setSupplierRecordTab(item)} className={`rounded-md px-3 py-2 text-sm font-semibold ${supplierRecordTab === item ? "bg-[var(--brand)] text-white" : "bg-stone-100 text-stone-700"}`}>{item}</button>
              ))}
            </div>
          </div>

          {supplierRecordTab === "General" && (
            <div className="grid gap-4 xl:grid-cols-2">
              <Panel title="Supplier details">
                <div className="grid gap-3 md:grid-cols-2">
                  <ReadOnly label="Supplier code" value={selectedSupplier.supplier_code} />
                  <ReadOnly label="Trading name" value={selectedSupplier.trading_name} />
                  <ReadOnly label="Email" value={selectedSupplier.email} />
                  <ReadOnly label="Phone" value={selectedSupplier.phone} />
                  <ReadOnly label="Website" value={selectedSupplier.website} />
                  <ReadOnly label="Company number" value={selectedSupplier.company_number} />
                </div>
              </Panel>
              <Panel title="Payment, VAT and defaults">
                <div className="grid gap-3 md:grid-cols-2">
                  <ReadOnly label="Payment terms" value={`${selectedSupplier.payment_terms_days || 0} days`} />
                  <ReadOnly label="Currency" value={selectedSupplier.default_currency || "GBP"} />
                  <ReadOnly label="VAT number" value={selectedSupplier.vat_number} />
                  <ReadOnly label="Default VAT" value={selectedSupplier.default_vat_code} />
                  <ReadOnly label="Default purchase nominal" value={selectedSupplier.default_purchase_account} />
                  <ReadOnly label="Bank" value={selectedSupplier.bank_name} />
                  <ReadOnly label="Sort code" value={selectedSupplier.bank_sort_code} />
                  <ReadOnly label="Account number" value={selectedSupplier.bank_account_number} />
                </div>
              </Panel>
              <Panel title="Notes">
                <p className="whitespace-pre-wrap text-sm text-stone-700">{selectedSupplier.notes || "No supplier notes saved."}</p>
              </Panel>
            </div>
          )}

          {supplierRecordTab === "Ledger" && (
            <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
              <Panel title="Supplier ledger">
                {ledgerRows.length === 0 ? <p className="py-8 text-center text-sm text-stone-500">No ledger transactions for this supplier yet.</p> : (
                  <div className="overflow-auto">
                    <table className="min-w-full text-left text-sm">
                      <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500"><tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Transaction type</th><th className="px-3 py-2">Reference</th><th className="px-3 py-2">Description</th><th className="px-3 py-2 text-right">Debit</th><th className="px-3 py-2 text-right">Credit</th><th className="px-3 py-2 text-right">Running balance</th><th className="px-3 py-2">Status</th></tr></thead>
                      <tbody>{ledgerRows.map((row) => (
                        <tr key={`${row.type}-${row.id}`} onClick={() => setSelectedTransaction(row)} className="cursor-pointer border-t border-stone-100 hover:bg-stone-50">
                          <td className="px-3 py-2">{formatDate(row.date)}</td>
                          <td className="px-3 py-2 font-semibold text-stone-900">{row.type}</td>
                          <td className="px-3 py-2">{row.reference}</td>
                          <td className="px-3 py-2 text-stone-600">{row.description}</td>
                          <td className="px-3 py-2 text-right">{row.debit ? formatMoney(row.debit) : "-"}</td>
                          <td className="px-3 py-2 text-right">{row.credit ? formatMoney(row.credit) : "-"}</td>
                          <td className="px-3 py-2 text-right font-semibold">{formatMoney(row.runningBalance)}</td>
                          <td className="px-3 py-2"><Badge className={statusBadgeClass(row.status)}>{row.status}</Badge></td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
              </Panel>
              <Panel title="Accounting record">
                {!selectedTransaction ? <p className="py-8 text-center text-sm text-stone-500">Select a ledger transaction to view the accounting record.</p> : (
                  <div className="space-y-3 text-sm">
                    <ReadOnly label="Type" value={selectedTransaction.type} />
                    <ReadOnly label="Reference" value={selectedTransaction.reference} />
                    <ReadOnly label="Date" value={formatDate(selectedTransaction.date)} />
                    <ReadOnly label="Debit" value={formatMoney(selectedTransaction.debit)} />
                    <ReadOnly label="Credit" value={formatMoney(selectedTransaction.credit)} />
                    <ReadOnly label="Status" value={selectedTransaction.status} />
                  </div>
                )}
              </Panel>
            </div>
          )}

          {supplierRecordTab === "Documents" && (
            <Panel title="Supplier documents">
              {supplierDocuments.length === 0 ? <p className="py-8 text-center text-sm text-stone-500">No documents are linked to this supplier yet.</p> : supplierDocuments.map((document) => (
                <div key={`${document.documentType}-${document.id}`} className="flex items-center justify-between border-b border-stone-100 py-3 last:border-0">
                  <div>
                    <div className="font-semibold text-stone-900">{document.documentType} {document.documentNumber || document.reference || "-"}</div>
                    <div className="text-xs text-stone-500">{formatDate(document.documentDate || document.created_at)} - {document.status || "draft"}</div>
                  </div>
                  <span className="font-semibold">{formatMoney(document.documentAmount)}</span>
                </div>
              ))}
            </Panel>
          )}

          {supplierRecordTab === "Activity" && (
            <Panel title="Supplier activity">
              {ledgerRows.length === 0 ? <p className="py-8 text-center text-sm text-stone-500">No activity for this supplier yet.</p> : [...ledgerRows].reverse().map((row) => (
                <div key={`activity-${row.type}-${row.id}`} className="border-b border-stone-100 py-3 last:border-0">
                  <div className="font-semibold text-stone-900">{row.type}</div>
                  <div className="text-sm text-stone-500">{formatDate(row.date)} - {row.reference} - {formatMoney(row.credit || row.debit)}</div>
                </div>
              ))}
            </Panel>
          )}

          {supplierRecordTab === "Audit Trail" && (
            <Panel title="Supplier audit trail">
              {auditRows.length === 0 ? <p className="py-8 text-center text-sm text-stone-500">No supplier-specific audit records found yet.</p> : auditRows.map((entry) => (
                <div key={entry.id || `${entry.created_at}-${entry.action}`} className="border-b border-stone-100 py-3 last:border-0">
                  <div className="font-semibold text-stone-900">{entry.action || "Change recorded"}</div>
                  <div className="text-sm text-stone-500">{formatDate(entry.created_at)} - {entry.module || "Accounts Payable"}</div>
                </div>
              ))}
            </Panel>
          )}

          {supplierRecordTab === "Settings" && (
            <Panel title="Supplier ledger settings">
              <div className="grid gap-3 md:grid-cols-2">
                <ReadOnly label="Default purchase nominal" value={selectedSupplier.default_purchase_account || settingsForm.default_purchase_account} />
                <ReadOnly label="Default VAT" value={selectedSupplier.default_vat_code || settingsForm.default_vat_code} />
                <ReadOnly label="Default currency" value={selectedSupplier.default_currency || "GBP"} />
                <ReadOnly label="Payment terms" value={`${selectedSupplier.payment_terms_days || settingsForm.default_payment_terms_days || 0} days`} />
              </div>
              <div className="mt-4 rounded-md border border-stone-200 bg-stone-50 p-3 text-sm text-stone-600">
                AI matching, document matching, payment on account behaviour and expense behaviour are controlled by Accounts Payable settings and will feed this supplier ledger.
              </div>
            </Panel>
          )}
        </div>
      );
    }

    return (
      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <Panel title="Suppliers">
          <Input className="mb-3 h-9" value={supplierQuery} onChange={(e) => setSupplierQuery(e.target.value)} placeholder="Search suppliers by name, code or email" />
          <div className="grid gap-3 md:grid-cols-2">
            {visibleSuppliers.map((supplier) => (
              <button key={supplier.id} type="button" onClick={() => { setSelectedSupplierId(supplier.id); setSupplierRecordTab("Ledger"); setSelectedTransaction(null); }} className="rounded-lg border border-stone-200 bg-white p-4 text-left shadow-sm transition hover:border-emerald-300 hover:shadow-md">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-bold text-stone-950">{supplier.name}</h3>
                    <p className="text-sm text-stone-500">{supplier.email || supplier.trading_name || supplier.supplier_code || "No contact saved"}</p>
                  </div>
                  <Badge className="bg-emerald-100 text-emerald-700">{supplier.status || "active"}</Badge>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <div className="rounded-md bg-amber-50 p-3">
                    <div className="text-xs font-semibold uppercase text-amber-700">Outstanding</div>
                    <div className="text-lg font-bold text-amber-800">{formatMoney(supplier.balance)}</div>
                  </div>
                  <div className="rounded-md bg-blue-50 p-3">
                    <div className="text-xs font-semibold uppercase text-blue-700">Payment on account</div>
                    <div className="text-lg font-bold text-blue-800">{formatMoney(supplierPaymentOnAccount(supplier.id))}</div>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between text-sm">
                  <span className="text-stone-500">Last activity: {supplierLastActivity(supplier.id) ? formatDate(supplierLastActivity(supplier.id)) : "-"}</span>
                  <span className="font-semibold text-[var(--brand)]">Open supplier ledger →</span>
                </div>
              </button>
            ))}
            {visibleSuppliers.length === 0 && <p className="py-8 text-center text-sm text-stone-500 md:col-span-2">No suppliers match that search.</p>}
          </div>
        </Panel>
        <Panel title="Create supplier">
          <form onSubmit={createSupplier} className="space-y-3">
            <Field label="Supplier name" value={supplierForm.name} onChange={(value) => setSupplierForm((current) => ({ ...current, name: value }))} />
            <div className="grid grid-cols-2 gap-2">
              <Field label="Supplier code" value={supplierForm.supplier_code} onChange={(value) => setSupplierForm((current) => ({ ...current, supplier_code: value }))} />
              <Field label="Payment terms" value={supplierForm.payment_terms_days} onChange={(value) => setSupplierForm((current) => ({ ...current, payment_terms_days: value }))} />
            </div>
            <Field label="Email" type="email" value={supplierForm.email} onChange={(value) => setSupplierForm((current) => ({ ...current, email: value }))} />
            <div className="grid grid-cols-2 gap-2">
              <Field label="Phone" value={supplierForm.phone} onChange={(value) => setSupplierForm((current) => ({ ...current, phone: value }))} />
              <Field label="Website" value={supplierForm.website} onChange={(value) => setSupplierForm((current) => ({ ...current, website: value }))} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Company number" value={supplierForm.company_number} onChange={(value) => setSupplierForm((current) => ({ ...current, company_number: value }))} />
              <Field label="VAT number" value={supplierForm.vat_number} onChange={(value) => setSupplierForm((current) => ({ ...current, vat_number: value }))} />
            </div>
            <Field label="Default currency" value={supplierForm.default_currency} onChange={(value) => setSupplierForm((current) => ({ ...current, default_currency: value }))} />
            <AccountCodeSelect label="Default purchase account" accounts={expenseAccounts} value={supplierForm.default_purchase_account} onChange={(value) => setSupplierForm((current) => ({ ...current, default_purchase_account: value }))} />
            <Field label="Default VAT code" value={supplierForm.default_vat_code} onChange={(value) => setSupplierForm((current) => ({ ...current, default_vat_code: value }))} />
            <div className="grid grid-cols-2 gap-2">
              <Field label="Sort code" value={supplierForm.bank_sort_code} onChange={(value) => setSupplierForm((current) => ({ ...current, bank_sort_code: value }))} />
              <Field label="Account number" value={supplierForm.bank_account_number} onChange={(value) => setSupplierForm((current) => ({ ...current, bank_account_number: value }))} />
            </div>
            <label className="flex items-center gap-2 text-sm font-semibold text-stone-700"><input type="checkbox" checked={!!supplierForm.cis_registered} onChange={(e) => setSupplierForm((current) => ({ ...current, cis_registered: e.target.checked }))} /> CIS registered</label>
            <label className="flex items-center gap-2 text-sm font-semibold text-stone-700"><input type="checkbox" checked={!!supplierForm.reverse_charge} onChange={(e) => setSupplierForm((current) => ({ ...current, reverse_charge: e.target.checked }))} /> Reverse charge</label>
            <Button disabled={busy || saving} className="w-full gap-2" style={{ background: "var(--brand)" }}><Plus className="h-4 w-4" /> Create supplier</Button>
          </form>
        </Panel>
      </div>
    );
  }

  if (activeTab === "Settings") {
    return (
      <Panel title="Accounts Payable settings">
        <form onSubmit={saveSettings} className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="flex items-center gap-2 rounded-md border border-stone-200 p-3 text-sm font-semibold text-stone-700"><input type="checkbox" checked={!!settingsForm.approval_required} onChange={(e) => setSettingsForm((current) => ({ ...current, approval_required: e.target.checked }))} /> Approval required</label>
          <label className="flex items-center gap-2 rounded-md border border-stone-200 p-3 text-sm font-semibold text-stone-700"><input type="checkbox" checked={!!settingsForm.duplicate_invoice_warning} onChange={(e) => setSettingsForm((current) => ({ ...current, duplicate_invoice_warning: e.target.checked }))} /> Duplicate warning</label>
          <label className="flex items-center gap-2 rounded-md border border-stone-200 p-3 text-sm font-semibold text-stone-700"><input type="checkbox" checked={!!settingsForm.allow_future_posting_dates} onChange={(e) => setSettingsForm((current) => ({ ...current, allow_future_posting_dates: e.target.checked }))} /> Future posting dates</label>
          <label className="flex items-center gap-2 rounded-md border border-stone-200 p-3 text-sm font-semibold text-stone-700"><input type="checkbox" checked={!!settingsForm.automatic_invoice_numbering} onChange={(e) => setSettingsForm((current) => ({ ...current, automatic_invoice_numbering: e.target.checked }))} /> Automatic invoice numbering</label>
          <Field label="Default terms days" value={settingsForm.default_payment_terms_days} onChange={(value) => setSettingsForm((current) => ({ ...current, default_payment_terms_days: value }))} />
          <AccountCodeSelect label="Default purchase account" accounts={expenseAccounts} value={settingsForm.default_purchase_account} onChange={(value) => setSettingsForm((current) => ({ ...current, default_purchase_account: value }))} />
          <Field label="Default VAT code" value={settingsForm.default_vat_code} onChange={(value) => setSettingsForm((current) => ({ ...current, default_vat_code: value }))} />
          <Field label="Default currency" value={settingsForm.default_currency || "GBP"} onChange={(value) => setSettingsForm((current) => ({ ...current, default_currency: value }))} />
          <AccountCodeSelect label="Default bank account" accounts={bankAccounts} value={settingsForm.default_bank_account} onChange={(value) => setSettingsForm((current) => ({ ...current, default_bank_account: value }))} />
          <Field label="Supplier numbering" value={settingsForm.supplier_numbering || "Automatic"} onChange={(value) => setSettingsForm((current) => ({ ...current, supplier_numbering: value }))} />
          <Field label="AI matching threshold" value={settingsForm.ai_matching_threshold || "85"} onChange={(value) => setSettingsForm((current) => ({ ...current, ai_matching_threshold: value }))} />
          <Field label="Document matching behaviour" value={settingsForm.document_matching_behaviour || "Suggest supplier ledger match"} onChange={(value) => setSettingsForm((current) => ({ ...current, document_matching_behaviour: value }))} />
          <Field label="Payment on account behaviour" value={settingsForm.payment_on_account_behaviour || "Keep unallocated until matched"} onChange={(value) => setSettingsForm((current) => ({ ...current, payment_on_account_behaviour: value }))} />
          <Field label="Expense behaviour" value={settingsForm.expense_behaviour || "Post direct expenses to selected nominal"} onChange={(value) => setSettingsForm((current) => ({ ...current, expense_behaviour: value }))} />
          <div className="md:col-span-2 xl:col-span-4"><Button disabled={busy || saving} style={{ background: "var(--brand)" }}>Save AP settings</Button></div>
        </form>
      </Panel>
    );
  }

  return null;
}

function SupplierSelect({ suppliers, value, onChange }) {
  const supplierRows = Array.isArray(suppliers) ? suppliers : [];
  return (
    <div>
      <Label className="text-xs font-semibold text-stone-600">Supplier</Label>
      <select value={value || ""} onChange={(e) => onChange(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-stone-200 bg-white px-3 text-sm shadow-sm">
        <option value="">Select supplier</option>
        {supplierRows.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
      </select>
    </div>
  );
}

export default AccountsPayableWorkspace;
