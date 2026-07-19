import React, { useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Download, Plus, Printer, RefreshCw, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  AccountCodeSelect,
  BankReportLine,
  Field,
  Info,
  Panel,
  SelectField,
  SummaryCard,
  formatDate,
  formatDateTime,
  formatMoney,
} from "./shared";

function BankingWorkspace({ workspace, tab = "Dashboard", reloadWorkspace, busy }) {
  const banking = workspace.banking || {};
  const bankAccounts = banking.bank_accounts || [];
  const transactions = banking.transactions || workspace.bank_transactions || [];
  const imports = banking.imports || [];
  const rules = banking.rules || [];
  const transfers = banking.transfers || [];
  const reports = banking.reports || {};
  const dashboard = banking.dashboard || {};
  const accounts = workspace.accounts || [];
  const postingAccounts = accounts.filter((account) => account.active && account.purpose !== "Bank Account" && String(account.account_type || "").toLowerCase() !== "bank");
  const activeBankAccounts = bankAccounts.filter((account) => account.active !== false);
  const defaultBankId = banking.settings?.default_bank_account_id || activeBankAccounts[0]?.id || bankAccounts[0]?.id || "";
  const [saving, setSaving] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [filters, setFilters] = useState({ date_from: "", date_to: "", bank_account_id: "", status: "", type: "", search: "" });
  const [transactionForm, setTransactionForm] = useState({ bank_account_id: defaultBankId, transaction_date: "", description: "", reference: "", transaction_type: "manual_entry", money_in: "", money_out: "" });
  const [accountForm, setAccountForm] = useState({ account_name: "", bank_name: "", account_number: "", sort_code: "", currency: "GBP", nominal_account_code: "", opening_balance: "", default_account: false, allow_payments: true, allow_receipts: true, active: true });
  const [ruleForm, setRuleForm] = useState({ name: "", field: "description", operator: "contains", value: "", amount_operator: "", amount_value: "", target_account_code: "", transaction_type: "", active: true });
  const [transferForm, setTransferForm] = useState({ from_bank_account_id: "", to_bank_account_id: "", transfer_date: "", reference: "", amount: "" });
  const [settingsForm, setSettingsForm] = useState(banking.settings || {});
  const [reconcileAccount, setReconcileAccount] = useState("");

  useEffect(() => {
    setSettingsForm(banking.settings || {});
  }, [banking.settings]);

  useEffect(() => {
    if (defaultBankId) {
      setTransactionForm((current) => ({ ...current, bank_account_id: current.bank_account_id || defaultBankId }));
      setTransferForm((current) => ({ ...current, from_bank_account_id: current.from_bank_account_id || defaultBankId }));
    }
  }, [defaultBankId]);

  const baseUrl = `/admin/accounting/clients/${workspace.client.id}`;

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

  const filteredTransactions = transactions.filter((transaction) => {
    const haystack = `${transaction.description || ""} ${transaction.reference || ""} ${transaction.matched_to || ""}`.toLowerCase();
    if (filters.search && !haystack.includes(filters.search.toLowerCase())) return false;
    if (filters.bank_account_id && transaction.bank_account_id !== filters.bank_account_id) return false;
    if (filters.status && transaction.status !== filters.status) return false;
    if (filters.type && transaction.transaction_type !== filters.type) return false;
    if (filters.date_from && transaction.transaction_date < filters.date_from) return false;
    if (filters.date_to && transaction.transaction_date > filters.date_to) return false;
    return true;
  });
  const unreconciled = transactions.filter((transaction) => !["reconciled", "ignored"].includes(transaction.status));

  async function createAccount(e) {
    e.preventDefault();
    if (!accountForm.account_name.trim()) return toast.error("Bank account name is required");
    await run(async () => api.post(`${baseUrl}/bank/accounts`, accountForm), "Bank account created");
    setAccountForm({ account_name: "", bank_name: "", account_number: "", sort_code: "", currency: "GBP", nominal_account_code: "", opening_balance: "", default_account: false, allow_payments: true, allow_receipts: true, active: true });
  }

  async function createTransaction(e) {
    e.preventDefault();
    if (!transactionForm.money_in && !transactionForm.money_out) return toast.error("Enter money in or money out");
    await run(async () => api.post(`${baseUrl}/bank-transactions`, transactionForm), "Bank transaction added");
    setTransactionForm((current) => ({ ...current, transaction_date: "", description: "", reference: "", money_in: "", money_out: "" }));
  }

  async function importStatement(e) {
    e.preventDefault();
    if (!importFile) return toast.error("Choose a CSV file to import");
    const data = new FormData();
    data.append("file", importFile);
    data.append("bank_account_id", transactionForm.bank_account_id || defaultBankId);
    data.append("bank_account_code", activeBankAccounts.find((account) => account.id === (transactionForm.bank_account_id || defaultBankId))?.nominal_account_code || "1200");
    await run(async () => api.post(`${baseUrl}/bank-transactions/import`, data), "Bank statement imported");
    setImportFile(null);
  }

  async function reconcileToAccount(transaction) {
    if (!reconcileAccount) return toast.error("Choose a posting account");
    await run(async () => api.post(`${baseUrl}/bank-transactions/${transaction.id}/reconcile`, { account_code: reconcileAccount, description: transaction.description, reference: transaction.reference }), "Transaction reconciled");
  }

  async function matchSuggestion(transaction, suggestion) {
    await run(
      async () => api.post(`${baseUrl}/bank-transactions/${transaction.id}/match`, { match_type: suggestion.type, record_id: suggestion.record_id, confidence: suggestion.confidence }),
      "Suggested match posted"
    );
  }

  async function ignoreTransaction(transaction) {
    await run(async () => api.post(`${baseUrl}/bank-transactions/${transaction.id}/ignore`, {}), "Transaction ignored");
  }

  async function undoTransaction(transaction) {
    await run(async () => api.post(`${baseUrl}/bank-transactions/${transaction.id}/undo`, {}), "Bank match undone");
  }

  async function createRule(e) {
    e.preventDefault();
    if (!ruleForm.name.trim() || !ruleForm.value.trim() || !ruleForm.target_account_code) return toast.error("Rule name, condition and target account are required");
    await run(async () => api.post(`${baseUrl}/bank/rules`, ruleForm), "Bank rule created");
    setRuleForm({ name: "", field: "description", operator: "contains", value: "", amount_operator: "", amount_value: "", target_account_code: "", transaction_type: "", active: true });
  }

  async function createTransfer(e) {
    e.preventDefault();
    if (!transferForm.from_bank_account_id || !transferForm.to_bank_account_id || !transferForm.amount) return toast.error("Choose accounts and amount");
    await run(async () => api.post(`${baseUrl}/bank/transfers`, transferForm), "Bank transfer posted");
    setTransferForm((current) => ({ ...current, transfer_date: "", reference: "", amount: "" }));
  }

  async function saveSettings(e) {
    e.preventDefault();
    await run(async () => api.put(`${baseUrl}/bank/settings`, settingsForm), "Bank settings saved");
  }

  if (tab === "Dashboard") {
    return (
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <SummaryCard label="Current bank balance" value={formatMoney(dashboard.current_bank_balance)} tone="emerald" />
          <SummaryCard label="Unreconciled" value={dashboard.unreconciled_transactions || 0} tone="amber" />
          <SummaryCard label="Imported lines" value={dashboard.imported_transactions || 0} tone="blue" />
          <SummaryCard label="Awaiting match" value={dashboard.awaiting_match || 0} tone="amber" />
          <SummaryCard label="Transfers this month" value={dashboard.transfers_this_month || 0} tone="stone" />
          <SummaryCard label="Last import" value={dashboard.last_bank_import ? formatDateTime(dashboard.last_bank_import) : "-"} tone="stone" />
        </div>
        <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <Panel title="Transactions awaiting reconciliation">
            <BankTransactionTable transactions={unreconciled.slice(0, 8)} compact />
          </Panel>
          <Panel title="Cash position">
            {bankAccounts.length === 0 ? <p className="py-8 text-center text-sm text-stone-500">No bank accounts yet.</p> : bankAccounts.map((account) => (
              <div key={account.id} className="flex items-center justify-between border-b border-stone-100 py-2 last:border-0">
                <div>
                  <div className="font-semibold text-stone-900">{account.account_name}</div>
                  <div className="text-xs text-stone-500">{account.bank_name || account.nominal_account_code}</div>
                </div>
                <div className="text-right">
                  <div className="font-semibold">{formatMoney(account.current_balance)}</div>
                  <div className="text-xs text-stone-500">Reconciled {formatMoney(account.reconciled_balance)}</div>
                </div>
              </div>
            ))}
          </Panel>
        </div>
        <Panel title="Recent banking activity">
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            {imports.slice(0, 3).map((item) => <Info key={item.id} label="Bank import" value={`${formatDateTime(item.created_at)} - ${item.rows_imported} rows`} />)}
            {transfers.slice(0, 3).map((item) => <Info key={item.id} label="Transfer posted" value={`${formatDate(item.transfer_date)} - ${formatMoney(item.amount)}`} />)}
            {transactions.filter((item) => item.status === "reconciled").slice(0, 3).map((item) => <Info key={item.id} label="Payment allocated" value={`${formatDate(item.transaction_date)} - ${formatMoney(Math.abs(bankAmount(item)))}`} />)}
            {imports.length === 0 && transfers.length === 0 && transactions.length === 0 && <p className="text-sm text-stone-500">No banking activity yet.</p>}
          </div>
        </Panel>
      </div>
    );
  }

  if (tab === "Bank Accounts") {
    return (
      <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
        <Panel title="Bank accounts">
          <div className="grid gap-3 md:grid-cols-2">
            {bankAccounts.map((account) => (
              <div key={account.id} className="rounded-md border border-stone-200 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-display text-lg font-bold text-stone-900">{account.account_name}</div>
                    <div className="text-sm text-stone-500">{account.bank_name || "Bank"} - {account.currency || "GBP"}</div>
                  </div>
                  <Badge className={account.active ? "bg-emerald-100 text-emerald-800" : "bg-stone-100 text-stone-600"}>{account.active ? "Active" : "Inactive"}</Badge>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <Info label="Nominal" value={account.nominal_account_code} />
                  <Info label="Current balance" value={formatMoney(account.current_balance)} />
                  <Info label="Reconciled balance" value={formatMoney(account.reconciled_balance)} />
                  <Info label="Opening balance" value={formatMoney(account.opening_balance)} />
                </div>
              </div>
            ))}
          </div>
          {bankAccounts.length === 0 && <p className="py-10 text-center text-sm text-stone-500">Create the first bank account to start importing statements.</p>}
        </Panel>
        <Panel title="Create bank account">
          <form onSubmit={createAccount} className="space-y-3">
            <Field label="Account name" value={accountForm.account_name} onChange={(value) => setAccountForm((current) => ({ ...current, account_name: value }))} />
            <Field label="Bank name" value={accountForm.bank_name} onChange={(value) => setAccountForm((current) => ({ ...current, bank_name: value }))} />
            <div className="grid grid-cols-2 gap-2">
              <Field label="Account number" value={accountForm.account_number} onChange={(value) => setAccountForm((current) => ({ ...current, account_number: value }))} />
              <Field label="Sort code" value={accountForm.sort_code} onChange={(value) => setAccountForm((current) => ({ ...current, sort_code: value }))} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Nominal code" value={accountForm.nominal_account_code} onChange={(value) => setAccountForm((current) => ({ ...current, nominal_account_code: value }))} />
              <Field label="Opening balance" value={accountForm.opening_balance} onChange={(value) => setAccountForm((current) => ({ ...current, opening_balance: value }))} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Currency" value={accountForm.currency} onChange={(value) => setAccountForm((current) => ({ ...current, currency: value }))} />
              <label className="mt-6 flex items-center gap-2 text-sm font-semibold text-stone-700"><input type="checkbox" checked={accountForm.default_account} onChange={(e) => setAccountForm((current) => ({ ...current, default_account: e.target.checked }))} /> Default account</label>
            </div>
            <div className="grid grid-cols-3 gap-2 text-sm font-semibold text-stone-700">
              <label className="flex items-center gap-2"><input type="checkbox" checked={accountForm.allow_payments} onChange={(e) => setAccountForm((current) => ({ ...current, allow_payments: e.target.checked }))} /> Payments</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={accountForm.allow_receipts} onChange={(e) => setAccountForm((current) => ({ ...current, allow_receipts: e.target.checked }))} /> Receipts</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={accountForm.active} onChange={(e) => setAccountForm((current) => ({ ...current, active: e.target.checked }))} /> Active</label>
            </div>
            <Button disabled={busy || saving} className="w-full gap-2" style={{ background: "var(--brand)" }}><Plus className="h-4 w-4" /> Create bank account</Button>
          </form>
        </Panel>
      </div>
    );
  }

  if (tab === "Transactions" || tab === "Cashbook") {
    return (
      <div className="space-y-4">
        <BankFilterBar filters={filters} setFilters={setFilters} bankAccounts={bankAccounts} />
        <Panel title={tab === "Cashbook" ? "Cashbook" : "Bank transaction register"}>
          <BankTransactionTable transactions={filteredTransactions} />
        </Panel>
        {tab === "Transactions" && (
          <Panel title="Manual bank entry">
            <form onSubmit={createTransaction} className="grid gap-3 md:grid-cols-6">
              <BankAccountSelect bankAccounts={activeBankAccounts} value={transactionForm.bank_account_id} onChange={(value) => setTransactionForm((current) => ({ ...current, bank_account_id: value }))} />
              <Field label="Date" type="date" value={transactionForm.transaction_date} onChange={(value) => setTransactionForm((current) => ({ ...current, transaction_date: value }))} />
              <Field label="Description" value={transactionForm.description} onChange={(value) => setTransactionForm((current) => ({ ...current, description: value }))} />
              <Field label="Reference" value={transactionForm.reference} onChange={(value) => setTransactionForm((current) => ({ ...current, reference: value }))} />
              <Field label="Money in" value={transactionForm.money_in} onChange={(value) => setTransactionForm((current) => ({ ...current, money_in: value, money_out: value ? "" : current.money_out }))} />
              <Field label="Money out" value={transactionForm.money_out} onChange={(value) => setTransactionForm((current) => ({ ...current, money_out: value, money_in: value ? "" : current.money_in }))} />
              <Button disabled={busy || saving} className="md:col-span-6" style={{ background: "var(--brand)" }}>Add transaction</Button>
            </form>
          </Panel>
        )}
      </div>
    );
  }

  if (tab === "Reconciliation") {
    return (
      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <Panel title="Statement transactions">
          <div className="space-y-3">
            {unreconciled.map((transaction) => (
              <div key={transaction.id} className="rounded-md border border-stone-200 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-stone-900">{formatDate(transaction.transaction_date)} - {transaction.description || transaction.reference}</div>
                    <div className="text-xs text-stone-500">{transaction.reference || "No reference"} - {transaction.transaction_type || "statement"}</div>
                  </div>
                  <div className={`font-display text-lg font-bold ${bankAmount(transaction) >= 0 ? "text-emerald-700" : "text-stone-900"}`}>{formatMoney(Math.abs(bankAmount(transaction)))}</div>
                </div>
                <div className="mt-3 rounded-md bg-stone-50 p-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">Suggested matches</div>
                  {(transaction.suggestions || []).length === 0 ? (
                    <p className="mt-2 text-sm text-stone-500">No confident match yet. Post to a nominal account or create a rule.</p>
                  ) : transaction.suggestions.map((suggestion) => (
                    <div key={`${transaction.id}-${suggestion.type}-${suggestion.record_id}`} className="mt-2 flex items-center justify-between gap-2">
                      <div>
                        <div className="text-sm font-semibold text-stone-900">{suggestion.label}</div>
                        <div className="text-xs text-stone-500">AI confidence {suggestion.confidence}%</div>
                      </div>
                      <Button size="sm" disabled={saving} onClick={() => matchSuggestion(transaction, suggestion)}>Match</Button>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" disabled={saving} onClick={() => ignoreTransaction(transaction)}>Ignore</Button>
                  {transaction.status === "reconciled" && <Button size="sm" variant="outline" disabled={saving} onClick={() => undoTransaction(transaction)}>Undo</Button>}
                </div>
              </div>
            ))}
            {unreconciled.length === 0 && <p className="py-10 text-center text-sm text-stone-500">No transactions awaiting reconciliation.</p>}
          </div>
        </Panel>
        <Panel title="Create adjustment">
          <div className="space-y-3">
            <AccountCodeSelect label="Post selected transaction to" accounts={postingAccounts} value={reconcileAccount} onChange={setReconcileAccount} />
            <p className="text-xs text-stone-500">Use this for bank charges, interest, journals, deposits, refunds and other adjustments when no invoice match exists.</p>
            {unreconciled.slice(0, 5).map((transaction) => (
              <Button key={transaction.id} variant="outline" disabled={saving || !reconcileAccount} className="w-full justify-between" onClick={() => reconcileToAccount(transaction)}>
                <span className="truncate">{transaction.description || transaction.reference}</span>
                <span>{formatMoney(Math.abs(bankAmount(transaction)))}</span>
              </Button>
            ))}
          </div>
        </Panel>
      </div>
    );
  }

  if (tab === "Bank Rules") {
    return (
      <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
        <Panel title="Bank rules">
          <div className="space-y-2">
            {rules.map((rule) => (
              <div key={rule.id} className="rounded-md border border-stone-200 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-stone-900">{rule.name}</div>
                    <div className="text-sm text-stone-500">{rule.field} {rule.operator} "{rule.value}"</div>
                  </div>
                  <Badge className={rule.active ? "bg-emerald-100 text-emerald-800" : "bg-stone-100 text-stone-600"}>{rule.active ? "Active" : "Inactive"}</Badge>
                </div>
                <div className="mt-2 text-xs text-stone-500">Post to {rule.target_account_code || "Suspense"} {rule.amount_value ? `when amount ${rule.amount_operator} ${formatMoney(rule.amount_value)}` : ""}</div>
              </div>
            ))}
            {rules.length === 0 && <p className="py-10 text-center text-sm text-stone-500">No bank rules yet.</p>}
          </div>
        </Panel>
        <Panel title="Create bank rule">
          <form onSubmit={createRule} className="space-y-3">
            <Field label="Rule name" value={ruleForm.name} onChange={(value) => setRuleForm((current) => ({ ...current, name: value }))} />
            <div className="grid grid-cols-2 gap-2">
              <SelectField label="Field" value={ruleForm.field} onChange={(value) => setRuleForm((current) => ({ ...current, field: value }))} options={["description", "reference"]} />
              <SelectField label="Operator" value={ruleForm.operator} onChange={(value) => setRuleForm((current) => ({ ...current, operator: value }))} options={["contains", "starts_with", "ends_with"]} />
            </div>
            <Field label="Value" value={ruleForm.value} onChange={(value) => setRuleForm((current) => ({ ...current, value }))} />
            <div className="grid grid-cols-2 gap-2">
              <SelectField label="Amount rule" value={ruleForm.amount_operator} onChange={(value) => setRuleForm((current) => ({ ...current, amount_operator: value }))} options={["", "equals", "greater_than", "less_than"]} />
              <Field label="Amount" value={ruleForm.amount_value} onChange={(value) => setRuleForm((current) => ({ ...current, amount_value: value }))} />
            </div>
            <AccountCodeSelect label="Target account" accounts={postingAccounts} value={ruleForm.target_account_code} onChange={(value) => setRuleForm((current) => ({ ...current, target_account_code: value }))} />
            <label className="flex items-center gap-2 text-sm font-semibold text-stone-700"><input type="checkbox" checked={ruleForm.active} onChange={(e) => setRuleForm((current) => ({ ...current, active: e.target.checked }))} /> Active</label>
            <Button disabled={busy || saving} className="w-full" style={{ background: "var(--brand)" }}>Create rule</Button>
          </form>
        </Panel>
      </div>
    );
  }

  if (tab === "Transfers") {
    return (
      <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
        <Panel title="Bank transfers">
          <div className="overflow-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500"><tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Reference</th><th className="px-3 py-2">From</th><th className="px-3 py-2">To</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2">Status</th></tr></thead>
              <tbody>{transfers.map((transfer) => <tr key={transfer.id} className="border-t border-stone-100"><td className="px-3 py-2">{formatDate(transfer.transfer_date)}</td><td className="px-3 py-2">{transfer.reference || "-"}</td><td className="px-3 py-2">{transfer.from_bank_account_id}</td><td className="px-3 py-2">{transfer.to_bank_account_id}</td><td className="px-3 py-2 text-right">{formatMoney(transfer.amount)}</td><td className="px-3 py-2">{transfer.status}</td></tr>)}</tbody>
            </table>
          </div>
        </Panel>
        <Panel title="Post transfer">
          <form onSubmit={createTransfer} className="space-y-3">
            <BankAccountSelect label="From bank account" bankAccounts={activeBankAccounts} value={transferForm.from_bank_account_id} onChange={(value) => setTransferForm((current) => ({ ...current, from_bank_account_id: value }))} />
            <BankAccountSelect label="To bank account" bankAccounts={activeBankAccounts} value={transferForm.to_bank_account_id} onChange={(value) => setTransferForm((current) => ({ ...current, to_bank_account_id: value }))} />
            <Field label="Transfer date" type="date" value={transferForm.transfer_date} onChange={(value) => setTransferForm((current) => ({ ...current, transfer_date: value }))} />
            <Field label="Reference" value={transferForm.reference} onChange={(value) => setTransferForm((current) => ({ ...current, reference: value }))} />
            <Field label="Amount" value={transferForm.amount} onChange={(value) => setTransferForm((current) => ({ ...current, amount: value }))} />
            <Button disabled={busy || saving} className="w-full" style={{ background: "var(--brand)" }}>Post transfer</Button>
          </form>
        </Panel>
      </div>
    );
  }

  if (tab === "Imported Statements") {
    return (
      <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
        <Panel title="Imported statements">
          <div className="overflow-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500"><tr><th className="px-3 py-2">Import date</th><th className="px-3 py-2">File</th><th className="px-3 py-2">Provider</th><th className="px-3 py-2 text-right">Rows</th><th className="px-3 py-2 text-right">Duplicates</th><th className="px-3 py-2 text-right">Errors</th><th className="px-3 py-2">Status</th></tr></thead>
              <tbody>{imports.map((item) => <tr key={item.id} className="border-t border-stone-100"><td className="px-3 py-2">{formatDateTime(item.created_at)}</td><td className="px-3 py-2">{item.filename}</td><td className="px-3 py-2">{item.provider}</td><td className="px-3 py-2 text-right">{item.rows_imported}</td><td className="px-3 py-2 text-right">{item.duplicates}</td><td className="px-3 py-2 text-right">{item.errors}</td><td className="px-3 py-2">{item.status}</td></tr>)}</tbody>
            </table>
          </div>
        </Panel>
        <Panel title="Import statement">
          <form onSubmit={importStatement} className="space-y-3">
            <BankAccountSelect bankAccounts={activeBankAccounts} value={transactionForm.bank_account_id} onChange={(value) => setTransactionForm((current) => ({ ...current, bank_account_id: value }))} />
            <Input type="file" accept=".csv,text/csv" onChange={(e) => setImportFile(e.target.files?.[0] || null)} />
            <Button disabled={busy || saving || !importFile} className="w-full gap-2" style={{ background: "var(--brand)" }}><Upload className="h-4 w-4" /> Import CSV</Button>
            <p className="text-xs text-stone-500">CSV is the first provider. The backend stores source type so OFX, QIF, MT940 and Open Banking can plug in later.</p>
          </form>
        </Panel>
      </div>
    );
  }

  if (tab === "Reports") {
    const bankChargeTotal = (reports.bank_charges || []).reduce((sum, item) => sum + Math.abs(bankAmount(item)), 0);
    const interestTotal = (reports.interest || []).reduce((sum, item) => sum + Math.abs(bankAmount(item)), 0);
    return (
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Bank reconciliation"><BankTransactionTable transactions={reports.unreconciled_items || []} compact /></Panel>
        <Panel title="Outstanding transactions">
          <div className="divide-y divide-stone-100">
            <BankReportLine label="Unreconciled items" value={(reports.unreconciled_items || []).length} />
            <BankReportLine label="Transfers" value={(reports.transfers || []).length} />
            <BankReportLine label="Bank charges" value={formatMoney(bankChargeTotal)} />
            <BankReportLine label="Interest" value={formatMoney(interestTotal)} />
          </div>
        </Panel>
        <Panel title="Bank charges"><BankTransactionTable transactions={reports.bank_charges || []} compact /></Panel>
        <Panel title="Interest"><BankTransactionTable transactions={reports.interest || []} compact /></Panel>
      </div>
    );
  }

  if (tab === "Settings") {
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

  return null;
}

function bankAmount(transaction) {
  return Number(transaction?.money_in || 0) - Number(transaction?.money_out || 0);
}

function BankAccountSelect({ bankAccounts = [], value, onChange, label = "Bank account" }) {
  return (
    <div>
      <Label className="text-xs font-semibold text-stone-600">{label}</Label>
      <select value={value || ""} onChange={(e) => onChange(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-stone-200 bg-white px-3 text-sm shadow-sm">
        <option value="">Select bank account</option>
        {bankAccounts.map((account) => <option key={account.id} value={account.id}>{account.account_name} - {account.nominal_account_code}</option>)}
      </select>
    </div>
  );
}

function BankFilterBar({ filters, setFilters, bankAccounts }) {
  return (
    <div className="rounded-md border border-stone-200 bg-white p-3">
      <div className="grid gap-2 md:grid-cols-6">
        <Field label="Date from" type="date" value={filters.date_from} onChange={(value) => setFilters((current) => ({ ...current, date_from: value }))} />
        <Field label="Date to" type="date" value={filters.date_to} onChange={(value) => setFilters((current) => ({ ...current, date_to: value }))} />
        <BankAccountSelect bankAccounts={bankAccounts} value={filters.bank_account_id} onChange={(value) => setFilters((current) => ({ ...current, bank_account_id: value }))} />
        <SelectField label="Status" value={filters.status} onChange={(value) => setFilters((current) => ({ ...current, status: value }))} options={["", "unreconciled", "reconciled", "ignored"]} />
        <Input className="mt-5 h-9" value={filters.search} onChange={(e) => setFilters((current) => ({ ...current, search: e.target.value }))} placeholder="Search" />
        <div className="mt-5 flex gap-2">
          <Button type="button" variant="outline" className="gap-2"><Download className="h-4 w-4" /> Export</Button>
          <Button type="button" variant="outline" className="gap-2"><Printer className="h-4 w-4" /> Print</Button>
        </div>
      </div>
    </div>
  );
}

function BankTransactionTable({ transactions = [], compact = false }) {
  if (!transactions.length) return <p className="py-10 text-center text-sm text-stone-500">No bank transactions found.</p>;
  return (
    <div className="overflow-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
          <tr>
            <th className="px-3 py-2">Date</th>
            <th className="px-3 py-2">Description</th>
            {!compact && <th className="px-3 py-2">Reference</th>}
            {!compact && <th className="px-3 py-2">Type</th>}
            <th className="px-3 py-2 text-right">Money in</th>
            <th className="px-3 py-2 text-right">Money out</th>
            {!compact && <th className="px-3 py-2 text-right">Balance</th>}
            <th className="px-3 py-2">Status</th>
            {!compact && <th className="px-3 py-2">Matched to</th>}
          </tr>
        </thead>
        <tbody>
          {transactions.map((transaction) => (
            <tr key={transaction.id} className="border-t border-stone-100">
              <td className="whitespace-nowrap px-3 py-2">{formatDate(transaction.transaction_date)}</td>
              <td className="max-w-96 truncate px-3 py-2 font-medium text-stone-900">{transaction.description || "-"}</td>
              {!compact && <td className="px-3 py-2 text-stone-600">{transaction.reference || "-"}</td>}
              {!compact && <td className="px-3 py-2 text-stone-600">{transaction.transaction_type || "-"}</td>}
              <td className="px-3 py-2 text-right text-emerald-700">{Number(transaction.money_in || 0) ? formatMoney(transaction.money_in) : "-"}</td>
              <td className="px-3 py-2 text-right">{Number(transaction.money_out || 0) ? formatMoney(transaction.money_out) : "-"}</td>
              {!compact && <td className="px-3 py-2 text-right">{Number(transaction.balance || 0) ? formatMoney(transaction.balance) : "-"}</td>}
              <td className="px-3 py-2"><Badge className={transaction.status === "reconciled" ? "bg-emerald-100 text-emerald-800" : transaction.status === "ignored" ? "bg-stone-100 text-stone-600" : "bg-amber-100 text-amber-800"}>{transaction.status || "unreconciled"}</Badge></td>
              {!compact && <td className="px-3 py-2 text-stone-600">{transaction.matched_to || transaction.suggested_match || "-"}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default BankingWorkspace;
