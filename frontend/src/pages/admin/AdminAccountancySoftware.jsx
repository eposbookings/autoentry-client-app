import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ArrowRight,
  Banknote,
  BookOpen,
  Building2,
  FileBarChart,
  Landmark,
  LayoutDashboard,
  Plus,
  ReceiptText,
  RefreshCw,
  Settings,
  ShieldCheck,
  Upload,
  UsersRound,
  WalletCards,
} from "lucide-react";
import { toast } from "sonner";

const MODULES = [
  { key: "dashboard", label: "Overview", icon: LayoutDashboard },
  { key: "payables", label: "Payables", icon: ReceiptText },
  { key: "receivables", label: "Receivables", icon: WalletCards },
  { key: "contacts", label: "Contacts", icon: UsersRound },
  { key: "banking", label: "Banking", icon: Banknote },
  { key: "vat", label: "VAT", icon: ShieldCheck },
  { key: "gl", label: "General ledger", icon: Landmark },
  { key: "coa", label: "Chart of accounts", icon: BookOpen },
  { key: "reports", label: "Reports", icon: FileBarChart },
  { key: "settings", label: "Settings", icon: Settings },
];

const ACCOUNT_TYPES = [
  "asset",
  "liability",
  "equity",
  "income",
  "expense",
  "bank",
  "receivable",
  "payable",
  "vat",
];

