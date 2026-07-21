import React, { useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Download, FileText, Plus, Printer, RefreshCw, Search, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  AccountCodeSelect,
  Field,
  Panel,
  SelectField,
  SummaryCard,
  VatCodeSelect,
  canonicalVatCodeValue,
  formatDate,
  formatDateTime,
  formatMoney,
  statusBadgeClass,
  vatCodeOptionsFromWorkspace,
} from "./shared";

const bankTabs = ["Reconciliation", "Bank Statements", "Account Transactions"];
const reconciliationStatuses = new Set(["unreconciled", "pending", "awaiting_match", "unmatched", "imported", "documentation_requested"]);
const creationActions = [
  "Create receipt",
  "Create payment",
  "Create transfer",
  "Create direct expense",
  "Create direct income",
  "Import statement",
];

function BankingWorkspace({ workspace, tab = "Dashboard", reloadWorkspace, busy }) {
  const banking = workspace.banking || {};
  const transactions = useMemo(() => banking.transactions || workspace.bank_transactions || [], [banking.transactions, workspace.bank_transactions]);
  const outstandingAccountTransactions = useMemo(
    () => banking.outstanding_account_transactions || banking.account_transactions || banking.reconcilable_transactions || [],
    [banking.outstanding_account_transactions, banking.account_transactions, banking.reconcilable_transactions]
  );
  const imports = useMemo(() => banking.imports || [], [banking.imports]);
  const accounts = useMemo(() => workspace.accounts || [], [workspace.accounts]);
  const supportsBankingAccountFlag = useMemo(() => accounts.some((account) => "show_in_banking" in account || "banking_enabled" in account), [accounts]);
  const bankEnabledChartAccounts = useMemo(() => accounts.filter(isBankingEnabledAccount), [accounts]);
  const bankAccounts = useMemo(() => supportsBankingAccountFlag ? bankEnabledChartAccounts : banking.bank_accounts || [], [supportsBankingAccountFlag, bankEnabledChartAccounts, banking.bank_accounts]);
  const vatCodes = useMemo(() => vatCodeOptionsFromWorkspace(workspace), [workspace]);
  const usingBankingFallback = !supportsBankingAccountFlag && (banking.bank_accounts || []).length > 0;
  const postingAccounts = accounts.filter((account) => account.active && account.purpose !== "Bank Account" && String(account.account_type || "").toLowerCase() !== "bank");
  const activeBankAccounts = bankAccounts.filter((account) => account.active !== false);
  const defaultBankId = banking.settings?.default_bank_account_id || activeBankAccounts[0]?.id || bankAccounts[0]?.id || "";
  const baseUrl = `/admin/accounting/clients/${workspace.client.id}`;

  const [saving, setSaving] = useState(false);
  const [selectedBankId, setSelectedBankId] = useState("");
  const [bankTab, setBankTab] = useState("Reconciliation");
  const [, setSelectedTransaction] = useState(null);
  const [selectedImportId, setSelectedImportId] = useState("");
  const [importFile, setImportFile] = useState(null);
  const [filters, setFilters] = useState({ bank_account_id: "", module: "", type: "", contact: "", date_from: "", date_to: "", status: "", search: "" });
  const [transactionForm, setTransactionForm] = useState({ bank_account_id: defaultBankId, transaction_date: "", description: "", reference: "", transaction_type: "manual_entry", money_in: "", money_out: "" });
  const [settingsForm, setSettingsForm] = useState(banking.settings || {});

  useEffect(() => {
    setSettingsForm(banking.settings || {});
  }, [banking.settings]);

  useEffect(() => {
    if (defaultBankId) {
      setTransactionForm((current) => ({ ...current, bank_account_id: current.bank_account_id || defaultBankId }));
    }
  }, [defaultBankId]);

  useEffect(() => {
    if (selectedBankId && !bankAccounts.some((account) => account.id === selectedBankId)) {
      setSelectedBankId("");
      setSelectedTransaction(null);
    }
  }, [bankAccounts, selectedBankId]);

  const selectedBank = bankAccounts.find((account) => account.id === selectedBankId) || null;
  const bankTransactions = useMemo(() => selectedBank ? transactions.filter((transaction) => rowBelongsToBank(transaction, selectedBank)) : [], [selectedBank, transactions]);
  const bankImports = useMemo(() => selectedBank ? imports.filter((item) => rowBelongsToBank(item, selectedBank) || !rowBankIdentityValues(item).length) : imports, [imports, selectedBank]);
  const unreconciled = useMemo(() => bankTransactions.filter(isReconciliationStatus), [bankTransactions]);
  const visibleAccountTransactions = useMemo(() => outstandingAccountTransactions.filter((transaction) => {
    const haystack = `${accountTransactionContact(transaction)} ${transaction.description || ""} ${transaction.reference || ""} ${transaction.suggested_bank_match || ""} ${transaction.matched_to || ""}`.toLowerCase();
    if (filters.bank_account_id) {
      const filterBank = bankAccounts.find((account) => account.id === filters.bank_account_id);
      if (filterBank && !rowBelongsToBank(transaction, filterBank)) return false;
      if (!filterBank && transactionBankId(transaction) !== filters.bank_account_id) return false;
    }
    if (filters.search && !haystack.includes(filters.search.toLowerCase())) return false;
    if (filters.status && String(transaction.status || "") !== filters.status) return false;
    if (filters.type && String(accountTransactionType(transaction)) !== filters.type) return false;
    if (filters.module && String(accountTransactionModule(transaction)) !== filters.module) return false;
    if (filters.contact && !accountTransactionContact(transaction).toLowerCase().includes(filters.contact.toLowerCase())) return false;
    if (filters.date_from && transactionDate(transaction) < filters.date_from) return false;
    if (filters.date_to && transactionDate(transaction) > filters.date_to) return false;
    return true;
  }), [outstandingAccountTransactions, filters, bankAccounts]);
  const selectedImport = bankImports.find((item) => item.id === selectedImportId) || null;
  const selectedImportLines = selectedImport ? importLines(selectedImport, bankTransactions) : [];

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

  async function createTransaction(e) {
    e.preventDefault();
    if (!transactionForm.money_in && !transactionForm.money_out) return toast.error("Enter money in or money out");
    const saved = await run(async () => api.post(`${baseUrl}/bank-transactions`, transactionForm), "Bank transaction added");
    if (saved) setTransactionForm((current) => ({ ...current, transaction_date: "", description: "", reference: "", money_in: "", money_out: "" }));
  }

  async function importStatement(e) {
    e.preventDefault();
    if (!importFile) return toast.error("Choose a CSV file to import");
    const bankId = selectedBank?.id || transactionForm.bank_account_id || defaultBankId;
    const data = new FormData();
    data.append("file", importFile);
    data.append("bank_account_id", bankId);
    data.append("bank_account_code", bankCode(bankAccounts.find((account) => account.id === bankId)) || "1200");
    setSaving(true);
    try {
      const { data: response } = await api.post(`${baseUrl}/bank-transactions/import`, data);
      const result = importResultCounts(response);
      showImportResult(result);
      await reloadWorkspace();
      setBankTab("Bank Statements");
      if (result.imported > 0) setImportFile(null);
    } catch (error) {
      toast.error(formatApiError(error));
    } finally {
      setSaving(false);
    }
  }

  async function reconcileToAccount(transaction, description, accountCode = "", extra = {}) {
    if (!accountCode) return toast.error("Choose a posting account");
    await run(async () => api.post(`${baseUrl}/bank-transactions/${transaction.id}/reconcile`, { account_code: accountCode, description: description || transaction.description, reference: transaction.reference, ...extra }), "Transaction reconciled");
    setSelectedTransaction(null);
  }

  async function reconcileSplitToAccounts(transaction, splitLines) {
    setSaving(true);
    try {
      await api.post(`${baseUrl}/bank-transactions/${transaction.id}/reconcile/split`, { lines: splitLines, reference: transaction.reference });
      toast.success("Split nominal reconciliation posted");
      await reloadWorkspace();
      setSelectedTransaction(null);
    } catch (e) {
      const status = e?.response?.status || e?.status;
      if (status === 404 || status === 405 || status === 501) {
        toast.error("Backend endpoint required: split nominal reconciliation.");
      } else {
        toast.error(formatApiError(e));
      }
    } finally {
      setSaving(false);
    }
  }

  async function matchSuggestion(transaction, suggestion) {
    await run(
      async () => api.post(`${baseUrl}/bank-transactions/${transaction.id}/match`, { match_type: suggestion.type || suggestion.record_type, record_id: suggestion.record_id || suggestion.id, confidence: suggestion.confidence }),
      "Suggested match posted"
    );
    setSelectedTransaction(null);
  }

  async function ignoreTransaction(transaction, reason = "") {
    await run(async () => api.post(`${baseUrl}/bank-transactions/${transaction.id}/ignore`, { reason }), "Transaction excluded");
    setSelectedTransaction(null);
  }

  async function sendToClientOutstandingItems(transaction, payload = {}) {
    setSaving(true);
    try {
      await api.post(`${baseUrl}/bank-transactions/${transaction.id}/send-to-client-outstanding-items`, payload);
      toast.success("Sent to client outstanding items");
      await reloadWorkspace();
      setSelectedTransaction(null);
    } catch (e) {
      const status = e?.response?.status || e?.status;
      if (status === 404 || status === 405 || status === 501) {
        toast.error("Backend endpoint required: send bank transaction to client outstanding items.");
      } else {
        toast.error(formatApiError(e));
      }
    } finally {
      setSaving(false);
    }
  }

  async function runBulkBankAction(kind, rows, backendRequiredMessage) {
    setSaving(true);
    try {
      const ids = rows.map(rowId).filter(Boolean);
      const endpoints = {
        delete: `${baseUrl}/bank-transactions/bulk-delete`,
        exclude: `${baseUrl}/bank-transactions/bulk-exclude`,
        send: `${baseUrl}/bank-transactions/bulk-send-to-client-outstanding-items`,
        unreconcile: `${baseUrl}/bank-transactions/bulk-unreconcile`,
      };
      await api.post(endpoints[kind], { ids, transactions: rows.map(bankTransactionIdentity) });
      toast.success("Bulk action completed");
      await reloadWorkspace();
      return { ok: true };
    } catch (e) {
      const status = e?.response?.status || e?.status;
      if ([404, 405, 501].includes(status)) return { ok: false, message: backendRequiredMessage };
      const message = formatApiError(e);
      toast.error(message);
      return { ok: false, message };
    } finally {
      setSaving(false);
    }
  }

  async function bulkDeleteAccountTransactions(rows) {
    setSaving(true);
    try {
      await api.post(`${baseUrl}/account-transactions/bulk-delete`, { transactions: rows.map(accountTransactionDeleteIdentity) });
      toast.success("Selected accounting transactions deleted");
      await reloadWorkspace();
      return { ok: true };
    } catch (e) {
      const status = e?.response?.status || e?.status;
      if ([404, 405, 501].includes(status)) return { ok: false, message: "Backend endpoint required: bulk delete account transactions." };
      const message = formatApiError(e);
      toast.error(message);
      return { ok: false, message };
    } finally {
      setSaving(false);
    }
  }

  async function saveSettings(e) {
    e.preventDefault();
    await run(async () => api.put(`${baseUrl}/bank/settings`, settingsForm), "Bank settings saved");
  }

  function openBank(account) {
    setSelectedBankId(account.id);
    setBankTab("Reconciliation");
    setSelectedTransaction(null);
    setTransactionForm((current) => ({ ...current, bank_account_id: account.id }));
  }

  function showBackendRequired(action) {
    toast.info(`Backend endpoint required for: ${action}.`);
  }

  if (tab === "Settings" && !selectedBank) {
    return (
      <Panel title="Banking settings">
        <form onSubmit={saveSettings} className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <BankAccountSelect label="Default bank account" bankAccounts={bankAccounts} value={settingsForm.default_bank_account_id} onChange={(value) => setSettingsForm((current) => ({ ...current, default_bank_account_id: value }))} />
          <AccountCodeSelect label="Default transfer account" accounts={accounts} value={settingsForm.default_transfer_account} onChange={(value) => setSettingsForm((current) => ({ ...current, default_transfer_account: value }))} />
          <AccountCodeSelect label="Bank charges account" accounts={postingAccounts} value={settingsForm.default_bank_charges_account} onChange={(value) => setSettingsForm((current) => ({ ...current, default_bank_charges_account: value }))} />
          <AccountCodeSelect label="Interest account" accounts={postingAccounts} value={settingsForm.default_interest_account} onChange={(value) => setSettingsForm((current) => ({ ...current, default_interest_account: value }))} />
          <AccountCodeSelect label="Suspense account" accounts={accounts} value={settingsForm.default_suspense_account} onChange={(value) => setSettingsForm((current) => ({ ...current, default_suspense_account: value }))} />
          <Field label="Statement prefix" value={settingsForm.statement_number_prefix} onChange={(value) => setSettingsForm((current) => ({ ...current, statement_number_prefix: value }))} />
          <Field label="Auto-match threshold" value={settingsForm.automatic_matching_threshold} onChange={(value) => setSettingsForm((current) => ({ ...current, automatic_matching_threshold: value }))} />
          <label className="mt-6 flex items-center gap-2 text-sm font-semibold text-stone-700"><input type="checkbox" checked={settingsForm.duplicate_detection !== false} onChange={(e) => setSettingsForm((current) => ({ ...current, duplicate_detection: e.target.checked }))} /> Duplicate detection</label>
          <Button disabled={busy || saving} className="md:col-span-2 xl:col-span-4" style={{ background: "var(--brand)" }}>Save banking settings</Button>
        </form>
      </Panel>
    );
  }

  if (!selectedBank) {
    return (
      <div className="space-y-4">
        {usingBankingFallback ? <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">Backend required: persist banking_enabled/show_in_banking on accounting accounts and use it to populate Banking cards. Showing existing Banking records for now.</div> : null}
        <Panel title="Bank accounts">
          {bankAccounts.length ? (
            <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {bankAccounts.map((account) => (
                <BankAccountCard
                  key={account.id || bankCode(account)}
                  account={account}
                  unreconciledCount={bankUnreconciledCount(account, transactions)}
                  lastImport={lastImportDate(account, imports, transactions)}
                  onOpen={() => openBank(account)}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-stone-300 bg-stone-50 p-10 text-center">
              <FileText className="mx-auto h-8 w-8 text-stone-400" />
              <div className="mt-3 font-semibold text-stone-900">No bank accounts are enabled for Banking.</div>
              <p className="mt-1 text-sm text-stone-500">Enable a bank account from Chart of Accounts.</p>
            </div>
          )}
        </Panel>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button type="button" variant="outline" onClick={() => setSelectedBankId("")}><ArrowLeft className="mr-2 h-4 w-4" /> Back to bank accounts</Button>
          <h3 className="mt-3 font-display text-2xl font-semibold text-stone-900">{bankName(selectedBank) || "Bank account"}</h3>
          <p className="text-sm text-stone-500">{[selectedBank.bank_name, selectedBank.sort_code, selectedBank.account_number].filter(Boolean).join(" - ") || "Chart of Accounts bank-enabled account"} | Nominal {bankCode(selectedBank) || "-"}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {bankTabs.map((item) => (
            <Button key={item} type="button" variant={bankTab === item ? "default" : "outline"} onClick={() => { setBankTab(item); setSelectedTransaction(null); if (item === "Account Transactions") setFilters((current) => ({ ...current, bank_account_id: "" })); }}>
              {item}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <SummaryCard label="Current balance" value={formatMoney(selectedBank.current_balance)} tone="emerald" />
        <SummaryCard label="Reconciled balance" value={formatMoney(selectedBank.reconciled_balance)} tone="blue" />
        <SummaryCard label="Unreconciled items" value={unreconciled.length} tone="amber" />
        <SummaryCard label="Last import" value={formatDate(lastImportDate(selectedBank, imports, transactions))} tone="stone" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-stone-200 bg-white p-3">
        <div className="flex flex-wrap gap-2">
          {creationActions.map((action) => (
            <Button key={action} type="button" variant="outline" size="sm" onClick={() => action === "Import statement" ? setBankTab("Bank Statements") : showBackendRequired(action)}>
              {action === "Import statement" ? <Upload className="mr-2 h-4 w-4" /> : <Plus className="mr-2 h-4 w-4" />}
              {action}
            </Button>
          ))}
        </div>
        <Button type="button" variant="outline" size="sm" disabled={busy || saving} onClick={reloadWorkspace}><RefreshCw className="mr-2 h-4 w-4" /> Refresh</Button>
      </div>
      {bankTab === "Reconciliation" ? (
        <ReconciliationTab
          transactions={unreconciled}
          outstandingTransactions={outstandingAccountTransactions}
          bankAccounts={bankAccounts}
          selectedBankId={selectedBankId}
          postingAccounts={postingAccounts}
          vatCodes={vatCodes}
          matchSuggestion={matchSuggestion}
          reconcileToAccount={reconcileToAccount}
          reconcileSplitToAccounts={reconcileSplitToAccounts}
          ignoreTransaction={ignoreTransaction}
          sendToClientOutstandingItems={sendToClientOutstandingItems}
          bulkAction={runBulkBankAction}
          saving={saving || busy}
        />
      ) : null}

      {bankTab === "Bank Statements" ? (
        <BankStatementsTab
          imports={bankImports}
          statementLines={bankTransactions}
          selectedImportId={selectedImportId}
          setSelectedImportId={setSelectedImportId}
          selectedImportLines={selectedImportLines}
          importFile={importFile}
          setImportFile={setImportFile}
          importStatement={importStatement}
          bulkAction={runBulkBankAction}
          busy={busy || saving}
        />
      ) : null}

      {bankTab === "Account Transactions" ? (
        <AccountTransactionsTab
          filters={filters}
          setFilters={setFilters}
          transactions={visibleAccountTransactions}
          allTransactions={outstandingAccountTransactions}
          bankAccounts={bankAccounts}
          bulkDelete={bulkDeleteAccountTransactions}
          busy={busy || saving}
          exportTransactions={() => exportRows(visibleAccountTransactions, "all-outstanding-account-transactions.csv")}
        />
      ) : null}
    </div>
  );
}

function BankAccountCard({ account, unreconciledCount, lastImport, onOpen }) {
  return (
    <button type="button" onClick={onOpen} className="rounded-md border border-stone-200 bg-white p-4 text-left shadow-sm transition hover:border-emerald-300 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="font-display text-base font-semibold text-stone-900">{bankName(account) || "Unnamed bank account"}</h4>
          <p className="mt-0.5 text-xs text-stone-500">{account.bank_name || "Bank"} {account.sort_code || account.account_number ? `- ${[account.sort_code, account.account_number].filter(Boolean).join(" / ")}` : ""}</p>
        </div>
        <Badge className={statusBadgeClass(account.active === false ? "inactive" : "active")}>{account.active === false ? "Inactive" : "Active"}</Badge>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-md bg-emerald-50 px-3 py-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Current balance</div>
          <div className="mt-1 font-display text-lg font-bold text-emerald-900">{formatMoney(account.current_balance)}</div>
        </div>
        <div className="rounded-md bg-sky-50 px-3 py-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-sky-700">Reconciled</div>
          <div className="mt-1 font-display text-lg font-bold text-sky-900">{formatMoney(account.reconciled_balance)}</div>
        </div>
      </div>
      <div className="mt-3 grid gap-1 text-xs text-stone-500">
        <div className="flex items-center justify-between gap-2"><span>Nominal account</span><span className="font-medium text-stone-700">{bankCode(account) || "-"}</span></div>
        <div className="flex items-center justify-between gap-2"><span>Unreconciled</span><span className="font-medium text-stone-700">{unreconciledCount}</span></div>
        <div className="flex items-center justify-between gap-2"><span>Last statement/import</span><span className="font-medium text-stone-700">{lastImport ? formatDate(lastImport) : "-"}</span></div>
      </div>
    </button>
  );
}

function ReconciliationTab({ transactions, outstandingTransactions, bankAccounts, selectedBankId, postingAccounts, vatCodes, matchSuggestion, reconcileToAccount, reconcileSplitToAccounts, ignoreTransaction, sendToClientOutstandingItems, bulkAction, saving }) {
  const [expanded, setExpanded] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkMessage, setBulkMessage] = useState("");
  const activeKey = expanded ? `${expanded.id}-${expanded.action}` : "";
  const selectedRows = selectedRowsFromIds(transactions, selectedIds);
  const allVisibleSelected = transactions.length > 0 && selectedRows.length === transactions.length;

  useEffect(() => {
    setSelectedIds([]);
    setBulkMessage("");
    setExpanded(null);
  }, [transactions]);

  function toggle(transaction, action) {
    const key = `${transaction.id}-${action}`;
    if (action === "send" && isSentToClient(transaction) && !window.confirm("This bank transaction has already been sent to the client. Send again?")) return;
    setExpanded(activeKey === key ? null : { id: transaction.id, action });
  }

  function toggleSelected(transaction) {
    const id = rowId(transaction);
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function toggleAll() {
    setSelectedIds(allVisibleSelected ? [] : transactions.map(rowId).filter(Boolean));
  }

  async function runBulk(kind, message) {
    setBulkMessage("");
    const result = await bulkAction(kind, selectedRows, message);
    if (result?.ok) setSelectedIds([]);
    if (result?.message) setBulkMessage(result.message);
  }

  return (
    <Panel title="Unreconciled statement lines">
      <BulkActionBar selectedCount={selectedRows.length} onClear={() => setSelectedIds([])} message={bulkMessage}>
        <Button type="button" size="sm" variant="outline" disabled={!selectedRows.length || saving} onClick={() => runBulk("delete", "Backend endpoint required: bulk delete bank statement lines.")}>Delete</Button>
        <Button type="button" size="sm" variant="outline" disabled={!selectedRows.length || saving} onClick={() => runBulk("exclude", "Backend endpoint required: bulk exclude bank statement lines.")}>Exclude</Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!selectedRows.length || saving}
          onClick={() => {
            if (selectedRows.some(isSentToClient) && !window.confirm("This bank transaction has already been sent to the client. Send again?")) return;
            runBulk("send", "Backend endpoint required: bulk send bank transactions to client.");
          }}
        >
          Send to client
        </Button>
      </BulkActionBar>
      <div className="overflow-auto rounded-md border border-stone-200">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <th className="w-10 px-2 py-2"><input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} /></th>
              <th className="w-24 px-2 py-2">Date</th>
              <th className="min-w-72 px-2 py-2">Description</th>
              <th className="px-2 py-2 text-right">Money in</th>
              <th className="px-2 py-2 text-right">Money out</th>
              <th className="px-2 py-2">Match</th>
              <th className="px-2 py-2">Supplier/Customer</th>
              <th className="px-2 py-2">Direct</th>
              <th className="px-2 py-2">Transfer</th>
              <th className="px-2 py-2">Send to client</th>
              <th className="px-2 py-2">Exclude</th>
            </tr>
          </thead>
          <tbody>
            {transactions.length ? transactions.map((transaction) => {
              const rows = outstandingRowsForBankLine(transaction, outstandingTransactions);
              const isExpanded = expanded?.id === transaction.id;
              const moneyIn = Number(transaction.money_in || 0) > 0;
              const contactAction = moneyIn ? "Customer receipt" : "Supplier expense";
              const directAction = moneyIn ? "Direct income" : "Direct expense";
              const selected = selectedIds.includes(rowId(transaction));
              return (
                <React.Fragment key={transaction.id}>
                  <tr className={`border-t border-stone-100 align-top hover:bg-emerald-50/40 ${selected ? "bg-emerald-50/70" : ""}`}>
                    <td className="px-2 py-2"><input type="checkbox" checked={selected} onChange={() => toggleSelected(transaction)} onClick={(event) => event.stopPropagation()} /></td>
                    <td className="whitespace-nowrap px-2 py-2">{formatDate(transactionDate(transaction))}</td>
                    <td className="px-2 py-2">
                      <div className="font-medium text-stone-900">{transaction.description || "-"}</div>
                      <div className="text-xs text-stone-500">{transaction.reference || "No reference"}</div>
                    </td>
                    <td className="px-2 py-2 text-right text-emerald-700">{Number(transaction.money_in || 0) ? formatMoney(transaction.money_in) : "-"}</td>
                    <td className="px-2 py-2 text-right">{Number(transaction.money_out || 0) ? formatMoney(transaction.money_out) : "-"}</td>
                    <td className="px-2 py-2"><Button type="button" size="sm" variant="outline" onClick={() => toggle(transaction, "match")}>Match</Button></td>
                    <td className="px-2 py-2"><Button type="button" size="sm" variant="outline" onClick={() => toggle(transaction, "contact")}>{contactAction}</Button></td>
                    <td className="px-2 py-2"><Button type="button" size="sm" variant="outline" onClick={() => toggle(transaction, "direct")}>{directAction}</Button></td>
                    <td className="px-2 py-2"><Button type="button" size="sm" variant="outline" onClick={() => toggle(transaction, "transfer")}>Transfer</Button></td>
                    <td className="px-2 py-2"><Button type="button" size="sm" variant="outline" onClick={() => toggle(transaction, "send")}>{isSentToClient(transaction) ? "Sent" : "Send"}</Button></td>
                    <td className="px-2 py-2"><Button type="button" size="sm" variant="outline" onClick={() => toggle(transaction, "exclude")}>Exclude</Button></td>
                  </tr>
                  {isExpanded ? (
                    <tr className="border-t border-emerald-100 bg-emerald-50/30">
                      <td colSpan="11" className="px-3 py-3">
                        <ReconciliationInlineWorkflow
                          action={expanded.action}
                          transaction={transaction}
                          outstandingRows={rows}
                          bankAccounts={bankAccounts}
                          selectedBankId={selectedBankId}
                          postingAccounts={postingAccounts}
                          vatCodes={vatCodes}
                          matchSuggestion={matchSuggestion}
                          reconcileToAccount={reconcileToAccount}
                          reconcileSplitToAccounts={reconcileSplitToAccounts}
                          ignoreTransaction={ignoreTransaction}
                          sendToClientOutstandingItems={sendToClientOutstandingItems}
                          saving={saving}
                          onClose={() => setExpanded(null)}
                        />
                      </td>
                    </tr>
                  ) : null}
                </React.Fragment>
              );
            }) : <tr><td colSpan="11" className="px-3 py-10 text-center text-stone-500">No unreconciled statement lines for this bank account.</td></tr>}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function ReconciliationInlineWorkflow({ action, transaction, outstandingRows, bankAccounts, selectedBankId, postingAccounts, vatCodes, matchSuggestion, reconcileToAccount, reconcileSplitToAccounts, ignoreTransaction, sendToClientOutstandingItems, saving }) {
  if (action === "match") return <MatchWorkflow transaction={transaction} rows={outstandingRows} matchSuggestion={matchSuggestion} saving={saving} />;
  if (action === "contact") return <SupplierCustomerWorkflow transaction={transaction} rows={outstandingRows} postingAccounts={postingAccounts} vatCodes={vatCodes} saving={saving} />;
  if (action === "direct") return <DirectNominalWorkflow transaction={transaction} postingAccounts={postingAccounts} vatCodes={vatCodes} reconcileToAccount={reconcileToAccount} reconcileSplitToAccounts={reconcileSplitToAccounts} saving={saving} />;
  if (action === "transfer") return <TransferWorkflow transaction={transaction} bankAccounts={bankAccounts} selectedBankId={selectedBankId} />;
  if (action === "send") return <SendClientWorkflow transaction={transaction} sendToClientOutstandingItems={sendToClientOutstandingItems} saving={saving} />;
  if (action === "exclude") return <ExcludeWorkflow transaction={transaction} ignoreTransaction={ignoreTransaction} saving={saving} />;
  return null;
}

function MatchWorkflow({ transaction, rows, matchSuggestion, saving }) {
  const [query, setQuery] = useState("");
  const suggestedRows = useMemo(() => outstandingSuggestions(transaction, rows).map((suggestion) => rows.find((row) => String(row.id || row.record_id || "") === suggestionRecordId(suggestion))).filter(Boolean), [rows, transaction]);
  const [selectedIds, setSelectedIds] = useState(() => suggestedRows.map((row) => String(row.id || row.reference)));

  useEffect(() => {
    setSelectedIds(suggestedRows.map((row) => String(row.id || row.reference)));
  }, [suggestedRows]);

  const visibleRows = rows.filter((row) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return `${accountTransactionContact(row)} ${accountTransactionType(row)} ${row.reference || ""} ${row.document_number || ""} ${row.invoice_number || ""}`.toLowerCase().includes(q);
  });
  const selectedRows = rows.filter((row) => selectedIds.includes(String(row.id || row.reference)));
  const selectedTotal = selectedRows.reduce((total, row) => total + Math.abs(Number(accountTransactionOutstanding(row) || accountTransactionAmount(row) || 0)), 0);
  const bankAmount = Math.abs(transactionAmount(transaction));
  const difference = bankAmount - selectedTotal;
  const validMatch = selectedRows.length > 0 && Math.abs(difference) < 0.01;

  function addSelected(row) {
    const id = String(row.id || row.reference);
    setSelectedIds((current) => current.includes(id) ? current : [...current, id]);
  }

  function removeSelected(row) {
    const id = String(row.id || row.reference);
    setSelectedIds((current) => current.filter((item) => item !== id));
  }

  if (!rows.length) return <InlineBackendMessage message="Backend endpoint required: outstanding account transactions for reconciliation." />;

  return (
    <div className="grid gap-3 rounded-md border border-stone-200 bg-white p-3 xl:grid-cols-[1fr_320px]">
      <div>
        <h4 className="mb-2 text-sm font-semibold text-stone-900">Open transactions ready for allocation</h4>
        <Input className="mb-2 h-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search outstanding transactions" />
        <div className="max-h-72 overflow-auto rounded-md border border-stone-200">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-stone-50 uppercase tracking-wide text-stone-500">
              <tr><th className="px-2 py-2">Date</th><th className="px-2 py-2">Type</th><th className="px-2 py-2">Contact/account</th><th className="px-2 py-2">Reference</th><th className="px-2 py-2 text-right">Outstanding</th><th className="px-2 py-2">Action</th></tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.id || row.reference} className={`border-t border-stone-100 ${selectedRows.includes(row) ? "bg-emerald-50" : ""}`}>
                  <td className="whitespace-nowrap px-2 py-2">{formatDate(transactionDate(row))}</td>
                  <td className="px-2 py-2">{accountTransactionType(row) || "-"}</td>
                  <td className="px-2 py-2">{accountTransactionContact(row) || "-"}</td>
                  <td className="px-2 py-2">{row.reference || row.document_number || row.invoice_number || "-"}</td>
                  <td className="px-2 py-2 text-right">{accountTransactionOutstanding(row) !== "" ? formatMoney(accountTransactionOutstanding(row)) : formatMoney(accountTransactionAmount(row))}</td>
                  <td className="px-2 py-2"><Button type="button" size="sm" variant="outline" onClick={() => addSelected(row)}>Add</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div>
        <h4 className="mb-2 text-sm font-semibold text-stone-900">Selected transactions</h4>
        {selectedRows.length ? (
          <div className="space-y-2">
            {selectedRows.map((row) => (
              <div key={row.id || row.reference} className="rounded-md border border-stone-200 p-2 text-xs">
                <div className="font-semibold text-stone-900">{accountTransactionContact(row) || accountTransactionType(row) || "Selected transaction"}</div>
                <div className="text-stone-500">{row.reference || row.document_number || row.invoice_number || "-"} - {accountTransactionOutstanding(row) !== "" ? formatMoney(accountTransactionOutstanding(row)) : formatMoney(accountTransactionAmount(row))}</div>
                <Button type="button" size="sm" variant="ghost" className="mt-1 h-7 px-0" onClick={() => removeSelected(row)}>Remove</Button>
              </div>
            ))}
          </div>
        ) : <p className="rounded-md border border-dashed border-stone-300 p-3 text-sm text-stone-500">No transactions selected.</p>}
        <WorkflowSummary title="Match total" rows={[["Selected total", formatMoney(selectedTotal)], ["Bank amount", formatMoney(bankAmount)], ["Difference", formatMoney(difference)]]} />
        <Button type="button" className="mt-3 w-full" disabled={saving || !validMatch} onClick={() => selectedRows.forEach((row) => matchSuggestion(transaction, accountTransactionSuggestion(row)))} style={{ background: "var(--brand)" }}>Confirm match</Button>
      </div>
    </div>
  );
}

function SupplierCustomerWorkflow({ transaction, rows, postingAccounts, vatCodes, saving }) {
  const moneyIn = Number(transaction.money_in || 0) > 0;
  const [contact, setContact] = useState(transaction.suggested_contact_name || transaction.customer_name || transaction.supplier_name || "");
  const [description, setDescription] = useState(transaction.description || "");
  const [amount, setAmount] = useState(Math.abs(transactionAmount(transaction)));
  const [vatCode, setVatCode] = useState(transaction.suggested_vat_code || "");
  const [vatAmount, setVatAmount] = useState(transaction.suggested_vat_amount || "");
  const [nominalAccount, setNominalAccount] = useState(transaction.suggested_account_code || transaction.nominal_account_code || "");
  const outstandingLabel = moneyIn ? "Open sales invoices for allocation" : "Open supplier bills for allocation";
  const endpointMessage = moneyIn
    ? "Backend endpoint required: create customer receipt from bank reconciliation."
    : "Backend endpoint required: create supplier expense/payment from bank reconciliation.";

  return (
    <div className="space-y-3 rounded-md border border-stone-200 bg-white p-3">
      <div className="text-sm font-semibold text-stone-900">{moneyIn ? "Customer receipt" : "Supplier expense"}</div>
      <div className="grid gap-2 md:grid-cols-4">
        <Field label={moneyIn ? "Customer" : "Supplier"} value={contact} onChange={setContact} />
        <Field label={moneyIn ? "Description/reference" : "Description"} value={description} onChange={setDescription} />
        <Field label="Amount" value={amount} onChange={setAmount} />
        {!moneyIn ? <AccountCodeSelect label="Nominal account" accounts={postingAccounts} value={nominalAccount} onChange={setNominalAccount} /> : null}
        {!moneyIn ? <VatCodeSelect label="VAT code" value={vatCode} options={vatCodes} onChange={setVatCode} /> : null}
        {!moneyIn ? <Field label="VAT amount" value={vatAmount} onChange={setVatAmount} /> : null}
      </div>
      <div className="rounded-md border border-stone-200 p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">{outstandingLabel}</div>
        {rows.length ? (
          <div className="max-h-40 overflow-auto">
            {rows.slice(0, 5).map((row) => (
              <div key={row.id || row.reference} className="flex items-center justify-between gap-3 border-t border-stone-100 py-2 first:border-t-0">
                <div className="text-sm">
                  <div className="font-medium text-stone-900">{accountTransactionContact(row) || accountTransactionType(row) || "-"}</div>
                  <div className="text-xs text-stone-500">{row.reference || row.document_number || row.invoice_number || "-"}</div>
                </div>
                <div className="text-sm font-semibold text-stone-900">{accountTransactionOutstanding(row) !== "" ? formatMoney(accountTransactionOutstanding(row)) : formatMoney(accountTransactionAmount(row))}</div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-stone-500">No open allocation rows available from the backend.</p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" disabled={saving} variant="outline">{moneyIn ? "Confirm customer receipt" : "Confirm supplier expense/payment"}</Button>
        <InlineBackendMessage message={endpointMessage} />
      </div>
    </div>
  );
}

function DirectNominalWorkflow({ transaction, postingAccounts, vatCodes, reconcileToAccount, reconcileSplitToAccounts, saving }) {
  const moneyIn = Number(transaction.money_in || 0) > 0;
  const [accountCode, setAccountCode] = useState(transaction.suggested_account_code || transaction.nominal_account_code || "");
  const [description, setDescription] = useState(transaction.description || "");
  const [vatCode, setVatCode] = useState(transaction.suggested_vat_code || "");
  const [amount, setAmount] = useState(Math.abs(transactionAmount(transaction)));
  const [splitMode, setSplitMode] = useState(false);
  const [splitLines, setSplitLines] = useState([{ account_code: "", description: transaction.description || "", amount: Math.abs(transactionAmount(transaction)), vat_code: "", vat_amount: "" }]);
  const bankAmount = Math.abs(transactionAmount(transaction));
  const splitTotal = splitLines.reduce((total, line) => total + Number(line.amount || 0), 0);
  const splitBalanced = Math.abs(splitTotal - bankAmount) < 0.01;
  const hasVatCodes = vatCodes.length > 0;

  function updateLine(index, field, value) {
    setSplitLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, [field]: value } : line));
  }

  function postSplit() {
    if (!splitLines.every((line) => line.account_code && line.description && line.amount)) return toast.error("Each split line needs nominal account, description and amount.");
    if (!splitBalanced) return toast.error("Split total must equal the bank transaction amount.");
    reconcileSplitToAccounts(transaction, splitLines.map((line) => ({ ...line, vat_code: canonicalVatCodeValue(line.vat_code, vatCodes) })));
  }

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm font-semibold text-stone-700"><input type="checkbox" checked={splitMode} onChange={(event) => setSplitMode(event.target.checked)} /> Split transaction</label>
      {!splitMode ? (
        <div className="grid gap-2 md:grid-cols-4">
          <AccountCodeSelect label={moneyIn ? "Income nominal" : "Expense nominal"} accounts={postingAccounts} value={accountCode} onChange={setAccountCode} />
          <Field label="Description" value={description} onChange={setDescription} />
          <VatCodeSelect label="VAT code" value={vatCode} options={vatCodes} onChange={setVatCode} />
          <Field label="Amount" value={amount} onChange={setAmount} />
          <Button type="button" className="md:col-span-4" disabled={saving || !accountCode || !hasVatCodes} onClick={() => reconcileToAccount(transaction, description, accountCode, { vat_code: canonicalVatCodeValue(vatCode, vatCodes), amount })} style={{ background: "var(--brand)" }}>Post direct nominal reconciliation</Button>
        </div>
      ) : (
        <div className="space-y-2">
          {splitLines.map((line, index) => (
            <div key={index} className="grid gap-2 rounded-md border border-stone-200 p-2 md:grid-cols-5">
              <AccountCodeSelect label="Nominal account" accounts={postingAccounts} value={line.account_code} onChange={(value) => updateLine(index, "account_code", value)} />
              <Field label="Description" value={line.description} onChange={(value) => updateLine(index, "description", value)} />
              <Field label="Net/gross amount" value={line.amount} onChange={(value) => updateLine(index, "amount", value)} />
              <VatCodeSelect label="VAT code" value={line.vat_code} options={vatCodes} onChange={(value) => updateLine(index, "vat_code", value)} />
              <Field label="VAT amount" value={line.vat_amount} onChange={(value) => updateLine(index, "vat_amount", value)} />
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-stone-600">
            <span>Split total {formatMoney(splitTotal)} / Bank amount {formatMoney(bankAmount)}</span>
            <Button type="button" size="sm" variant="outline" onClick={() => setSplitLines((current) => [...current, { account_code: "", description: transaction.description || "", amount: "", vat_code: "", vat_amount: "" }])}>Add split line</Button>
          </div>
          <Button type="button" disabled={saving || !splitBalanced || !hasVatCodes} onClick={postSplit} style={{ background: "var(--brand)" }}>Post split nominal reconciliation</Button>
        </div>
      )}
    </div>
  );
}

function TransferWorkflow({ transaction, bankAccounts, selectedBankId }) {
  const otherAccounts = bankAccounts.filter((account) => account.id !== selectedBankId);
  const [otherBankId, setOtherBankId] = useState(transaction.suggested_bank_account_id || transaction.transfer_bank_account_id || otherAccounts[0]?.id || "");
  const [reference, setReference] = useState(transaction.reference || "");
  const [description, setDescription] = useState(transaction.description || "");
  const amount = Math.abs(transactionAmount(transaction));
  return (
    <div className="grid gap-2 rounded-md border border-stone-200 bg-white p-3 md:grid-cols-5">
      <BankAccountSelect label="Other bank account" bankAccounts={otherAccounts} value={otherBankId} onChange={setOtherBankId} />
      <Field label="Reference" value={reference} onChange={setReference} />
      <Field label="Description" value={description} onChange={setDescription} />
      <Field label="Amount" value={amount} onChange={() => {}} />
      <div className="pt-5"><Button type="button" variant="outline" className="w-full">Confirm transfer</Button></div>
      <InlineBackendMessage message="Backend endpoint required: bank transfer reconciliation." />
    </div>
  );
}

function SendClientWorkflow({ transaction, sendToClientOutstandingItems, saving }) {
  const [documentType, setDocumentType] = useState("Supporting document");
  return (
    <div className="grid gap-3 rounded-md border border-stone-200 bg-white p-3 md:grid-cols-[1fr_240px_auto]">
      <div>
        <div className="text-sm font-semibold text-stone-900">Send this bank transaction to the client outstanding items list?</div>
        <div className="mt-1 text-xs text-stone-500">{transaction.description || "Bank transaction"} - {formatMoney(Math.abs(transactionAmount(transaction)))}</div>
      </div>
      <SelectField label="Document type" value={documentType} onChange={setDocumentType} options={["Supporting document", "Purchase invoice", "Sales invoice", "Receipt", "Unknown"]} />
      <div className="pt-5"><Button type="button" disabled={saving} onClick={() => sendToClientOutstandingItems(transaction, { document_type: documentType })} style={{ background: "var(--brand)" }}>Send to client</Button></div>
    </div>
  );
}

function ExcludeWorkflow({ transaction, ignoreTransaction, saving }) {
  const [reason, setReason] = useState("");
  return (
    <div className="grid gap-2 rounded-md border border-stone-200 bg-white p-3 md:grid-cols-[1fr_auto]">
      <Field label="Reason" value={reason} onChange={setReason} />
      <div className="pt-5"><Button type="button" variant="outline" disabled={saving} onClick={() => ignoreTransaction(transaction, reason)}>Confirm exclude</Button></div>
      <p className="text-xs text-stone-500 md:col-span-2">Excluded lines disappear from Reconciliation after backend confirms and remain visible in Bank Statements as excluded/ignored.</p>
    </div>
  );
}

function WorkflowSummary({ title, rows }) {
  return (
    <div className="rounded-md border border-stone-200 p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">{title}</div>
      <div className="grid gap-1 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3"><span className="text-stone-500">{label}</span><span className="text-right font-medium text-stone-900">{value}</span></div>
        ))}
      </div>
    </div>
  );
}

function InlineBackendMessage({ message }) {
  return <div className="rounded-md border border-dashed border-stone-300 bg-stone-50 p-3 text-sm text-stone-600 md:col-span-full">{message}</div>;
}

function BulkActionBar({ selectedCount, onClear, message, children }) {
  if (!selectedCount && !message) return null;
  return (
    <div className="mb-3 rounded-md border border-stone-200 bg-stone-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold text-stone-900">{selectedCount} selected</div>
        <div className="flex flex-wrap gap-2">
          {children}
          {selectedCount ? <Button type="button" size="sm" variant="ghost" onClick={onClear}>Clear selection</Button> : null}
        </div>
      </div>
      {message ? <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{message}</div> : null}
    </div>
  );
}

function BankStatementsTab({ imports, statementLines, selectedImportId, setSelectedImportId, selectedImportLines, importFile, setImportFile, importStatement, bulkAction, busy }) {
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkMessage, setBulkMessage] = useState("");
  const sourceLines = selectedImportId ? selectedImportLines : statementLines;
  const linesToShow = sourceLines.filter((line) => {
    const status = normaliseStatus(line.status);
    if (!statusFilter) return true;
    if (statusFilter === "unreconciled") return isReconciliationStatus(line);
    if (statusFilter === "sent_to_client") return status === "documentation_requested" || status === "sent_to_client";
    if (statusFilter === "excluded") return status === "excluded" || status === "ignored";
    return status === statusFilter;
  });
  const unreconciledCount = statementLines.filter(isReconciliationStatus).length;
  const duplicateKeys = duplicateStatementKeys(sourceLines);
  const selectedRows = selectedRowsFromIds(linesToShow, selectedIds);
  const allVisibleSelected = linesToShow.length > 0 && selectedRows.length === linesToShow.length;
  const selectedHasReconciled = selectedRows.some((line) => ["reconciled", "matched"].includes(normaliseStatus(line.status)));
  const selectedCanUnreconcile = selectedRows.some((line) => ["reconciled", "matched"].includes(normaliseStatus(line.status)));
  const selectedHasNonReconciliation = selectedRows.some((line) => !isReconciliationStatus(line));

  useEffect(() => {
    setSelectedIds([]);
    setBulkMessage("");
  }, [selectedImportId, statusFilter, statementLines]);

  function toggleSelected(row) {
    const id = rowId(row);
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function toggleAll() {
    setSelectedIds(allVisibleSelected ? [] : linesToShow.map(rowId).filter(Boolean));
  }

  async function deleteSelected() {
    setBulkMessage("");
    if (selectedHasReconciled) {
      setBulkMessage("Reconciled statement lines must be unreconciled before they can be deleted.");
      return;
    }
    if (selectedHasNonReconciliation && !window.confirm("This statement line is not currently in Reconciliation. Delete from Bank Statements only?")) return;
    const result = await bulkAction("delete", selectedRows, "Backend endpoint required: bulk delete bank statement lines.");
    if (result?.ok) setSelectedIds([]);
    if (result?.message) setBulkMessage(result.message);
  }

  async function unreconcileSelected() {
    setBulkMessage("");
    const result = await bulkAction("unreconcile", selectedRows, "Backend endpoint required: bulk unreconcile bank statement lines.");
    if (result?.ok) setSelectedIds([]);
    if (result?.message) setBulkMessage(result.message);
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
      <Panel title="Bank statement lines">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold text-stone-900">Full statement reflection</div>
          <div className="flex items-center gap-2">
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-8 rounded-md border border-stone-200 bg-white px-2 text-sm shadow-sm">
              <option value="">All</option>
              <option value="unreconciled">Unreconciled</option>
              <option value="reconciled">Reconciled</option>
              <option value="excluded">Excluded</option>
            </select>
            <Badge className="bg-amber-100 text-amber-800">{unreconciledCount} unreconciled</Badge>
          </div>
        </div>
        <BulkActionBar selectedCount={selectedRows.length} onClear={() => setSelectedIds([])} message={selectedHasReconciled ? "Reconciled statement lines must be unreconciled before they can be deleted." : bulkMessage}>
          <Button type="button" size="sm" variant="outline" disabled={!selectedRows.length || selectedHasReconciled || busy} onClick={deleteSelected}>Delete</Button>
          <Button type="button" size="sm" variant="outline" disabled={!selectedRows.length || !selectedCanUnreconcile || busy} onClick={unreconcileSelected}>Unreconcile</Button>
        </BulkActionBar>
        <BankTransactionTable
          transactions={linesToShow}
          selectable
          selectedIds={selectedIds}
          allSelected={allVisibleSelected}
          onToggleAll={toggleAll}
          onToggleRow={toggleSelected}
          duplicateKeys={duplicateKeys}
          emptyMessage={imports.length ? "Imported batches exist, but no statement rows are visible for this bank. Backend bank identity mapping may need review." : "No bank transactions found."}
        />
      </Panel>
      <div className="space-y-4">
        <Panel title="Import statement">
          <form onSubmit={importStatement} className="space-y-3">
            <Input type="file" accept=".csv,text/csv" onChange={(e) => setImportFile(e.target.files?.[0] || null)} />
            <Button disabled={busy || !importFile} className="w-full gap-2" style={{ background: "var(--brand)" }}><Upload className="h-4 w-4" /> Import statement</Button>
            <p className="text-xs text-stone-500">Imported rows appear here. Unreconciled rows also appear in Reconciliation.</p>
          </form>
        </Panel>
        <Panel title="Import batches">
        <div className="overflow-auto rounded-md border border-stone-200">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
              <tr><th className="px-3 py-2">Import date</th><th className="px-3 py-2">Statement range</th><th className="px-3 py-2">Source</th><th className="px-3 py-2 text-right">Opening</th><th className="px-3 py-2 text-right">Closing</th><th className="px-3 py-2 text-right">Rows</th><th className="px-3 py-2 text-right">Reconciled</th><th className="px-3 py-2 text-right">Unreconciled</th><th className="px-3 py-2 text-right">Duplicates/skipped</th></tr>
            </thead>
            <tbody>
              {imports.length ? imports.map((item) => (
                <tr key={item.id} onClick={() => setSelectedImportId(item.id)} className={`cursor-pointer border-t border-stone-100 hover:bg-emerald-50/50 ${selectedImportId === item.id ? "bg-emerald-50/60" : ""}`}>
                  <td className="px-3 py-2">{formatDateTime(item.created_at || item.imported_at || item.import_date)}</td>
                  <td className="px-3 py-2">{[formatDate(item.statement_start_date), formatDate(item.statement_end_date)].filter((value) => value !== "-").join(" - ") || "-"}</td>
                  <td className="px-3 py-2">{item.source_type || item.provider || "CSV/manual"}</td>
                  <td className="px-3 py-2 text-right">{item.opening_balance !== undefined ? formatMoney(item.opening_balance) : "-"}</td>
                  <td className="px-3 py-2 text-right">{item.closing_balance !== undefined ? formatMoney(item.closing_balance) : "-"}</td>
                  <td className="px-3 py-2 text-right">{item.rows_imported ?? item.row_count ?? "-"}</td>
                  <td className="px-3 py-2 text-right">{item.rows_reconciled ?? item.reconciled_rows ?? "-"}</td>
                  <td className="px-3 py-2 text-right">{item.rows_unreconciled ?? item.unreconciled_rows ?? "-"}</td>
                  <td className="px-3 py-2 text-right">{item.duplicates ?? item.skipped_rows ?? item.duplicates_skipped ?? "-"}</td>
                </tr>
              )) : <tr><td colSpan="9" className="px-3 py-10 text-center text-stone-500">No statement imports for this bank account.</td></tr>}
            </tbody>
          </table>
        </div>
        {selectedImportId ? <Button type="button" variant="outline" className="mt-3 w-full" onClick={() => setSelectedImportId("")}>Show all statement lines</Button> : null}
        </Panel>
      </div>
    </div>
  );
}

function AccountTransactionsTab({ filters, setFilters, transactions, allTransactions, bankAccounts, bulkDelete, busy, exportTransactions }) {
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkMessage, setBulkMessage] = useState("");
  const moduleOptions = Array.from(new Set(allTransactions.map(accountTransactionModule).filter(Boolean)));
  const typeOptions = Array.from(new Set(allTransactions.map(accountTransactionType).filter(Boolean)));
  const statusOptions = Array.from(new Set(allTransactions.map((item) => item.status).filter(Boolean)));
  const selectedRows = selectedRowsFromIds(transactions, selectedIds);
  const allVisibleSelected = transactions.length > 0 && selectedRows.length === transactions.length;

  useEffect(() => {
    setSelectedIds([]);
    setBulkMessage("");
  }, [transactions]);

  function toggleSelected(row) {
    const id = rowId(row);
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function toggleAll() {
    setSelectedIds(allVisibleSelected ? [] : transactions.map(rowId).filter(Boolean));
  }

  async function deleteSelected() {
    setBulkMessage("");
    const result = await bulkDelete(selectedRows);
    if (result?.ok) setSelectedIds([]);
    if (result?.message) setBulkMessage(result.message);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-stone-200 bg-white p-3">
        <div className="mb-3 text-sm font-semibold text-stone-900">All outstanding account transactions</div>
        <div className="grid gap-2 md:grid-cols-4 xl:grid-cols-8">
          <BankAccountSelect label="Bank account" bankAccounts={bankAccounts} value={filters.bank_account_id} onChange={(value) => setFilters((current) => ({ ...current, bank_account_id: value }))} includeAll />
          <SelectField label="Module" value={filters.module} onChange={(value) => setFilters((current) => ({ ...current, module: value }))} options={["", ...moduleOptions]} />
          <SelectField label="Type" value={filters.type} onChange={(value) => setFilters((current) => ({ ...current, type: value }))} options={["", ...typeOptions]} />
          <Field label="Contact/account" value={filters.contact} onChange={(value) => setFilters((current) => ({ ...current, contact: value }))} />
          <Field label="Date from" type="date" value={filters.date_from} onChange={(value) => setFilters((current) => ({ ...current, date_from: value }))} />
          <Field label="Date to" type="date" value={filters.date_to} onChange={(value) => setFilters((current) => ({ ...current, date_to: value }))} />
          <SelectField label="Status" value={filters.status} onChange={(value) => setFilters((current) => ({ ...current, status: value }))} options={["", ...statusOptions]} />
          <div>
            <Label className="text-xs font-semibold text-stone-600">Search</Label>
            <div className="relative mt-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-stone-400" />
              <Input className="h-9 pl-9" value={filters.search} onChange={(e) => setFilters((current) => ({ ...current, search: e.target.value }))} placeholder="Search" />
            </div>
          </div>
          <div className="mt-5 flex gap-2">
            <Button type="button" variant="outline" className="gap-2" onClick={exportTransactions}><Download className="h-4 w-4" /> Export</Button>
            <Button type="button" variant="outline" className="gap-2" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print</Button>
          </div>
        </div>
      </div>
      <Panel title="All outstanding account transactions">
        <BulkActionBar selectedCount={selectedRows.length} onClear={() => setSelectedIds([])} message={bulkMessage}>
          <Button type="button" size="sm" variant="outline" disabled={!selectedRows.length || busy} onClick={deleteSelected}>Delete</Button>
        </BulkActionBar>
        <AccountTransactionTable
          transactions={transactions}
          selectable
          selectedIds={selectedIds}
          allSelected={allVisibleSelected}
          onToggleAll={toggleAll}
          onToggleRow={toggleSelected}
        />
      </Panel>
    </div>
  );
}

function transactionDate(transaction) {
  return transaction?.transaction_date || transaction?.date || transaction?.posted_at || transaction?.created_at || "";
}

function transactionBankId(transaction) {
  return transaction?.bank_account_id || transaction?.account_id || transaction?.bank_id || "";
}

function normaliseBankIdentity(value) {
  return String(value ?? "").trim().toLowerCase();
}

function compactBankIdentities(values) {
  return Array.from(new Set(values.map(normaliseBankIdentity).filter(Boolean)));
}

function bankIdentityValues(bank) {
  return compactBankIdentities([
    bank?.id,
    bank?.account_id,
    bank?.bank_account_id,
    bank?.code,
    bank?.account_code,
    bank?.nominal_account_code,
  ]);
}

function rowBankIdentityValues(row) {
  return compactBankIdentities([
    row?.bank_account_id,
    row?.account_id,
    row?.bank_id,
    row?.bank_account_code,
    row?.account_code,
    row?.nominal_account_code,
  ]);
}

function rowBelongsToBank(row, bank) {
  const bankValues = bankIdentityValues(bank);
  const rowValues = rowBankIdentityValues(row);
  if (!bankValues.length || !rowValues.length) return false;
  return rowValues.some((value) => bankValues.includes(value));
}

function rowId(row) {
  return String(row?.id || row?.record_id || row?.reference || row?.journal_reference || `${transactionDate(row)}-${row?.description || ""}-${row?.money_in || ""}-${row?.money_out || ""}`);
}

function selectedRowsFromIds(rows, selectedIds) {
  const ids = new Set(selectedIds);
  return rows.filter((row) => ids.has(rowId(row)));
}

function bankTransactionIdentity(row) {
  return {
    id: row?.id,
    bank_account_id: row?.bank_account_id,
    account_id: row?.account_id,
    bank_id: row?.bank_id,
    bank_account_code: row?.bank_account_code,
    account_code: row?.account_code,
    nominal_account_code: row?.nominal_account_code,
    status: row?.status,
  };
}

function accountTransactionDeleteIdentity(row) {
  return {
    module: accountTransactionModule(row),
    type: accountTransactionType(row),
    id: row?.id || row?.record_id,
  };
}

function isSentToClient(row) {
  const status = normaliseStatus(row?.status);
  return status === "documentation_requested" || status === "sent_to_client" || row?.sent_to_client === true || row?.client_outstanding_item_id;
}

function statementDuplicateKey(row) {
  return [
    transactionDate(row),
    normaliseText(row?.description),
    Number(row?.money_in || 0).toFixed(2),
    Number(row?.money_out || 0).toFixed(2),
  ].join("|");
}

function duplicateStatementKeys(rows) {
  const counts = rows.reduce((map, row) => {
    const key = statementDuplicateKey(row);
    map.set(key, (map.get(key) || 0) + 1);
    return map;
  }, new Map());
  return new Set(Array.from(counts.entries()).filter(([, count]) => count > 1).map(([key]) => key));
}

function importResultCounts(response = {}) {
  const errors = Array.isArray(response.errors) ? response.errors.length : Number(response.errors || response.error_count || 0);
  return {
    imported: Number(response.imported ?? response.rows_imported ?? response.imported_rows ?? 0),
    duplicates: Number(response.duplicates ?? response.duplicate_rows ?? response.rows_duplicate ?? response.skipped_duplicates ?? response.skipped_rows ?? 0),
    errors,
    errorSummary: Array.isArray(response.errors) ? response.errors.filter(Boolean).slice(0, 3).join("; ") : response.error_summary || response.message || "",
  };
}

function showImportResult(result) {
  if (result.imported > 0) {
    toast.success(`Bank statement imported: ${result.imported} rows imported.`);
    return;
  }
  if (result.duplicates > 0) {
    toast.info(`No new rows imported. ${result.duplicates} duplicate rows skipped.`);
    return;
  }
  if (result.errors > 0) {
    toast.warning(result.errorSummary || `${result.errors} rows could not be imported.`);
    return;
  }
  toast.warning("No bank statement rows were imported. Check the CSV format.");
}

function bankName(account) {
  return account?.account_name || account?.name || account?.accountName || "";
}

function bankCode(account) {
  return account?.nominal_account_code || account?.code || account?.account_code || "";
}

function isBankAccountType(account) {
  return account?.purpose === "Bank Account" || String(account?.account_type || account?.type || "").toLowerCase() === "bank";
}

function hasBankingFlag(account) {
  return account?.show_in_banking === true || account?.banking_enabled === true;
}

function isBankingEnabledAccount(account) {
  return account?.active !== false && isBankAccountType(account) && hasBankingFlag(account);
}

function accountTransactionModule(transaction) {
  return transaction?.module || transaction?.ledger_module || transaction?.source_module || transaction?.destination || "";
}

function accountTransactionType(transaction) {
  return transaction?.type || transaction?.transaction_type || transaction?.document_type || transaction?.record_type || "";
}

function accountTransactionContact(transaction) {
  return transaction?.contact_name || transaction?.customer_name || transaction?.supplier_name || transaction?.account_name || transaction?.contact || "";
}

function accountTransactionAmount(transaction) {
  return transaction?.amount ?? transaction?.gross_amount ?? transaction?.total ?? transaction?.balance ?? "";
}

function accountTransactionOutstanding(transaction) {
  return transaction?.outstanding_amount ?? transaction?.unallocated_amount ?? transaction?.remaining_amount ?? transaction?.amount_outstanding ?? "";
}

function transactionAmount(transaction) {
  const amount = Number(transaction?.money_in || 0) - Number(transaction?.money_out || 0);
  if (amount) return amount;
  return Number(accountTransactionOutstanding(transaction) || accountTransactionAmount(transaction) || 0);
}

function normaliseText(value) {
  return String(value || "").trim().toLowerCase();
}

function isApOutstandingTransaction(transaction) {
  const module = normaliseText(accountTransactionModule(transaction));
  const type = normaliseText(accountTransactionType(transaction));
  return module === "ap" || module.includes("payable") || type.includes("purchase") || type.includes("supplier");
}

function isArOutstandingTransaction(transaction) {
  const module = normaliseText(accountTransactionModule(transaction));
  const type = normaliseText(accountTransactionType(transaction));
  return module === "ar" || module.includes("receivable") || type.includes("sales") || type.includes("customer");
}

function outstandingRowsForBankLine(transaction, outstandingRows) {
  const moneyIn = Number(transaction?.money_in || 0) > 0;
  return outstandingRows.filter((item) => moneyIn ? isArOutstandingTransaction(item) : isApOutstandingTransaction(item));
}

function accountTransactionSuggestion(transaction) {
  return {
    id: transaction.id,
    record_id: transaction.id || transaction.record_id,
    record_type: accountTransactionType(transaction) || transaction.record_type || transaction.type,
    type: accountTransactionType(transaction) || transaction.record_type || transaction.type,
    label: accountTransactionLabel(transaction),
    contact_name: accountTransactionContact(transaction),
    reference: transaction.reference || transaction.document_number || transaction.invoice_number,
    amount: accountTransactionOutstanding(transaction) || accountTransactionAmount(transaction),
  };
}

function accountTransactionLabel(transaction) {
  return [accountTransactionContact(transaction), transaction.reference || transaction.document_number || transaction.invoice_number, accountTransactionType(transaction)]
    .filter(Boolean)
    .join(" - ") || "Outstanding transaction";
}

function suggestionRecordId(suggestion) {
  return String(suggestion?.record_id || suggestion?.id || "");
}

function suggestionRecordType(suggestion) {
  return normaliseText(suggestion?.type || suggestion?.record_type);
}


function outstandingSuggestions(transaction, outstandingRows) {
  const rawSuggestions = Array.isArray(transaction?.suggestions) ? transaction.suggestions : [];
  if (!rawSuggestions.length || !outstandingRows.length) return [];
  return rawSuggestions.reduce((matches, suggestion) => {
    const row = outstandingRows.find((item) => {
      const sameId = String(item.id || item.record_id || "") === suggestionRecordId(suggestion);
      const type = suggestionRecordType(suggestion);
      const sameType = !type || normaliseText(accountTransactionType(item)) === type || normaliseText(item.record_type) === type;
      return sameId && sameType;
    });
    if (row) {
      matches.push({
        ...suggestion,
        id: row.id,
        record_id: row.id || suggestion.record_id,
        type: suggestion.type || accountTransactionType(row) || row.record_type,
        record_type: suggestion.record_type || accountTransactionType(row) || row.record_type,
        label: accountTransactionLabel(row),
        contact_name: accountTransactionContact(row),
        reference: row.reference || row.document_number || row.invoice_number,
        amount: accountTransactionOutstanding(row) || accountTransactionAmount(row),
      });
    }
    return matches;
  }, []);
}

function normaliseStatus(status) {
  return String(status || "unreconciled").trim().toLowerCase();
}

function displayStatus(status) {
  const value = normaliseStatus(status);
  if (["pending", "awaiting_match", "unmatched", "imported"].includes(value)) return "Unreconciled";
  if (value === "documentation_requested") return "Documentation requested";
  if (value === "matched") return "Matched";
  if (value === "ignored" || value === "excluded") return "Excluded";
  if (value === "reconciled") return "Reconciled";
  return value ? value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Unreconciled";
}

function isReconciliationStatus(transaction) {
  return reconciliationStatuses.has(normaliseStatus(transaction?.status));
}

function bankUnreconciledCount(bank, transactions) {
  return transactions.filter((transaction) => rowBelongsToBank(transaction, bank) && isReconciliationStatus(transaction)).length;
}

function lastImportDate(bank, imports, transactions) {
  const importDates = imports.filter((item) => rowBelongsToBank(item, bank) || !rowBankIdentityValues(item).length).map((item) => item.created_at || item.imported_at || item.import_date);
  const transactionDates = transactions.filter((item) => rowBelongsToBank(item, bank) && (item.import_id || item.statement_import_id)).map(transactionDate);
  return [...importDates, ...transactionDates].filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0] || "";
}


function importLines(item, transactions) {
  if (Array.isArray(item?.lines)) return item.lines;
  const id = item?.id;
  return transactions.filter((transaction) => transaction.import_id === id || transaction.statement_import_id === id);
}

function BankAccountSelect({ bankAccounts = [], value, onChange, label = "Bank account", includeAll = false }) {
  return (
    <div>
      <Label className="text-xs font-semibold text-stone-600">{label}</Label>
      <select value={value || ""} onChange={(e) => onChange(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-stone-200 bg-white px-3 text-sm shadow-sm">
        <option value="">{includeAll ? "All bank accounts" : "Select bank account"}</option>
        {bankAccounts.map((account) => <option key={account.id || bankCode(account)} value={account.id}>{bankName(account)} - {bankCode(account)}</option>)}
      </select>
    </div>
  );
}

function BankTransactionTable({ transactions = [], emptyMessage = "No bank transactions found.", selectable = false, selectedIds = [], allSelected = false, onToggleAll, onToggleRow, duplicateKeys = new Set() }) {
  if (!transactions.length) return <p className="py-10 text-center text-sm text-stone-500">{emptyMessage}</p>;
  return (
    <div className="overflow-auto rounded-md border border-stone-200">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
          <tr>
            {selectable ? <th className="w-10 px-3 py-2"><input type="checkbox" checked={allSelected} onChange={onToggleAll} /></th> : null}
            <th className="px-3 py-2">Date</th>
            <th className="px-3 py-2">Description</th>
            <th className="px-3 py-2">Reference</th>
            <th className="px-3 py-2 text-right">Money in</th>
            <th className="px-3 py-2 text-right">Money out</th>
            <th className="px-3 py-2 text-right">Balance</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Matched / linked record</th>
            <th className="px-3 py-2">Journal reference</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((transaction) => {
            const selected = selectedIds.includes(rowId(transaction));
            const duplicate = duplicateKeys.has(statementDuplicateKey(transaction));
            return (
              <tr key={transaction.id || transaction.reference} className={`border-t border-stone-100 ${selected ? "bg-emerald-50/70" : duplicate ? "bg-amber-50/50" : ""}`}>
                {selectable ? <td className="px-3 py-2"><input type="checkbox" checked={selected} onChange={() => onToggleRow(transaction)} /></td> : null}
                <td className="whitespace-nowrap px-3 py-2">{formatDate(transactionDate(transaction))}</td>
                <td className="max-w-96 truncate px-3 py-2 font-medium text-stone-900">{transaction.description || "-"}</td>
                <td className="px-3 py-2 text-stone-600">{transaction.reference || "-"}</td>
                <td className="px-3 py-2 text-right text-emerald-700">{Number(transaction.money_in || 0) ? formatMoney(transaction.money_in) : "-"}</td>
                <td className="px-3 py-2 text-right">{Number(transaction.money_out || 0) ? formatMoney(transaction.money_out) : "-"}</td>
                <td className="px-3 py-2 text-right">{transaction.running_balance !== undefined ? formatMoney(transaction.running_balance) : transaction.balance !== undefined ? formatMoney(transaction.balance) : "-"}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge className={statusBadgeClass(normaliseStatus(transaction.status))}>{displayStatus(transaction.status)}</Badge>
                    {duplicate ? <Badge className="bg-amber-100 text-amber-800">Possible duplicate</Badge> : null}
                  </div>
                </td>
                <td className="px-3 py-2 text-stone-600">{transaction.linked_record || transaction.matched_to || transaction.suggested_match || "-"}</td>
                <td className="px-3 py-2 text-stone-600">{transaction.journal_reference || transaction.journal_id || "-"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AccountTransactionTable({ transactions = [], selectable = false, selectedIds = [], allSelected = false, onToggleAll, onToggleRow }) {
  if (!transactions.length) {
    return (
      <div className="rounded-md border border-dashed border-stone-300 bg-stone-50 p-8 text-center text-sm text-stone-600">
        Backend endpoint required: outstanding account transactions for reconciliation.
      </div>
    );
  }
  return (
    <div className="overflow-auto rounded-md border border-stone-200">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
          <tr>
            {selectable ? <th className="w-10 px-3 py-2"><input type="checkbox" checked={allSelected} onChange={onToggleAll} /></th> : null}
            <th className="px-3 py-2">Date</th>
            <th className="px-3 py-2">Module</th>
            <th className="px-3 py-2">Type</th>
            <th className="px-3 py-2">Contact/account</th>
            <th className="px-3 py-2">Reference</th>
            <th className="px-3 py-2 text-right">Amount</th>
            <th className="px-3 py-2 text-right">Outstanding / unallocated</th>
            <th className="px-3 py-2">Suggested bank match</th>
            <th className="px-3 py-2">Reconciliation status</th>
            <th className="px-3 py-2">Action</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((transaction) => {
            const selected = selectedIds.includes(rowId(transaction));
            return (
            <tr key={transaction.id || transaction.reference} className={`border-t border-stone-100 ${selected ? "bg-emerald-50/70" : ""}`}>
              {selectable ? <td className="px-3 py-2"><input type="checkbox" checked={selected} onChange={() => onToggleRow(transaction)} /></td> : null}
              <td className="whitespace-nowrap px-3 py-2">{formatDate(transactionDate(transaction))}</td>
              <td className="px-3 py-2 text-stone-600">{accountTransactionModule(transaction) || "-"}</td>
              <td className="px-3 py-2 font-medium text-stone-900">{accountTransactionType(transaction) || "-"}</td>
              <td className="px-3 py-2 text-stone-600">{accountTransactionContact(transaction) || "-"}</td>
              <td className="px-3 py-2 text-stone-600">{transaction.reference || transaction.document_number || transaction.invoice_number || "-"}</td>
              <td className="px-3 py-2 text-right">{accountTransactionAmount(transaction) !== "" ? formatMoney(accountTransactionAmount(transaction)) : "-"}</td>
              <td className="px-3 py-2 text-right">{accountTransactionOutstanding(transaction) !== "" ? formatMoney(accountTransactionOutstanding(transaction)) : "-"}</td>
              <td className="px-3 py-2 text-stone-600">{transaction.suggested_bank_match || transaction.suggested_match || "-"}</td>
              <td className="px-3 py-2"><Badge className={statusBadgeClass(normaliseStatus(transaction.status))}>{displayStatus(transaction.status)}</Badge></td>
              <td className="px-3 py-2">
                {transaction.view_url || transaction.match_supported ? (
                  <Button type="button" size="sm" variant="outline" onClick={() => toast.info("Backend endpoint required: account transaction view/match action.")}>{transaction.match_supported ? "Match" : "View"}</Button>
                ) : "-"}
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function exportRows(rows, filename) {
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
  const csv = [keys.join(","), ...rows.map((row) => keys.map((key) => `"${String(row[key] ?? "").replaceAll("\"", "\"\"")}"`).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.replace(/\s+/g, "-").toLowerCase();
  link.click();
  URL.revokeObjectURL(url);
}

export default BankingWorkspace;
