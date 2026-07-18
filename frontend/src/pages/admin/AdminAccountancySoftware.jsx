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
  Plus,
  ReceiptText,
  RefreshCw,
  Settings,
  ShieldCheck,
  Printer,
  Download,
  Upload,
  UsersRound,
  WalletCards,
} from "lucide-react";
import { toast } from "sonner";

const MODULES = [
  { key: "payables", label: "Payables", icon: ReceiptText },
  { key: "receivables", label: "Receivables", icon: WalletCards },
  { key: "banking", label: "Banking", icon: Banknote },
  { key: "vat", label: "VAT", icon: ShieldCheck },
  { key: "gl", label: "General ledger", icon: Landmark },
  { key: "coa", label: "Chart of accounts", icon: BookOpen },
  { key: "audit", label: "Audit trail", icon: ShieldCheck },
  { key: "reports", label: "Reports", icon: FileBarChart },
  { key: "settings", label: "Settings", icon: Settings },
];

const ACCOUNT_TYPES = [
  "Bank",
  "Receivable",
  "Payable",
  "VAT",
  "Tax",
  "Payroll",
  "Equity",
  "Sales",
  "Purchases",
  "Cost of Sales",
  "Overheads",
  "Suspense",
];

const ACCOUNT_CATEGORIES = ["Asset", "Liability", "Equity", "Income", "Expense"];
const ACCOUNT_PURPOSES = [
  "Sales Ledger",
  "Purchase Ledger",
  "Bank Account",
  "VAT Control",
  "Suspense",
  "Retained Earnings",
  "Corporation Tax",
  "Payroll Control",
  "Standard Nominal",
];

const MODULE_DETAILS = {
  payables: {
    title: "Accounts Payable",
    manage: ["Suppliers", "Purchase Invoices", "Credit Notes", "Supplier Payments"],
    statLabel: "Outstanding bills",
    stat: (workspace) => Math.abs(Number(workspace?.summary?.payables || 0)).toLocaleString("en-GB", { style: "currency", currency: "GBP" }),
    tabs: ["Suppliers", "Purchase Invoices", "Credit Notes", "Payments", "Statements", "Reports"],
  },
  receivables: {
    title: "Accounts Receivable",
    manage: ["Customers", "Sales Invoices", "Credit Notes", "Customer Payments"],
    statLabel: "Outstanding invoices",
    stat: (workspace) => Math.abs(Number(workspace?.summary?.receivables || 0)).toLocaleString("en-GB", { style: "currency", currency: "GBP" }),
    tabs: ["Customers", "Sales Invoices", "Credit Notes", "Payments", "Statements", "Reports"],
  },
  banking: {
    title: "Banking",
    manage: ["Bank Accounts", "Transactions", "Reconciliation"],
    statLabel: "Transactions awaiting match",
    stat: (workspace) => workspace?.summary?.unreconciled_bank_transactions || 0,
    tabs: ["Bank Accounts", "Transactions", "Reconciliation", "Rules", "Reports"],
  },
  vat: {
    title: "VAT",
    manage: ["VAT Returns", "VAT Codes", "VAT Periods"],
    statLabel: "Draft VAT returns",
    stat: (workspace) => workspace?.summary?.draft_vat_returns || 0,
    tabs: ["Returns", "Codes", "Periods", "History", "Reports"],
  },
  gl: {
    title: "General Ledger",
    manage: ["Transactions", "Journals", "Account Activity", "Trial Balance"],
    statLabel: "Posted journals",
    stat: (workspace) => workspace?.summary?.journals || 0,
    tabs: ["Transactions", "Journals", "Account Activity", "Trial Balance"],
  },
  coa: {
    title: "Chart of Accounts",
    manage: ["One account list", "Purpose filters", "Control account flags"],
    statLabel: "Accounts",
    stat: (workspace) => workspace?.reports?.account_count || workspace?.accounts?.length || 0,
    tabs: ["Chart of Accounts"],
  },
  audit: {
    title: "Audit Trail",
    manage: ["User actions", "Record changes", "Posting history"],
    statLabel: "Audit events",
    stat: (workspace) => workspace?.audit_log?.length || 0,
    tabs: ["Audit Trail"],
  },
  reports: {
    title: "Reports",
    manage: ["Trial Balance", "Profit and Loss", "Balance Sheet", "Aged Balances"],
    statLabel: "Net assets",
    stat: (workspace) => formatMoney(workspace?.reports?.balance_sheet?.net_assets),
    tabs: ["Report Centre", "Trial Balance", "Profit and Loss", "Balance Sheet", "Cash Flow", "Aged Debtors", "Aged Creditors", "VAT Summary", "Nominal Activity"],
  },
  settings: {
    title: "Settings",
    manage: ["Accounting Defaults", "Financial Years", "Period Locks"],
    statLabel: "Accounting periods",
    stat: (workspace) => workspace?.periods?.length || 0,
    tabs: ["Accounting Settings", "Financial Years", "Periods"],
  },
};