export default function AdminAccountancySoftware() {
  const [clients, setClients] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [workspace, setWorkspace] = useState(null);
  const [module, setModule] = useState("dashboard");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [accountForm, setAccountForm] = useState({ code: "", name: "", type: "expense", description: "" });
  const [contactForm, setContactForm] = useState({ name: "", contact_type: "supplier", email: "" });
  const [bankForm, setBankForm] = useState({ transaction_date: "", description: "", reference: "", money_in: "", money_out: "", bank_account_code: "1200" });
  const [bankImportFile, setBankImportFile] = useState(null);
  const [vatForm, setVatForm] = useState({ period_start: "", period_end: "" });
  const [periodForm, setPeriodForm] = useState({ period_start: "", period_end: "", notes: "" });

  const loadClients = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/accounting/clients");
      const nextClients = Array.isArray(data?.clients) ? data.clients : [];
      setClients(nextClients);
      setSelectedId((current) => current || nextClients?.[0]?.id || null);
    } catch (e) {
      toast.error(formatApiError(e));
    }
  }, []);

  const loadWorkspace = useCallback(async (clientId) => {
    if (!clientId) {
      setWorkspace(null);
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.get(`/admin/accounting/clients/${clientId}`);
      setWorkspace(data);
    } catch (e) {
      toast.error(formatApiError(e));
      setWorkspace(null);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { loadClients(); }, [loadClients]);
  useEffect(() => { loadWorkspace(selectedId); }, [selectedId, loadWorkspace]);

  const filteredClients = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return clients;
    return clients.filter((client) => (
      `${client.business_name || ""} ${client.email || ""} ${client.first_name || ""} ${client.last_name || ""}`.toLowerCase().includes(needle)
    ));
  }, [clients, q]);

  async function createAccount(e) {
    e.preventDefault();
    if (!workspace?.client?.id) return;
    if (!accountForm.code.trim() || !accountForm.name.trim()) {
      toast.error("Account code and name are required");
      return;
    }
    setBusy(true);
    try {
      await api.post(`/admin/accounting/clients/${workspace.client.id}/accounts`, accountForm);
      toast.success("Account created");
      setAccountForm({ code: "", name: "", type: "expense", description: "" });
      await loadWorkspace(workspace.client.id);
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(false);
    }
  }

  async function createContact(e) {
    e.preventDefault();
    if (!workspace?.client?.id) return;
    if (!contactForm.name.trim()) {
      toast.error("Contact name is required");
      return;
    }
    setBusy(true);
    try {
      await api.post(`/admin/accounting/clients/${workspace.client.id}/contacts`, contactForm);
      toast.success(`${contactForm.contact_type === "customer" ? "Customer" : "Supplier"} created`);
      setContactForm({ name: "", contact_type: "supplier", email: "" });
      await loadWorkspace(workspace.client.id);
      await loadClients();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(false);
    }
  }

  async function createBankTransaction(e) {
    e.preventDefault();
    if (!workspace?.client?.id) return;
    setBusy(true);
    try {
      await api.post(`/admin/accounting/clients/${workspace.client.id}/bank-transactions`, bankForm);
      toast.success("Bank transaction added");
      setBankForm({ transaction_date: "", description: "", reference: "", money_in: "", money_out: "", bank_account_code: "1200" });
      await loadWorkspace(workspace.client.id);
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(false);
    }
  }

  async function importBankTransactions(e) {
    e.preventDefault();
    if (!workspace?.client?.id) return;
    if (!bankImportFile) {
      toast.error("Choose a CSV bank file first");
      return;
    }
    const payload = new FormData();
    payload.append("file", bankImportFile);
    payload.append("bank_account_code", bankForm.bank_account_code || "1200");
    setBusy(true);
    try {
      const { data } = await api.post(`/admin/accounting/clients/${workspace.client.id}/bank-transactions/import`, payload, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      toast.success(`Imported ${data?.imported || 0} bank transactions`);
      if (Array.isArray(data?.errors) && data.errors.length) {
        toast.warning(`${data.errors.length} rows need checking`);
      }
      setBankImportFile(null);
      await loadWorkspace(workspace.client.id);
      await loadClients();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(false);
    }
  }

  async function reconcileBankTransaction(transaction, accountCode) {
    if (!workspace?.client?.id) return;
    if (!accountCode) {
      toast.error("Choose an account before reconciling");
      return;
    }
    setBusy(true);
    try {
      const account = (workspace.accounts || []).find((item) => item.code === accountCode);
      await api.post(`/admin/accounting/clients/${workspace.client.id}/bank-transactions/${transaction.id}/reconcile`, {
        account_code: accountCode,
        account_name: account?.name,
        contact_name: transaction.description,
        description: transaction.description,
        reference: transaction.reference,
      });
      toast.success("Bank transaction reconciled");
      await loadWorkspace(workspace.client.id);
      await loadClients();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(false);
    }
  }

  async function prepareVatReturn(e) {
    e.preventDefault();
    if (!workspace?.client?.id) return;
    setBusy(true);
    try {
      await api.post(`/admin/accounting/clients/${workspace.client.id}/vat-returns/prepare`, vatForm);
      toast.success("VAT return prepared");
      setVatForm({ period_start: "", period_end: "" });
      await loadWorkspace(workspace.client.id);
      await loadClients();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(false);
    }
  }

  async function createPeriod(e) {
    e.preventDefault();
    if (!workspace?.client?.id) return;
    setBusy(true);
    try {
      await api.post(`/admin/accounting/clients/${workspace.client.id}/periods`, periodForm);
      toast.success("Accounting period created");
      setPeriodForm({ period_start: "", period_end: "", notes: "" });
      await loadWorkspace(workspace.client.id);
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 rounded-md border border-stone-200 bg-white p-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-stone-900">Accountancy software</h1>
          <p className="mt-1 text-sm text-stone-600">
            Native EPOS ledgers for clients who are not posting into QuickBooks, Sage, or Xero.
          </p>
        </div>
        <Button variant="outline" onClick={() => { loadClients(); loadWorkspace(selectedId); }} disabled={busy} className="gap-2">
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </header>

      <section className="grid min-h-[calc(100vh-150px)] gap-4 xl:grid-cols-[330px_1fr]">
        <aside className="rounded-md border border-stone-200 bg-white">
          <div className="border-b border-stone-200 p-3">
            <Label className="text-xs font-semibold text-stone-600">Native accounting clients</Label>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clients" className="mt-2 h-9" />
          </div>
          <div className="max-h-[calc(100vh-250px)] overflow-auto">
            {filteredClients.length === 0 ? (
              <div className="p-6 text-sm text-stone-500">
                No native accounting clients yet. Open a client, go to Accountancy software, choose EPOS native accounting, and save.
              </div>
            ) : (
              filteredClients.map((client) => (
                <button
                  key={client.id}
                  type="button"
                  onClick={() => { setSelectedId(client.id); setModule("dashboard"); }}
                  className={`flex w-full items-start justify-between gap-3 border-b border-stone-100 px-3 py-3 text-left last:border-b-0 ${selectedId === client.id ? "bg-emerald-50" : "hover:bg-stone-50"}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-stone-900">{client.business_name}</span>
                    <span className="block truncate text-xs text-stone-500">{client.email}</span>
                    <span className="mt-2 flex flex-wrap gap-1">
                      <SmallStat label="Journals" value={client.summary?.journals || 0} />
                      <SmallStat label="VAT" value={formatMoney(client.summary?.vat_balance || client.summary?.vat)} />
                    </span>
                  </span>
                  <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-stone-400" />
                </button>
              ))
            )}
          </div>
        </aside>

        <main className="rounded-md border border-stone-200 bg-white">
          {!workspace ? (
            <EmptyWorkspace busy={busy} />
          ) : (
            <>
              <div className="flex flex-col gap-3 border-b border-stone-200 p-4 xl:flex-row xl:items-start xl:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate font-display text-xl font-bold text-stone-900">{workspace.client.business_name}</h2>
                    <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">Native EPOS Accounting</Badge>
                  </div>
                  <p className="mt-1 text-sm text-stone-500">
                    {workspace.client.first_name} {workspace.client.last_name} - {workspace.client.email}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <SummaryCard label="Payables" value={formatMoney(workspace.summary?.payables)} tone="amber" />
                  <SummaryCard label="Receivables" value={formatMoney(workspace.summary?.receivables)} tone="blue" />
                  <SummaryCard label="VAT" value={formatMoney(workspace.summary?.vat_balance || workspace.summary?.vat)} tone="emerald" />
                  <SummaryCard label="Bank unreconciled" value={workspace.summary?.unreconciled_bank_transactions || 0} tone="stone" />
                </div>
              </div>

              <div className="border-b border-stone-200 p-3">
                <div className="flex flex-wrap gap-2">
                  {MODULES.map((item) => {
                    const Icon = item.icon;
                    const active = module === item.key;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => setModule(item.key)}
                        className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold ${active ? "bg-[var(--brand)] text-white" : "bg-stone-100 text-stone-700 hover:bg-stone-200"}`}
                      >
                        <Icon className="h-4 w-4" /> {item.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="p-4">
                {module === "dashboard" && <Overview workspace={workspace} />}
                {module === "payables" && <LedgerView title="Accounts payable" journals={workspace.journals} accountCodes={["2000"]} />}
                {module === "receivables" && <LedgerView title="Accounts receivable" journals={workspace.journals} accountCodes={["1100"]} />}
                {module === "contacts" && (
                  <ContactsWorkspace
                    contacts={workspace.contacts}
                    form={contactForm}
                    setForm={setContactForm}
                    createContact={createContact}
                    busy={busy}
                  />
                )}
                {module === "banking" && (
                  <BankingWorkspace
                    workspace={workspace}
                    form={bankForm}
                    setForm={setBankForm}
                    importFile={bankImportFile}
                    setImportFile={setBankImportFile}
                    createBankTransaction={createBankTransaction}
                    importBankTransactions={importBankTransactions}
                    reconcileBankTransaction={reconcileBankTransaction}
                    busy={busy}
                  />
                )}
                {module === "vat" && (
                  <VatWorkspace
                    workspace={workspace}
                    form={vatForm}
                    setForm={setVatForm}
                    prepareVatReturn={prepareVatReturn}
                    busy={busy}
                  />
                )}
                {module === "gl" && <JournalTable journals={workspace.journals} />}
                {module === "coa" && <ChartOfAccounts accounts={workspace.accounts} form={accountForm} setForm={setAccountForm} createAccount={createAccount} busy={busy} />}
                {module === "reports" && <ReportsWorkspace workspace={workspace} />}
                {module === "settings" && (
                  <SettingsWorkspace
                    workspace={workspace}
                    form={periodForm}
                    setForm={setPeriodForm}
                    createPeriod={createPeriod}
                    busy={busy}
                  />
                )}
              </div>
            </>
          )}
        </main>
      </section>
    </div>
  );
}

function EmptyWorkspace({ busy }) {
  return (
    <div className="flex min-h-[520px] flex-col items-center justify-center p-8 text-center">
      <Building2 className="h-10 w-10 text-stone-300" />
      <h2 className="mt-3 font-display text-xl font-semibold text-stone-900">{busy ? "Loading workspace" : "No native accounting client selected"}</h2>
      <p className="mt-1 max-w-md text-sm text-stone-500">Enable EPOS native accounting inside a client account to start building their ledger.</p>
    </div>
  );
}

function Overview({ workspace }) {
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
      <JournalTable journals={(workspace.journals || []).slice(0, 8)} compact />
      <div className="space-y-3">
        <Panel title="Contacts">
          <div className="grid gap-2">
            <ContactCount icon={UsersRound} label="Suppliers" value={(workspace.contacts || []).filter((c) => c.contact_type === "supplier").length} />
            <ContactCount icon={UsersRound} label="Customers" value={(workspace.contacts || []).filter((c) => c.contact_type === "customer").length} />
          </div>
        </Panel>
        <Panel title="Next modules">
          <div className="space-y-2 text-sm text-stone-600">
            <p>Fixed assets and payroll are reserved as native modules so they can be added without changing the ledger foundation.</p>
            <p>Publishing reviewed invoices already posts balanced journals into the GL.</p>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function LedgerView({ title, journals, accountCodes }) {
  const rows = [];
  (journals || []).forEach((journal) => {
    (journal.lines || []).forEach((line) => {
      if (accountCodes.includes(line.account_code)) {
        rows.push({ journal, line });
      }
    });
  });
  return (
    <Panel title={title}>
      {rows.length === 0 ? (
        <p className="py-12 text-center text-sm text-stone-500">No transactions posted yet.</p>
      ) : (
        <div className="overflow-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Reference</th>
                <th className="px-3 py-2">Account</th>
                <th className="px-3 py-2 text-right">Debit</th>
                <th className="px-3 py-2 text-right">Credit</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ journal, line }) => (
                <tr key={`${journal.id}-${line.id}`} className="border-t border-stone-100">
                  <td className="px-3 py-2">{formatDate(journal.entry_date)}</td>
                  <td className="px-3 py-2 font-medium text-stone-900">{journal.reference || journal.description}</td>
                  <td className="px-3 py-2 text-stone-600">{line.account_code} - {line.account_name}</td>
                  <td className="px-3 py-2 text-right">{formatMoney(line.debit)}</td>
                  <td className="px-3 py-2 text-right">{formatMoney(line.credit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function BankingWorkspace({ workspace, form, setForm, importFile, setImportFile, createBankTransaction, importBankTransactions, reconcileBankTransaction, busy }) {
  const bankAccounts = (workspace.accounts || []).filter((account) => account.account_type === "bank" || account.code === "1200");
  const postingAccounts = (workspace.accounts || []).filter((account) => account.active && account.account_type !== "bank");
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
      <Panel title="Bank feed">
        {(workspace.bank_transactions || []).length === 0 ? (
          <p className="py-12 text-center text-sm text-stone-500">No bank transactions yet. Add a transaction manually to test reconciliation.</p>
        ) : (
          <div className="space-y-2">
            {(workspace.bank_transactions || []).map((transaction) => (
              <BankTransactionRow
                key={transaction.id}
                transaction={transaction}
                accounts={postingAccounts}
                onReconcile={reconcileBankTransaction}
                busy={busy}
              />
            ))}
          </div>
        )}
      </Panel>
      <div className="space-y-4">
        <Panel title="Import bank CSV">
          <form onSubmit={importBankTransactions} className="space-y-3">
            <div>
              <Label className="text-xs font-semibold text-stone-600">Bank account</Label>
              <select
                value={form.bank_account_code}
                onChange={(e) => setForm((current) => ({ ...current, bank_account_code: e.target.value }))}
                className="mt-1 h-9 w-full rounded-md border border-stone-200 bg-white px-3 text-sm shadow-sm"
              >
                {(bankAccounts.length ? bankAccounts : [{ code: "1200", name: "Bank account" }]).map((account) => (
                  <option key={account.code} value={account.code}>{account.code} - {account.name}</option>
                ))}
              </select>
            </div>
            <Input type="file" accept=".csv,text/csv" onChange={(e) => setImportFile(e.target.files?.[0] || null)} />
            <Button disabled={busy || !importFile} className="w-full gap-2" style={{ background: "var(--brand)" }}>
              <Upload className="h-4 w-4" /> Import CSV
            </Button>
            <p className="text-xs text-stone-500">
              Accepts common columns like Date, Description, Reference, Money In, Money Out, Credit, Debit, or Amount.
            </p>
          </form>
        </Panel>
        <Panel title="Add bank line">
          <form onSubmit={createBankTransaction} className="space-y-3">
            <Field label="Date" type="date" value={form.transaction_date} onChange={(value) => setForm((current) => ({ ...current, transaction_date: value }))} />
            <Field label="Description" value={form.description} onChange={(value) => setForm((current) => ({ ...current, description: value }))} />
            <Field label="Reference" value={form.reference} onChange={(value) => setForm((current) => ({ ...current, reference: value }))} />
            <div className="grid grid-cols-2 gap-2">
              <Field label="Money in" value={form.money_in} onChange={(value) => setForm((current) => ({ ...current, money_in: value, money_out: value ? "" : current.money_out }))} />
              <Field label="Money out" value={form.money_out} onChange={(value) => setForm((current) => ({ ...current, money_out: value, money_in: value ? "" : current.money_in }))} />
            </div>
            <Button disabled={busy} className="w-full" style={{ background: "var(--brand)" }}>Add transaction</Button>
          </form>
        </Panel>
      </div>
    </div>
  );
}

function ContactsWorkspace({ contacts = [], form, setForm, createContact, busy }) {
  const suppliers = contacts.filter((contact) => contact.contact_type === "supplier");
  const customers = contacts.filter((contact) => contact.contact_type === "customer");
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <SummaryCard label="Suppliers" value={suppliers.length} tone="amber" />
          <SummaryCard label="Customers" value={customers.length} tone="blue" />
        </div>
        <Panel title="Contacts">
          {contacts.length === 0 ? (
            <p className="py-12 text-center text-sm text-stone-500">No native contacts yet. Add suppliers and customers here, or let invoice publishing create them.</p>
          ) : (
            <div className="overflow-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
                  <tr>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Email</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {contacts.map((contact) => (
                    <tr key={contact.id} className="border-t border-stone-100">
                      <td className="px-3 py-2 font-semibold text-stone-900">{contact.name}</td>
                      <td className="px-3 py-2 capitalize text-stone-600">{contact.contact_type}</td>
                      <td className="px-3 py-2 text-stone-600">{contact.email || "-"}</td>
                      <td className="px-3 py-2">
                        <Badge className={contact.active ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-100" : "bg-stone-100 text-stone-700 hover:bg-stone-100"}>
                          {contact.active ? "Active" : "Inactive"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
      <Panel title="Add contact">
        <form onSubmit={createContact} className="space-y-3">
          <Field label="Name" value={form.name} onChange={(value) => setForm((current) => ({ ...current, name: value }))} />
          <div>
            <Label className="text-xs font-semibold text-stone-600">Type</Label>
            <select
              value={form.contact_type}
              onChange={(e) => setForm((current) => ({ ...current, contact_type: e.target.value }))}
              className="mt-1 h-9 w-full rounded-md border border-stone-200 bg-white px-3 text-sm shadow-sm"
            >
              <option value="supplier">Supplier</option>
              <option value="customer">Customer</option>
            </select>
          </div>
          <Field label="Email" type="email" value={form.email} onChange={(value) => setForm((current) => ({ ...current, email: value }))} />
          <Button disabled={busy} className="w-full gap-2" style={{ background: "var(--brand)" }}>
            <Plus className="h-4 w-4" /> Create contact
          </Button>
        </form>
      </Panel>
    </div>
  );
}

function BankTransactionRow({ transaction, accounts, onReconcile, busy }) {
  const [accountCode, setAccountCode] = useState("");
  const amount = Number(transaction.money_in || 0) - Number(transaction.money_out || 0);
  return (
    <div className="rounded-md border border-stone-200 p-3">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-stone-900">{formatDate(transaction.transaction_date)}</span>
            <Badge className={transaction.status === "reconciled" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}>
              {transaction.status}
            </Badge>
          </div>
          <p className="truncate text-sm text-stone-600">{transaction.description || transaction.reference || "Bank transaction"}</p>
        </div>
        <div className={`font-display text-lg font-bold ${amount >= 0 ? "text-emerald-700" : "text-stone-900"}`}>{formatMoney(Math.abs(amount))}</div>
      </div>
      {transaction.status !== "reconciled" && (
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
          <select
            value={accountCode}
            onChange={(e) => setAccountCode(e.target.value)}
            className="h-9 rounded-md border border-stone-200 bg-white px-3 text-sm shadow-sm"
          >
            <option value="">Choose posting account</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.code}>{account.code} - {account.name}</option>
            ))}
          </select>
          <Button variant="outline" disabled={busy} onClick={() => onReconcile(transaction, accountCode)}>
            Reconcile
          </Button>
        </div>
      )}
    </div>
  );
}

function VatWorkspace({ workspace, form, setForm, prepareVatReturn, busy }) {
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        <LedgerView title="VAT ledger" journals={workspace.journals} accountCodes={["2200"]} />
        <Panel title="Draft VAT returns">
          {(workspace.vat_returns || []).length === 0 ? (
            <p className="py-8 text-center text-sm text-stone-500">No VAT returns prepared yet.</p>
          ) : (
            <div className="space-y-2">
              {(workspace.vat_returns || []).map((vatReturn) => (
                <div key={vatReturn.id} className="grid gap-3 rounded-md border border-stone-200 p-3 sm:grid-cols-5">
                  <Info label="Period" value={`${formatDate(vatReturn.period_start)} - ${formatDate(vatReturn.period_end)}`} />
                  <Info label="VAT due" value={formatMoney(vatReturn.vat_due_sales)} />
                  <Info label="VAT reclaimed" value={formatMoney(vatReturn.vat_reclaimed_purchases)} />
                  <Info label="Net VAT" value={formatMoney(vatReturn.net_vat_due)} />
                  <Info label="Status" value={vatReturn.status} />
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
      <Panel title="Prepare VAT return">
        <form onSubmit={prepareVatReturn} className="space-y-3">
          <Field label="Period start" type="date" value={form.period_start} onChange={(value) => setForm((current) => ({ ...current, period_start: value }))} />
          <Field label="Period end" type="date" value={form.period_end} onChange={(value) => setForm((current) => ({ ...current, period_end: value }))} />
          <Button disabled={busy} className="w-full" style={{ background: "var(--brand)" }}>Prepare draft</Button>
        </form>
        <p className="mt-3 text-xs text-stone-500">
          Draft values are calculated from posted native journals in the selected period.
        </p>
      </Panel>
    </div>
  );
}

function JournalTable({ journals, compact = false }) {
  return (
    <Panel title={compact ? "Recent journals" : "General ledger"}>
      {(journals || []).length === 0 ? (
        <p className="py-12 text-center text-sm text-stone-500">No journal entries yet.</p>
      ) : (
        <div className="space-y-3">
          {(journals || []).map((journal) => (
            <div key={journal.id} className="rounded-md border border-stone-200">
              <div className="flex flex-col gap-2 border-b border-stone-100 bg-stone-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="font-semibold text-stone-900">{journal.reference || journal.description}</div>
                  <div className="text-xs text-stone-500">{formatDate(journal.entry_date)} - {journal.status}</div>
                </div>
                <Badge variant="outline">Balanced</Badge>
              </div>
              <div className="overflow-auto">
                <table className="min-w-full text-left text-sm">
                  <tbody>
                    {(journal.lines || []).map((line) => (
                      <tr key={line.id} className="border-t border-stone-100 first:border-t-0">
                        <td className="px-3 py-2 text-stone-700">{line.account_code}</td>
                        <td className="px-3 py-2 font-medium text-stone-900">{line.account_name}</td>
                        <td className="px-3 py-2 text-stone-500">{line.description}</td>
                        <td className="px-3 py-2 text-right">{formatMoney(line.debit)}</td>
                        <td className="px-3 py-2 text-right">{formatMoney(line.credit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function SettingsWorkspace({ workspace, form, setForm, createPeriod, busy }) {
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        <Panel title="Accounting periods">
          {(workspace.periods || []).length === 0 ? (
            <p className="py-8 text-center text-sm text-stone-500">No accounting periods created yet.</p>
          ) : (
            <div className="space-y-2">
              {(workspace.periods || []).map((period) => (
                <div key={period.id} className="flex flex-col gap-2 rounded-md border border-stone-200 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="font-semibold text-stone-900">{formatDate(period.period_start)} - {formatDate(period.period_end)}</div>
                    <div className="text-xs text-stone-500">{period.notes || "No notes"}</div>
                  </div>
                  <Badge variant="outline">{period.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </Panel>
        <Panel title="Audit trail">
          {(workspace.audit_log || []).length === 0 ? (
            <p className="py-8 text-center text-sm text-stone-500">No audit events yet.</p>
          ) : (
            <div className="space-y-2">
              {(workspace.audit_log || []).map((event) => (
                <div key={event.id} className="rounded-md border border-stone-200 p-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold text-stone-900">{event.action}</span>
                    <span className="text-xs text-stone-500">{formatDate(event.created_at)}</span>
                  </div>
                  <p className="mt-1 text-xs text-stone-500">{event.entity_type} - {event.entity_id}</p>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
      <Panel title="Add period">
        <form onSubmit={createPeriod} className="space-y-3">
          <Field label="Period start" type="date" value={form.period_start} onChange={(value) => setForm((current) => ({ ...current, period_start: value }))} />
          <Field label="Period end" type="date" value={form.period_end} onChange={(value) => setForm((current) => ({ ...current, period_end: value }))} />
          <Field label="Notes" value={form.notes} onChange={(value) => setForm((current) => ({ ...current, notes: value }))} />
          <Button disabled={busy} className="w-full" style={{ background: "var(--brand)" }}>Create period</Button>
        </form>
      </Panel>
    </div>
  );
}

function ChartOfAccounts({ accounts, form, setForm, createAccount, busy }) {
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
      <Panel title="Chart of accounts">
        <div className="overflow-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-3 py-2">Code</th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">System</th>
              </tr>
            </thead>
            <tbody>
              {(accounts || []).map((account) => (
                <tr key={account.id} className="border-t border-stone-100">
                  <td className="px-3 py-2 font-semibold text-stone-900">{account.code}</td>
                  <td className="px-3 py-2">{account.name}</td>
                  <td className="px-3 py-2 text-stone-600">{account.account_type || account.type}</td>
                  <td className="px-3 py-2">{account.is_system ? <Badge variant="outline">System</Badge> : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="Add account">
        <form onSubmit={createAccount} className="space-y-3">
          <Field label="Code" value={form.code} onChange={(value) => setForm((current) => ({ ...current, code: value }))} />
          <Field label="Name" value={form.name} onChange={(value) => setForm((current) => ({ ...current, name: value }))} />
          <div>
            <Label className="text-xs font-semibold text-stone-600">Type</Label>
            <select
              value={form.type}
              onChange={(e) => setForm((current) => ({ ...current, type: e.target.value }))}
              className="mt-1 h-9 w-full rounded-md border border-stone-200 bg-white px-3 text-sm shadow-sm"
            >
              {ACCOUNT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </div>
          <Field label="Description" value={form.description} onChange={(value) => setForm((current) => ({ ...current, description: value }))} />
          <Button disabled={busy} className="w-full gap-2" style={{ background: "var(--brand)" }}>
            <Plus className="h-4 w-4" /> Create account
          </Button>
        </form>
      </Panel>
    </div>
  );
}

function ReportsWorkspace({ workspace }) {
  const reports = workspace.reports || {};
  const pnl = reports.profit_and_loss || {};
  const balanceSheet = reports.balance_sheet || {};
  const trialBalance = reports.trial_balance || [];
  const agedReceivables = reports.aged_receivables || [];
  const agedPayables = reports.aged_payables || [];
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Income" value={formatMoney(pnl.income)} tone="emerald" />
        <SummaryCard label="Expenses" value={formatMoney(pnl.expenses)} tone="amber" />
        <SummaryCard label="Profit" value={formatMoney(pnl.profit)} tone="blue" />
        <SummaryCard label="Net assets" value={formatMoney(balanceSheet.net_assets)} tone="stone" />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Profit and loss">
          <ReportRows rows={[
            ["Income", pnl.income],
            ["Expenses", pnl.expenses],
            ["Profit / loss", pnl.profit],
          ]} />
        </Panel>
        <Panel title="Balance sheet">
          <ReportRows rows={[
            ["Assets", balanceSheet.assets],
            ["Liabilities", balanceSheet.liabilities],
            ["Equity", balanceSheet.equity],
            ["Net assets", balanceSheet.net_assets],
          ]} />
        </Panel>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <AgedBalanceTable title="Aged debtors" rows={agedReceivables} empty="No customer balances yet." />
        <AgedBalanceTable title="Aged creditors" rows={agedPayables} empty="No supplier balances yet." />
      </div>
      <Panel title="Trial balance">
        {trialBalance.length === 0 ? (
          <p className="py-8 text-center text-sm text-stone-500">No posted balances yet.</p>
        ) : (
          <div className="overflow-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-3 py-2">Code</th>
                  <th className="px-3 py-2">Account</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2 text-right">Debit</th>
                  <th className="px-3 py-2 text-right">Credit</th>
                </tr>
              </thead>
              <tbody>
                {trialBalance.map((row) => (
                  <tr key={row.code} className="border-t border-stone-100">
                    <td className="px-3 py-2 font-semibold text-stone-900">{row.code}</td>
                    <td className="px-3 py-2">{row.name}</td>
                    <td className="px-3 py-2 text-stone-600">{row.type}</td>
                    <td className="px-3 py-2 text-right">{formatMoney(row.debit)}</td>
                    <td className="px-3 py-2 text-right">{formatMoney(row.credit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

function AgedBalanceTable({ title, rows, empty }) {
  return (
    <Panel title={title}>
      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-stone-500">{empty}</p>
      ) : (
        <div className="overflow-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-3 py-2">Contact</th>
                <th className="px-3 py-2 text-right">0-30</th>
                <th className="px-3 py-2 text-right">31-60</th>
                <th className="px-3 py-2 text-right">61-90</th>
                <th className="px-3 py-2 text-right">90+</th>
                <th className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.contact_id || row.contact_name} className="border-t border-stone-100">
                  <td className="px-3 py-2 font-medium text-stone-900">{row.contact_name}</td>
                  <td className="px-3 py-2 text-right">{formatMoney(row.current)}</td>
                  <td className="px-3 py-2 text-right">{formatMoney(row.days_31_60)}</td>
                  <td className="px-3 py-2 text-right">{formatMoney(row.days_61_90)}</td>
                  <td className="px-3 py-2 text-right">{formatMoney(row.days_90_plus)}</td>
                  <td className="px-3 py-2 text-right font-semibold">{formatMoney(row.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function ReportRows({ rows }) {
  return (
    <div className="divide-y divide-stone-100">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-center justify-between gap-4 py-2 text-sm">
          <span className="text-stone-600">{label}</span>
          <strong className="font-display text-stone-900">{formatMoney(value)}</strong>
        </div>
      ))}
    </div>
  );
}

function Panel({ title, children }) {
  return (
    <section className="rounded-md border border-stone-200 bg-white">
      <div className="border-b border-stone-100 px-3 py-2">
        <h3 className="font-display text-base font-semibold text-stone-900">{title}</h3>
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}

function SummaryCard({ label, value, tone }) {
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

function SmallStat({ label, value }) {
  return <span className="rounded bg-white/80 px-1.5 py-0.5 text-[11px] text-stone-600">{label}: {value}</span>;
}

function ContactCount({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center justify-between rounded-md bg-stone-50 px-3 py-2 text-sm">
      <span className="inline-flex items-center gap-2 text-stone-700"><Icon className="h-4 w-4" /> {label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Field({ label, value, onChange, type = "text" }) {
  return (
    <div>
      <Label className="text-xs font-semibold text-stone-600">{label}</Label>
      <Input type={type} value={value || ""} onChange={(e) => onChange(e.target.value)} className="mt-1 h-9" />
    </div>
  );
}

function Info({ label, value }) {
  return (
    <div className="rounded-md bg-stone-50 px-3 py-2 text-sm">
      <div className="text-xs font-semibold text-stone-500">{label}</div>
      <div className="mt-1 font-medium text-stone-900">{value || "-"}</div>
    </div>
  );
}

function formatMoney(value) {
  const n = Number(value || 0);
  return n.toLocaleString("en-GB", { style: "currency", currency: "GBP" });
}

function formatDate(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-GB");
}