export default function AdminAccountancySoftware() {
  const [clients, setClients] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [workspace, setWorkspace] = useState(null);
  const [module, setModule] = useState(null);
  const [moduleTab, setModuleTab] = useState("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [accountForm, setAccountForm] = useState({ code: "", name: "", category: "Expense", account_type: "Overheads", purpose: "Standard Nominal", normal_balance: "debit", is_control_account: false, description: "" });
  const [contactForm, setContactForm] = useState({ name: "", contact_type: "supplier", email: "" });
  const [bankForm, setBankForm] = useState({ transaction_date: "", description: "", reference: "", money_in: "", money_out: "", bank_account_code: "1200" });
  const [bankImportFile, setBankImportFile] = useState(null);
  const [vatForm, setVatForm] = useState({ period_start: "", period_end: "" });
  const [periodForm, setPeriodForm] = useState({ period_start: "", period_end: "", notes: "" });
  const [financialYearForm, setFinancialYearForm] = useState({ name: "", start_date: "", end_date: "" });
  const [settingsForm, setSettingsForm] = useState({});

  const loadClients = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/accounting/clients");
      const nextClients = Array.isArray(data?.clients) ? data.clients : [];
      setClients(nextClients);
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
      setSettingsForm(data?.accounting_settings || {});
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

  function openClient(clientId) {
    setWorkspace(null);
    setSelectedId(clientId);
    setModule(null);
    setModuleTab("");
  }

  function backToClients() {
    setSelectedId(null);
    setWorkspace(null);
    setModule(null);
    setModuleTab("");
  }

  function openModule(moduleKey) {
    const firstTab = MODULE_DETAILS[moduleKey]?.tabs?.[0] || "";
    setModule(moduleKey);
    setModuleTab(firstTab);
  }

  function backToClientHome() {
    setModule(null);
    setModuleTab("");
  }

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
      setAccountForm({ code: "", name: "", category: "Expense", account_type: "Overheads", purpose: "Standard Nominal", normal_balance: "debit", is_control_account: false, description: "" });
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

  async function createFinancialYear(e) {
    e.preventDefault();
    if (!workspace?.client?.id) return;
    setBusy(true);
    try {
      const { data } = await api.post(`/admin/accounting/clients/${workspace.client.id}/financial-years`, financialYearForm);
      toast.success(`Financial year created with ${data?.periods_created || 0} periods`);
      setFinancialYearForm({ name: "", start_date: "", end_date: "" });
      await loadWorkspace(workspace.client.id);
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(false);
    }
  }

  async function updatePeriodStatus(periodId, status) {
    if (!workspace?.client?.id) return;
    setBusy(true);
    try {
      await api.patch(`/admin/accounting/clients/${workspace.client.id}/periods/${periodId}`, { status });
      toast.success(`Period ${status}`);
      await loadWorkspace(workspace.client.id);
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveAccountingSettings(e) {
    e.preventDefault();
    if (!workspace?.client?.id) return;
    setBusy(true);
    try {
      const { data } = await api.put(`/admin/accounting/clients/${workspace.client.id}/settings`, settingsForm);
      setSettingsForm(data || {});
      toast.success("Accounting settings saved");
      await loadWorkspace(workspace.client.id);
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {!selectedId && (
        <AccountingClientCards
          clients={filteredClients}
          q={q}
          setQ={setQ}
          openClient={openClient}
          refresh={() => loadClients()}
          busy={busy}
        />
      )}

      {selectedId && !workspace && <EmptyWorkspace busy={busy} />}

      {workspace && !module && (
        <ClientAccountingHome
          workspace={workspace}
          openModule={openModule}
          backToClients={backToClients}
          refresh={() => { loadClients(); loadWorkspace(selectedId); }}
          busy={busy}
        />
      )}

      {workspace && module && (
        <ModuleWorkspace
          module={module}
          moduleTab={moduleTab}
          setModuleTab={setModuleTab}
          workspace={workspace}
          backToClientHome={backToClientHome}
          accountForm={accountForm}
          setAccountForm={setAccountForm}
          createAccount={createAccount}
          contactForm={contactForm}
          setContactForm={setContactForm}
          createContact={createContact}
          bankForm={bankForm}
          setBankForm={setBankForm}
          bankImportFile={bankImportFile}
          setBankImportFile={setBankImportFile}
          createBankTransaction={createBankTransaction}
          importBankTransactions={importBankTransactions}
          reconcileBankTransaction={reconcileBankTransaction}
          vatForm={vatForm}
          setVatForm={setVatForm}
          prepareVatReturn={prepareVatReturn}
          periodForm={periodForm}
          setPeriodForm={setPeriodForm}
          createPeriod={createPeriod}
          financialYearForm={financialYearForm}
          setFinancialYearForm={setFinancialYearForm}
          createFinancialYear={createFinancialYear}
          updatePeriodStatus={updatePeriodStatus}
          settingsForm={settingsForm}
          setSettingsForm={setSettingsForm}
          saveAccountingSettings={saveAccountingSettings}
          busy={busy}
        />
      )}
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

function AccountingClientCards({ clients, q, setQ, openClient, refresh, busy }) {
  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 rounded-md border border-stone-200 bg-white p-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-stone-900">Accounting Software</h1>
          <p className="mt-1 text-sm text-stone-600">Choose a client with Native EPOS Accounting enabled.</p>
        </div>
        <Button variant="outline" onClick={refresh} disabled={busy} className="gap-2">
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </header>

      <section className="rounded-md border border-stone-200 bg-white p-4">
        <div className="mb-4 max-w-xl">
          <Label className="text-xs font-semibold uppercase tracking-wide text-stone-500">Search clients</Label>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by business, contact or email" className="mt-2 h-10" />
        </div>

        {clients.length === 0 ? (
          <div className="rounded-md border border-dashed border-stone-200 bg-stone-50 p-8 text-center">
            <Building2 className="mx-auto h-9 w-9 text-stone-300" />
            <h2 className="mt-3 font-display text-lg font-semibold text-stone-900">No native accounting clients</h2>
            <p className="mt-1 text-sm text-stone-500">
              Enable EPOS native accounting from a client account to make it appear here.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {clients.map((client) => (
              <button
                key={client.id}
                type="button"
                onClick={() => openClient(client.id)}
                className="group flex min-h-48 flex-col justify-between rounded-md border border-stone-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md"
              >
                <span>
                  <span className="block truncate font-display text-lg font-bold text-stone-900">{client.business_name}</span>
                  <span className="mt-1 block truncate text-sm text-stone-500">{client.email}</span>
                  <Badge className="mt-4 bg-emerald-100 text-emerald-800 hover:bg-emerald-100">Native Accounting Enabled</Badge>
                </span>
                <span className="mt-5 flex items-center justify-between border-t border-stone-100 pt-3 text-sm font-semibold text-emerald-800">
                  Open Accounting Software
                  <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ClientAccountingHome({ workspace, openModule, backToClients, refresh, busy }) {
  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 rounded-md border border-stone-200 bg-white p-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <Button variant="outline" onClick={backToClients} className="mb-3 gap-2">
            <ArrowRight className="h-4 w-4 rotate-180" /> Accounting Software
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate font-display text-2xl font-bold text-stone-900">{workspace.client.business_name}</h1>
            <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">Native EPOS Accounting</Badge>
          </div>
          <p className="mt-1 text-sm text-stone-500">
            {workspace.client.first_name} {workspace.client.last_name} - {workspace.client.email}
          </p>
        </div>
        <Button variant="outline" onClick={refresh} disabled={busy} className="gap-2">
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </header>

      <section className="rounded-md border border-stone-200 bg-white p-4">
        <div className="mb-4">
          <h2 className="font-display text-xl font-bold text-stone-900">Accounting Software</h2>
          <p className="mt-1 text-sm text-stone-600">Choose the module you want to work in.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
          {MODULES.map((item) => (
            <AccountingModuleCard
              key={item.key}
              moduleKey={item.key}
              icon={item.icon}
              workspace={workspace}
              onOpen={() => openModule(item.key)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function AccountingModuleCard({ moduleKey, icon: Icon, workspace, onOpen }) {
  const detail = MODULE_DETAILS[moduleKey];
  const statValue = detail?.stat ? detail.stat(workspace) : "-";
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex min-h-72 flex-col rounded-md border border-stone-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md"
    >
      <span className="flex items-start justify-between gap-3">
        <span className="rounded-md bg-emerald-50 p-2 text-emerald-800">
          <Icon className="h-5 w-5" />
        </span>
        <ArrowRight className="h-4 w-4 text-stone-400 transition group-hover:translate-x-1 group-hover:text-emerald-800" />
      </span>
      <span className="mt-4 block font-display text-xl font-bold text-stone-900">{detail.title}</span>
      <span className="mt-3 block text-xs font-semibold uppercase tracking-wide text-stone-500">Manage</span>
      <span className="mt-2 grid gap-1 text-sm text-stone-600">
        {detail.manage.map((item) => <span key={item}>- {item}</span>)}
      </span>
      <span className="mt-auto border-t border-stone-100 pt-3">
        <span className="block text-xs font-semibold uppercase tracking-wide text-stone-500">{detail.statLabel}</span>
        <span className="mt-1 block font-display text-lg font-bold text-stone-900">{statValue}</span>
      </span>
    </button>
  );
}

function ModuleWorkspace(props) {
  const {
    module,
    moduleTab,
    setModuleTab,
    workspace,
    backToClientHome,
    accountForm,
    setAccountForm,
    createAccount,
    contactForm,
    setContactForm,
    createContact,
    bankForm,
    setBankForm,
    bankImportFile,
    setBankImportFile,
    createBankTransaction,
    importBankTransactions,
    reconcileBankTransaction,
    vatForm,
    setVatForm,
    prepareVatReturn,
    periodForm,
    setPeriodForm,
    createPeriod,
    financialYearForm,
    setFinancialYearForm,
    createFinancialYear,
    updatePeriodStatus,
    settingsForm,
    setSettingsForm,
    saveAccountingSettings,
    busy,
  } = props;
  const [filters, setFilters] = useState({ date_from: "", date_to: "", financial_year_id: "", period_id: "", search: "" });
  const detail = MODULE_DETAILS[module];

  function renderTab() {
    if (module === "payables") {
      if (moduleTab === "Suppliers") {
        return <ContactsWorkspace contacts={workspace.contacts} form={contactForm} setForm={setContactForm} createContact={createContact} busy={busy} typeFilter="supplier" title="Suppliers" />;
      }
      if (moduleTab === "Purchase Invoices") return <LedgerView title="Purchase invoices" journals={workspace.journals} accountCodes={["2000"]} />;
      return <PlaceholderModulePanel title={moduleTab} moduleTitle={detail.title} />;
    }

    if (module === "receivables") {
      if (moduleTab === "Customers") {
        return <ContactsWorkspace contacts={workspace.contacts} form={contactForm} setForm={setContactForm} createContact={createContact} busy={busy} typeFilter="customer" title="Customers" />;
      }
      if (moduleTab === "Sales Invoices") return <LedgerView title="Sales invoices" journals={workspace.journals} accountCodes={["1100"]} />;
      return <PlaceholderModulePanel title={moduleTab} moduleTitle={detail.title} />;
    }

    if (module === "banking") {
      if (moduleTab === "Transactions" || moduleTab === "Reconciliation" || moduleTab === "Bank Accounts") {
        return (
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
        );
      }
      return <PlaceholderModulePanel title={moduleTab} moduleTitle={detail.title} />;
    }

    if (module === "vat") {
      if (moduleTab === "Returns") {
        return <VatWorkspace workspace={workspace} form={vatForm} setForm={setVatForm} prepareVatReturn={prepareVatReturn} busy={busy} />;
      }
      if (moduleTab === "Reports") return <LedgerView title="VAT ledger" journals={workspace.journals} accountCodes={["2200"]} />;
      return <PlaceholderModulePanel title={moduleTab} moduleTitle={detail.title} />;
    }

    if (module === "gl") {
      if (moduleTab === "Transactions") return <TransactionsWorkspace workspace={workspace} filters={filters} />;
      if (moduleTab === "Journals") return <JournalTable journals={workspace.journals} />;
      if (moduleTab === "Account Activity") return <AccountActivityWorkspace workspace={workspace} filters={filters} />;
      if (moduleTab === "Trial Balance") return <TrialBalanceReport workspace={workspace} />;
      return <PlaceholderModulePanel title={moduleTab} moduleTitle={detail.title} />;
    }

    if (module === "coa") {
      if (moduleTab === "Chart of Accounts") {
        return <ChartOfAccounts accounts={workspace.accounts} form={accountForm} setForm={setAccountForm} createAccount={createAccount} busy={busy} />;
      }
      return <PlaceholderModulePanel title={moduleTab} moduleTitle={detail.title} />;
    }

    if (module === "audit") return <AuditTrailWorkspace auditLog={workspace.audit_log} />;

    if (module === "reports") return <ReportsWorkspace workspace={workspace} activeReport={moduleTab} filters={filters} />;

    if (module === "settings") {
      if (moduleTab === "Accounting Settings") {
        return <AccountingSettingsWorkspace accounts={workspace.accounts} form={settingsForm} setForm={setSettingsForm} saveSettings={saveAccountingSettings} busy={busy} />;
      }
      if (moduleTab === "Financial Years") {
        return <FinancialYearsWorkspace workspace={workspace} form={financialYearForm} setForm={setFinancialYearForm} createFinancialYear={createFinancialYear} busy={busy} />;
      }
      if (moduleTab === "Periods") {
        return <PeriodsWorkspace workspace={workspace} form={periodForm} setForm={setPeriodForm} createPeriod={createPeriod} updatePeriodStatus={updatePeriodStatus} busy={busy} />;
      }
    }

    return <PlaceholderModulePanel title={moduleTab || detail.title} moduleTitle={detail.title} />;
  }

  return (
    <div className="space-y-4">
      <header className="rounded-md border border-stone-200 bg-white p-4">
        <Button variant="outline" onClick={backToClientHome} className="mb-3 gap-2">
          <ArrowRight className="h-4 w-4 rotate-180" /> {workspace.client.business_name}
        </Button>
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-emerald-800">Accounting Software</p>
            <h1 className="mt-1 font-display text-2xl font-bold text-stone-900">{detail.title}</h1>
            <p className="mt-1 text-sm text-stone-500">{workspace.client.business_name}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {detail.tabs.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setModuleTab(tab)}
                className={`rounded-md px-3 py-2 text-sm font-semibold ${moduleTab === tab ? "bg-[var(--brand)] text-white" : "bg-stone-100 text-stone-700 hover:bg-stone-200"}`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>
      </header>
      <AccountingFilterBar workspace={workspace} filters={filters} setFilters={setFilters} />
      {renderTab()}
    </div>
  );
}

function PlaceholderModulePanel({ title, moduleTitle }) {
  return (
    <Panel title={title}>
      <div className="rounded-md border border-dashed border-stone-200 bg-stone-50 p-8 text-center">
        <h3 className="font-display text-lg font-semibold text-stone-900">{title}</h3>
        <p className="mt-1 text-sm text-stone-500">
          This {moduleTitle} tab is reserved for the next stage of the native accounting workflow.
        </p>
      </div>
    </Panel>
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

function AccountingFilterBar({ workspace, filters, setFilters }) {
  const years = workspace.financial_years || [];
  const periods = workspace.periods || [];
  const filteredPeriods = filters.financial_year_id ? periods.filter((period) => period.financial_year_id === filters.financial_year_id) : periods;
  return (
    <section className="rounded-md border border-stone-200 bg-white p-3">
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-[150px_150px_190px_190px_1fr_auto_auto_auto]">
        <Input type="date" value={filters.date_from} onChange={(e) => setFilters((current) => ({ ...current, date_from: e.target.value }))} className="h-9" />
        <Input type="date" value={filters.date_to} onChange={(e) => setFilters((current) => ({ ...current, date_to: e.target.value }))} className="h-9" />
        <select
          value={filters.financial_year_id}
          onChange={(e) => setFilters((current) => ({ ...current, financial_year_id: e.target.value, period_id: "" }))}
          className="h-9 rounded-md border border-stone-200 bg-white px-3 text-sm shadow-sm"
        >
          <option value="">All financial years</option>
          {years.map((year) => <option key={year.id} value={year.id}>{year.name}</option>)}
        </select>
        <select
          value={filters.period_id}
          onChange={(e) => setFilters((current) => ({ ...current, period_id: e.target.value }))}
          className="h-9 rounded-md border border-stone-200 bg-white px-3 text-sm shadow-sm"
        >
          <option value="">All periods</option>
          {filteredPeriods.map((period) => (
            <option key={period.id} value={period.id}>{period.period_name || "Period"} - {formatDate(period.period_start)}</option>
          ))}
        </select>
        <Input
          value={filters.search}
          onChange={(e) => setFilters((current) => ({ ...current, search: e.target.value }))}
          placeholder="Search reference, account, contact..."
          className="h-9"
        />
        <Button type="button" variant="outline" className="h-9 gap-2"><RefreshCw className="h-4 w-4" /> Refresh</Button>
        <Button type="button" variant="outline" className="h-9 gap-2"><Download className="h-4 w-4" /> Export</Button>
        <Button type="button" variant="outline" className="h-9 gap-2"><Printer className="h-4 w-4" /> Print</Button>
      </div>
    </section>
  );
}

function journalLines(workspace, filters = {}) {
  const search = String(filters.search || "").toLowerCase();
  const selectedPeriod = (workspace.periods || []).find((period) => period.id === filters.period_id);
  const selectedYear = (workspace.financial_years || []).find((year) => year.id === filters.financial_year_id);
  const start = filters.date_from || selectedPeriod?.period_start || selectedYear?.start_date || "";
  const end = filters.date_to || selectedPeriod?.period_end || selectedYear?.end_date || "";
  const rows = [];
  (workspace.journals || []).forEach((journal) => {
    if (start && journal.entry_date < start) return;
    if (end && journal.entry_date > end) return;
    (journal.lines || []).forEach((line) => {
      const haystack = `${journal.reference || ""} ${journal.description || ""} ${line.account_code || ""} ${line.account_name || ""} ${line.description || ""}`.toLowerCase();
      if (search && !haystack.includes(search)) return;
      rows.push({ journal, line });
    });
  });
  return rows;
}

function TransactionsWorkspace({ workspace, filters }) {
  const rows = journalLines(workspace, filters);
  return (
    <Panel title="Transactions">
      {rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-stone-500">No transactions match the selected filters.</p>
      ) : (
        <AccountingRows rows={rows} />
      )}
    </Panel>
  );
}

function AccountActivityWorkspace({ workspace, filters }) {
  const rows = journalLines(workspace, filters);
  const grouped = rows.reduce((acc, row) => {
    const key = row.line.account_code || "unknown";
    if (!acc[key]) acc[key] = { account: `${row.line.account_code} - ${row.line.account_name}`, debit: 0, credit: 0, rows: [] };
    acc[key].debit += Number(row.line.debit || 0);
    acc[key].credit += Number(row.line.credit || 0);
    acc[key].rows.push(row);
    return acc;
  }, {});
  return (
    <Panel title="Account activity">
      {Object.keys(grouped).length === 0 ? (
        <p className="py-10 text-center text-sm text-stone-500">No account activity for this filter.</p>
      ) : (
        <div className="space-y-3">
          {Object.values(grouped).map((group) => (
            <div key={group.account} className="rounded-md border border-stone-200">
              <div className="flex flex-col gap-2 border-b border-stone-100 bg-stone-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                <strong className="text-sm text-stone-900">{group.account}</strong>
                <span className="text-xs text-stone-500">Debit {formatMoney(group.debit)} / Credit {formatMoney(group.credit)}</span>
              </div>
              <AccountingRows rows={group.rows} compact />
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function AccountingRows({ rows, compact = false }) {
  return (
    <div className="overflow-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
          <tr>
            <th className="px-3 py-2">Date</th>
            <th className="px-3 py-2">Reference</th>
            <th className="px-3 py-2">Account</th>
            {!compact && <th className="px-3 py-2">Description</th>}
            <th className="px-3 py-2 text-right">Debit</th>
            <th className="px-3 py-2 text-right">Credit</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ journal, line }) => (
            <tr key={`${journal.id}-${line.id}`} className="border-t border-stone-100">
              <td className="px-3 py-2">{formatDate(journal.entry_date)}</td>
              <td className="px-3 py-2 font-medium text-stone-900">{journal.reference || "-"}</td>
              <td className="px-3 py-2 text-stone-700">{line.account_code} - {line.account_name}</td>
              {!compact && <td className="px-3 py-2 text-stone-500">{line.description || journal.description || "-"}</td>}
              <td className="px-3 py-2 text-right">{formatMoney(line.debit)}</td>
              <td className="px-3 py-2 text-right">{formatMoney(line.credit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BankingWorkspace({ workspace, form, setForm, importFile, setImportFile, createBankTransaction, importBankTransactions, reconcileBankTransaction, busy }) {
  const bankAccounts = (workspace.accounts || []).filter((account) => String(account.account_type || "").toLowerCase() === "bank" || account.purpose === "Bank Account" || account.code === "1200");
  const postingAccounts = (workspace.accounts || []).filter((account) => account.active && String(account.account_type || "").toLowerCase() !== "bank" && account.purpose !== "Bank Account");
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

function ContactsWorkspace({ contacts = [], form, setForm, createContact, busy, typeFilter = null, title = "Contacts" }) {
  useEffect(() => {
    if (typeFilter && form.contact_type !== typeFilter) {
      setForm((current) => ({ ...current, contact_type: typeFilter }));
    }
  }, [typeFilter, form.contact_type, setForm]);
  const suppliers = contacts.filter((contact) => contact.contact_type === "supplier");
  const customers = contacts.filter((contact) => contact.contact_type === "customer");
  const visibleContacts = typeFilter ? contacts.filter((contact) => contact.contact_type === typeFilter) : contacts;
  const singular = typeFilter === "customer" ? "customer" : typeFilter === "supplier" ? "supplier" : "contact";
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <SummaryCard label="Suppliers" value={suppliers.length} tone="amber" />
          <SummaryCard label="Customers" value={customers.length} tone="blue" />
        </div>
        <Panel title={title}>
          {visibleContacts.length === 0 ? (
            <p className="py-12 text-center text-sm text-stone-500">No native {singular}s yet. Add one here, or let invoice publishing create it.</p>
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
                  {visibleContacts.map((contact) => (
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
      <Panel title={`Add ${singular}`}>
        <form onSubmit={createContact} className="space-y-3">
          <Field label="Name" value={form.name} onChange={(value) => setForm((current) => ({ ...current, name: value }))} />
          {typeFilter ? (
            <Info label="Type" value={typeFilter === "customer" ? "Customer" : "Supplier"} />
          ) : (
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
          )}
          <Field label="Email" type="email" value={form.email} onChange={(value) => setForm((current) => ({ ...current, email: value }))} />
          <Button disabled={busy} className="w-full gap-2" style={{ background: "var(--brand)" }}>
            <Plus className="h-4 w-4" /> Create {singular}
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

function AuditTrailWorkspace({ auditLog = [] }) {
  return (
    <Panel title="Audit trail">
      {auditLog.length === 0 ? (
        <p className="py-10 text-center text-sm text-stone-500">No audit events yet.</p>
      ) : (
        <div className="overflow-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-3 py-2">Date & time</th>
                <th className="px-3 py-2">User</th>
                <th className="px-3 py-2">Module</th>
                <th className="px-3 py-2">Record</th>
                <th className="px-3 py-2">Action</th>
                <th className="px-3 py-2">Previous</th>
                <th className="px-3 py-2">New</th>
                <th className="px-3 py-2">IP</th>
              </tr>
            </thead>
            <tbody>
              {auditLog.map((event) => (
                <tr key={event.id} className="border-t border-stone-100 align-top">
                  <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(event.created_at)}</td>
                  <td className="px-3 py-2 text-stone-600">{event.actor_id || "-"}</td>
                  <td className="px-3 py-2 text-stone-600">{event.module || event.entity_type || "-"}</td>
                  <td className="px-3 py-2 text-stone-600">{event.record_type || event.entity_type || "-"}<br /><span className="text-xs text-stone-400">{event.record_id || event.entity_id || "-"}</span></td>
                  <td className="px-3 py-2 font-semibold text-stone-900">{event.action}</td>
                  <td className="max-w-64 px-3 py-2 text-xs text-stone-500">{displayAuditValue(event.previous_value)}</td>
                  <td className="max-w-64 px-3 py-2 text-xs text-stone-500">{displayAuditValue(event.new_value || event.details_json)}</td>
                  <td className="px-3 py-2 text-stone-500">{event.ip_address || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function AccountSelect({ accounts = [], value, onChange, purpose = "", label }) {
  const options = purpose ? accounts.filter((account) => account.purpose === purpose || !value) : accounts;
  return (
    <div>
      <Label className="text-xs font-semibold text-stone-600">{label}</Label>
      <select
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 h-9 w-full rounded-md border border-stone-200 bg-white px-3 text-sm shadow-sm"
      >
        <option value="">Select account</option>
        {options.map((account) => (
          <option key={account.id || account.code} value={account.code}>
            {account.code} - {account.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function AccountingSettingsWorkspace({ accounts, form, setForm, saveSettings, busy }) {
  const updateField = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <Panel title="Accounting settings">
      <form onSubmit={saveSettings} className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <AccountSelect label="Default Sales Account" accounts={accounts} purpose="Standard Nominal" value={form.default_sales_account} onChange={(value) => updateField("default_sales_account", value)} />
          <AccountSelect label="Default Purchase Account" accounts={accounts} purpose="Standard Nominal" value={form.default_purchase_account} onChange={(value) => updateField("default_purchase_account", value)} />
          <AccountSelect label="Default VAT Control Account" accounts={accounts} purpose="VAT Control" value={form.default_vat_control_account} onChange={(value) => updateField("default_vat_control_account", value)} />
          <AccountSelect label="Default Bank Account" accounts={accounts} purpose="Bank Account" value={form.default_bank_account} onChange={(value) => updateField("default_bank_account", value)} />
          <AccountSelect label="Default Suspense Account" accounts={accounts} purpose="Suspense" value={form.default_suspense_account} onChange={(value) => updateField("default_suspense_account", value)} />
          <AccountSelect label="Default Debtors Control Account" accounts={accounts} purpose="Sales Ledger" value={form.default_debtors_control_account} onChange={(value) => updateField("default_debtors_control_account", value)} />
          <AccountSelect label="Default Creditors Control Account" accounts={accounts} purpose="Purchase Ledger" value={form.default_creditors_control_account} onChange={(value) => updateField("default_creditors_control_account", value)} />
          <AccountSelect label="Default Retained Earnings Account" accounts={accounts} purpose="Retained Earnings" value={form.default_retained_earnings_account} onChange={(value) => updateField("default_retained_earnings_account", value)} />
        </div>
        <div className="flex justify-end">
          <Button disabled={busy} className="gap-2" style={{ background: "var(--brand)" }}>Save accounting settings</Button>
        </div>
      </form>
    </Panel>
  );
}

function FinancialYearsWorkspace({ workspace, form, setForm, createFinancialYear, busy }) {
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
      <Panel title="Financial years">
        {(workspace.financial_years || []).length === 0 ? (
          <p className="py-10 text-center text-sm text-stone-500">No financial years created yet. Create a year and EPOS will generate the periods automatically.</p>
        ) : (
          <div className="overflow-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Start</th>
                  <th className="px-3 py-2">End</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {(workspace.financial_years || []).map((year) => (
                  <tr key={year.id} className="border-t border-stone-100">
                    <td className="px-3 py-2 font-semibold text-stone-900">{year.name}</td>
                    <td className="px-3 py-2">{formatDate(year.start_date)}</td>
                    <td className="px-3 py-2">{formatDate(year.end_date)}</td>
                    <td className="px-3 py-2"><Badge variant="outline" className="capitalize">{year.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel title="Create financial year">
        <form onSubmit={createFinancialYear} className="space-y-3">
          <Field label="Financial year name" value={form.name} onChange={(value) => setForm((current) => ({ ...current, name: value }))} />
          <Field label="Start date" type="date" value={form.start_date} onChange={(value) => setForm((current) => ({ ...current, start_date: value }))} />
          <Field label="End date" type="date" value={form.end_date} onChange={(value) => setForm((current) => ({ ...current, end_date: value }))} />
          <Button disabled={busy} className="w-full" style={{ background: "var(--brand)" }}>Create year and periods</Button>
        </form>
      </Panel>
    </div>
  );
}

function PeriodsWorkspace({ workspace, updatePeriodStatus, busy }) {
  return (
    <div>
      <Panel title="Accounting periods">
        {(workspace.periods || []).length === 0 ? (
          <p className="py-10 text-center text-sm text-stone-500">No periods created yet. Create a financial year to generate periods automatically.</p>
        ) : (
          <div className="overflow-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-3 py-2">Period</th>
                  <th className="px-3 py-2">Start Date</th>
                  <th className="px-3 py-2">End Date</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Transactions Posted</th>
                  <th className="px-3 py-2">Last Updated</th>
                  <th className="px-3 py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {(workspace.periods || []).map((period) => (
                  <tr key={period.id} className="border-t border-stone-100">
                    <td className="px-3 py-2 font-semibold text-stone-900">{period.period_name || period.notes || "Period"}</td>
                    <td className="px-3 py-2">{formatDate(period.period_start)}</td>
                    <td className="px-3 py-2">{formatDate(period.period_end)}</td>
                    <td className="px-3 py-2"><Badge variant="outline" className="capitalize">{period.status}</Badge></td>
                    <td className="px-3 py-2 text-right">{period.transactions_posted || 0}</td>
                    <td className="px-3 py-2">{formatDateTime(period.updated_at)}</td>
                    <td className="px-3 py-2">
                      <select
                        value={period.status || "open"}
                        disabled={busy}
                        onChange={(e) => updatePeriodStatus(period.id, e.target.value)}
                        className="h-8 rounded-md border border-stone-200 bg-white px-2 text-xs shadow-sm"
                      >
                        <option value="open">Open</option>
                        <option value="locked">Locked</option>
                        <option value="closed">Closed</option>
                      </select>
                    </td>
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
  const [filters, setFilters] = useState({ category: "", account_type: "", purpose: "", active: "active", search: "" });
  const visibleAccounts = (accounts || []).filter((account) => {
    if (filters.category && account.category !== filters.category) return false;
    if (filters.account_type && account.account_type !== filters.account_type) return false;
    if (filters.purpose && account.purpose !== filters.purpose) return false;
    if (filters.active === "active" && !account.active) return false;
    if (filters.active === "inactive" && account.active) return false;
    const needle = filters.search.trim().toLowerCase();
    if (needle && !`${account.code || ""} ${account.name || ""}`.toLowerCase().includes(needle)) return false;
    return true;
  });
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
      <Panel title="Chart of accounts">
        <div className="mb-3 grid gap-2 md:grid-cols-3 xl:grid-cols-5">
          <Input value={filters.search} onChange={(e) => setFilters((current) => ({ ...current, search: e.target.value }))} placeholder="Search code or name" className="h-9" />
          <select value={filters.category} onChange={(e) => setFilters((current) => ({ ...current, category: e.target.value }))} className="h-9 rounded-md border border-stone-200 bg-white px-3 text-sm shadow-sm">
            <option value="">All categories</option>
            {ACCOUNT_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
          <select value={filters.account_type} onChange={(e) => setFilters((current) => ({ ...current, account_type: e.target.value }))} className="h-9 rounded-md border border-stone-200 bg-white px-3 text-sm shadow-sm">
            <option value="">All account types</option>
            {ACCOUNT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
          <select value={filters.purpose} onChange={(e) => setFilters((current) => ({ ...current, purpose: e.target.value }))} className="h-9 rounded-md border border-stone-200 bg-white px-3 text-sm shadow-sm">
            <option value="">All purposes</option>
            {ACCOUNT_PURPOSES.map((purpose) => <option key={purpose} value={purpose}>{purpose}</option>)}
          </select>
          <select value={filters.active} onChange={(e) => setFilters((current) => ({ ...current, active: e.target.value }))} className="h-9 rounded-md border border-stone-200 bg-white px-3 text-sm shadow-sm">
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="">All statuses</option>
          </select>
        </div>
        <div className="overflow-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-3 py-2">Account Code</th>
                <th className="px-3 py-2">Account Name</th>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2">Account Type</th>
                <th className="px-3 py-2">Purpose</th>
                <th className="px-3 py-2">Control</th>
                <th className="px-3 py-2">Active</th>
                <th className="px-3 py-2 text-right">Current Balance</th>
              </tr>
            </thead>
            <tbody>
              {visibleAccounts.map((account) => (
                <tr key={account.id} className="border-t border-stone-100">
                  <td className="px-3 py-2 font-semibold text-stone-900">{account.code}</td>
                  <td className="px-3 py-2">{account.name}</td>
                  <td className="px-3 py-2 text-stone-600">{account.category}</td>
                  <td className="px-3 py-2 text-stone-600">{account.account_type || account.type}</td>
                  <td className="px-3 py-2 text-stone-600">{account.purpose || "Standard Nominal"}</td>
                  <td className="px-3 py-2">{account.is_control_account || account.control_account ? <Badge variant="outline">Control</Badge> : "-"}</td>
                  <td className="px-3 py-2">{account.active ? "Active" : "Inactive"}</td>
                  <td className="px-3 py-2 text-right font-semibold">{formatMoney(account.current_balance)}</td>
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
            <Label className="text-xs font-semibold text-stone-600">Category</Label>
            <select
              value={form.category}
              onChange={(e) => setForm((current) => ({ ...current, category: e.target.value }))}
              className="mt-1 h-9 w-full rounded-md border border-stone-200 bg-white px-3 text-sm shadow-sm"
            >
              {ACCOUNT_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-xs font-semibold text-stone-600">Account Type</Label>
            <select
              value={form.account_type}
              onChange={(e) => setForm((current) => ({ ...current, account_type: e.target.value }))}
              className="mt-1 h-9 w-full rounded-md border border-stone-200 bg-white px-3 text-sm shadow-sm"
            >
              {ACCOUNT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-xs font-semibold text-stone-600">Purpose</Label>
            <select
              value={form.purpose}
              onChange={(e) => setForm((current) => ({ ...current, purpose: e.target.value }))}
              className="mt-1 h-9 w-full rounded-md border border-stone-200 bg-white px-3 text-sm shadow-sm"
            >
              {ACCOUNT_PURPOSES.map((purpose) => <option key={purpose} value={purpose}>{purpose}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-xs font-semibold text-stone-600">Normal Balance</Label>
            <select
              value={form.normal_balance}
              onChange={(e) => setForm((current) => ({ ...current, normal_balance: e.target.value }))}
              className="mt-1 h-9 w-full rounded-md border border-stone-200 bg-white px-3 text-sm shadow-sm"
            >
              <option value="debit">Debit</option>
              <option value="credit">Credit</option>
            </select>
          </div>
          <label className="flex items-center gap-2 rounded-md border border-stone-200 p-3 text-sm font-semibold text-stone-700">
            <input
              type="checkbox"
              checked={!!form.is_control_account}
              onChange={(e) => setForm((current) => ({ ...current, is_control_account: e.target.checked }))}
            />
            Is Control Account
          </label>
          <Field label="Description" value={form.description} onChange={(value) => setForm((current) => ({ ...current, description: value }))} />
          <Button disabled={busy} className="w-full gap-2" style={{ background: "var(--brand)" }}>
            <Plus className="h-4 w-4" /> Create account
          </Button>
        </form>
      </Panel>
    </div>
  );
}

function ReportsWorkspace({ workspace, activeReport }) {
  const reports = workspace.reports || {};
  const pnl = reports.profit_and_loss || {};
  const balanceSheet = reports.balance_sheet || {};
  const trialBalance = reports.trial_balance || [];
  const agedReceivables = reports.aged_receivables || [];
  const agedPayables = reports.aged_payables || [];
  if (activeReport === "Trial Balance") return <TrialBalanceReport workspace={workspace} />;
  if (activeReport === "Profit and Loss") {
    return (
      <Panel title="Profit and Loss">
        <ReportRows rows={[["Income", pnl.income], ["Expenses", pnl.expenses], ["Profit / loss", pnl.profit]]} />
      </Panel>
    );
  }
  if (activeReport === "Balance Sheet") {
    return (
      <Panel title="Balance Sheet">
        <ReportRows rows={[["Assets", balanceSheet.assets], ["Liabilities", balanceSheet.liabilities], ["Equity", balanceSheet.equity], ["Net assets", balanceSheet.net_assets]]} />
      </Panel>
    );
  }
  if (activeReport === "Aged Debtors") return <AgedBalanceTable title="Aged debtors" rows={agedReceivables} empty="No customer balances yet." />;
  if (activeReport === "Aged Creditors") return <AgedBalanceTable title="Aged creditors" rows={agedPayables} empty="No supplier balances yet." />;
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

function TrialBalanceReport({ workspace }) {
  const trialBalance = workspace?.reports?.trial_balance || [];
  return (
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
                  <td className="px-3 py-2 text-stone-600">{row.type || row.account_type}</td>
                  <td className="px-3 py-2 text-right">{formatMoney(row.debit)}</td>
                  <td className="px-3 py-2 text-right">{formatMoney(row.credit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
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

function formatDateTime(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("en-GB");
}

function displayAuditValue(value) {
  if (!value) return "-";
  if (typeof value === "string") return value.length > 160 ? `${value.slice(0, 160)}...` : value;
  try {
    const text = JSON.stringify(value);
    return text.length > 160 ? `${text.slice(0, 160)}...` : text;
  } catch {
    return "-";
  }
}
